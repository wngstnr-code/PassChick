import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  FAUCET_ABI,
  FAUCET_CONTRACT_ADDRESS,
  GAME_SETTLEMENT_ABI,
  GAME_SETTLEMENT_ADDRESS,
  GAME_VAULT_ABI,
  GAME_VAULT_ADDRESS,
  isTicketVaultConfigured,
  publicClient,
  TICKET_VAULT_ABI,
  TICKET_VAULT_ADDRESS,
} from "../lib/celo.js";
import { computeStreakDay, utcDayIndex } from "./dailyClaimService.js";

type TransactionType =
  | "DEPOSIT"
  | "WITHDRAW"
  | "TREASURY_FUNDED"
  | "SESSION_STARTED"
  | "SESSION_SETTLED"
  | "TICKET_CLAIM"
  | "TICKET_PURCHASE"
  | "TICKET_CREDIT"
  | "TICKET_SPEND";

let isListening = false;
let unwatchers: Array<() => void> = [];
let backfillTimer: NodeJS.Timeout | null = null;

function unitsToToken(amount: bigint): number {
  return Number(amount) / 10 ** env.TOKEN_DECIMALS;
}

async function ensurePlayer(walletAddress: string) {
  const { error } = await supabase
    .from("players")
    .upsert({ wallet_address: walletAddress }, { onConflict: "wallet_address" });
  if (error) {
    console.error(`❌ Failed to ensure player ${walletAddress}:`, error);
  }
}

async function logTransaction(params: {
  txHash: string;
  walletAddress: string;
  type: TransactionType;
  amount: number;
  onchainSessionId?: string;
}) {
  const { error } = await supabase.from("transactions").upsert(
    {
      tx_hash: params.txHash,
      wallet_address: params.walletAddress,
      type: params.type,
      amount: params.amount,
      onchain_session_id: params.onchainSessionId ?? null,
    },
    { onConflict: "tx_hash" },
  );
  if (error) {
    console.error(`❌ Failed to log transaction ${params.txHash}:`, error);
  }
}

function txHash(log: { transactionHash?: string | null }) {
  return String(log.transactionHash || "");
}

function dateStringToDayIndex(value: string): number {
  return utcDayIndex(new Date(`${value}T00:00:00.000Z`));
}

function dayIndexToDateString(dayIndex: number): string {
  return new Date(dayIndex * 86400 * 1000).toISOString().slice(0, 10);
}

/// Mirrors ticket_balances against the on-chain TicketVault ledger.
///
/// Column semantics (see database/schema_v2.sql):
///  - `onchain_credited` accumulates credit-shaped events (claim, purchase,
///    creditBatch). On-chain spends TIDAK dikurangkan di sini (lihat di bawah).
///  - `offchain_debited` accumulates in-match ticket debits (debit RPC) and
///    is relieved only by refunds. It is NOT relieved when a spend batch
///    settles on-chain — the pair (credited stays high, debited stays high)
///    cancels out, so `balance` stays correct.
///  - `balance = onchain_credited - offchain_debited` is what the app shows.
///
/// KOREKSI SC (menggantikan HANDOFF_V2.md §2.3): TicketSpent TIDAK dipakai
/// untuk mirror. Settlement spendBatch dicatat oleh spendBatchExecutor lewat
/// `reconciled_tx_hash` — event delivery di sini at-least-once, dan
/// double-apply akan merusak komponen ledger (offchain_debited bisa negatif).
/// Jangan "memperbaiki" dengan menambahkan kembali mirror spend di sini.
/// Fungsi ini sekarang hanya menangani credit-shaped events.
let warnedMissingEventLog = false;

/// PostgREST reports an absent table either by the Postgres code (42P01) or by
/// its own schema-cache code, depending on version.
function isMissingTableError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /(does not exist|schema cache)/i.test(error.message ?? "")
  );
}

/// Claims a single on-chain log for processing, exactly once, forever.
/// Returns false when this (txHash, logIndex) was already applied - which is
/// what makes the boot backfill safe to overlap with the live watcher, and
/// makes at-least-once event delivery harmless.
///
/// `transactions.tx_hash` cannot be used for this: one `creditBatch` tx emits
/// one TicketCredited per user, so every log in that batch shares a tx hash.
async function claimTicketEvent(params: {
  txHash: string;
  logIndex: number | null;
  eventName: string;
  walletAddress: string;
  amount: bigint;
  blockNumber: bigint | null;
}): Promise<boolean> {
  if (!params.txHash || params.logIndex === null) {
    // A pending log has neither; nothing to dedupe against, so refuse it
    // rather than risk crediting twice once it is mined.
    return false;
  }

  const { error } = await supabase.from("ticket_event_log").insert({
    tx_hash: params.txHash,
    log_index: params.logIndex,
    event_name: params.eventName,
    wallet_address: params.walletAddress,
    amount: params.amount.toString(),
    block_number: (params.blockNumber ?? 0n).toString(),
  });

  if (!error) return true;
  if (error.code === "23505") return false; // already processed

  // Deployed ahead of the V2.3 migration: the dedupe table does not exist yet.
  // Crediting twice on a redelivered event is recoverable; silently dropping
  // every claim is not. Degrade to the old unguarded behaviour and shout.
  if (isMissingTableError(error)) {
    if (!warnedMissingEventLog) {
      console.error(
        "⚠️  ticket_event_log is missing — apply schema_v2.sql V2.3. " +
          "Ticket events are being applied WITHOUT de-duplication until then.",
      );
      warnedMissingEventLog = true;
    }
    return true;
  }

  console.error(`❌ Failed to record ticket event ${params.txHash}#${params.logIndex}:`, error);
  return false;
}

async function applyTicketMirrorDelta(
  walletAddress: string,
  amount: bigint,
  blockNumber: bigint | null,
) {
  const { data: existing, error: fetchError } = await supabase
    .from("ticket_balances")
    .select("onchain_credited, offchain_debited")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (fetchError) {
    console.error(`❌ Failed to read ticket_balances for ${walletAddress}:`, fetchError);
    return;
  }

  const prevOnchainCredited = BigInt(existing?.onchain_credited ?? 0);
  const offchainDebited = BigInt(existing?.offchain_debited ?? 0);

  const onchainCredited = prevOnchainCredited + amount;
  const balance = onchainCredited - offchainDebited;

  const { error: upsertError } = await supabase.from("ticket_balances").upsert(
    {
      wallet_address: walletAddress,
      onchain_credited: onchainCredited.toString(),
      offchain_debited: offchainDebited.toString(),
      balance: balance.toString(),
      last_synced_block: blockNumber !== null ? blockNumber.toString() : undefined,
    },
    { onConflict: "wallet_address" },
  );

  if (upsertError) {
    console.error(`❌ Failed to upsert ticket_balances for ${walletAddress}:`, upsertError);
  }
}

/// The subset of a decoded TicketVault log the handlers below need. Shaped so
/// both viem's `watchContractEvent` logs and `getLogs` (backfill) logs satisfy
/// it, and so uint16/uint32 (number) and uint256 (bigint) args both fit.
interface TicketEventLog {
  args: {
    user?: `0x${string}`;
    amount?: bigint | number;
    tickets?: bigint | number;
    dayIndex?: bigint | number;
  };
  transactionHash?: `0x${string}` | null;
  logIndex?: number | null;
  blockNumber?: bigint | null;
}

const toBig = (value: bigint | number) => (typeof value === "bigint" ? value : BigInt(value));

/// The four TicketVault handlers. Each is idempotent through
/// `claimTicketEvent`, so the boot backfill and the live watcher can both see
/// the same log and only one of them will apply it.

async function handleTicketClaimedLog(log: TicketEventLog): Promise<void> {
  const walletAddress = log.args.user;
  const { dayIndex, amount } = log.args;
  if (!walletAddress || dayIndex === undefined || amount === undefined) return;

  const claimed = await claimTicketEvent({
    txHash: String(log.transactionHash ?? ""),
    logIndex: log.logIndex ?? null,
    eventName: "TicketClaimed",
    walletAddress,
    amount: toBig(amount),
    blockNumber: log.blockNumber ?? null,
  });
  if (!claimed) return;

  await ensurePlayer(walletAddress);
  await logTransaction({
    txHash: txHash(log),
    walletAddress,
    type: "TICKET_CLAIM",
    amount: Number(amount),
  });
  await applyTicketMirrorDelta(walletAddress, toBig(amount), log.blockNumber ?? null);
  await advanceDailyStreak(walletAddress, Number(dayIndex));
}

async function handleTicketPurchasedLog(log: TicketEventLog): Promise<void> {
  const walletAddress = log.args.user;
  const { tickets } = log.args;
  if (!walletAddress || tickets === undefined) return;

  const claimed = await claimTicketEvent({
    txHash: String(log.transactionHash ?? ""),
    logIndex: log.logIndex ?? null,
    eventName: "TicketPurchased",
    walletAddress,
    amount: toBig(tickets),
    blockNumber: log.blockNumber ?? null,
  });
  if (!claimed) return;

  await ensurePlayer(walletAddress);
  // `amount` recorded here is the ticket count granted (not the USD spent or
  // on-chain token cost), to stay consistent with the ticket-count semantics
  // used by TICKET_CLAIM/CREDIT/SPEND.
  await logTransaction({
    txHash: txHash(log),
    walletAddress,
    type: "TICKET_PURCHASE",
    amount: Number(tickets),
  });
  await applyTicketMirrorDelta(walletAddress, toBig(tickets), log.blockNumber ?? null);
}

async function handleTicketCreditedLog(log: TicketEventLog): Promise<void> {
  const walletAddress = log.args.user;
  const { amount } = log.args;
  if (!walletAddress || amount === undefined) return;

  const claimed = await claimTicketEvent({
    txHash: String(log.transactionHash ?? ""),
    logIndex: log.logIndex ?? null,
    eventName: "TicketCredited",
    walletAddress,
    amount: toBig(amount),
    blockNumber: log.blockNumber ?? null,
  });
  if (!claimed) return;

  await ensurePlayer(walletAddress);
  await logTransaction({
    txHash: txHash(log),
    walletAddress,
    type: "TICKET_CREDIT",
    amount: Number(amount),
  });
  await applyTicketMirrorDelta(walletAddress, toBig(amount), log.blockNumber ?? null);
}

async function handleTicketSpentLog(log: TicketEventLog): Promise<void> {
  const walletAddress = log.args.user;
  const { amount } = log.args;
  if (!walletAddress || amount === undefined) return;

  const claimed = await claimTicketEvent({
    txHash: String(log.transactionHash ?? ""),
    logIndex: log.logIndex ?? null,
    eventName: "TicketSpent",
    walletAddress,
    amount: toBig(amount),
    blockNumber: log.blockNumber ?? null,
  });
  if (!claimed) return;

  await ensurePlayer(walletAddress);
  // KOREKSI SC: hanya catat riwayat transaksi. JANGAN apply mirror delta di
  // sini — settlement spendBatch direkonsiliasi oleh spendBatchExecutor,
  // bukan lewat event TicketSpent.
  await logTransaction({
    txHash: txHash(log),
    walletAddress,
    type: "TICKET_SPEND",
    amount: Number(amount),
  });
}

/// ── Catch-up backfill ────────────────────────────────────────────────────
/// `watchContractEvent` only ever sees events that arrive while the process is
/// alive, so a deploy or crash used to drop claims permanently: the player's
/// tx succeeded on-chain and their tickets never showed up. This scans the
/// blocks between the stored cursor and the head, replaying anything missed.

/// Forno caps eth_getLogs at 5000 blocks per query; stay under it.
const BACKFILL_CHUNK = 4000n;
/// Cold start (no cursor yet): how far back to look rather than scanning the
/// chain from genesis. ~1 day at Celo's 5s blocks.
const BACKFILL_COLD_START_BLOCKS = 17280n;
/// Re-run periodically, not just at boot: it also covers a watcher whose RPC
/// filter was dropped silently, which public endpoints do.
const BACKFILL_INTERVAL_MS = 5 * 60 * 1000;

function syncCursorId(): string {
  return `ticket_vault:${env.CHAIN_ID}`;
}

async function readSyncCursor(): Promise<bigint | null> {
  const { data, error } = await supabase
    .from("chain_sync_state")
    .select("last_processed_block")
    .eq("id", syncCursorId())
    .maybeSingle();
  if (error) {
    console.error("❌ Failed to read chain sync cursor:", error);
    return null;
  }
  const stored = data?.last_processed_block;
  return stored === undefined || stored === null ? null : BigInt(stored);
}

async function writeSyncCursor(block: bigint): Promise<void> {
  const { error } = await supabase.from("chain_sync_state").upsert(
    {
      id: syncCursorId(),
      last_processed_block: block.toString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error("❌ Failed to write chain sync cursor:", error);
  }
}

async function dispatchTicketLog(log: TicketEventLog & { eventName?: string }): Promise<void> {
  switch (log.eventName) {
    case "TicketClaimed":
      return handleTicketClaimedLog(log);
    case "TicketPurchased":
      return handleTicketPurchasedLog(log);
    case "TicketCredited":
      return handleTicketCreditedLog(log);
    case "TicketSpent":
      return handleTicketSpentLog(log);
    default:
      return;
  }
}

/// Replays TicketVault events from the cursor up to the current head.
/// Safe to call at any time: every log goes through `claimTicketEvent`, so
/// anything the live watcher already applied is skipped.
export async function backfillTicketEvents(): Promise<void> {
  if (!isTicketVaultConfigured()) return;

  const head = await publicClient.getBlockNumber();
  const cursor = await readSyncCursor();
  let from = cursor === null ? head - BACKFILL_COLD_START_BLOCKS : cursor + 1n;
  if (from < 0n) from = 0n;
  if (from > head) return;

  const span = head - from + 1n;
  console.log(`🔁 Ticket backfill: blocks ${from}..${head} (${span})`);

  let applied = 0;
  let scanned = from;
  while (scanned <= head) {
    const to = scanned + BACKFILL_CHUNK - 1n > head ? head : scanned + BACKFILL_CHUNK - 1n;
    let logs;
    try {
      logs = await publicClient.getContractEvents({
        address: TICKET_VAULT_ADDRESS,
        abi: TICKET_VAULT_ABI,
        fromBlock: scanned,
        toBlock: to,
      });
    } catch (err) {
      // Stop at the last fully-processed block: the cursor must never skip
      // past a range we failed to read, or those events are lost for good.
      console.error(`❌ Ticket backfill failed at ${scanned}..${to}:`, err);
      return;
    }

    for (const log of logs) {
      try {
        await dispatchTicketLog(log as TicketEventLog & { eventName?: string });
        applied += 1;
      } catch (err) {
        console.error("❌ Ticket backfill failed to apply a log:", err);
        return;
      }
    }

    await writeSyncCursor(to);
    scanned = to + 1n;
  }

  if (applied > 0) {
    console.log(`🔁 Ticket backfill replayed ${applied} event(s).`);
  }
}

/// Advances the off-chain `daily_streaks` mirror when a `TicketClaimed`
/// event is confirmed. This is the ONLY place streak_day is allowed to
/// change - never in routes/tickets.ts - so a signed-but-never-submitted
/// claim can't advance a user's streak (see routes/tickets.ts comment).
async function advanceDailyStreak(walletAddress: string, dayIndex: number) {
  const { data: existing, error: fetchError } = await supabase
    .from("daily_streaks")
    .select("streak_day, last_claim_day, total_claims")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  if (fetchError) {
    console.error(`❌ Failed to read daily_streaks for ${walletAddress}:`, fetchError);
    return;
  }

  const prevStreakDay = existing?.streak_day ?? 0;
  const prevClaimDayIndex = existing?.last_claim_day
    ? dateStringToDayIndex(String(existing.last_claim_day))
    : null;
  const streakDay = computeStreakDay(prevStreakDay, prevClaimDayIndex, dayIndex);
  const totalClaims = (existing?.total_claims ?? 0) + 1;

  const { error: upsertError } = await supabase.from("daily_streaks").upsert(
    {
      wallet_address: walletAddress,
      streak_day: streakDay,
      last_claim_day: dayIndexToDateString(dayIndex),
      total_claims: totalClaims,
    },
    { onConflict: "wallet_address" },
  );

  if (upsertError) {
    console.error(`❌ Failed to upsert daily_streaks for ${walletAddress}:`, upsertError);
  }
}

export async function startBlockchainListener(): Promise<void> {
  if (isListening) return;

  try {
    console.log(`🔗 Starting Celo event listener on ${env.RPC_URL}`);
    console.log(`   Vault: ${GAME_VAULT_ADDRESS}`);
    console.log(`   Settlement: ${GAME_SETTLEMENT_ADDRESS}`);

    unwatchers = [
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "Deposited",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.account;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "DEPOSIT",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle Deposited event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "Withdrawn",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.account;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "WITHDRAW",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle Withdrawn event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_VAULT_ADDRESS,
        abi: GAME_VAULT_ABI,
        eventName: "TreasuryFunded",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.funder;
              if (!walletAddress || log.args.amount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "TREASURY_FUNDED",
                amount: unitsToToken(log.args.amount),
              });
            })().catch((err) => console.error("❌ Failed to handle TreasuryFunded event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_SETTLEMENT_ADDRESS,
        abi: GAME_SETTLEMENT_ABI,
        eventName: "SessionStarted",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.player;
              const sessionId = log.args.sessionId;
              if (!walletAddress || !sessionId || log.args.stakeAmount === undefined) return;
              await ensurePlayer(walletAddress);
              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "SESSION_STARTED",
                amount: unitsToToken(log.args.stakeAmount),
                onchainSessionId: sessionId,
              });
            })().catch((err) => console.error("❌ Failed to handle SessionStarted event:", err));
          }
        },
      }),
      publicClient.watchContractEvent({
        address: GAME_SETTLEMENT_ADDRESS,
        abi: GAME_SETTLEMENT_ABI,
        eventName: "SessionSettled",
        onLogs: (logs) => {
          for (const log of logs) {
            void (async () => {
              const walletAddress = log.args.player;
              const sessionId = log.args.sessionId;
              const outcome = log.args.outcome;
              if (
                !walletAddress ||
                !sessionId ||
                outcome === undefined ||
                log.args.payoutAmount === undefined ||
                log.args.finalMultiplierBp === undefined
              ) {
                return;
              }
              await ensurePlayer(walletAddress);

              await supabase
                .from("game_sessions")
                .update({
                  settlement_tx_hash: txHash(log),
                  final_multiplier: Number(log.args.finalMultiplierBp) / 10_000,
                  payout_amount: unitsToToken(log.args.payoutAmount),
                  status: outcome === 1 ? "CASHED_OUT" : "CRASHED",
                })
                .eq("wallet_address", walletAddress)
                .eq("onchain_session_id", sessionId);

              await logTransaction({
                txHash: txHash(log),
                walletAddress,
                type: "SESSION_SETTLED",
                amount: unitsToToken(log.args.payoutAmount),
                onchainSessionId: sessionId,
              });
            })().catch((err) => console.error("❌ Failed to handle SessionSettled event:", err));
          }
        },
      }),
    ];

    if (FAUCET_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000") {
      unwatchers.push(
        publicClient.watchContractEvent({
          address: FAUCET_CONTRACT_ADDRESS,
          abi: FAUCET_ABI,
          eventName: "Claimed",
          onLogs: (logs) => {
            for (const log of logs) {
              void (async () => {
                const walletAddress = log.args.account;
                if (!walletAddress || log.args.amount === undefined) return;
                await ensurePlayer(walletAddress);
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "DEPOSIT",
                  amount: unitsToToken(log.args.amount),
                });
              })().catch((err) => console.error("❌ Failed to handle Faucet Claimed event:", err));
            }
          },
        }),
      );
    }

    if (isTicketVaultConfigured()) {
      unwatchers.push(
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketClaimed",
          onLogs: (logs) => {
            for (const log of logs) {
              void handleTicketClaimedLog(log).catch((err) =>
                console.error("❌ Failed to handle TicketClaimed event:", err),
              );
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketPurchased",
          onLogs: (logs) => {
            for (const log of logs) {
              void handleTicketPurchasedLog(log).catch((err) =>
                console.error("❌ Failed to handle TicketPurchased event:", err),
              );
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketCredited",
          onLogs: (logs) => {
            for (const log of logs) {
              void handleTicketCreditedLog(log).catch((err) =>
                console.error("❌ Failed to handle TicketCredited event:", err),
              );
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketSpent",
          onLogs: (logs) => {
            for (const log of logs) {
              void handleTicketSpentLog(log).catch((err) =>
                console.error("❌ Failed to handle TicketSpent event:", err),
              );
            }
          },
        }),
      );

      // Catch up on everything that landed while this process was down, then
      // keep re-checking: a dropped RPC filter is silent, and a claim the
      // watcher never sees is a player whose tickets never arrive.
      void backfillTicketEvents().catch((err) =>
        console.error("❌ Initial ticket backfill failed:", err),
      );
      backfillTimer = setInterval(() => {
        void backfillTicketEvents().catch((err) =>
          console.error("❌ Periodic ticket backfill failed:", err),
        );
      }, BACKFILL_INTERVAL_MS);
    }

    isListening = true;
    console.log("✅ Celo event listener active");
  } catch (err) {
    console.error("❌ Failed to start Celo event listener:", err);
    console.log("   Backend will continue without blockchain events.");
  }
}

export async function stopBlockchainListener(): Promise<void> {
  for (const unwatch of unwatchers) {
    try {
      unwatch();
    } catch (err) {
      console.error("⚠️  Error removing event listener:", err);
    }
  }
  unwatchers = [];
  if (backfillTimer) {
    clearInterval(backfillTimer);
    backfillTimer = null;
  }
  isListening = false;
}

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
              void (async () => {
                const walletAddress = log.args.user;
                const dayIndex = log.args.dayIndex;
                if (!walletAddress || dayIndex === undefined || log.args.amount === undefined) return;
                await ensurePlayer(walletAddress);
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "TICKET_CLAIM",
                  amount: Number(log.args.amount),
                });
                await applyTicketMirrorDelta(
                  walletAddress,
                  BigInt(log.args.amount),
                  log.blockNumber ?? null,
                );
                await advanceDailyStreak(walletAddress, Number(dayIndex));
              })().catch((err) => console.error("❌ Failed to handle TicketClaimed event:", err));
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketPurchased",
          onLogs: (logs) => {
            for (const log of logs) {
              void (async () => {
                const walletAddress = log.args.user;
                if (!walletAddress || log.args.tickets === undefined) return;
                await ensurePlayer(walletAddress);
                // `amount` recorded here is the ticket count granted (not the
                // USD spent or on-chain token cost), to stay consistent with
                // the ticket-count semantics used by TICKET_CLAIM/CREDIT/SPEND.
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "TICKET_PURCHASE",
                  amount: Number(log.args.tickets),
                });
                await applyTicketMirrorDelta(
                  walletAddress,
                  BigInt(log.args.tickets),
                  log.blockNumber ?? null,
                );
              })().catch((err) => console.error("❌ Failed to handle TicketPurchased event:", err));
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketCredited",
          onLogs: (logs) => {
            for (const log of logs) {
              void (async () => {
                const walletAddress = log.args.user;
                if (!walletAddress || log.args.amount === undefined) return;
                await ensurePlayer(walletAddress);
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "TICKET_CREDIT",
                  amount: Number(log.args.amount),
                });
                await applyTicketMirrorDelta(
                  walletAddress,
                  BigInt(log.args.amount),
                  log.blockNumber ?? null,
                );
              })().catch((err) => console.error("❌ Failed to handle TicketCredited event:", err));
            }
          },
        }),
        publicClient.watchContractEvent({
          address: TICKET_VAULT_ADDRESS,
          abi: TICKET_VAULT_ABI,
          eventName: "TicketSpent",
          onLogs: (logs) => {
            for (const log of logs) {
              void (async () => {
                const walletAddress = log.args.user;
                if (!walletAddress || log.args.amount === undefined) return;
                await ensurePlayer(walletAddress);
                // KOREKSI SC: hanya catat riwayat transaksi. JANGAN apply
                // mirror delta di sini — settlement spendBatch direkonsiliasi
                // oleh spendBatchExecutor, bukan lewat event TicketSpent.
                await logTransaction({
                  txHash: txHash(log),
                  walletAddress,
                  type: "TICKET_SPEND",
                  amount: Number(log.args.amount),
                });
              })().catch((err) => console.error("❌ Failed to handle TicketSpent event:", err));
            }
          },
        }),
      );
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
  isListening = false;
}

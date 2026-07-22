import { encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  TICKET_VAULT_ABI,
  TICKET_VAULT_ADDRESS,
  getOperatorAccount,
  getOperatorWalletClient,
  isOperatorConfigured,
  isTicketVaultConfigured,
  publicClient,
  readIsRegisteredOperator,
  readOperatorCeloBalance,
} from "../lib/celo.js";

const MAX_PER_BATCH = 100;
const MAX_PENDING_PER_TICK = 100;

export interface RewardRow {
  wallet_address: string;
  ticket_reward: number;
}

interface PendingSeasonPointRow extends RewardRow {
  season_id: number | string;
}

/**
 * Pure, unit-testable batching logic: drop zero/negative rewards and split
 * the remainder into chunks of at most `maxPerBatch` entries so a single
 * on-chain `creditBatch` call never exceeds gas/array-size expectations.
 */
export function chunkRewards(
  rows: RewardRow[],
  maxPerBatch = MAX_PER_BATCH
): Array<{ users: string[]; amounts: bigint[] }> {
  const filtered = rows.filter((row) => row.ticket_reward > 0);
  const batches: Array<{ users: string[]; amounts: bigint[] }> = [];

  for (let i = 0; i < filtered.length; i += maxPerBatch) {
    const slice = filtered.slice(i, i + maxPerBatch);
    batches.push({
      users: slice.map((row) => row.wallet_address),
      amounts: slice.map((row) => BigInt(row.ticket_reward)),
    });
  }

  return batches;
}

let loggedSkip = false;

/**
 * Recovers any batch that was signed + tagged with a tx hash on a previous
 * tick but never confirmed (e.g. the process crashed between "write hash to
 * DB" and "the tx actually landing"). Never re-signs or re-broadcasts a
 * tagged batch - only observes the chain and reconciles DB status.
 */
async function recoverInFlightBatches(): Promise<void> {
  const { data: rows, error } = await supabase
    .from("season_points")
    .select("season_id, wallet_address, reward_tx_hash")
    .eq("reward_status", "PENDING")
    .not("reward_tx_hash", "is", null);

  if (error) {
    console.error("[RewardBatchExecutor] Failed to query in-flight batches:", error);
    return;
  }
  if (!rows || rows.length === 0) return;

  const uniqueHashes = Array.from(new Set(rows.map((r) => String(r.reward_tx_hash))));

  for (const hash of uniqueHashes) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });

      if (receipt.status === "success") {
        const { error: updErr } = await supabase
          .from("season_points")
          .update({ reward_status: "CREDITED" })
          .eq("reward_status", "PENDING")
          .eq("reward_tx_hash", hash);
        if (updErr) {
          console.error(`[RewardBatchExecutor] Failed to mark batch ${hash} CREDITED:`, updErr);
        } else {
          console.log(`[RewardBatchExecutor] Recovered in-flight batch ${hash} -> CREDITED.`);
        }
      } else {
        // Reverted on-chain. Do NOT auto-retry (would risk double-crediting
        // if the revert reason is wrong) - flag loudly for manual review.
        console.error(
          `[RewardBatchExecutor] CRITICAL: batch tx ${hash} reverted on-chain. Manual intervention required - reward_tx_hash left in place, rows still PENDING.`
        );
      }
    } catch {
      // No receipt yet. Check whether it's still pending in the mempool.
      try {
        const tx = await publicClient.getTransaction({ hash: hash as Hex });
        if (tx) {
          // Still in-flight - wait for the next tick.
          continue;
        }
      } catch {
        // getTransaction also failed to find it -> tx is gone.
        console.error(
          `[RewardBatchExecutor] CRITICAL: batch tx ${hash} not found on-chain or in mempool (dropped). ` +
            `Manual intervention required - JANGAN auto-retry (risiko kredit ganda). Rows left PENDING with hash intact.`
        );
      }
    }
  }
}

/**
 * Signs and (only after persisting the resulting hash) broadcasts a single
 * creditBatch transaction for up to MAX_PENDING_PER_TICK pending reward rows.
 *
 * Idempotency design (core of this module): the tx is prepared and signed
 * locally first, WITHOUT being broadcast. The resulting tx hash is written to
 * every row in the batch (still status PENDING) before the raw tx is ever
 * sent to the network. If the process crashes at any point after that write,
 * `recoverInFlightBatches` will find the tagged rows on the next tick and
 * reconcile via the receipt - it will never re-sign or re-send the batch,
 * so a reward batch can never be credited twice.
 */
async function processNextBatch(): Promise<void> {
  const { data: pendingRowsRaw, error } = await supabase
    .from("season_points")
    .select("season_id, wallet_address, ticket_reward")
    .eq("reward_status", "PENDING")
    .is("reward_tx_hash", null)
    .limit(MAX_PENDING_PER_TICK);

  if (error) {
    console.error("[RewardBatchExecutor] Failed to query pending rewards:", error);
    return;
  }
  if (!pendingRowsRaw || pendingRowsRaw.length === 0) return;

  const pendingRows = pendingRowsRaw as PendingSeasonPointRow[];

  // One batch per tick is enough for a monthly season reward queue (low
  // volume) - simplicity over throughput. Keep the (season_id, wallet_address)
  // pairs alongside the pure chunk so we can tag the exact rows below -
  // `wallet_address` alone is not a unique key on season_points.
  const filteredRows = pendingRows.filter((row) => row.ticket_reward > 0).slice(0, MAX_PER_BATCH);
  const batches = chunkRewards(filteredRows, MAX_PER_BATCH);
  if (batches.length === 0) return;

  const batch = batches[0];

  const operatorAccount = getOperatorAccount();
  const operatorWalletClient = getOperatorWalletClient();
  if (!operatorAccount || !operatorWalletClient) return; // guarded by caller, but keep TS happy

  // Pre-flight guard: operator must actually be registered on-chain.
  const registered = await readIsRegisteredOperator(operatorAccount.address as Address);
  if (!registered) {
    console.error(
      `[RewardBatchExecutor] Operator ${operatorAccount.address} belum didaftarkan via setOperator - creditBatch akan revert UnauthorizedOperator. Skipping tick.`
    );
    return;
  }

  const balance = await readOperatorCeloBalance();
  if (balance === 0n) {
    console.error(
      `[RewardBatchExecutor] CRITICAL: operator ${operatorAccount.address} has zero CELO balance - cannot pay gas for creditBatch. Skipping tick.`
    );
    return;
  }

  const users = batch.users as Address[];
  const amounts = batch.amounts;

  // 1) Prepare + sign locally. No broadcast yet.
  const request = await operatorWalletClient.prepareTransactionRequest({
    account: operatorAccount,
    chain: operatorWalletClient.chain,
    to: TICKET_VAULT_ADDRESS,
    data: encodeFunctionData({
      abi: TICKET_VAULT_ABI,
      functionName: "creditBatch",
      args: [users, amounts],
    }),
  });

  const serializedTransaction = await operatorWalletClient.signTransaction(request as never);
  const hash = keccak256(serializedTransaction);

  // 2) Persist the hash to every row in this batch BEFORE broadcasting.
  // Filter on the exact (season_id, wallet_address) pairs - wallet_address
  // alone is not a unique key on season_points (PK is season_id+wallet_address),
  // so a plain `.in("wallet_address", ...)` could tag an unrelated season's
  // pending row for the same wallet.
  const pairFilter = filteredRows
    .map((row) => `and(season_id.eq.${row.season_id},wallet_address.eq.${row.wallet_address})`)
    .join(",");
  const { error: tagErr } = await supabase
    .from("season_points")
    .update({ reward_tx_hash: hash })
    .eq("reward_status", "PENDING")
    .is("reward_tx_hash", null)
    .or(pairFilter);
  if (tagErr) {
    console.error("[RewardBatchExecutor] Failed to tag batch with tx hash, aborting broadcast:", tagErr);
    return;
  }

  // 3) Only now broadcast. If this (or the wait below) crashes, the next
  // tick's recovery step will find the tagged rows and reconcile safely.
  try {
    await publicClient.sendRawTransaction({ serializedTransaction });
  } catch (broadcastErr) {
    console.error(
      `[RewardBatchExecutor] Broadcast failed for tagged batch ${hash}. Recovery will reconcile next tick:`,
      broadcastErr
    );
    return;
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      const { error: updErr } = await supabase
        .from("season_points")
        .update({ reward_status: "CREDITED" })
        .eq("reward_status", "PENDING")
        .eq("reward_tx_hash", hash);
      if (updErr) {
        console.error(`[RewardBatchExecutor] Failed to mark batch ${hash} CREDITED:`, updErr);
      } else {
        console.log(`[RewardBatchExecutor] creditBatch ${hash} confirmed for ${users.length} users.`);
      }
    } else {
      console.error(
        `[RewardBatchExecutor] CRITICAL: creditBatch ${hash} reverted on-chain. Manual intervention required.`
      );
    }
  } catch (waitErr) {
    // Receipt wait itself failed/timed out - leave the hash in place;
    // recovery will pick it up and reconcile on a later tick.
    console.error(`[RewardBatchExecutor] Failed waiting for receipt of ${hash}:`, waitErr);
  }
}

export function startRewardBatchWorker(): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      if (!isTicketVaultConfigured() || !isOperatorConfigured()) {
        if (!loggedSkip) {
          console.log(
            "🎟️  Reward-batch worker skipped: TICKET_VAULT_ADDRESS or OPERATOR_PRIVATE_KEY not configured."
          );
          loggedSkip = true;
        }
        return;
      }

      // Step 1: reconcile any batch tagged but not yet confirmed before
      // touching new work.
      await recoverInFlightBatches();

      // Step 2: sign, tag, and broadcast the next pending batch (if any).
      await processNextBatch();
    } catch (err) {
      console.error("[RewardBatchExecutor] Error during tick:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(tick, env.REWARD_BATCH_TICK_MS);

  console.log("🎟️  Reward-batch worker started.");
}

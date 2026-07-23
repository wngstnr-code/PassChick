import { encodeFunctionData, keccak256, type Address, type Hex } from "viem";
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

const MAX_PER_BATCH = 200;
const MAX_PENDING_PER_TICK = 200;

// Sentinel written to `reconciled_tx_hash` for SPEND/REFUND pairs that net
// to zero off-chain and therefore must never be pushed on-chain. Not a real
// tx hash - just a marker so these rows stop showing up as "pending".
export const NET_ZERO_SENTINEL = "net-zero-refund";

export interface TicketLedgerRow {
  id: number | string;
  wallet_address: string;
  kind: "SPEND" | "REFUND";
  amount: number;
  session_id: string;
  reconciled_tx_hash: string | null;
}

export interface NettingResult {
  /** SPEND rows (one per session) that still need to be pushed on-chain. */
  spendableRows: TicketLedgerRow[];
  /** ids of SPEND+REFUND rows that net to zero and should be sentinel-stamped. */
  netZeroIds: Array<number | string>;
}

/**
 * Pure netting logic: given all unreconciled ticket_ledger rows for a set of
 * sessions, drop any session that has BOTH a SPEND and a REFUND (net-zero -
 * nothing to settle on-chain) and collect the ids of those rows so the
 * caller can stamp them with the net-zero sentinel. Sessions with only a
 * SPEND (no REFUND) are returned as still-spendable.
 */
export function nettRows(rows: TicketLedgerRow[]): NettingResult {
  const bySession = new Map<string, TicketLedgerRow[]>();
  for (const row of rows) {
    const list = bySession.get(row.session_id) ?? [];
    list.push(row);
    bySession.set(row.session_id, list);
  }

  const spendableRows: TicketLedgerRow[] = [];
  const netZeroIds: Array<number | string> = [];

  for (const sessionRows of bySession.values()) {
    const hasRefund = sessionRows.some((r) => r.kind === "REFUND");
    if (hasRefund) {
      for (const r of sessionRows) netZeroIds.push(r.id);
      continue;
    }
    for (const r of sessionRows) {
      if (r.kind === "SPEND") spendableRows.push(r);
    }
  }

  return { spendableRows, netZeroIds };
}

export interface AggregatedSpend {
  wallet_address: string;
  amount: number;
}

/**
 * Aggregates a set of (already-netted) SPEND rows by wallet_address, summing
 * amounts. Order of output follows first-seen wallet order.
 */
export function aggregateSpendByWallet(rows: TicketLedgerRow[]): AggregatedSpend[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.wallet_address, (totals.get(row.wallet_address) ?? 0) + row.amount);
  }
  return Array.from(totals.entries()).map(([wallet_address, amount]) => ({
    wallet_address,
    amount,
  }));
}

/**
 * Pure, unit-testable batching logic: split aggregated per-wallet spend
 * amounts into chunks of at most `maxPerBatch` entries so a single on-chain
 * `spendBatch` call never exceeds gas/array-size expectations.
 */
export function chunkSpends(
  rows: AggregatedSpend[],
  maxPerBatch = MAX_PER_BATCH
): Array<{ users: string[]; amounts: bigint[] }> {
  const filtered = rows.filter((row) => row.amount > 0);
  const batches: Array<{ users: string[]; amounts: bigint[] }> = [];

  for (let i = 0; i < filtered.length; i += maxPerBatch) {
    const slice = filtered.slice(i, i + maxPerBatch);
    batches.push({
      users: slice.map((row) => row.wallet_address),
      amounts: slice.map((row) => BigInt(row.amount)),
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
    .from("ticket_ledger")
    .select("reconciled_tx_hash")
    .eq("kind", "SPEND")
    .not("reconciled_tx_hash", "is", null)
    .neq("reconciled_tx_hash", NET_ZERO_SENTINEL);

  if (error) {
    console.error("[SpendBatchExecutor] Failed to query in-flight batches:", error);
    return;
  }
  if (!rows || rows.length === 0) return;

  const uniqueHashes = Array.from(
    new Set(rows.map((r) => String(r.reconciled_tx_hash)))
  ).filter((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash));

  for (const hash of uniqueHashes) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });

      if (receipt.status === "success") {
        console.log(`[SpendBatchExecutor] Recovered in-flight batch ${hash} -> confirmed.`);
        // Row already carries the tx hash - nothing more to stamp. Kept for
        // symmetry with rewardBatchExecutor's recovery log.
      } else {
        // Reverted on-chain. Do NOT auto-retry (would risk double-debiting
        // if the revert reason is wrong) - flag loudly for manual review.
        console.error(
          `[SpendBatchExecutor] CRITICAL: batch tx ${hash} reverted on-chain. Manual intervention required - reconciled_tx_hash left in place.`
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
          `[SpendBatchExecutor] CRITICAL: batch tx ${hash} not found on-chain or in mempool (dropped). ` +
            `Manual intervention required - JANGAN auto-retry (risiko debit ganda). Rows left tagged with hash intact.`
        );
      }
    }
  }
}

/**
 * Finds unreconciled sessions that have both a SPEND and a REFUND row (net
 * zero) and stamps both rows with the sentinel so they stop showing up as
 * pending work forever.
 */
async function settleNetZeroSessions(): Promise<void> {
  const { data: rowsRaw, error } = await supabase
    .from("ticket_ledger")
    .select("id, wallet_address, kind, amount, session_id, reconciled_tx_hash")
    .is("reconciled_tx_hash", null)
    .limit(MAX_PENDING_PER_TICK * 2);

  if (error) {
    console.error("[SpendBatchExecutor] Failed to query ledger rows for netting:", error);
    return;
  }
  if (!rowsRaw || rowsRaw.length === 0) return;

  const { netZeroIds } = nettRows(rowsRaw as TicketLedgerRow[]);
  if (netZeroIds.length === 0) return;

  const { error: updErr } = await supabase
    .from("ticket_ledger")
    .update({ reconciled_tx_hash: NET_ZERO_SENTINEL })
    .in("id", netZeroIds)
    .is("reconciled_tx_hash", null);

  if (updErr) {
    console.error("[SpendBatchExecutor] Failed to stamp net-zero sessions:", updErr);
    return;
  }
  console.log(`[SpendBatchExecutor] Marked ${netZeroIds.length} net-zero ledger row(s) as settled.`);
}

/**
 * Signs and (only after persisting the resulting hash) broadcasts a single
 * spendBatch transaction for up to MAX_PENDING_PER_TICK pending SPEND rows
 * (after netting out any session that also has a REFUND).
 *
 * Idempotency design (core of this module): the tx is prepared and signed
 * locally first, WITHOUT being broadcast. The resulting tx hash is written
 * to every SPEND row in this batch BEFORE the raw tx is ever sent to the
 * network. If the process crashes at any point after that write,
 * `recoverInFlightBatches` will find the tagged rows on the next tick and
 * reconcile via the receipt - it will never re-sign or re-send the batch,
 * so a spend batch can never be debited twice.
 */
async function processNextBatch(): Promise<void> {
  const { data: pendingRowsRaw, error } = await supabase
    .from("ticket_ledger")
    .select("id, wallet_address, kind, amount, session_id, reconciled_tx_hash")
    .eq("kind", "SPEND")
    .is("reconciled_tx_hash", null)
    .limit(MAX_PENDING_PER_TICK);

  if (error) {
    console.error("[SpendBatchExecutor] Failed to query pending spends:", error);
    return;
  }
  if (!pendingRowsRaw || pendingRowsRaw.length === 0) return;

  const spendRows = pendingRowsRaw as TicketLedgerRow[];

  // Re-check for refunds on these exact sessions to be safe (settleNetZeroSessions
  // already ran this tick, but a REFUND could have landed in between).
  const sessionIds = spendRows.map((r) => r.session_id);
  const { data: refundRowsRaw, error: refundErr } = await supabase
    .from("ticket_ledger")
    .select("id, wallet_address, kind, amount, session_id, reconciled_tx_hash")
    .eq("kind", "REFUND")
    .in("session_id", sessionIds);

  if (refundErr) {
    console.error("[SpendBatchExecutor] Failed to query refund rows:", refundErr);
    return;
  }

  const { spendableRows } = nettRows([...spendRows, ...((refundRowsRaw as TicketLedgerRow[]) ?? [])]);
  if (spendableRows.length === 0) return;

  const aggregated = aggregateSpendByWallet(spendableRows);
  const batches = chunkSpends(aggregated, MAX_PER_BATCH);
  if (batches.length === 0) return;

  const batch = batches[0];
  // Only the ids for wallets included in this first batch need tagging.
  const batchWallets = new Set(batch.users.map((u) => u.toLowerCase()));
  const idsInBatch = spendableRows
    .filter((r) => batchWallets.has(r.wallet_address.toLowerCase()))
    .map((r) => r.id);

  const operatorAccount = getOperatorAccount();
  const operatorWalletClient = getOperatorWalletClient();
  if (!operatorAccount || !operatorWalletClient) return; // guarded by caller, but keep TS happy

  // Pre-flight guard: operator must actually be registered on-chain.
  const registered = await readIsRegisteredOperator(operatorAccount.address as Address);
  if (!registered) {
    console.error(
      `[SpendBatchExecutor] Operator ${operatorAccount.address} belum didaftarkan via setOperator - spendBatch akan revert UnauthorizedOperator. Skipping tick.`
    );
    return;
  }

  const balance = await readOperatorCeloBalance();
  if (balance === 0n) {
    console.error(
      `[SpendBatchExecutor] CRITICAL: operator ${operatorAccount.address} has zero CELO balance - cannot pay gas for spendBatch. Skipping tick.`
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
      functionName: "spendBatch",
      args: [users, amounts],
    }),
  });

  const serializedTransaction = await operatorWalletClient.signTransaction(request as never);
  const hash = keccak256(serializedTransaction);

  // 2) Persist the hash to every row in this batch BEFORE broadcasting.
  const { error: tagErr } = await supabase
    .from("ticket_ledger")
    .update({ reconciled_tx_hash: hash })
    .in("id", idsInBatch)
    .is("reconciled_tx_hash", null);
  if (tagErr) {
    console.error("[SpendBatchExecutor] Failed to tag batch with tx hash, aborting broadcast:", tagErr);
    return;
  }

  // 3) Only now broadcast. If this (or the wait below) crashes, the next
  // tick's recovery step will find the tagged rows and reconcile safely.
  try {
    await publicClient.sendRawTransaction({ serializedTransaction });
  } catch (broadcastErr) {
    console.error(
      `[SpendBatchExecutor] Broadcast failed for tagged batch ${hash}. Recovery will reconcile next tick:`,
      broadcastErr
    );
    return;
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "success") {
      console.log(`[SpendBatchExecutor] spendBatch ${hash} confirmed for ${users.length} wallet(s).`);
    } else {
      console.error(
        `[SpendBatchExecutor] CRITICAL: spendBatch ${hash} reverted on-chain. Manual intervention required.`
      );
    }
  } catch (waitErr) {
    // Receipt wait itself failed/timed out - leave the hash in place;
    // recovery will pick it up and reconcile on a later tick.
    console.error(`[SpendBatchExecutor] Failed waiting for receipt of ${hash}:`, waitErr);
  }
}

const DEFAULT_TICK_MS = 21_600_000; // 6 hours

export function startSpendBatchWorker(): void {
  const tickMs = Number(process.env.SPEND_BATCH_TICK_MS) || DEFAULT_TICK_MS;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      if (!isTicketVaultConfigured() || !isOperatorConfigured()) {
        if (!loggedSkip) {
          console.log(
            "🎫 Spend-batch worker skipped: TICKET_VAULT_ADDRESS or OPERATOR_PRIVATE_KEY not configured."
          );
          loggedSkip = true;
        }
        return;
      }

      // Step 1: reconcile any batch tagged but not yet confirmed before
      // touching new work.
      await recoverInFlightBatches();

      // Step 2: settle net-zero sessions (SPEND+REFUND) so they never get
      // pushed on-chain and never linger as "pending" forever.
      await settleNetZeroSessions();

      // Step 3: sign, tag, and broadcast the next pending batch (if any).
      await processNextBatch();
    } catch (err) {
      console.error("[SpendBatchExecutor] Error during tick:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(tick, tickMs);

  console.log("🎫 Spend-batch worker started.");
}

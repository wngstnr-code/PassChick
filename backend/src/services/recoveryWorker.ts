import { supabase } from "../config/supabase.js";
import { readActiveOnchainSession } from "../lib/celo.js";
import { hasActiveGame } from "./gameState.js";
import { voidAndRefundSession } from "./ticketPlay.js";

/// BE-07 §5: V2 sessions that are ACTIVE in the DB but have no in-memory
/// game state (server restarted mid-run) are orphans. Moves are never
/// persisted mid-run, so an orphan by definition has no recorded progress:
/// void it and refund the ticket. Live sessions (including paused ones
/// waiting on the disconnect grace timer) still have in-memory state and
/// are skipped.
const V2_ORPHAN_TTL_MS = 10 * 60 * 1000;

async function sweepV2Orphans(): Promise<void> {
  const cutoff = new Date(Date.now() - V2_ORPHAN_TTL_MS).toISOString();
  const { data: orphans, error } = await supabase
    .from("game_sessions")
    .select("session_id, wallet_address")
    .eq("status", "ACTIVE")
    .eq("game_mode", "V2_TICKET")
    .lt("created_at", cutoff)
    .limit(20);

  if (error || !orphans) {
    // Quietly skip: before the V2.2 schema is applied this simply errors on
    // the missing game_mode column, which is expected and harmless.
    return;
  }

  for (const orphan of orphans) {
    const walletAddress = String(orphan.wallet_address);
    if (hasActiveGame(walletAddress)) continue;
    await voidAndRefundSession(String(orphan.session_id), walletAddress);
  }
}

export function startRecoveryWorker() {
  const sweepIntervalMs = 60 * 1000; // run every 60 seconds

  setInterval(async () => {
    try {
      await sweepV2Orphans();
    } catch (v2SweepError) {
      console.error("[RecoveryWorker] V2 orphan sweep error:", v2SweepError);
    }

    try {
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();

      // Find recently ended games that supposedly have a settlement transaction
      const { data: sessions, error } = await supabase
        .from("game_sessions")
        .select("session_id, onchain_session_id, wallet_address, status, settlement_tx_hash")
        .in("status", ["CRASHED", "CASHED_OUT"])
        .not("settlement_tx_hash", "is", null)
        .lt("ended_at", twoMinutesAgo)
        .order("ended_at", { ascending: false })
        .limit(30);

      if (error || !sessions) {
        return;
      }

      const checkedWallets = new Set<string>();

      for (const s of sessions) {
        // Skip "already-settled-onchain" or "not-pending-onchain" pseudo-hashes to save RPC calls
        const txHash = String(s.settlement_tx_hash || "");
        if (txHash === "already-settled-onchain" || txHash === "not-pending-onchain") continue;

        if (checkedWallets.has(s.wallet_address)) continue;
        checkedWallets.add(s.wallet_address);

        try {
          const active = await readActiveOnchainSession(s.wallet_address);
          
          // If the on-chain session is exactly the one we think we settled, the tx dropped!
          if (active && active.sessionId.toLowerCase() === String(s.onchain_session_id).toLowerCase()) {
            console.log(`[RecoveryWorker] Found dropped tx for session ${s.onchain_session_id}. Clearing bad tx_hash...`);
            
            await supabase
              .from("game_sessions")
              .update({ settlement_tx_hash: null })
              .eq("session_id", s.session_id);
          }
        } catch (inspectError) {
          // ignore RPC errors during sweep
        }
      }
    } catch (workerError) {
      console.error("[RecoveryWorker] Error during sweep:", workerError);
    }
  }, sweepIntervalMs);

  console.log("🛠️ Auto-recovery worker started.");
}

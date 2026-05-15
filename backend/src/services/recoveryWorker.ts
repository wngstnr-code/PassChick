import { supabase } from "../config/supabase.js";
import { readActiveOnchainSession } from "../lib/celo.js";

export function startRecoveryWorker() {
  const sweepIntervalMs = 60 * 1000; // run every 60 seconds

  setInterval(async () => {
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

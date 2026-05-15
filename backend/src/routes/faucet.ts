import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  readFaucetCooldownForWallet,
  readFaucetStatus,
  requestFaucetForWallet,
} from "../services/faucetService.js";

const router = Router();

function normalizeErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

router.get("/status", requireAuth, (req, res) => {
  const walletAddress = req.walletAddress!;
  const status = readFaucetStatus(walletAddress);

  res.json({
    success: true,
    ...status,
  });
});


router.post("/request", requireAuth, async (req, res) => {
  const walletAddress = req.walletAddress!;
  const status = readFaucetStatus(walletAddress);

  if (!status.enabled) {
    res.status(400).json({
      error:
        "Faucet belum aktif di backend. Set FAUCET_CONTRACT_ADDRESS atau GAME_FAUCET_ADDRESS agar endpoint ini bisa dipakai.",
    });
    return;
  }

  const cooldown = readFaucetCooldownForWallet(walletAddress);
  if (cooldown.remainingSeconds > 0) {
    res.status(429).json({
      error: `Tunggu ${cooldown.remainingSeconds} detik sebelum request faucet lagi.`,
      cooldownSeconds: status.cooldownSeconds,
      remainingSeconds: cooldown.remainingSeconds,
      nextEligibleAt: cooldown.nextEligibleAt,
    });
    return;
  }

  try {
    const result = await requestFaucetForWallet(walletAddress);
    res.json({
      success: true,
      unsignedTx: result.unsignedTx,
      mode: result.mode,
      cooldownSeconds: result.cooldownSeconds,
      nextEligibleAt: result.nextEligibleAt,
    });
  } catch (error) {
    console.error("❌ Faucet request failed:", error);
    res.status(500).json({
      error: normalizeErrorMessage(
        error,
        "Gagal menyiapkan transaksi faucet.",
      ),
    });
  }
});

export default router;

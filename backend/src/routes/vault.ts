import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  buildDepositTransaction,
  buildWithdrawTransaction,
  buildApproveTransaction,
  readPlayerBalance,
  readVaultTokenBalance,
  readWalletTokenBalance,
  readTokenAllowance,
  USDC_ADDRESS,
  GAME_VAULT_ADDRESS,
} from "../lib/celo.js";

const router = Router();

function normalizeErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: string }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

function toUsdcAmountString(units: bigint) {
  const whole = units / 1_000_000n;
  const frac = units % 1_000_000n;
  return `${whole.toString()}.${frac.toString().padStart(6, "0")}`;
}

function parseUsdcAmountUnits(amount: unknown) {
  const raw = String(amount ?? "").trim();
  if (!raw) return null;
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return null;
  const [wholePart, fracPart = ""] = raw.split(".");
  const whole = BigInt(wholePart || "0");
  const fracPadded = (fracPart + "000000").slice(0, 6);
  const frac = BigInt(fracPadded);
  return whole * 1_000_000n + frac;
}

router.get("/status", requireAuth, async (req, res) => {
  try {
    const walletAddress = req.walletAddress!;
    const [playerBalance, walletBalanceUnits, vaultTokenUnits, allowanceUnits] = await Promise.all([
      readPlayerBalance(walletAddress),
      readWalletTokenBalance(walletAddress).catch(() => 0n),
      readVaultTokenBalance().catch(() => 0n),
      readTokenAllowance(walletAddress, GAME_VAULT_ADDRESS).catch(() => 0n),
    ]);

    const availableUnits = BigInt(playerBalance?.availableBalance ?? 0n);
    const lockedUnits = BigInt(playerBalance?.lockedBalance ?? 0n);

    res.json({
      success: true,
      walletAddress,
      mint: USDC_ADDRESS,
      walletBalance: toUsdcAmountString(walletBalanceUnits),
      availableBalance: toUsdcAmountString(availableUnits),
      lockedBalance: toUsdcAmountString(lockedUnits),
      vaultTokenBalance: toUsdcAmountString(vaultTokenUnits),
      allowanceUnits: allowanceUnits.toString(),
      raw: {
        walletBalanceUnits: walletBalanceUnits.toString(),
        availableBalanceUnits: availableUnits.toString(),
        lockedBalanceUnits: lockedUnits.toString(),
        vaultTokenBalanceUnits: vaultTokenUnits.toString(),
        allowanceUnits: allowanceUnits.toString(),
      },
    });
  } catch (error) {
    console.error("❌ Vault status failed:", error);
    res.status(500).json({
      error: normalizeErrorMessage(error, "Failed to read vault status."),
    });
  }
});

router.post("/approve", requireAuth, async (req, res) => {
  try {
    const walletAddress = req.walletAddress!;

    const unsignedTx = await buildApproveTransaction(walletAddress, GAME_VAULT_ADDRESS);
    res.json({
      success: true,
      mode: "approve",
      unsignedTx,
    });
  } catch (error) {
    console.error("❌ Vault approve tx build failed:", error);
    res.status(500).json({
      error: normalizeErrorMessage(error, "Failed to build approve transaction."),
    });
  }
});

router.post("/deposit", requireAuth, async (req, res) => {
  try {
    const walletAddress = req.walletAddress!;
    const amountUnits = parseUsdcAmountUnits((req.body as { amount?: string }).amount);
    if (!amountUnits || amountUnits <= 0n) {
      res.status(400).json({ error: "Invalid deposit amount." });
      return;
    }

    const unsignedTx = await buildDepositTransaction(walletAddress, amountUnits);
    res.json({
      success: true,
      mode: "deposit",
      unsignedTx,
      amount: toUsdcAmountString(amountUnits),
      amountUnits: amountUnits.toString(),
    });
  } catch (error) {
    console.error("❌ Vault deposit tx build failed:", error);
    res.status(500).json({
      error: normalizeErrorMessage(error, "Failed to build deposit transaction."),
    });
  }
});

router.post("/withdraw", requireAuth, async (req, res) => {
  try {
    const walletAddress = req.walletAddress!;
    const amountUnits = parseUsdcAmountUnits((req.body as { amount?: string }).amount);
    if (!amountUnits || amountUnits <= 0n) {
      res.status(400).json({ error: "Invalid withdraw amount." });
      return;
    }

    const unsignedTx = await buildWithdrawTransaction(walletAddress, amountUnits);
    res.json({
      success: true,
      mode: "withdraw",
      unsignedTx,
      amount: toUsdcAmountString(amountUnits),
      amountUnits: amountUnits.toString(),
    });
  } catch (error) {
    console.error("❌ Vault withdraw tx build failed:", error);
    res.status(500).json({
      error: normalizeErrorMessage(error, "Failed to build withdraw transaction."),
    });
  }
});

export default router;

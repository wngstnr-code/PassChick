import { env } from "../config/env.js";
import { buildClaimFaucetTransaction, FAUCET_CONTRACT_ADDRESS, normalizePlayerAddress } from "../lib/celo.js";

const lastFaucetAtMsByWallet = new Map<string, number>();

type FaucetMode = "claim";

function readFaucetMode(): FaucetMode {
  return "claim";
}

function readCooldownMs() {
  return Math.max(0, env.FAUCET_COOLDOWN_SECONDS) * 1000;
}

function formatTokenAmount(unitsValue: string) {
  const units = BigInt(unitsValue || "0");
  const decimals = Math.max(0, env.TOKEN_DECIMALS);
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const frac = units % divisor;

  if (decimals === 0) {
    return whole.toString();
  }

  return `${whole.toString()}.${frac.toString().padStart(decimals, "0")}`;
}

export function isFaucetConfigured() {
  return FAUCET_CONTRACT_ADDRESS !== "0x0000000000000000000000000000000000000000";
}

export function readFaucetStatus(walletAddress?: string) {
  const now = Date.now();
  const cooldownMs = readCooldownMs();
  const normalizedWallet = String(walletAddress || "").trim();
  const lastRequestedAt = normalizedWallet
    ? (lastFaucetAtMsByWallet.get(normalizedWallet.toLowerCase()) ?? 0)
    : 0;
  const nextEligibleAtMs = lastRequestedAt + cooldownMs;
  const remainingMs =
    normalizedWallet && cooldownMs > 0 && nextEligibleAtMs > now
      ? nextEligibleAtMs - now
      : 0;

  return {
    enabled: isFaucetConfigured(),
    mode: readFaucetMode(),
    amount: formatTokenAmount(env.FAUCET_AMOUNT_UNITS),
    amountUnits: env.FAUCET_AMOUNT_UNITS,
    cooldownSeconds: Math.floor(cooldownMs / 1000),
    remainingSeconds: Math.ceil(remainingMs / 1000),
    nextEligibleAt:
      remainingMs > 0 ? new Date(nextEligibleAtMs).toISOString() : null,
  };
}

function ensureFaucetReady() {
  if (!isFaucetConfigured()) {
    throw new Error(
      "Faucet belum dikonfigurasi di backend. Set FAUCET_CONTRACT_ADDRESS atau GAME_FAUCET_ADDRESS terlebih dahulu.",
    );
  }
}

export function readFaucetCooldownForWallet(walletAddress: string) {
  const status = readFaucetStatus(walletAddress);
  return {
    remainingSeconds: status.remainingSeconds,
    nextEligibleAt: status.nextEligibleAt,
  };
}

function markFaucetRequested(walletAddress: string) {
  lastFaucetAtMsByWallet.set(walletAddress.toLowerCase(), Date.now());
}

export async function requestFaucetForWallet(walletAddress: string) {
  ensureFaucetReady();
  const player = normalizePlayerAddress(walletAddress);
  const unsignedTx = await buildClaimFaucetTransaction(player);

  markFaucetRequested(player);
  const nextStatus = readFaucetStatus(player);

  return {
    unsignedTx,
    mode: nextStatus.mode,
    cooldownSeconds: nextStatus.cooldownSeconds,
    nextEligibleAt: nextStatus.nextEligibleAt,
  };
}

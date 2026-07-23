import { normalizeEvmAddress, type EvmAddress } from "../tickets/domain.ts";

export const DAILY_CLAIM_TTL_SECONDS = 600;

const REWARD_SCHEDULE = [
  { rewardKind: "fixed", baseTickets: 5n },
  { rewardKind: "mystery", baseTickets: null },
  { rewardKind: "fixed", baseTickets: 7n },
  { rewardKind: "mystery", baseTickets: null },
  { rewardKind: "fixed", baseTickets: 9n },
  { rewardKind: "mystery", baseTickets: null },
  { rewardKind: "fixed", baseTickets: 10n },
] as const;

export type RewardDay = {
  day: number;
  rewardKind: "fixed" | "mystery";
  baseTickets: bigint | null;
  state: "claimed" | "current" | "locked";
};

export type DailyClaimMessage = {
  user: EvmAddress;
  dayIndex: number;
  amount: number;
  issuedAt: number;
  nonce: bigint;
};

export type SignedDailyClaim = {
  claim: DailyClaimMessage;
  signature: `0x${string}`;
  expiresAtMs: number;
};

export type DailyClaimErrorState = {
  message: string;
  recoverable: boolean;
  refreshRequired: boolean;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, label: string, min: number, max: number) {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return Number((error as { code?: unknown }).code);
}

function readErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; shortMessage?: unknown; details?: unknown };
    return [candidate.shortMessage, candidate.message, candidate.details]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return "";
}

export function buildRewardWeek(input: {
  streakDay: number;
  claimable: boolean;
}): RewardDay[] {
  const currentDay = Math.min(7, Math.max(1, Math.trunc(input.streakDay || 1)));
  return REWARD_SCHEDULE.map((reward, index) => {
    const day = index + 1;
    const claimedThrough = input.claimable ? currentDay - 1 : currentDay;
    return {
      day,
      ...reward,
      state: day <= claimedThrough ? "claimed" : day === currentDay ? "current" : "locked",
    };
  });
}

export function formatClaimCountdown(targetMs: number | null, nowMs = Date.now()) {
  if (targetMs === null || !Number.isFinite(targetMs)) return "--:--:--";
  const remainingSeconds = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  if (remainingSeconds === 0) return "READY";
  const hours = Math.floor(remainingSeconds / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function parseSignedDailyClaim(
  payload: unknown,
  context: { account: string; nowMs?: number },
): SignedDailyClaim {
  const root = requireRecord(payload, "Signed daily claim response");
  if (root.success === false) throw new Error("Backend refused to issue a daily claim.");
  const claim = requireRecord(root.claim, "Daily claim");
  const account = normalizeEvmAddress(context.account);
  const user = normalizeEvmAddress(typeof claim.user === "string" ? claim.user : "");
  if (!account || !user || user !== account) {
    throw new Error("Daily claim does not belong to the connected wallet.");
  }

  const dayIndex = requireInteger(claim.dayIndex, "Daily claim day index", 0, 0xffff_ffff);
  const amount = requireInteger(claim.amount, "Daily claim amount", 1, 100);
  const issuedAt = requireInteger(claim.issuedAt, "Daily claim issue time", 0, Number.MAX_SAFE_INTEGER);
  const nowMs = context.nowMs ?? Date.now();
  if (issuedAt * 1000 > nowMs) throw new Error("Daily claim was issued in the future.");
  const expiresAtMs = (issuedAt + DAILY_CLAIM_TTL_SECONDS) * 1000;
  if (expiresAtMs <= nowMs) throw new Error("Daily claim signature has expired. Request a fresh reward.");

  let nonce: bigint;
  try {
    nonce = BigInt(claim.nonce as string | number | bigint);
  } catch {
    throw new TypeError("Daily claim nonce is invalid.");
  }
  if (nonce < 0n || nonce >= 2n ** 256n) throw new RangeError("Daily claim nonce is outside uint256.");

  const signature = typeof root.signature === "string" ? root.signature : "";
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    throw new TypeError("Daily claim signature is invalid.");
  }

  return {
    claim: { user, dayIndex, amount, issuedAt, nonce },
    signature: signature as `0x${string}`,
    expiresAtMs,
  };
}

export function classifyDailyClaimError(error: unknown): DailyClaimErrorState {
  if (readErrorCode(error) === 4001) {
    return {
      message: "Claim cancelled. You can try again when you're ready.",
      recoverable: true,
      refreshRequired: false,
    };
  }

  const message = readErrorText(error);
  if (/DayAlreadyClaimed/i.test(message)) {
    return {
      message: "Today's reward is already claimed. Your balance is refreshing.",
      recoverable: true,
      refreshRequired: true,
    };
  }
  if (/NonceAlreadyUsed/i.test(message)) {
    return {
      message: "This reward request was already used. Refreshing your reward status.",
      recoverable: true,
      refreshRequired: true,
    };
  }
  if (/expired|DailyClaimExpired/i.test(message)) {
    return {
      message: "The reward request expired. Try again to get a fresh one.",
      recoverable: true,
      refreshRequired: false,
    };
  }
  if (/confirmation timed out/i.test(message)) {
    return {
      message: "Confirmation is taking longer than expected. Your reward status is refreshing.",
      recoverable: true,
      refreshRequired: true,
    };
  }
  if (/backend|fetch|network|timeout|session/i.test(message)) {
    return {
      message: message || "Daily rewards are temporarily unavailable. Please try again.",
      recoverable: true,
      refreshRequired: false,
    };
  }
  return {
    message: message || "Reward claim failed. Please try again.",
    recoverable: true,
    refreshRequired: false,
  };
}

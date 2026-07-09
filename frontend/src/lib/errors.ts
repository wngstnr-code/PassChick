type ErrorWithMeta = {
  message?: string;
  shortMessage?: string;
  name?: string;
};

type UserFacingErrorOptions = {
  userRejectedMessage?: string;
  pendingRequestMessage?: string;
  insufficientFundsMessage?: string;
  networkMessage?: string;
};

const USER_REJECTED_PATTERNS = [
  "userrejectedrequesterror",
  "user rejected",
  "rejected the request",
  "user denied",
  "rejected by user",
  "user rejected the request",
];

const PENDING_REQUEST_PATTERNS = [
  "already pending",
  "pending request",
  "request of type",
  "user is already processing",
];

const INSUFFICIENT_FUNDS_PATTERNS = [
  "insufficient funds",
  "gas required exceeds allowance",
  "intrinsic gas too low",
  "exceeds allowance",
];

const NETWORK_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "network error",
  "network request failed",
  "timeout",
  "timed out",
  "disconnected",
  "connection closed",
  "socket hang up",
  "rpc",
];

const LONG_ERROR_MARKERS = [
  "details:",
  "request arguments:",
  "request body:",
  "url:",
  "version:",
];

function includesAny(target: string, patterns: string[]) {
  return patterns.some((pattern) => target.includes(pattern));
}

function readErrorName(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as ErrorWithMeta).name || "").trim();
  }
  return "";
}

function simplifyRawErrorMessage(message: string) {
  let simplified = String(message || "").trim();
  if (!simplified) return "";

  simplified = simplified.split(/\r?\n/)[0]?.trim() || "";
  for (const marker of ["Details:", "Request Arguments:", "Request body:", "URL:", "Version:"]) {
    const index = simplified.indexOf(marker);
    if (index >= 0) {
      simplified = simplified.slice(0, index).trim();
    }
  }

  simplified = simplified.replace(/^execution reverted:?\s*/i, "").trim();
  return simplified;
}

export function readRawErrorMessage(error: unknown, fallback = "") {
  if (typeof error === "string") {
    return error.trim() || fallback;
  }

  if (error && typeof error === "object") {
    const value = error as ErrorWithMeta;
    const shortMessage = String(value.shortMessage || "").trim();
    if (shortMessage) return shortMessage;

    const message = String(value.message || "").trim();
    if (message) return message;
  }

  return fallback;
}

export function isUserRejectedWalletError(error: unknown) {
  const combined = `${readErrorName(error)} ${readRawErrorMessage(error, "")}`.toLowerCase();
  return includesAny(combined, USER_REJECTED_PATTERNS);
}

export function toUserFacingWalletError(
  error: unknown,
  fallback: string,
  options: UserFacingErrorOptions = {},
) {
  const rawMessage = readRawErrorMessage(error, fallback).trim();
  if (!rawMessage) return fallback;

  const combined = `${readErrorName(error)} ${rawMessage}`.toLowerCase();
  if (isUserRejectedWalletError(error)) {
    return options.userRejectedMessage || "Request was canceled in wallet.";
  }

  if (includesAny(combined, PENDING_REQUEST_PATTERNS)) {
    return (
      options.pendingRequestMessage ||
      "There is still a pending wallet request."
    );
  }

  if (includesAny(combined, INSUFFICIENT_FUNDS_PATTERNS)) {
    return (
      options.insufficientFundsMessage ||
      "Network fee balance is insufficient for this transaction."
    );
  }

  if (includesAny(combined, NETWORK_PATTERNS)) {
    return (
      options.networkMessage ||
      "Wallet or RPC connection is unstable. Please try again."
    );
  }

  const simplified = simplifyRawErrorMessage(rawMessage);
  if (!simplified) return fallback;

  if (simplified.length <= 140 && !includesAny(simplified.toLowerCase(), LONG_ERROR_MARKERS)) {
    return simplified;
  }

  return fallback;
}

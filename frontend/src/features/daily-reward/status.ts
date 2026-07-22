import type { DailyClaimStatus } from "../tickets/domain.ts";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function requireInteger(value: unknown, label: string, min: number, max: number) {
  const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed;
}

function parseTicketAmount(value: unknown, label: string) {
  try {
    const amount = BigInt(value as string | number | bigint);
    if (amount < 0n || amount > 100n) throw new Error();
    return amount;
  } catch {
    throw new TypeError(`${label} is invalid.`);
  }
}

function parseNextClaimAt(value: unknown) {
  if (value === null) return null;
  return requireInteger(value, "Next claim time", 0, Number.MAX_SAFE_INTEGER);
}

function parseOptionalBoolean(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid.`);
  return value;
}

export function parseDailyClaimStatus(payload: unknown): DailyClaimStatus {
  const root = requireRecord(payload, "Daily reward response");
  if (root.success === false) throw new Error("Backend refused the daily reward status request.");
  const status = root.status === undefined ? root : requireRecord(root.status, "Daily reward status");
  if (typeof status.claimable !== "boolean") throw new TypeError("Daily reward claimable state is invalid.");
  const passportPerkApplied = parseOptionalBoolean(
    status.passportPerkApplied,
    "Passport perk state",
  );

  return {
    claimable: status.claimable,
    streakDay: requireInteger(status.streakDay, "Daily reward streak", 1, 7),
    nextClaimAtMs: parseNextClaimAt(status.nextClaimAtMs),
    expectedTickets: parseTicketAmount(status.expectedTickets, "Expected ticket amount"),
    passportPerkApplied,
    passportBonusTickets:
      status.passportBonusTickets === undefined
        ? undefined
        : parseTicketAmount(status.passportBonusTickets, "Passport bonus"),
  };
}

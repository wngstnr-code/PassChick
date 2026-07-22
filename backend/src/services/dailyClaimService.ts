import { randomInt } from "node:crypto";

/// Pure, unit-testable logic backing the TicketVault daily-claim flow
/// (update_v2.md §3, §7.2). Kept free of DB/chain I/O so it can be tested
/// in isolation; routes/blockchainListener wire this up to Supabase and viem.

/// `dayIndex` on the TicketVault contract is the number of UTC days since
/// the Unix epoch (`floor(unixSeconds / 86400)`) - a monotonically
/// increasing counter, NOT the 1-7 streak cycle below. Conflating the two
/// would make `dayIndex` non-monotonic and permanently break claiming after
/// day 7 (HANDOFF_V2.md §2.2).
const SECONDS_PER_DAY = 86400;

export function utcDayIndex(date: Date): number {
  return Math.floor(date.getTime() / 1000 / SECONDS_PER_DAY);
}

/// Daily reward schedule, update_v2.md §3. `null` amount marks a "mystery
/// box" day whose amount is rolled randomly in [1, 10] at claim time.
export type DailyRewardSpec = { amount: number } | { box: true };

export const DAILY_REWARDS: Readonly<Record<number, DailyRewardSpec>> = {
  1: { amount: 5 },
  2: { box: true },
  3: { amount: 7 },
  4: { box: true },
  5: { amount: 9 },
  6: { box: true },
  7: { amount: 10 },
};

const STREAK_CYCLE_LENGTH = 7;
const MIN_TICKET_AMOUNT = 1;
const MAX_TICKET_AMOUNT = 100; // Must match TicketVault.MAX_TICKETS_PER_CLAIM.
const MYSTERY_BOX_MIN = 1;
const MYSTERY_BOX_MAX = 10;

/// Computes the 1-7 streak day for *today's* claim, given the streak day of
/// the previous claim and the on-chain dayIndex of that previous claim.
///
/// - Consecutive claim (`todayIndex === prevClaimDayIndex + 1`): advance the
///   7-day cycle (`prevStreakDay % 7 + 1`).
/// - Anything else (streak broken by a skipped day, or first-ever claim,
///   i.e. `prevClaimDayIndex === null`): reset to day 1 (update_v2.md §3.2).
/// - `todayIndex === prevClaimDayIndex` means "already claimed today" - the
///   caller (route/listener) is responsible for rejecting that case before
///   ever calling this function; it is not a streak-progression concern.
export function computeStreakDay(
  prevStreakDay: number,
  prevClaimDayIndex: number | null,
  todayIndex: number,
): number {
  if (prevClaimDayIndex !== null && todayIndex === prevClaimDayIndex + 1) {
    return (prevStreakDay % STREAK_CYCLE_LENGTH) + 1;
  }
  return 1;
}

function clampTicketAmount(amount: number): number {
  return Math.max(MIN_TICKET_AMOUNT, Math.min(MAX_TICKET_AMOUNT, Math.round(amount)));
}

/// Rolls the final ticket amount for a given streak day (1-7). `rng`
/// defaults to `crypto.randomInt` and only exists as a test-injection seam
/// for deterministic mystery-box tests; production callers should omit it.
///
/// TODO(update_v2.md §7.2 - perk system, NOT implemented yet):
///  - Veteran tier (completed >=1 season with points > 0): +1 ticket folded
///    into this amount before signing. Needs season-history data that does
///    not exist yet - do not guess at the shape, wire it up once
///    `season_points` history is queryable per-player.
///  - Oracle Mark badge (ever reached Oracle division): upgrades mystery
///    box range from 1-10 to 3-10. Needs passport badge state on-chain
///    (`badges(address)` / `hasBadge`) - not read here yet.
export function rollDailyAmount(streakDay: number, rng: () => number = () => randomInt(0, 1_000_000) / 1_000_000): number {
  const spec = DAILY_REWARDS[streakDay];
  if (!spec) {
    throw new Error(`Invalid streak day: ${streakDay} (must be 1-7)`);
  }

  if ("amount" in spec) {
    return clampTicketAmount(spec.amount);
  }

  // Mystery box: roll an integer in [MYSTERY_BOX_MIN, MYSTERY_BOX_MAX] inclusive.
  const roll = Math.floor(rng() * (MYSTERY_BOX_MAX - MYSTERY_BOX_MIN + 1)) + MYSTERY_BOX_MIN;
  return clampTicketAmount(roll);
}

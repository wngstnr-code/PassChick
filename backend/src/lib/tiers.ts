import { CP_INTERVAL } from "../config/constants.js";

// Shared passport/leaderboard tier logic.
//
// Callers use different session windows (passport: last 20 sessions,
// leaderboard: 2000 rows) — computed tiers can disagree between surfaces;
// unify during v2 division work.

export const CHECKPOINT_ROW_INTERVAL = CP_INTERVAL;

export type TierRule = {
  tier: number;
  label: string;
  checkpoint: number;
  requiredCashouts: number;
};

export const TIER_RULES: TierRule[] = [
  { tier: 1, label: "Runner", checkpoint: 2, requiredCashouts: 3 },
  { tier: 2, label: "Steady", checkpoint: 4, requiredCashouts: 4 },
  { tier: 3, label: "Elite", checkpoint: 6, requiredCashouts: 4 },
  { tier: 4, label: "Oracle", checkpoint: 8, requiredCashouts: 3 },
];

export const TIER_LABELS = new Map<number, string>([
  [0, "Rookie"],
  ...TIER_RULES.map((rule) => [rule.tier, rule.label] as const),
]);

export function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function countCheckpointCashouts(
  rows: Array<{ max_row_reached: unknown; status: unknown }>,
) {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (String(row.status ?? "") !== "CASHED_OUT") continue;

    const hops = toFiniteNumber(row.max_row_reached);
    const checkpoint = Math.floor(hops / CHECKPOINT_ROW_INTERVAL);
    if (checkpoint <= 0) continue;

    counts[String(checkpoint)] = (counts[String(checkpoint)] ?? 0) + 1;
  }

  return counts;
}

export function countCashoutsAtOrAbove(
  checkpointCashouts: Record<string, number>,
  checkpoint: number,
) {
  return Object.entries(checkpointCashouts).reduce((sum, [cp, count]) => {
    return Number(cp) >= checkpoint ? sum + count : sum;
  }, 0);
}

export function computeTier(checkpointCashouts: Record<string, number>) {
  let tier = 0;

  for (const rule of TIER_RULES) {
    const qualifiedCashouts = countCashoutsAtOrAbove(
      checkpointCashouts,
      rule.checkpoint,
    );

    if (qualifiedCashouts >= rule.requiredCashouts) {
      tier = rule.tier;
    }
  }

  return tier;
}

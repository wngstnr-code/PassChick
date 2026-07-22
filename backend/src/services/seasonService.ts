import { supabase } from "../config/supabase.js";

// ── Pure domain types & logic (no I/O — unit-testable) ────────────────
// Implements update_v2.md §5 (divisions/points) and §6 (rewards).

export type DivisionName = "ROOKIE" | "RUNNER" | "STEADY" | "ELITE" | "ORACLE";

export const DIVISION_ORDER: readonly DivisionName[] = [
  "ROOKIE",
  "RUNNER",
  "STEADY",
  "ELITE",
  "ORACLE",
];

export const PROMOTION_PCT: Record<DivisionName, number> = {
  ROOKIE: 0.2,
  RUNNER: 0.15,
  STEADY: 0.1,
  ELITE: 0.1,
  ORACLE: 0,
};

export const RELEGATION_PCT: Record<DivisionName, number> = {
  ROOKIE: 0,
  RUNNER: 0.15,
  STEADY: 0.15,
  ELITE: 0.2,
  ORACLE: 0.25,
};

export type StandingEntry = {
  walletAddress: string;
  points: number;
  lastPointAt: string | null;
};

/**
 * Rank standings by points DESC, then lastPointAt ASC (whoever reached the
 * total first wins the tie). Entries with no lastPointAt are treated as
 * "reached last" and sorted after any timestamped entry with equal points.
 * Fully-tied entries are ordered by wallet address for determinism.
 */
export function rankStandings(entries: StandingEntry[]): StandingEntry[] {
  return [...entries].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;

    const aTime = a.lastPointAt ? Date.parse(a.lastPointAt) : Number.POSITIVE_INFINITY;
    const bTime = b.lastPointAt ? Date.parse(b.lastPointAt) : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;

    return a.walletAddress.localeCompare(b.walletAddress);
  });
}

export type MovementPlan = {
  promoted: Set<string>;
  relegated: Set<string>;
};

/**
 * Compute promotion/relegation for a single division per update_v2.md §5.2.
 * `ranked` must already be ordered by rankStandings (best first).
 */
export function computeDivisionMovements(
  division: DivisionName,
  ranked: StandingEntry[]
): MovementPlan {
  const promoted = new Set<string>();
  const relegated = new Set<string>();

  const active = ranked.filter((e) => e.points > 0);
  const passive = ranked.filter((e) => e.points === 0);

  const canPromote = division !== "ORACLE";
  const canRelegate = division !== "ROOKIE";

  // Passive players (0 points) in RUNNER+ auto-relegate one tier, and are
  // excluded from the active percentage base. This applies independently
  // of division size.
  if (canRelegate) {
    for (const p of passive) relegated.add(p.walletAddress);
  }

  const activeCount = active.length;
  const isSmallDivision = activeCount < 20;

  if (canPromote) {
    const promoteCount = isSmallDivision
      ? Math.min(3, activeCount)
      : Math.max(1, Math.floor(activeCount * PROMOTION_PCT[division]));
    for (let i = 0; i < promoteCount; i++) {
      promoted.add(active[i].walletAddress);
    }
  }

  // Percentage-based relegation only applies once the division is large
  // enough (>= 20 active players) — small divisions skip it entirely.
  if (canRelegate && !isSmallDivision) {
    const relegateCount = Math.floor(activeCount * RELEGATION_PCT[division]);
    for (let i = 0; i < relegateCount; i++) {
      relegated.add(active[activeCount - 1 - i].walletAddress);
    }
  }

  // A player can never be both promoted and relegated — promotion wins.
  for (const wallet of promoted) {
    relegated.delete(wallet);
  }

  return { promoted, relegated };
}

/**
 * Ticket-only portion of the season reward table (update_v2.md §6).
 * Monetary rewards (stablecoin/CELO) are out of scope here and handled
 * separately once TicketVault/passport verification land.
 */
export function ticketRewardFor(division: DivisionName, promoted: boolean): number {
  if (!promoted) return 0;

  switch (division) {
    case "ROOKIE":
      // Spec range is 5-10 tickets; using the floor value here. Final
      // per-season amount can be tuned without touching this signature.
      return 5;
    case "RUNNER":
      return 15;
    case "STEADY":
      return 20;
    case "ELITE":
    case "ORACLE":
      return 0;
    default:
      return 0;
  }
}

/**
 * Next season runs starts=prevEnds, ends=the 1st of the following calendar
 * month at 00:00 UTC (07:00 WIB). Monthly cadence — product decision
 * 2026-07-22, supersedes the 2-week cycle in update_v2.md §8.
 */
export function nextSeasonBounds(prevEndsAt: Date): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(prevEndsAt.getTime());
  const endsAt = new Date(
    Date.UTC(prevEndsAt.getUTCFullYear(), prevEndsAt.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { startsAt, endsAt };
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * First season's end date: the next 1st-of-month 00:00 UTC that is at
 * least 7 days from `now` (so a season bootstrapped near month end does
 * not last only a few days).
 */
export function firstSeasonEndsAt(now: Date): Date {
  const minTime = now.getTime() + 7 * ONE_DAY_MS;

  let d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  if (d.getTime() < minTime) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  }

  return d;
}

// ── DB-backed operations (thin wrappers around the pure logic above) ──

export type SeasonStatus = "ACTIVE" | "FREEZING" | "SETTLING" | "SETTLED";

export interface SeasonRow {
  id: number;
  season_number: number;
  starts_at: string;
  ends_at: string;
  status: SeasonStatus;
  frozen_at: string | null;
  movements_at: string | null;
  rewards_at: string | null;
  passport_at: string | null;
  settled_at: string | null;
  created_at: string;
}

/** Latest season that isn't fully SETTLED, or null if none exists yet. */
export async function getCurrentSeason(): Promise<SeasonRow | null> {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .neq("status", "SETTLED")
    .order("season_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as SeasonRow | null) ?? null;
}

/** Create season #1 if it doesn't already exist. Idempotent under races. */
export async function bootstrapFirstSeason(now: Date = new Date()): Promise<SeasonRow> {
  const endsAt = firstSeasonEndsAt(now);

  const { data, error } = await supabase
    .from("seasons")
    .insert({
      season_number: 1,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "ACTIVE",
    })
    .select()
    .single();

  if (error) {
    // Likely a unique-constraint race (already bootstrapped) — fall back
    // to reading whatever season is currently active.
    const existing = await getCurrentSeason();
    if (existing) return existing;
    throw error;
  }

  return data as SeasonRow;
}

/**
 * Freeze the leaderboard: ACTIVE -> FREEZING (guarded), then write
 * final_rank per division. Returns false if the season was already frozen
 * by a previous run (safe to no-op).
 */
export async function freezeSeason(season: SeasonRow): Promise<boolean> {
  const { data: updated, error: updateErr } = await supabase
    .from("seasons")
    .update({ status: "FREEZING", frozen_at: new Date().toISOString() })
    .eq("id", season.id)
    .eq("status", "ACTIVE")
    .is("frozen_at", null)
    .select("id");

  if (updateErr) throw updateErr;
  if (!updated || updated.length === 0) return false;

  const { data: points, error: pointsErr } = await supabase
    .from("season_points")
    .select("wallet_address, division, points, last_point_at")
    .eq("season_id", season.id);

  if (pointsErr) throw pointsErr;

  const byDivision = new Map<DivisionName, StandingEntry[]>();
  for (const row of points ?? []) {
    const division = row.division as DivisionName;
    const list = byDivision.get(division) ?? [];
    list.push({
      walletAddress: row.wallet_address,
      points: row.points,
      lastPointAt: row.last_point_at,
    });
    byDivision.set(division, list);
  }

  for (const entries of byDivision.values()) {
    const ranked = rankStandings(entries);
    for (let i = 0; i < ranked.length; i++) {
      const { error } = await supabase
        .from("season_points")
        .update({ final_rank: i + 1 })
        .eq("season_id", season.id)
        .eq("wallet_address", ranked[i].walletAddress);
      if (error) throw error;
    }
  }

  return true;
}

/**
 * Apply promotion/relegation per division, update the `divisions` table,
 * then transition FREEZING -> SETTLING. Guarded on `movement IS NULL` so
 * it's safe to re-run after a crash.
 */
export async function applyMovements(season: SeasonRow): Promise<void> {
  const { data: points, error } = await supabase
    .from("season_points")
    .select("wallet_address, division, points, last_point_at")
    .eq("season_id", season.id)
    .is("movement", null);

  if (error) throw error;

  const byDivision = new Map<DivisionName, StandingEntry[]>();
  for (const row of points ?? []) {
    const division = row.division as DivisionName;
    const list = byDivision.get(division) ?? [];
    list.push({
      walletAddress: row.wallet_address,
      points: row.points,
      lastPointAt: row.last_point_at,
    });
    byDivision.set(division, list);
  }

  for (const [division, entries] of byDivision) {
    const ranked = rankStandings(entries);
    const plan = computeDivisionMovements(division, ranked);
    const divisionIndex = DIVISION_ORDER.indexOf(division);

    for (const entry of ranked) {
      let movement: "PROMOTED" | "RELEGATED" | "STAYED" = "STAYED";
      let newDivision: DivisionName = division;

      if (plan.promoted.has(entry.walletAddress)) {
        movement = "PROMOTED";
        newDivision = DIVISION_ORDER[Math.min(divisionIndex + 1, DIVISION_ORDER.length - 1)];
      } else if (plan.relegated.has(entry.walletAddress)) {
        movement = "RELEGATED";
        newDivision = DIVISION_ORDER[Math.max(divisionIndex - 1, 0)];
      }

      const { error: spErr } = await supabase
        .from("season_points")
        .update({ movement })
        .eq("season_id", season.id)
        .eq("wallet_address", entry.walletAddress)
        .is("movement", null);
      if (spErr) throw spErr;

      if (movement !== "STAYED") {
        const { error: divErr } = await supabase
          .from("divisions")
          .update({
            division: newDivision,
            updated_season_id: season.id,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_address", entry.walletAddress);
        if (divErr) throw divErr;
      }
    }
  }

  const { error: transitionErr } = await supabase
    .from("seasons")
    .update({ status: "SETTLING", movements_at: new Date().toISOString() })
    .eq("id", season.id)
    .eq("status", "FREEZING")
    .is("movements_at", null);
  if (transitionErr) throw transitionErr;
}

/**
 * Queue ticket rewards for promoted players (NONE -> PENDING). Actual
 * on-chain crediting is deferred until TicketVault exists — this only
 * marks rows ready for that worker.
 */
export async function queueRewards(season: SeasonRow): Promise<void> {
  const { data: promotedRows, error } = await supabase
    .from("season_points")
    .select("wallet_address, division")
    .eq("season_id", season.id)
    .eq("movement", "PROMOTED")
    .eq("reward_status", "NONE");

  if (error) throw error;

  for (const row of promotedRows ?? []) {
    const reward = ticketRewardFor(row.division as DivisionName, true);
    const { error: updErr } = await supabase
      .from("season_points")
      .update({ ticket_reward: reward, reward_status: "PENDING" })
      .eq("season_id", season.id)
      .eq("wallet_address", row.wallet_address)
      .eq("reward_status", "NONE");
    if (updErr) throw updErr;
  }

  const { error: seasonErr } = await supabase
    .from("seasons")
    .update({ rewards_at: new Date().toISOString() })
    .eq("id", season.id)
    .eq("status", "SETTLING")
    .is("rewards_at", null);
  if (seasonErr) throw seasonErr;
}

/**
 * STUB: TrustPassport v2 IS live, but `recordSeason`/`grantBadge` are
 * `onlyOwner` (TrustPassport.sol:215,230) — the backend signer cannot call
 * them. Season/division data is already persisted in `season_points` +
 * `divisions`, so the owner (SC team ops / future multisig) can batch
 * `recordSeason` from there. This step just logs and marks itself done so
 * the season pipeline can proceed.
 */
export async function updatePassportBadges(season: SeasonRow): Promise<void> {
  console.log(
    `[seasonService] TODO(passport-owner-ops): on-chain recordSeason/grantBadge for season ${season.season_number} needs the OWNER key (onlyOwner) — data queued in season_points/divisions.`
  );

  const { error } = await supabase
    .from("seasons")
    .update({ passport_at: new Date().toISOString() })
    .eq("id", season.id)
    .eq("status", "SETTLING")
    .is("passport_at", null);
  if (error) throw error;
}

/** Open the next season (ACTIVE) and mark the current one SETTLED. */
export async function openNextSeason(season: SeasonRow): Promise<void> {
  const bounds = nextSeasonBounds(new Date(season.ends_at));
  const nextSeasonNumber = season.season_number + 1;

  const { error: insertErr } = await supabase.from("seasons").insert({
    season_number: nextSeasonNumber,
    starts_at: bounds.startsAt.toISOString(),
    ends_at: bounds.endsAt.toISOString(),
    status: "ACTIVE",
  });

  if (insertErr) {
    // Might already exist from a previous crashed attempt.
    const { data: existing, error: existingErr } = await supabase
      .from("seasons")
      .select("id")
      .eq("season_number", nextSeasonNumber)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) throw insertErr;
  }

  const { error: settleErr } = await supabase
    .from("seasons")
    .update({ status: "SETTLED", settled_at: new Date().toISOString() })
    .eq("id", season.id)
    .eq("status", "SETTLING");
  if (settleErr) throw settleErr;
}

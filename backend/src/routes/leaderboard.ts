import { Router } from "express";
import { supabase } from "../config/supabase.js";
import {
  CHECKPOINT_ROW_INTERVAL,
  computeTier,
  TIER_LABELS,
  toFiniteNumber,
} from "../lib/tiers.js";
import {
  computeDivisionMovements,
  DIVISION_ORDER,
  getCurrentSeason,
  rankStandings,
  type DivisionName,
  type StandingEntry,
} from "../services/seasonService.js";

const router = Router();

const TIER_REWARDS = new Map<number, string>([
  [0, "Basic Profile"],
  [1, "Verified Identity"],
  [2, "Allowlist Eligible"],
  [3, "Tournament Access"],
  [4, "Partner Perks Passport"],
]);

type LeaderboardRow = {
  wallet_address?: string | null;
  [key: string]: unknown;
};

function buildAccessFlags(tier: number) {
  return {
    verifiedIdentity: tier >= 1,
    allowlistEligible: tier >= 2,
    tournamentAccess: tier >= 3,
    partnerPerks: tier >= 4,
  };
}

function buildTierMeta(tier: number) {
  return {
    passportTier: tier,
    passportTierLabel: TIER_LABELS.get(tier) ?? `Tier ${tier}`,
    passportReward: TIER_REWARDS.get(tier) ?? "Basic Profile",
    passportAccessFlags: buildAccessFlags(tier),
  };
}

async function addPassportTierMetadata<T extends LeaderboardRow>(
  rows: T[],
): Promise<Array<T & ReturnType<typeof buildTierMeta>>> {
  const wallets = Array.from(
    new Set(
      rows
        .map((row) => String(row.wallet_address || "").trim())
        .filter(Boolean),
    ),
  );

  if (wallets.length === 0) {
    return rows.map((row) => ({ ...row, ...buildTierMeta(0) }));
  }

  const { data, error } = await supabase
    .from("game_sessions")
    .select("wallet_address, max_row_reached, status")
    .in("wallet_address", wallets)
    .eq("status", "CASHED_OUT")
    .limit(2000);

  if (error) {
    console.error("Passport tier metadata query failed:", error);
    return rows.map((row) => ({ ...row, ...buildTierMeta(0) }));
  }

  const checkpointCashoutsByWallet = new Map<string, Record<string, number>>();

  for (const row of data ?? []) {
    const walletAddress = String(row.wallet_address || "").trim();
    if (!walletAddress) continue;

    const hops = toFiniteNumber(row.max_row_reached);
    const checkpoint = Math.floor(hops / CHECKPOINT_ROW_INTERVAL);
    if (checkpoint <= 0) continue;

    const counts = checkpointCashoutsByWallet.get(walletAddress) ?? {};
    counts[String(checkpoint)] = (counts[String(checkpoint)] ?? 0) + 1;
    checkpointCashoutsByWallet.set(walletAddress, counts);
  }

  return rows.map((row) => {
    const walletAddress = String(row.wallet_address || "").trim();
    const checkpointCashouts =
      checkpointCashoutsByWallet.get(walletAddress) ?? {};
    const tier = computeTier(checkpointCashouts);
    return { ...row, ...buildTierMeta(tier) };
  });
}

router.get("/", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard_distance")
      .select("*")
      .limit(100);

    if (error) {
      console.error("❌ Leaderboard query error:", error);

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("game_sessions")
        .select("wallet_address, max_row_reached, final_multiplier")
        .in("status", ["CASHED_OUT", "CRASHED"])
        .order("max_row_reached", { ascending: false })
        .limit(100);

      if (fallbackError) {
        res.status(500).json({ error: "Failed to load leaderboard." });
        return;
      }

      const walletMap = new Map<string, { best_score: number; games_played: number; best_multiplier: number }>();
      for (const row of fallbackData ?? []) {
        const existing = walletMap.get(row.wallet_address);
        if (!existing) {
          walletMap.set(row.wallet_address, {
            best_score: row.max_row_reached,
            games_played: 1,
            best_multiplier: row.final_multiplier,
          });
        } else {
          existing.games_played++;
          if (row.max_row_reached > existing.best_score) {
            existing.best_score = row.max_row_reached;
          }
          if (row.final_multiplier > existing.best_multiplier) {
            existing.best_multiplier = row.final_multiplier;
          }
        }
      }

      const leaderboard = Array.from(walletMap.entries())
        .map(([wallet_address, stats]) => ({ wallet_address, ...stats }))
        .sort((a, b) => b.best_score - a.best_score)
        .slice(0, 100);

      const leaderboardWithPassport = await addPassportTierMetadata(leaderboard);
      res.json({ leaderboard: leaderboardWithPassport, source: "fallback" });
      return;
    }

    const leaderboard = await addPassportTierMetadata(data ?? []);
    res.json({ leaderboard });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/profit", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("leaderboard_profit")
      .select("*")
      .limit(100);

    if (error) {
      const { data: fallbackData } = await supabase
        .from("players")
        .select("wallet_address, total_games, total_wins, total_losses, total_profit")
        .gt("total_games", 0)
        .order("total_profit", { ascending: false })
        .limit(100);

      const leaderboard = await addPassportTierMetadata(fallbackData ?? []);
      res.json({ leaderboard, source: "fallback" });
      return;
    }

    const leaderboard = await addPassportTierMetadata(data ?? []);
    res.json({ leaderboard });
  } catch (err) {
    console.error("❌ Profit leaderboard error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ── B8: GET /api/leaderboard/season ─────────────────────────────────────
// Public season standings for a single division (docs/be08-season-leaderboard-api.md).

type SeasonZone = "PROMOTION" | "RELEGATION" | "SAFE" | "PASSIVE";

type SeasonStandingEntry = {
  rank: number;
  walletAddress: string;
  points: number;
  lastPointAt: string | null;
  zone: SeasonZone;
  movement: string | null;
};

type DivisionStandings = {
  standings: SeasonStandingEntry[];
  promotionCount: number;
  relegationCount: number;
  activePlayers: number;
  smallDivision: boolean;
  total: number;
};

function isMissingRelationError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

async function loadDivisionStandings(
  seasonId: number,
  division: DivisionName,
): Promise<DivisionStandings> {
  const { data, error } = await supabase
    .from("season_points")
    .select("wallet_address, points, last_point_at, movement")
    .eq("season_id", seasonId)
    .eq("division", division);

  if (error) throw error;

  const rows = data ?? [];
  const movementByWallet = new Map<string, string | null>(
    rows.map((row) => [row.wallet_address as string, (row.movement as string | null) ?? null]),
  );

  const entries: StandingEntry[] = rows.map((row) => ({
    walletAddress: row.wallet_address as string,
    points: row.points as number,
    lastPointAt: (row.last_point_at as string | null) ?? null,
  }));

  const ranked = rankStandings(entries);
  const plan = computeDivisionMovements(division, ranked);
  const activePlayers = ranked.filter((e) => e.points > 0).length;
  const smallDivision = activePlayers < 20;

  const standings: SeasonStandingEntry[] = ranked.map((entry, index) => {
    let zone: SeasonZone;
    if (entry.points === 0) {
      zone = "PASSIVE";
    } else if (plan.promoted.has(entry.walletAddress)) {
      zone = "PROMOTION";
    } else if (plan.relegated.has(entry.walletAddress)) {
      zone = "RELEGATION";
    } else {
      zone = "SAFE";
    }

    return {
      rank: index + 1,
      walletAddress: entry.walletAddress,
      points: entry.points,
      lastPointAt: entry.lastPointAt,
      zone,
      movement: movementByWallet.get(entry.walletAddress) ?? null,
    };
  });

  return {
    standings,
    promotionCount: plan.promoted.size,
    relegationCount: plan.relegated.size,
    activePlayers,
    smallDivision,
    total: standings.length,
  };
}

router.get("/season", async (req, res) => {
  try {
    const divisionParam = String(req.query.division ?? "ROOKIE")
      .trim()
      .toUpperCase();

    if (!DIVISION_ORDER.includes(divisionParam as DivisionName)) {
      res.status(400).json({
        success: false,
        error: `Invalid division. Must be one of: ${DIVISION_ORDER.join(", ")}`,
      });
      return;
    }
    const division = divisionParam as DivisionName;

    let limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    limit = Math.min(limit, 100);

    let offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    if (!Number.isFinite(offset) || offset < 0) offset = 0;

    const walletParam = req.query.wallet
      ? String(req.query.wallet).trim().toLowerCase()
      : null;

    let season;
    try {
      season = await getCurrentSeason();
    } catch (err) {
      if (isMissingRelationError(err)) {
        res.status(503).json({
          success: false,
          error: "Season system is not initialized yet.",
        });
        return;
      }
      throw err;
    }

    if (!season) {
      res.status(503).json({
        success: false,
        error: "Season system is not initialized yet.",
      });
      return;
    }

    const divisionStandings = await loadDivisionStandings(season.id, division);
    const page = divisionStandings.standings.slice(offset, offset + limit);

    let viewer: {
      walletAddress: string;
      division: DivisionName;
      rank: number;
      points: number;
      zone: SeasonZone;
    } | null = null;

    if (walletParam) {
      const { data: divisionRow, error: divisionErr } = await supabase
        .from("divisions")
        .select("division")
        .eq("wallet_address", walletParam)
        .maybeSingle();

      if (divisionErr) throw divisionErr;

      const viewerDivision = ((divisionRow?.division as DivisionName) ?? "ROOKIE") as DivisionName;

      const viewerStandings =
        viewerDivision === division
          ? divisionStandings.standings
          : (await loadDivisionStandings(season.id, viewerDivision)).standings;

      const entry = viewerStandings.find(
        (s) => s.walletAddress.toLowerCase() === walletParam,
      );

      if (entry) {
        viewer = {
          walletAddress: entry.walletAddress,
          division: viewerDivision,
          rank: entry.rank,
          points: entry.points,
          zone: entry.zone,
        };
      }
    }

    res.json({
      success: true,
      season: {
        seasonNumber: season.season_number,
        startsAt: season.starts_at,
        endsAt: season.ends_at,
        status: season.status,
      },
      division,
      standings: page,
      zones: {
        promotionCount: divisionStandings.promotionCount,
        relegationCount: divisionStandings.relegationCount,
        activePlayers: divisionStandings.activePlayers,
        smallDivision: divisionStandings.smallDivision,
      },
      viewer,
      total: divisionStandings.total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("❌ Season leaderboard error:", err);
    res.status(500).json({ success: false, error: "Internal server error." });
  }
});

export default router;

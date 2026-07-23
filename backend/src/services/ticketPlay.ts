import { supabase } from "../config/supabase.js";
import { CHECKPOINT_ROW_INTERVAL } from "../lib/tiers.js";
import { computeMatchPoints } from "./matchPoints.js";
import { getCurrentSeason, type DivisionName } from "./seasonService.js";

/// BE-07 (docs/be07-game-session-contract.md) DB layer: atomic 1-ticket
/// debit/refund via the Postgres functions in schema_v2.sql (V2.2), plus
/// closing a V2 session into season points. No socket/HTTP concerns here.

export type DebitResultCode =
  | "OK"
  | "REPLAY"
  | "INSUFFICIENT_TICKETS"
  | "SESSION_ALREADY_ACTIVE";

export interface DebitResult {
  code: DebitResultCode;
  balance: number;
}

interface LedgerRpcRow {
  code: string;
  new_balance: number | string;
}

function firstRpcRow(data: unknown): LedgerRpcRow | null {
  if (Array.isArray(data) && data.length > 0) return data[0] as LedgerRpcRow;
  return null;
}

/// Debits exactly one ticket for `sessionId`. Idempotent per session
/// (REPLAY) and race-safe per wallet (row lock inside the function).
export async function debitTicketForSession(
  walletAddress: string,
  sessionId: string,
): Promise<DebitResult> {
  const { data, error } = await supabase.rpc("debit_ticket_for_session", {
    p_wallet: walletAddress,
    p_session: sessionId,
  });
  if (error) {
    throw new Error(`debit_ticket_for_session failed: ${error.message}`);
  }
  const row = firstRpcRow(data);
  if (!row) {
    throw new Error("debit_ticket_for_session returned no rows.");
  }
  return { code: row.code as DebitResultCode, balance: Number(row.new_balance) };
}

/// Refunds the SPEND of an orphaned no-progress session (BE-07 §5).
/// Idempotent: at most one refund per session ever happens.
export async function refundTicketForSession(sessionId: string): Promise<string> {
  const { data, error } = await supabase.rpc("refund_ticket_for_session", {
    p_session: sessionId,
  });
  if (error) {
    throw new Error(`refund_ticket_for_session failed: ${error.message}`);
  }
  return firstRpcRow(data)?.code ?? "NO_SPEND";
}

export async function readMirrorTicketBalance(walletAddress: string): Promise<number> {
  const { data } = await supabase
    .from("ticket_balances")
    .select("balance")
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  return Number(data?.balance ?? 0);
}

export async function getPlayerDivision(walletAddress: string): Promise<DivisionName> {
  const { data } = await supabase
    .from("divisions")
    .select("division")
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  return (data?.division as DivisionName) ?? "ROOKIE";
}

export function checkpointFromMaxRow(maxRow: number): number {
  if (!Number.isFinite(maxRow) || maxRow <= 0) return 0;
  return Math.floor(maxRow / CHECKPOINT_ROW_INTERVAL);
}

export interface ClosedV2Session {
  status: "CRASHED" | "COMPLETED";
  finalCheckpoint: number;
  pointsAwarded: number;
  seasonPointsTotal: number;
  seasonId: number | null;
  division: DivisionName;
  ticketBalance: number;
  endedAt: string;
}

/// Closes a V2 session: persists the outcome on game_sessions and credits
/// §5.1 points into season_points. Idempotent per session: a session that
/// is no longer ACTIVE is left untouched and its stored result is returned,
/// so duplicate game:crash / game:end_run events never double-award.
export async function closeV2Session(params: {
  sessionId: string;
  walletAddress: string;
  status: "CRASHED" | "COMPLETED";
  maxRow: number;
}): Promise<ClosedV2Session> {
  const { sessionId, walletAddress, status, maxRow } = params;
  const finalCheckpoint = checkpointFromMaxRow(maxRow);
  const division = await getPlayerDivision(walletAddress);

  // Award points only while a season is actively running; a match that ends
  // inside the freeze/settle window earns nothing (BE-07 §6 SEASON_FROZEN
  // blocks starts, so this only affects runs that straddle the boundary).
  const season = await getCurrentSeason().catch(() => null);
  const seasonActive = season?.status === "ACTIVE";
  const points = seasonActive ? computeMatchPoints(division, finalCheckpoint) : 0;

  const endedAt = new Date().toISOString();

  // Idempotency gate: only the transition away from ACTIVE writes a result.
  const { data: updatedRows, error: updateError } = await supabase
    .from("game_sessions")
    .update({
      status,
      max_row_reached: maxRow,
      final_checkpoint: finalCheckpoint,
      points_awarded: points,
      season_id: season?.id ?? null,
      ended_at: endedAt,
    })
    .eq("session_id", sessionId)
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .select("session_id");

  if (updateError) {
    throw updateError;
  }

  const transitioned = Array.isArray(updatedRows) && updatedRows.length > 0;

  let seasonPointsTotal = 0;
  if (transitioned && seasonActive && season) {
    seasonPointsTotal = await creditSeasonPoints(season.id, walletAddress, division, points);
  } else if (seasonActive && season) {
    seasonPointsTotal = await readSeasonPoints(season.id, walletAddress);
  }

  const ticketBalance = await readMirrorTicketBalance(walletAddress);

  if (!transitioned) {
    // Duplicate close: report what is already stored instead of re-awarding.
    const { data: stored } = await supabase
      .from("game_sessions")
      .select("status, final_checkpoint, points_awarded, ended_at")
      .eq("session_id", sessionId)
      .maybeSingle();
    return {
      status: (stored?.status as "CRASHED" | "COMPLETED") ?? status,
      finalCheckpoint: Number(stored?.final_checkpoint ?? finalCheckpoint),
      pointsAwarded: Number(stored?.points_awarded ?? 0),
      seasonPointsTotal,
      seasonId: season?.id ?? null,
      division,
      ticketBalance,
      endedAt: String(stored?.ended_at ?? endedAt),
    };
  }

  return {
    status,
    finalCheckpoint,
    pointsAwarded: points,
    seasonPointsTotal,
    seasonId: season?.id ?? null,
    division,
    ticketBalance,
    endedAt,
  };
}

async function readSeasonPoints(seasonId: number, walletAddress: string): Promise<number> {
  const { data } = await supabase
    .from("season_points")
    .select("points")
    .eq("season_id", seasonId)
    .eq("wallet_address", walletAddress)
    .maybeSingle();
  return Number(data?.points ?? 0);
}

async function creditSeasonPoints(
  seasonId: number,
  walletAddress: string,
  division: DivisionName,
  delta: number,
): Promise<number> {
  const existing = await supabase
    .from("season_points")
    .select("points")
    .eq("season_id", seasonId)
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  const prev = Number(existing.data?.points ?? 0);
  const next = prev + delta;

  if (!existing.data) {
    const { error } = await supabase.from("season_points").insert({
      season_id: seasonId,
      wallet_address: walletAddress,
      division,
      points: next,
      last_point_at: delta > 0 ? new Date().toISOString() : null,
    });
    if (error) {
      console.error("❌ Failed to insert season_points:", error);
      return prev;
    }
    return next;
  }

  if (delta > 0) {
    const { error } = await supabase
      .from("season_points")
      .update({
        points: next,
        last_point_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("season_id", seasonId)
      .eq("wallet_address", walletAddress);
    if (error) {
      console.error("❌ Failed to update season_points:", error);
      return prev;
    }
  }
  return next;
}

/// Voids an orphaned no-progress session and refunds its ticket (BE-07 §5).
export async function voidAndRefundSession(
  sessionId: string,
  walletAddress: string,
): Promise<boolean> {
  const { data: updatedRows, error } = await supabase
    .from("game_sessions")
    .update({ status: "VOIDED", ended_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .select("session_id");

  if (error) {
    console.error(`❌ Failed to void session ${sessionId}:`, error);
    return false;
  }
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    return false;
  }

  try {
    const code = await refundTicketForSession(sessionId);
    console.log(`🎟️ Voided orphan session ${sessionId} (refund: ${code})`);
  } catch (refundError) {
    console.error(`❌ Refund failed for voided session ${sessionId}:`, refundError);
  }
  return true;
}

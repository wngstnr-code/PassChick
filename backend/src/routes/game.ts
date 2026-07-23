import { Router, type Request, type Response } from "express";
import {
  buildStartSessionTransaction,
  isZeroSessionId,
  readActiveOnchainSession,
} from "../lib/celo.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { getGameByWallet, hasActiveGame, removeGameState } from "../services/gameState.js";
import { getEffectiveMultiplierBp } from "../services/gameValidator.js";
import {
  SETTLEMENT_OUTCOME,
  generateOnchainSessionId,
  signSettlement,
  usdcToUint256,
} from "../services/signatureService.js";
import {
  getSettlementRelayerAddress,
  submitSettlementOnchain,
} from "../services/settlementExecutor.js";

const router = Router();

function toSettlementErrorMessage(error: unknown) {
  const raw = String(
    (error as { shortMessage?: string; message?: string })?.shortMessage ||
      (error as { message?: string })?.message ||
      "unknown error",
  );
  const lower = raw.toLowerCase();
  const selector = extractErrorSelector(error);

  if (selector === "0xa5a58849") {
    const payload = extractSelectorPayload(error, selector);
    if (payload.length >= 128) {
      try {
        const availableUnits = BigInt(`0x${payload.slice(0, 64)}`);
        const requiredUnits = BigInt(`0x${payload.slice(64, 128)}`);
        const available = Number(availableUnits) / 1_000_000;
        const required = Number(requiredUnits) / 1_000_000;
        return `Failed to submit settlement onchain: treasury balance is insufficient (available ${available.toFixed(6)} USDC, required ${required.toFixed(6)} USDC).`;
      } catch {
        return "Failed to submit settlement onchain: treasury balance is insufficient for payout.";
      }
    }
    return "Failed to submit settlement onchain: treasury balance is insufficient for payout.";
  }

  if (
    lower.includes("insufficient funds") ||
    lower.includes("funds for gas") ||
    lower.includes("signer had insufficient balance")
  ) {
    return `Failed to submit settlement onchain: backend relayer kehabisan ${env.NATIVE_TOKEN_SYMBOL} untuk gas (relayer: ${getSettlementRelayerAddress()}).`;
  }
  if (lower.includes("enotfound") || lower.includes("fetch failed")) {
    return `Failed to submit settlement onchain: backend gagal mengakses RPC ${env.NETWORK_NAME}.`;
  }
  if (lower.includes("invalidsigner")) {
    return "Failed to submit settlement onchain: signer backend tidak cocok dengan signer di contract.";
  }
  if (lower.includes("invalidsignaturesigner")) {
    return "Failed to submit settlement onchain: signature backend tidak cocok dengan backendSigner onchain.";
  }
  if (lower.includes("sessionalreadysettled")) {
    return "Settlement session ini sudah settled onchain.";
  }
  if (lower.includes("sessionnotactive")) {
    return "Settlement session ini sudah tidak aktif onchain.";
  }
  if (lower.includes("sessionnotfound")) {
    return "Session onchain tidak ditemukan untuk settlement ini.";
  }
  if (lower.includes("resolutionexpired")) {
    return "Settlement signature sudah expired.";
  }
  if (lower.includes("insufficienttreasury")) {
    return "Treasury vault tidak cukup untuk payout settlement ini.";
  }
  if (lower.includes("resolutionpayoutmismatch")) {
    return "Failed to submit settlement onchain: payload payout tidak cocok dengan rule settlement onchain.";
  }
  if (lower.includes("resolutionstakemismatch")) {
    return "Failed to submit settlement onchain: payload stake tidak cocok dengan data session onchain.";
  }
  if (lower.includes("sessionnotactive") || lower.includes("session already settled")) {
    return "Settlement session ini sudah tidak aktif onchain.";
  }

  return `Failed to submit settlement onchain: ${raw}`;
}

function extractErrorSelector(error: unknown) {
  const texts = collectErrorTexts(error);
  for (const text of texts) {
    const match = text.match(/0x[a-fA-F0-9]{8}\b/);
    if (match?.[0]) {
      return match[0].toLowerCase();
    }
  }
  return "";
}

function extractSelectorPayload(error: unknown, selector: string) {
  const normalizedSelector = selector.toLowerCase();
  const texts = collectErrorTexts(error);
  for (const text of texts) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(normalizedSelector);
    if (idx < 0) continue;
    const payload = lower
      .slice(idx + normalizedSelector.length)
      .replace(/[^a-f0-9]/g, "");
    if (payload.length >= 64) {
      return payload;
    }
  }
  return "";
}

const ALREADY_SETTLED_LIKE_SELECTORS = new Set([
  "0xfa9b370d",
  "0x2f2c01cb",
  "0x15e292d2",
]);

function collectErrorTexts(error: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<object>();
  const queue: unknown[] = [error];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur == null) continue;
    if (typeof cur === "string") {
      out.push(cur);
      continue;
    }
    if (typeof cur !== "object") continue;
    if (seen.has(cur as object)) continue;
    seen.add(cur as object);

    const rec = cur as Record<string, unknown>;
    for (const value of Object.values(rec)) {
      if (typeof value === "string") {
        out.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) queue.push(item);
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return out;
}

function isAlreadySettledLikeError(error: unknown) {
  const texts = collectErrorTexts(error);

  for (const text of texts) {
    const lower = text.toLowerCase();
    if (
      lower.includes("sessionalreadysettled") ||
      lower.includes("sessionnotactive") ||
      lower.includes("sessionnotfound")
    ) {
      return true;
    }

    const selectorMatch = text.match(/0x[a-fA-F0-9]{8}/g);
    if (selectorMatch) {
      for (const candidate of selectorMatch) {
        if (ALREADY_SETTLED_LIKE_SELECTORS.has(candidate.toLowerCase())) {
          return true;
        }
      }
    }
  }

  return false;
}

function parsePaginationParam(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getSettlementAmounts(session: Record<string, unknown>) {
  const stakeAmount = Number(session.stake_amount ?? 0);
  const status = String(session.status ?? "");
  const finalMultiplierBp =
    status === "CRASHED"
      ? 0
      : Math.round(Number(session.final_multiplier ?? 0) * 10_000);
  const stakeUnits = usdcToUint256(stakeAmount);
  const payoutUnits =
    status === "CRASHED"
      ? 0n
      : (stakeUnits * BigInt(finalMultiplierBp)) / 10_000n;

  return {
    stakeAmount,
    stakeUnits,
    payoutAmount: Number(payoutUnits) / 1_000_000,
    payoutUnits,
    finalMultiplierBp,
  };
}

function buildResolutionFromSession(walletAddress: string, session: Record<string, unknown>) {
  const status = String(session.status ?? "");
  const { stakeUnits, payoutUnits, finalMultiplierBp } = getSettlementAmounts(session);

  return {
    sessionId: String(session.onchain_session_id),
    player: walletAddress,
    stakeAmount: stakeUnits.toString(),
    payoutAmount: payoutUnits.toString(),
    finalMultiplierBp: status === "CRASHED" ? "0" : finalMultiplierBp.toString(),
    outcome: status === "CRASHED" ? 2 : 1,
    deadline: String(session.settlement_deadline ?? "0"),
  };
}

async function submitSettlementForSession(params: {
  walletAddress: string;
  session: Record<string, unknown>;
}) {
  const { walletAddress, session } = params;
  const sessionId = String(session.session_id ?? "");
  const existingTxHash = String(session.settlement_tx_hash ?? "").trim();
  if (existingTxHash) {
    return existingTxHash;
  }

  const ensuredSettlement = await ensureSettlementSignature(walletAddress, session);
  if (!ensuredSettlement?.signature || !ensuredSettlement.deadline) {
    throw new Error("Settlement signature belum tersedia.");
  }

  const normalizedSession = {
    ...session,
    settlement_signature: ensuredSettlement.signature,
    settlement_deadline: ensuredSettlement.deadline,
  };
  const resolution = buildResolutionFromSession(walletAddress, normalizedSession);
  let txHash: string;
  try {
    txHash = await submitSettlementOnchain({
      resolution,
      signature: ensuredSettlement.signature,
    });
  } catch (firstSubmitError) {
    const refreshedSettlement = await ensureSettlementSignature(walletAddress, session, {
      forceRefresh: true,
    });

    if (!refreshedSettlement?.signature || !refreshedSettlement.deadline) {
      throw firstSubmitError;
    }

    const retrySession = {
      ...session,
      settlement_signature: refreshedSettlement.signature,
      settlement_deadline: refreshedSettlement.deadline,
    };

    txHash = await submitSettlementOnchain({
      resolution: buildResolutionFromSession(walletAddress, retrySession),
      signature: refreshedSettlement.signature,
    });
  }

  const { error } = await supabase
    .from("game_sessions")
    .update({ settlement_tx_hash: txHash })
    .eq("session_id", sessionId)
    .eq("wallet_address", walletAddress);

  if (error) {
    throw error;
  }

  return txHash;
}

async function clearUnsettlablePendingSession(sessionId: string) {
  const { error } = await supabase
    .from("game_sessions")
    .update({
      settlement_signature: null,
      settlement_deadline: null,
      settlement_tx_hash: "not-pending-onchain",
    })
    .eq("session_id", sessionId);

  if (error) {
    console.error(`❌ Failed to clear stale pending settlement ${sessionId}:`, error);
  }
}

async function applyCrashPlayerStats(walletAddress: string, stakeAmount: number) {
  const { data: player } = await supabase
    .from("players")
    .select("total_losses, total_profit")
    .eq("wallet_address", walletAddress)
    .single();

  if (!player) {
    return;
  }

  await supabase
    .from("players")
    .update({
      total_losses: Number(player.total_losses ?? 0) + 1,
      total_profit: Number(player.total_profit ?? 0) - stakeAmount,
    })
    .eq("wallet_address", walletAddress);
}

async function crashAndPersistSession(params: {
  walletAddress: string;
  sessionId: string;
  onchainSessionId: string;
  stakeAmount: number;
  maxRowReached?: number;
  finalMultiplier?: number;
}) {
  const settlement = await signSettlement({
    playerAddress: params.walletAddress,
    onchainSessionId: params.onchainSessionId,
    stakeAmount: params.stakeAmount,
    payoutAmount: 0,
    finalMultiplierBp: 0,
    outcome: SETTLEMENT_OUTCOME.CRASHED,
  });

  let settlementTxHash: string | null = null;
  try {
    settlementTxHash = await submitSettlementOnchain({
      resolution: settlement.resolution,
      signature: settlement.signature,
    });
  } catch (submitError) {
    if (isAlreadySettledLikeError(submitError)) {
      settlementTxHash = "already-settled-onchain";
    } else {
      console.error(
        `❌ Failed to submit crash settlement for ${params.onchainSessionId}:`,
        submitError,
      );
    }
  }

  const updates: Record<string, unknown> = {
    status: "CRASHED",
    final_multiplier: params.finalMultiplier ?? 0,
    payout_amount: 0,
    settlement_signature: settlement.signature,
    settlement_deadline: settlement.resolution.deadline,
    settlement_tx_hash: settlementTxHash,
    ended_at: new Date().toISOString(),
  };

  if (typeof params.maxRowReached === "number") {
    updates.max_row_reached = params.maxRowReached;
  }

  const { error } = await supabase
    .from("game_sessions")
    .update(updates)
    .eq("session_id", params.sessionId)
    .eq("wallet_address", params.walletAddress);

  if (error) {
    throw error;
  }

  await applyCrashPlayerStats(params.walletAddress, params.stakeAmount);

  return settlement;
}

async function persistRecoveredOnchainCrash(params: {
  walletAddress: string;
  onchainSessionId: string;
  stakeAmount: number;
  settlementSignature: string;
  settlementDeadline: string;
  settlementTxHash: string;
}) {
  const { data: existingSession, error: existingError } = await supabase
    .from("game_sessions")
    .select("session_id, status")
    .eq("onchain_session_id", params.onchainSessionId)
    .maybeSingle();

  if (existingError) {
    console.error(
      `❌ Failed to inspect recovered onchain session ${params.onchainSessionId}:`,
      existingError,
    );
    return;
  }

  const payload = {
    wallet_address: params.walletAddress,
    onchain_session_id: params.onchainSessionId,
    stake_amount: params.stakeAmount,
    status: "CRASHED",
    max_row_reached: 0,
    final_multiplier: 0,
    payout_amount: 0,
    settlement_signature: params.settlementSignature,
    settlement_deadline: Number(params.settlementDeadline),
    settlement_tx_hash: params.settlementTxHash,
    ended_at: new Date().toISOString(),
  };

  if (!existingSession) {
    const { error: insertError } = await supabase
      .from("game_sessions")
      .insert(payload);

    if (insertError) {
      console.error(
        `❌ Failed to persist recovered onchain session ${params.onchainSessionId}:`,
        insertError,
      );
      return;
    }

    await applyCrashPlayerStats(params.walletAddress, params.stakeAmount);
    return;
  }

  const { error: updateError } = await supabase
    .from("game_sessions")
    .update(payload)
    .eq("session_id", String(existingSession.session_id));

  if (updateError) {
    console.error(
      `❌ Failed to update recovered onchain session ${params.onchainSessionId}:`,
      updateError,
    );
    return;
  }

  if (String(existingSession.status ?? "") === "ACTIVE") {
    await applyCrashPlayerStats(params.walletAddress, params.stakeAmount);
  }
}

async function recoverOnchainActiveSession(walletAddress: string) {
  const active = await readActiveOnchainSession(walletAddress);
  if (!active) return null;

  const onchainSessionId = active.sessionId;
  if (isZeroSessionId(onchainSessionId)) return null;

  const stakeAmount = Number(active.stakeAmountUnits) / 1_000_000;
  const settlement = await signSettlement({
    playerAddress: walletAddress,
    onchainSessionId,
    stakeAmount,
    payoutAmount: 0,
    finalMultiplierBp: 0,
    outcome: SETTLEMENT_OUTCOME.CRASHED,
  });
  const settlementTxHash = await submitSettlementOnchain({
    resolution: settlement.resolution,
    signature: settlement.signature,
  });

  await persistRecoveredOnchainCrash({
    walletAddress,
    onchainSessionId,
    stakeAmount,
    settlementSignature: settlement.signature,
    settlementDeadline: settlement.resolution.deadline,
    settlementTxHash,
  });

  return {
    onchainSessionId,
    settlementTxHash,
  };
}

async function ensureSettlementSignature(
  walletAddress: string,
  session: Record<string, unknown>,
  options?: { forceRefresh?: boolean },
) {
  const forceRefresh = Boolean(options?.forceRefresh);
  const existingSignature = String(session.settlement_signature ?? "").trim();
  const existingDeadline = Number(session.settlement_deadline ?? 0);
  const now = Math.floor(Date.now() / 1000);
  const minValidSeconds = 30;

  if (
    !forceRefresh &&
    existingSignature &&
    existingDeadline > 0 &&
    existingDeadline > now + minValidSeconds
  ) {
    return {
      signature: existingSignature,
      deadline: existingDeadline,
    };
  }

  const status = String(session.status ?? "");
  if (status !== "CRASHED" && status !== "CASHED_OUT") {
    return null;
  }

  try {
    const { stakeAmount, payoutAmount, finalMultiplierBp } =
      getSettlementAmounts(session);
    const settlement = await signSettlement({
      playerAddress: walletAddress,
      onchainSessionId: String(session.onchain_session_id ?? ""),
      stakeAmount,
      payoutAmount,
      finalMultiplierBp,
      outcome:
        status === "CRASHED"
          ? SETTLEMENT_OUTCOME.CRASHED
          : SETTLEMENT_OUTCOME.CASHED_OUT,
    });

    const nextSignature = settlement.signature;
    const nextDeadline = Number(settlement.resolution.deadline);

    const { error } = await supabase
      .from("game_sessions")
      .update({
        payout_amount: payoutAmount,
        settlement_signature: nextSignature,
        settlement_deadline: nextDeadline,
      })
      .eq("session_id", String(session.session_id));

    if (error) {
      console.error(
        `❌ Failed to persist generated settlement signature ${String(session.session_id)}:`,
        error,
      );
    }

    return {
      signature: nextSignature,
      deadline: nextDeadline,
    };
  } catch (signError) {
    console.error(
      `❌ Failed to generate settlement signature for ${String(session.session_id)}:`,
      signError,
    );
    return null;
  }
}

async function isCurrentOnchainPendingSettlement(session: Record<string, unknown>) {
  const onchainSessionId = String(session.onchain_session_id ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(onchainSessionId) || isZeroSessionId(onchainSessionId)) {
    return false;
  }

  const walletAddress = String(session.wallet_address ?? "");
  if (!walletAddress) return false;

  try {
    const active = await readActiveOnchainSession(walletAddress);
    if (!active) return false;
    return active.sessionId.toLowerCase() === onchainSessionId.toLowerCase();
  } catch (inspectError) {
    console.error(`❌ Failed to inspect pending settlement ${onchainSessionId}:`, inspectError);
    return true;
  }
}

/// BE-07 §5: V2 session recovery. FE calls this on mount/reconnect before
/// offering the play button. V1's /active endpoint is left untouched.
router.get("/session/active", requireAuth, async (req: Request, res: Response) => {
  const walletAddress = req.walletAddress!;

  const { data, error } = await supabase
    .from("game_sessions")
    .select("session_id, client_session_id, created_at")
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .eq("game_mode", "V2_TICKET")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Most likely the V2.2 schema has not been applied yet - fail closed.
    console.error("❌ Failed to inspect V2 active session:", error);
    res.status(503).json({ success: false, error: "V2 session state is unavailable." });
    return;
  }

  if (!data) {
    res.json({ active: false });
    return;
  }

  res.json({
    active: true,
    session: {
      sessionId: data.session_id,
      clientSessionId: data.client_session_id,
      startedAt: data.created_at,
      resumable: false,
    },
  });
});

router.get("/active", requireAuth, async (req: Request, res: Response) => {
  const walletAddress = req.walletAddress!;

  if (hasActiveGame(walletAddress)) {
    res.json({ hasActiveGame: true });
    return;
  }

  const { data, error } = await supabase
    .from("game_sessions")
    .select("session_id, onchain_session_id, stake_amount, created_at")
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("❌ Failed to fetch active session:", error);
    res.status(500).json({ error: "Failed to inspect active session." });
    return;
  }

  const latestSession = Array.isArray(data) && data.length > 0 ? data[0] : null;

  res.json({
    hasActiveGame: !!latestSession,
    session: latestSession,
  });
});

async function forceEndActiveSession(req: Request, res: Response) {
  const walletAddress = req.walletAddress!;
  const activeGame = getGameByWallet(walletAddress);
  const resolvedSessions: Array<{
    sessionId: string;
    onchainSessionId: string;
    source: "memory" | "database";
  }> = [];

  if (activeGame) {
    const effectiveMultiplierBp = activeGame.timer.segmentActive
      ? getEffectiveMultiplierBp(
          activeGame.multiplierBp,
          activeGame.timer.segmentStart,
          Date.now(),
        )
      : activeGame.multiplierBp;

    try {
      await crashAndPersistSession({
        walletAddress,
        sessionId: activeGame.sessionId,
        onchainSessionId: activeGame.onchainSessionId,
        stakeAmount: activeGame.stake,
        maxRowReached: activeGame.maxRow,
        finalMultiplier: effectiveMultiplierBp / 10_000,
      });
      removeGameState(walletAddress);
      resolvedSessions.push({
        sessionId: activeGame.sessionId,
        onchainSessionId: activeGame.onchainSessionId,
        source: "memory",
      });
    } catch (error) {
      console.error("❌ Failed to force-end active in-memory game:", error);
      res.status(500).json({ error: "Failed to force-end active game." });
      return;
    }
  }

  const { data: staleSessions, error } = await supabase
    .from("game_sessions")
    .select("session_id, onchain_session_id, stake_amount, max_row_reached")
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("❌ Failed to query active game session:", error);
    res.status(500).json({ error: "Failed to inspect active session." });
    return;
  }

  for (const staleSession of staleSessions || []) {
    try {
      await crashAndPersistSession({
        walletAddress,
        sessionId: String(staleSession.session_id),
        onchainSessionId: String(staleSession.onchain_session_id),
        stakeAmount: Number(staleSession.stake_amount ?? 0),
        maxRowReached: Number(staleSession.max_row_reached ?? 0),
        finalMultiplier: 0,
      });
      resolvedSessions.push({
        sessionId: String(staleSession.session_id),
        onchainSessionId: String(staleSession.onchain_session_id),
        source: "database",
      });
    } catch (forceEndError) {
      console.error(
        `❌ Failed to force-end stale active session ${String(staleSession.session_id)}:`,
        forceEndError,
      );
    }
  }

  if (resolvedSessions.length === 0) {
    try {
      const recoveredOnchainSession = await recoverOnchainActiveSession(walletAddress);
      if (!recoveredOnchainSession) {
        res.json({ success: true, resolved: false, source: "none" });
        return;
      }

      res.json({
        success: true,
        resolved: true,
        source: "onchain",
        resolvedCount: 1,
        onchainSessionId: recoveredOnchainSession.onchainSessionId,
        settlementTxHash: recoveredOnchainSession.settlementTxHash,
      });
      return;
    } catch (recoverError) {
      console.error("❌ Failed to recover orphaned onchain session:", recoverError);
      res.status(500).json({
        error: toSettlementErrorMessage(recoverError),
      });
      return;
    }
  }

  const sourceSet = new Set(resolvedSessions.map((session) => session.source));
  const source =
    sourceSet.size === 2
      ? "memory+database"
      : resolvedSessions[0]?.source || "database";

  res.json({
    success: true,
    resolved: true,
    source,
    resolvedCount: resolvedSessions.length,
    sessions: resolvedSessions,
  });
}

async function getPendingSettlements(req: Request, res: Response) {
  const walletAddress = req.walletAddress!;

  const { data, error } = await supabase
    .from("game_sessions")
    .select(
      "session_id, onchain_session_id, stake_amount, status, final_multiplier, payout_amount, settlement_signature, settlement_deadline, settlement_tx_hash, ended_at"
    )
    .eq("wallet_address", walletAddress)
    .in("status", ["CASHED_OUT", "CRASHED"])
    .is("settlement_tx_hash", null)
    .order("ended_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("❌ Supabase Error (pending-settlements):", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    });
    res.status(500).json({ error: "Failed to fetch pending settlements.", details: error.message });
    return;
  }

  const pendingSettlements: Array<Record<string, unknown>> = [];

  for (const session of data || []) {
    const isStillPendingOnchain = await isCurrentOnchainPendingSettlement(session);
    if (!isStillPendingOnchain) {
      console.warn(
        `🧹 Ignoring stale pending settlement ${String(session.session_id)} (${String(
          session.onchain_session_id ?? "",
        )})`,
      );
      await clearUnsettlablePendingSession(String(session.session_id));
      continue;
    }

    const ensuredSettlement = await ensureSettlementSignature(walletAddress, session);
    if (!ensuredSettlement?.signature || !ensuredSettlement.deadline) {
      console.warn(
        `⚠️ Pending session ${String(session.session_id)} has no usable settlement signature yet.`,
      );
      continue;
    }

    const normalizedSession = {
      ...session,
      settlement_signature: ensuredSettlement.signature,
      settlement_deadline: ensuredSettlement.deadline,
    };

    pendingSettlements.push({
      ...normalizedSession,
      resolution: buildResolutionFromSession(walletAddress, normalizedSession),
      signature: ensuredSettlement.signature,
    });
  }

  res.json({
    pendingSettlements,
    pendingClaims: pendingSettlements,
    hasPending: pendingSettlements.length > 0,
  });
}

router.get("/pending-settlement", requireAuth, getPendingSettlements);
router.get("/pending-claim", requireAuth, getPendingSettlements);
router.post("/force-end-active", requireAuth, forceEndActiveSession);
router.post("/start-session", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.walletAddress!;
    const stakeAmount = Number((req.body as { stake?: number | string }).stake ?? 0);

    if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      res.status(400).json({ error: "Invalid stake amount." });
      return;
    }

    const activeOnchain = await readActiveOnchainSession(walletAddress);
    if (activeOnchain) {
      res.json({
        success: true,
        onchainSessionId: activeOnchain.sessionId,
        unsignedTx: null,
        reusedActiveSession: true,
      });
      return;
    }

    const onchainSessionId = generateOnchainSessionId();
    const unsignedTx = await buildStartSessionTransaction(
      walletAddress,
      onchainSessionId,
      usdcToUint256(stakeAmount),
    );

    res.json({
      success: true,
      onchainSessionId,
      unsignedTx,
      reusedActiveSession: false,
    });
  } catch (error) {
    console.error("❌ Failed to build start-session transaction:", error);
    res.status(500).json({ error: "Failed to build start-session transaction." });
  }
});

router.get("/history", requireAuth, async (req: Request, res: Response) => {
  const walletAddress = req.walletAddress!;
  const limit = parsePaginationParam(req.query.limit, 20, 1, 100);
  const offset = parsePaginationParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const { data, error, count } = await supabase
    .from("game_sessions")
    .select("*", { count: "exact" })
    .eq("wallet_address", walletAddress)
    .neq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("❌ Error fetching game history:", error);
    res.status(500).json({ error: "Failed to fetch game history." });
    return;
  }

  res.json({
    sessions: data || [],
    total: count || 0,
    limit,
    offset,
  });
});

async function clearSettlement(req: Request, res: Response) {
  const walletAddress = req.walletAddress!;
  const { sessionId, txHash } = req.body as { sessionId?: string; txHash?: string };

  if (!sessionId || !txHash) {
    res.status(400).json({ error: "Missing sessionId or txHash." });
    return;
  }

  const normalizedTxHash = String(txHash).trim();
  if (!normalizedTxHash || normalizedTxHash.length < 32) {
    res.status(400).json({ error: "Invalid txHash format." });
    return;
  }

  const { data: session } = await supabase
    .from("game_sessions")
    .select("session_id, wallet_address, status, settlement_signature, settlement_tx_hash")
    .eq("session_id", sessionId)
    .eq("wallet_address", walletAddress)
    .single();

  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const status = String(session.status ?? "");
  if (status !== "CASHED_OUT" && status !== "CRASHED") {
    res.status(409).json({ error: "Session belum siap untuk clear settlement." });
    return;
  }

  if (!session.settlement_signature) {
    res.status(409).json({ error: "Settlement signature belum tersedia." });
    return;
  }

  if (session.settlement_tx_hash) {
    res.json({ success: true });
    return;
  }

  await supabase
    .from("game_sessions")
    .update({ settlement_tx_hash: normalizedTxHash })
    .eq("session_id", sessionId);

  res.json({ success: true });
}

async function submitSettlement(req: Request, res: Response) {
  const walletAddress = req.walletAddress!;
  const { sessionId } = req.body as { sessionId?: string };

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId." });
    return;
  }

  const { data: session, error } = await supabase
    .from("game_sessions")
    .select(
      "session_id, wallet_address, onchain_session_id, stake_amount, status, final_multiplier, payout_amount, settlement_signature, settlement_deadline, settlement_tx_hash"
    )
    .eq("session_id", sessionId)
    .eq("wallet_address", walletAddress)
    .single();

  if (error || !session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }

  const status = String(session.status ?? "");
  if (status !== "CASHED_OUT" && status !== "CRASHED") {
    res.status(409).json({ error: "Session belum siap untuk settlement." });
    return;
  }

  try {
    const txHash = await submitSettlementForSession({
      walletAddress,
      session: session as Record<string, unknown>,
    });
    res.json({ success: true, txHash });
  } catch (submitError) {
    console.error(`❌ Failed to submit settlement ${sessionId}:`, submitError);

    if (isAlreadySettledLikeError(submitError)) {
      await supabase
        .from("game_sessions")
        .update({ settlement_tx_hash: "already-settled-onchain" })
        .eq("session_id", sessionId)
        .eq("wallet_address", walletAddress);

      res.json({ success: true, txHash: "already-settled-onchain" });
      return;
    }

    res.status(500).json({ error: toSettlementErrorMessage(submitError) });
  }
}

router.post("/clear-settlement", requireAuth, clearSettlement);
router.post("/clear-claim", requireAuth, clearSettlement);
router.post("/submit-settlement", requireAuth, submitSettlement);

export default router;

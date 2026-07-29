import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import {
  isZeroSessionId,
  readActiveOnchainSession,
  readTransactionStatus,
} from "../lib/celo.js";
import { getWalletFromSocketCookies } from "../middleware/auth.js";
import { getSession } from "../services/sessionStore.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  STEP_INCREMENT_BP,
  CP_BONUS_NUM,
  CP_BONUS_DEN,
  MIN_STAKE,
  MAX_STAKE,
  MIN_STAKE_UNITS,
  MAX_STAKE_UNITS,
  GRACE_PERIOD_MS,
} from "../config/constants.js";
import {
  createGameState,
  getGameByWallet,
  removeGameState,
  hasActiveGame,
  getAllActiveGames,
  type ActiveGameState,
} from "../services/gameState.js";
import {
  isMoveToFast,
  isSpeedHack,
  getEffectiveMultiplierBp,
  isCheckpointRow,
} from "../services/gameValidator.js";
import {
  onReachCheckpoint,
  onLeaveCheckpoint,
  isCpStayExpired,
  getSegmentRemainingMs as timerGetSegmentRemainingMs,
  getCurrentDecayBp,
  getCpStayRemainingMs,
} from "../services/timerAuthority.js";
import {
  SETTLEMENT_OUTCOME,
  generateOnchainSessionId,
  signSettlement,
  type SignedSettlementResult,
  usdcToUint256,
} from "../services/signatureService.js";
import { submitSettlementOnchain } from "../services/settlementExecutor.js";
import {
  closeV2Session,
  debitTicketForSession,
  getPlayerDivision,
  readLastEndedV2Session,
  readMirrorTicketBalance,
  voidAndRefundSession,
  type ClosedV2Session,
} from "../services/ticketPlay.js";
import { getCurrentSeason } from "../services/seasonService.js";

let io: SocketServer;
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGN_SETTLEMENT_TIMEOUT_MS = 10_000;

type SocialSocketAuthPayload = {
  // Field lain (walletAddress, walletProvider, chainId) mungkin masih dikirim
  // frontend lama, tapi diabaikan — hanya session token yang dipercaya.
  token?: string;
};

function formatUsdcValue(value: number) {
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

function isValidUsdcStakeAmount(stake: number): boolean {
  if (!Number.isFinite(stake)) return false;
  const units = Math.round(stake * 1_000_000);
  if (!Number.isInteger(units)) return false;
  if (units < MIN_STAKE_UNITS || units > MAX_STAKE_UNITS) return false;
  const normalizedStake = units / 1_000_000;
  return Math.abs(normalizedStake - stake) < 1e-6;
}

async function signSettlementWithTimeout(params: Parameters<typeof signSettlement>[0]) {
  return await Promise.race<SignedSettlementResult>([
    signSettlement(params),
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`signSettlement timeout after ${SIGN_SETTLEMENT_TIMEOUT_MS}ms`));
      }, SIGN_SETTLEMENT_TIMEOUT_MS);
    }),
  ]);
}

function readGatewayErrorMessage(error: unknown) {
  return String(
    (error as { shortMessage?: string; message?: string })?.shortMessage ||
      (error as { message?: string })?.message ||
      "",
  ).toLowerCase();
}

function isAlreadySettledLikeGatewayError(error: unknown) {
  const raw = readGatewayErrorMessage(error);
  return (
    raw.includes("sessionalreadysettled") ||
    raw.includes("sessionnotactive") ||
    raw.includes("sessionnotfound")
  );
}

function isZeroBytes32(value: string) {
  return isZeroSessionId(value);
}

function usdcUnitsToNumber(amount: bigint) {
  return Number(amount) / 1_000_000;
}

function calculatePayoutFromUnits(stake: number, multiplierBp: number) {
  const stakeUnits = usdcToUint256(stake);
  const payoutUnits = (stakeUnits * BigInt(multiplierBp)) / 10_000n;
  const profitUnits = payoutUnits - stakeUnits;
  return {
    payoutAmount: usdcUnitsToNumber(payoutUnits),
    profit: usdcUnitsToNumber(profitUnits),
  };
}



async function clearActiveOnchainSession(walletAddress: string) {
  const activeOnchainSession = await readActiveOnchainSession(walletAddress);
  if (!activeOnchainSession) {
    return null;
  }

  try {
    const settlementResult = await signSettlementWithTimeout({
      playerAddress: walletAddress,
      onchainSessionId: activeOnchainSession.sessionId,
      stakeAmount: usdcUnitsToNumber(activeOnchainSession.stakeAmountUnits),
      payoutAmount: 0,
      finalMultiplierBp: 0,
      outcome: SETTLEMENT_OUTCOME.CRASHED,
    });

    const settlementTxHash = await submitSettlementOnchain({
      resolution: settlementResult.resolution,
      signature: settlementResult.signature,
    });

    return {
      settlementResult,
      settlementTxHash,
    };
  } catch (error) {
    if (isAlreadySettledLikeGatewayError(error)) {
      const stillActive = await readActiveOnchainSession(walletAddress).catch(() => null);
      if (!stillActive) {
        return {
          settlementResult: null,
          settlementTxHash: "already-settled-onchain",
        };
      }
    }

    throw error;
  }
}

function getWalletFromSocketHandshake(socket: Socket): string | null {
  const cookieWallet = getWalletFromSocketCookies(socket.handshake.headers.cookie);
  if (cookieWallet) {
    return cookieWallet;
  }

  const auth = (socket.handshake.auth ?? {}) as SocialSocketAuthPayload;

  const handshakeToken = String(auth.token || "").trim();
  if (handshakeToken) {
    const tokenWallet = getSession(handshakeToken);
    if (tokenWallet) {
      return tokenWallet;
    }
  }

  // v2 auth §13.1-A: fallback trust-on-claim sudah dihapus — socket WAJIB
  // membawa session cookie atau session token valid di handshake.auth.token.
  // Alamat wallet yang diklaim client tidak pernah dipercaya langsung.
  return null;
}

export function setupGameGateway(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: env.ALLOWED_ORIGINS, credentials: true },
    allowRequest: (_req, callback) => {
      callback(null, true);
    },
  });

  io.on("connection", (socket: Socket) => {
    const walletAddress = getWalletFromSocketHandshake(socket);
    if (!walletAddress) {
      socket.emit("game:error", { message: "Not authenticated. Connect wallet first." });
      socket.emit("error", { message: "Not authenticated. Connect wallet first." });
      socket.disconnect(true);
      return;
    }
    console.log(`🔌 Socket connected: ${walletAddress} (${socket.id})`);

    const existingGame = getGameByWallet(walletAddress);
    if (existingGame && existingGame.isPaused) {
      handleReconnect(socket, walletAddress, existingGame);
      return;
    }

    socket.on(
      "game:start",
      async (data: { stake?: number; onchainSessionId?: string; clientSessionId?: string }) => {
        if (env.GAME_V2_TICKET_MODE) {
          await handleGameStartV2(socket, walletAddress, String(data?.clientSessionId ?? ""));
          return;
        }
        await handleGameStart(socket, walletAddress, Number(data?.stake ?? 0), data?.onchainSessionId);
      },
    );
    // BE-07: the V2 "stop the run" action. Kept alongside game:cashout (same
    // handler) so the engine can migrate event names without a lockstep deploy.
    socket.on("game:end_run", async () => {
      await handleGameCashout(socket, walletAddress);
    });
    socket.on("game:abort_start", async (data: { sessionId?: string; txHash?: string }) => {
      await handleAbortStart(socket, walletAddress, data?.sessionId, data?.txHash);
    });
    socket.on("game:move", (data: { direction: string }) => {
      handleGameMove(socket, walletAddress, data.direction);
    });
    socket.on("game:crash", () => {
      void handleGameCrash(socket, walletAddress, "client_reported");
    });
    socket.on("game:cashout", async () => {
      await handleGameCashout(socket, walletAddress);
    });
    socket.on("disconnect", (reason: string) => {
      handleDisconnect(walletAddress, reason);
    });
  });

  setInterval(checkCpStayTimeouts, 1000);
  console.log("🎮 WebSocket Game Gateway initialized");
  return io;
}

async function handleGameStart(
  socket: Socket,
  walletAddress: string,
  stake: number,
  expectedOnchainSessionId?: string,
): Promise<void> {
  if (!isValidUsdcStakeAmount(stake)) {
    socket.emit("game:error", {
      message: `Invalid stake. Allowed range is ${MIN_STAKE} to ${MAX_STAKE} USDC.`,
    });
    return;
  }
  if (hasActiveGame(walletAddress)) {
    socket.emit("game:error", { message: "You already have an active game session." });
    return;
  }

  const { data: stale } = await supabase
    .from("game_sessions")
    .select("session_id, onchain_session_id, stake_amount")
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .maybeSingle();

  if (stale) {
    socket.emit("game:error", {
      message: "Previous ACTIVE session still exists. Resolve settlement first.",
    });
    return;
  }

  let activeOnchainSession = await readActiveOnchainSession(walletAddress).catch((error) => {
    console.error("❌ Failed to verify on-chain session state before starting a new run:", error);
    return null;
  });

  if (!activeOnchainSession && expectedOnchainSessionId) {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      activeOnchainSession = await readActiveOnchainSession(walletAddress).catch(() => null);
      if (activeOnchainSession) break;
    }
  }

  if (!activeOnchainSession) {
    socket.emit("game:error", {
      message: "No active on-chain session found. Start session transaction first.",
    });
    return;
  }

  if (
    expectedOnchainSessionId &&
    activeOnchainSession.sessionId.toLowerCase() !== expectedOnchainSessionId.toLowerCase()
  ) {
    socket.emit("game:error", {
      message: "On-chain session mismatch. Re-sync and start again.",
    });
    return;
  }

  const sessionId = uuidv4();
  const onchainSessionId = activeOnchainSession.sessionId;
  const onchainStake = Number(activeOnchainSession.stakeAmountUnits) / 1_000_000;

  const { data: existingOnchain } = await supabase
    .from("game_sessions")
    .select("status")
    .eq("onchain_session_id", onchainSessionId)
    .maybeSingle();

  if (existingOnchain) {
    socket.emit("game:error", {
      message: "Previous game settlement still pending on-chain. Please wait.",
    });
    return;
  }

  const { error: dbError } = await supabase.from("game_sessions").insert({
    session_id: sessionId,
    onchain_session_id: onchainSessionId,
    wallet_address: walletAddress,
    stake_amount: onchainStake,
    status: "ACTIVE",
  });

  if (dbError) {
    console.error("❌ Supabase Error (game-start):", {
      message: dbError.message,
      details: dbError.details,
      hint: dbError.hint,
      code: dbError.code,
    });
    socket.emit("game:error", { message: `Failed to start game: ${dbError.message}` });
    return;
  }

  const { data: player } = await supabase
    .from("players")
    .select("total_games")
    .eq("wallet_address", walletAddress)
    .single();

  if (player) {
    await supabase
      .from("players")
      .update({ total_games: player.total_games + 1 })
      .eq("wallet_address", walletAddress);
  }

  createGameState(sessionId, onchainSessionId, walletAddress, onchainStake, socket.id);

  const mapSeed = Math.floor(Math.random() * 999999);
  const stakeAmountUnits = activeOnchainSession.stakeAmountUnits.toString();

  console.log(`🎮 Game started: ${walletAddress} | Stake: $${onchainStake} | Session: ${sessionId} | Onchain: ${onchainSessionId}`);
  socket.emit("game:started", {
    sessionId,
    onchainSessionId,
    stake: onchainStake,
    stakeAmountUnits,
    mapSeed,
    serverTime: Date.now(),
  });
}

/// ── BE-07 V2 one-ticket flow (docs/be07-game-session-contract.md) ─────────

function emitStartError(
  socket: Socket,
  code: string,
  message: string,
  retryable: boolean,
  data?: Record<string, unknown>,
): void {
  socket.emit("game:start_error", { success: false, code, message, retryable, ...(data ? { data } : {}) });
  // Legacy channel so pre-cutover clients still surface something readable.
  socket.emit("game:error", { message });
}

async function emitStartedV2(
  socket: Socket,
  state: ActiveGameState,
  clientSessionId: string,
  seasonId: number | null,
  ticketBalanceAfter: number,
  replayed: boolean,
): Promise<void> {
  const division = await getPlayerDivision(state.walletAddress);
  socket.emit("game:started", {
    success: true,
    session: {
      sessionId: state.sessionId,
      clientSessionId,
      ticketCost: 1,
      ticketBalanceAfter: String(ticketBalanceAfter),
      seasonId,
      division,
      startedAt: new Date().toISOString(),
    },
    replayed,
    // Engine-facing extras (same fields the V1 start emitted).
    sessionId: state.sessionId,
    mapSeed: state.mapSeed,
    serverTime: Date.now(),
  });
}

async function handleGameStartV2(
  socket: Socket,
  walletAddress: string,
  clientSessionId: string,
  isRetryAfterConflict = false,
): Promise<void> {
  if (!UUID_V4_RE.test(clientSessionId)) {
    emitStartError(socket, "INVALID_REQUEST", "clientSessionId must be a UUID v4.", false);
    return;
  }

  // Idempotent replay: one row per (wallet, client intent).
  const { data: existing, error: existingError } = await supabase
    .from("game_sessions")
    .select("session_id, status, season_id")
    .eq("wallet_address", walletAddress)
    .eq("client_session_id", clientSessionId)
    .maybeSingle();

  if (existingError) {
    console.error("❌ V2 start intent lookup failed:", existingError);
    emitStartError(socket, "INTERNAL", "Failed to start the game. Try again.", true);
    return;
  }

  if (existing) {
    const mem = getGameByWallet(walletAddress);
    if (existing.status === "ACTIVE" && mem && mem.sessionId === String(existing.session_id)) {
      // Same intent, session alive: rebind the socket and replay the response.
      mem.socketId = socket.id;
      const balance = await readMirrorTicketBalance(walletAddress);
      await emitStartedV2(socket, mem, clientSessionId, existing.season_id ?? null, balance, true);
      return;
    }
    if (existing.status === "ACTIVE") {
      // Orphan from a previous process: no moves survive a restart, so BE-07
      // §5 applies - void it, refund the ticket, and ask for a fresh intent.
      await voidAndRefundSession(String(existing.session_id), walletAddress);
      emitStartError(
        socket,
        "SESSION_CONSUMED",
        "Your interrupted session was voided and the ticket refunded. Start again.",
        true,
      );
      return;
    }
    emitStartError(
      socket,
      "SESSION_CONSUMED",
      "This clientSessionId was already used by a finished session. Generate a new one.",
      false,
    );
    return;
  }

  if (hasActiveGame(walletAddress)) {
    const mem = getGameByWallet(walletAddress);
    emitStartError(socket, "SESSION_ALREADY_ACTIVE", "You already have an active game session.", false, {
      activeSession: mem ? { sessionId: mem.sessionId } : undefined,
    });
    return;
  }

  const { data: staleActive } = await supabase
    .from("game_sessions")
    .select("session_id, client_session_id, created_at")
    .eq("wallet_address", walletAddress)
    .eq("status", "ACTIVE")
    .eq("game_mode", "V2_TICKET")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (staleActive) {
    emitStartError(socket, "SESSION_ALREADY_ACTIVE", "A previous session is still active. Recover it first.", false, {
      activeSession: {
        sessionId: staleActive.session_id,
        clientSessionId: staleActive.client_session_id,
        startedAt: staleActive.created_at,
      },
    });
    return;
  }

  const season = await getCurrentSeason().catch(() => null);
  if (season && season.status !== "ACTIVE") {
    emitStartError(socket, "SEASON_FROZEN", "Season reset in progress. Try again in a moment.", true);
    return;
  }

  const sessionId = uuidv4();
  const { error: insertError } = await supabase.from("game_sessions").insert({
    session_id: sessionId,
    wallet_address: walletAddress,
    stake_amount: 0,
    status: "ACTIVE",
    game_mode: "V2_TICKET",
    client_session_id: clientSessionId,
    season_id: season?.id ?? null,
  });

  if (insertError) {
    // 23505 = a concurrent start with the same intent won the insert race;
    // re-enter once so it resolves through the replay path above.
    if (insertError.code === "23505" && !isRetryAfterConflict) {
      await handleGameStartV2(socket, walletAddress, clientSessionId, true);
      return;
    }
    console.error("❌ V2 start insert failed:", insertError);
    emitStartError(socket, "INTERNAL", "Failed to start the game. Try again.", true);
    return;
  }

  let debit;
  try {
    debit = await debitTicketForSession(walletAddress, sessionId);
  } catch (debitError) {
    console.error("❌ V2 ticket debit failed:", debitError);
    await supabase.from("game_sessions").delete().eq("session_id", sessionId);
    emitStartError(socket, "TICKET_STATE_SYNCING", "Ticket balance is syncing. Try again shortly.", true);
    return;
  }

  if (debit.code === "INSUFFICIENT_TICKETS") {
    await supabase.from("game_sessions").delete().eq("session_id", sessionId);
    emitStartError(socket, "INSUFFICIENT_TICKETS", "You have no tickets. Claim your daily reward or top up.", false, {
      ticketBalance: String(debit.balance),
    });
    return;
  }
  if (debit.code === "SESSION_ALREADY_ACTIVE") {
    await supabase.from("game_sessions").delete().eq("session_id", sessionId);
    emitStartError(socket, "SESSION_ALREADY_ACTIVE", "Another session already spent a ticket and is still active.", false);
    return;
  }

  const { data: player } = await supabase
    .from("players")
    .select("total_games")
    .eq("wallet_address", walletAddress)
    .single();
  if (player) {
    await supabase
      .from("players")
      .update({ total_games: player.total_games + 1 })
      .eq("wallet_address", walletAddress);
  }

  const state = createGameState(sessionId, "", walletAddress, 0, socket.id, { mode: "V2_TICKET" });
  console.log(`🎟️ V2 game started: ${walletAddress} | Session: ${sessionId} | Balance after: ${debit.balance}`);
  await emitStartedV2(socket, state, clientSessionId, season?.id ?? null, debit.balance, false);
}

/// A duplicate crash/end_run should still land within seconds of the real one;
/// anything older is treated as "no active session" instead of a replay.
const V2_END_REPLAY_WINDOW_MS = 60 * 1000;

function emitEndedV2(socket: Socket, sessionId: string, result: ClosedV2Session): void {
  socket.emit("game:ended", {
    success: true,
    result: {
      sessionId,
      status: result.status,
      finalCheckpoint: result.finalCheckpoint,
      pointsAwarded: result.pointsAwarded,
      seasonPointsTotal: result.seasonPointsTotal,
      seasonId: result.seasonId,
      division: result.division,
      ticketBalance: String(result.ticketBalance),
      endedAt: result.endedAt,
    },
  });
}

/// Replays `game:ended` for a session that closed moments ago (BE-07 §4:
/// sending crash/end_run twice returns the same result, never double points).
/// Returns false when there is nothing recent to replay, so the caller can
/// fall back to its usual "no active session" error.
async function replayRecentV2End(socket: Socket, walletAddress: string): Promise<boolean> {
  if (!env.GAME_V2_TICKET_MODE) return false;
  const last = await readLastEndedV2Session(walletAddress, V2_END_REPLAY_WINDOW_MS).catch((err: unknown) => {
    console.error("❌ V2 end replay lookup failed:", err);
    return null;
  });
  if (!last) return false;
  emitEndedV2(socket, last.sessionId, last);
  return true;
}

/// Closes a V2 session from in-memory state and emits `game:ended`.
async function closeV2FromState(
  socket: Socket | null,
  state: ActiveGameState,
  status: "CRASHED" | "COMPLETED",
  reason?: string,
): Promise<void> {
  // Disconnect-orphan with zero recorded moves: BE-07 §5 refund policy.
  if (!socket && status === "CRASHED" && state.moveTimestamps.length === 0) {
    await voidAndRefundSession(state.sessionId, state.walletAddress);
    removeGameState(state.walletAddress);
    return;
  }

  try {
    const result = await closeV2Session({
      sessionId: state.sessionId,
      walletAddress: state.walletAddress,
      status,
      maxRow: state.maxRow,
    });

    console.log(
      `🏁 V2 ${status}: ${state.walletAddress} | CP ${result.finalCheckpoint} | +${result.pointsAwarded} pts${reason ? ` | ${reason}` : ""}`,
    );

    if (socket) {
      emitEndedV2(socket, state.sessionId, result);
      if (status === "CRASHED") {
        // Engine-facing legacy event so the death animation keeps working.
        socket.emit("game:crashed", {
          reason: reason ?? "crashed",
          finalRow: state.maxRow,
          sessionId: state.sessionId,
        });
      }
    }
  } catch (closeError) {
    console.error(`❌ Failed to close V2 session ${state.sessionId}:`, closeError);
    socket?.emit("game:error", { message: "Failed to close the game session." });
  }

  removeGameState(state.walletAddress);
}

async function canAbortStartSession(txHash?: string): Promise<{ canAbort: boolean; message?: string }> {
  if (!txHash) {
    return { canAbort: true };
  }

  try {
    const status = await readTransactionStatus(txHash);
    if (!status.found) {
      throw new Error("transaction not found");
    }
    if (status.success === false) {
      return { canAbort: true };
    }
    return {
      canAbort: false,
      message:
        "Transaksi startSession sudah masuk chain. Lanjutkan game/reconnect, jangan abort.",
    };
  } catch (error) {
    const message = String(
      (error as { shortMessage?: string; message?: string })?.shortMessage ||
        (error as { message?: string })?.message ||
        "",
    ).toLowerCase();

    const isUncertainState =
      message.includes("not found") ||
      message.includes("unknown transaction") ||
      message.includes("could not find");

    if (isUncertainState) {
      return {
        canAbort: false,
        message:
          "Status transaksi startSession belum final. Tunggu konfirmasi lalu reconnect.",
      };
    }

    console.error("❌ Failed to verify startSession tx status before abort:", error);
    return {
      canAbort: false,
      message:
        "Gagal verifikasi status transaksi startSession. Coba lagi beberapa saat.",
    };
  }
}

async function handleAbortStart(
  socket: Socket,
  walletAddress: string,
  sessionId?: string,
  txHash?: string,
): Promise<void> {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    socket.emit("game:error", { message: "No active game session to abort." });
    return;
  }

  if (sessionId && sessionId !== state.sessionId) {
    socket.emit("game:error", { message: "Session mismatch while aborting start." });
    return;
  }

  const abortCheck = await canAbortStartSession(txHash);
  if (!abortCheck.canAbort) {
    socket.emit("game:error", {
      message:
        abortCheck.message ||
        "Start session belum bisa di-abort karena status tx masih belum pasti.",
    });
    return;
  }

  removeGameState(walletAddress);

  await supabase
    .from("game_sessions")
    .delete()
    .eq("session_id", state.sessionId)
    .eq("wallet_address", walletAddress);

  const { data: player } = await supabase
    .from("players")
    .select("total_games")
    .eq("wallet_address", walletAddress)
    .single();

  if (player && player.total_games > 0) {
    await supabase
      .from("players")
      .update({ total_games: player.total_games - 1 })
      .eq("wallet_address", walletAddress);
  }

  console.log(`↩️ Start aborted: ${walletAddress} | Session: ${state.sessionId}`);
  socket.emit("game:start_aborted", {
    sessionId: state.sessionId,
    message: "Start bet dibatalkan karena transaksi startSession gagal/revert.",
  });
}

function handleGameMove(socket: Socket, walletAddress: string, direction: string): void {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    socket.emit("game:error", { message: "No active game session." });
    return;
  }

  const isKnownDirection =
    direction === "forward" ||
    direction === "backward" ||
    direction === "left" ||
    direction === "right";

  if (!isKnownDirection) {
    socket.emit("game:error", { message: "Invalid move direction." });
    return;
  }

  const now = Date.now();

  if (isMoveToFast(state.lastMoveTime, now)) {
    console.warn(`⚠️ Fast move: ${walletAddress} (${now - state.lastMoveTime}ms)`);
  }
  state.moveTimestamps.push(now);
  if (state.moveTimestamps.length > 50) {
    state.moveTimestamps = state.moveTimestamps.slice(-50);
  }
  if (isSpeedHack(state.moveTimestamps)) {
    console.error(`🚨 SPEED HACK: ${walletAddress}`);
    void handleGameCrash(socket, walletAddress, "speedhack_detected");
    return;
  }
  state.lastMoveTime = now;

  if (direction === "forward") {
    state.currentRow += 1;
    if (state.currentRow > state.maxRow) {
      state.maxRow = state.currentRow;
      state.multiplierBp += STEP_INCREMENT_BP;
      if (isCheckpointRow(state.currentRow)) {
        state.currentCp += 1;
        state.multiplierBp = Math.floor((state.multiplierBp * CP_BONUS_NUM) / CP_BONUS_DEN);
        state.multiplierBp = getEffectiveMultiplierBp(state.multiplierBp, state.timer.segmentStart, now);
        state.timer = onReachCheckpoint(state.timer);
        state.cashoutWindow = true;
        state.cpRowIndex = state.currentRow;
        state.isAtCheckpoint = true;
        console.log(
          `🏁 CP ${state.currentCp} by ${walletAddress} row ${state.currentRow} | ${(state.multiplierBp / 10000).toFixed(4)}x`
        );
      }
    }

    if (state.cashoutWindow && state.currentRow > state.cpRowIndex) {
      state.cashoutWindow = false;
      state.isAtCheckpoint = false;
      state.timer = onLeaveCheckpoint(state.timer);
    }
  } else if (direction === "backward") {
    state.currentRow = Math.max(0, state.currentRow - 1);
    if (state.cashoutWindow && state.currentRow !== state.cpRowIndex) {
      state.cashoutWindow = false;
      state.isAtCheckpoint = false;
      state.timer = onLeaveCheckpoint(state.timer);
    }
  }

  const effectiveMultBp = state.timer.segmentActive
    ? getEffectiveMultiplierBp(state.multiplierBp, state.timer.segmentStart, now)
    : state.multiplierBp;

  socket.emit("game:state", {
    row: state.currentRow,
    maxRow: state.maxRow,
    multiplierBp: effectiveMultBp,
    multiplier: (effectiveMultBp / 10000).toFixed(4),
    cp: state.currentCp,
    cashoutWindow: state.cashoutWindow,
    segmentRemainingMs: timerGetSegmentRemainingMs(state.timer, now),
    cpStayRemainingMs: getCpStayRemainingMs(state.timer, now),
    decayBp: getCurrentDecayBp(state.timer, now),
    serverTime: now,
  });
}

async function handleGameCrash(
  socket: Socket | null,
  walletAddress: string,
  reason: string
): Promise<void> {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    // `socket` is null for server-side crashes (disconnect sweep); only a real
    // client resending game:crash needs the idempotent replay.
    if (socket) await replayRecentV2End(socket, walletAddress);
    return;
  }

  if (state.mode === "V2_TICKET") {
    await closeV2FromState(socket, state, "CRASHED", reason);
    return;
  }

  const effectiveMultBp = state.timer.segmentActive
    ? getEffectiveMultiplierBp(state.multiplierBp, state.timer.segmentStart, Date.now())
    : state.multiplierBp;

  console.log(`💀 CRASHED: ${walletAddress} | Row: ${state.maxRow} | Reason: ${reason}`);

  let settlementResult = null;
  let settlementTxHash: string | null = null;
  try {
    settlementResult = await signSettlementWithTimeout({
      playerAddress: walletAddress,
      onchainSessionId: state.onchainSessionId,
      stakeAmount: state.stake,
      payoutAmount: 0,
      finalMultiplierBp: 0,
      outcome: SETTLEMENT_OUTCOME.CRASHED,
    });

    settlementTxHash = await submitSettlementOnchain({
      resolution: settlementResult.resolution,
      signature: settlementResult.signature,
    });
  } catch (err) {
    console.error("❌ Crash settlement failed:", err);
  }

  await supabase
    .from("game_sessions")
    .update({
      status: "CRASHED",
      max_row_reached: state.maxRow,
      final_multiplier: effectiveMultBp / 10000,
      payout_amount: 0,
      settlement_signature: settlementResult?.signature ?? null,
      settlement_deadline: settlementResult?.resolution.deadline ?? null,
      settlement_tx_hash: settlementTxHash,
      ended_at: new Date().toISOString(),
    })
    .eq("session_id", state.sessionId);

  const { data: player } = await supabase
    .from("players")
    .select("total_losses, total_profit")
    .eq("wallet_address", walletAddress)
    .single();

  if (player) {
    await supabase
      .from("players")
      .update({
        total_losses: player.total_losses + 1,
        total_profit: player.total_profit - state.stake,
      })
      .eq("wallet_address", walletAddress);
  }

  if (socket) {
    socket.emit("game:crashed", {
      reason,
      finalRow: state.maxRow,
      multiplier: (effectiveMultBp / 10000).toFixed(4),
      stakeLost: state.stake,
      sessionId: state.sessionId,
      onchainSessionId: state.onchainSessionId,
      settlementSignature: settlementResult?.signature ?? null,
      resolution: settlementResult?.resolution ?? null,
      signerAddress: settlementResult?.signerAddress ?? null,
      settlementTxHash,
    });
  }

  removeGameState(walletAddress);
}

async function handleGameCashout(socket: Socket, walletAddress: string): Promise<void> {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    if (await replayRecentV2End(socket, walletAddress)) return;
    socket.emit("game:error", { message: "No active game session." });
    return;
  }
  if (!state.cashoutWindow) {
    socket.emit("game:error", { message: "Must be at checkpoint to cash out." });
    return;
  }
  if (isCpStayExpired(state.timer)) {
    state.cashoutWindow = false;
    state.isAtCheckpoint = false;
    state.timer = onLeaveCheckpoint(state.timer);
    socket.emit("game:cp_expired", { message: "Checkpoint time expired. Keep moving!" });
    socket.emit("game:error", { message: "Checkpoint time expired. Keep moving!" });
    return;
  }

  if (state.mode === "V2_TICKET") {
    await closeV2FromState(socket, state, "COMPLETED");
    return;
  }

  const finalMultiplierBp = state.multiplierBp;
  const finalMultiplier = finalMultiplierBp / 10000;
  const { payoutAmount, profit } = calculatePayoutFromUnits(
    state.stake,
    finalMultiplierBp,
  );
  console.log(`💰 CASH OUT: ${walletAddress} | ${finalMultiplier.toFixed(4)}x | $${formatUsdcValue(payoutAmount)}`);

  let settlementResult;
  let settlementTxHash: string | null = null;
  try {
    settlementResult = await signSettlementWithTimeout({
      playerAddress: walletAddress,
      onchainSessionId: state.onchainSessionId,
      stakeAmount: state.stake,
      payoutAmount,
      finalMultiplierBp,
      outcome: SETTLEMENT_OUTCOME.CASHED_OUT,
    });
  } catch (signError) {
    console.error("❌ Cashout settlement signing failed:", signError);
    socket.emit("game:error", { message: "Failed to settle game result." });
    return;
  }

  try {
    settlementTxHash = await submitSettlementOnchain({
      resolution: settlementResult.resolution,
      signature: settlementResult.signature,
    });
  } catch (submitError) {
    console.error("⚠️ Cashout settlement submit failed (will remain pending):", submitError);
  }

  await supabase
    .from("game_sessions")
    .update({
      status: "CASHED_OUT",
      max_row_reached: state.maxRow,
      final_multiplier: finalMultiplier,
      payout_amount: payoutAmount,
      settlement_signature: settlementResult.signature,
      settlement_deadline: settlementResult.resolution.deadline,
      settlement_tx_hash: settlementTxHash,
      ended_at: new Date().toISOString(),
    })
    .eq("session_id", state.sessionId);

  const { data: player } = await supabase
    .from("players")
    .select("total_wins, total_profit")
    .eq("wallet_address", walletAddress)
    .single();

  if (player) {
    await supabase
      .from("players")
      .update({
        total_wins: player.total_wins + 1,
        total_profit: player.total_profit + profit,
      })
      .eq("wallet_address", walletAddress);
  }

  socket.emit("game:cashout_result", {
    sessionId: state.sessionId,
    onchainSessionId: state.onchainSessionId,
    multiplier: finalMultiplier.toFixed(4),
    payoutAmount,
    profit,
    settlementSignature: settlementResult.signature,
    resolution: settlementResult.resolution,
    signature: settlementResult.signature,
    payload: settlementResult.resolution,
    signerAddress: settlementResult.signerAddress,
    settlementTxHash,
  });

  removeGameState(walletAddress);
}

function handleDisconnect(walletAddress: string, reason: string): void {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    console.log(`🔌 Disconnected: ${walletAddress} (no game)`);
    return;
  }
  console.log(`⚡ Disconnect: ${walletAddress} | Reason: ${reason} | At CP: ${state.isAtCheckpoint}`);

  if (state.isAtCheckpoint && state.cashoutWindow) {
    console.log(`🔄 Auto cash-out at CP: ${walletAddress}`);
    void handleAutoCashout(walletAddress);
    return;
  }

  state.isPaused = true;
  state.pauseStart = Date.now();
  state.disconnectTimer = setTimeout(async () => {
    console.log(`⏰ Grace period expired: ${walletAddress} — CRASH`);
    await handleGameCrash(null, walletAddress, "disconnect_timeout");
  }, GRACE_PERIOD_MS);
  console.log(`⏳ Grace period (${GRACE_PERIOD_MS / 1000}s): ${walletAddress}`);
}

function handleReconnect(socket: Socket, walletAddress: string, state: ActiveGameState): void {
  console.log(`🔄 Reconnected: ${walletAddress} (paused ${Date.now() - state.pauseStart}ms)`);
  if (state.disconnectTimer) {
    clearTimeout(state.disconnectTimer);
    state.disconnectTimer = null;
  }
  state.isPaused = false;
  state.socketId = socket.id;
  if (state.timer.segmentActive) {
    state.timer.segmentStart += Date.now() - state.pauseStart;
  }

  const effectiveMultBp = state.timer.segmentActive
    ? getEffectiveMultiplierBp(state.multiplierBp, state.timer.segmentStart, Date.now())
    : state.multiplierBp;

  socket.emit("game:reconnected", {
    sessionId: state.sessionId,
    onchainSessionId: state.onchainSessionId,
    stake: state.stake,
    stakeAmountUnits: usdcToUint256(state.stake).toString(),
    row: state.currentRow,
    maxRow: state.maxRow,
    multiplierBp: effectiveMultBp,
    multiplier: (effectiveMultBp / 10000).toFixed(4),
    cp: state.currentCp,
    cashoutWindow: state.cashoutWindow,
    segmentRemainingMs: timerGetSegmentRemainingMs(state.timer),
    cpStayRemainingMs: getCpStayRemainingMs(state.timer),
    decayBp: getCurrentDecayBp(state.timer),
    serverTime: Date.now(),
  });

  socket.on("game:move", (data: { direction: string }) => {
    handleGameMove(socket, walletAddress, data.direction);
  });
  socket.on("game:abort_start", async (data: { sessionId?: string; txHash?: string }) => {
    await handleAbortStart(socket, walletAddress, data?.sessionId, data?.txHash);
  });
  socket.on("game:crash", () => {
    void handleGameCrash(socket, walletAddress, "client_reported");
  });
  socket.on("game:cashout", async () => {
    await handleGameCashout(socket, walletAddress);
  });
  socket.on("disconnect", (reason: string) => {
    handleDisconnect(walletAddress, reason);
  });
}

async function handleAutoCashout(walletAddress: string): Promise<void> {
  const state = getGameByWallet(walletAddress);
  if (!state) {
    return;
  }

  const finalMultiplierBp = state.multiplierBp;
  const finalMultiplier = finalMultiplierBp / 10000;
  const { payoutAmount, profit } = calculatePayoutFromUnits(
    state.stake,
    finalMultiplierBp,
  );
  console.log(`🤖 AUTO CASH OUT: ${walletAddress} | ${finalMultiplier.toFixed(4)}x | $${formatUsdcValue(payoutAmount)}`);

  let settlementResult;
  let settlementTxHash: string | null = null;
  try {
    settlementResult = await signSettlementWithTimeout({
      playerAddress: walletAddress,
      onchainSessionId: state.onchainSessionId,
      stakeAmount: state.stake,
      payoutAmount,
      finalMultiplierBp,
      outcome: SETTLEMENT_OUTCOME.CASHED_OUT,
    });
  } catch {
    await handleGameCrash(null, walletAddress, "auto_cashout_sign_failed");
    return;
  }

  try {
    settlementTxHash = await submitSettlementOnchain({
      resolution: settlementResult.resolution,
      signature: settlementResult.signature,
    });
  } catch (submitError) {
    console.error("⚠️ Auto cashout settlement submit failed (will remain pending):", submitError);
  }

  await supabase
    .from("game_sessions")
    .update({
      status: "CASHED_OUT",
      max_row_reached: state.maxRow,
      final_multiplier: finalMultiplier,
      payout_amount: payoutAmount,
      settlement_signature: settlementResult.signature,
      settlement_deadline: settlementResult.resolution.deadline,
      settlement_tx_hash: settlementTxHash,
      ended_at: new Date().toISOString(),
    })
    .eq("session_id", state.sessionId);

  const { data: player } = await supabase
    .from("players")
    .select("total_wins, total_profit")
    .eq("wallet_address", walletAddress)
    .single();

  if (player) {
    await supabase
      .from("players")
      .update({
        total_wins: player.total_wins + 1,
        total_profit: player.total_profit + profit,
      })
      .eq("wallet_address", walletAddress);
  }

  removeGameState(walletAddress);
}

function checkCpStayTimeouts(): void {
  for (const state of getAllActiveGames()) {
    if (!state.cashoutWindow || state.isPaused) {
      continue;
    }
    if (isCpStayExpired(state.timer)) {
      console.log(`⏰ CP stay expired: ${state.walletAddress}`);
      state.cashoutWindow = false;
      state.isAtCheckpoint = false;
      state.timer = onLeaveCheckpoint(state.timer);
      const socket = io?.sockets.sockets.get(state.socketId);
      if (socket) {
        socket.emit("game:cp_expired", { message: "Checkpoint time expired. Keep moving!" });
      }
    }
  }
}

import type { Server as HttpServer } from "node:http";
import { Server as SocketServer, type Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import {
  isZeroSessionId,
  readActiveOnchainSession,
  readTransactionStatus,
} from "../lib/celo.js";
import { getWalletFromSocketCookies } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { isValidEvmAddress, normalizeEvmAddress } from "../utils/celo.js";
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

let io: SocketServer;
const SIGN_SETTLEMENT_TIMEOUT_MS = 10_000;

type SocialSocketAuthPayload = {
  walletAddress?: string;
  walletProvider?: string;
  chainId?: number | string;
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

  if (!env.SOCIAL_AUTH_ENABLED) {
    return null;
  }

  const auth = (socket.handshake.auth ?? {}) as SocialSocketAuthPayload;
  const walletProvider = String(auth.walletProvider || "").toLowerCase();
  const claimedAddress = String(auth.walletAddress || "");
  void auth.chainId;

  const isSocialOrEmbedded =
    walletProvider.includes("reown") ||
    walletProvider.includes("appkit") ||
    walletProvider === "google" ||
    walletProvider === "apple" ||
    walletProvider === "discord" ||
    walletProvider === "x";

  if (!isSocialOrEmbedded || !isValidEvmAddress(claimedAddress)) {
    return null;
  }

  return normalizeEvmAddress(claimedAddress);
}

export function setupGameGateway(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
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

    socket.on("game:start", async (data: { stake: number; onchainSessionId?: string }) => {
      await handleGameStart(socket, walletAddress, data.stake, data.onchainSessionId);
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

  const activeOnchainSession = await readActiveOnchainSession(walletAddress).catch((error) => {
    console.error("❌ Failed to verify on-chain session state before starting a new run:", error);
    return null;
  });

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

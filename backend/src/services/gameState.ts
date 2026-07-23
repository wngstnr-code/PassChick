import type { TimerState } from "./timerAuthority.js";
import { createTimerState } from "./timerAuthority.js";

export type GameMode = "V1" | "V2_TICKET";

export interface ActiveGameState {
  sessionId: string;
  onchainSessionId: string;
  walletAddress: string;
  stake: number;
  /// BE-07: V2_TICKET sessions cost 1 off-chain ticket and settle to season
  /// points instead of USDC; V1 keeps the stake/settlement flow.
  mode: GameMode;
  /// Persisted so an idempotent `game:start` replay can re-emit the same map.
  mapSeed: number;
  multiplierBp: number;
  currentRow: number;
  maxRow: number;
  currentCp: number;
  cashoutWindow: boolean;
  cpRowIndex: number;
  timer: TimerState;
  lastMoveTime: number;
  moveTimestamps: number[];
  isAtCheckpoint: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  isPaused: boolean;
  pauseStart: number;
  socketId: string;
}

const activeGames = new Map<string, ActiveGameState>();
const sessionToWallet = new Map<string, string>();

export function createGameState(
  sessionId: string,
  onchainSessionId: string,
  walletAddress: string,
  stake: number,
  socketId: string,
  options?: { mode?: GameMode; mapSeed?: number }
): ActiveGameState {
  const state: ActiveGameState = {
    sessionId, onchainSessionId, walletAddress, stake, multiplierBp: 0, currentRow: 0, maxRow: 0, currentCp: 0,
    mode: options?.mode ?? "V1",
    mapSeed: options?.mapSeed ?? Math.floor(Math.random() * 999999),
    cashoutWindow: false, cpRowIndex: 0, timer: createTimerState(), lastMoveTime: 0,
    moveTimestamps: [], isAtCheckpoint: false, disconnectTimer: null, isPaused: false, pauseStart: 0, socketId,
  };
  activeGames.set(walletAddress, state);
  sessionToWallet.set(sessionId, walletAddress);
  return state;
}

export function getGameByWallet(walletAddress: string): ActiveGameState | null {
  return activeGames.get(walletAddress) ?? null;
}

export function removeGameState(walletAddress: string): void {
  const state = activeGames.get(walletAddress);
  if (state) {
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    sessionToWallet.delete(state.sessionId);
    activeGames.delete(walletAddress);
  }
}

export function hasActiveGame(walletAddress: string): boolean {
  return activeGames.has(walletAddress);
}

export function getAllActiveGames(): ActiveGameState[] {
  return Array.from(activeGames.values());
}

export function getActiveGameCount(): number {
  return activeGames.size;
}

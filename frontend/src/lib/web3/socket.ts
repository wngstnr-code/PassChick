import { io, type Socket } from "socket.io-client";
import { BACKEND_API_URL } from "../backend/config";

let socket: Socket | null = null;

type SocketCallback = (...args: unknown[]) => void;
type GameEventSocket = {
  on: (event: string, callback: SocketCallback) => void;
  off: (event: string, callback: SocketCallback) => void;
};

export interface GameStartedPayload {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  stakeAmountUnits: string;
  mapSeed: number;
  serverTime: number;
}

export interface GameStatePayload {
  row: number;
  maxRow: number;
  multiplierBp: number;
  multiplier: string;
  cp: number;
  cashoutWindow: boolean;
  segmentRemainingMs: number;
  cpStayRemainingMs: number;
  decayBp: number;
  serverTime: number;
}

export interface GameCrashedPayload {
  reason: string;
  finalRow: number;
  multiplier: string;
  stakeLost: number;
  sessionId: string;
  onchainSessionId: string;
  settlementSignature: string | null;
  resolution: Record<string, unknown> | null;
  signerAddress: string | null;
  settlementTxHash: string | null;
}

export interface GameCashoutResultPayload {
  sessionId: string;
  onchainSessionId: string;
  multiplier: string;
  payoutAmount: number;
  profit: number;
  settlementSignature: string;
  resolution: Record<string, unknown>;
  signature: string;
  payload: Record<string, unknown>;
  signerAddress: string;
  settlementTxHash: string | null;
}

export interface GameReconnectedPayload {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  stakeAmountUnits: string;
  row: number;
  maxRow: number;
  multiplierBp: number;
  multiplier: string;
  cp: number;
  cashoutWindow: boolean;
  segmentRemainingMs: number;
  cpStayRemainingMs: number;
  decayBp: number;
  serverTime: number;
}

export interface GameStartAbortedPayload {
  sessionId: string;
  message: string;
}

export interface GameErrorPayload {
  message: string;
}

export interface GameCpExpiredPayload {
  message: string;
}

export type GameEventMap = {
  "game:started": (payload: GameStartedPayload) => void;
  "game:state": (payload: GameStatePayload) => void;
  "game:crashed": (payload: GameCrashedPayload) => void;
  "game:cashout_result": (payload: GameCashoutResultPayload) => void;
  "game:reconnected": (payload: GameReconnectedPayload) => void;
  "game:start_aborted": (payload: GameStartAbortedPayload) => void;
  "game:cp_expired": (payload: GameCpExpiredPayload) => void;
  "game:error": (payload: GameErrorPayload) => void;
  connect: () => void;
  disconnect: () => void;
};

type OutboundGameEventMap = {
  "game:start": { stake: number; onchainSessionId?: string };
  "game:move": { direction: string };
  "game:crash": Record<string, never>;
  "game:cashout": Record<string, never>;
  "game:abort_start": { sessionId?: string; txHash?: string };
};

export function initializeSocket(
  walletAddress?: string,
  walletProvider?: string
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (socket && socket.connected) {
      resolve(socket);
      return;
    }

    const socketUrl = BACKEND_API_URL.replace(/\/$/, "");

    const auth = walletAddress
      ? {
          walletAddress,
          walletProvider: walletProvider || "default",
          chainId: 101,
        }
      : undefined;

    socket = io(socketUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ["websocket"],
      ...(auth && { auth }),
    });

    socket.on("connect", () => {
      console.log("✅ Socket connected");
      resolve(socket!);
    });

    socket.on("connect_error", (error) => {
      console.error("❌ Socket connection error:", error);
      reject(error);
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Socket disconnected: ${reason}`);
    });
  });
}

export function getSocket(): Socket | null {
  return socket;
}

export function emitGameEvent<K extends keyof OutboundGameEventMap>(
  event: K,
  payload: OutboundGameEventMap[K]
): boolean {
  if (!socket || !socket.connected) {
    console.warn(`⚠️ Socket not connected, cannot emit ${event}`);
    return false;
  }
  socket.emit(event, payload);
  return true;
}

export function onGameEvent<K extends keyof GameEventMap>(
  event: K,
  callback: GameEventMap[K]
): () => void {
  if (!socket) {
    console.warn(`⚠️ Socket not initialized, cannot listen to ${event}`);
    return () => {};
  }

  const socketCallback = callback as SocketCallback;
  const gameSocket = socket as unknown as GameEventSocket;
  gameSocket.on(event, socketCallback);

  return () => {
    (socket as unknown as GameEventSocket | null)?.off(event, socketCallback);
  };
}

export function disconnectSocket(): void {
  if (socket && socket.connected) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket !== null && socket.connected;
}

export function emitGameStart(stake: number, onchainSessionId?: string): boolean {
  return emitGameEvent("game:start", { stake, onchainSessionId });
}

export function emitGameMove(direction: string): boolean {
  return emitGameEvent("game:move", { direction });
}

export function emitGameCrash(): boolean {
  return emitGameEvent("game:crash", {});
}

export function emitGameCashout(): boolean {
  return emitGameEvent("game:cashout", {});
}

export function emitAbortStart(sessionId?: string, txHash?: string): boolean {
  return emitGameEvent("game:abort_start", { sessionId, txHash });
}

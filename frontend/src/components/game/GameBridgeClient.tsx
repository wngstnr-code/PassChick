"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { formatUnits, isAddress, parseUnits } from "viem";
import type { Address, Hash, Hex } from "viem";
import {
  readContract,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import { useConfig } from "wagmi";
import { useWallet } from "~/components/web3/WalletProvider";
import { backendPost, backendFetch } from "~/lib/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "~/lib/backend/config";
import {
  readRawErrorMessage,
  toUserFacingWalletError,
} from "~/lib/errors";
import {
  ERC20_ABI,
  GAME_SETTLEMENT_ABI,
  GAME_SETTLEMENT_ADDRESS,
  GAME_VAULT_ABI,
  GAME_VAULT_ADDRESS,
  TRUST_PASSPORT_ABI,
  TRUST_PASSPORT_ADDRESS,
  FIXED_GAME_STAKE_DISPLAY,
  FIXED_GAME_STAKE_NUMBER,
  FIXED_GAME_STAKE_UNITS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  USDC_FAUCET_ABI,
  USDC_FAUCET_ADDRESS,
  hasGameContractConfig,
  hasPassportContractConfig,
} from "~/lib/web3/contracts";
import { CELO_CHAIN } from "~/lib/web3/celo";

type GameBridgeClientProps = {
  backgroundMode?: boolean;
};

type StartedPayload = {
  sessionId: string;
  onchainSessionId: string;
  stake: number;
  stakeAmountUnits: string;
};

type SettlementPayload = {
  sessionId: string;
  onchainSessionId: string;
  settlementTxHash?: string;
  settlementSignature?: string;
  signature?: string;
  resolution?: ChickenBridgeSettlementResolution;
  payload?: ChickenBridgeSettlementResolution;
  multiplier?: string;
  payoutAmount?: string;
  profit?: string;
  reason?: string;
};

type PendingSettlementSession = {
  session_id?: string;
  onchain_session_id?: string;
  resolution?: {
    sessionId?: string;
  };
  payload?: {
    sessionId?: string;
  };
};

type ReconnectedPayload = {
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
};

type ActiveBackendSessionPayload = {
  hasActiveGame: boolean;
  session?: {
    session_id?: string;
    onchain_session_id?: string;
    stake_amount?: number | string;
    created_at?: string;
  } | null;
};

type PassportIssueSignaturePayload = {
  success: boolean;
  signerAddress?: string;
  signingDomain?: {
    chainId?: number;
    verifyingContract?: string;
  };
  claim: {
    player: string;
    tier: number;
    issuedAt: string;
    expiry: string;
    nonce: string;
  };
  signature: string;
  signatureExpiry: number;
  eligibility: ChickenBridgePassportEligibility;
};

type PendingResolver<T> = {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

const RESPONSE_TIMEOUT_MS = 45_000;
const RECONNECT_GRACE_TIMEOUT_MS = 32_000;
const APPROVE_MAX_USDC_UNITS = parseUnits("10000000", USDC_DECIMALS);
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ACTIVE_SESSION_CACHE_MS = 2500;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeError(error: unknown, fallback: string) {
  return readRawErrorMessage(error, fallback);
}

function shouldAbortStartSessionOnReceiptError(error: unknown) {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: string }).name || "").toLowerCase()
      : "";
  const message = normalizeError(error, "").toLowerCase();
  const combined = `${name} ${message}`;

  const uncertainPatterns = [
    "timeout",
    "timed out",
    "not found",
    "pending",
    "network",
    "fetch",
    "socket",
    "disconnect",
    "rate limit",
    "429",
    "rpc",
    "temporary",
  ];

  return !uncertainPatterns.some((pattern) => combined.includes(pattern));
}

function toStartSessionFailureMessage(error: unknown, fallback: string) {
  const normalized = normalizeError(error, fallback).toLowerCase();

  if (normalized.includes("insufficientavailablebalance")) {
    return "Available vault balance is insufficient for this bet amount. Deposit first or lower your stake.";
  }
  if (normalized.includes("sessionalreadyactive")) {
    return "There is still an active on-chain session. Resolve the previous run settlement first, then try again.";
  }
  if (normalized.includes("invalidstakeamount")) {
    return "Stake amount is invalid for the settlement contract.";
  }
  if (normalized.includes("invalidsessionid")) {
    return "On-chain session ID is invalid. Please start the bet again.";
  }
  if (normalized.includes("enforcedpause") || normalized.includes("paused")) {
    return "Settlement contract is currently paused. Please try again shortly.";
  }

  return toUserFacingWalletError(error, fallback, {
    userRejectedMessage: "Start bet was canceled in wallet.",
  });
}

const PASSPORT_ERROR_SELECTOR_TO_MESSAGE: Record<string, string> = {
  "0xbf18af43":
    "Backend passport signer is invalid. Ask admin to check contract signer.",
  "0x870973b7":
    "Active wallet does not match claim passport payload.",
  "0xbca1a956": "Passport tier from backend is invalid.",
  "0x45a4a1a9": "Claim passport issuedAt is invalid.",
  "0x5e23ca68": "Claim passport expiry is invalid.",
  "0x41ad2e5f":
    "Passport signature has expired. Click Claim Passport again to generate a new signature.",
  "0x91cab504":
    "Passport claim nonce is already used. Try Claim Passport again.",
  "0x5b1819a3":
    "Backend signer is not synchronized with on-chain passport signer. Ask admin to update the contract signer.",
  "0x78c05879":
    "Passport claim is stale (old issuedAt). Try Claim Passport again.",
  "0x8f470554": "This wallet passport has already been revoked.",
};

function extractErrorSelector(error: unknown) {
  const queue: unknown[] = [error];
  const visited = new Set<object>();
  const texts: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (typeof current === "string") {
      texts.push(current);
      continue;
    }

    if (!current || typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    const preferredKeys = [
      "data",
      "details",
      "shortMessage",
      "message",
      "metaMessages",
      "cause",
    ] as const;

    for (const key of preferredKeys) {
      const value = (record as Record<string, unknown>)[key];
      if (typeof value === "string") {
        texts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            texts.push(item);
          } else if (item && typeof item === "object") {
            queue.push(item);
          }
        }
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }

    for (const value of Object.values(record)) {
      if (typeof value === "string") {
        texts.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            texts.push(item);
          } else if (item && typeof item === "object") {
            queue.push(item);
          }
        }
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  for (const text of texts) {
    const signatureMatch = text.match(/0x[a-fA-F0-9]{8}\b/);
    if (signatureMatch?.[0]) {
      return signatureMatch[0].toLowerCase();
    }

    const dataMatch = text.match(/0x[a-fA-F0-9]{10,}/);
    if (dataMatch?.[0]) {
      return dataMatch[0].slice(0, 10).toLowerCase();
    }
  }

  return "";
}

function toPassportClaimFailureMessage(error: unknown, fallback: string) {
  const selector = extractErrorSelector(error);
  if (selector && PASSPORT_ERROR_SELECTOR_TO_MESSAGE[selector]) {
    return PASSPORT_ERROR_SELECTOR_TO_MESSAGE[selector];
  }

  const normalized = normalizeError(error, fallback).toLowerCase();

  if (normalized.includes("invalidsignaturesigner")) {
    return "Backend signer does not match on-chain passport signer. Ask admin to update backend contract signer.";
  }
  if (normalized.includes("passportclaimexpired")) {
    return "Passport signature has expired. Click Claim Passport again to generate a new signature.";
  }
  if (normalized.includes("noncealreadyused")) {
    return "Passport claim nonce is already used. Try Claim Passport again.";
  }
  if (normalized.includes("stalepassportclaim")) {
    return "This passport claim is stale. Try Claim Passport again for fresh data.";
  }
  if (normalized.includes("invalidplayer")) {
    return "Active wallet does not match claim passport payload.";
  }
  if (normalized.includes("invalidtier")) {
    return "Passport tier from backend is invalid.";
  }
  if (normalized.includes("invalidissuedat") || normalized.includes("invalidexpiry")) {
    return "Passport claim timestamp is invalid. Please try again.";
  }
  if (normalized.includes("paused") || normalized.includes("enforcedpause")) {
    return "Passport contract is currently paused. Please try again shortly.";
  }

  return toUserFacingWalletError(error, fallback, {
    userRejectedMessage: "Passport claim was canceled in wallet.",
  });
}

function isLikelyNetworkIssue(error: unknown) {
  const message = normalizeError(error, "").toLowerCase();
  return [
    "network",
    "fetch",
    "rpc",
    "timeout",
    "timed out",
    "socket",
    "disconnect",
    "connection",
    "rate limit",
    "429",
  ].some((pattern) => message.includes(pattern));
}

function toNumberAmount(value: bigint) {
  return Number(formatUnits(value, USDC_DECIMALS));
}

function formatUsdcDisplayAmount(value: number) {
  if (!Number.isFinite(value)) return "0.00";
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

function rejectPendingRequest<T>(
  pending: PendingResolver<T> | null,
  message: string,
) {
  if (!pending) return;
  window.clearTimeout(pending.timeoutId);
  pending.reject(new Error(message));
}

export function GameBridgeClient({
  backgroundMode = false,
}: GameBridgeClientProps) {
  const wagmiConfig = useConfig();
  const {
    account,
    isCeloChain,
    isBackendAuthenticated,
    hasBackendApiConfig: hasBackendConfig,
    ensureBackendSession,
    refreshBackendSession,
  } = useWallet();
  const socketRef = useRef<Socket | null>(null);
  const activeSessionIdRef = useRef<string>("");
  const pendingStartRef = useRef<PendingResolver<StartedPayload> | null>(null);
  const pendingCashoutRef = useRef<PendingResolver<SettlementPayload> | null>(
    null,
  );
  const pendingCrashRef = useRef<PendingResolver<SettlementPayload> | null>(
    null,
  );
  const reconnectTimeoutRef = useRef<number | null>(null);
  const activeSessionCacheRef = useRef<{
    address: Address | null;
    value: string;
    fetchedAt: number;
  }>({
    address: null,
    value: ZERO_BYTES32,
    fetchedAt: 0,
  });
  const activeSessionInFlightRef = useRef<{
    address: Address | null;
    promise: Promise<string> | null;
  }>({
    address: null,
    promise: null,
  });

  useEffect(() => {
    if (backgroundMode) return;

    document.documentElement.classList.add("play-scroll-lock");
    document.body.classList.add("play-scroll-lock");

    return () => {
      document.documentElement.classList.remove("play-scroll-lock");
      document.body.classList.remove("play-scroll-lock");
    };
  }, [backgroundMode]);

  useEffect(() => {
    const depositFaucetButton = document.getElementById("deposit-faucet");
    if (depositFaucetButton instanceof HTMLElement) {
      depositFaucetButton.style.display = isAddress(USDC_FAUCET_ADDRESS) ? "" : "none";
    }

    if (backgroundMode) {
      window.__CHICKEN_GAME_BRIDGE__ = {
        backgroundMode: true,
        loadAvailableBalance: async () => 0,
        loadDepositBalances: async () => ({
          walletBalance: 0,
          availableBalance: 0,
          lockedBalance: 0,
          allowance: 0,
        }),
        loadLeaderboard: async () => ({
          leaderboard: [],
          walletAddress: "",
        }),
        loadPlayerStats: async () => ({
          wallet_address: "",
          total_games: 0,
          total_wins: 0,
          total_losses: 0,
          total_profit: 0,
          created_at: null,
        }),
        loadGameHistory: async (limit = 3) => ({
          sessions: [],
          total: 0,
          limit,
          offset: 0,
        }),
        loadPlayerTransactions: async (limit = 3) => ({
          transactions: [],
          total: 0,
          limit,
          offset: 0,
        }),
        getWalletAddress: () => "",
        openDeposit: (presetAmount?: number) => {
          window.dispatchEvent(
            new CustomEvent("chicken:open-deposit-modal", {
              detail: { amount: presetAmount },
            }),
          );
        },
        claimFaucet: async () => {
          throw new Error("Faucet is disabled in background mode.");
        },
        depositToVault: async () => {
          throw new Error("Background mode does not support deposit.");
        },
        startBet: async () => {
          throw new Error("Background mode does not support start bet.");
        },
        sendMove: () => {},
        cashOut: async () => {
          throw new Error("Background mode does not support cash out.");
        },
        crash: async () => null,
        autoSettlePending: async () => false,
        getPlayBlocker: async () => ({ kind: "none" }),
        resolvePlayBlocker: async () => false,
        getPassportStatus: async () => ({
          walletAddress: "",
          eligibility: {
            eligible: false,
            tier: 0,
            reason: "Background mode.",
            stats: {
              runsEvaluated: 0,
              bestHops: 0,
              averageHops: 0,
            },
          },
          passport: {
            configured: false,
            valid: false,
            tier: 0,
            issuedAt: 0,
            expiry: 0,
            revoked: false,
          },
        }),
        claimPassport: async () => {
          throw new Error("Background mode does not support passport claim.");
        },
      };

      return () => {
        delete window.__CHICKEN_GAME_BRIDGE__;
      };
    }

    function ensureSocket() {
      if (socketRef.current) {
        return socketRef.current;
      }

      if (!hasBackendApiConfig() || !BACKEND_API_URL) {
        throw new Error("NEXT_PUBLIC_BACKEND_API_URL is not set.");
      }

      const socket = io(BACKEND_API_URL, {
        withCredentials: true,
        transports: ["websocket", "polling"],
      });

      socket.on("game:started", (payload: StartedPayload) => {
        const pending = pendingStartRef.current;
        if (!pending) return;

        pendingStartRef.current = null;
        window.clearTimeout(pending.timeoutId);
        emitPlayBlocker({ kind: "none" });
        pending.resolve(payload);
      });

      socket.on("game:reconnected", (payload: ReconnectedPayload) => {
        const expectedSessionId = activeSessionIdRef.current;
        if (expectedSessionId && payload.sessionId !== expectedSessionId) {
          return;
        }

        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // After a browser refresh we may not have local sessionId anymore,
        // but backend can still restore the paused run for this wallet.
        activeSessionIdRef.current = payload.sessionId;
        emitPlayBlocker({ kind: "none" });
        window.dispatchEvent(
          new CustomEvent("chicken:game-reconnected", {
            detail: payload,
          }),
        );
      });

      socket.on("game:cashout_result", (payload: SettlementPayload) => {
        const pending = pendingCashoutRef.current;
        if (!pending) return;

        pendingCashoutRef.current = null;
        window.clearTimeout(pending.timeoutId);
        pending.resolve(payload);
      });

      socket.on("game:crashed", (payload: SettlementPayload) => {
        const pending = pendingCrashRef.current;
        if (!pending) return;

        pendingCrashRef.current = null;
        window.clearTimeout(pending.timeoutId);
        pending.resolve(payload);
      });

      socket.on("game:start_aborted", (payload: { message?: string }) => {
        activeSessionIdRef.current = "";
        const message =
          payload?.message ||
          "startSession transaction failed/reverted. Please start the bet again.";
        void refreshPlayBlockerStatus();
        window.dispatchEvent(
          new CustomEvent("chicken:start-bet-failed", {
            detail: { message },
          }),
        );
      });

      socket.on("game:error", (payload: { message?: string }) => {
        const message = toUserFacingWalletError(
          payload?.message || "",
          "Backend game error.",
        );
        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;
        window.dispatchEvent(
          new CustomEvent("chicken:game-error", { detail: { message } }),
        );
      });

      socket.on("error", (payload: { message?: string } | string) => {
        const message = toUserFacingWalletError(
          typeof payload === "string" ? payload : payload?.message || "",
          "Socket error from backend.",
        );
        const hadPendingRequest = Boolean(
          pendingStartRef.current ||
            pendingCashoutRef.current ||
            pendingCrashRef.current,
        );

        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;

        // Socket transport errors can be transient while gameplay is running.
        // We only surface them when they actually fail an in-flight request
        // (start/cashout/crash). For connectivity changes, the disconnect flow
        // already emits dedicated reconnect events.
        if (hadPendingRequest) {
          window.dispatchEvent(
            new CustomEvent("chicken:game-error", { detail: { message } }),
          );
        } else {
          console.warn("⚠️ Ignored transient socket error:", message);
        }
      });

      socket.on("disconnect", (reason) => {
        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        const message =
          reason === "io server disconnect"
            ? "Socket was disconnected by server. Sign in to backend again, then try starting bet."
            : `Socket disconnected: ${reason}`;

        rejectPendingRequest(pendingStartRef.current, message);
        rejectPendingRequest(pendingCashoutRef.current, message);
        rejectPendingRequest(pendingCrashRef.current, message);
        pendingStartRef.current = null;
        pendingCashoutRef.current = null;
        pendingCrashRef.current = null;

        if (!activeSessionIdRef.current) {
          return;
        }

        if (reason === "io server disconnect") {
          const expiredMessage =
            "Failed to restore paused run because socket was disconnected by server. Sign in to backend again and restart.";
          activeSessionIdRef.current = "";
          window.dispatchEvent(
            new CustomEvent("chicken:game-reconnect-expired", {
              detail: { message: expiredMessage },
            }),
          );
          return;
        }

        window.dispatchEvent(
          new CustomEvent("chicken:game-disconnected", {
            detail: { message },
          }),
        );

        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          if (!activeSessionIdRef.current) return;

          activeSessionIdRef.current = "";
          window.dispatchEvent(
            new CustomEvent("chicken:game-reconnect-expired", {
              detail: {
                message:
                  "Connection to server was lost for too long. The run is considered ended and will be synchronized when you start again.",
              },
            }),
          );
        }, RECONNECT_GRACE_TIMEOUT_MS);
      });

      socket.on("game:cp_expired", (payload: { message?: string }) => {
        window.dispatchEvent(
          new CustomEvent("chicken:cp-expired", {
            detail: { message: payload?.message || "" },
          }),
        );
      });

      socketRef.current = socket;
      return socket;
    }

    async function waitForSocketReady(socket: Socket) {
      if (socket.connected) return;

      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          socket.off("connect", onConnect);
          socket.off("connect_error", onError);
          reject(new Error("Socket connection timeout."));
        }, RESPONSE_TIMEOUT_MS);

        function onConnect() {
          window.clearTimeout(timeoutId);
          socket.off("connect_error", onError);
          resolve();
        }

        function onError(error: Error) {
          window.clearTimeout(timeoutId);
          socket.off("connect", onConnect);
          reject(error);
        }

        socket.once("connect", onConnect);
        socket.once("connect_error", onError);
      });
    }

    function createPendingRequest<T>(
      ref: React.MutableRefObject<PendingResolver<T> | null>,
    ) {
      return new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          ref.current = null;
          reject(new Error("Backend response timeout."));
        }, RESPONSE_TIMEOUT_MS);

        ref.current = { resolve, reject, timeoutId };
      });
    }

    function emitDepositProgress(phase: string, message?: string) {
      window.dispatchEvent(
        new CustomEvent("chicken:deposit-progress", {
          detail: { phase, message: message || "" },
        }),
      );
    }

    async function requireOnchainWallet() {
      if (!account || !isAddress(account)) {
        throw new Error("Connect wallet first before playing.");
      }
      if (!isCeloChain) {
        throw new Error(`Switch wallet to ${CELO_CHAIN.chainName} first before playing.`);
      }
      if (!hasGameContractConfig()) {
        throw new Error("Frontend contract config is incomplete.");
      }
      return account as Address;
    }

    function isRateLimitedRpcError(error: unknown) {
      const message = normalizeError(error, "").toLowerCase();
      return (
        message.includes("requests limited to 15/sec") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("too many requests")
      );
    }

    function isTransientSettlementSubmitError(error: unknown) {
      const message = normalizeError(error, "").toLowerCase();
      return (
        isRateLimitedRpcError(error) ||
        message.includes("failed to fetch") ||
        message.includes("fetch failed") ||
        message.includes("network") ||
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("rpc")
      );
    }

    async function readContractWithRetry<T>(
      reader: () => Promise<T>,
      retries = 3,
    ): Promise<T> {
      let attempt = 0;
      while (true) {
        try {
          return await reader();
        } catch (error) {
          if (!isRateLimitedRpcError(error) || attempt >= retries) {
            throw error;
          }
          const backoffMs = 250 * Math.pow(2, attempt);
          attempt += 1;
          await sleep(backoffMs);
        }
      }
    }

    async function submitSettlementWithRetry(
      sessionId: string,
      retries = 4,
    ): Promise<{ success: boolean; txHash?: string }> {
      let attempt = 0;
      while (true) {
        try {
          return await backendPost<{ success: boolean; txHash?: string }>(
            "/api/game/submit-settlement",
            { sessionId },
          );
        } catch (error) {
          if (
            !isTransientSettlementSubmitError(error) ||
            attempt >= retries
          ) {
            throw error;
          }
          const jitter = Math.floor(Math.random() * 180);
          const backoffMs = 350 * Math.pow(2, attempt) + jitter;
          attempt += 1;
          await sleep(backoffMs);
        }
      }
    }

    async function requireReadyGameWallet() {
      const playerAddress = await requireOnchainWallet();
      if (!hasBackendConfig) {
        throw new Error("Frontend backend config is incomplete.");
      }

      const authOkay = await ensureBackendSession();
      if (!authOkay) {
        throw new Error(
          "Backend session is not active yet. Sign in to backend first.",
        );
      }

      return playerAddress;
    }

    async function requireBackendWalletSession() {
      if (!account || !isAddress(account)) {
        throw new Error("Connect wallet first to view player stats.");
      }
      if (!hasBackendConfig) {
        throw new Error("Frontend backend config is incomplete.");
      }

      const authOkay = await ensureBackendSession();
      if (!authOkay) {
        throw new Error(
          "Backend session is not active yet. Connect wallet and sign in first.",
        );
      }

      return account as Address;
    }

    function normalizeHistoryLimit(limit: number | undefined, fallback = 3) {
      const parsed = Number(limit);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.max(1, Math.min(Math.floor(parsed), 20));
    }

    async function readAvailableBalance(address: Address) {
      const value = await readContractWithRetry(() =>
        readContract(wagmiConfig, {
          address: GAME_VAULT_ADDRESS as Address,
          abi: GAME_VAULT_ABI,
          functionName: "availableBalanceOf",
          args: [address],
        }),
      );

      return toNumberAmount(value);
    }

    async function readLockedBalance(address: Address) {
      const value = await readContractWithRetry(() =>
        readContract(wagmiConfig, {
          address: GAME_VAULT_ADDRESS as Address,
          abi: GAME_VAULT_ABI,
          functionName: "lockedBalanceOf",
          args: [address],
        }),
      );

      return toNumberAmount(value);
    }

    async function readActiveSessionId(address: Address) {
      const cached = activeSessionCacheRef.current;
      const now = Date.now();
      if (
        cached.address &&
        cached.address.toLowerCase() === address.toLowerCase() &&
        now - cached.fetchedAt < ACTIVE_SESSION_CACHE_MS
      ) {
        return cached.value;
      }

      const inFlight = activeSessionInFlightRef.current;
      if (
        inFlight.promise &&
        inFlight.address &&
        inFlight.address.toLowerCase() === address.toLowerCase()
      ) {
        return inFlight.promise;
      }

      const task = (async () => {
        try {
          const value = await readContractWithRetry(
            () =>
              readContract(wagmiConfig, {
                address: GAME_SETTLEMENT_ADDRESS as Address,
                abi: GAME_SETTLEMENT_ABI,
                functionName: "activeSessionOf",
                args: [address],
              }),
            4,
          );

          const normalized = String(value || "");
          activeSessionCacheRef.current = {
            address,
            value: normalized,
            fetchedAt: Date.now(),
          };

          return normalized;
        } catch (error) {
          const stale = activeSessionCacheRef.current;
          const sameAddress =
            stale.address &&
            stale.address.toLowerCase() === address.toLowerCase();
          if (sameAddress && isRateLimitedRpcError(error)) {
            console.warn(
              "⚠️ activeSessionOf rate-limited, using cached value.",
            );
            return stale.value;
          }
          throw error;
        } finally {
          const currentInFlight = activeSessionInFlightRef.current;
          if (
            currentInFlight.address &&
            currentInFlight.address.toLowerCase() === address.toLowerCase()
          ) {
            activeSessionInFlightRef.current = { address: null, promise: null };
          }
        }
      })();

      activeSessionInFlightRef.current = { address, promise: task };
      return task;
    }

    function invalidateActiveSessionCache() {
      activeSessionCacheRef.current = {
        address: null,
        value: ZERO_BYTES32,
        fetchedAt: 0,
      };
    }

    function isZeroSessionId(value: string) {
      return !value || value.toLowerCase() === ZERO_BYTES32;
    }

    function shortSessionId(value?: string | null) {
      const normalized = String(value || "");
      if (!normalized) return "";
      return `${normalized.slice(0, 10)}...`;
    }

    function emitPlayBlocker(blocker: ChickenBridgePlayBlocker) {
      window.dispatchEvent(
        new CustomEvent("chicken:play-blocker", {
          detail: blocker,
        }),
      );
    }

    async function readWalletUsdcBalance(address: Address) {
      const value = await readContractWithRetry(() =>
        readContract(wagmiConfig, {
          address: USDC_ADDRESS as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
      );

      return toNumberAmount(value);
    }

    async function readUsdcAllowance(owner: Address) {
      const value = await readContractWithRetry(() =>
        readContract(wagmiConfig, {
          address: USDC_ADDRESS as Address,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [owner, GAME_VAULT_ADDRESS as Address],
        }),
      );

      return value;
    }

    async function writeAndConfirm(
      request: Parameters<typeof writeContract>[1],
    ) {
      const txHash = await writeContract(wagmiConfig, request);
      await waitForTransactionReceipt(wagmiConfig, { hash: txHash as Hash });
      invalidateActiveSessionCache();
      return txHash as string;
    }

    async function fetchActiveBackendSession() {
      try {
        return await backendFetch<ActiveBackendSessionPayload>("/api/game/active");
      } catch (err) {
        console.error("❌ Failed to fetch active session:", err);
        return {
          hasActiveGame: false,
          session: null,
        };
      }
    }

    async function fetchPendingSettlements() {
      try {
        return await backendFetch<{
          hasPending: boolean;
          pendingSettlements: PendingSettlementSession[];
        }>("/api/game/pending-settlement");
      } catch (err) {
        console.error("❌ Failed to fetch pending settlement:", err);
        return {
          hasPending: false,
          pendingSettlements: [],
        };
      }
    }

    async function getPlayBlocker(): Promise<ChickenBridgePlayBlocker> {
      if (
        !account ||
        !isAddress(account) ||
        !isCeloChain ||
        !hasGameContractConfig() ||
        !hasBackendConfig
      ) {
        return { kind: "none" };
      }

      const authOkay =
        isBackendAuthenticated || (await refreshBackendSession());
      if (!authOkay) {
        return { kind: "none" };
      }

      const playerAddress = account as Address;
      const [pending, activeBackendSession, activeSessionId] =
        await Promise.all([
          fetchPendingSettlements(),
          fetchActiveBackendSession(),
          readActiveSessionId(playerAddress),
        ]);

      if (pending.hasPending && pending.pendingSettlements.length > 0) {
        const pendingCount = pending.pendingSettlements.length;
        const firstPending = pending.pendingSettlements[0];
        return {
          kind: "pending_settlement",
          message:
            pendingCount > 1
              ? `${pendingCount} PREV BETS NEED SETTLEMENT`
              : "PREV BET NEEDS SETTLEMENT",
          actionLabel: "END NOW",
          onchainSessionId: String(
            firstPending?.onchain_session_id ||
              firstPending?.resolution?.sessionId ||
              "",
          ),
          pendingCount,
        };
      }

      if (!isZeroSessionId(activeSessionId)) {
        return {
          kind: "active_previous",
          message: "PREV BET STILL NOT END",
          actionLabel: "END NOW",
          onchainSessionId: activeSessionId,
        };
      }

      if (activeBackendSession.hasActiveGame) {
        return {
          kind: "active_previous",
          message: "PREV BET STILL NOT END",
          actionLabel: "END NOW",
          onchainSessionId: String(
            activeBackendSession.session?.onchain_session_id || "",
          ),
        };
      }

      return { kind: "none" };
    }

    async function refreshPlayBlockerStatus() {
      try {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        return blocker;
      } catch (error) {
        console.warn("⚠️ Failed to refresh play blocker:", error);
        const fallback: ChickenBridgePlayBlocker = { kind: "none" };
        emitPlayBlocker(fallback);
        return fallback;
      }
    }

    async function settlePendingSettlements(
      pendingSettlements: PendingSettlementSession[],
      options?: { targetOnchainSessionId?: string },
    ) {
      const targetOnchainSessionId =
        options?.targetOnchainSessionId?.toLowerCase() || "";
      const candidates = targetOnchainSessionId
        ? pendingSettlements.filter((session) => {
            const onchainSessionId = String(
              session.onchain_session_id ||
                session.resolution?.sessionId ||
                session.payload?.sessionId ||
                "",
            ).toLowerCase();
            return onchainSessionId === targetOnchainSessionId;
          })
        : pendingSettlements;

      if (candidates.length === 0) {
        return false;
      }

      let settledCount = 0;
      let failedCount = 0;
      let firstFailureMessage = "";

      for (const s of candidates) {
        try {
          emitDepositProgress(
            "settle_pending",
            `Settling old session ${String(s.onchain_session_id || "").slice(0, 10)}...`,
          );

          await submitSettlementWithRetry(String(s.session_id || ""));
          console.log(`✅ Old session ${s.session_id} settled by backend.`);
          settledCount += 1;
        } catch (err) {
          console.error(`❌ Failed to settle old session ${s.session_id}:`, err);
          if (!firstFailureMessage) {
            firstFailureMessage = normalizeError(
              err,
              "Failed to process pending settlement.",
            );
          }
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        emitDepositProgress(
          "settle_incomplete",
          firstFailureMessage ||
            `${failedCount} pending settlement is not settled yet.`,
        );
        throw new Error(
          firstFailureMessage ||
            `${failedCount} pending settlement is not settled yet. Try again before starting a bet.`,
        );
      }

      if (settledCount > 0) {
        emitDepositProgress("done", "Old session settled.");
      }

      return settledCount > 0;
    }

    async function waitForOnchainSessionCleared(
      playerAddress: Address,
      options?: { attempts?: number; intervalMs?: number },
    ) {
      const attempts = Math.max(1, Number(options?.attempts || 6));
      const intervalMs = Math.max(250, Number(options?.intervalMs || 1200));
      let lastObservedSessionId = ZERO_BYTES32;

      for (let index = 0; index < attempts; index += 1) {
        try {
          invalidateActiveSessionCache();
          const activeSessionId = await readActiveSessionId(playerAddress);
          lastObservedSessionId = activeSessionId || ZERO_BYTES32;
          if (isZeroSessionId(activeSessionId)) {
            return {
              cleared: true,
              activeSessionId: ZERO_BYTES32,
            };
          }
        } catch (error) {
          console.warn("⚠️ Failed to verify active session state:", error);
        }

        if (index < attempts - 1) {
          await sleep(intervalMs);
        }
      }

      return {
        cleared: false,
        activeSessionId: lastObservedSessionId,
      };
    }

    async function waitForPlayBlockerCleared(options?: {
      attempts?: number;
      intervalMs?: number;
    }) {
      const attempts = Math.max(1, Number(options?.attempts || 4));
      const intervalMs = Math.max(150, Number(options?.intervalMs || 500));
      let lastBlocker: ChickenBridgePlayBlocker = { kind: "none" };

      for (let index = 0; index < attempts; index += 1) {
        try {
          invalidateActiveSessionCache();
          const blocker = await getPlayBlocker();
          lastBlocker = blocker;
          emitPlayBlocker(blocker);

          if (blocker.kind === "none") {
            return blocker;
          }
        } catch (error) {
          console.warn("⚠️ Failed to verify play blocker state:", error);
        }

        if (index < attempts - 1) {
          await sleep(intervalMs);
        }
      }

      return lastBlocker;
    }

    window.__CHICKEN_GAME_BRIDGE__ = {
      backgroundMode: false,
      loadAvailableBalance: async () => {
        if (!account || !isAddress(account) || !hasGameContractConfig()) {
          return 0;
        }

        await refreshBackendSession();
        return readAvailableBalance(account as Address);
      },
      loadDepositBalances: async () => {
        if (!account || !isAddress(account) || !hasGameContractConfig()) {
          return {
            walletBalance: 0,
            availableBalance: 0,
            lockedBalance: 0,
            allowance: 0,
          };
        }

        const address = account as Address;
        await refreshBackendSession();

        const [
          walletBalance,
          availableBalance,
          lockedBalance,
          allowanceUnits,
        ] = await Promise.all([
          readWalletUsdcBalance(address),
          readAvailableBalance(address),
          readLockedBalance(address),
          readUsdcAllowance(address),
        ]);

        return {
          walletBalance,
          availableBalance,
          lockedBalance,
          allowance: toNumberAmount(allowanceUnits),
        };
      },
      loadLeaderboard: async () => {
        if (!hasBackendConfig) {
          throw new Error("Frontend backend config is incomplete.");
        }

        const payload = await backendFetch<{
          leaderboard?: ChickenBridgeLeaderboardEntry[];
        }>("/api/leaderboard");

        return {
          leaderboard: Array.isArray(payload?.leaderboard)
            ? payload.leaderboard
            : [],
          walletAddress: account && isAddress(account) ? account : "",
        };
      },
      loadPlayerStats: async () => {
        await requireBackendWalletSession();
        return backendFetch<ChickenBridgePlayerStats>("/api/player/stats");
      },
      loadGameHistory: async (limit = 3) => {
        await requireBackendWalletSession();

        const safeLimit = normalizeHistoryLimit(limit);
        const payload = await backendFetch<ChickenBridgeGameHistoryPayload>(
          `/api/game/history?limit=${safeLimit}&offset=0`,
        );

        return {
          sessions: Array.isArray(payload?.sessions) ? payload.sessions : [],
          total: Number(payload?.total || 0),
          limit: Number(payload?.limit || safeLimit),
          offset: Number(payload?.offset || 0),
        };
      },
      loadPlayerTransactions: async (limit = 3) => {
        await requireBackendWalletSession();

        const safeLimit = normalizeHistoryLimit(limit);
        const payload = await backendFetch<ChickenBridgePlayerTransactionsPayload>(
          `/api/player/transactions?limit=${safeLimit}&offset=0`,
        );

        return {
          transactions: Array.isArray(payload?.transactions)
            ? payload.transactions
            : [],
          total: Number(payload?.total || 0),
          limit: Number(payload?.limit || safeLimit),
          offset: Number(payload?.offset || 0),
        };
      },
      getWalletAddress: () =>
        account && isAddress(account) ? account : "",
      openDeposit: (presetAmount?: number) => {
        window.dispatchEvent(
          new CustomEvent("chicken:open-deposit-modal", {
            detail: { amount: presetAmount },
          }),
        );
      },
      claimFaucet: async () => {
        const playerAddress = await requireOnchainWallet();
        if (!isAddress(USDC_FAUCET_ADDRESS)) {
          throw new Error("Faucet is disabled in this build.");
        }

        let txHash: string;
        try {
          txHash = await writeAndConfirm({
            address: USDC_FAUCET_ADDRESS as Address,
            abi: USDC_FAUCET_ABI,
            functionName: "claim",
          });
        } catch (error) {
          throw new Error(
            toUserFacingWalletError(error, "Failed to claim faucet.", {
              userRejectedMessage: "Faucet claim was canceled in wallet.",
            }),
          );
        }

        return {
          txHash,
          walletBalance: await readWalletUsdcBalance(playerAddress),
        };
      },
      depositToVault: async (amountInput: number | string) => {
        const playerAddress = await requireOnchainWallet();

        if (!isAddress(USDC_ADDRESS) || !isAddress(GAME_VAULT_ADDRESS)) {
          throw new Error("USDC/Vault contract config is invalid.");
        }

        const normalizedAmount = String(amountInput || "").trim();
        let amountUnits: bigint;
        try {
          amountUnits = parseUnits(normalizedAmount, USDC_DECIMALS);
        } catch {
          throw new Error("Deposit amount is invalid.");
        }

        if (amountUnits <= 0n) {
          throw new Error("Deposit amount must be greater than 0.");
        }

        emitDepositProgress(
          "checking",
          "Checking wallet balance and allowance...",
        );

        const walletBalanceUnits = await readContract(wagmiConfig, {
          address: USDC_ADDRESS as Address,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [playerAddress],
        });

        if (walletBalanceUnits < amountUnits) {
          throw new Error("Insufficient wallet USDC balance. Top up wallet first.");
        }

        let approveTxHash: string | undefined;
        const allowance = await readUsdcAllowance(playerAddress);
        if (allowance < amountUnits) {
          emitDepositProgress(
            "approve_sign",
            "Sign 1/2: approve max USDC for vault.",
          );
          try {
            approveTxHash = (await writeContract(wagmiConfig, {
              address: USDC_ADDRESS as Address,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [GAME_VAULT_ADDRESS as Address, APPROVE_MAX_USDC_UNITS],
            })) as string;
          } catch (error) {
            throw new Error(
              toUserFacingWalletError(error, "USDC approve failed.", {
                userRejectedMessage: "USDC approve was canceled in wallet.",
              }),
            );
          }
          emitDepositProgress(
            "approve_pending",
            "Approve tx submitted. Waiting confirmation...",
          );
          try {
            await waitForTransactionReceipt(wagmiConfig, {
              hash: approveTxHash as Hash,
            });
          } catch (error) {
            throw new Error(
              toUserFacingWalletError(error, "USDC approve is not confirmed yet.", {
                networkMessage:
                  "Approve confirmation not detected yet. Check wallet or explorer, then try again.",
              }),
            );
          }
        }

        emitDepositProgress("deposit_sign", "Sign 2/2: deposit USDC to vault.");
        let depositTxHash: string;
        try {
          depositTxHash = (await writeContract(wagmiConfig, {
            address: GAME_VAULT_ADDRESS as Address,
            abi: GAME_VAULT_ABI,
            functionName: "deposit",
            args: [amountUnits],
          })) as string;
        } catch (error) {
          throw new Error(
            toUserFacingWalletError(error, "Deposit failed.", {
              userRejectedMessage: "Deposit was canceled in wallet.",
            }),
          );
        }
        emitDepositProgress(
          "deposit_pending",
          "Deposit tx submitted. Waiting confirmation...",
        );
        try {
          await waitForTransactionReceipt(wagmiConfig, {
            hash: depositTxHash as Hash,
          });
        } catch (error) {
          throw new Error(
            toUserFacingWalletError(error, "Deposit is not confirmed yet.", {
              networkMessage:
                "Deposit confirmation not detected yet. Check wallet or explorer, then try again.",
            }),
          );
        }
        emitDepositProgress("done", "Deposit confirmed.");

        return {
          approveTxHash,
          depositTxHash,
          availableBalance: await readAvailableBalance(playerAddress),
        };
      },
      autoSettlePending: async () => {
        await requireReadyGameWallet();

        // 1. Cek apakah ada settlement yang tertunda di backend (sudah sign tapi belum submit ke chain)
        const pending = await fetchPendingSettlements();

        if (!pending.hasPending || pending.pendingSettlements.length === 0) {
          await refreshPlayBlockerStatus();
          return false;
        }

        console.log(
          `🧹 Auto-settling ${pending.pendingSettlements.length} pending session(s)...`,
        );

        const didSettle = await settlePendingSettlements(
          pending.pendingSettlements,
        );
        await refreshPlayBlockerStatus();
        return didSettle;
      },
      getPlayBlocker: async () => {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        return blocker;
      },
      resolvePlayBlocker: async () => {
        const playerAddress = await requireReadyGameWallet();
        const blocker = await getPlayBlocker();

        if (blocker.kind === "none") {
          emitPlayBlocker(blocker);
          return false;
        }

        if (blocker.kind === "pending_settlement") {
          const pending = await fetchPendingSettlements();
          if (pending.hasPending && pending.pendingSettlements.length > 0) {
            await settlePendingSettlements(pending.pendingSettlements, {
              targetOnchainSessionId: blocker.onchainSessionId,
            });

            const remaining = await fetchPendingSettlements();
            if (remaining.hasPending && remaining.pendingSettlements.length > 0) {
              await settlePendingSettlements(remaining.pendingSettlements);
            }
          }
        } else {
          emitDepositProgress("settle_sign", "Ending previous bet...");
          await backendPost<{
            success: boolean;
            resolved?: boolean;
          }>("/api/game/force-end-active");

          const pending = await fetchPendingSettlements();
          if (pending.hasPending && pending.pendingSettlements.length > 0) {
            await settlePendingSettlements(pending.pendingSettlements, {
              targetOnchainSessionId: blocker.onchainSessionId,
            });

            const remaining = await fetchPendingSettlements();
            if (remaining.hasPending && remaining.pendingSettlements.length > 0) {
              await settlePendingSettlements(remaining.pendingSettlements);
            }
          }
        }

        const onchainCheck = await waitForOnchainSessionCleared(playerAddress, {
          attempts: 7,
          intervalMs: 1200,
        });
        if (!onchainCheck.cleared) {
          throw new Error(
            `There is still an old active on-chain session (${shortSessionId(onchainCheck.activeSessionId)}). Please try again shortly.`,
          );
        }

        const refreshedBlocker = await waitForPlayBlockerCleared({
          attempts: 6,
          intervalMs: 650,
        });
        return refreshedBlocker.kind === "none";
      },
      getPassportStatus: async () => {
        await requireBackendWalletSession();
        return backendFetch<ChickenBridgePassportStatus>("/api/passport/status");
      },
      claimPassport: async () => {
        const playerAddress = await requireReadyGameWallet();
        if (!hasPassportContractConfig() || !isAddress(TRUST_PASSPORT_ADDRESS)) {
          throw new Error("TRUST_PASSPORT_ADDRESS config is invalid.");
        }

        const status = await backendFetch<ChickenBridgePassportStatus>(
          "/api/passport/status",
        );
        if (!status.eligibility?.eligible || status.eligibility.tier <= 0) {
          throw new Error(
            status.eligibility?.reason || "Not eligible to claim passport yet.",
          );
        }

        const issued = await backendPost<PassportIssueSignaturePayload>(
          "/api/passport/issue-signature",
          {},
        );

        const claim = issued?.claim;
        const signature = String(issued?.signature || "");
        if (!claim || !signature) {
          throw new Error(
            "Backend did not return a valid passport signature.",
          );
        }

        if (
          String(claim.player || "").toLowerCase() !==
          String(playerAddress).toLowerCase()
        ) {
          throw new Error(
            "Signer payload player does not match active wallet.",
          );
        }

        const backendDomainChainId = Number(issued?.signingDomain?.chainId || 0);
        const appChainId = Number(CELO_CHAIN.chainIdDecimal || 0);
        if (
          backendDomainChainId > 0 &&
          appChainId > 0 &&
          backendDomainChainId !== appChainId
        ) {
          throw new Error(
            `Backend chain ID (${backendDomainChainId}) does not match frontend (${appChainId}).`,
          );
        }

        const backendDomainContract = String(
          issued?.signingDomain?.verifyingContract || "",
        ).toLowerCase();
        if (
          isAddress(backendDomainContract) &&
          backendDomainContract !== String(TRUST_PASSPORT_ADDRESS).toLowerCase()
        ) {
          throw new Error(
            "Backend and frontend TRUST_PASSPORT_ADDRESS do not match.",
          );
        }

        const issuedSignerAddress = String(issued?.signerAddress || "").toLowerCase();
        if (!isAddress(issuedSignerAddress)) {
          throw new Error("Backend did not return a valid passport signerAddress.");
        }

        let onchainBackendSigner = "";
        try {
          onchainBackendSigner = String(
            await readContract(wagmiConfig, {
              address: TRUST_PASSPORT_ADDRESS as Address,
              abi: TRUST_PASSPORT_ABI,
              functionName: "backendSigner",
            }),
          ).toLowerCase();
        } catch {
          throw new Error(
            "Failed to verify on-chain passport signer. Check RPC/contract configuration.",
          );
        }

        if (onchainBackendSigner !== issuedSignerAddress) {
          throw new Error(
            "Backend signer is not synchronized with on-chain passport signer. Ask admin to update the contract signer.",
          );
        }

        if (Number(claim.expiry) <= Math.floor(Date.now() / 1000)) {
          throw new Error(
            "Passport signature has expired. Click Claim Passport again.",
          );
        }

        try {
          const [isPaused, isNonceUsed, currentPassport] = await Promise.all([
            readContract(wagmiConfig, {
              address: TRUST_PASSPORT_ADDRESS as Address,
              abi: TRUST_PASSPORT_ABI,
              functionName: "paused",
            }),
            readContract(wagmiConfig, {
              address: TRUST_PASSPORT_ADDRESS as Address,
              abi: TRUST_PASSPORT_ABI,
              functionName: "usedNonces",
              args: [BigInt(claim.nonce)],
            }),
            readContract(wagmiConfig, {
              address: TRUST_PASSPORT_ADDRESS as Address,
              abi: TRUST_PASSPORT_ABI,
              functionName: "getPassport",
              args: [playerAddress],
            }),
          ]);

          if (Boolean(isPaused)) {
            throw new Error("Passport contract is currently paused.");
          }
          if (Boolean(isNonceUsed)) {
            throw new Error("Passport claim nonce is already used. Try claiming again.");
          }

          const currentIssuedAt = Number(currentPassport?.[1] ?? 0);
          const nextIssuedAt = Number(claim.issuedAt);
          if (currentIssuedAt > 0 && nextIssuedAt < currentIssuedAt) {
            throw new Error(
              "Passport claim is stale (issuedAt older than on-chain data). Try claiming again.",
            );
          }
        } catch (error) {
          if (error instanceof Error && error.message) {
            throw error;
          }
          console.warn("⚠️ Passport preflight checks skipped:", error);
        }

        let txHash: string;
        try {
          try {
            await simulateContract(wagmiConfig, {
              account: playerAddress,
              address: TRUST_PASSPORT_ADDRESS as Address,
              abi: TRUST_PASSPORT_ABI,
              functionName: "claimWithSignature",
              args: [
                {
                  player: claim.player as Address,
                  tier: Number(claim.tier),
                  issuedAt: BigInt(claim.issuedAt),
                  expiry: BigInt(claim.expiry),
                  nonce: BigInt(claim.nonce),
                },
                signature as Hex,
              ],
            });
          } catch (error) {
            if (!isLikelyNetworkIssue(error)) {
              throw new Error(
                toPassportClaimFailureMessage(error, "Failed to claim passport."),
              );
            }
            console.warn("⚠️ Passport simulate skipped due to network/RPC issue:", error);
          }

          txHash = await writeAndConfirm({
            address: TRUST_PASSPORT_ADDRESS as Address,
            abi: TRUST_PASSPORT_ABI,
            functionName: "claimWithSignature",
            args: [
              {
                player: claim.player as Address,
                tier: Number(claim.tier),
                issuedAt: BigInt(claim.issuedAt),
                expiry: BigInt(claim.expiry),
                nonce: BigInt(claim.nonce),
              },
              signature as Hex,
            ],
          });
        } catch (error) {
          console.error("❌ claimWithSignature failed:", error);
          const err = error as {
            name?: string;
            shortMessage?: string;
            message?: string;
            details?: string;
            data?: string;
            metaMessages?: string[];
            cause?: {
              name?: string;
              shortMessage?: string;
              message?: string;
              details?: string;
              data?: string;
              metaMessages?: string[];
            };
          };
          console.error("❌ claimWithSignature failed details:", {
            name: err?.name,
            shortMessage: err?.shortMessage,
            message: err?.message,
            details: err?.details,
            data: err?.data,
            metaMessages: err?.metaMessages,
            causeName: err?.cause?.name,
            causeShortMessage: err?.cause?.shortMessage,
            causeMessage: err?.cause?.message,
            causeDetails: err?.cause?.details,
            causeData: err?.cause?.data,
            causeMetaMessages: err?.cause?.metaMessages,
          });
          throw new Error(
            toPassportClaimFailureMessage(error, "Failed to claim passport."),
          );
        }

        return {
          txHash,
          tier: Number(claim.tier),
          expiry: Number(claim.expiry),
          signatureExpiry: Number(issued.signatureExpiry || 0),
        };
      },
      startBet: async (_stake: number) => {
        const playerAddress = await requireReadyGameWallet();
        const stake = FIXED_GAME_STAKE_NUMBER;

        // --- AUTO SETTLE CHECK ---
        try {
          const bridge = window.__CHICKEN_GAME_BRIDGE__;
          if (bridge?.autoSettlePending) {
            await bridge.autoSettlePending();
          }
        } catch (err) {
          throw new Error(
            toUserFacingWalletError(
              err,
              "Pending settlement is not finished. Resolve it before starting a new bet.",
              {
                userRejectedMessage:
                  "Old settlement session was canceled in wallet. Resolve it before starting bet again.",
              },
            ),
          );
        }

        const stakeAmountUnits = FIXED_GAME_STAKE_UNITS;
        const [availableBalanceUnits, blocker] = await Promise.all([
          readContract(wagmiConfig, {
            address: GAME_VAULT_ADDRESS as Address,
            abi: GAME_VAULT_ABI,
            functionName: "availableBalanceOf",
            args: [playerAddress],
          }) as Promise<bigint>,
          getPlayBlocker(),
        ]);

        if (availableBalanceUnits < stakeAmountUnits) {
          throw new Error(
            `Insufficient available vault balance. Available ${formatUsdcDisplayAmount(toNumberAmount(availableBalanceUnits))} USDC, required ${FIXED_GAME_STAKE_DISPLAY} USDC.`,
          );
        }

        const confirmedBlocker =
          blocker.kind === "none"
            ? blocker
            : await waitForPlayBlockerCleared({
                attempts: 3,
                intervalMs: 450,
              });

        if (confirmedBlocker.kind !== "none") {
          emitPlayBlocker(confirmedBlocker);
          throw new Error(
            confirmedBlocker.kind === "pending_settlement"
              ? "Previous bet still needs settlement. Click END NOW before starting a new bet."
              : confirmedBlocker.onchainSessionId
                ? `There is still an old active on-chain session (${shortSessionId(confirmedBlocker.onchainSessionId)}). Click END NOW before starting a new bet.`
                : "Previous bet is not finished yet. Click END NOW before starting a new bet.",
          );
        }

        const socket = ensureSocket();
        await waitForSocketReady(socket);

        const pendingStart = createPendingRequest(pendingStartRef);
        socket.emit("game:start", { stake });

        let payload: StartedPayload;
        try {
          payload = await pendingStart;
        } catch (error) {
          throw new Error(
            toUserFacingWalletError(error, "Failed to start game on backend."),
          );
        }

        try {
          const txHash = (await writeContract(wagmiConfig, {
            address: GAME_SETTLEMENT_ADDRESS as Address,
            abi: GAME_SETTLEMENT_ABI,
            functionName: "startSession",
            args: [
              payload.onchainSessionId as `0x${string}`,
              BigInt(payload.stakeAmountUnits),
            ],
          })) as string;

          activeSessionIdRef.current = payload.sessionId;

          try {
            await waitForTransactionReceipt(wagmiConfig, {
              hash: txHash as Hash,
            });
          } catch (error) {
            const shouldAbort = shouldAbortStartSessionOnReceiptError(error);

            if (shouldAbort) {
              socket.emit("game:abort_start", {
                sessionId: payload.sessionId,
                txHash,
              });
              throw new Error(
                toStartSessionFailureMessage(
                  error,
                  "startSession transaction failed/reverted.",
                ),
              );
            }

            window.dispatchEvent(
              new CustomEvent("chicken:game-error", {
                detail: {
                  message:
                    "startSession confirmation is still pending/network issue. Do not refresh; check tx in wallet explorer.",
                },
              }),
            );
          }

          return {
            sessionId: payload.sessionId,
            onchainSessionId: payload.onchainSessionId,
            stake,
            availableBalance: Number.NaN,
            txHash,
          };
        } catch (error) {
          console.error("❌ Smart Contract Revert (startSession):", error);
          socket.emit("game:abort_start", { sessionId: payload.sessionId });
          throw new Error(
            toStartSessionFailureMessage(
              error,
              "startSession transaction failed/reverted.",
            ),
          );
        }
      },
      sendMove: (direction: string) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) return;
        socket.emit("game:move", { direction });
      },
      cashOut: async () => {
        const playerAddress = await requireReadyGameWallet();
        const socket = ensureSocket();
        await waitForSocketReady(socket);

        const pendingCashout = createPendingRequest(pendingCashoutRef);
        socket.emit("game:cashout");

        const payload = await pendingCashout;
        const settlementResolution = payload.resolution || payload.payload;
        const settlementSignature =
          payload.settlementSignature || payload.signature || "";
        if (!settlementResolution) {
          throw new Error("Settlement payload from backend is incomplete.");
        }
        let txHash = String(payload.settlementTxHash || "");
        try {
          if (!txHash && payload.sessionId) {
            const submit = await submitSettlementWithRetry(payload.sessionId);
            txHash = String(submit?.txHash || "");
          }
          if (!txHash) {
            throw new Error("Settlement tx hash is not available yet.");
          }
        } catch (error) {
          void refreshPlayBlockerStatus();
          throw new Error(
            normalizeError(error, "Failed to process cash out settlement on backend."),
          );
        }

        activeSessionIdRef.current = "";
        await refreshPlayBlockerStatus();
        return {
          sessionId: payload.sessionId,
          onchainSessionId: payload.onchainSessionId,
          availableBalance: await readAvailableBalance(playerAddress),
          txHash,
          resolution: settlementResolution,
          signature: settlementSignature,
          multiplier: Number(payload.multiplier || "0"),
          payoutAmount: Number(payload.payoutAmount || "0"),
          profit: Number(payload.profit || "0"),
          reason: payload.reason,
        };
      },
      crash: async (reason?: string) => {
        const playerAddress = await requireReadyGameWallet();
        const socket = ensureSocket();
        await waitForSocketReady(socket);

        const pendingCrash = createPendingRequest(pendingCrashRef);
        socket.emit("game:crash", { reason });

        const payload = await pendingCrash;
        const settlementResolution = payload.resolution || payload.payload;
        const settlementSignature =
          payload.settlementSignature || payload.signature || "";

        activeSessionIdRef.current = "";

        if (!settlementResolution) {
          return null;
        }

        let txHash = String(payload.settlementTxHash || "");
        try {
          if (!txHash && payload.sessionId) {
            const submit = await submitSettlementWithRetry(payload.sessionId);
            txHash = String(submit?.txHash || "");
          }
          if (!txHash) {
            throw new Error("Settlement tx hash is not available yet.");
          }
        } catch (error) {
          void refreshPlayBlockerStatus();
          throw new Error(
            normalizeError(error, "Failed to process run settlement on backend."),
          );
        }

        await refreshPlayBlockerStatus();
        return {
          sessionId: payload.sessionId,
          onchainSessionId: payload.onchainSessionId,
          availableBalance: await readAvailableBalance(playerAddress),
          txHash,
          resolution: settlementResolution,
          signature: settlementSignature,
          multiplier: Number(payload.multiplier || "0"),
          payoutAmount: Number(payload.payoutAmount || "0"),
          profit: Number(payload.profit || "0"),
          reason: payload.reason,
        };
      },
    };

    void refreshPlayBlockerStatus();

    return () => {
      pendingStartRef.current = null;
      pendingCashoutRef.current = null;
      pendingCrashRef.current = null;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      delete window.__CHICKEN_GAME_BRIDGE__;
    };
  }, [
    account,
    backgroundMode,
    ensureBackendSession,
    isBackendAuthenticated,
    hasBackendConfig,
    isCeloChain,
    refreshBackendSession,
  ]);

  return null;
}

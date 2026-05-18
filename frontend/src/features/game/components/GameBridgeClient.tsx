"use client";

import { useEffect, useRef } from "react";
import { useAppKitProvider } from "@reown/appkit/react";
import { useWallet } from "~/features/wallet/WalletProvider";
import { backendFetch } from "~/lib/backend/api";
import { CELO_NAMESPACE } from "~/lib/web3/appKit";
import {
  readInjectedEvmProvider,
  sendEvmTransaction,
  type BackendEvmTxPayload,
  type Eip1193Provider,
} from "~/lib/web3/celo";
import {
  initializeSocket,
  emitGameStart,
  emitGameMove,
  emitGameCrash,
  emitGameCashout,
  onGameEvent,
  isSocketConnected,
  type GameStartedPayload,
  type GameCashoutResultPayload,
  type GameCrashedPayload,
} from "~/lib/web3/socket";

type GameBridgeClientProps = {
  backgroundMode?: boolean;
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

type PendingSettlementsPayload = {
  hasPending: boolean;
  pendingSettlements: PendingSettlementSession[];
};

type VaultStatusPayload = {
  walletBalance?: string | number;
  availableBalance?: string | number;
  lockedBalance?: string | number;
};

type PassportIssueSignaturePayload = {
  success: boolean;
  tx?: BackendEvmTxPayload["tx"];
  txRequest?: BackendEvmTxPayload["txRequest"];
  transaction?: BackendEvmTxPayload["transaction"];
  transactionRequest?: BackendEvmTxPayload["transactionRequest"];
  unsignedTx?: BackendEvmTxPayload["unsignedTx"];
  txHash?: string;
  claim?: {
    tier?: number;
    expiry?: string;
  };
  signatureExpiry?: number;
  eligibility?: {
    tier?: number;
  };
};

type StartSessionPayload = {
  success: boolean;
  onchainSessionId?: string;
  tx?: BackendEvmTxPayload["tx"];
  txRequest?: BackendEvmTxPayload["txRequest"];
  transaction?: BackendEvmTxPayload["transaction"];
  transactionRequest?: BackendEvmTxPayload["transactionRequest"];
  unsignedTx?: BackendEvmTxPayload["unsignedTx"];
  txHash?: string;
  reusedActiveSession?: boolean;
};

const CELO_PROGRAM_FLOW_PENDING =
  "Celo contract flow belum tersambung. Butuh endpoint backend/contract untuk build dan submit transaction.";

function pendingProgramError(action: string) {
  return new Error(`${action}: ${CELO_PROGRAM_FLOW_PENDING}`);
}

function normalizeHistoryLimit(limit: number | undefined, fallback = 3) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), 20));
}

function normalizeStakeInput(value: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Stake amount is invalid.");
  }
  return parsed;
}

function emitPlayBlocker(blocker: ChickenBridgePlayBlocker) {
  window.dispatchEvent(
    new CustomEvent("chicken:play-blocker", {
      detail: blocker,
    }),
  );
}

async function fetchActiveBackendSession() {
  try {
    return await backendFetch<ActiveBackendSessionPayload>("/api/game/active");
  } catch (error) {
    console.warn("Caught error in GameBridgeClient:", error);
    return {
      hasActiveGame: false,
      session: null,
    };
  }
}

async function fetchPendingSettlements() {
  try {
    return await backendFetch<PendingSettlementsPayload>("/api/game/pending-settlement");
  } catch (error) {
    console.warn("Caught error in GameBridgeClient:", error);
    return {
      hasPending: false,
      pendingSettlements: [],
    };
  }
}

function readUnknownErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "").trim();
  }
  if (typeof error === "string") return error.trim();
  return "";
}

function isUserRejectedWalletError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("user rejected") ||
    lower.includes("rejected the request") ||
    lower.includes("user denied") ||
    lower.includes("rejected by user")
  );
}

export function GameBridgeClient({
  backgroundMode = false,
}: GameBridgeClientProps) {
  const { walletProvider } = useAppKitProvider<Eip1193Provider>(CELO_NAMESPACE);
  const {
    account,
    isAppChain,
    hasBackendApiConfig,
    ensureBackendSession,
    refreshBackendSession,
    isMiniPay,
    walletProviderName,
  } = useWallet();

  const pendingUnsubscribersRef = useRef<Array<() => void>>([]);
  const socketStatusListenersReadyRef = useRef(false);
  const lastSettleSweepAtRef = useRef(0);
  const settleSweepBusyRef = useRef(false);

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
        depositToVault: async () => {
          throw pendingProgramError("Deposit");
        },
        startBet: async () => {
          throw pendingProgramError("Start bet");
        },
        sendMove: () => {},
        cashOut: async () => {
          throw pendingProgramError("Cash out");
        },
        crash: async () => {
          throw pendingProgramError("Crash settlement");
        },
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
              runsCompleted: 0,
              bestHops: 0,
              averageHops: 0,
              successfulCashouts: 0,
              consistencyScore: 0,
              highestCheckpointCashedOut: 0,
              checkpointCashouts: {},
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
          progression: {
            currentTier: 0,
            currentTierLabel: "Rookie",
            nextTier: 1,
            nextTierLabel: "Runner",
            progressLabel: "Passport status is unavailable in background mode.",
            percentToNextTier: 0,
            requirements: [],
            stats: {
              runsCompleted: 0,
              bestHops: 0,
              averageHops: 0,
              successfulCashouts: 0,
              consistencyScore: 0,
              highestCheckpointCashedOut: 0,
              checkpointCashouts: {},
            },
          },
        }),
        claimPassport: async () => {
          throw pendingProgramError("Claim passport");
        },
      };

      return () => {
        delete window.__CHICKEN_GAME_BRIDGE__;
      };
    }

    async function requireBackendWalletSession() {
      if (!account) {
        throw new Error("Connect Celo wallet first.");
      }
      if (!isAppChain) {
        throw new Error("Switch wallet to the configured Celo network.");
      }
      if (!hasBackendApiConfig) {
        throw new Error("Frontend backend config is incomplete.");
      }

      const authOkay = await ensureBackendSession();
      if (!authOkay) {
        throw new Error("Backend session is not active yet. Connect wallet again.");
      }

      return account;
    }

    async function getPlayBlocker(): Promise<ChickenBridgePlayBlocker> {
      if (!account || !isAppChain || !hasBackendApiConfig) {
        return { kind: "none" };
      }

      const authOkay = await refreshBackendSession();
      if (!authOkay) {
        return { kind: "none" };
      }

      const [pending, activeBackendSession] = await Promise.all([
        fetchPendingSettlements(),
        fetchActiveBackendSession(),
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
              firstPending?.payload?.sessionId ||
              "",
          ),
          pendingCount,
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
      const blocker = await getPlayBlocker();
      emitPlayBlocker(blocker);
      return blocker;
    }

    async function submitAllPendingSettlements() {
      const pending = await fetchPendingSettlements();
      if (!pending.hasPending || pending.pendingSettlements.length === 0) {
        return 0;
      }

      let settledCount = 0;
      for (const session of pending.pendingSettlements) {
        const sessionId = String(session?.session_id || "").trim();
        if (!sessionId) continue;
        const response = await backendFetch<{ success: boolean; txHash?: string }>(
          "/api/game/submit-settlement",
          {
            method: "POST",
            body: JSON.stringify({ sessionId }),
          },
        );
        if (response?.success) {
          settledCount += 1;
        }
      }

      return settledCount;
    }

    async function settlePendingSilently() {
      const now = Date.now();
      if (settleSweepBusyRef.current) return;
      if (now - lastSettleSweepAtRef.current < 1800) return;
      settleSweepBusyRef.current = true;
      lastSettleSweepAtRef.current = now;
      try {
        await submitAllPendingSettlements();
      } catch (error) {
    console.warn("Caught error in GameBridgeClient:", error);
      } finally {
        settleSweepBusyRef.current = false;
      }
    }

    async function submitSettlementForSession(sessionId?: string) {
      const normalized = String(sessionId || "").trim();
      if (!normalized) return false;
      try {
        const response = await backendFetch<{ success: boolean; txHash?: string }>(
          "/api/game/submit-settlement",
          {
            method: "POST",
            body: JSON.stringify({ sessionId: normalized }),
          },
        );
        return Boolean(response?.success);
      } catch (error) {
    console.warn("Caught error in GameBridgeClient:", error);
        return false;
      }
    }

    function toFiniteAmount(value: string | number | undefined) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    async function readVaultAvailableBalance() {
      await settlePendingSilently();
      const snapshot = await backendFetch<VaultStatusPayload>("/api/vault/status");
      return toFiniteAmount(snapshot?.availableBalance);
    }

    async function waitForAvailableBalanceChange(previous: number, timeoutMs = 2500) {
      const startedAt = Date.now();
      let latest = previous;
      while (Date.now() - startedAt < timeoutMs) {
        try {
          latest = await readVaultAvailableBalance();
          if (Math.abs(latest - previous) > 0.000001) {
            return latest;
          }
        } catch (error) {
          console.warn("Caught error in GameBridgeClient:", error);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 220));
      }
      return latest;
    }

    async function ensureGameSocket() {
      if (!account) {
        throw new Error("Connect Celo wallet first.");
      }
      if (isSocketConnected()) return;
      const providerLabel = isMiniPay ? "minipay" : walletProviderName || "reown";
      await initializeSocket(account, providerLabel);
      if (!isSocketConnected()) {
        throw new Error("Socket connection is not ready.");
      }
      if (!socketStatusListenersReadyRef.current) {
        const cleanup = onGameEvent("game:cp_expired", (payload) => {
          window.dispatchEvent(
            new CustomEvent("chicken:cp-expired", {
              detail: {
                message: payload?.message || "Checkpoint time expired. Keep moving!",
              },
            }),
          );
        });
        pendingUnsubscribersRef.current.push(cleanup);
        socketStatusListenersReadyRef.current = true;
      }
    }

    async function waitForTransactionConfirmation(txHash: string, timeoutMs = 15000) {
      const provider = walletProvider || readInjectedEvmProvider();
      if (!provider) return false;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const receipt = await provider.request<any>({
            method: "eth_getTransactionReceipt",
            params: [txHash],
          });
          if (receipt && receipt.blockNumber) {
            return true;
          }
        } catch (error) {
          // ignore
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      return false;
    }

    async function sendBackendTransaction(payload: BackendEvmTxPayload) {
      const provider = walletProvider || readInjectedEvmProvider();
      if (!provider) {
        throw new Error("Celo wallet provider is not ready yet.");
      }

      try {
        return await sendEvmTransaction(provider, payload, account);
      } catch (error) {
        const message = readUnknownErrorMessage(error);

        if (isUserRejectedWalletError(message)) {
          throw new Error("Transaction was canceled in wallet.");
        }

        console.warn("Celo wallet transaction failed", { message });

        throw error;
      }
    }

    function waitForSocketResult<T>(
      event: "game:started" | "game:cashout_result" | "game:crashed",
      emitAction: () => boolean,
      timeoutMs = 12000,
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const cleanups: Array<() => void> = [];

        const finalize = () => {
          while (cleanups.length) {
            const dispose = cleanups.pop();
            if (dispose) dispose();
          }
        };

        const onSuccess = (payload: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          finalize();
          resolve(payload);
        };

        const onError = (payload: { message: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          finalize();
          reject(new Error(String(payload?.message || "Gateway error")));
        };

        cleanups.push(onGameEvent(event, onSuccess as never));
        cleanups.push(onGameEvent("game:error", onError));
        pendingUnsubscribersRef.current.push(...cleanups);

        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          finalize();
          reject(new Error(`Timeout waiting for ${event}`));
        }, timeoutMs);

        if (!emitAction()) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          finalize();
          reject(new Error(`Failed to emit ${event}`));
        }
      });
    }

    window.__CHICKEN_GAME_BRIDGE__ = {
      backgroundMode: false,
      loadAvailableBalance: async () => {
        if (!account || !hasBackendApiConfig) return 0;
        await requireBackendWalletSession();
        return readVaultAvailableBalance();
      },
      loadDepositBalances: async () => {
        await requireBackendWalletSession();
        const snapshot = await backendFetch<VaultStatusPayload>("/api/vault/status");
        return {
          walletBalance: toFiniteAmount(snapshot?.walletBalance),
          availableBalance: toFiniteAmount(snapshot?.availableBalance),
          lockedBalance: toFiniteAmount(snapshot?.lockedBalance),
          allowance: 0,
        };
      },
      loadLeaderboard: async () => {
        if (!hasBackendApiConfig) {
          throw new Error("Frontend backend config is incomplete.");
        }

        const payload = await backendFetch<{
          leaderboard?: ChickenBridgeLeaderboardEntry[];
        }>("/api/leaderboard");

        return {
          leaderboard: Array.isArray(payload?.leaderboard)
            ? payload.leaderboard
            : [],
          walletAddress: account || "",
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
      getWalletAddress: () => account || "",
      openDeposit: (presetAmount?: number) => {
        window.dispatchEvent(
          new CustomEvent("chicken:open-deposit-modal", {
            detail: { amount: presetAmount },
          }),
        );
      },
      depositToVault: async () => {
        await requireBackendWalletSession();
        throw pendingProgramError("Deposit");
      },
      startBet: async (stakeInput: number) => {
        await requireBackendWalletSession();
        const stake = normalizeStakeInput(stakeInput);
        const beforeAvailable = await readVaultAvailableBalance().catch(() => 0);
        const startSession = await backendFetch<StartSessionPayload>(
          "/api/game/start-session",
          {
            method: "POST",
            body: JSON.stringify({ stake }),
          },
        );
        if (!startSession?.success || !startSession?.onchainSessionId) {
          throw new Error("Backend failed to prepare start session.");
        }
        if (
          startSession.txHash ||
          startSession.unsignedTx ||
          startSession.txRequest ||
          startSession.tx ||
          startSession.transaction ||
          startSession.transactionRequest
        ) {
          const sentTxHash = await sendBackendTransaction(startSession);
          await waitForTransactionConfirmation(sentTxHash, 15000);
        }
        await ensureGameSocket();
        const started = await waitForSocketResult<GameStartedPayload>(
          "game:started",
          () => emitGameStart(stake, startSession.onchainSessionId),
        );
        const availableBalance = await readVaultAvailableBalance().catch(() => beforeAvailable);
        return {
          sessionId: String(started.sessionId || ""),
          onchainSessionId: String(started.onchainSessionId || ""),
          stake: Number(started.stake || stake),
          availableBalance,
          txHash: "socket-game-started",
        };
      },
      sendMove: (direction: string) => {
        if (isSocketConnected()) {
          emitGameMove(direction);
        }
      },
      cashOut: async () => {
        await requireBackendWalletSession();
        const beforeAvailable = await readVaultAvailableBalance().catch(() => 0);
        await ensureGameSocket();
        const result = await waitForSocketResult<GameCashoutResultPayload>(
          "game:cashout_result",
          () => emitGameCashout(),
        );
        if (!result.settlementTxHash) {
          await submitSettlementForSession(result.sessionId);
        }
        const availableBalance = await waitForAvailableBalanceChange(beforeAvailable).catch(
          () => beforeAvailable,
        );
        return {
          sessionId: String(result.sessionId || ""),
          onchainSessionId: String(result.onchainSessionId || ""),
          availableBalance,
          txHash: String(result.settlementTxHash || ""),
          resolution: result.resolution as ChickenBridgeSettlementResolution,
          signature: String(result.signature || result.settlementSignature || ""),
          multiplier: Number(result.multiplier || 0),
          payoutAmount: Number(result.payoutAmount || 0),
          profit: Number(result.profit || 0),
        };
      },
      crash: async (reason?: string) => {
        await requireBackendWalletSession();
        const beforeAvailable = await readVaultAvailableBalance().catch(() => 0);
        await ensureGameSocket();
        const result = await waitForSocketResult<GameCrashedPayload>("game:crashed", () =>
          emitGameCrash(),
        );
        if (!result.settlementTxHash) {
          await submitSettlementForSession(result.sessionId);
        }
        const availableBalance = await waitForAvailableBalanceChange(beforeAvailable).catch(
          () => beforeAvailable,
        );
        return {
          sessionId: String(result.sessionId || ""),
          onchainSessionId: String(result.onchainSessionId || ""),
          availableBalance,
          txHash: String(result.settlementTxHash || ""),
          resolution: (result.resolution || {
            sessionId: result.onchainSessionId || "",
            player: account || "",
            stakeAmount: "0",
            payoutAmount: "0",
            finalMultiplierBp: "0",
            outcome: 2,
            deadline: new Date().toISOString(),
          }) as ChickenBridgeSettlementResolution,
          signature: String(result.settlementSignature || ""),
          multiplier: Number(result.multiplier || 0),
          payoutAmount: 0,
          profit: 0,
          reason: reason || result.reason || "collision",
        };
      },
      autoSettlePending: async () => {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        if (blocker.kind === "none") return false;
        await submitAllPendingSettlements();
        await backendFetch<{
          success: boolean;
          resolved?: boolean;
        }>("/api/game/force-end-active", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await refreshPlayBlockerStatus();
        return true;
      },
      getPlayBlocker: async () => {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        return blocker;
      },
      resolvePlayBlocker: async () => {
        const blocker = await getPlayBlocker();
        emitPlayBlocker(blocker);
        if (blocker.kind === "none") return false;
        await submitAllPendingSettlements();
        await backendFetch<{
          success: boolean;
          resolved?: boolean;
        }>("/api/game/force-end-active", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await refreshPlayBlockerStatus();
        return true;
      },
      getPassportStatus: async () => {
        await requireBackendWalletSession();
        return backendFetch<ChickenBridgePassportStatus>("/api/passport/status");
      },
      claimPassport: async () => {
        await requireBackendWalletSession();
        const payload = await backendFetch<PassportIssueSignaturePayload>(
          "/api/passport/issue-signature",
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        );

        if (!payload?.success) {
          throw new Error("Backend did not return passport claim transaction.");
        }

        const txHash = await sendBackendTransaction(payload);

        return {
          txHash,
          tier: Number(payload?.claim?.tier ?? payload?.eligibility?.tier ?? 0),
          expiry: Number(payload?.claim?.expiry ?? 0),
          signatureExpiry: Number(payload?.signatureExpiry ?? 0),
        };
      },
    };

    void refreshPlayBlockerStatus().catch(() => {
      emitPlayBlocker({ kind: "none" });
    });

    return () => {
      pendingUnsubscribersRef.current.forEach((dispose) => dispose());
      pendingUnsubscribersRef.current = [];
      socketStatusListenersReadyRef.current = false;
      delete window.__CHICKEN_GAME_BRIDGE__;
    };
  }, [
    account,
    backgroundMode,
    ensureBackendSession,
    hasBackendApiConfig,
    isAppChain,
    isMiniPay,
    refreshBackendSession,
    walletProvider,
    walletProviderName,
  ]);

  return null;
}

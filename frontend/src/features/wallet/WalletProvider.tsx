"use client";



import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
  useAppKitProvider,
  useWalletInfo,
} from "@reown/appkit/react";
import { backendFetch, backendPost } from "~/lib/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "~/lib/backend/config";
import {
  appKit,
  hasReownProjectId,
  CELO_APPKIT_NETWORK,
  CELO_NAMESPACE,
} from "~/lib/web3/appKit";
import {
  CELO_CHAIN_ID_HEX,
  CELO_CHAIN_NAME,
  CELO_RPC_URL,
  type Eip1193Provider,
  hasCeloConfig,
  readInjectedEvmProvider,
  readProviderAccounts,
  readProviderChainId,
  requestProviderAccounts,
  switchProviderToCelo,
} from "~/lib/web3/celo";
import { readRawErrorMessage, toUserFacingWalletError } from "~/lib/errors";

type WalletContextValue = {
  account: string;
  chainIdHex: string;
  walletProviderName: string;
  canDisconnect: boolean;
  isAppChain: boolean;
  isConnecting: boolean;
  error: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToAppChain: () => Promise<void>;
  clearWalletError: () => void;
  hasAppChainConfig: boolean;
  appChainIdHex: string;
  appChainName: string;
  backendApiUrl: string;
  hasBackendApiConfig: boolean;
  isBackendAuthenticated: boolean;
  isBackendAuthLoading: boolean;
  backendAuthError: string;
  authenticateBackend: () => Promise<boolean>;
  ensureBackendSession: () => Promise<boolean>;
  logoutBackend: () => Promise<void>;
  refreshBackendSession: () => Promise<boolean>;
};

type WalletProviderProps = {
  children: ReactNode;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function readErrorMessage(error: unknown, fallback: string) {
  return readRawErrorMessage(error, fallback);
}

export function WalletProvider({ children }: WalletProviderProps) {
  const { open } = useAppKit();
  const appKitAccount = useAppKitAccount({ namespace: CELO_NAMESPACE });
  const appKitNetwork = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>(CELO_NAMESPACE);
  const { walletInfo } = useWalletInfo(CELO_NAMESPACE);

  const [error, setError] = useState("");
  const [isOpeningWalletModal, setIsOpeningWalletModal] = useState(false);
  const [injectedAccount, setInjectedAccount] = useState("");
  const [injectedChainId, setInjectedChainId] = useState("");
  const [miniPayDetected, setMiniPayDetected] = useState(false);
  const [backendAddress, setBackendAddress] = useState("");
  const [backendAuthLoading, setBackendAuthLoading] = useState(false);
  const [backendAuthError, setBackendAuthError] = useState("");
  const accountRef = useRef("");
  const backendSessionRef = useRef<{
    inFlight: Promise<boolean> | null;
    lastCheckedAt: number;
    lastResult: boolean;
    account: string;
  }>({
    inFlight: null,
    lastCheckedAt: 0,
    lastResult: false,
    account: "",
  });

  const appKitChainId = appKitNetwork.chainId
    ? String(appKitNetwork.chainId).startsWith("0x")
      ? String(appKitNetwork.chainId).toLowerCase()
      : `0x${Number(appKitNetwork.chainId).toString(16)}`
    : "";
  const account = appKitAccount.address || injectedAccount || "";
  const chainIdHex = appKitChainId || injectedChainId;
  const normalizedAccount = account;
  const hasBackendConfig = hasBackendApiConfig();
  const hasBaseConfig = hasCeloConfig();
  const isConnected = Boolean(appKitAccount.isConnected && account);
  const isInjectedConnected = Boolean(injectedAccount);
  const isWalletConnected = Boolean(isConnected || isInjectedConnected);
  const walletProviderName =
    walletInfo?.name ||
    (miniPayDetected && isInjectedConnected ? "MiniPay" : isWalletConnected ? "EVM Wallet" : "");
  const isConnectingWallet =
    isOpeningWalletModal ||
    appKitAccount.status === "connecting" ||
    appKitAccount.status === "reconnecting";
  const isAppChain =
    hasBaseConfig && (!isWalletConnected || !chainIdHex || chainIdHex === CELO_CHAIN_ID_HEX);
  const isBackendAuthenticated =
    Boolean(backendAddress) &&
    Boolean(normalizedAccount) &&
    backendAddress === normalizedAccount;

  async function connectWallet() {
    setError("");
    setBackendAuthError("");

    const injectedProvider = readInjectedEvmProvider();

    if (injectedProvider?.isMiniPay) {
      setIsOpeningWalletModal(true);
      try {
        const accounts = await requestProviderAccounts(injectedProvider);
        setInjectedAccount(accounts[0] || "");
        setInjectedChainId(await readProviderChainId(injectedProvider));
        setMiniPayDetected(true);
      } catch (connectError) {
        setError(
          toUserFacingWalletError(connectError, "Failed to connect MiniPay.", {
            userRejectedMessage: "Connect wallet was canceled.",
          }),
        );
      } finally {
        setIsOpeningWalletModal(false);
      }
      return;
    }

    if (!hasReownProjectId()) {
      setError("Reown Project ID is missing. Set NEXT_PUBLIC_REOWN_PROJECT_ID first.");
      return;
    }

    setIsOpeningWalletModal(true);
    try {
      await open({ view: "Connect", namespace: CELO_NAMESPACE });
    } catch (connectError) {
      setError(
        toUserFacingWalletError(connectError, "Failed to open wallet modal.", {
          userRejectedMessage: "Connect wallet was canceled.",
        }),
      );
    } finally {
      setIsOpeningWalletModal(false);
    }
  }

  async function disconnectWallet() {
    setError("");
    setBackendAddress("");
    setBackendAuthError("");

    if (hasBackendConfig) {
      await logoutBackend();
    }

    try {
      await appKit?.disconnect(CELO_NAMESPACE);
    } catch (disconnectError) {
      setError(
        toUserFacingWalletError(disconnectError, "Failed to disconnect wallet."),
      );
    } finally {
      accountRef.current = "";
      setInjectedAccount("");
      setBackendAddress("");
      setBackendAuthError("");
    }
  }

  async function switchToAppChain() {
    if (!hasBaseConfig) {
      setError("Celo RPC config is missing. Check frontend/.env.");
      return;
    }

    const provider = walletProvider || readInjectedEvmProvider();
    if (provider) {
      setError("");
      try {
        await switchProviderToCelo(provider);
        setInjectedChainId(await readProviderChainId(provider));
        return;
      } catch (switchError) {
        setError(
          toUserFacingWalletError(switchError, "Failed to switch to Celo network."),
        );
        return;
      }
    }

    if (!hasReownProjectId()) {
      setError("Reown Project ID is missing. Set NEXT_PUBLIC_REOWN_PROJECT_ID first.");
      return;
    }

    setError("");
    try {
      await appKitNetwork.switchNetwork(CELO_APPKIT_NETWORK);
    } catch (switchError) {
      setError(
        toUserFacingWalletError(switchError, "Failed to switch to Celo network."),
      );
    }
  }

  async function refreshBackendSession() {
    if (!hasBackendConfig) {
      setBackendAddress("");
      return false;
    }

    const now = Date.now();
    const snapshot = backendSessionRef.current;
    const sameAccount = snapshot.account === normalizedAccount;
    const cooldownMs = snapshot.lastResult ? 12_000 : 4_000;

    if (snapshot.inFlight) {
      return snapshot.inFlight;
    }

    if (sameAccount && now - snapshot.lastCheckedAt < cooldownMs) {
      return snapshot.lastResult;
    }

    const task = (async () => {
      setBackendAuthLoading(true);
      try {
        const response = await backendFetch<{
          authenticated: boolean;
          address: string;
        }>("/auth/me");
        const sessionAddress = response.address || "";
        if (!sessionAddress || (normalizedAccount && sessionAddress !== normalizedAccount)) {
          setBackendAddress("");
          backendSessionRef.current = {
            inFlight: null,
            lastCheckedAt: Date.now(),
            lastResult: false,
            account: normalizedAccount,
          };
          return false;
        }

        setBackendAddress(sessionAddress);
        setBackendAuthError("");
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: true,
          account: normalizedAccount,
        };
        return true;
      } catch (error) {
        console.warn("refreshBackendSession failed:", error);
        setBackendAddress("");
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: false,
          account: normalizedAccount,
        };
        return false;
      } finally {
        setBackendAuthLoading(false);
      }
    })();

    backendSessionRef.current = {
      ...backendSessionRef.current,
      inFlight: task,
      account: normalizedAccount,
    };

    return task;
  }

  async function authenticateBackend() {
    if (!hasBackendConfig) {
      setBackendAuthError(
        "Backend config is incomplete. Set NEXT_PUBLIC_BACKEND_API_URL first.",
      );
      return false;
    }

    if (!isWalletConnected || !account) {
      setBackendAuthError("Connect wallet first before signing in to backend.");
      return false;
    }

    setBackendAuthLoading(true);
    setBackendAuthError("");

    try {
      await backendPost<{ success: boolean; address: string }>("/auth/social", {
        address: account,
        walletProvider: walletProviderName || "reown",
      });

      setBackendAddress(account);
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: true,
        account,
      };
      return true;
    } catch (authError) {
      setBackendAddress("");
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: false,
        account: normalizedAccount,
      };
      setBackendAuthError(
        toUserFacingWalletError(
          authError,
          readErrorMessage(authError, "Failed to authenticate Celo wallet with backend."),
        ),
      );
      return false;
    } finally {
      setBackendAuthLoading(false);
    }
  }

  async function ensureBackendSession() {
    if (!hasBackendConfig) {
      return false;
    }
    if (isBackendAuthenticated) {
      return true;
    }

    const hasExistingSession = await refreshBackendSession();
    if (hasExistingSession) {
      return true;
    }

    return authenticateBackend();
  }

  async function logoutBackend() {
    if (!hasBackendConfig) {
      setBackendAddress("");
      return;
    }

    try {
      await backendPost<{ success: boolean }>("/auth/logout");
    } catch (error) {
      console.warn("logoutBackend failed:", error);
    } finally {
      setBackendAddress("");
      setBackendAuthError("");
      setBackendAuthLoading(false);
    }
  }

  const ensureBackendSessionEvent = useEffectEvent(ensureBackendSession);

  useEffect(() => {
    let cancelled = false;
    const resetBackendAuth = () => {
      if (cancelled) return;
      setBackendAddress("");
      setBackendAuthError("");
    };

    if (accountRef.current && accountRef.current !== account) {
      queueMicrotask(resetBackendAuth);
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: 0,
        lastResult: false,
        account,
      };
    }

    if (!account) {
      queueMicrotask(() => {
        if (cancelled) return;
        setError("");
        setBackendAddress("");
        setBackendAuthError("");
      });
    }

    accountRef.current = account;
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    if (!hasBackendConfig || !isWalletConnected || !account) {
      queueMicrotask(() => setBackendAddress(""));
      return;
    }

    queueMicrotask(() => {
      void ensureBackendSessionEvent();
    });
  }, [account, hasBackendConfig, isWalletConnected]);

  useEffect(() => {
    const provider = readInjectedEvmProvider();
    if (!provider) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setMiniPayDetected(Boolean(provider.isMiniPay));
      }
    });

    const syncInjectedWallet = async () => {
      try {
        const [accounts, chainId] = await Promise.all([
          readProviderAccounts(provider),
          readProviderChainId(provider),
        ]);
        if (cancelled) return;
        setInjectedAccount(provider.isMiniPay ? accounts[0] || "" : "");
        setInjectedChainId(chainId);
      } catch (error) {
        console.warn("syncInjectedWallet failed:", error);
      }
    };

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0].map(String) : [];
      if (provider.isMiniPay) {
        setInjectedAccount(accounts[0] || "");
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      setInjectedChainId(String(args[0] || "").toLowerCase());
    };

    void syncInjectedWallet();
    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const value: WalletContextValue = {
    account,
    chainIdHex,
    walletProviderName,
    canDisconnect: !miniPayDetected,
    isAppChain,
    isConnecting: isConnectingWallet,
    error,
    connectWallet,
    disconnectWallet,
    switchToAppChain,
    clearWalletError: () => setError(""),
    hasAppChainConfig: hasBaseConfig,
    appChainIdHex: CELO_CHAIN_ID_HEX,
    appChainName: CELO_CHAIN_NAME,
    backendApiUrl: BACKEND_API_URL,
    hasBackendApiConfig: hasBackendConfig,
    isBackendAuthenticated,
    isBackendAuthLoading: backendAuthLoading,
    backendAuthError,
    authenticateBackend,
    ensureBackendSession,
    logoutBackend,
    refreshBackendSession,
  };

  void CELO_RPC_URL;

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}

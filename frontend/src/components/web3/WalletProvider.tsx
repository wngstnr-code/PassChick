"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useAppKit } from "@reown/appkit/react";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { SiweMessage } from "siwe";
import {
  useAccount,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { backendFetch, backendPost } from "~/lib/backend/api";
import { BACKEND_API_URL, hasBackendApiConfig } from "~/lib/backend/config";
import { ensureAppKitInitialized } from "~/lib/web3/appKit";
import {
  getInjectedProvider,
  isMiniPayProvider,
  normalizeChainIdHex,
  normalizeProviderAccounts,
} from "~/lib/web3/minipay";
import { CELO_CHAIN, hasCeloChainConfig } from "~/lib/web3/celo";
import { readRawErrorMessage, toUserFacingWalletError } from "~/lib/errors";

type WalletContextValue = {
  account: string;
  chainIdHex: string;
  isMiniPay: boolean;
  canDisconnect: boolean;
  isCeloChain: boolean;
  isConnecting: boolean;
  error: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToCelo: () => Promise<void>;
  clearWalletError: () => void;
  hasCeloChainConfig: boolean;
  celoChainIdHex: string;
  celoChainName: string;
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

type AddChainArguments = {
  method: "wallet_addEthereumChain";
  params: Array<{
    chainId: string;
    chainName: string;
    nativeCurrency: {
      name: string;
      symbol: string;
      decimals: number;
    };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }>;
};

type ChainSwitchError = {
  code?: number;
  message?: string;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

function toHexChainId(chainId: number | undefined) {
  if (!chainId) return "";
  return `0x${chainId.toString(16)}`;
}

function readSwitchErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return Number((error as ChainSwitchError).code);
  }
  return null;
}

function readErrorMessage(error: unknown, fallback: string) {
  return readRawErrorMessage(error, fallback);
}

function getEip1193Provider() {
  return getInjectedProvider() as
    | { request: (args: AddChainArguments) => Promise<unknown> }
    | null;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [error, setError] = useState("");
  const [isAppKitOpening, setIsAppKitOpening] = useState(false);
  const [isMiniPay, setIsMiniPay] = useState(false);
  const [isMiniPayConnecting, setIsMiniPayConnecting] = useState(false);
  const [miniPayAccount, setMiniPayAccount] = useState("");
  const [miniPayChainIdHex, setMiniPayChainIdHex] = useState("");
  const [backendAddress, setBackendAddress] = useState("");
  const [backendAuthLoading, setBackendAuthLoading] = useState(false);
  const [backendAuthError, setBackendAuthError] = useState("");
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
  const { open } = useAppKit();
  const { address, chainId } = useAccount();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync, isPending: isSwitchPending } = useSwitchChain();

  const chainIdHex = toHexChainId(chainId) || miniPayChainIdHex;
  const account = address || miniPayAccount;
  const normalizedAccount = account.toLowerCase();
  const hasCeloConfig = hasCeloChainConfig();
  const hasBackendConfig = hasBackendApiConfig();
  const isCeloChain =
    hasCeloConfig &&
    chainIdHex.toLowerCase() === (CELO_CHAIN.chainIdHex || "").toLowerCase();
  const isConnected = Boolean(account);
  const isConnecting = isAppKitOpening || isSwitchPending || isMiniPayConnecting;
  const canDisconnect = !isMiniPay;
  const isBackendAuthenticated =
    Boolean(backendAddress) &&
    Boolean(normalizedAccount) &&
    backendAddress.toLowerCase() === normalizedAccount;

  async function syncMiniPayAccount(shouldRequestAccounts: boolean) {
    const provider = getInjectedProvider();
    if (!provider || !isMiniPayProvider(provider)) {
      setIsMiniPay(false);
      setMiniPayAccount("");
      setMiniPayChainIdHex("");
      return false;
    }

    const readMethod = shouldRequestAccounts
      ? "eth_requestAccounts"
      : "eth_accounts";

    try {
      const accountsResponse = await provider.request({
        method: readMethod,
        params: [],
      });
      const nextAccount = normalizeProviderAccounts(accountsResponse)[0] || "";
      const chainResponse = await provider.request({
        method: "eth_chainId",
        params: [],
      });

      setIsMiniPay(true);
      setError("");
      setMiniPayAccount(nextAccount);
      setMiniPayChainIdHex(normalizeChainIdHex(chainResponse));
      return Boolean(nextAccount);
    } catch (miniPayError) {
      setIsMiniPay(true);
      setMiniPayAccount("");
      setMiniPayChainIdHex("");
      setError(
        toUserFacingWalletError(
          miniPayError,
          "Failed to connect to MiniPay.",
          {
            userRejectedMessage: "MiniPay wallet access was canceled.",
          },
        ),
      );
      return false;
    }
  }

  async function connectWallet() {
    setError("");

    if (isMiniPay) {
      setIsMiniPayConnecting(true);
      try {
        await syncMiniPayAccount(true);
      } finally {
        setIsMiniPayConnecting(false);
      }
      return;
    }

    setIsAppKitOpening(true);

    try {
      await ensureAppKitInitialized();
      await open();
    } catch (connectError) {
      setError(
        toUserFacingWalletError(connectError, "Failed to open wallet modal.", {
          userRejectedMessage: "Connect wallet was canceled.",
        }),
      );
    } finally {
      setIsAppKitOpening(false);
    }
  }

  async function disconnectWallet() {
    setError("");
    setBackendAddress("");
    setBackendAuthError("");

    if (isMiniPay) {
      if (hasBackendConfig) {
        await logoutBackend();
      }
      setError(
        "MiniPay stays injected in-app. Close MiniPay or switch apps to change wallet.",
      );
      return;
    }

    try {
      await disconnectAsync();
    } catch {
      // Keep frontend state cleared even if the wallet adapter throws.
    }

    if (hasBackendConfig) {
      await logoutBackend();
    }
  }

  async function addCeloChainToWallet() {
    const provider = getEip1193Provider();
    if (!provider) {
      setError("EVM wallet not detected.");
      return;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CELO_CHAIN.chainIdHex,
          chainName: CELO_CHAIN.chainName,
          nativeCurrency: CELO_CHAIN.nativeCurrency,
          rpcUrls: CELO_CHAIN.rpcUrls,
          blockExplorerUrls: CELO_CHAIN.blockExplorerUrls,
        },
      ],
    });
  }

  async function switchToCelo() {
    if (!isConnected) {
      setError("Connect wallet first before switching chain.");
      return;
    }

    if (isMiniPay) {
      setError(
        `MiniPay cannot be switched from the dApp. Open this app from MiniPay on ${CELO_CHAIN.chainName}.`,
      );
      return;
    }

    if (!hasCeloConfig) {
      setError(
        "Celo config is incomplete. Fill the variables in frontend/.env.local.",
      );
      return;
    }

    setError("");

    try {
      await switchChainAsync({ chainId: CELO_CHAIN.chainIdDecimal });
      return;
    } catch (switchError) {
      const switchCode = readSwitchErrorCode(switchError);
      const shouldTryAddChain =
        switchCode === 4902 ||
        readErrorMessage(switchError, "")
          .toLowerCase()
          .includes("unrecognized");

      if (!shouldTryAddChain) {
        setError(
          toUserFacingWalletError(switchError, "Failed to switch to Celo chain.", {
            userRejectedMessage: "Chain switch was canceled in wallet.",
          }),
        );
        return;
      }
    }

    try {
      await addCeloChainToWallet();
      await switchChainAsync({ chainId: CELO_CHAIN.chainIdDecimal });
    } catch (addChainError) {
      setError(
        toUserFacingWalletError(
          addChainError,
          "Failed to add Celo chain.",
          {
            userRejectedMessage: "Adding chain was canceled in wallet.",
          },
        ),
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
        const sessionAddress = response.address?.toLowerCase?.() || "";
        if (
          !sessionAddress ||
          (normalizedAccount && sessionAddress !== normalizedAccount)
        ) {
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
      } catch {
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
    if (!isConnected || !account) {
      setBackendAuthError("Connect wallet first before signing in to backend.");
      return false;
    }
    if (isMiniPay) {
      if (!isCeloChain) {
        setBackendAuthError(
          `MiniPay must be on ${CELO_CHAIN.chainName} before game data can sync.`,
        );
        return false;
      }

      setBackendAuthLoading(true);
      setBackendAuthError("");

      try {
        await backendPost<{ success: boolean; address: string }>("/auth/minipay", {
          address: account,
          chainId: chainId || CELO_CHAIN.chainIdDecimal || 42220,
          walletProvider: "minipay",
        });

        const nextAddress = account.toLowerCase();
        setBackendAddress(nextAddress);
        backendSessionRef.current = {
          inFlight: null,
          lastCheckedAt: Date.now(),
          lastResult: true,
          account: nextAddress,
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
            "Failed to create a MiniPay backend session.",
          ),
        );
        return false;
      } finally {
        setBackendAuthLoading(false);
      }
    }

    setBackendAuthLoading(true);
    setBackendAuthError("");

    try {
      const { nonce } = await backendFetch<{ nonce: string }>("/auth/nonce");
      const domain = window.location.host;
      const origin = window.location.origin;
      const chainIdToUse = chainId || CELO_CHAIN.chainIdDecimal || 42220;
      const statement = "Sign in to Pass Chick backend.";
      const siweMessage = new SiweMessage({
        domain,
        address: account,
        statement,
        uri: origin,
        version: "1",
        chainId: chainIdToUse,
        nonce,
      });
      const message = siweMessage.prepareMessage();
      const signature = await signMessageAsync({ message });

      await backendPost<{ success: boolean; address: string }>("/auth/verify", {
        message,
        signature,
      });

      const nextAddress = account.toLowerCase();
      setBackendAddress(nextAddress);
      setBackendAuthError("");
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: true,
        account: nextAddress,
      };
      return true;
    }
    catch (authError) {
      setBackendAddress("");
      backendSessionRef.current = {
        inFlight: null,
        lastCheckedAt: Date.now(),
        lastResult: false,
        account: normalizedAccount,
      };
      setBackendAuthError(
        toUserFacingWalletError(authError, "Failed to authenticate with backend.", {
          userRejectedMessage: "Backend sign-in was canceled in wallet.",
        }),
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
    } catch {
      // Ignore logout failures on local dev; frontend state is still cleared.
    } finally {
      setBackendAddress("");
      setBackendAuthError("");
      setBackendAuthLoading(false);
    }
  }

  const refreshBackendSessionEvent = useEffectEvent(refreshBackendSession);

  useEffect(() => {
    const provider = getInjectedProvider();
    const miniPayDetected = isMiniPayProvider(provider);

    setIsMiniPay(miniPayDetected);
    if (!miniPayDetected) {
      setMiniPayAccount("");
      setMiniPayChainIdHex("");
      return;
    }

    let active = true;

    const handleAccountsChanged = (...args: unknown[]) => {
      if (!active) return;
      const nextAccount = normalizeProviderAccounts(args[0])[0] || "";
      setMiniPayAccount(nextAccount);
    };

    const handleChainChanged = (...args: unknown[]) => {
      if (!active) return;
      setMiniPayChainIdHex(normalizeChainIdHex(args[0]));
    };

    setIsMiniPayConnecting(true);
    void syncMiniPayAccount(false).finally(() => {
      if (active) {
        setIsMiniPayConnecting(false);
      }
    });

    provider?.on?.("accountsChanged", handleAccountsChanged);
    provider?.on?.("chainChanged", handleChainChanged);

    return () => {
      active = false;
      provider?.removeListener?.("accountsChanged", handleAccountsChanged);
      provider?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setError("");
      setBackendAddress("");
      setBackendAuthError("");
    }
  }, [isConnected]);

  useEffect(() => {
    if (!hasBackendConfig || !isConnected || !account) {
      setBackendAddress("");
      return;
    }

    void refreshBackendSessionEvent();
  }, [account, hasBackendConfig, isConnected]);

  const value: WalletContextValue = {
    account,
    chainIdHex,
    isMiniPay,
    canDisconnect,
    isCeloChain,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    switchToCelo,
    clearWalletError: () => setError(""),
    hasCeloChainConfig: hasCeloConfig,
    celoChainIdHex: CELO_CHAIN.chainIdHex,
    celoChainName: CELO_CHAIN.chainName,
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

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return value;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useAppKitProvider } from "@reown/appkit/react";
import { useWallet } from "~/features/wallet/WalletProvider";
import { backendFetch, backendPost } from "~/lib/backend/api";
import { hasBackendApiConfig } from "~/lib/backend/config";
import { CELO_NAMESPACE } from "~/lib/web3/appKit";
import {
  explorerTxUrl,
  readInjectedEvmProvider,
  sendEvmTransaction,
  type BackendEvmTxPayload,
  type Eip1193Provider,
} from "~/lib/web3/celo";
import type { DepositFlowViewModel } from "./types";

type FaucetStatusPayload = {
  success?: boolean;
  enabled?: boolean;
  cooldownSeconds?: number;
  remainingSeconds?: number;
  nextEligibleAt?: string | null;
  amount?: string;
  amountUnits?: string;
};

type FaucetRequestPayload = {
  success: boolean;
  unsignedTx?: BackendEvmTxPayload["unsignedTx"];
  tx?: BackendEvmTxPayload["tx"];
  txRequest?: BackendEvmTxPayload["txRequest"];
  transaction?: BackendEvmTxPayload["transaction"];
  transactionRequest?: BackendEvmTxPayload["transactionRequest"];
  txHash?: string;
  cooldownSeconds?: number;
  nextEligibleAt?: string | null;
};

type VaultStatusPayload = {
  success: boolean;
  walletBalance?: string;
  availableBalance?: string;
  lockedBalance?: string;
  allowanceUnits?: string;
};

type VaultTxPayload = BackendEvmTxPayload & {
  success: boolean;
  amount?: string;
  amountUnits?: string;
};

function normalizeError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: string }).message || "").trim();
    if (message) return message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return fallback;
}

function parseAmount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDisplayAmount(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney5(value: string | number | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  return parsed.toFixed(5);
}

function toFriendlyTxError(error: unknown, fallback: string) {
  const raw = normalizeError(error, fallback);
  const lower = raw.toLowerCase();

  if (lower.includes("insufficient funds")) {
    return "Insufficient USDC balance in wallet. Claim faucet dulu atau kurangi amount deposit.";
  }

  return raw;
}

export function useBackendDepositFlow(): DepositFlowViewModel {
  const { walletProvider } = useAppKitProvider<Eip1193Provider>(CELO_NAMESPACE);
  const {
    account,
    isAppChain,
    ensureBackendSession,
    isBackendAuthenticated,
  } = useWallet();
  const [amount, setAmount] = useState("0.0001");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isFaucetBusy, setIsFaucetBusy] = useState(false);
  const [isDepositBusy, setIsDepositBusy] = useState(false);
  const [isWithdrawBusy, setIsWithdrawBusy] = useState(false);
  const [faucetEnabled, setFaucetEnabled] = useState(false);
  const [faucetCooldownSeconds, setFaucetCooldownSeconds] = useState(0);
  const [faucetTxHash, setFaucetTxHash] = useState("");
  const [faucetAmountDisplay, setFaucetAmountDisplay] = useState("-");
  const [faucetAmountUnits, setFaucetAmountUnits] = useState("");
  const [depositTxHash, setDepositTxHash] = useState("");
  const [withdrawTxHash, setWithdrawTxHash] = useState("");
  const [approveTxHash, setApproveTxHash] = useState("");
  const [walletBalanceDisplay, setWalletBalanceDisplay] = useState("-");
  const [availableBalanceDisplay, setAvailableBalanceDisplay] = useState("-");
  const [lockedBalanceDisplay, setLockedBalanceDisplay] = useState("-");

  const isConnected = Boolean(account);
  const hasBackendConfig = hasBackendApiConfig();
  const canUseBackend = isConnected && isAppChain && hasBackendConfig;
  const parsedAmount = parseAmount(amount);

  useEffect(() => {
    if (!canUseBackend || !isBackendAuthenticated) return;

    let cancelled = false;

    void backendFetch<FaucetStatusPayload>("/api/faucet/status")
      .then((status) => {
        if (cancelled) return;
        setFaucetEnabled(Boolean(status.enabled));
        setFaucetCooldownSeconds(Number(status.remainingSeconds || 0));
        setFaucetAmountDisplay(formatMoney5(status.amount));
        setFaucetAmountUnits(String(status.amountUnits || ""));
      })
      .catch(() => {
        if (cancelled) return;
        setFaucetEnabled(false);
        setFaucetCooldownSeconds(0);
      });

    return () => {
      cancelled = true;
    };
  }, [canUseBackend, isBackendAuthenticated]);

  useEffect(() => {
    if (!canUseBackend || !isBackendAuthenticated) return;
    let cancelled = false;

    const syncVaultSnapshot = async () => {
      try {
        const status = await backendFetch<VaultStatusPayload>("/api/vault/status");
        if (cancelled) return;
        setWalletBalanceDisplay(formatMoney5(status.walletBalance));
        setAvailableBalanceDisplay(formatMoney5(status.availableBalance));
        setLockedBalanceDisplay(formatMoney5(status.lockedBalance));
      } catch (error) {
        console.warn("Caught error in useBackendDepositFlow:", error);
      }
    };

    void syncVaultSnapshot();
    const intervalId = window.setInterval(() => {
      void syncVaultSnapshot();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [canUseBackend, isBackendAuthenticated]);

  const configMessage = useMemo(() => {
    if (!hasBackendConfig) {
      return "Backend mode is enabled but NEXT_PUBLIC_BACKEND_API_URL is not set.";
    }
    if (!isConnected) {
      return "Connect a Celo wallet to manage vault balance.";
    }
    if (!isAppChain) {
      return "Switch wallet to the configured Celo network.";
    }
    if (!isBackendAuthenticated) {
      return "Wallet connected. Backend session will sync before requests.";
    }
    return "";
  }, [hasBackendConfig, isAppChain, isBackendAuthenticated, isConnected]);

  async function ensureReady() {
    setErrorMessage("");

    if (!hasBackendConfig) {
      setErrorMessage("Set NEXT_PUBLIC_BACKEND_API_URL first.");
      return false;
    }
    if (!isConnected) {
      setErrorMessage("Connect Celo wallet first.");
      return false;
    }
    if (!isAppChain) {
      setErrorMessage("Switch wallet to the configured Celo network.");
      return false;
    }
    if (!walletProvider && !readInjectedEvmProvider()) {
      setErrorMessage("Celo wallet provider is not ready yet.");
      return false;
    }

    const authed = await ensureBackendSession();
    if (!authed) {
      setErrorMessage("Backend session failed. Reconnect wallet and try again.");
      return false;
    }

    return true;
  }

  async function sendBackendTx(payload: BackendEvmTxPayload) {
    const provider = walletProvider || readInjectedEvmProvider();
    if (!provider) {
      throw new Error("Celo wallet provider is not ready yet.");
    }
    return sendEvmTransaction(provider, payload, account);
  }

  async function refreshVaultStatus() {
    const status = await backendFetch<VaultStatusPayload>("/api/vault/status");
    setWalletBalanceDisplay(formatMoney5(status.walletBalance));
    setAvailableBalanceDisplay(formatMoney5(status.availableBalance));
    setLockedBalanceDisplay(formatMoney5(status.lockedBalance));
  }

  async function onDeposit() {
    setIsDepositBusy(true);
    setStatusMessage("");
    try {
      const ready = await ensureReady();
      if (!ready) return;
      if (!parsedAmount) {
        setErrorMessage("Masukkan amount USDC yang valid.");
        return;
      }
      const walletBalance = parseDisplayAmount(walletBalanceDisplay);
      if (walletBalance < parsedAmount) {
        setErrorMessage(
          `Saldo wallet tidak cukup. Balance ${walletBalance.toFixed(6)} USDC, butuh ${parsedAmount.toFixed(6)} USDC.`,
        );
        return;
      }

      // 1. Check allowance
      const status = await backendFetch<VaultStatusPayload>("/api/vault/status");
      const currentAllowance = BigInt(status.allowanceUnits || "0");
      const requiredAmountUnits = BigInt(Math.floor(parsedAmount * 1_000_000));

      if (currentAllowance < requiredAmountUnits) {
        setStatusMessage("Approving USDC...");
        const approvePayload = await backendPost<VaultTxPayload>("/api/vault/approve");
        if (!approvePayload) {
          throw new Error("Backend did not return approve transaction.");
        }
        setStatusMessage("Sign approve in wallet...");
        const appTxHash = await sendBackendTx(approvePayload);
        setApproveTxHash(appTxHash);
        setStatusMessage("Waiting for approve confirmation on-chain...");

        let updatedAllowance = currentAllowance;
        for (let i = 0; i < 15; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const checkStatus = await backendFetch<VaultStatusPayload>("/api/vault/status");
          updatedAllowance = BigInt(checkStatus.allowanceUnits || "0");
          if (updatedAllowance >= requiredAmountUnits) break;
        }

        if (updatedAllowance < requiredAmountUnits) {
          throw new Error("Approve transaction took too long to confirm. Please try depositing again in a moment.");
        }
      }

      setStatusMessage("Preparing deposit transaction...");
      const payload = await backendPost<VaultTxPayload>("/api/vault/deposit", {
        amount: parsedAmount.toString(),
      });
      if (!payload) {
        throw new Error("Backend did not return deposit transaction.");
      }
      setStatusMessage("Sign deposit in wallet...");
      const txHash = await sendBackendTx(payload);
      setDepositTxHash(txHash);
      setStatusMessage("Deposit confirmed on-chain.");
      await refreshVaultStatus();
      setAmount("0.0001");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(toFriendlyTxError(error, "Deposit failed."));
    } finally {
      setIsDepositBusy(false);
    }
  }

  async function onWithdraw() {
    setIsWithdrawBusy(true);
    setStatusMessage("");
    try {
      const ready = await ensureReady();
      if (!ready) return;
      if (!parsedAmount) {
        setErrorMessage("Masukkan amount USDC yang valid.");
        return;
      }
      setStatusMessage("Preparing withdraw transaction...");
      const payload = await backendPost<VaultTxPayload>("/api/vault/withdraw", {
        amount: parsedAmount.toString(),
      });
      if (!payload) {
        throw new Error("Backend did not return withdraw transaction.");
      }
      setStatusMessage("Sign withdraw in wallet...");
      const txHash = await sendBackendTx(payload);
      setWithdrawTxHash(txHash);
      setStatusMessage("Withdraw confirmed on-chain.");
      await refreshVaultStatus();
      setAmount("0.0001");
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(toFriendlyTxError(error, "Withdraw failed."));
    } finally {
      setIsWithdrawBusy(false);
    }
  }

  async function onRequestFaucet() {
    setIsFaucetBusy(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const ready = await ensureReady();
      if (!ready) return;

      const status = await backendFetch<FaucetStatusPayload>("/api/faucet/status");
      setFaucetEnabled(Boolean(status.enabled));
      setFaucetCooldownSeconds(Number(status.remainingSeconds || 0));
      setFaucetAmountDisplay(formatMoney5(status.amount));
      setFaucetAmountUnits(String(status.amountUnits || ""));

      if (!status.enabled) {
        setErrorMessage(
          "Faucet backend belum aktif. Isi service faucet Celo di backend dulu.",
        );
        return;
      }
      if (Number(status.remainingSeconds || 0) > 0) {
        setErrorMessage(`Tunggu ${status.remainingSeconds} detik sebelum request faucet lagi.`);
        return;
      }

      const result = await backendPost<FaucetRequestPayload>("/api/faucet/request");
      if (!result) {
        throw new Error("Backend did not return faucet transaction.");
      }
      setStatusMessage("Sign faucet claim in wallet...");
      const txHash = await sendBackendTx(result);
      setFaucetTxHash(txHash);
      setFaucetCooldownSeconds(Number(result.cooldownSeconds || status.cooldownSeconds || 0));
      setStatusMessage("Faucet claim confirmed on-chain.");
      await refreshVaultStatus();
    } catch (error) {
      setErrorMessage(
        normalizeError(error, "Faucet request failed."),
      );
    } finally {
      setIsFaucetBusy(false);
    }
  }

  return {
    source: "backend",
    amount,
    setAmount,
    statusMessage,
    errorMessage,
    isConnected,
    isAppChain,
    canTransact: canUseBackend,
    hasValidContracts: hasBackendConfig,
    usdcAddress: process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS || "",
    vaultAddress: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "",
    walletBalanceDisplay,
    allowanceDisplay: "-",
    availableBalanceDisplay,
    lockedBalanceDisplay,
    isWalletBalanceFetching: false,
    isAllowanceFetching: false,
    isVaultBalanceFetching: false,
    needsApproval: false,
    approveTxHash,
    approveTxUrl: explorerTxUrl(approveTxHash),
    depositTxHash,
    depositTxUrl: explorerTxUrl(depositTxHash),
    withdrawTxHash,
    withdrawTxUrl: explorerTxUrl(withdrawTxHash),
    faucetTxHash,
    faucetTxUrl: explorerTxUrl(faucetTxHash),
    faucetAmountDisplay,
    faucetAmountUnits,
    isApproveBusy: false,
    isDepositBusy,
    isWithdrawBusy,
    isFaucetBusy,
    disableApproveButton: true,
    disableDepositButton: !canUseBackend || isDepositBusy || isWithdrawBusy || isFaucetBusy,
    disableWithdrawButton: !canUseBackend || isDepositBusy || isWithdrawBusy || isFaucetBusy,
    disableFaucetButton:
      !canUseBackend ||
      !isBackendAuthenticated ||
      !faucetEnabled ||
      faucetCooldownSeconds > 0 ||
      isDepositBusy ||
      isWithdrawBusy ||
      isFaucetBusy,
    onApprove: async () => {},
    onDeposit,
    onWithdraw,
    onRequestFaucet,
    faucetCooldownSeconds,
    configMessage,
  };
}

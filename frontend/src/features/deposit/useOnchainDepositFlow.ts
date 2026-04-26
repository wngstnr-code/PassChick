"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress, parseUnits } from "viem";
import type { Address, Hash } from "viem";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useWallet } from "~/components/web3/WalletProvider";
import {
  ERC20_ABI,
  GAME_VAULT_ABI,
  GAME_VAULT_ADDRESS,
  USDC_ADDRESS,
  USDC_DECIMALS,
  hasDepositContractConfig,
} from "~/lib/web3/contracts";
import { MINIPAY_UNSUPPORTED_CHAIN_MESSAGE } from "~/lib/web3/minipay";
import { explorerTxUrl } from "~/lib/web3/celo";
import { CELO_CHAIN } from "~/lib/web3/celo";
import type { DepositFlowViewModel } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_UINT256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;

function normalizeError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: string }).message || fallback);
  }
  return fallback;
}

function isUserRejectedRequestError(error: unknown) {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: string }).name || "").toLowerCase()
      : "";
  const message = normalizeError(error, "").toLowerCase();
  const combined = `${name} ${message}`;

  return (
    combined.includes("userrejectedrequesterror") ||
    combined.includes("user rejected") ||
    combined.includes("rejected the request") ||
    combined.includes("user denied")
  );
}

function compactWalletErrorMessage(message: string) {
  if (!message) return "";

  const markers = [
    "Request Arguments:",
    "Contract Call:",
    "Docs:",
    "Details:",
    "Version:",
  ];

  let compact = message;
  for (const marker of markers) {
    const markerIndex = compact.indexOf(marker);
    if (markerIndex !== -1) {
      compact = compact.slice(0, markerIndex);
    }
  }

  return compact.trim();
}

function toUserFacingError(
  error: unknown,
  fallback: string,
  rejectedMessage = "Transaction was canceled in wallet.",
) {
  if (isUserRejectedRequestError(error)) {
    return rejectedMessage;
  }

  const rawMessage = normalizeError(error, fallback);
  const compactMessage = compactWalletErrorMessage(rawMessage);
  return compactMessage || fallback;
}

function formatUsdcAmount(value: bigint | undefined) {
  if (value === undefined) return "-";
  const formatted = formatUnits(value, USDC_DECIMALS);
  const numeric = Number(formatted);
  if (!Number.isFinite(numeric)) return formatted;
  return numeric.toFixed(4);
}

export function useOnchainDepositFlow(): DepositFlowViewModel {
  const { account, isMiniPay, isCeloChain } = useWallet();
  const [amount, setAmount] = useState(() => {
    if (typeof window === "undefined") {
      return "10";
    }

    return new URLSearchParams(window.location.search).get("amount") || "10";
  });
  const [statusMessage, setStatusMessage] = useState("");
  const [uiError, setUiError] = useState("");
  const [handledApproveHash, setHandledApproveHash] = useState("");
  const [handledDepositHash, setHandledDepositHash] = useState("");
  const [handledWithdrawHash, setHandledWithdrawHash] = useState("");

  const isConnected = Boolean(account);
  const ownerAddress = isAddress(account) ? (account as Address) : undefined;
  const usdcAddress = isAddress(USDC_ADDRESS) ? (USDC_ADDRESS as Address) : undefined;
  const vaultAddress = isAddress(GAME_VAULT_ADDRESS)
    ? (GAME_VAULT_ADDRESS as Address)
    : undefined;
  const hasValidContracts = hasDepositContractConfig();
  const canTransact = Boolean(
    isConnected && isCeloChain && ownerAddress && usdcAddress && vaultAddress
  );

  const parsedAmount = useMemo(() => {
    try {
      const value = parseUnits(amount || "0", USDC_DECIMALS);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [amount]);

  const {
    data: walletBalanceData,
    refetch: refetchWalletBalance,
    isFetching: isWalletBalanceFetching,
  } = useReadContract({
    address: usdcAddress || ZERO_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ownerAddress || ZERO_ADDRESS],
    query: {
      enabled: canTransact,
    },
  });

  const {
    data: allowanceData,
    refetch: refetchAllowance,
    isFetching: isAllowanceFetching,
  } = useReadContract({
    address: usdcAddress || ZERO_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [ownerAddress || ZERO_ADDRESS, vaultAddress || ZERO_ADDRESS],
    query: {
      enabled: canTransact,
    },
  });

  const {
    data: availableBalanceData,
    refetch: refetchAvailableBalance,
    isFetching: isAvailableBalanceFetching,
  } = useReadContract({
    address: vaultAddress || ZERO_ADDRESS,
    abi: GAME_VAULT_ABI,
    functionName: "availableBalanceOf",
    args: [ownerAddress || ZERO_ADDRESS],
    query: {
      enabled: canTransact,
    },
  });

  const {
    data: lockedBalanceData,
    refetch: refetchLockedBalance,
    isFetching: isLockedBalanceFetching,
  } = useReadContract({
    address: vaultAddress || ZERO_ADDRESS,
    abi: GAME_VAULT_ABI,
    functionName: "lockedBalanceOf",
    args: [ownerAddress || ZERO_ADDRESS],
    query: {
      enabled: canTransact,
    },
  });

  const {
    writeContractAsync: approveAsync,
    data: approveTxHash,
    isPending: isApproveSubmitting,
    error: approveWriteError,
  } = useWriteContract();

  const {
    writeContractAsync: depositAsync,
    data: depositTxHash,
    isPending: isDepositSubmitting,
    error: depositWriteError,
  } = useWriteContract();

  const {
    writeContractAsync: withdrawAsync,
    data: withdrawTxHash,
    isPending: isWithdrawSubmitting,
    error: withdrawWriteError,
  } = useWriteContract();

  const {
    isLoading: isApproveConfirming,
    isSuccess: isApproveConfirmed,
    error: approveConfirmError,
  } = useWaitForTransactionReceipt({
    hash: approveTxHash as Hash | undefined,
  });

  const {
    isLoading: isDepositConfirming,
    isSuccess: isDepositConfirmed,
    error: depositConfirmError,
  } = useWaitForTransactionReceipt({
    hash: depositTxHash as Hash | undefined,
  });

  const {
    isLoading: isWithdrawConfirming,
    isSuccess: isWithdrawConfirmed,
    error: withdrawConfirmError,
  } = useWaitForTransactionReceipt({
    hash: withdrawTxHash as Hash | undefined,
  });

  const allowance = allowanceData ?? 0n;
  const walletBalance = walletBalanceData ?? 0n;
  const availableBalance = availableBalanceData ?? 0n;
  const lockedBalance = lockedBalanceData ?? 0n;
  const needsApproval = Boolean(parsedAmount && allowance < parsedAmount);

  useEffect(() => {
    if (!isApproveConfirmed || !approveTxHash || approveTxHash === handledApproveHash) return;

    setHandledApproveHash(approveTxHash);
    setUiError("");
    setStatusMessage("Approve confirmed. You can continue with deposit.");
    void refetchAllowance();
  }, [approveTxHash, handledApproveHash, isApproveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (!isDepositConfirmed || !depositTxHash || depositTxHash === handledDepositHash) return;

    setHandledDepositHash(depositTxHash);
    setUiError("");
    setStatusMessage("Deposit confirmed on-chain.");
    void refetchAllowance();
    void refetchWalletBalance();
    void refetchAvailableBalance();
    void refetchLockedBalance();
  }, [
    depositTxHash,
    handledDepositHash,
    isDepositConfirmed,
    refetchAllowance,
    refetchAvailableBalance,
    refetchLockedBalance,
    refetchWalletBalance,
  ]);

  useEffect(() => {
    if (!isWithdrawConfirmed || !withdrawTxHash || withdrawTxHash === handledWithdrawHash) return;

    setHandledWithdrawHash(withdrawTxHash);
    setUiError("");
    setStatusMessage("Withdraw confirmed on-chain.");
    void refetchWalletBalance();
    void refetchAvailableBalance();
    void refetchLockedBalance();
  }, [
    handledWithdrawHash,
    isWithdrawConfirmed,
    refetchAvailableBalance,
    refetchLockedBalance,
    refetchWalletBalance,
    withdrawTxHash,
  ]);

  const errorMessage = useMemo(() => {
    if (uiError) return uiError;
    return (
      toUserFacingError(approveWriteError, "") ||
      toUserFacingError(approveConfirmError, "") ||
      toUserFacingError(depositWriteError, "") ||
      toUserFacingError(depositConfirmError, "") ||
      toUserFacingError(withdrawWriteError, "") ||
      toUserFacingError(withdrawConfirmError, "")
    );
  }, [
    approveConfirmError,
    approveWriteError,
    depositConfirmError,
    depositWriteError,
    uiError,
    withdrawConfirmError,
    withdrawWriteError,
  ]);

  async function onApprove() {
    if (!canTransact || !usdcAddress || !vaultAddress) {
      setUiError("Make sure wallet is connected, on the supported Celo network, and contract config is valid.");
      return;
    }
    if (!parsedAmount) {
      setUiError("Masukkan amount USDC yang valid.");
      return;
    }

    setUiError("");
    setStatusMessage("");

    try {
      await approveAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vaultAddress, MAX_UINT256],
      });
    } catch (approveError) {
      setUiError(
        toUserFacingError(
          approveError,
          "Approve failed.",
          "Approve was canceled in wallet.",
        ),
      );
    }
  }

  async function onDeposit() {
    if (!canTransact || !vaultAddress) {
      setUiError("Make sure wallet is connected, on the supported Celo network, and contract config is valid.");
      return;
    }
    if (!parsedAmount) {
      setUiError("Masukkan amount USDC yang valid.");
      return;
    }
    if (needsApproval) {
      setStatusMessage("Approving USDC (Infinite)...");
      try {
        await approveAsync({
          address: usdcAddress!,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [vaultAddress, MAX_UINT256],
        });
        setStatusMessage("Approval submitted. Please wait for confirmation...");
        return; // Wait for approval confirmation effect to update state
      } catch (approveError) {
        setStatusMessage("");
        setUiError(
          toUserFacingError(
            approveError,
            "Approve failed.",
            "Approve was canceled in wallet.",
          ),
        );
        return;
      }
    }

    setUiError("");
    setStatusMessage("");

    try {
      await depositAsync({
        address: vaultAddress,
        abi: GAME_VAULT_ABI,
        functionName: "deposit",
        args: [parsedAmount],
      });
    } catch (depositError) {
      setUiError(
        toUserFacingError(
          depositError,
          "Deposit failed.",
          "Deposit was canceled in wallet.",
        ),
      );
    }
  }

  async function onWithdraw() {
    if (!canTransact || !vaultAddress) {
      setUiError("Make sure wallet is connected, on the supported Celo network, and contract config is valid.");
      return;
    }
    if (!parsedAmount) {
      setUiError("Masukkan amount USDC yang valid.");
      return;
    }
    if (parsedAmount > availableBalance) {
      setUiError("Available vault balance is insufficient for withdrawal.");
      return;
    }

    setUiError("");
    setStatusMessage("");

    try {
      await withdrawAsync({
        address: vaultAddress,
        abi: GAME_VAULT_ABI,
        functionName: "withdraw",
        args: [parsedAmount],
      });
    } catch (withdrawError) {
      setUiError(
        toUserFacingError(
          withdrawError,
          "Withdraw failed.",
          "Withdraw was canceled in wallet.",
        ),
      );
    }
  }

  const approveTxUrl = approveTxHash ? explorerTxUrl(approveTxHash) : "";
  const depositTxUrl = depositTxHash ? explorerTxUrl(depositTxHash) : "";
  const withdrawTxUrl = withdrawTxHash ? explorerTxUrl(withdrawTxHash) : "";

  const isApproveBusy = isApproveSubmitting || isApproveConfirming;
  const isDepositBusy = isDepositSubmitting || isDepositConfirming;
  const isWithdrawBusy = isWithdrawSubmitting || isWithdrawConfirming;
  const disableApproveButton =
    !canTransact || !parsedAmount || !needsApproval || isApproveBusy || isDepositBusy || isWithdrawBusy;
  const disableDepositButton =
    isApproveBusy || isDepositBusy || isWithdrawBusy;
  const disableWithdrawButton =
    !canTransact ||
    !parsedAmount ||
    parsedAmount > availableBalance ||
    isApproveBusy ||
    isDepositBusy ||
    isWithdrawBusy;

  const configMessage = isMiniPay
    ? MINIPAY_UNSUPPORTED_CHAIN_MESSAGE
    : !isConnected
      ? "Connect wallet first to manage vault balance."
      : !isCeloChain
        ? `Wrong network. Switch wallet to ${CELO_CHAIN.chainName} (${CELO_CHAIN.chainIdHex}).`
        : !hasValidContracts
          ? "Contract config is invalid. Fill valid USDC and vault addresses in `frontend/.env.local`."
          : "";

  return {
    source: "onchain",
    amount,
    setAmount,
    statusMessage,
    errorMessage,
    isConnected,
    isMiniPay,
    isCeloChain,
    canTransact,
    hasValidContracts,
    usdcAddress: USDC_ADDRESS,
    vaultAddress: GAME_VAULT_ADDRESS,
    walletBalanceDisplay: isWalletBalanceFetching ? "loading..." : formatUsdcAmount(walletBalance),
    allowanceDisplay: isAllowanceFetching ? "loading..." : formatUsdcAmount(allowance),
    availableBalanceDisplay:
      isAvailableBalanceFetching ? "loading..." : formatUsdcAmount(availableBalance),
    lockedBalanceDisplay: isLockedBalanceFetching ? "loading..." : formatUsdcAmount(lockedBalance),
    isWalletBalanceFetching,
    isAllowanceFetching,
    isVaultBalanceFetching: isAvailableBalanceFetching || isLockedBalanceFetching,
    needsApproval,
    approveTxHash: approveTxHash || "",
    approveTxUrl,
    depositTxHash: depositTxHash || "",
    depositTxUrl,
    withdrawTxHash: withdrawTxHash || "",
    withdrawTxUrl,
    isApproveBusy,
    isDepositBusy,
    isWithdrawBusy,
    disableApproveButton,
    disableDepositButton,
    disableWithdrawButton,
    onApprove,
    onDeposit,
    onWithdraw,
    configMessage,
  };
}

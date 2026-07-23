"use client";

import { useAppKitProvider } from "@reown/appkit/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useWallet } from "~/features/wallet/WalletProvider";
import { MINIPAY_ADD_CASH_URL } from "~/lib/minipay/addCash";
import { CELO_NAMESPACE } from "~/lib/web3/appKit";
import { getAttributionDataSuffix } from "~/lib/web3/attribution";
import {
  explorerTxUrl,
  readInjectedEvmProvider,
  type Eip1193Provider,
} from "~/lib/web3/celo";
import { TICKET_VAULT_DEPLOYMENTS } from "./contracts.ts";
import {
  createTicketQueryScope,
  type PaymentTokenSymbol,
  type SupportedPaymentToken,
} from "./domain.ts";
import { ticketQueryKeys } from "./queryKeys.ts";
import { getTicketPublicClient } from "./runtimeAdapter.ts";
import {
  classifyTopUpError,
  parseTopUpUsdAmount,
  quoteTopUp,
  selectDefaultTopUpToken,
} from "./topUpDomain.ts";
import {
  buildTopUpTransactionPlan,
  sendTicketTopUpTransaction,
  waitForTicketTopUpReceipt,
} from "./topUpTransaction.ts";

type TokenSnapshot = {
  token: SupportedPaymentToken;
  balanceUnits: bigint;
  allowanceUnits: bigint;
};

const EMPTY_SNAPSHOTS: TokenSnapshot[] = [];

export function formatTokenUnits(units: bigint, decimals: number) {
  const formatted = formatUnits(units, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function useTicketTopUp(tokens: readonly SupportedPaymentToken[]) {
  const queryClient = useQueryClient();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>(CELO_NAMESPACE);
  const wallet = useWallet();
  const [amount, setAmount] = useState("1");
  const [selectedSymbol, setSelectedSymbol] = useState<PaymentTokenSymbol | null>(null);
  const [approvalHash, setApprovalHash] = useState("");
  const [purchaseHash, setPurchaseHash] = useState("");
  const [stage, setStage] = useState<"idle" | "approving" | "purchasing" | "confirming" | "success">("idle");
  const scope = createTicketQueryScope(wallet.account, wallet.chainIdHex);

  const snapshotQuery = useQuery({
    queryKey: scope
      ? [...ticketQueryKeys.all, "top-up-wallet", scope.chainId, scope.account]
      : [...ticketQueryKeys.all, "top-up-wallet", "disconnected"],
    enabled: Boolean(scope && tokens.length),
    queryFn: async (): Promise<TokenSnapshot[]> => {
      if (!scope) return EMPTY_SNAPSHOTS;
      const client = getTicketPublicClient(scope.chainId);
      const spender = TICKET_VAULT_DEPLOYMENTS[scope.chainId].proxyAddress;
      return Promise.all(
        tokens.map(async (token) => {
          if (!token.address) return { token, balanceUnits: 0n, allowanceUnits: 0n };
          const [balanceUnits, allowanceUnits] = await Promise.all([
            client.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [scope.account],
            }),
            client.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: "allowance",
              args: [scope.account, spender],
            }),
          ]);
          return { token, balanceUnits, allowanceUnits };
        }),
      );
    },
  });

  const snapshots = snapshotQuery.data ?? EMPTY_SNAPSHOTS;
  const balances = useMemo(
    () => Object.fromEntries(snapshots.map((entry) => [entry.token.symbol, entry.balanceUnits])),
    [snapshots],
  );
  const defaultToken = useMemo(
    () => selectDefaultTopUpToken(tokens, balances),
    [balances, tokens],
  );

  const selectedToken =
    tokens.find(
      (token) =>
        token.symbol === selectedSymbol && token.enabled && token.address,
    ) ?? defaultToken;
  const selectedSnapshot = snapshots.find(
    (entry) => entry.token.symbol === selectedToken?.symbol,
  );
  const quote = useMemo(() => {
    if (!selectedToken) return null;
    try {
      return quoteTopUp(selectedToken, parseTopUpUsdAmount(amount));
    } catch {
      return null;
    }
  }, [amount, selectedToken]);
  const insufficientBalance = Boolean(
    quote && selectedSnapshot && selectedSnapshot.balanceUnits < quote.costUnits,
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!scope || !wallet.isAppChain) throw new Error("Switch to the supported Celo network first.");
      if (!selectedToken || !selectedSnapshot) throw new Error("Choose an enabled payment token first.");
      if (insufficientBalance) throw new Error("Insufficient balance for this ticket top up.");
      const provider = walletProvider || readInjectedEvmProvider();
      if (!provider) throw new Error("No Celo wallet provider is available.");
      const usdAmount = parseTopUpUsdAmount(amount);
      const plan = buildTopUpTransactionPlan({
        chainId: scope.chainId,
        account: scope.account,
        token: selectedToken,
        usdAmount,
        allowanceUnits: selectedSnapshot.allowanceUnits,
        attributionSuffix: getAttributionDataSuffix(),
      });

      let nextApprovalHash = "";
      if (plan.approval) {
        setStage("approving");
        nextApprovalHash = await sendTicketTopUpTransaction(provider, plan.approval);
        setApprovalHash(nextApprovalHash);
        await waitForTicketTopUpReceipt(provider, nextApprovalHash as `0x${string}`);
      }
      setStage("purchasing");
      const nextPurchaseHash = await sendTicketTopUpTransaction(provider, plan.purchase);
      setPurchaseHash(nextPurchaseHash);
      setStage("confirming");
      await waitForTicketTopUpReceipt(provider, nextPurchaseHash);
      return { approvalHash: nextApprovalHash, purchaseHash: nextPurchaseHash, tickets: plan.ticketAmount };
    },
    onSuccess: async () => {
      setStage("success");
      await queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all });
    },
    onError: async (error) => {
      setStage("idle");
      if (classifyTopUpError(error).action === "refresh") {
        await queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all });
      }
    },
  });

  const errorState = mutation.error ? classifyTopUpError(mutation.error) : null;

  return {
    ...wallet,
    amount,
    setAmount,
    selectedSymbol,
    setSelectedSymbol,
    selectedToken,
    snapshots,
    snapshotQuery,
    quote,
    insufficientBalance,
    mutation,
    errorState,
    stage,
    approvalHash,
    approvalUrl: explorerTxUrl(approvalHash),
    purchaseHash,
    purchaseUrl: explorerTxUrl(purchaseHash),
    addCashUrl: MINIPAY_ADD_CASH_URL,
  };
}

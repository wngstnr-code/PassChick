"use client";

import { useAppKitProvider } from "@reown/appkit/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "~/features/wallet/WalletProvider";
import { CELO_NAMESPACE } from "~/lib/web3/appKit";
import { readInjectedEvmProvider, type Eip1193Provider } from "~/lib/web3/celo";
import { getAttributionDataSuffix } from "~/lib/web3/attribution";
import { createTicketQueryScope } from "../tickets/domain.ts";
import { ticketQueryKeys } from "../tickets/queryKeys.ts";
import { requestDailyClaim } from "./api.ts";
import { classifyDailyClaimError, parseSignedDailyClaim } from "./domain.ts";
import {
  buildDailyClaimTransaction,
  sendDailyClaimTransaction,
  waitForDailyClaimReceipt,
} from "./transaction.ts";

export function useDailyRewardClaim() {
  const queryClient = useQueryClient();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>(CELO_NAMESPACE);
  const { account, chainIdHex, ensureBackendSession, isAppChain } = useWallet();

  return useMutation({
    mutationFn: async () => {
      const scope = createTicketQueryScope(account, chainIdHex);
      if (!scope || !isAppChain) throw new Error("Switch to the supported Celo network first.");
      const backendReady = await ensureBackendSession();
      if (!backendReady) throw new Error("Backend wallet session is not ready. Reconnect and try again.");
      const provider = walletProvider || readInjectedEvmProvider();
      if (!provider) throw new Error("No Celo wallet provider is available.");

      const payload = await requestDailyClaim(scope);
      const signedClaim = parseSignedDailyClaim(payload, { account: scope.account });
      const transaction = buildDailyClaimTransaction({
        chainId: scope.chainId,
        account: scope.account,
        signedClaim,
        attributionSuffix: getAttributionDataSuffix(),
      });
      const hash = await sendDailyClaimTransaction(provider, transaction);
      await waitForDailyClaimReceipt(provider, hash);
      return { hash, amount: signedClaim.claim.amount };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all });
    },
    onError: async (error) => {
      if (classifyDailyClaimError(error).refreshRequired) {
        await queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all });
      }
    },
  });
}

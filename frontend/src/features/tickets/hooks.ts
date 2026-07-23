"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "~/features/wallet/WalletProvider";
import type { TicketAdapter } from "./adapters.ts";
import { createTicketQueryScope, type TicketQueryScope } from "./domain.ts";
import { ticketQueryKeys } from "./queryKeys.ts";

const DISCONNECTED_QUERY_KEY = ["tickets", "disconnected"] as const;

function requireScope(scope: TicketQueryScope | null) {
  if (!scope) throw new Error("A supported Celo chain and connected wallet are required.");
  return scope;
}

export function useTicketQueryScope() {
  const { account, chainIdHex } = useWallet();
  return createTicketQueryScope(account, chainIdHex);
}

export function useTicketBalanceQuery(adapter: TicketAdapter) {
  const scope = useTicketQueryScope();
  return useQuery({
    queryKey: scope ? ticketQueryKeys.balance(scope, adapter.kind) : DISCONNECTED_QUERY_KEY,
    queryFn: () => adapter.getTicketBalance(requireScope(scope)),
    enabled: Boolean(scope),
  });
}

export function useDailyClaimStatusQuery(adapter: TicketAdapter) {
  const scope = useTicketQueryScope();
  return useQuery({
    queryKey: scope
      ? ticketQueryKeys.dailyClaim(scope, adapter.kind)
      : DISCONNECTED_QUERY_KEY,
    queryFn: () => adapter.getDailyClaimStatus(requireScope(scope)),
    enabled: Boolean(scope),
  });
}

export function useSupportedPaymentTokensQuery(adapter: TicketAdapter) {
  const scope = useTicketQueryScope();
  return useQuery({
    queryKey: scope
      ? ticketQueryKeys.supportedTokens(scope, adapter.kind)
      : DISCONNECTED_QUERY_KEY,
    queryFn: () => adapter.getSupportedPaymentTokens(requireScope(scope)),
    enabled: Boolean(scope),
    staleTime: 5 * 60 * 1000,
  });
}

export function useLegacyGameVaultBalanceQuery(adapter: TicketAdapter) {
  const scope = useTicketQueryScope();
  return useQuery({
    queryKey: scope
      ? ticketQueryKeys.legacyBalance(scope, adapter.kind)
      : DISCONNECTED_QUERY_KEY,
    queryFn: () => adapter.getLegacyGameVaultBalance(requireScope(scope)),
    enabled: Boolean(scope),
  });
}

export function useTicketQueries(adapter: TicketAdapter) {
  return {
    balance: useTicketBalanceQuery(adapter),
    dailyClaim: useDailyClaimStatusQuery(adapter),
    supportedTokens: useSupportedPaymentTokensQuery(adapter),
    legacyBalance: useLegacyGameVaultBalanceQuery(adapter),
  };
}

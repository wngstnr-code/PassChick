import { backendFetch, backendPost } from "~/lib/backend/api";
import type { TicketQueryScope } from "../tickets/domain.ts";
import { parseDailyClaimStatus } from "./status.ts";

const DAILY_STATUS_PATH = "/api/tickets/daily/status";
const DAILY_CLAIM_PATH = "/api/tickets/daily/claim";
const TICKET_BALANCE_PATH = "/api/tickets/balance";

type TicketBalanceResponsePayload = {
  success?: boolean;
  balance?: string | number;
  authority?: string;
  error?: string;
};

export async function getDailyClaimStatus(scope: TicketQueryScope) {
  const query = new URLSearchParams({
    chainId: String(scope.chainId),
    account: scope.account,
  });
  const payload = await backendFetch<unknown>(`${DAILY_STATUS_PATH}?${query}`);
  return parseDailyClaimStatus(payload);
}

export async function getBackendTicketBalance(scope: TicketQueryScope) {
  const query = new URLSearchParams({
    chainId: String(scope.chainId),
    account: scope.account,
  });
  const payload = await backendFetch<TicketBalanceResponsePayload>(
    `${TICKET_BALANCE_PATH}?${query}`,
  );
  if (payload?.success && payload.balance !== undefined && payload.balance !== null) {
    return {
      available: BigInt(payload.balance),
      authority: "backend-mirror" as const,
      updatedAtMs: Date.now(),
    };
  }
  throw new Error(payload?.error || "Failed to load spendable ticket balance from backend.");
}

export function requestDailyClaim(scope: TicketQueryScope) {
  return backendPost<unknown>(DAILY_CLAIM_PATH, {
    chainId: scope.chainId,
    account: scope.account,
  });
}


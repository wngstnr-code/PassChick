import { backendFetch, backendPost } from "~/lib/backend/api";
import type { TicketQueryScope } from "../tickets/domain.ts";
import { parseDailyClaimStatus } from "./status.ts";

const DAILY_STATUS_PATH = "/api/tickets/daily/status";
const DAILY_CLAIM_PATH = "/api/tickets/daily/claim";

export async function getDailyClaimStatus(scope: TicketQueryScope) {
  const query = new URLSearchParams({
    chainId: String(scope.chainId),
    account: scope.account,
  });
  const payload = await backendFetch<unknown>(`${DAILY_STATUS_PATH}?${query}`);
  return parseDailyClaimStatus(payload);
}

export function requestDailyClaim(scope: TicketQueryScope) {
  return backendPost<unknown>(DAILY_CLAIM_PATH, {
    chainId: scope.chainId,
    account: scope.account,
  });
}

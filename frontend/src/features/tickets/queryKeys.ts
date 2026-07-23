import type { TicketQueryScope } from "./domain.ts";

export type TicketQuerySource = "mock" | "production";

function scopedKey(
  scope: TicketQueryScope,
  source: TicketQuerySource,
) {
  return [source, scope.chainId, scope.account] as const;
}

export const ticketQueryKeys = {
  all: ["tickets"] as const,
  balance: (scope: TicketQueryScope, source: TicketQuerySource = "production") =>
    [...ticketQueryKeys.all, "balance", ...scopedKey(scope, source)] as const,
  dailyClaim: (scope: TicketQueryScope, source: TicketQuerySource = "production") =>
    [...ticketQueryKeys.all, "daily-claim", ...scopedKey(scope, source)] as const,
  supportedTokens: (
    scope: TicketQueryScope,
    source: TicketQuerySource = "production",
  ) => [...ticketQueryKeys.all, "supported-tokens", ...scopedKey(scope, source)] as const,
  legacyBalance: (
    scope: TicketQueryScope,
    source: TicketQuerySource = "production",
  ) => [...ticketQueryKeys.all, "legacy-balance", ...scopedKey(scope, source)] as const,
};

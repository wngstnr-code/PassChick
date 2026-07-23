import { readTicketChainConfig } from "./config.ts";
import {
  normalizeEvmAddress,
  quoteTicketPurchase,
  type DailyClaimStatus,
  type PaymentTokenSymbol,
  type PurchaseQuote,
  type PurchaseQuoteRequest,
  type StablecoinAmount,
  type SupportedCeloChainId,
  type SupportedPaymentToken,
  type TicketBalance,
  type TicketQueryScope,
} from "./domain.ts";

export type TicketAdapterKind = "mock" | "production";

export type TicketAdapter = {
  kind: TicketAdapterKind;
  getTicketBalance: (scope: TicketQueryScope) => Promise<TicketBalance>;
  getDailyClaimStatus: (scope: TicketQueryScope) => Promise<DailyClaimStatus>;
  getSupportedPaymentTokens: (
    scope: TicketQueryScope,
  ) => Promise<readonly SupportedPaymentToken[]>;
  getLegacyGameVaultBalance: (
    scope: TicketQueryScope,
  ) => Promise<StablecoinAmount>;
  quotePurchase: (
    scope: TicketQueryScope,
    request: PurchaseQuoteRequest,
  ) => Promise<PurchaseQuote>;
};

export type ProductionTicketDataSource = Omit<TicketAdapter, "kind">;

export function createProductionTicketAdapter(
  source: ProductionTicketDataSource,
): TicketAdapter {
  return {
    kind: "production",
    getTicketBalance: (scope) => source.getTicketBalance(scope),
    getDailyClaimStatus: (scope) => source.getDailyClaimStatus(scope),
    getSupportedPaymentTokens: (scope) => source.getSupportedPaymentTokens(scope),
    getLegacyGameVaultBalance: (scope) => source.getLegacyGameVaultBalance(scope),
    quotePurchase: (scope, request) => source.quotePurchase(scope, request),
  };
}

type MockBalanceSeed = {
  chainId: SupportedCeloChainId;
  account: string;
  available: bigint;
  updatedAtMs?: number;
};

type MockDailyClaimSeed = {
  chainId: SupportedCeloChainId;
  account: string;
  status: DailyClaimStatus;
};

type MockLegacyBalanceSeed = {
  chainId: SupportedCeloChainId;
  account: string;
  amount: StablecoinAmount;
};

export type MockTicketAdapterSeed = {
  balances?: readonly MockBalanceSeed[];
  dailyClaims?: readonly MockDailyClaimSeed[];
  legacyBalances?: readonly MockLegacyBalanceSeed[];
};

function scopeKey(scope: TicketQueryScope) {
  return `${scope.chainId}:${scope.account}`;
}

function seedKey(chainId: SupportedCeloChainId, account: string) {
  const normalizedAccount = normalizeEvmAddress(account);
  if (!normalizedAccount) throw new Error("Mock ticket seed contains an invalid account.");
  return `${chainId}:${normalizedAccount}`;
}

function findToken(
  tokens: readonly SupportedPaymentToken[],
  symbol: PaymentTokenSymbol,
) {
  const token = tokens.find((candidate) => candidate.symbol === symbol && candidate.enabled);
  if (!token) throw new Error(`${symbol} is not enabled for ticket purchases on this chain.`);
  return token;
}

export function createMockTicketAdapter(seed: MockTicketAdapterSeed = {}): TicketAdapter {
  const balances = new Map(
    (seed.balances || []).map((item) => [
      seedKey(item.chainId, item.account),
      {
        available: item.available,
        authority: "mock" as const,
        updatedAtMs: item.updatedAtMs ?? 0,
      },
    ]),
  );
  const dailyClaims = new Map(
    (seed.dailyClaims || []).map((item) => [
      seedKey(item.chainId, item.account),
      item.status,
    ]),
  );
  const legacyBalances = new Map(
    (seed.legacyBalances || []).map((item) => [
      seedKey(item.chainId, item.account),
      item.amount,
    ]),
  );

  return {
    kind: "mock",
    async getTicketBalance(scope) {
      return (
        balances.get(scopeKey(scope)) || {
          available: 0n,
          authority: "mock",
          updatedAtMs: 0,
        }
      );
    },
    async getDailyClaimStatus(scope) {
      return (
        dailyClaims.get(scopeKey(scope)) || {
          claimable: false,
          streakDay: 0,
          nextClaimAtMs: null,
          expectedTickets: 0n,
        }
      );
    },
    async getSupportedPaymentTokens(scope) {
      return readTicketChainConfig(scope.chainId, {}).paymentTokens;
    },
    async getLegacyGameVaultBalance(scope) {
      return (
        legacyBalances.get(scopeKey(scope)) || {
          symbol: "USDC",
          decimals: 6,
          units: 0n,
        }
      );
    },
    async quotePurchase(scope, request) {
      const token = findToken(
        readTicketChainConfig(scope.chainId, {}).paymentTokens,
        request.symbol,
      );
      return quoteTicketPurchase({
        ...request,
        decimals: token.decimals,
      });
    },
  };
}

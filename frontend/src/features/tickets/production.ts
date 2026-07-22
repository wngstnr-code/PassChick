import type { Abi } from "viem";
import type { ProductionTicketDataSource } from "./adapters.ts";
import { readTicketChainConfig, type TicketChainConfig } from "./config.ts";
import { GAME_VAULT_READ_ABI } from "./contracts.ts";
import {
  quoteTicketPurchase,
  type DailyClaimStatus,
  type EvmAddress,
  type PaymentTokenSymbol,
  type SupportedCeloChainId,
  type SupportedPaymentToken,
  type TicketQueryScope,
} from "./domain.ts";

export type TicketContractReadRequest = {
  address: EvmAddress;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

export type TicketContractReader = {
  readContract: (request: TicketContractReadRequest) => Promise<unknown>;
};

export type OnchainTicketDataSourceOptions = {
  getClient: (chainId: SupportedCeloChainId) => TicketContractReader;
  getDailyClaimStatus: (scope: TicketQueryScope) => Promise<DailyClaimStatus>;
  getConfig?: (chainId: SupportedCeloChainId) => TicketChainConfig;
  now?: () => number;
};

function requireTicketVault(config: TicketChainConfig) {
  const { ticketVault } = config;
  if (
    ticketVault.status !== "ready" ||
    !ticketVault.address ||
    !ticketVault.abi ||
    !ticketVault.deploymentVersion
  ) {
    throw new Error(`TicketVault is not configured for Celo chain ${config.chainId}.`);
  }
  return {
    address: ticketVault.address,
    abi: ticketVault.abi,
  };
}

function requireBigint(value: unknown, functionName: string) {
  if (typeof value !== "bigint") {
    throw new TypeError(`${functionName} returned a non-bigint value.`);
  }
  return value;
}

function findEnabledToken(
  tokens: readonly SupportedPaymentToken[],
  symbol: PaymentTokenSymbol,
) {
  const token = tokens.find(
    (candidate) => candidate.symbol === symbol && candidate.enabled && candidate.address,
  );
  if (!token) {
    throw new Error(`${symbol} is not enabled for ticket purchases on this chain.`);
  }
  return token;
}

export function createOnchainTicketDataSource(
  options: OnchainTicketDataSourceOptions,
): ProductionTicketDataSource {
  const getConfig = options.getConfig ?? ((chainId) => readTicketChainConfig(chainId));
  const now = options.now ?? Date.now;

  return {
    async getTicketBalance(scope) {
      const config = getConfig(scope.chainId);
      const contract = requireTicketVault(config);
      const available = await options.getClient(scope.chainId).readContract({
        ...contract,
        functionName: "ticketBalance",
        args: [scope.account],
      });

      return {
        available: requireBigint(available, "ticketBalance"),
        authority: "onchain",
        updatedAtMs: now(),
      };
    },
    getDailyClaimStatus(scope) {
      return options.getDailyClaimStatus(scope);
    },
    async getSupportedPaymentTokens(scope) {
      return getConfig(scope.chainId).paymentTokens;
    },
    async getLegacyGameVaultBalance(scope) {
      const config = getConfig(scope.chainId);
      if (!config.legacyGameVaultAddress) {
        return { symbol: "USDC", decimals: 6, units: 0n };
      }

      const units = await options.getClient(scope.chainId).readContract({
        address: config.legacyGameVaultAddress,
        abi: GAME_VAULT_READ_ABI,
        functionName: "availableBalanceOf",
        args: [scope.account],
      });

      return {
        symbol: "USDC",
        decimals: 6,
        units: requireBigint(units, "availableBalanceOf"),
      };
    },
    async quotePurchase(scope, request) {
      const token = findEnabledToken(
        getConfig(scope.chainId).paymentTokens,
        request.symbol,
      );
      return quoteTicketPurchase({
        ...request,
        decimals: token.decimals,
      });
    },
  };
}

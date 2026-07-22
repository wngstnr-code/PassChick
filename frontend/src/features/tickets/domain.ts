export const CELO_MAINNET_CHAIN_ID = 42_220 as const;
export const CELO_SEPOLIA_CHAIN_ID = 11_142_220 as const;
export const TICKETS_PER_DOLLAR = 20n;

export type SupportedCeloChainId =
  | typeof CELO_MAINNET_CHAIN_ID
  | typeof CELO_SEPOLIA_CHAIN_ID;

export type EvmAddress = `0x${string}`;
export type PaymentTokenSymbol = "USDC" | "USDT" | "USDm";

export type TicketQueryScope = {
  account: EvmAddress;
  chainId: SupportedCeloChainId;
};

export type TicketBalance = {
  available: bigint;
  authority: "backend-mirror" | "onchain" | "mock";
  updatedAtMs: number;
};

export type DailyClaimStatus = {
  claimable: boolean;
  streakDay: number;
  nextClaimAtMs: number | null;
  expectedTickets: bigint;
};

export type StablecoinAmount = {
  symbol: PaymentTokenSymbol;
  decimals: number;
  units: bigint;
};

export type SupportedPaymentToken = {
  symbol: PaymentTokenSymbol;
  name: string;
  address: EvmAddress | null;
  decimals: 6 | 18;
  enabled: boolean;
  configurationStatus: "verified" | "needs-review";
  feeCurrencyAddress: EvmAddress | null;
};

export type PurchaseQuoteRequest = {
  symbol: PaymentTokenSymbol;
  ticketAmount: bigint;
};

export type PurchaseQuote = {
  paymentAmount: StablecoinAmount;
  ticketAmount: bigint;
  ticketsPerDollar: bigint;
};

export type TransactionState =
  | { status: "idle" }
  | { status: "awaiting-wallet" }
  | { status: "submitted"; hash: `0x${string}` }
  | { status: "confirmed"; hash: `0x${string}`; confirmedAtMs: number }
  | { status: "failed"; message: string; recoverable: boolean };

export function parseSupportedChainId(
  value: number | string | null | undefined,
): SupportedCeloChainId | null {
  if (value === null || value === undefined || value === "") return null;

  const parsed =
    typeof value === "number"
      ? value
      : value.trim().toLowerCase().startsWith("0x")
        ? Number.parseInt(value, 16)
        : Number(value);

  if (parsed === CELO_MAINNET_CHAIN_ID) return CELO_MAINNET_CHAIN_ID;
  if (parsed === CELO_SEPOLIA_CHAIN_ID) return CELO_SEPOLIA_CHAIN_ID;
  return null;
}

export function normalizeEvmAddress(value: string): EvmAddress | null {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase() as EvmAddress;
}

export function createTicketQueryScope(
  account: string,
  chainId: number | string | null | undefined,
): TicketQueryScope | null {
  const normalizedAccount = normalizeEvmAddress(account);
  const supportedChainId = parseSupportedChainId(chainId);
  if (!normalizedAccount || !supportedChainId) return null;

  return {
    account: normalizedAccount,
    chainId: supportedChainId,
  };
}

export function quoteTicketPurchase(input: {
  symbol: PaymentTokenSymbol;
  decimals: number;
  ticketAmount: bigint;
}): PurchaseQuote {
  if (input.ticketAmount <= 0n) {
    throw new RangeError("Ticket amount must be positive.");
  }
  if (input.ticketAmount % TICKETS_PER_DOLLAR !== 0n) {
    throw new RangeError("Ticket amount must be a multiple of 20.");
  }
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
    throw new RangeError("Token decimals must be an integer between 0 and 255.");
  }

  const tokenUnit = 10n ** BigInt(input.decimals);
  if (tokenUnit % TICKETS_PER_DOLLAR !== 0n) {
    throw new RangeError("Token precision cannot represent the ticket price exactly.");
  }

  return {
    paymentAmount: {
      symbol: input.symbol,
      decimals: input.decimals,
      units: (input.ticketAmount / TICKETS_PER_DOLLAR) * tokenUnit,
    },
    ticketAmount: input.ticketAmount,
    ticketsPerDollar: TICKETS_PER_DOLLAR,
  };
}

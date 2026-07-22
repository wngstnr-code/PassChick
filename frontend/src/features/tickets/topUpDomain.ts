import {
  TICKETS_PER_DOLLAR,
  type PaymentTokenSymbol,
  type SupportedPaymentToken,
} from "./domain.ts";

export type TopUpQuote = {
  usdAmount: bigint;
  costUnits: bigint;
  ticketAmount: bigint;
};

export type TopUpErrorAction = "retry" | "deposit" | "refresh";

export type TopUpErrorState = {
  message: string;
  action: TopUpErrorAction;
};

export type PaymentTokenBalances = Partial<Record<PaymentTokenSymbol, bigint>>;

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return Number((error as { code?: unknown }).code);
}

function readErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "");
  }
  return "";
}

export function parseTopUpUsdAmount(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RangeError("Top up must use whole digital dollars.");
  }
  const amount = BigInt(normalized);
  if (amount < 1n) throw new RangeError("Top up must be at least 1 digital dollar.");
  return amount;
}

export function quoteTopUp(
  token: Pick<SupportedPaymentToken, "decimals">,
  usdAmount: bigint,
): TopUpQuote {
  if (usdAmount < 1n) throw new RangeError("Top up must be at least 1 digital dollar.");
  return {
    usdAmount,
    costUnits: usdAmount * 10n ** BigInt(token.decimals),
    ticketAmount: usdAmount * TICKETS_PER_DOLLAR,
  };
}

function hasLargerNormalizedBalance(
  candidate: SupportedPaymentToken,
  candidateUnits: bigint,
  current: SupportedPaymentToken,
  currentUnits: bigint,
) {
  return (
    candidateUnits * 10n ** BigInt(current.decimals) >
    currentUnits * 10n ** BigInt(candidate.decimals)
  );
}

export function selectDefaultTopUpToken(
  tokens: readonly SupportedPaymentToken[],
  balances: PaymentTokenBalances,
) {
  const enabled = tokens.filter((token) => token.enabled && token.address);
  if (!enabled.length) return null;

  return enabled.slice(1).reduce((selected, candidate) => {
    const candidateUnits = balances[candidate.symbol] ?? 0n;
    const selectedUnits = balances[selected.symbol] ?? 0n;
    return hasLargerNormalizedBalance(candidate, candidateUnits, selected, selectedUnits)
      ? candidate
      : selected;
  }, enabled[0]);
}

export function shouldShowLegacyWithdraw(units: bigint) {
  return units > 0n;
}

export function classifyTopUpError(error: unknown): TopUpErrorState {
  if (readErrorCode(error) === 4001) {
    return {
      message: "Top up cancelled. No stablecoin was moved.",
      action: "retry",
    };
  }

  const message = readErrorText(error);
  if (/insufficient funds|insufficient balance|transfer amount exceeds balance/i.test(message)) {
    return {
      message: "Not enough stablecoin for this top up. Deposit or choose a smaller amount.",
      action: "deposit",
    };
  }
  if (/TokenNotEnabled|shop.*closed|not enabled/i.test(message)) {
    return {
      message: "This payment token is not enabled by TicketVault. Refreshing shop options.",
      action: "refresh",
    };
  }
  return {
    message: message || "Ticket top up failed. Please try again.",
    action: "retry",
  };
}

import { concat, encodeFunctionData, parseAbi, type Hex } from "viem";
import { TICKET_VAULT_ABI, TICKET_VAULT_DEPLOYMENTS } from "./contracts.ts";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  normalizeEvmAddress,
  type EvmAddress,
  type SupportedCeloChainId,
  type SupportedPaymentToken,
} from "./domain.ts";
import { quoteTopUp } from "./topUpDomain.ts";
import type { Eip1193Provider } from "~/lib/web3/celo";

const APPROVAL_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const DEFAULT_FEE_CURRENCIES = {
  [CELO_MAINNET_CHAIN_ID]: "0x765de816845861e75a25fca122bb6898b8b1282a",
  [CELO_SEPOLIA_CHAIN_ID]: "0xef4d55d6de8e8d73232827cd1e9b2f2dbb45bc80",
} as const satisfies Record<SupportedCeloChainId, EvmAddress>;

export type TicketTopUpTransaction = {
  from: EvmAddress;
  to: EvmAddress;
  data: Hex;
  value: "0x0";
  chainId: Hex;
  feeCurrency: EvmAddress;
};

export type TopUpTransactionPlan = {
  approval: TicketTopUpTransaction | null;
  purchase: TicketTopUpTransaction;
  costUnits: bigint;
  ticketAmount: bigint;
};

function appendSuffix(data: Hex, suffix: Hex | "") {
  return !suffix || suffix === "0x" ? data : concat([data, suffix]);
}

export function buildTopUpTransactionPlan(input: {
  chainId: SupportedCeloChainId;
  account: string;
  token: SupportedPaymentToken;
  usdAmount: bigint;
  allowanceUnits: bigint;
  attributionSuffix?: Hex | "";
}): TopUpTransactionPlan {
  const account = normalizeEvmAddress(input.account);
  const tokenAddress = normalizeEvmAddress(input.token.address || "");
  if (!account) throw new Error("A connected wallet is required for ticket top up.");
  if (!input.token.enabled || !tokenAddress) {
    throw new Error(`${input.token.symbol} is not enabled for ticket top up.`);
  }
  if (input.allowanceUnits < 0n) throw new RangeError("Token allowance cannot be negative.");

  const deployment = TICKET_VAULT_DEPLOYMENTS[input.chainId];
  const quote = quoteTopUp(input.token, input.usdAmount);
  const suffix = input.attributionSuffix || "0x";
  const feeCurrency =
    normalizeEvmAddress(input.token.feeCurrencyAddress || "") ||
    DEFAULT_FEE_CURRENCIES[input.chainId];
  const common = {
    from: account,
    value: "0x0" as const,
    chainId: `0x${input.chainId.toString(16)}` as Hex,
    feeCurrency,
  };

  const approval =
    input.allowanceUnits >= quote.costUnits
      ? null
      : {
          ...common,
          to: tokenAddress,
          data: appendSuffix(
            encodeFunctionData({
              abi: APPROVAL_ABI,
              functionName: "approve",
              args: [deployment.proxyAddress, quote.costUnits],
            }),
            suffix,
          ),
        };

  return {
    approval,
    purchase: {
      ...common,
      to: deployment.proxyAddress,
      data: appendSuffix(
        encodeFunctionData({
          abi: TICKET_VAULT_ABI,
          functionName: "buyTickets",
          args: [tokenAddress, input.usdAmount],
        }),
        suffix,
      ),
    },
    costUnits: quote.costUnits,
    ticketAmount: quote.ticketAmount,
  };
}

export async function sendTicketTopUpTransaction(
  provider: Eip1193Provider,
  transaction: TicketTopUpTransaction,
) {
  const hash = await provider.request<string>({
    method: "eth_sendTransaction",
    params: [transaction],
  });
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || "")) {
    throw new Error("Wallet did not return a valid transaction hash.");
  }
  return hash as `0x${string}`;
}

export async function waitForTicketTopUpReceipt(
  provider: Eip1193Provider,
  hash: `0x${string}`,
  options: { timeoutMs?: number; pollMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 1_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider.request<{
      blockNumber?: string | null;
      status?: string | null;
    } | null>({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });
    if (receipt?.blockNumber) {
      if (receipt.status && BigInt(receipt.status) === 0n) {
        throw new Error("Ticket top up failed onchain.");
      }
      return receipt;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
  }
  throw new Error("Ticket top up confirmation timed out. Refresh to check its status.");
}

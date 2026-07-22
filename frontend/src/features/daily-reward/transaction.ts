import { concat, encodeFunctionData, type Hex } from "viem";
import { TICKET_VAULT_ABI, TICKET_VAULT_DEPLOYMENTS } from "../tickets/contracts.ts";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  normalizeEvmAddress,
  type EvmAddress,
  type SupportedCeloChainId,
} from "../tickets/domain.ts";
import type { SignedDailyClaim } from "./domain.ts";
import type { Eip1193Provider } from "~/lib/web3/celo";

const CLAIM_FEE_CURRENCIES = {
  [CELO_MAINNET_CHAIN_ID]: "0x765de816845861e75a25fca122bb6898b8b1282a",
  [CELO_SEPOLIA_CHAIN_ID]: "0xef4d55d6de8e8d73232827cd1e9b2f2dbb45bc80",
} as const satisfies Record<SupportedCeloChainId, EvmAddress>;

export type DailyClaimTransaction = {
  from: EvmAddress;
  to: EvmAddress;
  data: Hex;
  value: "0x0";
  chainId: Hex;
  feeCurrency: EvmAddress;
};

export function buildDailyClaimTransaction(input: {
  chainId: SupportedCeloChainId;
  account: string;
  signedClaim: SignedDailyClaim;
  attributionSuffix?: Hex | "";
}): DailyClaimTransaction {
  const account = normalizeEvmAddress(input.account);
  if (!account || account !== input.signedClaim.claim.user) {
    throw new Error("Daily claim transaction must use the connected wallet.");
  }

  const callData = encodeFunctionData({
    abi: TICKET_VAULT_ABI,
    functionName: "claimDaily",
    args: [
      {
        ...input.signedClaim.claim,
        issuedAt: BigInt(input.signedClaim.claim.issuedAt),
      },
      input.signedClaim.signature,
    ],
  });
  const suffix = input.attributionSuffix || "0x";

  return {
    from: account,
    to: TICKET_VAULT_DEPLOYMENTS[input.chainId].proxyAddress,
    data: suffix === "0x" ? callData : concat([callData, suffix]),
    value: "0x0",
    chainId: `0x${input.chainId.toString(16)}`,
    feeCurrency: CLAIM_FEE_CURRENCIES[input.chainId],
  };
}

export async function sendDailyClaimTransaction(
  provider: Eip1193Provider,
  transaction: DailyClaimTransaction,
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

export async function waitForDailyClaimReceipt(
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
        throw new Error("Daily reward transaction failed onchain.");
      }
      return receipt;
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
  }
  throw new Error("Daily reward confirmation timed out. Refresh to check its status.");
}

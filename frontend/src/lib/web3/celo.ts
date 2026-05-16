"use client";

export type CeloChainMode = "mainnet" | "testnet" | "custom";

export type Eip1193Provider = {
  request: <T = unknown>(args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<T>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  isMiniPay?: boolean;
};

export type EvmTxRequest = {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
  gasLimit?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
  chainId?: string;
  feeCurrency?: string;
};

export type BackendEvmTxPayload = {
  success?: boolean;
  tx?: EvmTxRequest | string;
  txRequest?: EvmTxRequest | string;
  transaction?: EvmTxRequest | string;
  transactionRequest?: EvmTxRequest | string;
  unsignedTx?: EvmTxRequest | string;
  txHash?: string;
  amount?: string;
  amountUnits?: string;
};

const DEFAULT_CHAIN_ID = 11142220;
const DEFAULT_RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";
const DEFAULT_EXPLORER_URL = "https://celo-sepolia.blockscout.com";

const MAINNET_RPC_URL = "https://forno.celo.org";
const MAINNET_EXPLORER_URL = "https://celoscan.io";

function normalizeHex(value: number | string) {
  if (typeof value === "number") {
    return `0x${value.toString(16)}`;
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("0x")) return trimmed.toLowerCase();
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return `0x${parsed.toString(16)}`;
  return trimmed;
}

function normalizeDecimal(value: number | string) {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("0x")) {
    return Number.parseInt(trimmed, 16);
  }
  return Number(trimmed);
}

export const CELO_CHAIN_MODE = (
  process.env.NEXT_PUBLIC_CELO_CHAIN_MODE || "testnet"
) as CeloChainMode;

export const CELO_CHAIN_ID = normalizeDecimal(
  process.env.NEXT_PUBLIC_CELO_CHAIN_ID ||
    (CELO_CHAIN_MODE === "mainnet" ? 42220 : DEFAULT_CHAIN_ID),
);

export const CELO_CHAIN_ID_HEX = normalizeHex(CELO_CHAIN_ID);

export const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL ||
  (CELO_CHAIN_MODE === "mainnet" ? MAINNET_RPC_URL : DEFAULT_RPC_URL);

export const CELO_EXPLORER_URL = (
  process.env.NEXT_PUBLIC_CELO_EXPLORER_URL ||
  (CELO_CHAIN_MODE === "mainnet" ? MAINNET_EXPLORER_URL : DEFAULT_EXPLORER_URL)
).replace(/\/+$/, "");

export const CELO_CHAIN_NAME =
  process.env.NEXT_PUBLIC_CELO_CHAIN_NAME ||
  (CELO_CHAIN_ID === 42220 ? "Celo" : "Celo Sepolia");

export const CELO_NATIVE_CURRENCY = {
  name: "CELO",
  symbol: "CELO",
  decimals: 18,
};

export function hasCeloConfig() {
  return Boolean(CELO_CHAIN_ID && CELO_RPC_URL && CELO_EXPLORER_URL);
}

export function explorerTxUrl(hash: string) {
  const txHash = hash.trim();
  if (!txHash || txHash === "socket-game-started") return "";
  return `${CELO_EXPLORER_URL}/tx/${txHash}`;
}

export function readInjectedEvmProvider() {
  if (typeof window === "undefined") return null;
  return window.ethereum || null;
}

export function readMiniPayProvider() {
  const provider = readInjectedEvmProvider();
  return provider?.isMiniPay ? provider : null;
}

export function isMiniPayRuntime() {
  return Boolean(readMiniPayProvider());
}

export async function readProviderAccounts(provider: Eip1193Provider) {
  const accounts = await provider.request<string[]>({
    method: "eth_accounts",
  });
  return Array.isArray(accounts) ? accounts : [];
}

export async function requestProviderAccounts(provider: Eip1193Provider) {
  const accounts = await provider.request<string[]>({
    method: "eth_requestAccounts",
  });
  return Array.isArray(accounts) ? accounts : [];
}

export async function readProviderChainId(provider: Eip1193Provider) {
  const chainId = await provider.request<string>({
    method: "eth_chainId",
  });
  return normalizeHex(String(chainId || ""));
}

export async function switchProviderToCelo(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CELO_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? Number((error as { code?: unknown }).code)
        : 0;

    if (code !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: CELO_CHAIN_ID_HEX,
          chainName: CELO_CHAIN_NAME,
          nativeCurrency: CELO_NATIVE_CURRENCY,
          rpcUrls: [CELO_RPC_URL],
          blockExplorerUrls: [CELO_EXPLORER_URL],
        },
      ],
    });
  }
}

function parseTxCandidate(candidate: EvmTxRequest | string | undefined) {
  if (!candidate) return null;
  if (typeof candidate !== "string") return candidate;

  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{")) {
    throw new Error("Backend returned a legacy unsigned transaction string.");
  }

  return JSON.parse(trimmed) as EvmTxRequest;
}

export function readEvmTxRequest(payload: BackendEvmTxPayload) {
  const tx =
    parseTxCandidate(payload.txRequest) ||
    parseTxCandidate(payload.transactionRequest) ||
    parseTxCandidate(payload.transaction) ||
    parseTxCandidate(payload.tx) ||
    parseTxCandidate(payload.unsignedTx);

  if (!tx) {
    return null;
  }

  return {
    ...tx,
    gas: tx.gas || tx.gasLimit,
    chainId: normalizeHex(tx.chainId || CELO_CHAIN_ID_HEX),
  };
}

export async function sendEvmTransaction(
  provider: Eip1193Provider,
  payload: BackendEvmTxPayload,
  fallbackFrom: string,
) {
  if (payload.txHash) return payload.txHash;

  const tx = readEvmTxRequest(payload);
  if (!tx) {
    throw new Error("Backend did not return an EVM transaction request.");
  }

  await switchProviderToCelo(provider);

  const txHash = await provider.request<string>({
    method: "eth_sendTransaction",
    params: [
      {
        ...tx,
        from: tx.from || fallbackFrom,
      },
    ],
  });

  return String(txHash || "");
}

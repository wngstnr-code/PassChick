"use client";

import { CELO_CHAIN } from "./celo";

export const MINIPAY_ADD_CASH_URL = "https://minipay.opera.com/add_cash";

export const MINIPAY_UNSUPPORTED_CHAIN_MESSAGE =
  `MiniPay is detected, but this build expects ${CELO_CHAIN.chainName}. Open MiniPay on that network and configure matching contract addresses for the app.`;

type Eip1193RequestArguments = {
  method: string;
  params?: unknown[] | object;
};

export type BrowserEthereumProvider = {
  isMiniPay?: boolean;
  request: (args: Eip1193RequestArguments) => Promise<unknown>;
  on?: (eventName: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    eventName: string,
    listener: (...args: unknown[]) => void,
  ) => void;
};

type RuntimeWindow = Window & {
  ethereum?: BrowserEthereumProvider;
};

export function getInjectedProvider() {
  if (typeof window === "undefined") return null;
  return (window as RuntimeWindow).ethereum || null;
}

export function isMiniPayProvider(provider: BrowserEthereumProvider | null) {
  return provider?.isMiniPay === true;
}

export function normalizeProviderAccounts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function normalizeChainIdHex(value: unknown) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";

  if (normalized.startsWith("0x")) {
    return normalized;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";

  return `0x${parsed.toString(16)}`;
}

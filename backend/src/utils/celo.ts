import { getAddress, isAddress } from "viem";

export function isValidEvmAddress(value: string): boolean {
  return isAddress(String(value || "").trim());
}

export function normalizeEvmAddress(value: string): string {
  return getAddress(String(value || "").trim());
}

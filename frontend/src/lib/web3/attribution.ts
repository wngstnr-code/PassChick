import { codeFromHostname, toDataSuffix } from "@celo/attribution-tags";
import type { Hex } from "viem";

let cachedSuffix: Hex | null = null;

export function getAttributionDataSuffix(): Hex {
  if (cachedSuffix) return cachedSuffix;
  if (typeof window === "undefined") return "0x";
  cachedSuffix = toDataSuffix(codeFromHostname(window.location.hostname)) as Hex;
  return cachedSuffix;
}

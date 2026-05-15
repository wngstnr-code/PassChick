import { formatEther } from "viem";
import { env } from "../config/env.js";
import { backendAccount, publicClient } from "../lib/celo.js";

export async function readBackendSignerHealth() {
  const relayerAddress = backendAccount.address;
  const balanceWei = await publicClient.getBalance({ address: backendAccount.address });
  const balanceNative = Number(formatEther(balanceWei));

  return {
    relayerAddress,
    balanceWei: balanceWei.toString(),
    balanceNative,
    nativeSymbol: env.NATIVE_TOKEN_SYMBOL,
    healthy: balanceNative >= env.MIN_RECOMMENDED_NATIVE_BALANCE,
    minRecommendedNative: env.MIN_RECOMMENDED_NATIVE_BALANCE,
  };
}

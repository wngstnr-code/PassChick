import type { Chain } from "viem";
import { celo } from "viem/chains";
import { CELO_CHAIN } from "./celo";

const FALLBACK_CHAIN_ID = celo.id;
const FALLBACK_RPC_URL = celo.rpcUrls.default.http[0] || "";
const FALLBACK_EXPLORER_URL = celo.blockExplorers.default.url;

function buildCeloWagmiChain(): Chain {
  const chainId =
    CELO_CHAIN.chainIdDecimal > 0 ? CELO_CHAIN.chainIdDecimal : FALLBACK_CHAIN_ID;
  const rpcUrl = CELO_CHAIN.rpcUrls[0] || FALLBACK_RPC_URL;
  const explorerUrl = CELO_CHAIN.blockExplorerUrls[0] || FALLBACK_EXPLORER_URL;

  return {
    id: chainId,
    name: CELO_CHAIN.chainName || celo.name,
    nativeCurrency: {
      name: CELO_CHAIN.nativeCurrency.name,
      symbol: CELO_CHAIN.nativeCurrency.symbol,
      decimals: CELO_CHAIN.nativeCurrency.decimals,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: explorerUrl
      ? {
          default: {
            name: "Celo Explorer",
            url: explorerUrl,
          },
        }
      : undefined,
    testnet: chainId !== celo.id,
  };
}

export const celoWagmiChain = buildCeloWagmiChain();

export const appKitNetworks: [Chain, ...Chain[]] = [celoWagmiChain];

export const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "demo-project-id";

export const appKitMetadata = {
  name: "Pass Chick",
  description: "Crossy chicken game with fixed-stake paid runs on Celo.",
  url: "http://localhost:3000",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

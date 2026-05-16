"use client";

import { createAppKit } from "@reown/appkit/react";
import { celo, celoSepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import {
  CELO_CHAIN_ID,
  CELO_CHAIN_MODE,
  CELO_RPC_URL,
} from "~/lib/web3/celo";

export const CELO_NAMESPACE = "eip155" as const;
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "";

export function hasReownProjectId() {
  return Boolean(REOWN_PROJECT_ID);
}

function readAppUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "https://passchick.vercel.app";
}

function readAppKitNetwork(): AppKitNetwork {
  if (CELO_CHAIN_ID === 42220 || CELO_CHAIN_MODE === "mainnet") return celo;
  return celoSepolia;
}

export const CELO_APPKIT_NETWORK = readAppKitNetwork();
export const CELO_APPKIT_NETWORKS: [AppKitNetwork, ...AppKitNetwork[]] = [
  CELO_APPKIT_NETWORK,
];

export const wagmiAdapter = hasReownProjectId()
  ? new WagmiAdapter({
      projectId: REOWN_PROJECT_ID,
      networks: CELO_APPKIT_NETWORKS,
      customRpcUrls: {
        [CELO_CHAIN_ID]: [{ url: CELO_RPC_URL }],
      },
    })
  : null;

export const appKit = hasReownProjectId()
  ? createAppKit({
      adapters: wagmiAdapter ? [wagmiAdapter] : [],
      networks: CELO_APPKIT_NETWORKS,
      defaultNetwork: CELO_APPKIT_NETWORK,
      projectId: REOWN_PROJECT_ID,
      metadata: {
        name: "PASSCHICK",
        description:
          "A competitive onchain chicken-crossing game on Celo.",
        url: readAppUrl(),
        icons: [`${readAppUrl()}/favicon.png`],
      },
      themeMode: "dark",
      features: {
        analytics: false,
        email: true,
        socials: ["google", "apple", "x", "discord"],
        swaps: false,
        onramp: false,
        history: false,
      },
    })
  : null;

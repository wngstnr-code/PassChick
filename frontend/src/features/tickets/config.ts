import type { Abi } from "viem";
import {
  CELO_MAINNET_CHAIN_ID,
  normalizeEvmAddress,
  type EvmAddress,
  type SupportedCeloChainId,
  type SupportedPaymentToken,
} from "./domain.ts";

export { CELO_MAINNET_CHAIN_ID, CELO_SEPOLIA_CHAIN_ID } from "./domain.ts";

export type TicketContractStatus = "ready" | "awaiting-signoff";

export type TicketContractArtifact = {
  status: TicketContractStatus;
  address: EvmAddress | null;
  abi: Abi | null;
  deploymentVersion: string | null;
};

export type TicketChainConfig = {
  chainId: SupportedCeloChainId;
  paymentTokens: readonly SupportedPaymentToken[];
  ticketVault: TicketContractArtifact;
  legacyGameVaultAddress: EvmAddress | null;
};

export type TicketPublicEnv = Partial<{
  NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO: string;
  NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO: string;
  NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO_SEPOLIA: string;
  NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO_SEPOLIA: string;
  NEXT_PUBLIC_VAULT_ADDRESS: string;
  NEXT_PUBLIC_LEGACY_GAME_VAULT_ADDRESS_CELO_SEPOLIA: string;
}>;

const MAINNET_PAYMENT_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    enabled: true,
    configurationStatus: "verified",
    feeCurrencyAddress: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    enabled: true,
    configurationStatus: "verified",
    feeCurrencyAddress: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
  },
  {
    symbol: "USDm",
    name: "Mento Dollar",
    address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
    decimals: 18,
    enabled: true,
    configurationStatus: "verified",
    feeCurrencyAddress: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  },
] as const satisfies readonly SupportedPaymentToken[];

const SEPOLIA_PAYMENT_TOKENS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: null,
    decimals: 6,
    enabled: false,
    configurationStatus: "needs-review",
    feeCurrencyAddress: null,
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xd077A400968890Eacc75cdc901F0356c943e4fDb",
    decimals: 6,
    enabled: true,
    configurationStatus: "verified",
    feeCurrencyAddress: null,
  },
  {
    symbol: "USDm",
    name: "Mento Dollar",
    address: null,
    decimals: 18,
    enabled: false,
    configurationStatus: "needs-review",
    feeCurrencyAddress: null,
  },
] as const satisfies readonly SupportedPaymentToken[];

function readRuntimeEnv(): TicketPublicEnv {
  return {
    NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO:
      process.env.NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO,
    NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO:
      process.env.NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO,
    NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO_SEPOLIA:
      process.env.NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO_SEPOLIA,
    NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO_SEPOLIA:
      process.env.NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO_SEPOLIA,
    NEXT_PUBLIC_VAULT_ADDRESS: process.env.NEXT_PUBLIC_VAULT_ADDRESS,
    NEXT_PUBLIC_LEGACY_GAME_VAULT_ADDRESS_CELO_SEPOLIA:
      process.env.NEXT_PUBLIC_LEGACY_GAME_VAULT_ADDRESS_CELO_SEPOLIA,
  };
}

function readTicketVaultArtifact(
  addressValue: string | undefined,
  deploymentVersionValue: string | undefined,
  abi: Abi | null,
): TicketContractArtifact {
  const address = normalizeEvmAddress(addressValue || "");
  const deploymentVersion = deploymentVersionValue?.trim() || null;
  const ready = Boolean(address && abi && deploymentVersion);

  return {
    status: ready ? "ready" : "awaiting-signoff",
    address: ready ? address : null,
    abi: ready ? abi : null,
    deploymentVersion: ready ? deploymentVersion : null,
  };
}

export function readTicketChainConfig(
  chainId: SupportedCeloChainId,
  env: TicketPublicEnv = readRuntimeEnv(),
  signedOffTicketVaultAbi: Abi | null = null,
): TicketChainConfig {
  if (chainId === CELO_MAINNET_CHAIN_ID) {
    return {
      chainId,
      paymentTokens: MAINNET_PAYMENT_TOKENS,
      ticketVault: readTicketVaultArtifact(
        env.NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO,
        env.NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO,
        signedOffTicketVaultAbi,
      ),
      legacyGameVaultAddress: normalizeEvmAddress(env.NEXT_PUBLIC_VAULT_ADDRESS || ""),
    };
  }

  return {
    chainId,
    paymentTokens: SEPOLIA_PAYMENT_TOKENS,
    ticketVault: readTicketVaultArtifact(
      env.NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO_SEPOLIA,
      env.NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO_SEPOLIA,
      signedOffTicketVaultAbi,
    ),
    legacyGameVaultAddress: normalizeEvmAddress(
      env.NEXT_PUBLIC_LEGACY_GAME_VAULT_ADDRESS_CELO_SEPOLIA || "",
    ),
  };
}

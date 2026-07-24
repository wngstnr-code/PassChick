import { createPublicClient, http } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { getBackendTicketBalance, getDailyClaimStatus } from "~/features/daily-reward/api.ts";
import { CELO_CHAIN_ID, CELO_RPC_URL } from "~/lib/web3/celo";
import { createProductionTicketAdapter } from "./adapters.ts";
import { CELO_MAINNET_CHAIN_ID, type SupportedCeloChainId } from "./domain.ts";
import {
  createOnchainTicketDataSource,
  type TicketContractReader,
} from "./production.ts";

const mainnetClient = createPublicClient({
  chain: celo,
  transport: http(CELO_CHAIN_ID === celo.id ? CELO_RPC_URL : undefined),
});

const sepoliaClient = createPublicClient({
  chain: celoSepolia,
  transport: http(CELO_CHAIN_ID === celoSepolia.id ? CELO_RPC_URL : undefined),
});

export function getTicketPublicClient(chainId: SupportedCeloChainId) {
  return chainId === CELO_MAINNET_CHAIN_ID ? mainnetClient : sepoliaClient;
}

export const ticketRuntimeAdapter = createProductionTicketAdapter(
  createOnchainTicketDataSource({
    getClient: (chainId) =>
      getTicketPublicClient(chainId) as TicketContractReader,
    getDailyClaimStatus,
    getBackendTicketBalance,
  }),
);


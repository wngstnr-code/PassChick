import { createPublicClient, http } from "viem";
import { celo, celoSepolia } from "viem/chains";
import { CELO_CHAIN_ID, CELO_RPC_URL } from "~/lib/web3/celo";
import { createProductionTicketAdapter } from "../tickets/adapters.ts";
import { createOnchainTicketDataSource, type TicketContractReader } from "../tickets/production.ts";
import { CELO_MAINNET_CHAIN_ID } from "../tickets/domain.ts";
import { getDailyClaimStatus } from "./api.ts";

const mainnetClient = createPublicClient({
  chain: celo,
  transport: http(CELO_CHAIN_ID === celo.id ? CELO_RPC_URL : undefined),
});
const sepoliaClient = createPublicClient({
  chain: celoSepolia,
  transport: http(CELO_CHAIN_ID === celoSepolia.id ? CELO_RPC_URL : undefined),
});

export const dailyRewardTicketAdapter = createProductionTicketAdapter(
  createOnchainTicketDataSource({
    getClient: (chainId) =>
      (chainId === CELO_MAINNET_CHAIN_ID ? mainnetClient : sepoliaClient) as TicketContractReader,
    getDailyClaimStatus,
  }),
);

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  readTicketChainConfig,
} from "../config.ts";
import { createTicketQueryScope, quoteTicketPurchase } from "../domain.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const MAINNET_TICKET_VAULT = "0x8a1bd73ddfb4e06779d9c578a6447ae9b48199d5";
const SEPOLIA_TICKET_VAULT = "0x1490e6b836f552e8504fe6404c30953b15f899c8";
const SEPOLIA_USDC_MOCK = "0x8fb74c2a678811aecc6ed98bd5bc70e1119b7b61";

describe("TicketVault production integration", () => {
  it("ships the signed-off Mainnet deployment while keeping its shop closed", () => {
    const config = readTicketChainConfig(CELO_MAINNET_CHAIN_ID, {});

    assert.equal(config.ticketVault.status, "ready");
    assert.equal(config.ticketVault.address, MAINNET_TICKET_VAULT);
    assert.match(config.ticketVault.deploymentVersion, /ac5574ec/i);
    assert.ok(config.ticketVault.abi);
    assert.equal(config.paymentTokens.every((token) => !token.enabled), true);
  });

  it("ships the signed-off Sepolia deployment with only the PassChick USDC mock enabled", () => {
    const config = readTicketChainConfig(CELO_SEPOLIA_CHAIN_ID, {});
    const enabled = config.paymentTokens.filter((token) => token.enabled);

    assert.equal(config.ticketVault.status, "ready");
    assert.equal(config.ticketVault.address, SEPOLIA_TICKET_VAULT);
    assert.match(config.ticketVault.deploymentVersion, /6c131a95/i);
    assert.deepEqual(
      enabled.map((token) => [token.symbol, token.address, token.decimals]),
      [["USDC", SEPOLIA_USDC_MOCK, 6]],
    );
  });

  it("quotes only whole-dollar purchases accepted by buyTickets", () => {
    assert.equal(
      quoteTicketPurchase({ symbol: "USDC", decimals: 6, ticketAmount: 60n })
        .paymentAmount.units,
      3_000_000n,
    );
    assert.throws(
      () => quoteTicketPurchase({ symbol: "USDC", decimals: 6, ticketAmount: 1n }),
      /multiple of 20/i,
    );
    assert.throws(
      () => quoteTicketPurchase({ symbol: "USDm", decimals: 18, ticketAmount: 21n }),
      /multiple of 20/i,
    );
  });

  it("exports the reviewed TicketVault ABI surface", async () => {
    const { TICKET_VAULT_ABI } = await import("../contracts.ts");
    const names = new Set(TICKET_VAULT_ABI.map((item) => item.name).filter(Boolean));

    for (const name of [
      "ticketBalance",
      "lastClaimDay",
      "tokens",
      "claimSignatureTtl",
      "claimDaily",
      "buyTickets",
      "TicketClaimed",
      "TicketPurchased",
      "TokenNotEnabled",
      "DayAlreadyClaimed",
    ]) {
      assert.equal(names.has(name), true, `ABI is missing ${name}`);
    }
  });

  it("provides the real adapter reads without leaking contract calls into UI code", async () => {
    const { createOnchainTicketDataSource } = await import("../production.ts");
    const scope = createTicketQueryScope(ACCOUNT, CELO_MAINNET_CHAIN_ID);
    const calls = [];
    const dailyStatus = {
      claimable: true,
      streakDay: 4,
      nextClaimAtMs: null,
      expectedTickets: 5n,
    };

    assert.ok(scope);

    const source = createOnchainTicketDataSource({
      getClient(chainId) {
        assert.equal(chainId, CELO_MAINNET_CHAIN_ID);
        return {
          async readContract(request) {
            calls.push(request);
            if (request.functionName === "ticketBalance") return 12n;
            if (request.functionName === "availableBalanceOf") return 750_000n;
            throw new Error(`Unexpected function ${request.functionName}`);
          },
        };
      },
      getDailyClaimStatus: async (receivedScope) => {
        assert.deepEqual(receivedScope, scope);
        return dailyStatus;
      },
      now: () => 1234,
    });

    assert.deepEqual(await source.getTicketBalance(scope), {
      available: 12n,
      authority: "onchain",
      updatedAtMs: 1234,
    });
    assert.deepEqual(await source.getDailyClaimStatus(scope), dailyStatus);
    assert.equal((await source.getLegacyGameVaultBalance(scope)).units, 750_000n);
    assert.equal((await source.getSupportedPaymentTokens(scope)).every((token) => !token.enabled), true);
    assert.equal(calls[0].functionName, "ticketBalance");
    assert.equal(calls[1].functionName, "availableBalanceOf");
  });

  it("prioritizes backend mirror ticket balance when getBackendTicketBalance is provided", async () => {
    const { createOnchainTicketDataSource } = await import("../production.ts");
    const scope = createTicketQueryScope(ACCOUNT, CELO_SEPOLIA_CHAIN_ID);
    assert.ok(scope);

    const source = createOnchainTicketDataSource({
      getClient() {
        throw new Error("readContract should not be called when getBackendTicketBalance is supplied.");
      },
      getDailyClaimStatus: async () => ({
        claimable: false,
        streakDay: 1,
        nextClaimAtMs: null,
        expectedTickets: 0n,
      }),
      getBackendTicketBalance: async (receivedScope) => {
        assert.deepEqual(receivedScope, scope);
        return {
          available: 0n,
          authority: "backend-mirror",
          updatedAtMs: 9999,
        };
      },
    });

    const balance = await source.getTicketBalance(scope);
    assert.deepEqual(balance, {
      available: 0n,
      authority: "backend-mirror",
      updatedAtMs: 9999,
    });
  });
});


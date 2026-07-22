import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createTicketQueryScope,
  parseSupportedChainId,
  quoteTicketPurchase,
} from "../domain.ts";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  readTicketChainConfig,
} from "../config.ts";
import {
  createMockTicketAdapter,
  createProductionTicketAdapter,
} from "../adapters.ts";
import { ticketQueryKeys } from "../queryKeys.ts";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";

describe("ticket domain", () => {
  it("normalizes supported decimal and hexadecimal Celo chain identifiers", () => {
    assert.equal(parseSupportedChainId(42220), CELO_MAINNET_CHAIN_ID);
    assert.equal(parseSupportedChainId("42220"), CELO_MAINNET_CHAIN_ID);
    assert.equal(parseSupportedChainId("0xa4ec"), CELO_MAINNET_CHAIN_ID);
    assert.equal(parseSupportedChainId("11142220"), CELO_SEPOLIA_CHAIN_ID);
    assert.equal(parseSupportedChainId("0xaa044c"), CELO_SEPOLIA_CHAIN_ID);
    assert.equal(parseSupportedChainId("1"), null);
  });

  it("creates a normalized scope and rejects malformed wallet addresses", () => {
    assert.deepEqual(createTicketQueryScope("0x1111111111111111111111111111111111111111", "0xa4ec"), {
      account: ACCOUNT_A,
      chainId: CELO_MAINNET_CHAIN_ID,
    });
    assert.equal(createTicketQueryScope("0x123", "0xa4ec"), null);
    assert.equal(createTicketQueryScope(ACCOUNT_A, "0x1"), null);
  });

  it("quotes ticket purchases exactly with bigint for 6 and 18 decimals", () => {
    assert.deepEqual(quoteTicketPurchase({ symbol: "USDC", decimals: 6, ticketAmount: 1n }), {
      paymentAmount: { symbol: "USDC", decimals: 6, units: 50_000n },
      ticketAmount: 1n,
      ticketsPerDollar: 20n,
    });
    assert.equal(
      quoteTicketPurchase({ symbol: "USDm", decimals: 18, ticketAmount: 20n }).paymentAmount.units,
      1_000_000_000_000_000_000n,
    );
    assert.throws(
      () => quoteTicketPurchase({ symbol: "USDT", decimals: 6, ticketAmount: 0n }),
      /positive/i,
    );
  });

  it("ships verified stablecoin metadata while leaving PassChick contracts fail-closed", () => {
    const mainnet = readTicketChainConfig(CELO_MAINNET_CHAIN_ID, {});
    const sepolia = readTicketChainConfig(CELO_SEPOLIA_CHAIN_ID, {});

    assert.deepEqual(
      mainnet.paymentTokens.map(({ symbol, decimals }) => [symbol, decimals]),
      [["USDC", 6], ["USDT", 6], ["USDm", 18]],
    );
    assert.equal(mainnet.paymentTokens[0].address, "0xcebA9300f2b948710d2653dD7B07f33A8B32118C");
    assert.equal(sepolia.paymentTokens.find((token) => token.symbol === "USDT").address, "0xd077A400968890Eacc75cdc901F0356c943e4fDb");
    assert.equal(sepolia.paymentTokens.find((token) => token.symbol === "USDC").address, null);
    assert.equal(sepolia.paymentTokens.find((token) => token.symbol === "USDC").enabled, false);
    assert.equal(sepolia.paymentTokens.find((token) => token.symbol === "USDm").address, null);
    assert.equal(sepolia.paymentTokens.find((token) => token.symbol === "USDm").configurationStatus, "needs-review");
    assert.equal(mainnet.ticketVault.status, "awaiting-signoff");
    assert.equal(mainnet.ticketVault.address, null);
    assert.equal(mainnet.ticketVault.abi, null);
  });

  it("accepts a configured TicketVault only when address, ABI, and version are all signed off", () => {
    const abi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [], outputs: [] }];
    const config = readTicketChainConfig(CELO_MAINNET_CHAIN_ID, {
      NEXT_PUBLIC_TICKET_VAULT_ADDRESS_CELO: "0x3333333333333333333333333333333333333333",
      NEXT_PUBLIC_TICKET_VAULT_DEPLOYMENT_VERSION_CELO: "v2.0.0",
    }, abi);

    assert.equal(config.ticketVault.status, "ready");
    assert.equal(config.ticketVault.address, "0x3333333333333333333333333333333333333333");
    assert.equal(config.ticketVault.abi, abi);
    assert.equal(config.ticketVault.deploymentVersion, "v2.0.0");
  });

  it("keeps mock state isolated by chain and account", async () => {
    const adapter = createMockTicketAdapter({
      balances: [{ chainId: CELO_MAINNET_CHAIN_ID, account: ACCOUNT_A, available: 7n }],
    });
    const scopeA = createTicketQueryScope(ACCOUNT_A, CELO_MAINNET_CHAIN_ID);
    const scopeB = createTicketQueryScope(ACCOUNT_B, CELO_MAINNET_CHAIN_ID);

    assert.ok(scopeA);
    assert.ok(scopeB);
    assert.equal((await adapter.getTicketBalance(scopeA)).available, 7n);
    assert.equal((await adapter.getTicketBalance(scopeB)).available, 0n);
    assert.equal((await adapter.quotePurchase(scopeA, { symbol: "USDC", ticketAmount: 20n })).paymentAmount.units, 1_000_000n);
  });

  it("provides safe mock defaults for every read model", async () => {
    const adapter = createMockTicketAdapter();
    const scope = createTicketQueryScope(ACCOUNT_A, CELO_MAINNET_CHAIN_ID);

    assert.ok(scope);
    assert.equal((await adapter.getDailyClaimStatus(scope)).claimable, false);
    assert.equal((await adapter.getSupportedPaymentTokens(scope)).length, 3);
    assert.equal((await adapter.getLegacyGameVaultBalance(scope)).units, 0n);
    await assert.rejects(
      () => adapter.quotePurchase(scope, { symbol: "NOT_SUPPORTED", ticketAmount: 1n }),
      /not enabled/i,
    );
  });

  it("adapts a production data source to the same ticket interface", async () => {
    const calls = [];
    const source = {
      async getTicketBalance(scope) {
        calls.push(["balance", scope]);
        return { available: 9n, authority: "backend-mirror", updatedAtMs: 1 };
      },
      async getDailyClaimStatus(scope) {
        calls.push(["daily", scope]);
        return { claimable: true, streakDay: 2, nextClaimAtMs: null, expectedTickets: 2n };
      },
      async getSupportedPaymentTokens(scope) {
        calls.push(["tokens", scope]);
        return readTicketChainConfig(scope.chainId, {}).paymentTokens;
      },
      async getLegacyGameVaultBalance(scope) {
        calls.push(["legacy", scope]);
        return { symbol: "USDC", decimals: 6, units: 0n };
      },
      async quotePurchase(scope, request) {
        calls.push(["quote", scope]);
        return quoteTicketPurchase({ ...request, decimals: 6 });
      },
    };
    const adapter = createProductionTicketAdapter(source);
    const scope = createTicketQueryScope(ACCOUNT_A, CELO_MAINNET_CHAIN_ID);

    assert.ok(scope);
    assert.equal((await adapter.getTicketBalance(scope)).available, 9n);
    assert.equal((await adapter.getDailyClaimStatus(scope)).streakDay, 2);
    assert.equal((await adapter.getSupportedPaymentTokens(scope)).length, 3);
    assert.equal((await adapter.getLegacyGameVaultBalance(scope)).units, 0n);
    assert.equal((await adapter.quotePurchase(scope, { symbol: "USDC", ticketAmount: 1n })).ticketAmount, 1n);
    assert.equal(calls.length, 5);
  });

  it("includes chain and account in account-scoped query keys", () => {
    const scopeA = createTicketQueryScope(ACCOUNT_A, CELO_MAINNET_CHAIN_ID);
    const scopeB = createTicketQueryScope(ACCOUNT_B, CELO_MAINNET_CHAIN_ID);
    const scopeSepolia = createTicketQueryScope(ACCOUNT_A, CELO_SEPOLIA_CHAIN_ID);

    assert.ok(scopeA);
    assert.ok(scopeB);
    assert.ok(scopeSepolia);
    assert.notDeepEqual(ticketQueryKeys.balance(scopeA), ticketQueryKeys.balance(scopeB));
    assert.notDeepEqual(ticketQueryKeys.balance(scopeA), ticketQueryKeys.balance(scopeSepolia));
    assert.notDeepEqual(ticketQueryKeys.supportedTokens(scopeA), ticketQueryKeys.supportedTokens(scopeB));
    assert.notDeepEqual(ticketQueryKeys.dailyClaim(scopeA), ticketQueryKeys.dailyClaim(scopeB));
    assert.notDeepEqual(ticketQueryKeys.legacyBalance(scopeA), ticketQueryKeys.legacyBalance(scopeSepolia));
    assert.notDeepEqual(
      ticketQueryKeys.balance(scopeA, "mock"),
      ticketQueryKeys.balance(scopeA, "production"),
    );
  });

  it("can read runtime configuration without turning unsigned contract data into ready state", () => {
    const config = readTicketChainConfig(CELO_MAINNET_CHAIN_ID);
    assert.ok(["ready", "awaiting-signoff"].includes(config.ticketVault.status));
    if (config.ticketVault.status === "ready") {
      assert.ok(config.ticketVault.address);
      assert.ok(config.ticketVault.abi);
      assert.ok(config.ticketVault.deploymentVersion);
    }
  });
});

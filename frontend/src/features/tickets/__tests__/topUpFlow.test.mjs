import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const MAINNET_USDC = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0xceba9300f2b948710d2653dd7b07f33a8b32118c",
  decimals: 6,
  enabled: true,
  configurationStatus: "verified",
  feeCurrencyAddress: "0x2f25deb3848c207fc8e0c34035b3ba7fc157602b",
};

describe("FE-06 ticket top-up", () => {
  it("parses whole-dollar input without floating-point math", async () => {
    const { parseTopUpUsdAmount } = await import("../topUpDomain.ts");

    assert.equal(parseTopUpUsdAmount("5"), 5n);
    assert.equal(parseTopUpUsdAmount(" 12 "), 12n);
    assert.throws(() => parseTopUpUsdAmount("1.5"), /whole digital dollars/i);
    assert.throws(() => parseTopUpUsdAmount("0"), /at least 1/i);
    assert.throws(() => parseTopUpUsdAmount("1e3"), /whole digital dollars/i);
  });

  it("quotes exact token units and tickets for 6 and 18 decimals", async () => {
    const { quoteTopUp } = await import("../topUpDomain.ts");

    assert.deepEqual(quoteTopUp(MAINNET_USDC, 5n), {
      usdAmount: 5n,
      costUnits: 5_000_000n,
      ticketAmount: 100n,
    });
    assert.equal(
      quoteTopUp({ ...MAINNET_USDC, symbol: "USDm", decimals: 18 }, 2n).costUnits,
      2_000_000_000_000_000_000n,
    );
  });

  it("defaults to the enabled token with the largest normalized balance", async () => {
    const { selectDefaultTopUpToken } = await import("../topUpDomain.ts");
    const tokens = [
      MAINNET_USDC,
      { ...MAINNET_USDC, symbol: "USDT", enabled: false },
      {
        ...MAINNET_USDC,
        symbol: "USDm",
        decimals: 18,
        address: "0x765de816845861e75a25fca122bb6898b8b1282a",
        feeCurrencyAddress: "0x765de816845861e75a25fca122bb6898b8b1282a",
      },
    ];

    assert.equal(
      selectDefaultTopUpToken(tokens, {
        USDC: 3_500_000n,
        USDT: 999_000_000n,
        USDm: 4_000_000_000_000_000_000n,
      })?.symbol,
      "USDm",
    );
    assert.equal(
      selectDefaultTopUpToken(tokens, { USDC: 0n, USDT: 0n, USDm: 0n })?.symbol,
      "USDC",
    );
    assert.equal(selectDefaultTopUpToken(tokens.map((token) => ({ ...token, enabled: false })), {}), null);
  });

  it("shows legacy withdrawal only for a positive authoritative balance", async () => {
    const { shouldShowLegacyWithdraw } = await import("../topUpDomain.ts");

    assert.equal(shouldShowLegacyWithdraw(1n), true);
    assert.equal(shouldShowLegacyWithdraw(0n), false);
  });

  it("builds approval and purchase as attributed legacy Celo transactions", async () => {
    const { buildTopUpTransactionPlan } = await import("../topUpTransaction.ts");
    const attributionSuffix = "0x70617373636869636b0a0080218021802180218021802180218021";
    const plan = buildTopUpTransactionPlan({
      chainId: 42_220,
      account: ACCOUNT,
      token: MAINNET_USDC,
      usdAmount: 5n,
      allowanceUnits: 0n,
      attributionSuffix,
    });

    assert.equal(plan.costUnits, 5_000_000n);
    assert.equal(plan.ticketAmount, 100n);
    assert.equal(plan.approval?.to, MAINNET_USDC.address);
    assert.equal(plan.approval?.feeCurrency, MAINNET_USDC.feeCurrencyAddress);
    assert.equal(plan.approval?.data.endsWith(attributionSuffix.slice(2)), true);
    assert.equal(plan.purchase.to, "0x8a1bd73ddfb4e06779d9c578a6447ae9b48199d5");
    assert.equal(plan.purchase.feeCurrency, MAINNET_USDC.feeCurrencyAddress);
    assert.equal(plan.purchase.data.endsWith(attributionSuffix.slice(2)), true);
    assert.equal("maxFeePerGas" in plan.purchase, false);
    assert.equal("maxPriorityFeePerGas" in plan.purchase, false);
  });

  it("skips approval when allowance is sufficient", async () => {
    const { buildTopUpTransactionPlan } = await import("../topUpTransaction.ts");
    const plan = buildTopUpTransactionPlan({
      chainId: 42_220,
      account: ACCOUNT,
      token: MAINNET_USDC,
      usdAmount: 1n,
      allowanceUnits: 1_000_000n,
    });

    assert.equal(plan.approval, null);
  });

  it("uses USDm fee abstraction for a Sepolia purchase token without an adapter", async () => {
    const { buildTopUpTransactionPlan } = await import("../topUpTransaction.ts");
    const plan = buildTopUpTransactionPlan({
      chainId: 11_142_220,
      account: ACCOUNT,
      token: {
        ...MAINNET_USDC,
        address: "0x8fb74c2a678811aecc6ed98bd5bc70e1119b7b61",
        feeCurrencyAddress: null,
      },
      usdAmount: 1n,
      allowanceUnits: 0n,
    });

    assert.equal(plan.purchase.feeCurrency, "0xef4d55d6de8e8d73232827cd1e9b2f2dbb45bc80");
    assert.equal(plan.purchase.chainId, "0xaa37dc");
  });

  it("maps wallet, balance, and disabled-shop errors to recovery actions", async () => {
    const { classifyTopUpError } = await import("../topUpDomain.ts");

    assert.deepEqual(classifyTopUpError({ code: 4001 }), {
      message: "Top up cancelled. No stablecoin was moved.",
      action: "retry",
    });
    assert.equal(classifyTopUpError(new Error("insufficient funds")).action, "deposit");
    assert.equal(classifyTopUpError(new Error("TokenNotEnabled(0x1234)")).action, "refresh");
  });
});

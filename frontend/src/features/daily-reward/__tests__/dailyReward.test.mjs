import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const NOW_MS = 1_700_000_000_000;
const SIGNATURE = `0x${"11".repeat(65)}`;

function validPayload(overrides = {}) {
  return {
    success: true,
    claim: {
      user: ACCOUNT,
      dayIndex: 19_675,
      amount: 7,
      issuedAt: Math.floor(NOW_MS / 1000) - 30,
      nonce: "42",
      ...overrides,
    },
    signature: SIGNATURE,
  };
}

describe("daily reward domain", () => {
  it("builds the seven-day reward strip with mystery-box days", async () => {
    const { buildRewardWeek } = await import("../domain.ts");

    assert.deepEqual(
      buildRewardWeek({ streakDay: 3, claimable: true }).map((day) => [
        day.day,
        day.rewardKind,
        day.baseTickets,
        day.state,
      ]),
      [
        [1, "fixed", 5n, "claimed"],
        [2, "mystery", null, "claimed"],
        [3, "fixed", 7n, "current"],
        [4, "mystery", null, "locked"],
        [5, "fixed", 9n, "locked"],
        [6, "mystery", null, "locked"],
        [7, "fixed", 10n, "locked"],
      ],
    );
  });

  it("formats the next-claim countdown without negative time", async () => {
    const { formatClaimCountdown } = await import("../domain.ts");

    assert.equal(formatClaimCountdown(NOW_MS + 3_661_000, NOW_MS), "01:01:01");
    assert.equal(formatClaimCountdown(NOW_MS - 1, NOW_MS), "READY");
    assert.equal(formatClaimCountdown(null, NOW_MS), "--:--:--");
  });

  it("parses a fresh wallet-bound signed claim", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");

    assert.deepEqual(parseSignedDailyClaim(validPayload(), { account: ACCOUNT, nowMs: NOW_MS }), {
      claim: {
        user: ACCOUNT,
        dayIndex: 19_675,
        amount: 7,
        issuedAt: Math.floor(NOW_MS / 1000) - 30,
        nonce: 42n,
      },
      signature: SIGNATURE,
      expiresAtMs: NOW_MS + 570_000,
    });
  });

  it("rejects claims for another wallet or outside contract limits", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");

    assert.throws(
      () => parseSignedDailyClaim(validPayload({ user: "0x2222222222222222222222222222222222222222" }), { account: ACCOUNT, nowMs: NOW_MS }),
      /connected wallet/i,
    );
    assert.throws(
      () => parseSignedDailyClaim(validPayload({ amount: 101 }), { account: ACCOUNT, nowMs: NOW_MS }),
      /between 1 and 100/i,
    );
  });

  it("rejects stale signatures before asking the wallet", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");

    assert.throws(
      () => parseSignedDailyClaim(validPayload({ issuedAt: Math.floor(NOW_MS / 1000) - 600 }), { account: ACCOUNT, nowMs: NOW_MS }),
      /expired/i,
    );
  });

  it("builds a legacy Celo transaction with fee abstraction and attribution", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");
    const { buildDailyClaimTransaction } = await import("../transaction.ts");
    const signedClaim = parseSignedDailyClaim(validPayload(), {
      account: ACCOUNT,
      nowMs: NOW_MS,
    });
    const attributionSuffix = "0x70617373636869636b0a0080218021802180218021802180218021";

    const transaction = buildDailyClaimTransaction({
      chainId: 42_220,
      account: ACCOUNT,
      signedClaim,
      attributionSuffix,
    });

    assert.equal(transaction.from, ACCOUNT);
    assert.equal(transaction.to, "0x8a1bd73ddfb4e06779d9c578a6447ae9b48199d5");
    assert.equal(transaction.feeCurrency, "0x765de816845861e75a25fca122bb6898b8b1282a");
    assert.equal(transaction.chainId, "0xa4ec");
    assert.equal(transaction.data.endsWith(attributionSuffix.slice(2)), true);
    assert.equal("maxFeePerGas" in transaction, false);
    assert.equal("maxPriorityFeePerGas" in transaction, false);
  });

  it("maps recoverable contract failures to actionable UI states", async () => {
    const { classifyDailyClaimError } = await import("../domain.ts");

    assert.deepEqual(classifyDailyClaimError(new Error("DayAlreadyClaimed(19675,19675)")), {
      message: "Today's reward is already claimed. Your balance is refreshing.",
      recoverable: true,
      refreshRequired: true,
    });
    assert.deepEqual(classifyDailyClaimError({ code: 4001 }), {
      message: "Claim cancelled. You can try again when you're ready.",
      recoverable: true,
      refreshRequired: false,
    });
  });

  it("rejects malformed signatures, future timestamps, and invalid nonces", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");

    assert.throws(
      () => parseSignedDailyClaim({ ...validPayload(), signature: "0x11" }, { account: ACCOUNT, nowMs: NOW_MS }),
      /signature is invalid/i,
    );
    assert.throws(
      () => parseSignedDailyClaim(validPayload({ issuedAt: Math.floor(NOW_MS / 1000) + 1 }), { account: ACCOUNT, nowMs: NOW_MS }),
      /future/i,
    );
    assert.throws(
      () => parseSignedDailyClaim(validPayload({ nonce: "not-a-number" }), { account: ACCOUNT, nowMs: NOW_MS }),
      /nonce is invalid/i,
    );
  });

  it("sends a claim and waits for a successful receipt", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");
    const {
      buildDailyClaimTransaction,
      sendDailyClaimTransaction,
      waitForDailyClaimReceipt,
    } = await import("../transaction.ts");
    const signedClaim = parseSignedDailyClaim(validPayload(), { account: ACCOUNT, nowMs: NOW_MS });
    const transaction = buildDailyClaimTransaction({
      chainId: 42_220,
      account: ACCOUNT,
      signedClaim,
    });
    const hash = `0x${"ab".repeat(32)}`;
    const methods = [];
    const provider = {
      async request({ method }) {
        methods.push(method);
        if (method === "eth_sendTransaction") return hash;
        return { blockNumber: "0x10", status: "0x1" };
      },
    };

    assert.equal(await sendDailyClaimTransaction(provider, transaction), hash);
    assert.deepEqual(await waitForDailyClaimReceipt(provider, hash, { timeoutMs: 50, pollMs: 1 }), {
      blockNumber: "0x10",
      status: "0x1",
    });
    assert.deepEqual(methods, ["eth_sendTransaction", "eth_getTransactionReceipt"]);
  });

  it("rejects invalid wallet hashes, reverted receipts, and mismatched senders", async () => {
    const { parseSignedDailyClaim } = await import("../domain.ts");
    const {
      buildDailyClaimTransaction,
      sendDailyClaimTransaction,
      waitForDailyClaimReceipt,
    } = await import("../transaction.ts");
    const signedClaim = parseSignedDailyClaim(validPayload(), { account: ACCOUNT, nowMs: NOW_MS });

    assert.throws(
      () => buildDailyClaimTransaction({
        chainId: 42_220,
        account: "0x2222222222222222222222222222222222222222",
        signedClaim,
      }),
      /connected wallet/i,
    );
    await assert.rejects(
      sendDailyClaimTransaction({ request: async () => "bad-hash" }, buildDailyClaimTransaction({
        chainId: 42_220,
        account: ACCOUNT,
        signedClaim,
      })),
      /valid transaction hash/i,
    );
    await assert.rejects(
      waitForDailyClaimReceipt(
        { request: async () => ({ blockNumber: "0x10", status: "0x0" }) },
        `0x${"cd".repeat(32)}`,
        { timeoutMs: 50, pollMs: 1 },
      ),
      /failed onchain/i,
    );
  });

  it("classifies stale nonce, backend, and unknown failures", async () => {
    const { classifyDailyClaimError } = await import("../domain.ts");

    assert.equal(classifyDailyClaimError(new Error("NonceAlreadyUsed(42)")).refreshRequired, true);
    assert.equal(classifyDailyClaimError(new Error("Daily reward confirmation timed out.")).refreshRequired, true);
    assert.match(classifyDailyClaimError(new Error("Backend request timeout")).message, /timeout/i);
    assert.equal(classifyDailyClaimError(null).message, "Reward claim failed. Please try again.");
  });

  it("parses authoritative daily status and optional passport bonus", async () => {
    const { parseDailyClaimStatus } = await import("../status.ts");

    assert.deepEqual(parseDailyClaimStatus({
      success: true,
      status: {
        claimable: true,
        streakDay: 4,
        nextClaimAtMs: null,
        expectedTickets: "8",
        passportPerkApplied: true,
        passportBonusTickets: "2",
      },
    }), {
      claimable: true,
      streakDay: 4,
      nextClaimAtMs: null,
      expectedTickets: 8n,
      passportPerkApplied: true,
      passportBonusTickets: 2n,
    });
  });

  it("fails closed on malformed daily status", async () => {
    const { parseDailyClaimStatus } = await import("../status.ts");

    assert.throws(() => parseDailyClaimStatus(null), /response is missing/i);
    assert.throws(() => parseDailyClaimStatus({ success: false }), /refused/i);
    assert.throws(() => parseDailyClaimStatus({
      claimable: "yes",
      streakDay: 1,
      nextClaimAtMs: null,
      expectedTickets: 5,
    }), /claimable state/i);
    assert.throws(() => parseDailyClaimStatus({
      claimable: true,
      streakDay: 8,
      nextClaimAtMs: null,
      expectedTickets: 5,
    }), /streak/i);
    assert.throws(() => parseDailyClaimStatus({
      claimable: true,
      streakDay: 1,
      nextClaimAtMs: null,
      expectedTickets: 101,
    }), /ticket amount/i);
    assert.throws(() => parseDailyClaimStatus({
      claimable: true,
      streakDay: 1,
      nextClaimAtMs: null,
      expectedTickets: 5,
      passportPerkApplied: "false",
    }), /passport perk state/i);
  });
});

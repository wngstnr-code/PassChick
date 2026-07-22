import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKPOINT_ROW_INTERVAL,
  computeTier,
  countCashoutsAtOrAbove,
  countCheckpointCashouts,
  TIER_RULES,
} from "./tiers.js";

test("CHECKPOINT_ROW_INTERVAL matches CP_INTERVAL (40)", () => {
  assert.equal(CHECKPOINT_ROW_INTERVAL, 40);
});

test("computeTier: 0 sessions -> tier 0", () => {
  assert.equal(computeTier({}), 0);
});

test("computeTier: exactly at each tier threshold", () => {
  // Tier 1: Runner -> checkpoint 2, requiredCashouts 3
  assert.equal(computeTier({ "2": 3 }), 1);
  assert.equal(computeTier({ "2": 2 }), 0);

  // Tier 2: Steady -> checkpoint 4, requiredCashouts 4
  assert.equal(computeTier({ "2": 3, "4": 4 }), 2);
  assert.equal(computeTier({ "2": 3, "4": 3 }), 1);

  // Tier 3: Elite -> checkpoint 6, requiredCashouts 4
  assert.equal(computeTier({ "2": 3, "4": 4, "6": 4 }), 3);
  assert.equal(computeTier({ "2": 3, "4": 4, "6": 3 }), 2);

  // Tier 4: Oracle -> checkpoint 8, requiredCashouts 3
  assert.equal(computeTier({ "2": 3, "4": 4, "6": 4, "8": 3 }), 4);
  assert.equal(computeTier({ "2": 3, "4": 4, "6": 4, "8": 2 }), 3);
});

test("computeTier: above Oracle threshold stays at max tier (4)", () => {
  assert.equal(
    computeTier({ "2": 10, "4": 10, "6": 10, "8": 10 }),
    TIER_RULES[TIER_RULES.length - 1].tier,
  );
});

test("computeTier: higher checkpoint cashouts count toward lower tier requirements", () => {
  // 4 cashouts at checkpoint 8 also satisfy the >=2 (need 3), >=4 (need 4),
  // and >=6 (need 4) thresholds, so all four tiers are unlocked at once.
  assert.equal(computeTier({ "8": 4 }), 4);
});

test("countCashoutsAtOrAbove sums counts at or above the given checkpoint", () => {
  const counts = { "1": 5, "2": 3, "4": 2 };
  assert.equal(countCashoutsAtOrAbove(counts, 2), 5);
  assert.equal(countCashoutsAtOrAbove(counts, 1), 10);
  assert.equal(countCashoutsAtOrAbove(counts, 5), 0);
});

test("countCheckpointCashouts only counts CASHED_OUT rows above checkpoint 0", () => {
  const rows = [
    { max_row_reached: 80, status: "CASHED_OUT" }, // checkpoint 2
    { max_row_reached: 80, status: "CASHED_OUT" }, // checkpoint 2
    { max_row_reached: 39, status: "CASHED_OUT" }, // checkpoint 0 -> excluded
    { max_row_reached: 200, status: "CRASHED" }, // wrong status -> excluded
  ];

  const result = countCheckpointCashouts(rows);
  assert.deepEqual(result, { "2": 2 });
});

test("countCheckpointCashouts handles non-numeric max_row_reached as 0", () => {
  const rows = [
    { max_row_reached: "not-a-number", status: "CASHED_OUT" },
    { max_row_reached: null, status: "CASHED_OUT" },
    { max_row_reached: undefined, status: "CASHED_OUT" },
  ];

  const result = countCheckpointCashouts(rows);
  assert.deepEqual(result, {});
});

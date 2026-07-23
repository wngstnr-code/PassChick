import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMatchPoints, DIVISION_CP_THRESHOLD } from "./matchPoints.js";
import { DIVISION_ORDER } from "./seasonService.js";

test("computeMatchPoints: below threshold is always 0", () => {
  for (const division of DIVISION_ORDER) {
    const threshold = DIVISION_CP_THRESHOLD[division];
    for (let cp = 0; cp < threshold; cp++) {
      assert.equal(computeMatchPoints(division, cp), 0, `${division} CP ${cp}`);
    }
  }
});

test("computeMatchPoints: threshold = 1 point, each CP above adds 1", () => {
  for (const division of DIVISION_ORDER) {
    const threshold = DIVISION_CP_THRESHOLD[division];
    assert.equal(computeMatchPoints(division, threshold), 1);
    assert.equal(computeMatchPoints(division, threshold + 1), 2);
    assert.equal(computeMatchPoints(division, threshold + 5), 6);
  }
});

test("computeMatchPoints: spec examples (update_v2.md §5.1)", () => {
  assert.equal(computeMatchPoints("ROOKIE", 2), 1);
  assert.equal(computeMatchPoints("ROOKIE", 3), 2);
  assert.equal(computeMatchPoints("RUNNER", 3), 1);
  assert.equal(computeMatchPoints("STEADY", 4), 1);
  assert.equal(computeMatchPoints("ELITE", 5), 1);
  assert.equal(computeMatchPoints("ORACLE", 6), 1);
  assert.equal(computeMatchPoints("ORACLE", 7), 2);
});

test("computeMatchPoints: garbage input is 0 points", () => {
  assert.equal(computeMatchPoints("ROOKIE", Number.NaN), 0);
  assert.equal(computeMatchPoints("ROOKIE", Number.POSITIVE_INFINITY), 0);
  assert.equal(computeMatchPoints("ROOKIE", -3), 0);
});

test("computeMatchPoints: fractional checkpoints truncate", () => {
  assert.equal(computeMatchPoints("ROOKIE", 2.9), 1);
  assert.equal(computeMatchPoints("ROOKIE", 1.9), 0);
});

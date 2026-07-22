import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import {
  computeStreakDay,
  DAILY_REWARDS,
  rollDailyAmount,
  utcDayIndex,
} from "./dailyClaimService.js";

// ---------------------------------------------------------------- utcDayIndex

test("utcDayIndex: epoch is day 0", () => {
  assert.equal(utcDayIndex(new Date("1970-01-01T00:00:00.000Z")), 0);
});

test("utcDayIndex: known date", () => {
  // 2026-07-22T00:00:00Z is exactly 20656 days after the epoch.
  assert.equal(utcDayIndex(new Date("2026-07-22T00:00:00.000Z")), 20656);
});

test("utcDayIndex: same UTC day regardless of time-of-day", () => {
  const start = utcDayIndex(new Date("2026-07-22T00:00:00.000Z"));
  const end = utcDayIndex(new Date("2026-07-22T23:59:59.999Z"));
  assert.equal(start, end);
});

test("utcDayIndex: increments across a UTC day boundary", () => {
  const before = utcDayIndex(new Date("2026-07-22T23:59:59.999Z"));
  const after = utcDayIndex(new Date("2026-07-23T00:00:00.000Z"));
  assert.equal(after, before + 1);
});

// ------------------------------------------------------------ computeStreakDay

test("computeStreakDay: first-ever claim (no prior claim) -> day 1", () => {
  assert.equal(computeStreakDay(0, null, 20657), 1);
});

test("computeStreakDay: consecutive day advances the cycle", () => {
  assert.equal(computeStreakDay(1, 20657, 20658), 2);
  assert.equal(computeStreakDay(3, 20657, 20658), 4);
  assert.equal(computeStreakDay(6, 20657, 20658), 7);
});

test("computeStreakDay: day 7 wraps back to day 1", () => {
  assert.equal(computeStreakDay(7, 20657, 20658), 1);
});

test("computeStreakDay: skipped a day (streak broken) resets to day 1", () => {
  assert.equal(computeStreakDay(5, 20657, 20660), 1);
});

test("computeStreakDay: same dayIndex (already claimed today) does not advance", () => {
  // Not the caller's job to reject here, but the function should not treat
  // this as "consecutive" - it falls into the reset branch by definition
  // (todayIndex !== prevClaimDayIndex + 1). Callers must reject this case
  // themselves before ever reaching a claim.
  assert.equal(computeStreakDay(3, 20657, 20657), 1);
});

// ------------------------------------------------------------- rollDailyAmount

test("rollDailyAmount: fixed-amount days return the exact spec value", () => {
  assert.equal(rollDailyAmount(1), 5);
  assert.equal(rollDailyAmount(3), 7);
  assert.equal(rollDailyAmount(5), 9);
  assert.equal(rollDailyAmount(7), 10);
});

test("rollDailyAmount: mystery-box days roll within [1, 10] using injected rng", () => {
  const boxDays = [2, 4, 6];
  for (const day of boxDays) {
    assert.ok("box" in DAILY_REWARDS[day]!);
    assert.equal(rollDailyAmount(day, () => 0), 1);
    assert.equal(rollDailyAmount(day, () => 0.999999), 10);
    assert.equal(rollDailyAmount(day, () => 0.5), 6);
  }
});

test("rollDailyAmount: rejects an invalid streak day", () => {
  assert.throws(() => rollDailyAmount(0));
  assert.throws(() => rollDailyAmount(8));
});

// --------------------------------------------------------------- EIP-712 typehash

test("DAILY_CLAIM_TYPEHASH matches TicketVault.sol", () => {
  const typehash = keccak256(
    toBytes("DailyClaim(address user,uint32 dayIndex,uint16 amount,uint64 issuedAt,uint256 nonce)"),
  );
  assert.equal(typehash, "0xc225768d391bfd070c6d6bc101f342363ed5e246957bfbddd5b77516817a3da1");
});

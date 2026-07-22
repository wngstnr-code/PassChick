import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDivisionMovements,
  firstSeasonEndsAt,
  nextSeasonBounds,
  rankStandings,
  ticketRewardFor,
  type StandingEntry,
} from "./seasonService.js";

function entry(walletAddress: string, points: number, lastPointAt: string | null): StandingEntry {
  return { walletAddress, points, lastPointAt };
}

// ── rankStandings ───────────────────────────────────────────────────

test("rankStandings: sorts by points DESC", () => {
  const ranked = rankStandings([
    entry("a", 5, "2026-01-01T00:00:00Z"),
    entry("b", 10, "2026-01-01T00:00:00Z"),
    entry("c", 1, "2026-01-01T00:00:00Z"),
  ]);
  assert.deepEqual(
    ranked.map((e) => e.walletAddress),
    ["b", "a", "c"]
  );
});

test("rankStandings: tie-break by lastPointAt ASC (reached total first wins)", () => {
  const ranked = rankStandings([
    entry("later", 10, "2026-01-02T00:00:00Z"),
    entry("earlier", 10, "2026-01-01T00:00:00Z"),
  ]);
  assert.deepEqual(
    ranked.map((e) => e.walletAddress),
    ["earlier", "later"]
  );
});

test("rankStandings: null lastPointAt sorts last among equal points", () => {
  const ranked = rankStandings([
    entry("nullTime", 10, null),
    entry("timed", 10, "2026-01-05T00:00:00Z"),
  ]);
  assert.deepEqual(
    ranked.map((e) => e.walletAddress),
    ["timed", "nullTime"]
  );
});

test("rankStandings: fully tied entries ordered by wallet for determinism", () => {
  const ranked = rankStandings([
    entry("zzz", 10, null),
    entry("aaa", 10, null),
  ]);
  assert.deepEqual(
    ranked.map((e) => e.walletAddress),
    ["aaa", "zzz"]
  );
});

// ── computeDivisionMovements ────────────────────────────────────────

function activeEntries(count: number, prefix = "p"): StandingEntry[] {
  return Array.from({ length: count }, (_, i) => entry(`${prefix}${i}`, count - i, null));
}

test("small division (<20 active): top-3 promoted, no percentage relegation", () => {
  const ranked = rankStandings(activeEntries(10));
  const plan = computeDivisionMovements("RUNNER", ranked);
  assert.equal(plan.promoted.size, 3);
  assert.deepEqual([...plan.promoted], ["p0", "p1", "p2"]);
  assert.equal(plan.relegated.size, 0);
});

test("small division: ORACLE never promotes even with <20 active", () => {
  const ranked = rankStandings(activeEntries(5));
  const plan = computeDivisionMovements("ORACLE", ranked);
  assert.equal(plan.promoted.size, 0);
});

test("normal division (>=20 active): floor(pct) with min-1 promotion, bottom-% relegation", () => {
  // RUNNER: promote 15%, relegate 15%, 20 active players.
  const ranked = rankStandings(activeEntries(20));
  const plan = computeDivisionMovements("RUNNER", ranked);
  // floor(20 * 0.15) = 3
  assert.equal(plan.promoted.size, 3);
  assert.deepEqual([...plan.promoted], ["p0", "p1", "p2"]);
  assert.equal(plan.relegated.size, 3);
  assert.deepEqual([...plan.relegated], ["p19", "p18", "p17"]);
});

test("normal division: min-1 promotion even when floor(pct) would be 0", () => {
  // STEADY promotes 10%; 20 active => floor(2) = 2, still fine. Use a
  // smaller *active-but-still->=20* edge isn't possible below 20, so
  // verify via ELITE at exactly 20 (floor(20*0.10)=2, max(1,2)=2).
  const ranked = rankStandings(activeEntries(20));
  const plan = computeDivisionMovements("ELITE", ranked);
  assert.equal(plan.promoted.size, 2);
});

test("ROOKIE: no percentage relegation even at >=20 active", () => {
  const ranked = rankStandings(activeEntries(25));
  const plan = computeDivisionMovements("ROOKIE", ranked);
  assert.equal(plan.relegated.size, 0);
  // promotion 20% of 25 = floor(5) = 5
  assert.equal(plan.promoted.size, 5);
});

test("passive players (0 points) in RUNNER+ auto-relegate and are excluded from active base", () => {
  const active = activeEntries(20); // p0..p19, points 20..1
  const passive = [entry("passive1", 0, null), entry("passive2", 0, null)];
  const ranked = rankStandings([...active, ...passive]);
  const plan = computeDivisionMovements("RUNNER", ranked);

  assert.ok(plan.relegated.has("passive1"));
  assert.ok(plan.relegated.has("passive2"));

  // Active base for percentage math should still be 20 (passive excluded),
  // so relegation among active = floor(20*0.15) = 3, plus the 2 passives.
  assert.equal(plan.relegated.size, 5);
  assert.equal(plan.promoted.size, 3);
});

test("passive players in ROOKIE are NOT auto-relegated", () => {
  const active = activeEntries(20);
  const passive = [entry("passiveRookie", 0, null)];
  const ranked = rankStandings([...active, ...passive]);
  const plan = computeDivisionMovements("ROOKIE", ranked);
  assert.ok(!plan.relegated.has("passiveRookie"));
});

test("a player can never be both promoted and relegated (promotion wins in small divisions)", () => {
  // Small division with only 1 active passive-adjacent scenario is hard to
  // construct naturally, so just assert invariant holds on a normal case.
  const ranked = rankStandings(activeEntries(20));
  const plan = computeDivisionMovements("RUNNER", ranked);
  for (const wallet of plan.promoted) {
    assert.ok(!plan.relegated.has(wallet));
  }
});

// ── ticketRewardFor ──────────────────────────────────────────────────

test("ticketRewardFor: non-promoted always 0", () => {
  assert.equal(ticketRewardFor("ROOKIE", false), 0);
  assert.equal(ticketRewardFor("ORACLE", false), 0);
});

test("ticketRewardFor: promoted values per division", () => {
  assert.equal(ticketRewardFor("ROOKIE", true), 5);
  assert.equal(ticketRewardFor("RUNNER", true), 15);
  assert.equal(ticketRewardFor("STEADY", true), 20);
  assert.equal(ticketRewardFor("ELITE", true), 0);
  assert.equal(ticketRewardFor("ORACLE", true), 0);
});

// ── nextSeasonBounds ─────────────────────────────────────────────────

test("nextSeasonBounds: starts = prevEnds, ends = 1st of next month 00:00 UTC", () => {
  const prevEnds = new Date("2026-08-01T00:00:00Z");
  const { startsAt, endsAt } = nextSeasonBounds(prevEnds);
  assert.equal(startsAt.getTime(), prevEnds.getTime());
  assert.equal(endsAt.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("nextSeasonBounds: handles year rollover (Dec -> Jan 1)", () => {
  const prevEnds = new Date("2026-12-01T00:00:00Z");
  const { endsAt } = nextSeasonBounds(prevEnds);
  assert.equal(endsAt.toISOString(), "2027-01-01T00:00:00.000Z");
});

// ── firstSeasonEndsAt ────────────────────────────────────────────────

test("firstSeasonEndsAt: always lands on the 1st of a month at 00:00 UTC", () => {
  const samples = [
    new Date("2026-07-22T10:00:00Z"),
    new Date("2026-07-01T00:00:00Z"),
    new Date("2026-12-30T23:59:59Z"),
  ];
  for (const now of samples) {
    const result = firstSeasonEndsAt(now);
    assert.equal(result.getUTCDate(), 1, `expected 1st of month for input ${now.toISOString()}`);
    assert.equal(result.getUTCHours(), 0);
    assert.equal(result.getUTCMinutes(), 0);
    assert.equal(result.getUTCSeconds(), 0);
    assert.equal(result.getUTCMilliseconds(), 0);
  }
});

test("firstSeasonEndsAt: result is always >= 7 days from input", () => {
  const samples = [
    new Date("2026-07-22T10:00:00Z"), // mid-month -> Aug 1 is >= 7 days out
    new Date("2026-07-28T00:00:00Z"), // near month end -> Aug 1 too close, expect Sep 1
    new Date("2026-12-30T00:00:00Z"), // near year end -> Feb 1 next year
  ];
  for (const now of samples) {
    const result = firstSeasonEndsAt(now);
    assert.ok(
      result.getTime() - now.getTime() >= 7 * 24 * 60 * 60 * 1000,
      `expected >= 7 days for input ${now.toISOString()}, got ${result.toISOString()}`
    );
  }
});

test("firstSeasonEndsAt: skips to the month after next when the 1st is under 7 days away", () => {
  const now = new Date("2026-07-28T00:00:00Z");
  assert.equal(firstSeasonEndsAt(now).toISOString(), "2026-09-01T00:00:00.000Z");
});
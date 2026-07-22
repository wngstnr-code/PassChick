import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkRewards } from "./rewardBatchExecutor.js";

test("chunkRewards: filters out rows with ticket_reward <= 0", () => {
  const rows = [
    { wallet_address: "0xAAA", ticket_reward: 0 },
    { wallet_address: "0xBBB", ticket_reward: 50 },
    { wallet_address: "0xCCC", ticket_reward: -5 },
  ];
  const batches = chunkRewards(rows);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].users, ["0xBBB"]);
  assert.deepEqual(batches[0].amounts, [50n]);
});

test("chunkRewards: splits more than maxPerBatch entries into multiple batches", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({
    wallet_address: `0xwallet${i}`,
    ticket_reward: i + 1,
  }));
  const batches = chunkRewards(rows, 100);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].users.length, 100);
  assert.equal(batches[1].users.length, 100);
  assert.equal(batches[2].users.length, 50);
});

test("chunkRewards: amounts stay aligned with users within and across batches", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    wallet_address: `0xwallet${i}`,
    ticket_reward: (i + 1) * 10,
  }));
  const batches = chunkRewards(rows, 2);
  assert.equal(batches.length, 3);
  for (const batch of batches) {
    assert.equal(batch.users.length, batch.amounts.length);
  }
  assert.deepEqual(batches[0], { users: ["0xwallet0", "0xwallet1"], amounts: [10n, 20n] });
  assert.deepEqual(batches[1], { users: ["0xwallet2", "0xwallet3"], amounts: [30n, 40n] });
  assert.deepEqual(batches[2], { users: ["0xwallet4"], amounts: [50n] });
});

test("chunkRewards: converts ticket_reward numbers to bigint amounts", () => {
  const rows = [{ wallet_address: "0xDDD", ticket_reward: 1234 }];
  const batches = chunkRewards(rows);
  assert.equal(typeof batches[0].amounts[0], "bigint");
  assert.equal(batches[0].amounts[0], 1234n);
});

test("chunkRewards: empty input yields no batches", () => {
  assert.deepEqual(chunkRewards([]), []);
});

test("chunkRewards: default maxPerBatch is 100", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    wallet_address: `0xwallet${i}`,
    ticket_reward: 1,
  }));
  const batches = chunkRewards(rows);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].users.length, 100);
});

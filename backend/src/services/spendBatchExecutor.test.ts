import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nettRows,
  aggregateSpendByWallet,
  chunkSpends,
  type TicketLedgerRow,
} from "./spendBatchExecutor.js";

function row(overrides: Partial<TicketLedgerRow>): TicketLedgerRow {
  return {
    id: 1,
    wallet_address: "0xAAA",
    kind: "SPEND",
    amount: 1,
    session_id: "session-1",
    reconciled_tx_hash: null,
    ...overrides,
  };
}

test("nettRows: session with SPEND only is spendable", () => {
  const rows = [row({ id: 1, session_id: "s1", kind: "SPEND", amount: 5 })];
  const { spendableRows, netZeroIds } = nettRows(rows);
  assert.equal(spendableRows.length, 1);
  assert.equal(netZeroIds.length, 0);
  assert.equal(spendableRows[0].id, 1);
});

test("nettRows: session with SPEND + REFUND nets to zero and is excluded", () => {
  const rows = [
    row({ id: 1, session_id: "s1", kind: "SPEND", amount: 5 }),
    row({ id: 2, session_id: "s1", kind: "REFUND", amount: 5 }),
  ];
  const { spendableRows, netZeroIds } = nettRows(rows);
  assert.equal(spendableRows.length, 0);
  assert.deepEqual(netZeroIds.sort(), [1, 2]);
});

test("nettRows: mixed sessions - only the SPEND+REFUND session is netted out", () => {
  const rows = [
    row({ id: 1, session_id: "s1", kind: "SPEND", amount: 5 }),
    row({ id: 2, session_id: "s1", kind: "REFUND", amount: 5 }),
    row({ id: 3, session_id: "s2", kind: "SPEND", amount: 3 }),
  ];
  const { spendableRows, netZeroIds } = nettRows(rows);
  assert.equal(spendableRows.length, 1);
  assert.equal(spendableRows[0].id, 3);
  assert.deepEqual(netZeroIds.sort(), [1, 2]);
});

test("nettRows: empty input yields empty results", () => {
  const { spendableRows, netZeroIds } = nettRows([]);
  assert.deepEqual(spendableRows, []);
  assert.deepEqual(netZeroIds, []);
});

test("aggregateSpendByWallet: sums amounts per wallet across sessions", () => {
  const rows = [
    row({ id: 1, session_id: "s1", wallet_address: "0xAAA", amount: 5 }),
    row({ id: 2, session_id: "s2", wallet_address: "0xAAA", amount: 3 }),
    row({ id: 3, session_id: "s3", wallet_address: "0xBBB", amount: 7 }),
  ];
  const aggregated = aggregateSpendByWallet(rows);
  assert.deepEqual(aggregated, [
    { wallet_address: "0xAAA", amount: 8 },
    { wallet_address: "0xBBB", amount: 7 },
  ]);
});

test("aggregateSpendByWallet: empty input yields empty output", () => {
  assert.deepEqual(aggregateSpendByWallet([]), []);
});

test("chunkSpends: splits more than maxPerBatch entries into multiple batches", () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({
    wallet_address: `0xwallet${i}`,
    amount: i + 1,
  }));
  const batches = chunkSpends(rows, 200);
  assert.equal(batches.length, 3);
  assert.equal(batches[0].users.length, 200);
  assert.equal(batches[1].users.length, 200);
  assert.equal(batches[2].users.length, 50);
});

test("chunkSpends: default maxPerBatch is 200", () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    wallet_address: `0xwallet${i}`,
    amount: 1,
  }));
  const batches = chunkSpends(rows);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].users.length, 200);
});

test("chunkSpends: amounts convert to bigint and stay aligned with users", () => {
  const rows = [
    { wallet_address: "0xAAA", amount: 10 },
    { wallet_address: "0xBBB", amount: 20 },
  ];
  const batches = chunkSpends(rows);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].users, ["0xAAA", "0xBBB"]);
  assert.deepEqual(batches[0].amounts, [10n, 20n]);
  for (const amount of batches[0].amounts) {
    assert.equal(typeof amount, "bigint");
  }
});

test("chunkSpends: filters out non-positive amounts", () => {
  const rows = [
    { wallet_address: "0xAAA", amount: 0 },
    { wallet_address: "0xBBB", amount: 5 },
  ];
  const batches = chunkSpends(rows);
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].users, ["0xBBB"]);
});

test("chunkSpends: empty input yields no batches (nothing sent)", () => {
  assert.deepEqual(chunkSpends([]), []);
});

// E2E harness for BE-07 one-ticket play (docs/be07-game-session-contract.md).
//
// Exercises the V2 gameplay path end to end against a running backend: SIWE
// auth, ticket debit, idempotent start/replay, points, crash, duplicate-close
// replay, and the zero-move orphan refund.
//
// Prerequisites:
//   1. Backend booted on Sepolia with the V2 flag and the batch workers idle:
//        set -a; source .env; source .env.sepolia; set +a
//        GAME_V2_TICKET_MODE=true OPERATOR_PRIVATE_KEY= npx tsx src/index.ts
//   2. From backend/, in a second shell:
//        set -a; source .env; source .env.sepolia; set +a
//        node scripts/e2e-v2-ticket-play.mjs
//
// The harness uses a throwaway wallet, seeds only that wallet's ticket mirror,
// and deletes every row it created. It still writes to whatever Supabase
// project the environment points at - see STAGING_SEPOLIA.md, which notes that
// .env.sepolia deliberately does not override SUPABASE_*. Takes ~1 minute
// (most of it waiting out the 30s disconnect grace period).

import { io } from "socket.io-client";
import { createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { SiweMessage } from "siwe";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE_URL || "http://localhost:8000";
const CHAIN_ID = Number(process.env.CELO_CHAIN_ID || 11142220);
const SEED_TICKETS = 3;

// This script seeds and deletes rows. Mainnet play money is real player state,
// so refuse outright rather than trusting whoever sourced the env.
if (CHAIN_ID === 42220) {
  console.error("Refusing to run against Celo mainnet (chainId 42220). Source .env.sepolia first.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits for the first of several socket events; returns [eventName, payload].
function waitFor(socket, events, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${events.join("|")}`));
    }, timeoutMs);
    const handlers = events.map((ev) => {
      const h = (payload) => {
        cleanup();
        resolve([ev, payload]);
      };
      socket.on(ev, h);
      return [ev, h];
    });
    function cleanup() {
      clearTimeout(timer);
      for (const [ev, h] of handlers) socket.off(ev, h);
    }
  });
}

async function authenticate(account) {
  const nonceRes = await fetch(`${BASE}/auth/nonce`);
  const { nonce } = await nonceRes.json();
  const message = new SiweMessage({
    domain: "localhost:3000",
    address: account.address,
    statement: "Sign in to PassChick (E2E test).",
    uri: "http://localhost:3000",
    version: "1",
    chainId: CHAIN_ID,
    nonce,
  }).prepareMessage();

  const client = createWalletClient({ account, transport: http("http://127.0.0.1:1") });
  const signature = await client.signMessage({ message });

  const res = await fetch(`${BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const body = await res.json();
  if (!res.ok || !body.token) throw new Error(`auth failed: ${res.status} ${JSON.stringify(body)}`);
  return body.token;
}

async function seedTickets(wallet, balance) {
  const { error } = await supabase
    .from("ticket_balances")
    .upsert({ wallet_address: wallet, balance }, { onConflict: "wallet_address" });
  if (error) throw new Error(`seed failed: ${error.message}`);
}

async function readBalance(wallet) {
  const { data } = await supabase
    .from("ticket_balances")
    .select("balance")
    .eq("wallet_address", wallet)
    .maybeSingle();
  return Number(data?.balance ?? -1);
}

async function ledgerRows(wallet) {
  const { data } = await supabase
    .from("ticket_ledger")
    .select("kind, session_id")
    .eq("wallet_address", wallet);
  return data ?? [];
}

async function cleanup(wallet) {
  const { data: sessions } = await supabase
    .from("game_sessions")
    .select("session_id")
    .eq("wallet_address", wallet);
  const ids = (sessions ?? []).map((s) => s.session_id);
  if (ids.length) await supabase.from("ticket_ledger").delete().in("session_id", ids);
  await supabase.from("game_sessions").delete().eq("wallet_address", wallet);
  await supabase.from("season_points").delete().eq("wallet_address", wallet);
  await supabase.from("divisions").delete().eq("wallet_address", wallet);
  await supabase.from("ticket_balances").delete().eq("wallet_address", wallet);
  await supabase.from("daily_streaks").delete().eq("wallet_address", wallet);
  await supabase.from("players").delete().eq("wallet_address", wallet);
}

const uuid = () => crypto.randomUUID();

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  const wallet = getAddress(account.address);
  console.log(`\n🧪 Test wallet: ${wallet}\n`);

  let socket;
  try {
    const token = await authenticate(account);
    check("SIWE auth returns a session token", Boolean(token));

    await seedTickets(wallet, SEED_TICKETS);
    check("Ticket mirror seeded", (await readBalance(wallet)) === SEED_TICKETS, `balance=${SEED_TICKETS}`);

    socket = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
    await new Promise((res, rej) => {
      socket.on("connect", res);
      socket.on("connect_error", rej);
      setTimeout(() => rej(new Error("socket connect timeout")), 10000);
    });
    check("Socket authenticates with session token", socket.connected);

    // --- 1. Rejected: clientSessionId that is not a UUID v4 ---
    socket.emit("game:start", { clientSessionId: "not-a-uuid" });
    let [, err] = await waitFor(socket, ["game:start_error"]);
    check("Invalid clientSessionId → INVALID_REQUEST", err.code === "INVALID_REQUEST", err.code);

    // --- 2. Happy path start: exactly one ticket debited ---
    const intentA = uuid();
    socket.emit("game:start", { clientSessionId: intentA });
    let [, started] = await waitFor(socket, ["game:started", "game:start_error"]);
    check("Start succeeds", started.success === true, JSON.stringify(started.code ?? ""));
    check(
      "ticketBalanceAfter = seed - 1",
      started.session?.ticketBalanceAfter === String(SEED_TICKETS - 1),
      `got ${started.session?.ticketBalanceAfter}`,
    );
    check("ticketCost is 1", started.session?.ticketCost === 1);
    check("replayed=false on first start", started.replayed === false);
    check("No stake field in response", started.session?.stake === undefined);
    const sessionId = started.session?.sessionId;

    // --- 3. Replay: same intent must not debit twice ---
    socket.emit("game:start", { clientSessionId: intentA });
    let [, replay] = await waitFor(socket, ["game:started", "game:start_error"]);
    check("Same clientSessionId replays", replay.replayed === true, `sessionId match=${replay.session?.sessionId === sessionId}`);
    check("Replay did not debit again", (await readBalance(wallet)) === SEED_TICKETS - 1);

    // --- 4. New intent while a session is ACTIVE ---
    socket.emit("game:start", { clientSessionId: uuid() });
    let [, conflict] = await waitFor(socket, ["game:start_error", "game:started"]);
    check("New intent while active → SESSION_ALREADY_ACTIVE", conflict.code === "SESSION_ALREADY_ACTIVE", conflict.code);
    check("Conflict did not debit", (await readBalance(wallet)) === SEED_TICKETS - 1);

    // --- 5. Play to checkpoint 2 (ROOKIE threshold → 1 point) ---
    const rowsNeeded = 80;
    let lastState = null;
    socket.on("game:state", (s) => (lastState = s));
    for (let i = 0; i < rowsNeeded; i++) {
      socket.emit("game:move", { direction: "forward" });
      await sleep(150);
    }
    await sleep(500);
    check("Server tracked 80 forward rows", lastState?.maxRow === rowsNeeded, `maxRow=${lastState?.maxRow}`);
    check("Server reports CP 2", lastState?.cp === 2, `cp=${lastState?.cp}`);

    // --- 6. End the run ---
    socket.emit("game:end_run");
    let [, ended] = await waitFor(socket, ["game:ended", "game:error"]);
    check("game:end_run closes the session", ended.success === true);
    check("status = COMPLETED", ended.result?.status === "COMPLETED", ended.result?.status);
    check("finalCheckpoint = 2", ended.result?.finalCheckpoint === 2, `got ${ended.result?.finalCheckpoint}`);
    check("pointsAwarded = 1 (ROOKIE CP2)", ended.result?.pointsAwarded === 1, `got ${ended.result?.pointsAwarded}`);
    check("seasonPointsTotal = 1", ended.result?.seasonPointsTotal === 1, `got ${ended.result?.seasonPointsTotal}`);
    check("No settlement/cashout payload in V2 end", ended.result?.payout === undefined && ended.result?.settlementTxHash === undefined);

    // --- 7. Duplicate end: no double points ---
    socket.emit("game:end_run");
    const dup = await waitFor(socket, ["game:ended", "game:error"], 4000).catch(() => null);
    const { data: pointsRow } = await supabase
      .from("season_points")
      .select("points")
      .eq("wallet_address", wallet)
      .maybeSingle();
    check("Duplicate end_run does not double points", Number(pointsRow?.points) === 1, `points=${pointsRow?.points}`);
    check(
      "Duplicate end_run replies (spec §4)",
      dup?.[0] === "game:ended",
      dup ? `got ${dup[0]}` : "no reply at all",
    );

    // --- 8. Ledger: exactly one SPEND, no REFUND ---
    const ledger = await ledgerRows(wallet);
    check(
      "Exactly one SPEND row, no REFUND",
      ledger.filter((r) => r.kind === "SPEND").length === 1 && ledger.filter((r) => r.kind === "REFUND").length === 0,
      JSON.stringify(ledger.map((r) => r.kind)),
    );

    // --- 9. Recovery endpoint after a clean finish ---
    const activeRes = await fetch(`${BASE}/api/game/session/active`, { headers: { Authorization: `Bearer ${token}` } });
    const activeBody = await activeRes.json();
    check("GET /api/game/session/active → active:false", activeBody.active === false, JSON.stringify(activeBody));

    // --- 10. Reused (consumed) intent ---
    socket.emit("game:start", { clientSessionId: intentA });
    let [, consumed] = await waitFor(socket, ["game:start_error", "game:started"]);
    check("Finished intent reused → SESSION_CONSUMED", consumed.code === "SESSION_CONSUMED", consumed.code);

    // --- 11. Insufficient tickets ---
    await seedTickets(wallet, 0);
    socket.emit("game:start", { clientSessionId: uuid() });
    let [, broke] = await waitFor(socket, ["game:start_error", "game:started"]);
    check("Zero balance → INSUFFICIENT_TICKETS", broke.code === "INSUFFICIENT_TICKETS", broke.code);
    check("INSUFFICIENT_TICKETS is not retryable", broke.retryable === false);
    check("Balance still 0 (no negative debit)", (await readBalance(wallet)) === 0);

    // --- 12. Crash path: below the division threshold earns nothing ---
    await seedTickets(wallet, 2);
    socket.emit("game:start", { clientSessionId: uuid() });
    await waitFor(socket, ["game:started"]);
    for (let i = 0; i < 3; i++) {
      socket.emit("game:move", { direction: "forward" });
      await sleep(150);
    }
    socket.emit("game:crash");
    let [, crashed] = await waitFor(socket, ["game:ended", "game:error"]);
    check("game:crash closes the session", crashed.success === true);
    check("status = CRASHED", crashed.result?.status === "CRASHED", crashed.result?.status);
    check("CP 0 → 0 points", crashed.result?.pointsAwarded === 0, `got ${crashed.result?.pointsAwarded}`);
    check("Crash burned the ticket (balance 1)", (await readBalance(wallet)) === 1);

    socket.emit("game:crash");
    const dupCrash = await waitFor(socket, ["game:ended", "game:error"], 4000).catch(() => null);
    check("Duplicate game:crash replays game:ended", dupCrash?.[0] === "game:ended", dupCrash ? dupCrash[0] : "no reply");

    // --- 13. Orphan with zero moves: ticket refunded, session VOIDED ---
    const intentD = uuid();
    socket.emit("game:start", { clientSessionId: intentD });
    let [, orphan] = await waitFor(socket, ["game:started", "game:start_error"]);
    const orphanSessionId = orphan.session?.sessionId;
    check("Start before orphan test", orphan.success === true, `balance now ${orphan.session?.ticketBalanceAfter}`);
    socket.close();
    console.log("   …waiting out the 30s disconnect grace period");
    await sleep(36000);

    const { data: voided } = await supabase
      .from("game_sessions")
      .select("status")
      .eq("session_id", orphanSessionId)
      .maybeSingle();
    check("Zero-move orphan is VOIDED", voided?.status === "VOIDED", `status=${voided?.status}`);
    check("Orphan ticket refunded (balance back to 1)", (await readBalance(wallet)) === 1);
    const finalLedger = await ledgerRows(wallet);
    const orphanRows = finalLedger.filter((r) => r.session_id === orphanSessionId);
    check(
      "Orphan ledger has SPEND + exactly one REFUND",
      orphanRows.filter((r) => r.kind === "SPEND").length === 1 &&
        orphanRows.filter((r) => r.kind === "REFUND").length === 1,
      JSON.stringify(orphanRows.map((r) => r.kind)),
    );
  } finally {
    socket?.close();
    await cleanup(wallet);
    console.log("\n🧹 Test rows deleted.");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n──────── ${results.length - failed.length}/${results.length} checks passed ────────`);
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  • ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error("\n💥 Harness error:", err);
  process.exitCode = 1;
});

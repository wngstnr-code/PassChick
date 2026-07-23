-- PassChick V2 schema additions (season / division / ticket foundation).
--
-- This file is ADDITIVE to schema.sql (v1) and is meant to be applied
-- manually via the Supabase SQL editor against the existing production
-- database. It does not modify or drop any v1 table/enum/view.
--
-- How to apply:
--   1. Open the target Supabase project -> SQL Editor.
--   2. Paste the full contents of this file and run it once.
--   3. Safe to re-run: enum creation is guarded against
--      "duplicate_object", and every CREATE TABLE/INDEX uses
--      IF NOT EXISTS.
--
-- References: update_v2.md §3 (daily streaks), §5 (divisions/points),
-- §6 (season rewards), §8 (season lifecycle).

-- ── Enums ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE division_name AS ENUM ('ROOKIE', 'RUNNER', 'STEADY', 'ELITE', 'ORACLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE season_status AS ENUM ('ACTIVE', 'FREEZING', 'SETTLING', 'SETTLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE movement_type AS ENUM ('PROMOTED', 'RELEGATED', 'STAYED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reward_status AS ENUM ('NONE', 'PENDING', 'CREDITED', 'CLAIMABLE', 'CLAIMED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Seasons ──────────────────────────────────────────────────────────
-- One row per 2-week season. `ends_at` is the reset timestamp the
-- scheduler polls against. The *_at columns act as per-step idempotency
-- markers for the reset pipeline (§8): freeze -> movements -> rewards
-- -> passport badges -> open next season -> settled.
CREATE TABLE IF NOT EXISTS seasons (
  id BIGSERIAL PRIMARY KEY,
  season_number INTEGER NOT NULL UNIQUE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status season_status NOT NULL DEFAULT 'ACTIVE',
  frozen_at TIMESTAMPTZ,
  movements_at TIMESTAMPTZ,
  rewards_at TIMESTAMPTZ,
  passport_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one ACTIVE season may exist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_season ON seasons ((true)) WHERE status = 'ACTIVE';

-- ── Divisions ────────────────────────────────────────────────────────
-- Per-player division. Persists across seasons; only changes via
-- promotion/relegation applied during a season reset (§5.2).
CREATE TABLE IF NOT EXISTS divisions (
  wallet_address TEXT PRIMARY KEY REFERENCES players(wallet_address),
  division division_name NOT NULL DEFAULT 'ROOKIE',
  updated_season_id BIGINT REFERENCES seasons(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Season points ────────────────────────────────────────────────────
-- One row per (season, player). Becomes a frozen snapshot once the
-- season is settled (§5.1-§5.3, §6).
CREATE TABLE IF NOT EXISTS season_points (
  season_id BIGINT NOT NULL REFERENCES seasons(id),
  wallet_address TEXT NOT NULL REFERENCES players(wallet_address),
  division division_name NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  last_point_at TIMESTAMPTZ,
  final_rank INTEGER,
  movement movement_type,
  ticket_reward INTEGER NOT NULL DEFAULT 0,
  reward_status reward_status NOT NULL DEFAULT 'NONE',
  reward_tx_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_season_points_rank
  ON season_points (season_id, division, points DESC, last_point_at ASC);

CREATE INDEX IF NOT EXISTS idx_season_points_pending
  ON season_points (reward_status) WHERE reward_status = 'PENDING';

-- ── Daily streaks ────────────────────────────────────────────────────
-- Mirrors the on-chain `lastClaimDay` tracked by TicketVault (§3.1).
CREATE TABLE IF NOT EXISTS daily_streaks (
  wallet_address TEXT PRIMARY KEY REFERENCES players(wallet_address),
  streak_day SMALLINT NOT NULL DEFAULT 0 CHECK (streak_day BETWEEN 0 AND 7),
  last_claim_day DATE,
  total_claims INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Ticket balances ──────────────────────────────────────────────────
-- Off-chain mirror of the on-chain TicketVault balance (§9.2).
-- Reconciliation via the on-chain event listener is a follow-up (B6);
-- this table only defines the shape for now.
-- Invariant: balance = onchain_credited - offchain_debited.
CREATE TABLE IF NOT EXISTS ticket_balances (
  wallet_address TEXT PRIMARY KEY REFERENCES players(wallet_address),
  balance BIGINT NOT NULL DEFAULT 0,
  onchain_credited BIGINT NOT NULL DEFAULT 0,
  offchain_debited BIGINT NOT NULL DEFAULT 0,
  last_synced_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Row Level Security ───────────────────────────────────────────────
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE season_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_balances ENABLE ROW LEVEL SECURITY;

-- Public read for leaderboard/season data, matching the "Public read
-- players"/"Public read leaderboard_distance" precedent in schema.sql.
DO $$ BEGIN
  CREATE POLICY "Public read seasons"
    ON seasons FOR SELECT
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public read divisions"
    ON divisions FOR SELECT
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Public read season_points"
    ON season_points FOR SELECT
    USING (true);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- daily_streaks and ticket_balances have NO public policy — service-role
-- (Supabase admin client) only, following the `transactions` table
-- precedent in schema.sql (RLS enabled, no policy = default deny for
-- anon/authenticated roles).

-- ── V2.1 — ticket tx types ──────────────────────────────────────────────
-- Adds the TicketVault event types to the v1 `tx_type` enum (schema.sql:2)
-- so blockchainListener.ts can log TicketVault events into `transactions`.
-- Safe to run repeatedly: `ADD VALUE IF NOT EXISTS` is a no-op if the value
-- already exists. Safe to run standalone (just this block) against a DB
-- that already has schema.sql + the rest of schema_v2.sql applied.
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'TICKET_CLAIM';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'TICKET_PURCHASE';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'TICKET_CREDIT';
ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'TICKET_SPEND';

-- ── V2.2 — one-ticket play (BE-07 / B4) ─────────────────────────────────
-- Additive, safe to re-run. Adds the off-chain ticket spend ledger, the
-- atomic debit/refund functions behind `game:start`, and the V2 columns
-- on game_sessions. See docs/be07-game-session-contract.md.

ALTER TYPE game_status ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE game_status ADD VALUE IF NOT EXISTS 'VOIDED';

ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS client_session_id TEXT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS game_mode TEXT NOT NULL DEFAULT 'V1';
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS final_checkpoint INTEGER;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS points_awarded INTEGER;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS season_id BIGINT REFERENCES seasons(id);

-- Idempotency anchor for `game:start`: one row per (wallet, client intent).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_client_intent
  ON game_sessions (wallet_address, client_session_id)
  WHERE client_session_id IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE ticket_ledger_kind AS ENUM ('SPEND', 'REFUND');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Off-chain ticket movements. Invariant: at most one SPEND and at most one
-- REFUND per session (enforced by uq_ticket_ledger_session_kind), and a
-- REFUND only ever follows a SPEND of the same session.
-- `reconciled_tx_hash` is stamped by the spendBatch reconciliation job
-- once the spend has been pushed on-chain via TicketVault.spendBatch.
CREATE TABLE IF NOT EXISTS ticket_ledger (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES players(wallet_address),
  kind ticket_ledger_kind NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  session_id UUID NOT NULL REFERENCES game_sessions(session_id),
  reconciled_tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_ledger_session_kind
  ON ticket_ledger (session_id, kind);

CREATE INDEX IF NOT EXISTS idx_ticket_ledger_unreconciled
  ON ticket_ledger (wallet_address) WHERE reconciled_tx_hash IS NULL;

ALTER TABLE ticket_ledger ENABLE ROW LEVEL SECURITY;
-- No public policy: service-role only, like ticket_balances.

-- Atomically debits exactly one ticket for a session. Row-locks the
-- balance so concurrent starts serialize; the ledger unique index makes
-- replays (same session_id) return the current state without a second
-- debit. Result codes:
--   OK                     - ticket debited now
--   REPLAY                 - this session already debited (idempotent hit)
--   INSUFFICIENT_TICKETS   - balance < 1 (or no balance row yet)
--   SESSION_ALREADY_ACTIVE - another session of this wallet already holds
--                            an unrefunded SPEND while still ACTIVE
CREATE OR REPLACE FUNCTION debit_ticket_for_session(p_wallet TEXT, p_session UUID)
RETURNS TABLE (code TEXT, new_balance BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  -- Idempotent replay?
  IF EXISTS (
    SELECT 1 FROM ticket_ledger
    WHERE session_id = p_session AND kind = 'SPEND'
  ) THEN
    SELECT balance INTO v_balance FROM ticket_balances WHERE wallet_address = p_wallet;
    RETURN QUERY SELECT 'REPLAY'::TEXT, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  -- Serialize concurrent debits for this wallet.
  SELECT balance INTO v_balance
  FROM ticket_balances
  WHERE wallet_address = p_wallet
  FOR UPDATE;

  IF v_balance IS NULL OR v_balance < 1 THEN
    RETURN QUERY SELECT 'INSUFFICIENT_TICKETS'::TEXT, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  -- Exactly-one-active guard: another session that spent a ticket, was not
  -- refunded, and is still ACTIVE blocks a second debit.
  IF EXISTS (
    SELECT 1
    FROM ticket_ledger tl
    JOIN game_sessions gs ON gs.session_id = tl.session_id
    WHERE tl.wallet_address = p_wallet
      AND tl.kind = 'SPEND'
      AND tl.session_id <> p_session
      AND gs.status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM ticket_ledger r
        WHERE r.session_id = tl.session_id AND r.kind = 'REFUND'
      )
  ) THEN
    RETURN QUERY SELECT 'SESSION_ALREADY_ACTIVE'::TEXT, v_balance;
    RETURN;
  END IF;

  UPDATE ticket_balances
  SET balance = balance - 1,
      offchain_debited = offchain_debited + 1,
      updated_at = now()
  WHERE wallet_address = p_wallet;

  INSERT INTO ticket_ledger (wallet_address, kind, amount, session_id)
  VALUES (p_wallet, 'SPEND', 1, p_session);

  RETURN QUERY SELECT 'OK'::TEXT, v_balance - 1;
END;
$$;

-- Refunds the SPEND of a session (recovery of an orphaned session with no
-- progress, BE-07 §5). Idempotent: at most one REFUND per session.
-- Result codes: OK, REPLAY (already refunded), NO_SPEND (nothing to refund).
CREATE OR REPLACE FUNCTION refund_ticket_for_session(p_session UUID)
RETURNS TABLE (code TEXT, new_balance BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  v_wallet TEXT;
  v_balance BIGINT;
BEGIN
  SELECT wallet_address INTO v_wallet
  FROM ticket_ledger
  WHERE session_id = p_session AND kind = 'SPEND';

  IF v_wallet IS NULL THEN
    RETURN QUERY SELECT 'NO_SPEND'::TEXT, 0::BIGINT;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM ticket_ledger
    WHERE session_id = p_session AND kind = 'REFUND'
  ) THEN
    SELECT balance INTO v_balance FROM ticket_balances WHERE wallet_address = v_wallet;
    RETURN QUERY SELECT 'REPLAY'::TEXT, COALESCE(v_balance, 0);
    RETURN;
  END IF;

  UPDATE ticket_balances
  SET balance = balance + 1,
      offchain_debited = offchain_debited - 1,
      updated_at = now()
  WHERE wallet_address = v_wallet
  RETURNING balance INTO v_balance;

  INSERT INTO ticket_ledger (wallet_address, kind, amount, session_id)
  VALUES (v_wallet, 'REFUND', 1, p_session);

  RETURN QUERY SELECT 'OK'::TEXT, COALESCE(v_balance, 0);
END;
$$;

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

CREATE TYPE game_status AS ENUM ('ACTIVE', 'CRASHED', 'CASHED_OUT');
CREATE TYPE tx_type AS ENUM ('DEPOSIT', 'WITHDRAW', 'TREASURY_FUNDED', 'SESSION_STARTED', 'SESSION_SETTLED');

CREATE TABLE players (
  wallet_address TEXT PRIMARY KEY,
  total_games    INTEGER   NOT NULL DEFAULT 0,
  total_wins     INTEGER   NOT NULL DEFAULT 0,
  total_losses   INTEGER   NOT NULL DEFAULT 0,
  total_profit   DECIMAL(20,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_created_at ON players (created_at DESC);

CREATE TABLE game_sessions (
  session_id       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_session_id TEXT        UNIQUE,
  wallet_address   TEXT          NOT NULL REFERENCES players(wallet_address),
  stake_amount     DECIMAL(20,6) NOT NULL DEFAULT 0,
  status           game_status   NOT NULL DEFAULT 'ACTIVE',
  max_row_reached  INTEGER       NOT NULL DEFAULT 0,
  final_multiplier DECIMAL(10,4) NOT NULL DEFAULT 0,
  payout_amount    DECIMAL(20,6) NOT NULL DEFAULT 0,
  settlement_signature TEXT,       
  settlement_deadline  BIGINT,
  settlement_tx_hash   TEXT,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_wallet     ON game_sessions (wallet_address);
CREATE INDEX idx_sessions_status     ON game_sessions (status);
CREATE UNIQUE INDEX idx_sessions_onchain_id ON game_sessions (onchain_session_id)
  WHERE onchain_session_id IS NOT NULL;
CREATE INDEX idx_sessions_wallet_active ON game_sessions (wallet_address, status)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_sessions_created_at ON game_sessions (created_at DESC);

CREATE TABLE transactions (
  tx_hash        TEXT        PRIMARY KEY,
  wallet_address TEXT        NOT NULL REFERENCES players(wallet_address),
  type           tx_type     NOT NULL,
  onchain_session_id TEXT,
  amount         DECIMAL(20,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tx_wallet    ON transactions (wallet_address);
CREATE INDEX idx_tx_type      ON transactions (type);
CREATE INDEX idx_tx_created   ON transactions (created_at DESC);

CREATE OR REPLACE VIEW leaderboard_distance AS
SELECT
  wallet_address,
  MAX(max_row_reached) AS best_score,
  COUNT(*)::INTEGER    AS games_played,
  MAX(final_multiplier) AS best_multiplier
FROM game_sessions
WHERE status IN ('CASHED_OUT', 'CRASHED')
GROUP BY wallet_address
ORDER BY best_score DESC
LIMIT 100;

CREATE OR REPLACE VIEW leaderboard_profit AS
SELECT
  wallet_address,
  total_games,
  total_wins,
  total_losses,
  total_profit
FROM players
WHERE total_games > 0
ORDER BY total_profit DESC
LIMIT 100;

ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read leaderboard_distance"
  ON game_sessions FOR SELECT
  USING (status IN ('CASHED_OUT', 'CRASHED'));

CREATE POLICY "Public read players"
  ON players FOR SELECT
  USING (true);

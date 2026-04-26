// ── Multiplier Math ──────────────────────────────────────────
/** +0.025x per forward step (in basis points: 250 / 10000) */
export const STEP_INCREMENT_BP = 250;

/** CP bonus multiplier: ×1.2 (represented as 12/10) */
export const CP_BONUS_NUM = 12;
export const CP_BONUS_DEN = 10;

/** Checkpoint every N forward steps */
export const CP_INTERVAL = 40;

// ── Timer ────────────────────────────────────────────────────
/** Time limit per segment (between checkpoints): 60 seconds */
export const SEGMENT_TIME_MS = 60 * 1000;

/** Max time player can stay at a checkpoint: 60 seconds */
export const CP_MAX_STAY_MS = 60 * 1000;

/** Decay penalty when overtime: -0.1x per second (= -1000 bp/s) */
export const DECAY_BP_PER_SEC = 1000;

// ── Vehicle Speed ────────────────────────────────────────────
/** Vehicle speed multiplier per checkpoint passed */
export const SPEED_MULT_PER_CP = 1.1;

// ── Anti-Cheat ───────────────────────────────────────────────
/** Minimum time between moves (ms). Human can't move faster than ~120ms. */
export const MIN_MOVE_INTERVAL_MS = 120;

/** Max moves allowed in a time window */
export const MAX_MOVES_PER_WINDOW = 40;

/** Time window for max moves check (ms) */
export const MOVE_WINDOW_MS = 5000;

// ── Disconnect Policy ────────────────────────────────────────
/** Grace period for reconnection: 30 seconds */
export const GRACE_PERIOD_MS = 30 * 1000;

// ── Fixed Stake (USDC — 6 decimals) ─────────────────────────
/** Fixed gameplay stake: 0.0001 USDC */
export const FIXED_STAKE_UNITS = 100;

/** Fixed gameplay stake in display units */
export const FIXED_STAKE = FIXED_STAKE_UNITS / 1_000_000;

/** USDC decimals */
export const USDC_DECIMALS = 6;

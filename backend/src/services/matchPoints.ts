import type { DivisionName } from "./seasonService.js";

/// Pure §5.1 point math (update_v2.md): points come from the final
/// checkpoint (CP) of a match, with a per-division starting threshold.
/// Kept I/O-free so it is unit-testable like dailyClaimService.

export const DIVISION_CP_THRESHOLD: Readonly<Record<DivisionName, number>> = {
  ROOKIE: 2,
  RUNNER: 3,
  STEADY: 4,
  ELITE: 5,
  ORACLE: 6,
};

/// CP `threshold` = 1 point, `threshold + 1` = 2 points, and so on.
/// Below the division threshold (or nonsensical input) = 0 points.
export function computeMatchPoints(division: DivisionName, finalCheckpoint: number): number {
  const threshold = DIVISION_CP_THRESHOLD[division];
  if (!Number.isFinite(finalCheckpoint)) return 0;
  const checkpoint = Math.trunc(finalCheckpoint);
  if (checkpoint < threshold) return 0;
  return checkpoint - threshold + 1;
}

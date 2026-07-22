import { env } from "../config/env.js";
import {
  getCurrentSeason,
  bootstrapFirstSeason,
  freezeSeason,
  applyMovements,
  queueRewards,
  updatePassportBadges,
  openNextSeason,
} from "./seasonService.js";

/**
 * Polls the `seasons` table and drives the reset pipeline
 * (freeze -> movements -> rewards -> passport badges -> open next season)
 * per update_v2.md §8. Idempotent across restarts: each step is guarded
 * by its own NULL timestamp / expected status, so a crashed tick simply
 * resumes from wherever it left off on the next tick.
 */
export function startSeasonScheduler(): void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      let season = await getCurrentSeason();

      if (!season) {
        console.log("[SeasonScheduler] No season found. Bootstrapping season #1...");
        season = await bootstrapFirstSeason();
        console.log(
          `[SeasonScheduler] Season ${season.season_number} started, ends ${season.ends_at}.`
        );
        return;
      }

      if (season.status === "ACTIVE" && new Date(season.ends_at).getTime() <= Date.now()) {
        console.log(`[SeasonScheduler] Season ${season.season_number} ended. Freezing...`);
        await freezeSeason(season);
        season = await getCurrentSeason();
      }

      if (season && season.status === "FREEZING" && !season.movements_at) {
        console.log(`[SeasonScheduler] Applying movements for season ${season.season_number}...`);
        await applyMovements(season);
        season = await getCurrentSeason();
      }

      if (season && season.status === "SETTLING") {
        if (!season.rewards_at) {
          console.log(`[SeasonScheduler] Queueing rewards for season ${season.season_number}...`);
          await queueRewards(season);
          season = await getCurrentSeason();
        }

        if (season && !season.passport_at) {
          await updatePassportBadges(season);
          season = await getCurrentSeason();
        }

        if (season) {
          await openNextSeason(season);
          console.log(
            `[SeasonScheduler] Season ${season.season_number} settled. Next season opened.`
          );
        }
      }
    } catch (err) {
      console.error("[SeasonScheduler] Error during tick:", err);
    } finally {
      running = false;
    }
  };

  void tick();
  setInterval(tick, env.SEASON_TICK_MS);

  console.log("🗓️  Season scheduler started.");
}

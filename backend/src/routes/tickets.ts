import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../config/supabase.js";
import {
  buildClaimDailyTransaction,
  isTicketVaultConfigured,
  readLastClaimDay,
  readTicketBalance,
  signDailyClaim,
} from "../lib/celo.js";
import { computeStreakDay, DAILY_REWARDS, rollDailyAmount, utcDayIndex } from "../services/dailyClaimService.js";

const router = Router();

/// dayIndex is UTC days-since-epoch (see dailyClaimService.ts) and is
/// strictly monotonic on-chain. streakDay is the separate 1-7 reward-cycle
/// index (update_v2.md §3) - the two must never be confused.

function nonceBufferToUint256(nonce: Buffer): bigint {
  return BigInt(`0x${nonce.toString("hex")}`);
}

/// Converts a `daily_streaks.last_claim_day` DATE column (e.g. "2026-07-21")
/// into a UTC dayIndex, so it can be compared against on-chain dayIndex.
function dateStringToDayIndex(value: string): number {
  return utcDayIndex(new Date(`${value}T00:00:00.000Z`));
}

function previewForStreakDay(streakDay: number): number | "mystery" {
  const spec = DAILY_REWARDS[streakDay];
  if (!spec) return "mystery";
  return "amount" in spec ? spec.amount : "mystery";
}

router.get("/daily-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.walletAddress!;
    const todayIndex = utcDayIndex(new Date());
    const vaultConfigured = isTicketVaultConfigured();

    const { data: streakRow, error: streakError } = await supabase
      .from("daily_streaks")
      .select("streak_day, last_claim_day, total_claims")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (streakError) {
      throw streakError;
    }

    const prevStreakDay = streakRow?.streak_day ?? 0;

    // Prefer the on-chain lastClaimDay (it's the true source of guard truth for
    // monotonicity); fall back to the DB mirror if the vault isn't configured.
    let prevClaimDayIndex: number | null = null;
    let ticketBalance: string | null = null;

    if (vaultConfigured) {
      const [onchainLastClaimDay, balance] = await Promise.all([
        readLastClaimDay(walletAddress),
        readTicketBalance(walletAddress),
      ]);
      prevClaimDayIndex = onchainLastClaimDay > 0 ? onchainLastClaimDay : null;
      ticketBalance = balance.toString();
    } else if (streakRow?.last_claim_day) {
      prevClaimDayIndex = dateStringToDayIndex(String(streakRow.last_claim_day));
    }

    const claimedToday = prevClaimDayIndex !== null && prevClaimDayIndex >= todayIndex;
    const nextStreakDay = claimedToday
      ? (prevStreakDay % 7) + 1
      : computeStreakDay(prevStreakDay, prevClaimDayIndex, todayIndex);

    res.json({
      walletAddress,
      streakDay: prevStreakDay,
      lastClaimDay: prevClaimDayIndex,
      todayIndex,
      claimedToday,
      totalClaims: streakRow?.total_claims ?? 0,
      nextRewardPreview: previewForStreakDay(nextStreakDay),
      ticketBalance,
      vaultConfigured,
    });
  } catch (error) {
    console.error("❌ Daily status error:", error);
    res.status(500).json({ error: "Failed to load daily claim status." });
  }
});

router.post("/daily-claim", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isTicketVaultConfigured()) {
      res.status(503).json({ error: "TICKET_VAULT_ADDRESS belum dikonfigurasi di backend env." });
      return;
    }

    const walletAddress = req.walletAddress!;
    const todayIndex = utcDayIndex(new Date());

    const onchainLastClaimDay = await readLastClaimDay(walletAddress);
    if (onchainLastClaimDay >= todayIndex) {
      res.status(409).json({
        error: "Daily claim already submitted for today.",
        lastClaimDay: onchainLastClaimDay,
        todayIndex,
      });
      return;
    }

    const { data: streakRow, error: streakError } = await supabase
      .from("daily_streaks")
      .select("streak_day, last_claim_day")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (streakError) {
      throw streakError;
    }

    const prevStreakDay = streakRow?.streak_day ?? 0;
    const prevClaimDayIndex = onchainLastClaimDay > 0 ? onchainLastClaimDay : null;
    const streakDay = computeStreakDay(prevStreakDay, prevClaimDayIndex, todayIndex);
    const amount = rollDailyAmount(streakDay);

    const nonce = nonceBufferToUint256(randomBytes(32));
    const signed = await signDailyClaim({
      user: walletAddress,
      dayIndex: todayIndex,
      amount,
      nonce,
    });
    const transaction = await buildClaimDailyTransaction(signed.claim, signed.signature);

    // Intentionally NOT updating daily_streaks here: streak progression must
    // only advance once the TicketClaimed event is observed on-chain
    // (blockchainListener.ts), otherwise a signed-but-never-submitted claim
    // would silently advance the user's streak.
    res.json({
      claim: signed.claim,
      signature: signed.signature,
      expiresAt: signed.expiresAt,
      transaction,
      streakDay,
      amount,
    });
  } catch (error) {
    console.error("❌ Daily claim error:", error);
    res.status(500).json({ error: "Failed to issue daily claim signature." });
  }
});

export default router;

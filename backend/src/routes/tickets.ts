import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  buildClaimDailyTransaction,
  isTicketVaultConfigured,
  readLastClaimDay,
  readTicketBalance,
  signDailyClaim,
} from "../lib/celo.js";
import { computeStreakDay, DAILY_REWARDS, rollDailyAmount, utcDayIndex } from "../services/dailyClaimService.js";
import { readMirrorTicketBalance } from "../services/ticketPlay.js";

const router = Router();

/// dayIndex is UTC days-since-epoch (see dailyClaimService.ts) and is
/// strictly monotonic on-chain. streakDay is the separate 1-7 reward-cycle
/// index (update_v2.md §3) - the two must never be confused.

function nonceBufferToUint256(nonce: Buffer): bigint {
  return BigInt(`0x${nonce.toString("hex")}`);
}

const SEVEN_DAY_CYCLE = 7;
const MS_PER_DAY = 86_400_000;

/// FE contract (docs/fe05-daily-reward.md): expectedTickets must be an integer
/// string in [0, 100]. Fixed days expose their amount; mystery-box days expose
/// "0" ("unknown") because the roll only happens server-side at claim time and
/// the frontend renders its own mystery-box UI for those days.
function expectedTicketsForStreakDay(streakDay: number): string {
  const spec = DAILY_REWARDS[streakDay];
  if (spec && "amount" in spec) return String(spec.amount);
  return "0";
}

/// FE sends `chainId` + `account` on every daily-reward call. The wallet
/// identity itself still comes from the auth session; these fields exist so a
/// stale tab (switched account/network) fails loudly instead of acting on the
/// wrong scope.
function validateTicketScope(req: Request, res: Response): boolean {
  const source: Record<string, unknown> =
    req.method === "GET" ? (req.query as Record<string, unknown>) : ((req.body ?? {}) as Record<string, unknown>);

  const account = source.account;
  if (account !== undefined && String(account).toLowerCase() !== req.walletAddress!.toLowerCase()) {
    res.status(403).json({
      success: false,
      error: "Account does not match the authenticated backend session wallet.",
    });
    return false;
  }

  const chainId = source.chainId;
  if (chainId !== undefined && Number(chainId) !== env.CHAIN_ID) {
    res.status(400).json({
      success: false,
      error: `Unsupported chainId ${String(chainId)}; backend network is ${env.NETWORK_NAME} (chainId ${env.CHAIN_ID}).`,
    });
    return false;
  }

  return true;
}

/// GET /api/tickets/balance — spendable ticket balance from the backend mirror.
/// This is the SPENDABLE authority the FE must render in /play and /rewards.
/// TicketVault.ticketBalance() on-chain is only the pre-reconciliation ledger
/// (it does not reflect off-chain SPEND debits from game sessions), so the FE
/// must never present the on-chain value as usable balance. After
/// game:started / game:ended the FE should re-fetch / invalidate this value.
router.get("/balance", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!validateTicketScope(req, res)) return;
    const walletAddress = req.walletAddress!;
    const balance = await readMirrorTicketBalance(walletAddress);
    res.json({
      success: true,
      balance: String(balance),
      authority: "backend-mirror",
    });
  } catch (error) {
    console.error("❌ Ticket balance error:", error);
    res.status(500).json({ success: false, error: "Failed to load ticket balance." });
  }
});

/// GET /api/tickets/daily/status — schema per docs/fe05-daily-reward.md.
/// `/daily-status` is kept as a legacy alias of the same handler.
router.get(["/daily/status", "/daily-status"], requireAuth, async (req: Request, res: Response) => {
  try {
    if (!validateTicketScope(req, res)) return;
    const walletAddress = req.walletAddress!;
    const todayIndex = utcDayIndex(new Date());

    // Fail-closed like the FE: without a configured vault there is no
    // authoritative lastClaimDay, so no claimable status can be produced.
    if (!isTicketVaultConfigured()) {
      res.status(503).json({
        success: false,
        error: "Daily rewards are not available yet (TicketVault is not configured on the backend).",
      });
      return;
    }

    const { data: streakRow, error: streakError } = await supabase
      .from("daily_streaks")
      .select("streak_day, last_claim_day, total_claims")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (streakError) {
      throw streakError;
    }

    const prevStreakDay = streakRow?.streak_day ?? 0;

    // On-chain lastClaimDay is the source of guard truth for monotonicity;
    // the DB row only mirrors streak progression written by the listener.
    const [onchainLastClaimDay, balance] = await Promise.all([
      readLastClaimDay(walletAddress),
      readTicketBalance(walletAddress),
    ]);
    const prevClaimDayIndex = onchainLastClaimDay > 0 ? onchainLastClaimDay : null;
    const ticketBalance = balance.toString();

    const claimedToday = prevClaimDayIndex !== null && prevClaimDayIndex >= todayIndex;

    // FE semantics (buildRewardWeek): streakDay is the 1-7 punch-card slot of
    // *today's* claim — the slot still open when claimable, or the slot just
    // punched when already claimed. Clamped because the DB mirror can lag one
    // event behind the chain right after a claim.
    const streakDay = claimedToday
      ? Math.min(SEVEN_DAY_CYCLE, Math.max(1, prevStreakDay))
      : computeStreakDay(prevStreakDay, prevClaimDayIndex, todayIndex);

    res.json({
      success: true,
      status: {
        claimable: !claimedToday,
        streakDay,
        nextClaimAtMs: claimedToday ? (todayIndex + 1) * MS_PER_DAY : null,
        expectedTickets: expectedTicketsForStreakDay(streakDay),
      },
      meta: {
        walletAddress,
        lastClaimDay: prevClaimDayIndex,
        todayIndex,
        totalClaims: streakRow?.total_claims ?? 0,
        ticketBalance,
      },
    });
  } catch (error) {
    console.error("❌ Daily status error:", error);
    res.status(500).json({ success: false, error: "Failed to load daily claim status." });
  }
});

/// POST /api/tickets/daily/claim — schema per docs/fe05-daily-reward.md.
/// `/daily-claim` is kept as a legacy alias of the same handler.
router.post(["/daily/claim", "/daily-claim"], requireAuth, async (req: Request, res: Response) => {
  try {
    if (!validateTicketScope(req, res)) return;
    if (!isTicketVaultConfigured()) {
      res.status(503).json({
        success: false,
        error: "TICKET_VAULT_ADDRESS belum dikonfigurasi di backend env.",
      });
      return;
    }

    const walletAddress = req.walletAddress!;
    const todayIndex = utcDayIndex(new Date());

    const onchainLastClaimDay = await readLastClaimDay(walletAddress);
    if (onchainLastClaimDay >= todayIndex) {
      // "DayAlreadyClaimed" is deliberate: the FE error classifier matches it
      // to show the already-claimed recovery state and refresh the status.
      res.status(409).json({
        success: false,
        error: "DayAlreadyClaimed: daily reward for today has already been claimed.",
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
    //
    // `claim` + `signature` follow docs/fe05-daily-reward.md exactly; the
    // remaining fields are extras the FE parser ignores (the FE encodes
    // claimDaily locally from the reviewed ABI, so `transaction` is optional).
    res.json({
      success: true,
      claim: signed.claim,
      signature: signed.signature,
      expiresAt: signed.expiresAt,
      transaction,
      streakDay,
      amount,
    });
  } catch (error) {
    console.error("❌ Daily claim error:", error);
    res.status(500).json({ success: false, error: "Failed to issue daily claim signature." });
  }
});

export default router;

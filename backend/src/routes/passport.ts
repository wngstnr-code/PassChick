import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import {
  buildClaimEggPassTransaction,
  eggPassId,
  normalizePlayerAddress,
  readEggPass,
  signPassportClaim,
  TRUST_PASSPORT_ADDRESS,
  type EggPassClaim,
} from "../lib/celo.js";

const router = Router();

type PassportEligibility = {
  eligible: boolean;
  tier: number;
  reason: string;
  tierLabel: string;
  benefits: PassportBenefit[];
  accessFlags: PassportAccessFlags;
  tierReward: PassportTierReward | null;
  stats: {
    runsCompleted: number;
    bestHops: number;
    averageHops: number;
    successfulCashouts: number;
    consistencyScore: number;
    highestCheckpointCashedOut: number;
    checkpointCashouts: Record<string, number>;
  };
};

type PassportRequirement = {
  key: string;
  label: string;
  current: number;
  target: number;
  met: boolean;
};

type PassportProgression = {
  currentTier: number;
  currentTierLabel: string;
  nextTier: number | null;
  nextTierLabel: string | null;
  progressLabel: string;
  percentToNextTier: number;
  requirements: PassportRequirement[];
  currentTierReward: PassportTierReward | null;
  nextTierReward: PassportTierReward | null;
  stats: PassportEligibility["stats"];
};

type PassportBenefit = {
  key: string;
  label: string;
  description: string;
  category: "trust" | "access" | "reward";
  tierRequired: number;
  unlocked: boolean;
};

type TierAccessFlags = {
  canAccessTier1: boolean;
  canAccessTier2: boolean;
  canAccessTier3: boolean;
  canAccessTier4: boolean;
  partnerRewardAccess: boolean;
  allowlistAccess: boolean;
  premiumRewardAccess: boolean;
  oracleAccess: boolean;
};

type PassportAccessFlags = TierAccessFlags & {
  verifiedIdentity: boolean;
  allowlistEligible: boolean;
  tournamentAccess: boolean;
  partnerPerks: boolean;
  eligibleToClaim: boolean;
  hasValidPassport: boolean;
};

type PassportBenefitSummary = {
  current: string[];
  next: string[];
  accessFlags: {
    verifiedIdentity: boolean;
    allowlistEligible: boolean;
    tournamentAccess: boolean;
    partnerPerks: boolean;
  };
};

type PassportTierReward = {
  tier: number;
  label: string;
  checkpoint: number;
  requiredCashouts: number;
  unlocked: boolean;
  benefits: PassportBenefit[];
  accessFlags: TierAccessFlags;
};

type TierRule = {
  tier: number;
  label: string;
  checkpoint: number;
  requiredCashouts: number;
};

const CHECKPOINT_ROW_INTERVAL = 40;

const TIER_RULES: TierRule[] = [
  { tier: 1, label: "Runner", checkpoint: 2, requiredCashouts: 3 },
  { tier: 2, label: "Steady", checkpoint: 4, requiredCashouts: 4 },
  { tier: 3, label: "Elite", checkpoint: 6, requiredCashouts: 4 },
  { tier: 4, label: "Oracle", checkpoint: 8, requiredCashouts: 3 },
];

const TIER_LABELS = new Map<number, string>([
  [0, "Rookie"],
  ...TIER_RULES.map((rule) => [rule.tier, rule.label] as const),
]);

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTierAccessFlags(tier: number): TierAccessFlags {
  return {
    canAccessTier1: tier >= 1,
    canAccessTier2: tier >= 2,
    canAccessTier3: tier >= 3,
    canAccessTier4: tier >= 4,
    partnerRewardAccess: tier >= 1,
    allowlistAccess: tier >= 2,
    premiumRewardAccess: tier >= 3,
    oracleAccess: tier >= 4,
  };
}

function buildTierBenefits(tier: number, unlocked: boolean): PassportBenefit[] {
  switch (tier) {
    case 1:
      return [
        {
          key: "verified_runner_badge",
          label: "Runner badge",
          description:
            "Unlock the baseline on-chain trust badge for partner checks.",
          category: "trust",
          tierRequired: 1,
          unlocked,
        },
        {
          key: "partner_reward_entry",
          label: "Partner reward entry",
          description:
            "Eligible for base partner reward campaigns gated by EggPass.",
          category: "reward",
          tierRequired: 1,
          unlocked,
        },
      ];
    case 2:
      return [
        {
          key: "allowlist_gate",
          label: "Allowlist gate access",
          description:
            "Qualify for allowlist flows that require a stronger checkpoint history.",
          category: "access",
          tierRequired: 2,
          unlocked,
        },
        {
          key: "reward_weight_boost",
          label: "Reward weight boost",
          description: "Move into higher-priority partner reward buckets.",
          category: "reward",
          tierRequired: 2,
          unlocked,
        },
      ];
    case 3:
      return [
        {
          key: "premium_campaign_access",
          label: "Premium campaign access",
          description:
            "Unlock premium partner campaign filters that need deeper trust proof.",
          category: "access",
          tierRequired: 3,
          unlocked,
        },
        {
          key: "high_trust_signal",
          label: "High-trust signal",
          description:
            "Surface a stronger trust score for reward and access integrations.",
          category: "trust",
          tierRequired: 3,
          unlocked,
        },
      ];
    case 4:
      return [
        {
          key: "oracle_lane",
          label: "Oracle lane access",
          description:
            "Unlock the highest trust lane for curated partner access decisions.",
          category: "access",
          tierRequired: 4,
          unlocked,
        },
        {
          key: "top_tier_reward_pool",
          label: "Top-tier reward pool",
          description:
            "Qualify for the most selective EggPass reward pool integrations.",
          category: "reward",
          tierRequired: 4,
          unlocked,
        },
      ];
    default:
      return [];
  }
}

function buildBenefits(tier: number): PassportBenefit[] {
  if (tier <= 0) return [];

  return TIER_RULES.filter((rule) => rule.tier <= tier).flatMap((rule) =>
    buildTierBenefits(rule.tier, true),
  );
}

function buildBenefitSummary(
  currentTier: number,
  nextTier: number | null,
): PassportBenefitSummary {
  return {
    current: buildBenefits(currentTier).map((benefit) => benefit.label),
    next: nextTier
      ? buildTierBenefits(nextTier, false).map((benefit) => benefit.label)
      : [],
    accessFlags: {
      verifiedIdentity: currentTier >= 1,
      allowlistEligible: currentTier >= 2,
      tournamentAccess: currentTier >= 3,
      partnerPerks: currentTier >= 4,
    },
  };
}

function buildAccessFlags(
  tier: number,
  options: {
    eligibleToClaim: boolean;
    hasValidPassport: boolean;
  },
): PassportAccessFlags {
  return {
    ...buildTierAccessFlags(tier),
    verifiedIdentity: tier >= 1,
    allowlistEligible: tier >= 2,
    tournamentAccess: tier >= 3,
    partnerPerks: tier >= 4,
    eligibleToClaim: options.eligibleToClaim,
    hasValidPassport: options.hasValidPassport,
  };
}

function buildTierReward(
  rule: TierRule,
  unlockedTier: number,
): PassportTierReward {
  return {
    tier: rule.tier,
    label: rule.label,
    checkpoint: rule.checkpoint,
    requiredCashouts: rule.requiredCashouts,
    unlocked: unlockedTier >= rule.tier,
    benefits: buildTierBenefits(rule.tier, unlockedTier >= rule.tier),
    accessFlags: buildTierAccessFlags(rule.tier),
  };
}

function buildTierRewards(tier: number): PassportTierReward[] {
  return TIER_RULES.map((rule) => buildTierReward(rule, tier));
}

function findTierRule(tier: number) {
  return TIER_RULES.find((rule) => rule.tier === tier) ?? null;
}

function enrichEligibility(
  eligibility: Omit<
    PassportEligibility,
    "tierLabel" | "benefits" | "accessFlags" | "tierReward"
  >,
  options?: {
    hasValidPassport?: boolean;
  },
): PassportEligibility {
  const tierRule = findTierRule(eligibility.tier);

  return {
    ...eligibility,
    tierLabel: TIER_LABELS.get(eligibility.tier) ?? `Tier ${eligibility.tier}`,
    benefits: buildBenefits(eligibility.tier),
    accessFlags: buildAccessFlags(eligibility.tier, {
      eligibleToClaim: eligibility.eligible && eligibility.tier > 0,
      hasValidPassport: Boolean(options?.hasValidPassport),
    }),
    tierReward: tierRule ? buildTierReward(tierRule, eligibility.tier) : null,
  };
}

function countCheckpointCashouts(
  rows: Array<{ max_row_reached: unknown; status: unknown }>,
) {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    if (String(row.status ?? "") !== "CASHED_OUT") continue;

    const hops = toFiniteNumber(row.max_row_reached);
    const checkpoint = Math.floor(hops / CHECKPOINT_ROW_INTERVAL);
    if (checkpoint <= 0) continue;

    counts[String(checkpoint)] = (counts[String(checkpoint)] ?? 0) + 1;
  }

  return counts;
}

function countCashoutsAtOrAbove(
  checkpointCashouts: Record<string, number>,
  checkpoint: number,
) {
  return Object.entries(checkpointCashouts).reduce((sum, [cp, count]) => {
    return Number(cp) >= checkpoint ? sum + count : sum;
  }, 0);
}

function computeTierFromCheckpointCashouts(
  checkpointCashouts: Record<string, number>,
) {
  let tier = 0;

  for (const rule of TIER_RULES) {
    const qualifiedCashouts = countCashoutsAtOrAbove(
      checkpointCashouts,
      rule.checkpoint,
    );

    if (qualifiedCashouts >= rule.requiredCashouts) {
      tier = rule.tier;
    }
  }

  return tier;
}

function buildProgression(
  stats: PassportEligibility["stats"],
  currentTier: number,
): PassportProgression {
  const nextRule = TIER_RULES.find((rule) => rule.tier > currentTier) ?? null;
  const currentTierRule = findTierRule(currentTier);

  if (!nextRule) {
    return {
      currentTier,
      currentTierLabel: TIER_LABELS.get(currentTier) ?? `Tier ${currentTier}`,
      nextTier: null,
      nextTierLabel: null,
      progressLabel: "Top passport tier unlocked.",
      percentToNextTier: 100,
      requirements: [],
      currentTierReward: currentTierRule
        ? buildTierReward(currentTierRule, currentTier)
        : null,
      nextTierReward: null,
      stats,
    };
  }

  const qualifiedCashouts = countCashoutsAtOrAbove(
    stats.checkpointCashouts,
    nextRule.checkpoint,
  );
  const progressCurrent = Math.min(
    qualifiedCashouts,
    nextRule.requiredCashouts,
  );
  const percentToNextTier = Math.round(
    (progressCurrent / nextRule.requiredCashouts) * 100,
  );

  return {
    currentTier,
    currentTierLabel: TIER_LABELS.get(currentTier) ?? `Tier ${currentTier}`,
    nextTier: nextRule.tier,
    nextTierLabel: nextRule.label,
    progressLabel: `${progressCurrent}/${nextRule.requiredCashouts} cashouts at checkpoint ${nextRule.checkpoint}+ to unlock Tier ${nextRule.tier}.`,
    percentToNextTier,
    requirements: [
      {
        key: `cashout_cp_${nextRule.checkpoint}`,
        label: `Cash out at checkpoint ${nextRule.checkpoint}+ ${nextRule.requiredCashouts} times`,
        current: progressCurrent,
        target: nextRule.requiredCashouts,
        met: progressCurrent >= nextRule.requiredCashouts,
      },
    ],
    currentTierReward: currentTierRule
      ? buildTierReward(currentTierRule, currentTier)
      : null,
    nextTierReward: buildTierReward(nextRule, currentTier),
    stats,
  };
}

async function evaluateEligibility(
  walletAddress: string,
): Promise<PassportEligibility> {
  const { data, error } = await supabase
    .from("game_sessions")
    .select("max_row_reached, status")
    .eq("wallet_address", walletAddress)
    .in("status", ["CRASHED", "CASHED_OUT"])
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const runsCompleted = rows.length;
  const hops = rows.map((row) => toFiniteNumber(row.max_row_reached));
  const bestHops = hops.length ? Math.max(...hops) : 0;
  const averageHops =
    hops.length > 0
      ? hops.reduce((acc, value) => acc + value, 0) / hops.length
      : 0;
  const successfulCashouts = rows.filter(
    (row) => String(row.status ?? "") === "CASHED_OUT",
  ).length;
  const qualifiedRuns = hops.filter(
    (hop) => hop >= CHECKPOINT_ROW_INTERVAL,
  ).length;
  const consistencyScore =
    runsCompleted > 0 ? Math.round((qualifiedRuns / runsCompleted) * 100) : 0;
  const checkpointCashouts = countCheckpointCashouts(rows);
  const highestCheckpointCashedOut = Object.keys(checkpointCashouts).length
    ? Math.max(...Object.keys(checkpointCashouts).map((value) => Number(value)))
    : 0;
  const tier = computeTierFromCheckpointCashouts(checkpointCashouts);
  const stats = {
    runsCompleted,
    bestHops,
    averageHops,
    successfulCashouts,
    consistencyScore,
    highestCheckpointCashedOut,
    checkpointCashouts,
  };

  if (tier === 0) {
    const tierOneRule = TIER_RULES[0];
    const tierOneCashouts = countCashoutsAtOrAbove(
      checkpointCashouts,
      tierOneRule.checkpoint,
    );

    return enrichEligibility({
      eligible: false,
      tier: 0,
      reason: `Cash out at checkpoint ${tierOneRule.checkpoint}+ ${tierOneRule.requiredCashouts} times to unlock ${tierOneRule.label}. Current progress: ${tierOneCashouts}/${tierOneRule.requiredCashouts}.`,
      stats,
    });
  }

  return enrichEligibility({
    eligible: true,
    tier,
    reason: `Eligible to claim EggPass Tier ${tier}.`,
    stats,
  });
}

function isValidEvmWallet(value: string): boolean {
  try {
    normalizePlayerAddress(value);
    return true;
  } catch {
    return false;
  }
}

async function readPassportOnchain(walletAddress: string) {
  if (!env.TRUST_PASSPORT_ADDRESS || !isValidEvmWallet(walletAddress)) {
    return {
      configured: false,
      valid: false,
      tier: 0,
      issuedAt: 0,
      expiry: 0,
      revoked: false,
    };
  }

  try {
    const eggPass = await readEggPass(walletAddress);

    if (!eggPass) {
      return {
        configured: true,
        valid: false,
        tier: 0,
        issuedAt: 0,
        expiry: 0,
        revoked: false,
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const valid = !eggPass.revoked && eggPass.expiry > now && eggPass.tier > 0;

    return {
      configured: true,
      valid,
      tier: eggPass.tier,
      issuedAt: eggPass.issuedAt,
      expiry: eggPass.expiry,
      revoked: eggPass.revoked,
    };
  } catch (error) {
    console.error("❌ Failed to read EggPass on-chain:", error);
    return {
      configured: true,
      valid: false,
      tier: 0,
      issuedAt: 0,
      expiry: 0,
      revoked: false,
    };
  }
}

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const walletAddress = req.walletAddress!;
    const [eligibility, passport] = await Promise.all([
      evaluateEligibility(walletAddress),
      readPassportOnchain(walletAddress),
    ]);
    const passportId = isValidEvmWallet(walletAddress)
      ? eggPassId(walletAddress)
      : null;
    const effectiveTier = passport.valid
      ? Math.max(Number(passport.tier ?? 0), eligibility.tier)
      : eligibility.tier;
    const progression = buildProgression(eligibility.stats, effectiveTier);
    const activeTierRule = findTierRule(effectiveTier);
    const accessFlags = buildAccessFlags(effectiveTier, {
      eligibleToClaim: eligibility.eligible && eligibility.tier > 0,
      hasValidPassport: passport.valid,
    });
    const benefits = buildBenefitSummary(effectiveTier, progression.nextTier);
    const decoratedEligibility = enrichEligibility(eligibility, {
      hasValidPassport: passport.valid,
    });

    res.json({
      walletAddress,
      passportId,
      eligibility: decoratedEligibility,
      passport,
      progression,
      benefits,
      benefitDetails: buildBenefits(effectiveTier),
      accessFlags,
      activeTierReward: activeTierRule
        ? buildTierReward(activeTierRule, effectiveTier)
        : null,
      tierRewards: buildTierRewards(effectiveTier),
    });
  } catch (error) {
    console.error("❌ Passport status error:", error);
    res.status(500).json({ error: "Failed to load passport status." });
  }
});

router.post(
  "/issue-signature",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const walletAddress = req.walletAddress!;

      if (!env.TRUST_PASSPORT_ADDRESS) {
        res.status(400).json({
          error: "TRUST_PASSPORT_ADDRESS belum dikonfigurasi di backend env.",
        });
        return;
      }
      if (!isValidEvmWallet(walletAddress)) {
        res.status(400).json({ error: "Invalid EVM wallet address." });
        return;
      }

      const eligibility = await evaluateEligibility(walletAddress);
      if (!eligibility.eligible || eligibility.tier <= 0) {
        res.status(400).json({
          error: eligibility.reason,
          eligibility,
        });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const passportExpiry = now + env.PASSPORT_VALIDITY_SECONDS;
      const signatureExpiry = now + env.PASSPORT_SIGNATURE_TTL_SECONDS;

      const stats = eligibility.stats.checkpointCashouts;
      const cp2 = countCashoutsAtOrAbove(stats, 2);
      const cp4 = countCashoutsAtOrAbove(stats, 4);
      const cp6 = countCashoutsAtOrAbove(stats, 6);
      const cp8 = countCashoutsAtOrAbove(stats, 8);

      const claim: EggPassClaim = {
        tier: eligibility.tier,
        highestCheckpoint: eligibility.stats.highestCheckpointCashedOut,
        cp2Cashouts: Math.min(65535, cp2),
        cp4Cashouts: Math.min(65535, cp4),
        cp6Cashouts: Math.min(65535, cp6),
        cp8Cashouts: Math.min(65535, cp8),
        reputationScore: Math.max(
          1,
          Math.min(
            65535,
            eligibility.stats.successfulCashouts * 100 +
              eligibility.stats.consistencyScore,
          ),
        ),
        issuedAt: BigInt(now),
        expiry: BigInt(passportExpiry),
        nonce: randomBytes(32),
      };

      const signature = await signPassportClaim(walletAddress, claim);
      const unsignedTx = await buildClaimEggPassTransaction(
        walletAddress,
        claim,
      );

      res.json({
        success: true,
        unsignedTx,
        claim: {
          player: walletAddress,
          tier: claim.tier,
          highestCheckpoint: claim.highestCheckpoint,
          cp2Cashouts: claim.cp2Cashouts,
          cp4Cashouts: claim.cp4Cashouts,
          cp6Cashouts: claim.cp6Cashouts,
          cp8Cashouts: claim.cp8Cashouts,
          reputationScore: claim.reputationScore,
          issuedAt: claim.issuedAt.toString(),
          expiry: claim.expiry.toString(),
          nonce: claim.nonce.toString("hex"),
        },
        signature,
        signingDomain: {
          chainId: env.CHAIN_ID,
          contract: TRUST_PASSPORT_ADDRESS,
        },
        signatureExpiry,
        eligibility,
      });
    } catch (error) {
      console.error("❌ Passport claim issue error:", error);
      res.status(500).json({ error: "Failed to issue passport claim." });
    }
  },
);

export default router;

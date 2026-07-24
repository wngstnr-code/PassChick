export type SeasonRewardState =
  | "CLAIMABLE"
  | "CLAIMED"
  | "INELIGIBLE"
  | "PENDING"
  | "EXPIRED";

export type SeasonRewardItem = {
  id: string;
  title: string;
  kind: "badge" | "title" | "monetary";
  description: string;
  state: SeasonRewardState;
  icon: string;
  badgeLabel: string;
};

export function classifySeasonReward(input: {
  rewardKind: "founder-badge" | "career-title" | "monetary-pool";
  claimedIds?: string[];
  userRank?: number | null;
  seasonStatus?: string;
}): SeasonRewardItem {
  const claimedSet = new Set(input.claimedIds || []);

  if (input.rewardKind === "founder-badge") {
    const isClaimed = claimedSet.has("founder-badge");
    return {
      id: "founder-badge",
      title: "SEASON 1 FOUNDER BADGE",
      kind: "badge",
      description: "Exclusive badge for early Season 1 PassChick players.",
      state: isClaimed ? "CLAIMED" : "CLAIMABLE",
      icon: "★",
      badgeLabel: isClaimed ? "CLAIMED" : "NON-MONETARY PERK",
    };
  }

  if (input.rewardKind === "career-title") {
    const isClaimed = claimedSet.has("career-title");
    const isTopPlayer = typeof input.userRank === "number" && input.userRank > 0 && input.userRank <= 100;
    if (isClaimed) {
      return {
        id: "career-title",
        title: "DIVISION HONOR TITLE",
        kind: "title",
        description: "Honorary title recognized across leaderboards.",
        state: "CLAIMED",
        icon: "🏆",
        badgeLabel: "CLAIMED",
      };
    }

    return {
      id: "career-title",
      title: "DIVISION HONOR TITLE",
      kind: "title",
      description: "Honorary title awarded to Top 100 division players.",
      state: isTopPlayer ? "CLAIMABLE" : "INELIGIBLE",
      icon: "🏆",
      badgeLabel: isTopPlayer ? "TOP 100 QUALIFIED" : "REQUIRES TOP 100",
    };
  }

  return {
    id: "monetary-pool",
    title: "MAINNET MONETARY POOL",
    kind: "monetary",
    description: "Requires Verified-Human Celo Passport status & live Mainnet contract funding.",
    state: "PENDING",
    icon: "💎",
    badgeLabel: "UNLOCKS SEASON 2",
  };
}

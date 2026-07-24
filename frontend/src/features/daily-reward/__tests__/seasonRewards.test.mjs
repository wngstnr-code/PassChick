import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * @typedef {"CLAIMABLE" | "CLAIMED" | "INELIGIBLE" | "PENDING" | "EXPIRED"} SeasonRewardState
 * @typedef {{
 *   id: string;
 *   title: string;
 *   kind: "badge" | "title" | "monetary";
 *   description: string;
 *   state: SeasonRewardState;
 *   icon: string;
 *   badgeLabel: string;
 * }} SeasonRewardItem
 */

export function classifySeasonReward(input) {
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

describe("FE-10 Season Rewards classification", () => {
  it("classifies Season 1 Founder Badge as CLAIMABLE when unclaimed", () => {
    const reward = classifySeasonReward({ rewardKind: "founder-badge" });
    assert.equal(reward.state, "CLAIMABLE");
    assert.equal(reward.title, "SEASON 1 FOUNDER BADGE");
  });

  it("classifies Season 1 Founder Badge as CLAIMED when in claimed list", () => {
    const reward = classifySeasonReward({
      rewardKind: "founder-badge",
      claimedIds: ["founder-badge"],
    });
    assert.equal(reward.state, "CLAIMED");
  });

  it("classifies Division Honor Title based on player rank qualification", () => {
    const qualified = classifySeasonReward({
      rewardKind: "career-title",
      userRank: 15,
    });
    assert.equal(qualified.state, "CLAIMABLE");

    const unqualified = classifySeasonReward({
      rewardKind: "career-title",
      userRank: null,
    });
    assert.equal(unqualified.state, "INELIGIBLE");
  });

  it("marks monetary pool clearly as PENDING for Season 2 without misleading claims", () => {
    const reward = classifySeasonReward({ rewardKind: "monetary-pool" });
    assert.equal(reward.state, "PENDING");
    assert.equal(reward.badgeLabel, "UNLOCKS SEASON 2");
  });
});

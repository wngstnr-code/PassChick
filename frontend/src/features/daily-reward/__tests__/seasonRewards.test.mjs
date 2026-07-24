import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySeasonReward } from "../seasonRewards.ts";

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

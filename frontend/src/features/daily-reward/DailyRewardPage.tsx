"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "~/features/wallet/WalletProvider";
import { useDailyClaimStatusQuery, useTicketBalanceQuery } from "../tickets/hooks.ts";
import { buildRewardWeek, classifyDailyClaimError, formatClaimCountdown } from "./domain.ts";
import { dailyRewardTicketAdapter } from "./runtimeAdapter.ts";
import { useDailyRewardClaim } from "./useDailyRewardClaim";
import { classifySeasonReward } from "./seasonRewards.ts";
import styles from "./DailyRewardPage.module.css";

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "NOT CONNECTED";
}

function readQueryError(error: unknown) {
  return error instanceof Error ? error.message : "Reward service is unavailable.";
}

export function DailyRewardPage() {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [claimedSeasonRewards, setClaimedSeasonRewards] = useState<string[]>([]);
  const { account, isAppChain, isConnecting, connectWallet } = useWallet();
  const statusQuery = useDailyClaimStatusQuery(dailyRewardTicketAdapter);
  const balanceQuery = useTicketBalanceQuery(dailyRewardTicketAdapter);
  const claim = useDailyRewardClaim();
  const status = statusQuery.data;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const week = useMemo(
    () => buildRewardWeek({ streakDay: status?.streakDay ?? 1, claimable: status?.claimable ?? true }),
    [status?.claimable, status?.streakDay],
  );
  const current = week.find((day) => day.state === "current") ?? week[0];
  const countdown = formatClaimCountdown(status?.nextClaimAtMs ?? null, nowMs);
  const claimError = claim.error ? classifyDailyClaimError(claim.error) : null;
  const canClaim = Boolean(account && isAppChain && status?.claimable && !claim.isPending);
  const passportLabel =
    !status
      ? "WAITING"
      : status.passportPerkApplied === true
      ? `ACTIVE +${status.passportBonusTickets ?? 0n}`
      : status.passportPerkApplied === false
        ? "NO BONUS"
        : "CHECKED AT CLAIM";
  const rewardTitle = !status
    ? statusQuery.isError ? "REWARD UNAVAILABLE" : "CHECKING REWARD"
    : current.rewardKind === "mystery"
      ? "MYSTERY BOX"
      : `${current.baseTickets} TICKETS`;
  const rewardDescription = !status
    ? statusQuery.isError
      ? "No claim can be created until the reward desk responds."
      : "Waiting for your wallet-bound reward status."
    : current.rewardKind === "mystery"
      ? "Open it to reveal 1–10 tickets."
      : "Your streak reward is ready for pickup.";
  const buttonLabel = claim.isPending
    ? "CONFIRMING REWARD…"
    : statusQuery.isLoading
      ? "CHECKING REWARD…"
      : statusQuery.isError
        ? "REWARD UNAVAILABLE"
        : status?.claimable
          ? "CLAIM DAILY TICKETS"
          : "COME BACK TOMORROW";

  return (
    <main className={styles.page}>
      <div className={styles.skyGrid} aria-hidden="true" />
      <header className={styles.header}>
        <Link className={styles.back} href="/" aria-label="Back to home">
          ◀ BACK
        </Link>
        <div className={styles.wallet}>
          <span className={styles.dot} />
          {shortAddress(account)}
        </div>
      </header>

      <section className={styles.shell} aria-labelledby="daily-reward-title">
        <div className={styles.eyebrow}>PASSCHICK PLAYER PERK</div>
        <h1 id="daily-reward-title">DAILY<br />PUNCH CARD</h1>
        <p className={styles.intro}>Check in every day. Miss a day and your card restarts at Day 1.</p>

        <div className={styles.balanceBar}>
          <span>TICKET WALLET</span>
          <strong>{balanceQuery.isLoading ? "…" : (balanceQuery.data?.available ?? 0n).toString()}</strong>
        </div>

        <ol className={styles.week} aria-label="Seven-day reward streak">
          {week.map((reward) => (
            <li className={`${styles.day} ${styles[status ? reward.state : "locked"]}`} key={reward.day}>
              <span className={styles.dayLabel}>D{reward.day}</span>
              <span className={styles.rewardValue} aria-label={reward.rewardKind === "mystery" ? "Mystery reward" : `${reward.baseTickets} tickets`}>
                {reward.rewardKind === "mystery" ? "?" : reward.baseTickets?.toString()}
              </span>
              <span className={styles.ticketMark}>{reward.state === "claimed" ? "✓" : "TIX"}</span>
            </li>
          ))}
        </ol>

        <section className={styles.claimPanel} aria-live="polite">
          <div className={styles.claimCopy}>
            <span className={styles.panelLabel}>TODAY · DAY {current.day}</span>
            <h2>{rewardTitle}</h2>
            <p>{rewardDescription}</p>
          </div>
          <div className={styles.crate} aria-hidden="true">{!status ? "…" : current.rewardKind === "mystery" ? "?" : "★"}</div>
        </section>

        <div className={styles.statusGrid}>
          <div>
            <span>NEXT DROP</span>
            <strong>{!status ? statusQuery.isError ? "OFFLINE" : "CHECKING" : status.claimable ? "READY" : countdown}</strong>
          </div>
          <div>
            <span>PASSPORT PERK</span>
            <strong>{passportLabel}</strong>
          </div>
        </div>

        {!account ? (
          <button className={styles.claimButton} type="button" onClick={() => void connectWallet()} disabled={isConnecting}>
            {isConnecting ? "CONNECTING…" : "CONNECT WALLET"}
          </button>
        ) : (
          <button className={styles.claimButton} type="button" onClick={() => claim.mutate()} disabled={!canClaim}>
            {buttonLabel}
          </button>
        )}
        <p className={styles.feeNote}>One wallet confirmation · Network fee paid with a supported stablecoin</p>

        {!isAppChain && account ? <div className={styles.notice}>Switch to the supported Celo network to claim.</div> : null}
        {statusQuery.isError ? (
          <div className={styles.notice}>
            <strong>REWARD DESK OFFLINE</strong>
            <span>{readQueryError(statusQuery.error)}</span>
            <button type="button" onClick={() => void statusQuery.refetch()}>TRY AGAIN</button>
          </div>
        ) : null}
        {claimError ? <div className={styles.notice}>{claimError.message}</div> : null}
        {claim.isSuccess ? (
          <div className={styles.success}>+{claim.data.amount} TICKETS PUNCHED · BALANCE REFRESHED</div>
        ) : null}

        <div className={styles.seasonRewardsSection}>
          <div className={styles.seasonRewardsHead}>
            <h3>SEASON 1 PERKS & REWARDS</h3>
            <p>Active non-monetary perks & career titles. Monetary pools unlock in Season 2 with Celo Passport verification.</p>
          </div>

          <div className={styles.seasonRewardsGrid}>
            {[
              classifySeasonReward({ rewardKind: "founder-badge", claimedIds: claimedSeasonRewards }),
              classifySeasonReward({ rewardKind: "career-title", claimedIds: claimedSeasonRewards }),
              classifySeasonReward({ rewardKind: "monetary-pool" }),
            ].map((item) => (
              <div key={item.id} className={`${styles.seasonRewardCard} ${styles[`state${item.state}`]}`}>
                <div className={styles.seasonRewardIcon}>{item.icon}</div>
                <div className={styles.seasonRewardInfo}>
                  <div className={styles.seasonRewardHeader}>
                    <h4>{item.title}</h4>
                    <span className={`${styles.stateBadge} ${styles[`badge${item.state}`]}`}>{item.badgeLabel}</span>
                  </div>
                  <p>{item.description}</p>
                </div>
                {item.state === "CLAIMABLE" ? (
                  <button
                    type="button"
                    className={styles.seasonClaimBtn}
                    onClick={() => setClaimedSeasonRewards((prev) => [...prev, item.id])}
                  >
                    CLAIM
                  </button>
                ) : item.state === "CLAIMED" ? (
                  <span className={styles.claimedCheck}>✓ CLAIMED</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo } from "react";
import type { DepositFlowViewModel } from "./types";
import { useDepositFlow } from "./useDepositFlow";

type QuickAmountPreset = {
  label: string;
  value: string;
};

type ActivityItem = {
  label: string;
  hash: string;
  url: string;
};

function readQuickAmount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed.toString();
}

function shortHash(hash: string) {
  if (!hash) return "";
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function readWalletStatus(flow: DepositFlowViewModel) {
  if (!flow.isConnected) return "Not Connected";
  if (flow.isMiniPay) return "MiniPay (Celo Only)";
  if (!flow.isCeloChain) return "Wrong Network";
  return "Connected (Celo)";
}

function readPrimaryLabel(flow: DepositFlowViewModel) {
  if (flow.isDepositBusy) return "PROCESSING...";
  if (flow.isApproveBusy) return "APPROVING...";
  if (flow.needsApproval) return "APPROVE & DEPOSIT";
  return "DEPOSIT TO VAULT";
}

export function ManageMoneyPage() {
  const flow = useDepositFlow();

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlTouchAction = html.style.touchAction;
    const previousBodyTouchAction = body.style.touchAction;

    // The game shell disables touch gestures globally, so re-enable vertical scrolling here.
    html.style.touchAction = "pan-y";
    body.style.touchAction = "pan-y";

    return () => {
      html.style.touchAction = previousHtmlTouchAction;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, []);

  const returnHref = "/";
  const returnLabel = "HOME";
  const walletPreset = readQuickAmount(flow.walletBalanceDisplay);
  const vaultPreset = readQuickAmount(flow.availableBalanceDisplay);
  const hasFaucet = Boolean(flow.faucetAddress);

  const quickAmounts = useMemo<QuickAmountPreset[]>(() => {
    const presets: QuickAmountPreset[] = [
      { label: "10 USDC", value: "10" },
      { label: "25 USDC", value: "25" },
      { label: "50 USDC", value: "50" },
      { label: "100 USDC", value: "100" },
    ];

    if (walletPreset) {
      presets.push({ label: "WALLET MAX", value: walletPreset });
    }

    if (vaultPreset) {
      presets.push({ label: "VAULT MAX", value: vaultPreset });
    }

    return presets;
  }, [vaultPreset, walletPreset]);

  const activityItems = useMemo<ActivityItem[]>(
    () =>
      [
        {
          label: "Latest Faucet",
          hash: flow.faucetTxHash,
          url: flow.faucetTxUrl,
        },
        {
          label: "Latest Approve",
          hash: flow.approveTxHash,
          url: flow.approveTxUrl,
        },
        {
          label: "Latest Deposit",
          hash: flow.depositTxHash,
          url: flow.depositTxUrl,
        },
        {
          label: "Latest Withdraw",
          hash: flow.withdrawTxHash,
          url: flow.withdrawTxUrl,
        },
      ].filter((item) => item.hash && (item.label !== "Latest Faucet" || hasFaucet)),
    [
      flow.approveTxHash,
      flow.approveTxUrl,
      flow.depositTxHash,
      flow.depositTxUrl,
      flow.faucetTxHash,
      flow.faucetTxUrl,
      flow.withdrawTxHash,
      flow.withdrawTxUrl,
      hasFaucet,
    ],
  );

  async function handleDepositClick() {
    try {
      await flow.onDeposit();
    } catch {
      // Error sudah ditangani oleh flow.
    }
  }

  async function handleWithdrawClick() {
    try {
      await flow.onWithdraw();
    } catch {
      // Error sudah ditangani oleh flow.
    }
  }

  async function handleFaucetClick() {
    try {
      await flow.onClaimFaucet();
    } catch {
      // Error sudah ditangani oleh flow.
    }
  }

  return (
    <main className="flow-page money-page">
      <div className="money-bg" aria-hidden="true">
        <iframe
          className="money-bg-frame"
          src="/play?bg=1"
          title="In-game background"
          tabIndex={-1}
        />
      </div>
      <div className="money-overlay" aria-hidden="true" />

      <section className="flow-card money-card">
        <header className="money-header">
          <div className="money-head-top">
            <p className="flow-eyebrow">CHICKEN VAULT</p>
            <div className="money-head-badges">
              {hasFaucet ? (
                <span className="money-head-badge">
                  FAUCET {flow.faucetClaimAmountDisplay} USDC
                </span>
              ) : null}
              <span
                className={`money-head-badge ${
                  flow.needsApproval
                    ? "money-head-badge-warning"
                    : "money-head-badge-ready"
                }`}
              >
                {flow.needsApproval ? "APPROVAL NEEDED" : "VAULT READY"}
              </span>
            </div>
          </div>
          <h1 className="flow-title money-title">MANAGE MONEY</h1>
          <p className="money-subtitle">
            Deposit to vault, then withdraw only from your available balance.
          </p>
        </header>

        <div className="money-grid">
          <section className="flow-status money-status-panel">
            <p className="money-section-label">VAULT SNAPSHOT</p>
            <div className="money-status-grid">
              <div className="money-status-row">
                <span>Wallet Status</span>
                <strong>{readWalletStatus(flow)}</strong>
              </div>
              <div className="money-status-row">
                <span>Wallet Balance</span>
                <strong>{flow.walletBalanceDisplay} USDC</strong>
              </div>
              <div className="money-status-row">
                <span>Vault Available</span>
                <strong>{flow.availableBalanceDisplay} USDC</strong>
              </div>
              <div className="money-status-row">
                <span>Vault Locked</span>
                <strong>{flow.lockedBalanceDisplay} USDC</strong>
              </div>
              <div className="money-status-row">
                <span>Approval State</span>
                <strong>{flow.needsApproval ? "Approval Needed" : "Ready"}</strong>
              </div>
            </div>
          </section>

          <section className="money-action-panel">
            <p className="money-section-label">ACTIONS</p>
            <p className="money-helper">
              Deposit adds to available vault balance. Withdraw only uses
              available balance, not locked stake.
            </p>

            <div className="money-message-stack">
              {flow.configMessage ? (
                <p className="flow-alert">{flow.configMessage}</p>
              ) : null}
              {flow.statusMessage ? (
                <p className="flow-success">{flow.statusMessage}</p>
              ) : null}
              {flow.errorMessage ? (
                <p className="flow-alert">{flow.errorMessage}</p>
              ) : null}
            </div>

            <div className="money-amount-block">
              <label className="flow-label" htmlFor="money-amount-ui">
                AMOUNT (USDC)
              </label>
              <input
                id="money-amount-ui"
                className="flow-input money-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={flow.amount}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  flow.setAmount(event.target.value)
                }
              />

              <div className="money-quick-picks">
                {quickAmounts.map((preset) => (
                  <button
                    key={`${preset.label}-${preset.value}`}
                    type="button"
                    className="money-quick-pick"
                    onClick={() => flow.setAmount(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="flow-btn money-primary-btn"
              type="button"
              disabled={flow.disableDepositButton}
              onClick={handleDepositClick}
            >
              {readPrimaryLabel(flow)}
            </button>

            <div className="money-secondary-actions">
              {hasFaucet ? (
                <button
                  className="flow-btn money-secondary-btn money-faucet-btn"
                  type="button"
                  disabled={flow.disableFaucetButton}
                  onClick={handleFaucetClick}
                >
                  {flow.isFaucetBusy ? "MINTING..." : "MINT FAUCET"}
                </button>
              ) : null}
              <button
                className="flow-btn money-secondary-btn money-withdraw-btn"
                type="button"
                disabled={flow.disableWithdrawButton}
                onClick={handleWithdrawClick}
              >
                {flow.isWithdrawBusy ? "WITHDRAWING..." : "WITHDRAW"}
              </button>
            </div>

            <div className="money-panel-footer">
              <div className="money-footer-actions">
                <a
                  href={returnHref}
                  className="flow-btn money-nav-home-btn money-panel-nav-btn"
                >
                  {returnLabel}
                </a>
                <a
                  href="/play"
                  className="flow-btn money-nav-play-btn money-panel-nav-btn"
                >
                  PLAY GAME
                </a>
              </div>
            </div>
          </section>
        </div>

        {activityItems.length ? (
          <section className="money-activity">
            <p className="flow-eyebrow money-activity-eyebrow">RECENT ACTIVITY</p>
            <div className="money-activity-list">
              {activityItems.map((item) => (
                <div key={item.label} className="money-activity-item">
                  <span>{item.label}</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {shortHash(item.hash)}
                    </a>
                  ) : (
                    <span className="mono">{shortHash(item.hash)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}

      </section>
    </main>
  );
}

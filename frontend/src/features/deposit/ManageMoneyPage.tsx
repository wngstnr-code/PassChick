"use client";

import Link from "next/link";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readMiniPayDepositLinkProps } from "~/lib/minipay/addCash";
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

type MoneyActionMode = "deposit" | "withdraw";

type ManageMoneyVaultCardProps = {
  className?: string;
  onClose?: () => void;
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
  if (!flow.isAppChain) return "RPC Missing";
  return "Connected";
}

function readWalletStatusTone(flow: DepositFlowViewModel) {
  if (!flow.isConnected) return "warning";
  if (!flow.isAppChain) return "warning";
  return "ready";
}

function readPrimaryLabel(flow: DepositFlowViewModel) {
  if (flow.isDepositBusy) return "PROCESSING…";
  if (flow.isApproveBusy) return "APPROVING…";
  return "DEPOSIT";
}

export function ManageMoneyVaultCard({
  className = "",
  onClose,
}: ManageMoneyVaultCardProps) {
  const flow = useDepositFlow();
  const [moneyAction, setMoneyAction] = useState<MoneyActionMode>("deposit");
  const depositFallbackRef = useRef<HTMLAnchorElement>(null);

  const returnHref = "/";
  const returnLabel = "HOME";
  const walletPreset = readQuickAmount(flow.walletBalanceDisplay);
  const vaultPreset = readQuickAmount(flow.availableBalanceDisplay);

  const quickAmounts = useMemo<QuickAmountPreset[]>(() => {
    const presets: QuickAmountPreset[] = [
      { label: "0.0001", value: "0.0001" },
      { label: "0.0005", value: "0.0005" },
      { label: "0.0010", value: "0.0010" },
      { label: "0.0025", value: "0.0025" },
      { label: "0.0050", value: "0.0050" },
      { label: "0.0100", value: "0.0100" },
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
          label: "Latest Token Approval",
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
      ].filter((item) => item.hash),
    [
      flow.approveTxHash,
      flow.approveTxUrl,
      flow.depositTxHash,
      flow.depositTxUrl,
      flow.withdrawTxHash,
      flow.withdrawTxUrl,
    ],
  );

  async function handleDepositClick() {
    try {
      await flow.onDeposit();
    } catch (error) {
      console.warn("Caught error in ManageMoneyPage:", error);
    }
  }

  async function handleWithdrawClick() {
    try {
      await flow.onWithdraw();
    } catch (error) {
      console.warn("Caught error in ManageMoneyPage:", error);
    }
  }

  async function handlePrimaryActionClick() {
    if (moneyAction === "withdraw") {
      await handleWithdrawClick();
      return;
    }

    if (flow.hasInsufficientWalletBalance) {
      if (flow.isMiniPay) {
        window.location.assign(flow.addCashUrl);
      } else {
        depositFallbackRef.current?.focus();
      }
      return;
    }

    await handleDepositClick();
  }

  const moneyActionTabs: Array<{ mode: MoneyActionMode; label: string }> = [
    { mode: "deposit", label: "DEPOSIT" },
    { mode: "withdraw", label: "WITHDRAW" },
  ];

  const activeActionLabel =
    moneyAction === "withdraw"
      ? flow.isWithdrawBusy
        ? "WITHDRAWING…"
        : "WITHDRAW"
      : flow.hasInsufficientWalletBalance
        ? flow.isMiniPay
          ? "DEPOSIT IN MINIPAY"
          : "VIEW DEPOSIT OPTIONS"
      : readPrimaryLabel(flow);

  const activeActionDisabled =
    moneyAction === "withdraw"
      ? flow.disableWithdrawButton
      : flow.disableDepositButton;
  const activeActionHint =
    moneyAction === "withdraw"
      ? "Move available vault balance back to your wallet."
      : "Move wallet USDC into your playable vault balance.";
  const walletStatus = readWalletStatus(flow);
  const walletStatusTone = readWalletStatusTone(flow);
  const depositLinkProps = readMiniPayDepositLinkProps(flow.isMiniPay);

  function onMoneyTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = moneyActionTabs.findIndex(
      (tab) => tab.mode === moneyAction,
    );
    const lastIndex = moneyActionTabs.length - 1;
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowLeft") {
      nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    } else {
      return;
    }

    event.preventDefault();
    setMoneyAction(moneyActionTabs[nextIndex].mode);
    const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    );
    tabButtons?.[nextIndex]?.focus();
  }

  return (
    <section className={["flow-card money-card", className].filter(Boolean).join(" ")}>
      {onClose ? (
        <button
          className="close-btn money-card-close"
          type="button"
          aria-label="Close manage money"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <header className="money-header">
        <div className="money-head-top">
          <p className="flow-eyebrow">PASSCHICK VAULT</p>
          <div className="money-head-badges" aria-label="Vault status">
            <span className={`money-head-badge money-head-badge-${walletStatusTone}`}>
              {walletStatus}
            </span>
            <span className="money-head-badge">USDC</span>
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
                <strong>{walletStatus}</strong>
              </div>
              <div className="money-status-row">
                <span>Wallet Balance</span>
                <strong>{flow.walletBalanceDisplay === "-" ? "-" : `$${flow.walletBalanceDisplay}`}</strong>
              </div>
              <div className="money-status-row">
                <span>Vault Available</span>
                <strong>{flow.availableBalanceDisplay === "-" ? "-" : `$${flow.availableBalanceDisplay}`}</strong>
              </div>
              <div className="money-status-row">
                <span>Vault Locked</span>
                <strong>{flow.lockedBalanceDisplay === "-" ? "-" : `$${flow.lockedBalanceDisplay}`}</strong>
              </div>
            </div>
          </section>

          <section className="money-action-panel">
            <div className="money-action-tabs" role="tablist" aria-label="Vault actions">
              {moneyActionTabs.map((tab) => (
                <button
                  key={tab.mode}
                  id={`money-action-${tab.mode}`}
                  type="button"
                  role="tab"
                  aria-selected={moneyAction === tab.mode}
                  aria-controls="money-action-panel"
                  tabIndex={moneyAction === tab.mode ? 0 : -1}
                  className={`money-action-tab${
                    moneyAction === tab.mode ? " active" : ""
                  }`}
                  onClick={() => setMoneyAction(tab.mode)}
                  onKeyDown={onMoneyTabKeyDown}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              id="money-action-panel"
              className="money-action-content"
              role="tabpanel"
              aria-labelledby={`money-action-${moneyAction}`}
            >
            <div className="money-message-stack">
              <p id="money-action-hint" className="money-action-hint">
                {activeActionHint}
              </p>
              {flow.configMessage ? (
                <p id="money-config-message" className="flow-alert" role="status">
                  {flow.configMessage}
                </p>
              ) : null}
              {flow.statusMessage ? (
                <p className="flow-success" role="status" aria-live="polite">
                  {flow.statusMessage}
                </p>
              ) : null}
              {flow.errorMessage ? (
                <p className="flow-alert" role="alert">
                  {flow.errorMessage}
                </p>
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
                step="0.0001"
                inputMode="decimal"
                name="amount"
                autoComplete="off"
                placeholder="e.g. 0.0001…"
                aria-describedby="money-action-hint"
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
                    className={`money-quick-pick${
                      preset.label.includes("MAX") ? " money-quick-pick-max" : ""
                    }`}
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
              disabled={activeActionDisabled}
              onClick={handlePrimaryActionClick}
            >
              {activeActionLabel}
            </button>

            {moneyAction === "deposit" && flow.hasInsufficientWalletBalance ? (
              <aside className="money-add-cash" aria-labelledby="money-add-cash-title">
                <strong id="money-add-cash-title">Need more USDC?</strong>
                <p>
                  {flow.isMiniPay
                    ? "Deposit USDC, USDT, or USDm (cUSD) with MiniPay, then return here and retry."
                    : "This browser is outside MiniPay. Open the official Deposit flow; if MiniPay is unavailable, fund this wallet through your usual provider and retry."}
                </p>
                <a
                  ref={depositFallbackRef}
                  className="flow-btn money-add-cash-link"
                  href={flow.addCashUrl}
                  {...depositLinkProps}
                >
                  DEPOSIT IN MINIPAY
                </a>
              </aside>
            ) : null}

            {!onClose ? (
              <div className="money-panel-footer">
                <div className="money-footer-actions">
                  <Link
                    href={returnHref}
                    className="flow-btn money-nav-home-btn money-panel-nav-btn"
                  >
                    {returnLabel}
                  </Link>
                  <Link
                    href="/play"
                    className="flow-btn money-nav-play-btn money-panel-nav-btn"
                  >
                    PLAY GAME
                  </Link>
                </div>
              </div>
            ) : null}
            </div>
          </section>
        </div>

        <section className="money-activity">
          <p className="flow-eyebrow money-activity-eyebrow">RECENT ACTIVITY</p>
          {activityItems.length ? (
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
          ) : (
            <p className="money-activity-empty">No vault activity yet.</p>
          )}
        </section>
    </section>
  );
}

export function ManageMoneyPage() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlTouchAction = html.style.touchAction;
    const previousBodyTouchAction = body.style.touchAction;
    const previousHtmlOverflowX = html.style.overflowX;
    const previousHtmlOverflowY = html.style.overflowY;
    const previousBodyOverflowX = body.style.overflowX;
    const previousBodyOverflowY = body.style.overflowY;
    html.classList.add("page-scroll-unlock");
    body.classList.add("page-scroll-unlock");
    html.style.touchAction = "pan-y";
    body.style.touchAction = "pan-y";
    html.style.overflowX = "hidden";
    html.style.overflowY = "hidden";
    body.style.overflowX = "hidden";
    body.style.overflowY = "hidden";

    return () => {
      html.style.touchAction = previousHtmlTouchAction;
      body.style.touchAction = previousBodyTouchAction;
      html.style.overflowX = previousHtmlOverflowX;
      html.style.overflowY = previousHtmlOverflowY;
      body.style.overflowX = previousBodyOverflowX;
      body.style.overflowY = previousBodyOverflowY;
      html.classList.remove("page-scroll-unlock");
      body.classList.remove("page-scroll-unlock");
    };
  }, []);

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
      <ManageMoneyVaultCard className="money-card-page" />
    </main>
  );
}

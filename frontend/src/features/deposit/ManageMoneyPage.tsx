"use client";

import Image from "next/image";
import Link from "next/link";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  readMiniPayDepositLinkProps,
} from "~/lib/minipay/addCash";
import {
  useLegacyGameVaultBalanceQuery,
  useSupportedPaymentTokensQuery,
  useTicketBalanceQuery,
} from "~/features/tickets/hooks.ts";
import { readTicketChainConfig } from "~/features/tickets/config.ts";
import {
  parseSupportedChainId,
  type PaymentTokenSymbol,
} from "~/features/tickets/domain.ts";
import { ticketRuntimeAdapter } from "~/features/tickets/runtimeAdapter.ts";
import { shouldShowLegacyWithdraw } from "~/features/tickets/topUpDomain.ts";
import {
  formatTokenUnits,
  useTicketTopUp,
} from "~/features/tickets/useTicketTopUp";
import { useWallet } from "~/features/wallet/WalletProvider";
import { CELO_CHAIN_ID } from "~/lib/web3/celo";
import { useDepositFlow } from "./useDepositFlow";

type MoneyActionMode = "top-up" | "withdraw";

type ManageMoneyVaultCardProps = {
  className?: string;
  onClose?: () => void;
};

function shortHash(hash: string) {
  return hash ? `${hash.slice(0, 10)}...${hash.slice(-8)}` : "";
}

function LegacyWithdrawPanel({
  availableUnits,
  onRefresh,
}: {
  availableUnits: bigint;
  onRefresh: () => Promise<unknown>;
}) {
  const flow = useDepositFlow();
  const maxAmount = formatTokenUnits(availableUnits, 6);

  async function withdraw() {
    await flow.onWithdraw();
    await onRefresh();
    window.setTimeout(() => void onRefresh(), 2_000);
  }

  return (
    <div className="money-action-content">
      <p id="money-action-hint" className="money-action-hint">
        Withdraw the remaining balance from the legacy game vault. New deposits no
        longer use this vault.
      </p>
      {flow.configMessage ? <p className="flow-alert" role="status">{flow.configMessage}</p> : null}
      {flow.statusMessage ? <p className="flow-success" role="status">{flow.statusMessage}</p> : null}
      {flow.errorMessage ? <p className="flow-alert" role="alert">{flow.errorMessage}</p> : null}

      <div className="money-amount-block">
        <label className="flow-label" htmlFor="legacy-withdraw-amount">AMOUNT (USDC)</label>
        <input
          id="legacy-withdraw-amount"
          className="flow-input money-input"
          type="number"
          min="0"
          step="0.000001"
          inputMode="decimal"
          autoComplete="off"
          value={flow.amount}
          onChange={(event) => flow.setAmount(event.target.value)}
        />
        <button
          type="button"
          className="money-quick-pick money-quick-pick-max"
          onClick={() => flow.setAmount(maxAmount)}
        >
          LEGACY MAX · {maxAmount} USDC
        </button>
      </div>

      <button
        className="flow-btn money-primary-btn money-withdraw-btn"
        type="button"
        disabled={flow.disableWithdrawButton}
        onClick={() => void withdraw()}
      >
        {flow.isWithdrawBusy ? "WITHDRAWING..." : "WITHDRAW LEGACY BALANCE"}
      </button>

      {flow.withdrawTxHash ? (
        <div className="money-inline-activity">
          <span>Latest Withdraw</span>
          {flow.withdrawTxUrl ? (
            <a href={flow.withdrawTxUrl} target="_blank" rel="noreferrer">
              {shortHash(flow.withdrawTxHash)}
            </a>
          ) : <span className="mono">{shortHash(flow.withdrawTxHash)}</span>}
        </div>
      ) : null}
    </div>
  );
}

export function ManageMoneyVaultCard({
  className = "",
  onClose,
}: ManageMoneyVaultCardProps) {
  const wallet = useWallet();
  const supportedTokens = useSupportedPaymentTokensQuery(ticketRuntimeAdapter);
  const ticketBalance = useTicketBalanceQuery(ticketRuntimeAdapter);
  const legacyBalance = useLegacyGameVaultBalanceQuery(ticketRuntimeAdapter);
  const configuredChainId =
    parseSupportedChainId(wallet.chainIdHex) ?? parseSupportedChainId(CELO_CHAIN_ID);
  const configuredTokens = configuredChainId
    ? readTicketChainConfig(configuredChainId).paymentTokens
    : [];
  const tokens = supportedTokens.data ?? configuredTokens;
  const topUp = useTicketTopUp(tokens);
  const [moneyAction, setMoneyAction] = useState<MoneyActionMode>("top-up");
  const depositFallbackRef = useRef<HTMLAnchorElement>(null);
  const legacyUnits = legacyBalance.data?.units ?? 0n;
  const showLegacyWithdraw = shouldShowLegacyWithdraw(legacyUnits);
  const activeMoneyAction =
    moneyAction === "withdraw" && showLegacyWithdraw ? "withdraw" : "top-up";

  const tabs = useMemo(
    () => [
      { mode: "top-up" as const, label: "TOP UP" },
      ...(showLegacyWithdraw
        ? [{ mode: "withdraw" as const, label: "WITHDRAW" }]
        : []),
    ],
    [showLegacyWithdraw],
  );

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = tabs.findIndex((tab) => tab.mode === activeMoneyAction);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
    else if (event.key === "ArrowLeft") nextIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    setMoneyAction(tabs[nextIndex].mode);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]
      ?.focus();
  }

  async function handleTopUp() {
    if (!topUp.account) {
      await topUp.connectWallet();
      return;
    }
    if (!topUp.isAppChain) {
      await topUp.switchToAppChain();
      return;
    }
    if (topUp.insufficientBalance) {
      if (topUp.isMiniPay) window.location.assign(topUp.addCashUrl);
      else depositFallbackRef.current?.focus();
      return;
    }
    topUp.mutation.mutate();
  }

  const enabledTokens = tokens.filter((token) => token.enabled && token.address);
  const selectedSnapshot = topUp.snapshots.find(
    (entry) => entry.token.symbol === topUp.selectedToken?.symbol,
  );
  const maxWholeDollars = topUp.selectedToken && selectedSnapshot
    ? selectedSnapshot.balanceUnits / 10n ** BigInt(topUp.selectedToken.decimals)
    : 0n;
  const topUpDisabled = Boolean(
    topUp.mutation.isPending ||
    supportedTokens.isLoading ||
    !enabledTokens.length ||
    (topUp.account &&
      topUp.isAppChain &&
      (topUp.snapshotQuery.isLoading ||
        !selectedSnapshot ||
        !topUp.quote ||
        !topUp.selectedToken)),
  );
  const topUpButtonLabel = !enabledTokens.length
    ? "SHOP UNAVAILABLE"
    : !topUp.account
      ? "CONNECT WALLET"
      : !topUp.isAppChain
      ? "SWITCH TO CELO"
      : topUp.insufficientBalance
        ? "DEPOSIT STABLECOIN"
        : topUp.stage === "approving"
          ? "APPROVING TOKEN..."
          : topUp.stage === "purchasing"
            ? "CONFIRM TOP UP..."
            : topUp.stage === "confirming"
              ? "CONFIRMING ONCHAIN..."
              : topUp.quote
                ? `BUY ${topUp.quote.ticketAmount} TICKETS`
                : "ENTER WHOLE DOLLARS";
  const depositLinkProps = readMiniPayDepositLinkProps(topUp.isMiniPay);
  const walletStatus = !topUp.account ? "Not Connected" : !topUp.isAppChain ? "Wrong Network" : "Connected";

  return (
    <section className={["flow-card money-card", className].filter(Boolean).join(" ")}>
      {onClose ? (
        <button className="close-btn money-card-close" type="button" aria-label="Close manage money" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      ) : null}

      <header className="money-header">
        <div className="money-head-top">
          <div className="money-head-title-row">
            <span className="money-head-eyebrow">PASSCHICK TICKET DESK</span>
          </div>
          <div className="money-head-badges" aria-label="Wallet and payment status">
            <span className={`money-head-badge money-head-badge-${topUp.account && topUp.isAppChain ? "ready" : "warning"}`}>
              <span className="money-badge-dot" />
              {walletStatus}
            </span>
            <span className="money-head-badge money-head-badge-fee">STABLECOIN FEE</span>
          </div>
        </div>
        <div className="money-head-main">
          <h1 className="flow-title money-title">GET TICKETS</h1>
          <div className="money-rate-pill">
            <span className="money-rate-tag">$1 USD</span>
            <span className="money-rate-arrow">=</span>
            <span className="money-rate-val">20 TICKETS</span>
          </div>
        </div>
      </header>

      <div className="money-grid">
        <section className="flow-status money-status-panel">
          <p className="money-section-label">PLAYER SNAPSHOT</p>
          <div className="money-status-grid">
            <div className="money-status-row">
              <span>Ticket Balance</span>
              <strong>{ticketBalance.isLoading ? "..." : (ticketBalance.data?.available ?? 0n).toString()} TIX</strong>
            </div>
            <div className="money-status-row">
              <span>Exchange Rate</span>
              <strong>$1 = 20 TIX</strong>
            </div>
            <div className="money-status-row">
              <span>Payment Tokens</span>
              <strong>{enabledTokens.length ? enabledTokens.map((token) => token.symbol).join(" · ") : "SHOP CLOSED"}</strong>
            </div>
            {showLegacyWithdraw ? (
              <div className="money-status-row">
                <span>Legacy Vault</span>
                <strong>{formatTokenUnits(legacyUnits, 6)} USDC</strong>
              </div>
            ) : null}
          </div>
        </section>

        <section className="money-action-panel">
          {showLegacyWithdraw ? (
            <div className="money-action-tabs" role="tablist" aria-label="Ticket and legacy vault actions" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
              {tabs.map((tab) => (
                <button
                  key={tab.mode}
                  id={`money-action-${tab.mode}`}
                  type="button"
                  role="tab"
                  aria-selected={activeMoneyAction === tab.mode}
                  aria-controls="money-action-panel"
                  tabIndex={activeMoneyAction === tab.mode ? 0 : -1}
                  className={`money-action-tab${activeMoneyAction === tab.mode ? " active" : ""}`}
                  onClick={() => setMoneyAction(tab.mode)}
                  onKeyDown={onTabKeyDown}
                >{tab.label}</button>
              ))}
            </div>
          ) : null}

          <div id="money-action-panel" role="tabpanel" aria-labelledby={`money-action-${activeMoneyAction}`}>
            {activeMoneyAction === "withdraw" ? (
              <LegacyWithdrawPanel availableUnits={legacyUnits} onRefresh={legacyBalance.refetch} />
            ) : (
              <div className="money-action-content">
                {supportedTokens.isLoading || topUp.snapshotQuery.isLoading ? <p className="money-loading" role="status">READING CELO BALANCES...</p> : null}
                {supportedTokens.isError || topUp.snapshotQuery.isError ? (
                  <p className="flow-alert" role="alert">Ticket payment balances could not be loaded. Retry the Celo read.</p>
                ) : null}
                {!supportedTokens.isLoading && !enabledTokens.length ? (
                  <p className="flow-alert" role="status">Ticket sales are not enabled on this network yet. No payment will be requested.</p>
                ) : null}
                {topUp.errorState ? <p className="flow-alert" role="alert">{topUp.errorState.message}</p> : null}
                {topUp.mutation.isSuccess ? <p className="flow-success" role="status">+{topUp.mutation.data.tickets} tickets added. Balance refreshed.</p> : null}

                <fieldset className="money-token-fieldset">
                  <legend className="flow-label">PAY WITH STABLECOIN</legend>
                  <div className="money-token-grid">
                    {tokens.map((token) => {
                      const snapshot = topUp.snapshots.find((entry) => entry.token.symbol === token.symbol);
                      const available = Boolean(token.enabled && token.address);
                      return (
                        <button
                          type="button"
                          key={token.symbol}
                          className={`money-token-option${topUp.selectedToken?.symbol === token.symbol ? " active" : ""}`}
                          disabled={!available || topUp.mutation.isPending}
                          aria-pressed={topUp.selectedToken?.symbol === token.symbol}
                          onClick={() => topUp.setSelectedSymbol(token.symbol as PaymentTokenSymbol)}
                        >
                          <div className="money-token-head">
                            <strong>{token.symbol}</strong>
                            {topUp.selectedToken?.symbol === token.symbol ? <span className="money-token-check">✓</span> : null}
                          </div>
                          <span>{available ? `${formatTokenUnits(snapshot?.balanceUnits ?? 0n, token.decimals)} available` : "Unavailable"}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="money-amount-block">
                  <label className="flow-label" htmlFor="ticket-top-up-amount">AMOUNT (USD)</label>
                  <div className="money-input-wrapper">
                    <span className="money-currency-prefix">$</span>
                    <input
                      id="ticket-top-up-amount"
                      className="flow-input money-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={topUp.amount}
                      aria-describedby="ticket-top-up-quote"
                      onChange={(event) => topUp.setAmount(event.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </div>
                  <div className="money-quick-picks">
                    {[1, 2, 5, 10].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className={`money-quick-pick${topUp.amount === String(amount) ? " active" : ""}`}
                        onClick={() => topUp.setAmount(String(amount))}
                      >
                        ${amount}
                      </button>
                    ))}
                    {maxWholeDollars > 0n ? (
                      <button
                        type="button"
                        className="money-quick-pick money-quick-pick-max"
                        onClick={() => topUp.setAmount(maxWholeDollars.toString())}
                      >
                        MAX (${maxWholeDollars.toString()})
                      </button>
                    ) : null}
                  </div>
                </div>

                <div id="ticket-top-up-quote" className="money-ticket-quote" aria-live="polite">
                  <div className="money-quote-label-col">
                    <span className="money-quote-eyebrow">YOU RECEIVE</span>
                    <span className="money-quote-sub">Rate: 1 USD = 20 Tickets</span>
                  </div>
                  <div className="money-quote-value-col">
                    <Image
                      src="/images/ticket_icon.png"
                      alt="Ticket"
                      width={28}
                      height={28}
                      className="money-quote-icon"
                      unoptimized
                    />
                    <strong className="money-quote-number">
                      {topUp.quote ? `${topUp.quote.ticketAmount} TIX` : "0 TIX"}
                    </strong>
                  </div>
                </div>

                <button
                  className="flow-btn money-primary-btn"
                  type="button"
                  disabled={topUpDisabled}
                  onClick={() => void handleTopUp()}
                >
                  {topUpButtonLabel}
                </button>
                <p className="money-helper">Gas fee paid in stablecoins. No CELO required.</p>

                {topUp.insufficientBalance ? (
                  <aside className="money-add-cash" aria-labelledby="money-deposit-title">
                    <strong id="money-deposit-title">Need {topUp.selectedToken?.symbol} balance?</strong>
                    <a
                      ref={depositFallbackRef}
                      className="money-add-cash-link"
                      href={topUp.addCashUrl}
                      {...depositLinkProps}
                    >
                      Deposit in MiniPay ↗
                    </a>
                  </aside>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      {(topUp.approvalHash || topUp.purchaseHash) ? (
        <section className="money-activity" aria-label="Recent ticket activity">
          <p className="flow-eyebrow money-activity-eyebrow">RECENT ACTIVITY</p>
          <div className="money-activity-list">
            {topUp.approvalHash ? <div className="money-activity-item"><span>Token Approval</span><a href={topUp.approvalUrl} target="_blank" rel="noreferrer">{shortHash(topUp.approvalHash)}</a></div> : null}
            {topUp.purchaseHash ? <div className="money-activity-item"><span>Ticket Top Up</span><a href={topUp.purchaseUrl} target="_blank" rel="noreferrer">{shortHash(topUp.purchaseHash)}</a></div> : null}
          </div>
        </section>
      ) : null}

      {!onClose ? <div className="money-panel-footer"><div className="money-footer-actions"><Link href="/" className="flow-btn money-nav-home-btn money-panel-nav-btn">HOME</Link><Link href="/play" className="flow-btn money-nav-play-btn money-panel-nav-btn">PLAY GAME</Link></div></div> : null}
    </section>
  );
}

export function ManageMoneyPage() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("page-scroll-unlock");
    body.classList.add("page-scroll-unlock");
    return () => {
      html.classList.remove("page-scroll-unlock");
      body.classList.remove("page-scroll-unlock");
    };
  }, []);

  return (
    <main className="flow-page money-page">
      <div className="money-bg" aria-hidden="true"><iframe className="money-bg-frame" src="/play?bg=1" title="In-game background" tabIndex={-1} /></div>
      <div className="money-overlay" aria-hidden="true" />
      <ManageMoneyVaultCard className="money-card-page" />
    </main>
  );
}

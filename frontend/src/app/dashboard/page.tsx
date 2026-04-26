"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatUnits, isAddress } from "viem";
import type { Address } from "viem";
import { useReadContract } from "wagmi";
import { useWallet } from "~/components/web3/WalletProvider";
import {
  ERC20_ABI,
  USDC_ADDRESS,
  USDC_DECIMALS,
} from "~/lib/web3/contracts";
import { MINIPAY_UNSUPPORTED_CHAIN_MESSAGE } from "~/lib/web3/minipay";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const HOME_CONNECT_PROMPT_KEY = "chicken-home-connect-prompt";

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatWalletUsdcDisplay(value: bigint | undefined) {
  if (value === undefined) return "-";
  const numeric = Number(formatUnits(value, USDC_DECIMALS));
  if (!Number.isFinite(numeric)) return "-";
  if (numeric > 0 && numeric < 0.01) {
    return numeric.toFixed(4);
  }
  return numeric.toFixed(2);
}

export default function DashboardPage() {
  const [showHelp, setShowHelp] = useState(false);
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const {
    account,
    canDisconnect,
    isMiniPay,
    isCeloChain,
    isConnecting,
    connectWallet,
    disconnectWallet,
  } = useWallet();
  const isConnected = Boolean(account);
  const showMiniPayCallout = isMiniPay && !isCeloChain;
  const showConnectedDashboardUi = isConnected && !isLoggingOut;
  const ownerAddress = isAddress(account) ? (account as Address) : undefined;
  const usdcAddress = isAddress(USDC_ADDRESS)
    ? (USDC_ADDRESS as Address)
    : undefined;

  const { data: walletUsdcData } = useReadContract({
    address: usdcAddress || ZERO_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [ownerAddress || ZERO_ADDRESS],
    query: {
      enabled: Boolean(isConnected && ownerAddress && usdcAddress),
    },
  });

  const walletUsdcDisplay =
    walletUsdcData === undefined ? "-" : formatWalletUsdcDisplay(walletUsdcData);

  useEffect(() => {
    if (!showProfilePopover) return;

    function onMouseDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        profileWrapRef.current &&
        target &&
        !profileWrapRef.current.contains(target)
      ) {
        setShowProfilePopover(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowProfilePopover(false);
      }
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showProfilePopover]);

  function onConnect() {
    void connectWallet();
  }

  async function onLogout() {
    setShowProfilePopover(false);
    setIsLoggingOut(true);
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(HOME_CONNECT_PROMPT_KEY, "1");
      }
      await disconnectWallet();
    } finally {
      window.location.assign("/?connect=1");
    }
  }

  return (
    <main className="flow-page dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-bg" aria-hidden="true">
          <iframe
            className="dashboard-bg-frame"
            src="/play?bg=1"
            title="In-game background"
            tabIndex={-1}
          />
        </div>
        <div className="dashboard-overlay" aria-hidden="true" />

        <header className="home-nav home-nav-global">
          <Link className="home-brand" href="/">
            <span className="home-brand-badge">GM</span>
            <span className="home-brand-copy">
              <p className="home-brand-eyebrow">Celo Arcade Risk Game</p>
              <span className="home-brand-name">Pass Chick</span>
            </span>
          </Link>

          <div className="home-nav-cluster">
            <div className="home-nav-actions">
              {showConnectedDashboardUi || isLoggingOut ? (
                <div className="home-profile-wrap" ref={profileWrapRef}>
                  <button
                    type="button"
                    className="flow-btn secondary home-nav-login"
                    disabled={isLoggingOut}
                    onClick={() => setShowProfilePopover((current) => !current)}
                  >
                    {isLoggingOut ? "LOGGING OUT..." : shortAddress(account)}
                  </button>

                  {showProfilePopover && !isLoggingOut && (
                    <section
                      className="flow-status home-profile-popover"
                      style={{ color: "white" }}
                    >
                      <p className="home-preview-title home-profile-heading">
                        PROFILE
                      </p>
                      <div className="home-profile-meta">
                        <div className="home-profile-row">
                          <span className="home-profile-label">Wallet</span>
                          <span className="mono home-profile-value">
                            {shortAddress(account)}
                          </span>
                        </div>
                        <div className="home-profile-row">
                          <span className="home-profile-label">USDC</span>
                          <span className="mono home-profile-value">
                            {walletUsdcDisplay}
                          </span>
                        </div>
                        <div className="home-profile-row">
                          <span className="home-profile-label">Chain</span>
                          <span
                            className={`mono home-profile-value ${
                              isMiniPay || isCeloChain
                                ? "home-profile-value-ready"
                                : "home-profile-value-warning"
                            }`}
                          >
                            {isMiniPay
                              ? "MINIPAY / CELO"
                              : isCeloChain
                                ? "CELO READY"
                                : "SWITCH TO CELO"}
                          </span>
                        </div>
                      </div>
                      <div className="home-profile-actions">
                        <Link
                          href="/"
                          className="flow-btn home-profile-action home-profile-action-dashboard"
                        >
                          HOME
                        </Link>
                        <Link
                          href="/managemoney"
                          className="flow-btn home-profile-action home-profile-action-manage"
                        >
                          MANAGE MONEY
                        </Link>
                        {canDisconnect ? (
                          <button
                            className="flow-btn home-profile-action home-profile-action-logout"
                            type="button"
                            onClick={onLogout}
                          >
                            LOG OUT
                          </button>
                        ) : null}
                      </div>
                    </section>
                  )}
                </div>
              ) : isMiniPay ? (
                <button
                  type="button"
                  className="flow-btn secondary home-nav-login"
                  disabled
                >
                  MINIPAY MODE
                </button>
              ) : (
                <button
                  type="button"
                  className="flow-btn primary home-nav-login"
                  onClick={onConnect}
                  disabled={isConnecting}
                >
                  {isConnecting ? "CONNECTING..." : "LOGIN"}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="dashboard-center">
          {showMiniPayCallout ? (
            <p className="flow-alert">{MINIPAY_UNSUPPORTED_CHAIN_MESSAGE}</p>
          ) : null}
          <div className="dashboard-title" aria-label="Pass Chick">
            <span className="dashboard-title-line">CHICKEN</span>
            <span className="dashboard-title-line">CELO</span>
          </div>
          <div className="dashboard-actions">
            {showConnectedDashboardUi ? (
              <>
                <a
                  href="/play"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                >
                  PLAY NOW
                </a>
                <button
                  type="button"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-how"
                  onClick={() => setShowHelp(true)}
                >
                  HOW TO PLAY
                </button>
                <a
                  href="/managemoney"
                  className="flow-btn home-btn-main dashboard-btn dashboard-btn-deposit"
                >
                  MANAGE MONEY
                </a>
                {canDisconnect ? (
                  <button
                    type="button"
                    className="flow-btn home-btn-main dashboard-btn dashboard-btn-logout"
                    onClick={onLogout}
                  >
                    LOG OUT
                  </button>
                ) : null}
              </>
            ) : isLoggingOut ? (
              <button
                type="button"
                className="flow-btn home-btn-main dashboard-btn dashboard-btn-logout"
                disabled
              >
                LOGGING OUT...
              </button>
            ) : isMiniPay ? (
              <button
                type="button"
                className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                disabled
              >
                MINIPAY MODE
              </button>
            ) : (
              <button
                type="button"
                className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                onClick={onConnect}
                disabled={isConnecting}
              >
                {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
              </button>
            )}
          </div>
        </div>
      </section>

      {showHelp ? (
        <div className="home-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="home-modal-box" onClick={(event) => event.stopPropagation()}>
            <button
              className="home-modal-close"
              type="button"
              onClick={() => setShowHelp(false)}
            >
              X
            </button>
            <h2>HOW TO PLAY</h2>
            <div className="home-help-content">
              <div className="help-step">
                <span className="step-num">1</span>
                <div>
                  <p className="step-title">MANAGE MONEY</p>
                  <p>Deposit USDC into your vault, then use available balance for live runs.</p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <div>
                  <p className="step-title">RUN & STACK</p>
                  <p>Move lane by lane to increase multiplier while avoiding traffic.</p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <div>
                  <p className="step-title">CHECKPOINT CASH OUT</p>
                  <p>Cash out at checkpoints before crash or decay eats the payout.</p>
                </div>
              </div>
            </div>
            <button
              className="flow-btn secondary info-modal-action"
              type="button"
              onClick={() => setShowHelp(false)}
            >
              GOT IT
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}

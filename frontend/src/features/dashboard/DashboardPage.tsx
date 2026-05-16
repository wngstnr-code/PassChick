"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "~/features/wallet/WalletProvider";

const HOME_CONNECT_PROMPT_KEY = "chicken-home-connect-prompt";

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function DashboardPage() {
  const [showHelp, setShowHelp] = useState(false);
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const {
    account,
    canDisconnect,
    isAppChain,
    isConnecting,
    walletProviderName,
    connectWallet,
    disconnectWallet,
  } = useWallet();
  const [profileCopyLabel, setProfileCopyLabel] = useState("COPY");
  const isConnected = Boolean(account);
  const showConnectedDashboardUi = isConnected && !isLoggingOut;
  const walletUsdcDisplay = "-";

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
        try {
          window.sessionStorage.setItem(HOME_CONNECT_PROMPT_KEY, "1");
        } catch (error) {
          console.warn("sessionStorage.setItem failed:", error);
        }
      }
      await disconnectWallet();
    } finally {
      window.location.assign("/?connect=1");
    }
  }

  async function onCopyWallet() {
    if (!account || typeof navigator === "undefined") return;

    try {
      await navigator.clipboard.writeText(account);
      setProfileCopyLabel("COPIED");
      window.setTimeout(() => setProfileCopyLabel("COPY"), 1400);
    } catch (error) {
      console.warn("Clipboard write failed:", error);
      setProfileCopyLabel("FAILED");
      window.setTimeout(() => setProfileCopyLabel("COPY"), 1400);
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
            <span className="home-brand-badge">
              <img src="/favicon.png" alt="GM" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </span>
            <span className="home-brand-copy">
              <p className="home-brand-eyebrow">Celo Arcade Risk Game</p>
              <span className="home-brand-name">PASSCHICK</span>
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
                          <span className="home-profile-label">Provider</span>
                          <span className="mono home-profile-value">
                            {walletProviderName || "Celo Wallet"}
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
                              isAppChain
                                ? "home-profile-value-ready"
                                : "home-profile-value-warning"
                            }`}
                          >
                            CELO
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
                        <button
                          className="flow-btn home-profile-action home-profile-action-copy"
                          type="button"
                          onClick={() => void onCopyWallet()}
                        >
                          {profileCopyLabel}
                        </button>
                      </div>
                    </section>
                  )}
                </div>
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
          <div className="dashboard-title" aria-label="PASSCHICK">
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

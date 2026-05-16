"use client";



import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "~/features/wallet/WalletProvider";
import { backendFetch } from "~/lib/backend/api";
import { hasBackendApiConfig } from "~/lib/backend/config";

type ProfitLeaderboardEntry = {
  wallet_address: string;
  total_profit?: number | string | null;
  total_games?: number | string | null;
  total_wins?: number | string | null;
  total_losses?: number | string | null;
  passportTier?: number;
  passportTierLabel?: string;
  passportReward?: string;
};

const HOME_CONNECT_PROMPT_KEY = "chicken-home-connect-prompt";

const FALLBACK_DISTANCE_BOARD: ChickenBridgeLeaderboardEntry[] = [
  {
    wallet_address: "9wFFmZqG8x7pR1GXHd6HrK6L2VgvE3QpG7rW7eU5k7Th",
    best_score: 182,
    games_played: 36,
    best_multiplier: 6.4,
    passportTier: 4,
    passportTierLabel: "Oracle",
    passportReward: "Partner Perks Passport",
  },
  {
    wallet_address: "6Y4F9XgJ7bZVQ9uJkJQxGY7XvBhLheYq3wURVaKkXZ5H",
    best_score: 147,
    games_played: 28,
    best_multiplier: 4.8,
    passportTier: 3,
    passportTierLabel: "Elite",
    passportReward: "Tournament Access",
  },
  {
    wallet_address: "4GJ2dGJxLJ9M7JtfWb1o7xT8DwV7m2qAZ2sYvJrJ1Dq8",
    best_score: 133,
    games_played: 19,
    best_multiplier: 4.2,
    passportTier: 2,
    passportTierLabel: "Steady",
    passportReward: "Allowlist Eligible",
  },
];

const FALLBACK_PROFIT_BOARD: ProfitLeaderboardEntry[] = [
  {
    wallet_address: "HDu6h7o8gSEgFvCKVwQn5T7KJfCn9Ukp6LQwQyPpV1mZ",
    total_profit: 214.4,
    total_games: 14,
    total_wins: 8,
    passportTier: 4,
    passportTierLabel: "Oracle",
    passportReward: "Partner Perks Passport",
  },
  {
    wallet_address: "8uM3p8jE4mvJp5gH9LTSuET6qeyMCrwVbi6R5Z7wGqRj",
    total_profit: 171.2,
    total_games: 21,
    total_wins: 11,
    passportTier: 3,
    passportTierLabel: "Elite",
    passportReward: "Tournament Access",
  },
  {
    wallet_address: "2gQ7L6kLT3R1V4zJyX4u9gP4zNX4Zu1rvK8FQ3yK6xPb",
    total_profit: 138.75,
    total_games: 17,
    total_wins: 9,
    passportTier: 1,
    passportTierLabel: "Runner",
    passportReward: "Verified Identity",
  },
];

const ABOUT_FEATURES = [
  {
    title: "SKILL-FIRST ARCADE RUNS",
    copy: "Every run rewards timing, focus, and lane-reading under pressure.",
    tone: "risk",
    imageSrc: "/images/1.webp",
    imageAlt: "PASSCHICK arcade stakes preview",
  },
  {
    title: "CHECKPOINT DECISIONS",
    copy: "At each checkpoint, choose to secure progress or keep pushing for a higher score.",
    tone: "checkpoint",
    imageSrc: "/images/2.webp",
    imageAlt: "PASSCHICK checkpoint cash out preview",
  },
  {
    title: "SMOOTH CELO FLOW",
    copy: "From wallet connect to live play, your progress sync stays fast and simple.",
    tone: "wallet",
    imageSrc: "/images/3.webp",
    imageAlt: "PASSCHICK wallet flow preview",
  },
];

const FLOW_STEPS = [
  {
    label: "01",
    action: "FUND",
    title: "Load the Vault",
    copy: "Move USDC in. This becomes your playable balance.",
  },
  {
    label: "02",
    action: "RUN",
    title: "Cross or Cash Out",
    copy: "Reach checkpoints, bank profit, or push for a bigger multiplier.",
  },
  {
    label: "03",
    action: "SETTLE",
    title: "Lock the Result",
    copy: "Your vault and Passport update after the run settles.",
  },
];

const PASSPORT_BENEFITS = ["Trust tier", "Access signal", "Reward eligibility"];

const PASSPORT_FEATURES = [
  {
    label: "HUMAN SCORE",
    title: "Behavior-based trust signal",
    copy: "Passport score is built from real gameplay patterns and anti-bot signals, not social hype.",
  },
  {
    label: "ONCHAIN PROOF",
    title: "Verifiable by any app",
    copy: "Partner apps can verify wallet trust status through Celo contract data before granting access or rewards.",
  },
  {
    label: "USE CASE",
    title: "Access and reward filter",
    copy: "Partner projects can reduce sybil noise by checking passport eligibility from contract and API.",
  },
];

const GAME_GUIDE_SLIDES = [
  {
    title: "CROSS THE ROAD",
    copy: "Move lane by lane, dodge traffic, and survive as far as you can.",
    imageSrc: "/images/a.webp",
    imageAlt: "Chicken waiting to cross busy arcade lanes",
    tone: "road",
  },
  {
    title: "STACK MULTIPLIER",
    copy: "Each forward step adds multiplier. Every 40 hops opens a checkpoint.",
    imageSrc: "/images/b.webp",
    imageAlt: "Chicken hopping forward with multiplier trail",
    tone: "multiplier",
  },
  {
    title: "CASH OUT SMART",
    copy: "Cash out only at checkpoints. Push farther for more, but a crash loses your stake.",
    imageSrc: "/images/c.webp",
    imageAlt: "Chicken standing inside a glowing checkpoint cashout zone",
    tone: "cashout",
  },
  {
    title: "BEAT THE TIMER",
    copy: "You have 60 seconds between checkpoints. Overtime slowly cuts your multiplier.",
    imageSrc: "/images/d.webp",
    imageAlt: "Chicken racing toward a checkpoint with a countdown aura",
    tone: "timer",
  },
  {
    title: "EGGPASS",
    copy: "Passport is your on-chain reputation, built from clean runs and disciplined checkpoint cashouts.",
    imageSrc: "/images/e.webp",
    imageAlt: "Chicken beside a floating on-chain reputation passport",
    tone: "passport",
  },
  {
    title: "LEVEL YOUR PASSPORT",
    copy: "Higher tiers unlock trust perks, allowlist access, tournaments, and partner rewards.",
    note: "Tier 1 starts after 3 cashouts at checkpoint 2+.",
    imageSrc: "/images/f.webp",
    imageAlt: "Four floating passport tier cards with eggs and checkpoint stamps",
    tone: "tiers",
  },
];

const INTEGRATION_STEPS = [
  "Read passport status from backend API for quick integration in app flows.",
  "Verify wallet passport eligibility from Celo contract data for trust-minimized checks.",
  "Combine both: fast UX from API plus Celo verification for sensitive actions.",
];

function shortAddress(address: string) {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMoney(value: unknown) {
  const numeric = toNumber(value);
  return `$${numeric.toFixed(2)}`;
}

function formatPassportDate(epochSeconds?: number | null) {
  if (!epochSeconds) return "-";
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function readPassportStatusMessage(status: ChickenBridgePassportStatus) {
  if (status.passport.valid) {
    return `Passport valid - Tier ${status.passport.tier} - Exp ${formatPassportDate(status.passport.expiry)}`;
  }

  if (status.passport.revoked) return "Passport revoked.";
  if (!status.passport.configured) return "Passport program is not configured yet.";
  if (status.eligibility.eligible) return `Eligible for Tier ${status.eligibility.tier}.`;
  return status.eligibility.reason || "Keep playing to unlock your Passport.";
}

function readBestScore(entry: ChickenBridgeLeaderboardEntry) {
  return toNumber(entry.best_score ?? entry.max_row_reached);
}

function readBestMultiplier(entry: ChickenBridgeLeaderboardEntry) {
  return toNumber(entry.best_multiplier);
}

function readPassportTier(
  entry: Pick<ChickenBridgeLeaderboardEntry, "passportTier">,
) {
  return Math.max(0, Math.min(4, Math.floor(toNumber(entry.passportTier))));
}

function readPassportTierLabel(
  entry: Pick<ChickenBridgeLeaderboardEntry, "passportTier" | "passportTierLabel">,
) {
  if (entry.passportTierLabel) return entry.passportTierLabel;
  const tier = readPassportTier(entry);
  if (tier >= 4) return "Oracle";
  if (tier >= 3) return "Elite";
  if (tier >= 2) return "Steady";
  if (tier >= 1) return "Runner";
  return "Rookie";
}

function readPassportTierBadgeIcon(
  entry: Pick<ChickenBridgeLeaderboardEntry, "passportTier" | "passportTierLabel">,
) {
  const tier = readPassportTier(entry);
  if (tier >= 4) return "/images/oracle.png";
  if (tier >= 3) return "/images/elite.png";
  if (tier >= 2) return "/images/steady.png";
  return "/images/runner.png";
}

function readPassportReward(
  entry: Pick<
    ChickenBridgeLeaderboardEntry,
    "passportReward" | "passportTier"
  >,
) {
  if (entry.passportReward) return entry.passportReward;

  const tier = readPassportTier(entry);
  if (tier >= 4) return "Partner Perks Passport";
  if (tier >= 3) return "Tournament Access";
  if (tier >= 2) return "Allowlist Eligible";
  if (tier >= 1) return "Verified Identity";
  return "Basic Profile";
}

export function HomePage() {
  const reduceMotion = useReducedMotion();
  const {
    account,
    canDisconnect,
    isAppChain,
    isConnecting,
    error,
    walletProviderName,
    connectWallet,
    clearWalletError,
    disconnectWallet,
  } = useWallet();
  const [showProfilePopover, setShowProfilePopover] = useState(false);
  const [showGameGuide, setShowGameGuide] = useState(false);
  const [activeGuideSlide, setActiveGuideSlide] = useState(0);
  const [failedGuideImages, setFailedGuideImages] = useState<
    Record<string, boolean>
  >({});
  const [loadingGuideImages, setLoadingGuideImages] = useState<
    Record<string, boolean>
  >({});
  const [showHelp, setShowHelp] = useState(false);
  const [showPassportInfo, setShowPassportInfo] = useState(false);
  const [showTrustPassport, setShowTrustPassport] = useState(false);
  const [showPassportPreview, setShowPassportPreview] = useState(false);
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportStatus, setPassportStatus] =
    useState<ChickenBridgePassportStatus | null>(null);
  const [passportStatusText, setPassportStatusText] = useState("");
  const [showHeroConnectPrompt, setShowHeroConnectPrompt] = useState(false);
  const [profileCopyLabel, setProfileCopyLabel] = useState("COPY");
  const [passportCopyLabel, setPassportCopyLabel] = useState("COPY");
  const [distanceBoard, setDistanceBoard] = useState<
    ChickenBridgeLeaderboardEntry[]
  >(FALLBACK_DISTANCE_BOARD);
  const [profitBoard, setProfitBoard] = useState<ProfitLeaderboardEntry[]>(
    FALLBACK_PROFIT_BOARD,
  );
  const [isSocialLoading, setIsSocialLoading] = useState(false);
  const [showVerifiedBoard, setShowVerifiedBoard] = useState(false);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);

  const isConnected = Boolean(account);
  const walletUsdcDisplay = "-";
  const activeGuide = GAME_GUIDE_SLIDES[activeGuideSlide];
  const isLastGuideSlide = activeGuideSlide === GAME_GUIDE_SLIDES.length - 1;

  function openGameGuide() {
    const firstSlide = GAME_GUIDE_SLIDES[0];
    if (firstSlide) {
      setLoadingGuideImages((current) => ({
        ...current,
        [firstSlide.imageSrc]: true,
      }));
    }
    setActiveGuideSlide(0);
    setShowGameGuide(true);
  }

  function closeGameGuide() {
    setShowGameGuide(false);
  }

  function goToPreviousGuideSlide() {
    setActiveGuideSlide((current) => {
      const next = Math.max(0, current - 1);
      const slide = GAME_GUIDE_SLIDES[next];
      if (slide) {
        setLoadingGuideImages((prev) => ({ ...prev, [slide.imageSrc]: true }));
      }
      return next;
    });
  }

  function goToNextGuideSlide() {
    setActiveGuideSlide((current) => {
      const next = Math.min(GAME_GUIDE_SLIDES.length - 1, current + 1);
      const slide = GAME_GUIDE_SLIDES[next];
      if (slide) {
        setLoadingGuideImages((prev) => ({ ...prev, [slide.imageSrc]: true }));
      }
      return next;
    });
  }

  function markGuideImageFailed(imageSrc: string) {
    setFailedGuideImages((current) => ({ ...current, [imageSrc]: true }));
    setLoadingGuideImages((current) => ({ ...current, [imageSrc]: false }));
  }

  function markGuideImageLoaded(imageSrc: string) {
    setLoadingGuideImages((current) => ({ ...current, [imageSrc]: false }));
  }

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
    html.style.overflowY = "auto";
    body.style.overflowX = "hidden";
    body.style.overflowY = "auto";

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

  useEffect(() => {
    if (!showGameGuide) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeGameGuide();
        return;
      }

      if (event.key === "ArrowLeft") {
        goToPreviousGuideSlide();
        return;
      }

      if (event.key === "ArrowRight") {
        goToNextGuideSlide();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showGameGuide]);

  useEffect(() => {
    if (!hasBackendApiConfig()) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsSocialLoading(true);
    });

    void Promise.allSettled([
      backendFetch<{ leaderboard?: ChickenBridgeLeaderboardEntry[] }>(
        "/api/leaderboard",
      ),
      backendFetch<{ leaderboard?: ProfitLeaderboardEntry[] }>(
        "/api/leaderboard/profit",
      ),
    ])
      .then(([distanceResult, profitResult]) => {
        if (cancelled) return;

        if (
          distanceResult.status === "fulfilled" &&
          Array.isArray(distanceResult.value?.leaderboard) &&
          distanceResult.value.leaderboard.length > 0
        ) {
          setDistanceBoard(distanceResult.value.leaderboard.slice(0, 3));
        }

        if (
          profitResult.status === "fulfilled" &&
          Array.isArray(profitResult.value?.leaderboard) &&
          profitResult.value.leaderboard.length > 0
        ) {
          setProfitBoard(profitResult.value.leaderboard.slice(0, 3));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSocialLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isConnected) {
      queueMicrotask(() => setShowHeroConnectPrompt(false));
    }
  }, [isConnected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shouldOpenFromQuery = params.get("connect") === "1";
    const shouldOpenFromLogout =
      window.sessionStorage.getItem(HOME_CONNECT_PROMPT_KEY) === "1";

    if ((!shouldOpenFromQuery && !shouldOpenFromLogout) || isConnected) {
      return;
    }

    queueMicrotask(() => {
      setShowHeroConnectPrompt(true);
      setShowProfilePopover(false);
      clearWalletError();
    });
    window.sessionStorage.removeItem(HOME_CONNECT_PROMPT_KEY);
    window.scrollTo({ top: 0, behavior: "auto" });

    params.delete("connect");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${
      nextSearch ? `?${nextSearch}` : ""
    }${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [clearWalletError, isConnected]);

  function onLogout() {
    void disconnectWallet();
    setShowProfilePopover(false);
  }

  async function onCopyWallet() {
    if (!account || typeof navigator === "undefined") return;

    try {
      await navigator.clipboard.writeText(account);
      setProfileCopyLabel("COPIED");
      window.setTimeout(() => setProfileCopyLabel("COPY"), 1400);
    } catch (error) {
      console.warn("Caught error in HomePage:", error);
      setProfileCopyLabel("FAILED");
      window.setTimeout(() => setProfileCopyLabel("COPY"), 1400);
    }
  }

  async function onCopyPassportId() {
    const passportId = passportStatus?.passportId;
    if (!passportId || typeof navigator === "undefined") return;

    try {
      await navigator.clipboard.writeText(passportId);
      setPassportCopyLabel("COPIED");
      window.setTimeout(() => setPassportCopyLabel("COPY"), 1400);
    } catch (error) {
      console.warn("Caught error in HomePage:", error);
      setPassportCopyLabel("FAILED");
      window.setTimeout(() => setPassportCopyLabel("COPY"), 1400);
    }
  }

  function openHeroConnectPrompt() {
    setShowHeroConnectPrompt(true);
    setShowProfilePopover(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function onHeroPlayNow() {
    if (isConnected) {
      window.location.href = "/play";
      return;
    }
    openHeroConnectPrompt();
  }

  function onHeroBack() {
    setShowHeroConnectPrompt(false);
    clearWalletError();
  }

  async function loadTrustPassport(openPanel = true) {
    if (openPanel) setShowTrustPassport(true);
    if (passportBusy) return;

    if (!hasBackendApiConfig()) {
      setPassportStatusText("Backend API is not configured yet.");
      return;
    }

    setPassportBusy(true);
    try {
      const status =
        await backendFetch<ChickenBridgePassportStatus>("/api/passport/status");
      setPassportStatus(status);
      setPassportStatusText(readPassportStatusMessage(status));
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message?: string }).message || "")
          : "Failed to check passport status.";
      setPassportStatusText(message || "Failed to check passport status.");
    } finally {
      setPassportBusy(false);
    }
  }

  function openPassportFromGuide() {
    closeGameGuide();
    void loadTrustPassport(true);
  }

  const trackedRuns = profitBoard.reduce(
    (sum, entry) => sum + toNumber(entry.total_games),
    0,
  );
  const playersOnline = Math.max(
    18,
    distanceBoard.length * 23 + profitBoard.length * 19,
  );
  const trackedVolume = profitBoard.reduce(
    (sum, entry) => sum + Math.max(toNumber(entry.total_profit) * 5.5, 0),
    0,
  );

  const socialStats = [
    {
      label: "PLAYERS LIVE",
      value: playersOnline.toString(),
      note: "Wallets active now",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      ),
    },
    {
      label: "RUNS DONE",
      value: trackedRuns.toString(),
      note: "Completed sessions",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
        </svg>
      ),
    },
    {
      label: "TRACKED VOLUME",
      value: formatMoney(trackedVolume),
      note: "Estimated from recent boards",
      icon: (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3h12l4 6-10 12L2 9z"></path>
          <path d="M11 3 8 9l3 12 3-12-3-6z"></path>
          <path d="M2 9h20"></path>
        </svg>
      ),
    },
  ];
  const verifiedDistanceBoard = distanceBoard.filter(
    (entry) => readPassportTier(entry) >= 1,
  );
  const visibleDistanceBoard =
    showVerifiedBoard && verifiedDistanceBoard.length > 0
      ? verifiedDistanceBoard
      : distanceBoard;
  const featuredVerifiedPlayer =
    distanceBoard.find((entry) => readPassportTier(entry) >= 4) ??
    distanceBoard.find((entry) => readPassportTier(entry) >= 1) ??
    null;
  const passportProgression = passportStatus?.progression ?? null;
  const passportStats =
    passportProgression?.stats ?? passportStatus?.eligibility.stats ?? null;
  const passportPercent = Math.max(
    0,
    Math.min(100, passportProgression?.percentToNextTier ?? 0),
  );
  const passportCurrentTier = passportProgression?.currentTier ?? 0;
  const passportCurrentTierLabel =
    passportProgression?.currentTierLabel ?? "Rookie";
  const passportBenefits = passportStatus?.benefits ?? null;
  return (
    <main className="flow-page home-page">
      <header className="home-nav home-nav-global">
        <div className="home-brand">
          <div className="home-brand-badge">
            <img src="/favicon.png" alt="GM" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </div>
          <div className="home-brand-copy">
            <div className="home-brand-name home-wordmark">
              <span className="home-wordmark-egg">PASS</span>
              <span className="home-wordmark-rest">CHICK</span>
            </div>
          </div>
        </div>

        <div className="home-nav-cluster">
          <div className="home-nav-actions">
            {isConnected ? (
              <div className="home-profile-wrap" ref={profileWrapRef}>
                <button
                  className="flow-btn secondary home-nav-login"
                  type="button"
                  onClick={() => setShowProfilePopover((current) => !current)}
                >
                  {shortAddress(account)}
                </button>

                {showProfilePopover && (
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
                      <button
                        className="flow-btn home-profile-action home-profile-action-copy"
                        type="button"
                        onClick={() => void onCopyWallet()}
                      >
                        {profileCopyLabel}
                      </button>
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
            ) : (
              <button
                className="flow-btn primary home-nav-login"
                type="button"
                onClick={openHeroConnectPrompt}
              >
                LOGIN
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="home-hero">
        <div className="home-game-bg" aria-hidden="true">
          <iframe
            className="home-game-bg-frame"
            src="/play?bg=1"
            title="In-game background"
            tabIndex={-1}
          />
        </div>
        <div className="home-hero-overlay" aria-hidden="true" />

        <div className="home-shell home-shell-wide">
          <div className="home-hero-grid">
            <div className="home-hero-copy">
              <motion.h1
                className="home-title home-wordmark"
                whileHover={reduceMotion ? undefined : { scale: 1.015 }}
              >
                <span className="home-wordmark-egg">PASS</span>
                <span className="home-wordmark-rest">CHICK</span>
              </motion.h1>
              <p className="home-subcopy">
                A skill-based reflex adventure where timing and smart
                checkpoint decisions shape your progress.
              </p>
              {showHeroConnectPrompt && !isConnected ? (
                <div className="home-hero-connect-stack">
                  <motion.button
                    type="button"
                    className="flow-btn home-btn-main home-hero-cta"
                    onClick={() => void connectWallet()}
                    disabled={isConnecting}
                    whileHover={reduceMotion ? undefined : { y: -3, scale: 1.02 }}
                    whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                  >
                    {isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
                  </motion.button>
                  <motion.button
                    type="button"
                    className="flow-btn home-btn-main home-hero-back-btn"
                    onClick={onHeroBack}
                    disabled={isConnecting}
                    whileHover={reduceMotion ? undefined : { y: -2, scale: 1.015 }}
                    whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                  >
                    BACK
                  </motion.button>
                  {error ? (
                    <p className="flow-alert home-hero-connect-error">
                      {error}
                    </p>
                  ) : null}
                </div>
              ) : !isConnected ? (
                <motion.button
                  type="button"
                  className="flow-btn home-btn-main home-hero-cta"
                  onClick={onHeroPlayNow}
                  whileHover={reduceMotion ? undefined : { y: -3, scale: 1.025 }}
                  whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                >
                  PLAY NOW
                </motion.button>
              ) : null}

              {isConnected && !showHeroConnectPrompt ? (
                <div className="home-hero-connected-actions">
                  <motion.a
                    href="/play"
                    className="flow-btn home-btn-main dashboard-btn dashboard-btn-play"
                    whileHover={reduceMotion ? undefined : { y: -3, scale: 1.02 }}
                    whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                  >
                    PLAY NOW
                  </motion.a>
                  <motion.a
                    href="/managemoney"
                    className="flow-btn home-btn-main dashboard-btn dashboard-btn-deposit"
                    whileHover={reduceMotion ? undefined : { y: -3, scale: 1.02 }}
                    whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                  >
                    MANAGE MONEY
                  </motion.a>
                  <motion.button
                    type="button"
                    className="flow-btn home-btn-main dashboard-btn dashboard-btn-guide"
                    onClick={openGameGuide}
                    whileHover={reduceMotion ? undefined : { y: -3, scale: 1.02 }}
                    whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
                  >
                    GAME GUIDE
                  </motion.button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {isConnected ? (
          <motion.button
            type="button"
            className="home-passport-hero"
            aria-label="Open trust passport status"
            onClick={() => void loadTrustPassport(true)}
            whileHover={reduceMotion ? undefined : { y: -5, scale: 1.03 }}
            whileTap={reduceMotion ? undefined : { y: 1, scale: 0.98 }}
          >
            <span className="home-passport-hero-icon" aria-hidden="true">
              <img src="/images/pass.png" alt="" />
            </span>
            <span className="home-passport-hero-copy">
              <strong>TRUST PASSPORT</strong>
              <small>View status and tier</small>
            </span>
          </motion.button>
        ) : null}
      </section>

      <section
        id="preview"
        className="home-section home-section-about"
      >
        <div className="home-shell home-shell-section">
          <div className="home-about-head">
            <h2 className="home-section-title home-about-title">
              WHAT IS{" "}
              <span className="home-wordmark">
                <span className="home-wordmark-egg">PASS</span>
                <span className="home-wordmark-rest">CHICK</span>
              </span>
              ?
            </h2>
            <p className="home-about-copy">
              PASSCHICK is a fast reflex game where players read lane
              patterns, survive longer runs, and build on-chain progression
              through smart checkpoint decisions.
            </p>
          </div>

          <div className="home-about-grid">
            {ABOUT_FEATURES.map((item) => (
              <motion.article
                key={item.title}
                className="home-about-feature"
                whileHover={reduceMotion ? undefined : { y: -6, scale: 1.015 }}
              >
                <div
                  className={`home-about-media home-about-media-${item.tone}`}
                >
                  {item.imageSrc ? (
                    <img
                      className="home-about-image"
                      src={item.imageSrc}
                      alt={item.imageAlt || item.title}
                    />
                  ) : (
                    <div
                      className={`home-about-media-placeholder home-about-media-placeholder-${item.tone}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <h3 className="home-about-feature-title">{item.title}</h3>
                <p className="home-about-feature-copy">{item.copy}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-section home-section-social">
        <div className="home-shell home-shell-section">
          <div className="home-section-head home-section-head-center">
            <h2 className="home-section-title home-section-title-social">
              LIVE{" "}
              <span className="home-section-title-accent">ARCADE PULSE</span>
            </h2>
          </div>

          <div className="home-social-stats">
            {socialStats.map((stat) => (
              <article key={stat.label} className="home-social-stat">
                <div className="home-social-icon">{stat.icon}</div>
                <p>{stat.label}</p>
                <strong>{isSocialLoading ? "..." : stat.value}</strong>
                <span>{stat.note}</span>
              </article>
            ))}
          </div>

          {featuredVerifiedPlayer ? (
            <article className="home-verified-featured">
              <div>
                <p>TOP VERIFIED PLAYER</p>
                <h3>{shortAddress(featuredVerifiedPlayer.wallet_address)}</h3>
                <span>
                  TIER {readPassportTier(featuredVerifiedPlayer)} -{" "}
                  {featuredVerifiedPlayer.passportTierLabel || "Verified"}
                </span>
              </div>
              <strong>{readPassportReward(featuredVerifiedPlayer)}</strong>
            </article>
          ) : null}

          <div className="home-social-grid">
            <article className="home-social-card">
              <div className="home-social-card-head">
                <h3>BEST DISTANCE</h3>
                <div className="home-social-tabs" aria-label="Leaderboard filter">
                  <button
                    type="button"
                    className={!showVerifiedBoard ? "active" : ""}
                    onClick={() => setShowVerifiedBoard(false)}
                  >
                    ALL
                  </button>
                  <button
                    type="button"
                    className={showVerifiedBoard ? "active" : ""}
                    onClick={() => setShowVerifiedBoard(true)}
                    disabled={verifiedDistanceBoard.length === 0}
                  >
                    VERIFIED
                  </button>
                </div>
              </div>
              <ul className="home-social-list">
                {visibleDistanceBoard.slice(0, 3).map((entry, index) => (
                  <li
                    key={`${entry.wallet_address}-${index}`}
                    className="home-social-item"
                  >
                    <div>
                      <p>RANK #{index + 1}</p>
                      <h4>
                        {shortAddress(entry.wallet_address)}
                        {readPassportTier(entry) >= 1 ? (
                          <span
                            className="home-tier-badge home-tier-badge-icon"
                            aria-label={readPassportTierLabel(entry)}
                            title={readPassportTierLabel(entry)}
                          >
                            <img
                              className="home-tier-badge-logo"
                              src={readPassportTierBadgeIcon(entry)}
                              alt={readPassportTierLabel(entry)}
                            />
                          </span>
                        ) : null}
                      </h4>
                      <span>
                        {toNumber(entry.games_played)} runs | Peak{" "}
                        {readBestMultiplier(entry).toFixed(2)}x
                      </span>
                      {readPassportTier(entry) >= 3 ? (
                        <span className="home-access-note">
                          Cup Eligible - {readPassportReward(entry)}
                        </span>
                      ) : readPassportTier(entry) >= 1 ? (
                        <span className="home-access-note">
                          {readPassportReward(entry)}
                        </span>
                      ) : null}
                    </div>
                    <strong>{readBestScore(entry)} hops</strong>
                  </li>
                ))}
              </ul>
            </article>

            <article className="home-social-card">
              <div className="home-social-card-head">
                <h3>TOP PROFIT</h3>
              </div>
              <ul className="home-social-list">
                {profitBoard.slice(0, 3).map((entry, index) => (
                  <li
                    key={`${entry.wallet_address}-${index}`}
                    className="home-social-item"
                  >
                    <div>
                      <p>RANK #{index + 1}</p>
                      <h4>
                        {shortAddress(entry.wallet_address)}
                        {readPassportTier(entry) >= 1 ? (
                          <span
                            className="home-tier-badge home-tier-badge-icon"
                            aria-label={readPassportTierLabel(entry)}
                            title={readPassportTierLabel(entry)}
                          >
                            <img
                              className="home-tier-badge-logo"
                              src={readPassportTierBadgeIcon(entry)}
                              alt={readPassportTierLabel(entry)}
                            />
                          </span>
                        ) : null}
                      </h4>
                      <span>
                        {toNumber(entry.total_games)} runs |{" "}
                        {toNumber(entry.total_wins)} wins
                      </span>
                      {readPassportTier(entry) >= 2 ? (
                        <span className="home-access-note">
                          {readPassportReward(entry)}
                        </span>
                      ) : null}
                    </div>
                    <strong>{formatMoney(entry.total_profit)}</strong>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      <section
        className="home-section home-section-system"
      >
        <div className="home-shell home-shell-section">
          <motion.div
            className="home-section-head home-system-head"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <div>
              <p className="home-section-kicker">LIVE RUN LOOP</p>
              <h2 className="home-section-title">VAULT TO PASSPORT</h2>
            </div>
            <p className="home-system-subcopy">
              Every funded run becomes a readable reputation signal: bankroll,
              checkpoint discipline, settlement, then trust status.
            </p>
          </motion.div>
          <ol
            className="home-flow-track"
            aria-label="Vault to Passport flow"
          >
            {FLOW_STEPS.map((step, index) => (
              <motion.li
                key={step.title}
                className="home-flow-card"
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
                whileHover={reduceMotion ? undefined : { y: -4 }}
              >
                <div className="home-flow-card-top">
                  <p>{step.label}</p>
                  <span>{step.action}</span>
                </div>
                <h3>{step.title}</h3>
                <span>{step.copy}</span>
              </motion.li>
            ))}
          </ol>

          <motion.div
            className="home-money-band"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            whileHover={reduceMotion ? undefined : { y: -3 }}
          >
            <div className="home-money-band-copy">
              <p className="home-money-kicker">EGGPASS</p>
              <h3>Play clean. Build trust.</h3>
              <p>Cashouts, consistency, and fair runs shape your player reputation.</p>
            </div>
            <ul className="home-money-band-pills" aria-label="Passport benefits">
              {PASSPORT_BENEFITS.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      <section className="home-section home-section-passport">
        <div className="home-shell home-shell-section">
          <div className="home-section-head home-passport-head">
            <div>
              <p className="home-section-kicker">TRUST INFRASTRUCTURE</p>
              <h2 className="home-section-title">PASSPORT FOR PARTNER APPS</h2>
              <p className="home-passport-subcopy">
                A compact verification layer for apps that need wallet reputation,
                eligibility, and sybil-resistant access without adding signup friction.
              </p>
            </div>
          </div>
          <div className="home-feature-grid home-passport-feature-grid">
            {PASSPORT_FEATURES.map((item, index) => (
              <motion.article
                key={item.title}
                className="home-feature-card home-passport-feature-card"
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.35, delay: index * 0.06, ease: "easeOut" }}
                whileHover={reduceMotion ? undefined : { y: -4 }}
              >
                <p>{item.label}</p>
                <h3>{item.title}</h3>
                <span>{item.copy}</span>
              </motion.article>
            ))}
          </div>

          <motion.div
            className="home-integration-note home-passport-integration"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <h3>HOW OTHER WEBSITES INTEGRATE</h3>
            <ol>
              {INTEGRATION_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </motion.div>
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-shell home-footer-shell">
          <div>
            <p className="home-preview-title home-wordmark">
              <span className="home-wordmark-egg">PASS</span>
              <span className="home-wordmark-rest">CHICK</span>
            </p>
            <h3 className="home-footer-title">
              Skill-based arcade progression with Celo-native player identity.
            </h3>
          </div>

          <div className="home-footer-links">
            <Link href="/play">PLAY</Link>
            <Link href="/managemoney">MANAGE MONEY</Link>
            <button type="button" onClick={openGameGuide}>
              GAME GUIDE
            </button>
          </div>
        </div>
      </footer>

      {showTrustPassport ? (
        <div
          className="modal-bg play-passport-modal play-passport-status-modal"
          onClick={() => {
            if (!passportBusy) setShowTrustPassport(false);
          }}
        >
          <div
            className="modal-box play-passport-box play-passport-status-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-passport-status-title"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <button
              className="close-btn"
              type="button"
              aria-label="Close passport status"
              onClick={() => {
                if (!passportBusy) setShowTrustPassport(false);
              }}
              disabled={passportBusy}
            >
              X
            </button>
            <div className="play-passport-status-headline">
              <div>
                <p className="play-passport-kicker">EGGPASS</p>
                <h3
                  id="home-passport-status-title"
                  className="play-passport-title"
                >
                  EGGPASS
                </h3>
              </div>
            </div>

            <div className="play-passport-status-layout">
              <div
                role="button"
                tabIndex={0}
                className={`play-passport-card play-passport-live-card play-passport-tier-card-${passportCurrentTier}`}
                onClick={() => setShowPassportPreview(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setShowPassportPreview(true);
                  }
                }}
                aria-label="Open large passport preview"
              >
                <div className="play-passport-card-fields">
                  <span className="play-passport-card-value play-passport-card-wallet">
                    {shortAddress(passportStatus?.walletAddress || account || "")}
                  </span>
                  <span className="play-passport-card-value play-passport-card-id">
                    {shortAddress(passportStatus?.passportId || "")}
                  </span>
                </div>
              </div>

              <div className="play-passport-summary">
                <div className="play-passport-summary-row">
                  <span>CURRENT TIER</span>
                  <strong>{passportCurrentTierLabel}</strong>
                </div>
                <div className="play-passport-summary-row">
                  <span>NEXT TIER</span>
                  <strong>
                    {passportProgression?.nextTierLabel || "MAX TIER"}
                  </strong>
                </div>
                <div className="play-passport-summary-row">
                  <span>PASS ID</span>
                  <div className="play-passport-pass-id-line">
                    <strong>{shortAddress(passportStatus?.passportId || "")}</strong>
                    <button
                      type="button"
                      className="play-passport-copy-id"
                      onClick={onCopyPassportId}
                      disabled={!passportStatus?.passportId}
                    >
                      {passportCopyLabel}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {passportBenefits ? (
              <div className="play-passport-benefits">
                <div>
                  <span>UNLOCKED ACCESS</span>
                  <div className="play-passport-benefit-list">
                    {passportBenefits.current.length > 0 ? (
                      passportBenefits.current.map((benefit) => (
                        <strong key={benefit}>{benefit}</strong>
                      ))
                    ) : (
                      <strong>Basic Profile</strong>
                    )}
                  </div>
                </div>
                <div>
                  <span>NEXT UNLOCK</span>
                  <div className="play-passport-benefit-list">
                    {passportBenefits.next.length > 0 ? (
                      passportBenefits.next.map((benefit) => (
                        <strong key={benefit}>{benefit}</strong>
                      ))
                    ) : (
                      <strong>Max Tier</strong>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="play-passport-progress-block">
              <div className="play-passport-progress-head">
                <span>{passportProgression?.nextTierLabel || "TOP TIER"}</span>
                <strong>{passportPercent}%</strong>
              </div>
              <div
                className="play-passport-progress-track"
                role="progressbar"
                aria-label="Passport tier progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={passportPercent}
              >
                <span style={{ width: `${passportPercent}%` }} />
              </div>
              <p>
                {passportStatusText ||
                  "Load EggPass status to view your player progress."}
              </p>
            </div>

            {passportStats ? (
              <div className="play-passport-stats-grid">
                <div>
                  <span>CASHOUTS</span>
                  <strong>{passportStats.successfulCashouts}</strong>
                </div>
                <div>
                  <span>BEST HOPS</span>
                  <strong>{passportStats.bestHops}</strong>
                </div>
                <div>
                  <span>CONSISTENCY</span>
                  <strong>{passportStats.consistencyScore}%</strong>
                </div>
              </div>
            ) : null}

            <div className="play-passport-actions">
              <button
                type="button"
                className="play-passport-secondary"
                onClick={() => {
                  void loadTrustPassport(false);
                }}
                disabled={passportBusy}
              >
                REFRESH
              </button>
              <a className="play-passport-cta" href="/play?passport=1">
                OPEN IN PLAY
              </a>
            </div>
          </div>
        </div>
      ) : null}

      {showPassportPreview ? (
        <div
          className="modal-bg play-passport-modal play-passport-preview-modal"
          onClick={() => setShowPassportPreview(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Large passport preview"
        >
          <div
            className={`play-passport-card play-passport-preview-card play-passport-tier-card-${passportCurrentTier}`}
          >
            <div className="play-passport-card-fields">
              <span className="play-passport-card-value play-passport-card-wallet">
                {shortAddress(passportStatus?.walletAddress || account || "")}
              </span>
              <span className="play-passport-card-value play-passport-card-id">
                {shortAddress(passportStatus?.passportId || "")}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {showHelp && (
        <div className="home-modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="home-modal-box" onClick={(e) => e.stopPropagation()}>
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
                  <p className="step-title">FUND YOUR RUN</p>
                  <p>
                    Open Manage Money, claim faucet if needed, then deposit
                    USDC to your vault. Your vault balance is what you use to
                    start live runs.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <div>
                  <p className="step-title">SURVIVE AND STACK</p>
                  <p>
                    In each run, move lane by lane and avoid traffic timing
                    traps. The farther you go, the more pressure you face, but
                    your potential multiplier keeps improving.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <div>
                  <p className="step-title">CASH OUT SMART</p>
                  <p>
                    Checkpoints are your decision moments: secure profit now or
                    risk another push for a bigger payout. Discipline matters
                    more than greed if you want long-term growth.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">4</span>
                <div>
                  <p className="step-title">BUILD YOUR PASSPORT</p>
                  <p>
                    Consistent checkpoint cashouts improve your Passport tier.
                    Higher tiers can unlock better events, better access, and
                    stronger trust perks across partner experiences.
                  </p>
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
      )}

      {showPassportInfo && (
        <div
          className="home-modal-overlay"
          onClick={() => setShowPassportInfo(false)}
        >
          <div className="home-modal-box" onClick={(e) => e.stopPropagation()}>
            <button
              className="home-modal-close"
              type="button"
              onClick={() => setShowPassportInfo(false)}
            >
              X
            </button>
            <h2>WHAT IS PASSPORT</h2>
            <div className="home-help-content">
              <div className="help-step">
                <span className="step-num">1</span>
                <div>
                  <p className="step-title">WHAT IS A PASSPORT?</p>
                  <p>
                    A Passport is your reputation card in PassChick. It
                    grows from how you play: how consistently you survive, how
                    often you cash out with discipline, and how stable your
                    performance is across runs.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">2</span>
                <div>
                  <p className="step-title">WHY DO PLAYERS NEED IT?</p>
                  <p>
                    Your Passport makes your progress meaningful beyond a single
                    score. A higher tier shows that you are a real, active
                    player with a strong gameplay track record.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">3</span>
                <div>
                  <p className="step-title">WHAT YOU GET FROM IT</p>
                  <p>
                    Your Passport can unlock tiered benefits: access to
                    ranked/tournament events, allowlist priority, partner
                    rewards, and community campaigns that require verified
                    players.
                  </p>
                </div>
              </div>
              <div className="help-step">
                <span className="step-num">4</span>
                <div>
                  <p className="step-title">HOW TO LEVEL IT UP</p>
                  <p>
                    Play clean and consistent: reach checkpoints, cash out at
                    the right moments, and repeat that performance over time.
                    The more disciplined your playstyle is, the faster your
                    Passport tier increases.
                  </p>
                </div>
              </div>
            </div>
            <button
              className="flow-btn secondary info-modal-action"
              type="button"
              onClick={() => setShowPassportInfo(false)}
            >
              GOT IT
            </button>
          </div>
        </div>
      )}

      {showGameGuide && activeGuide ? (
        <div
          className="home-modal-overlay"
          onClick={closeGameGuide}
          role="presentation"
        >
          <div
            className="home-modal-box home-guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="home-modal-close"
              type="button"
              onClick={closeGameGuide}
              aria-label="Close game guide"
            >
              <X size={16} strokeWidth={3} aria-hidden="true" />
            </button>
            <div className="home-guide-kicker">
              {activeGuideSlide + 1} / {GAME_GUIDE_SLIDES.length}
            </div>
            <div className={`home-guide-art home-guide-art-${activeGuide.tone}`}>
              {loadingGuideImages[activeGuide.imageSrc] &&
              !failedGuideImages[activeGuide.imageSrc] ? (
                <div className="home-guide-loading" aria-hidden="true">
                  <div className="home-guide-spinner" />
                  <span>LOADING GUIDE...</span>
                </div>
              ) : null}
              {!failedGuideImages[activeGuide.imageSrc] ? (
                <img
                  src={activeGuide.imageSrc}
                  alt={activeGuide.imageAlt}
                  onLoad={() => markGuideImageLoaded(activeGuide.imageSrc)}
                  onError={() => markGuideImageFailed(activeGuide.imageSrc)}
                  style={{
                    opacity: loadingGuideImages[activeGuide.imageSrc] ? 0 : 1,
                  }}
                />
              ) : null}
              {failedGuideImages[activeGuide.imageSrc] ? (
                <div className="home-guide-fallback" aria-hidden="true">
                  <span className="home-guide-track" />
                  <span className="home-guide-checkpoint" />
                  <span className="home-guide-egg home-guide-egg-one" />
                  <span className="home-guide-egg home-guide-egg-two" />
                  <span className="home-guide-egg home-guide-egg-three" />
                  <span className="home-guide-pass-card home-guide-pass-one" />
                  <span className="home-guide-pass-card home-guide-pass-two" />
                  <span className="home-guide-pass-card home-guide-pass-three" />
                  <span className="home-guide-chicken" />
                </div>
              ) : null}
              {activeGuideSlide > 0 ? (
                <button
                  className="home-guide-nav-btn home-guide-nav-btn-prev"
                  type="button"
                  onClick={goToPreviousGuideSlide}
                  aria-label="Previous guide slide"
                >
                  <ChevronLeft size={18} strokeWidth={3} aria-hidden="true" />
                </button>
              ) : null}
              {!isLastGuideSlide ? (
                <button
                  className="home-guide-nav-btn home-guide-nav-btn-next"
                  type="button"
                  onClick={goToNextGuideSlide}
                  aria-label="Next guide slide"
                >
                  <ChevronRight size={18} strokeWidth={3} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <h2 id="home-guide-title">{activeGuide.title}</h2>
            <p className="home-guide-copy">{activeGuide.copy}</p>
            {activeGuide.note ? (
              <p className="home-guide-note">{activeGuide.note}</p>
            ) : null}
            <div className="home-guide-dots" aria-label="Game guide slides">
              {GAME_GUIDE_SLIDES.map((slide, index) => (
                <button
                  key={slide.title}
                  type="button"
                  className={index === activeGuideSlide ? "active" : ""}
                  onClick={() => {
                    const s = GAME_GUIDE_SLIDES[index];
                    if (s) {
                      setLoadingGuideImages((prev) => ({
                        ...prev,
                        [s.imageSrc]: true,
                      }));
                    }
                    setActiveGuideSlide(index);
                  }}
                  aria-label={`Open ${slide.title}`}
                  aria-current={index === activeGuideSlide ? "step" : undefined}
                />
              ))}
            </div>
            <div className="home-guide-actions">
              {isLastGuideSlide ? (
                isConnected ? (
                  <Link
                    href="/play"
                    className="flow-btn secondary info-modal-action home-guide-cta"
                    onClick={closeGameGuide}
                  >
                    START PLAYING
                  </Link>
                ) : (
                  <button
                    className="flow-btn secondary info-modal-action home-guide-cta"
                    type="button"
                    onClick={() => {
                      closeGameGuide();
                      void connectWallet();
                    }}
                  >
                    CONNECT WALLET
                  </button>
                )
              ) : (
                <button
                  className="flow-btn secondary info-modal-action home-guide-cta"
                  type="button"
                  onClick={goToNextGuideSlide}
                >
                  NEXT
                </button>
              )}
            </div>
            {isLastGuideSlide ? (
              <button
                type="button"
                className="home-guide-passport-link"
                onClick={openPassportFromGuide}
              >
                VIEW PASSPORT
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="home-help-stack" aria-label="Quick help links">
        <a
          className="home-help-btn fixed-help home-help-doc-btn"
          href="https://passchick.gitbook.io/passchick"
          target="_blank"
          rel="noreferrer"
          title="Open Documentation"
          aria-label="Open documentation"
        >
          <svg
            className="home-help-doc-icon"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M8 3h6l4 4v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 3v4h4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 12h6M10 16h6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </a>
      </div>
    </main>
  );
}

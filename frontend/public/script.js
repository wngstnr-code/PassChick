import * as THREE from "https://esm.sh/three";

const minTileIndex = -8;
const maxTileIndex = 8;
const tilesPerRow = maxTileIndex - minTileIndex + 1;
const tileSize = 42;
const MAX_CONSECUTIVE_ROAD_ROWS = 4;
const MAX_CONSECUTIVE_RIVER_ROWS = 3;
const RIVER_SEGMENT_START_CHANCE = 0.2;
const RIVER_SEGMENT_COOLDOWN_ROWS = 5;
const RIVER_SAFE_START_ROW = 6;
const RIVER_CHECKPOINT_BUFFER_ROWS = 2;
const TRAIN_SPAWN_MIN_MS = 4000;
const TRAIN_SPAWN_MAX_MS = 6000;
const TRAIN_COOLDOWN_ROWS = 2;
const TRAIN_CHECKPOINT_BUFFER_ROWS = 6;
const TRAIN_LOOP_GAP_MIN_MS = 3000;
const TRAIN_LOOP_GAP_MAX_MS = 5000;
let pendingRoadRowsInSegment = 0;
let pendingRiverRowsInSegment = 0;
let consecutiveRoadRows = 0;
let consecutiveRiverRows = 0;
let riverCooldownRows = 0;
let lastRiverPlatformOffset = null;
let currentRiverSegmentStartDirection = null;
let currentRiverSegmentLineIndex = 0;
let nextTrainRowAtMs = 0;
let trainCooldownRows = 0;

const STEP_INCREMENT_BP = 250;
const CP_BONUS_NUM = 12;
const CP_BONUS_DEN = 10;
const CP_INTERVAL = 40;
const SEGMENT_TIME_MS = 60 * 1000;
const CP_MAX_STAY_MS = 60 * 1000;
const DECAY_BP_PER_SEC = 1000;
const SPEED_MULT_PER_CP = 1.1;
const MAX_MOVE_QUEUE = 8;
const DEFAULT_STAKE = 0.0001;
const MIN_STAKE = 0.0001;
const MAX_STAKE = 100;

const bet = {
  balance: 0,
  active: false,
  stake: 0,
  multiplierBp: 0,
  decayCarryBp: 0,
  maxRow: 0,
  currentCp: 0,
  cashoutWindow: false,
  cpEnterTime: 0,
  cpRowIndex: 0,
  cpStayRemainingMs: 0,
  segmentActive: false,
  segmentStart: 0,
  lastDecayTick: 0,
  isDecaying: false,
  reconnecting: false,

  timerInterval: null,
};

let gameOver = false;
let settlementPending = false;
let lastLiveBetStatusMessage = "";
let audioCtx = null;
let audioUnlocked = false;
let lastStepSfxAt = 0;
let lastCrashSfxAt = 0;
let lastCheckpointSfxAt = 0;
let lastUiSfxAt = 0;
let lastPanelSfxAt = 0;
let wasCashoutAvailable = false;
let lastHornSfxAt = 0;
let lastTrainSfxAt = 0;
let lastSplashSfxAt = 0;
const SFX_STORAGE_KEY = "chickenSfxVolume";
const CHARACTER_STORAGE_KEY = "passchickCharacter";
const SFX_MASTER_GAIN = 2.8;
let sfxVolume = 0.9;

function ensureAudioContext() {
  if (audioCtx) return audioCtx;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  audioCtx = new AudioContextClass();
  return audioCtx;
}

function clampSfxVolume(value) {
  const num = Number(value);
  if (!isFinite(num)) return 0.9;
  return Math.min(1, Math.max(0, num));
}

function readStoredSfxVolume() {
  try {
    const raw = localStorage.getItem(SFX_STORAGE_KEY);
    if (raw == null || raw === "") return 0.9;
    return clampSfxVolume(parseFloat(raw));
  } catch (_error) {
    return 0.9;
  }
}

function writeStoredSfxVolume(value) {
  try {
    localStorage.setItem(SFX_STORAGE_KEY, String(clampSfxVolume(value)));
  } catch (_error) {
  }
}

function applySfxVolume(value) {
  sfxVolume = clampSfxVolume(value);
  writeStoredSfxVolume(sfxVolume);
}

async function unlockAudio() {
  if (audioUnlocked) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (_error) {
      return;
    }
  }
  audioUnlocked = ctx.state === "running";
}

function playTone({
  frequency = 440,
  durationMs = 120,
  type = "sine",
  volume = 0.02,
  frequencyEnd = null,
  pan = 0,
  attackMs = 8,
  releaseMs = 80,
  detune = 0,
} = {}) {
  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const now = ctx.currentTime;
  const durationSec = Math.max(0.02, durationMs / 1000);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const targetVolume = Math.min(
    0.5,
    Math.max(0.0001, volume * SFX_MASTER_GAIN * sfxVolume),
  );

  const attack = Math.max(0.004, Math.min(0.08, attackMs / 1000));
  const release = Math.max(0.01, Math.min(0.3, releaseMs / 1000));
  const sustain = Math.max(0, durationSec - attack - release);
  const safePan = Math.max(-1, Math.min(1, Number(pan) || 0));

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (isFinite(detune) && detune !== 0) {
    osc.detune.setValueAtTime(detune, now);
  }
  if (isFinite(frequencyEnd) && frequencyEnd > 0) {
    osc.frequency.exponentialRampToValueAtTime(frequencyEnd, now + durationSec);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(targetVolume, now + attack);
  gain.gain.setValueAtTime(targetVolume, now + attack + sustain);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    now + attack + sustain + release,
  );

  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(safePan, now);
    osc.connect(panner);
    panner.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.01);
}

function playNoise({
  durationMs = 120,
  volume = 0.02,
  pan = 0,
  filterType = "highpass",
  filterFreqStart = 800,
  filterFreqEnd = 1200,
} = {}) {
  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const now = ctx.currentTime;
  const durationSec = Math.max(0.02, durationMs / 1000);
  const buffer = ctx.createBuffer(1, ctx.sampleRate * durationSec, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterFreqStart, now);
  if (isFinite(filterFreqEnd) && filterFreqEnd > 0) {
    filter.frequency.exponentialRampToValueAtTime(
      filterFreqEnd,
      now + durationSec,
    );
  }

  const gain = ctx.createGain();
  const targetVolume = Math.min(
    0.5,
    Math.max(0.0001, volume * SFX_MASTER_GAIN * sfxVolume),
  );
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(targetVolume, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), now);
    source.connect(filter);
    filter.connect(panner);
    panner.connect(gain);
  } else {
    source.connect(filter);
    filter.connect(gain);
  }

  gain.connect(ctx.destination);
  source.start(now);
  source.stop(now + durationSec + 0.01);
}

function playStepSfx() {
  const now = Date.now();
  if (now - lastStepSfxAt < 90) return;
  lastStepSfxAt = now;
  const jitter = Math.random() * 18;
  const pan = (Math.random() - 0.5) * 0.2;
  playTone({
    frequency: 420 + jitter,
    frequencyEnd: 560 + jitter * 0.2,
    durationMs: 60,
    type: "triangle",
    volume: 0.032,
    pan,
    attackMs: 4,
    releaseMs: 50,
  });
  playTone({
    frequency: 640 + jitter,
    frequencyEnd: 480 + jitter * 0.2,
    durationMs: 45,
    type: "square",
    volume: 0.014,
    pan: -pan,
    attackMs: 3,
    releaseMs: 35,
  });
  playNoise({
    durationMs: 35,
    volume: 0.01,
    pan,
    filterType: "bandpass",
    filterFreqStart: 900,
    filterFreqEnd: 520,
  });
}

function playCrashSfx() {
  const nowMs = Date.now();
  if (nowMs - lastCrashSfxAt < 550) return;
  lastCrashSfxAt = nowMs;
  void unlockAudio();

  playTone({
    frequency: 1300,
    frequencyEnd: 420,
    durationMs: 140,
    type: "square",
    volume: 0.26,
    attackMs: 4,
    releaseMs: 140,
  });
  playTone({
    frequency: 820,
    frequencyEnd: 160,
    durationMs: 460,
    type: "triangle",
    volume: 0.2,
    attackMs: 6,
    releaseMs: 240,
  });
  playTone({
    frequency: 120,
    frequencyEnd: 70,
    durationMs: 420,
    type: "sawtooth",
    volume: 0.12,
    attackMs: 6,
    releaseMs: 260,
  });
  playNoise({
    durationMs: 160,
    volume: 0.12,
    filterType: "bandpass",
    filterFreqStart: 800,
    filterFreqEnd: 400,
  });
}

function playHornSfx() {
  const nowMs = Date.now();
  if (nowMs - lastHornSfxAt < 1200) return;
  lastHornSfxAt = nowMs;
  playTone({
    frequency: 520,
    frequencyEnd: 420,
    durationMs: 160,
    type: "square",
    volume: 0.05,
    attackMs: 10,
    releaseMs: 90,
  });
  playTone({
    frequency: 340,
    frequencyEnd: 280,
    durationMs: 200,
    type: "sawtooth",
    volume: 0.04,
    attackMs: 12,
    releaseMs: 110,
  });
}

function playTrainPassSfx() {
  const nowMs = Date.now();
  if (nowMs - lastTrainSfxAt < 1800) return;
  lastTrainSfxAt = nowMs;
  playNoise({
    durationMs: 260,
    volume: 0.08,
    filterType: "lowpass",
    filterFreqStart: 900,
    filterFreqEnd: 400,
  });
  playTone({
    frequency: 180,
    frequencyEnd: 120,
    durationMs: 280,
    type: "triangle",
    volume: 0.06,
    attackMs: 12,
    releaseMs: 180,
  });
}

function playSplashSfx() {
  const nowMs = Date.now();
  if (nowMs - lastSplashSfxAt < 600) return;
  lastSplashSfxAt = nowMs;
  playNoise({
    durationMs: 200,
    volume: 0.08,
    filterType: "bandpass",
    filterFreqStart: 1200,
    filterFreqEnd: 500,
  });
  playTone({
    frequency: 420,
    frequencyEnd: 220,
    durationMs: 160,
    type: "triangle",
    volume: 0.035,
    attackMs: 6,
    releaseMs: 120,
  });
}

function playStartBetSfx() {
  void unlockAudio();
  playTone({
    frequency: 560,
    frequencyEnd: 760,
    durationMs: 110,
    type: "square",
    volume: 0.07,
    attackMs: 6,
    releaseMs: 80,
  });
  playTone({
    frequency: 900,
    frequencyEnd: 1200,
    durationMs: 90,
    type: "triangle",
    volume: 0.04,
    pan: 0.1,
    attackMs: 4,
    releaseMs: 70,
  });
}

function playCheckpointSfx() {
  const nowMs = Date.now();
  if (nowMs - lastCheckpointSfxAt < 500) return;
  lastCheckpointSfxAt = nowMs;
  void unlockAudio();

  const ctx = ensureAudioContext();
  if (!ctx || !audioUnlocked) return;

  const now = ctx.currentTime;
  const notes = [660, 820, 980];
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const start = now + index * 0.06;
    const end = start + 0.13;
    const target = Math.min(0.5, 0.07 * SFX_MASTER_GAIN * sfxVolume);

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, target),
      start + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    if (panner) {
      panner.pan.setValueAtTime(index === 1 ? 0 : index === 0 ? -0.2 : 0.2, start);
      osc.connect(panner);
      panner.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.01);
  });
  playTone({
    frequency: 1400,
    frequencyEnd: 1800,
    durationMs: 120,
    type: "sine",
    volume: 0.04,
    pan: 0.25,
    attackMs: 6,
    releaseMs: 90,
  });
}

function playCashoutSfx() {
  void unlockAudio();
  playTone({
    frequency: 700,
    frequencyEnd: 980,
    durationMs: 130,
    type: "triangle",
    volume: 0.09,
    attackMs: 6,
    releaseMs: 90,
  });
  playTone({
    frequency: 980,
    frequencyEnd: 1240,
    durationMs: 150,
    type: "triangle",
    volume: 0.07,
    attackMs: 6,
    releaseMs: 110,
  });
  playTone({
    frequency: 1600,
    frequencyEnd: 1200,
    durationMs: 100,
    type: "square",
    volume: 0.04,
    pan: 0.2,
    attackMs: 4,
    releaseMs: 70,
  });
}

function playCashoutReadySfx() {
  void unlockAudio();
  playTone({
    frequency: 520,
    frequencyEnd: 720,
    durationMs: 90,
    type: "triangle",
    volume: 0.05,
    attackMs: 6,
    releaseMs: 70,
  });
}

function playUiClickSfx() {
  const now = Date.now();
  if (now - lastUiSfxAt < 70) return;
  lastUiSfxAt = now;
  playTone({
    frequency: 820,
    frequencyEnd: 620,
    durationMs: 55,
    type: "square",
    volume: 0.035,
    pan: (Math.random() - 0.5) * 0.2,
    attackMs: 4,
    releaseMs: 50,
  });
}

function playPanelOpenSfx() {
  const now = Date.now();
  if (now - lastPanelSfxAt < 120) return;
  lastPanelSfxAt = now;
  playTone({
    frequency: 520,
    frequencyEnd: 900,
    durationMs: 140,
    type: "triangle",
    volume: 0.05,
    pan: 0.1,
    attackMs: 8,
    releaseMs: 110,
  });
}

function playPanelCloseSfx() {
  const now = Date.now();
  if (now - lastPanelSfxAt < 120) return;
  lastPanelSfxAt = now;
  playTone({
    frequency: 520,
    frequencyEnd: 320,
    durationMs: 120,
    type: "triangle",
    volume: 0.05,
    pan: -0.1,
    attackMs: 6,
    releaseMs: 90,
  });
}

function playDeniedSfx() {
  const now = Date.now();
  if (now - lastUiSfxAt < 120) return;
  lastUiSfxAt = now;
  playTone({
    frequency: 260,
    frequencyEnd: 200,
    durationMs: 90,
    type: "square",
    volume: 0.045,
    attackMs: 6,
    releaseMs: 70,
  });
  playNoise({
    durationMs: 80,
    volume: 0.03,
    filterType: "highpass",
    filterFreqStart: 900,
    filterFreqEnd: 1200,
  });
}

function setupAudioUnlock() {
  const unlockOnce = () => {
    void unlockAudio();
    window.removeEventListener("pointerdown", unlockOnce);
    window.removeEventListener("touchstart", unlockOnce);
    window.removeEventListener("keydown", unlockOnce);
  };
  window.addEventListener("pointerdown", unlockOnce, { passive: true });
  window.addEventListener("touchstart", unlockOnce, { passive: true });
  window.addEventListener("keydown", unlockOnce);
}

function setupSfxVolumeSync() {
  applySfxVolume(readStoredSfxVolume());
  window.addEventListener("chicken:set-sfx-volume", (event) => {
    const detail = (event && event.detail) || {};
    applySfxVolume(detail.value);
  });
}

setupAudioUnlock();
setupSfxVolumeSync();

let liveBalanceSyncInterval = null;

function startLiveBalanceSync() {
  if (liveBalanceSyncInterval) return;
  liveBalanceSyncInterval = setInterval(() => {
    if (!hasLiveBridge()) return;
    void loadBalance();
  }, 1500);
}

function getBridge() {
  return window.__CHICKEN_GAME_BRIDGE__;
}

function hasLiveBridge() {
  const bridge = getBridge();
  return Boolean(bridge && !bridge.backgroundMode);
}

async function loadBalance() {
  if (hasLiveBridge()) {
    try {
      bet.balance = await getBridge().loadAvailableBalance();
      renderBalance();
      return;
    } catch (error) {
      console.error("Failed to load live balance:", error);
      renderBalance();
      return;
    }
  }

  const saved = localStorage.getItem("chickenBetBalance");
  bet.balance = saved ? parseFloat(saved) : 0;
  renderBalance();
}

function saveBalance() {
  if (hasLiveBridge()) return;
  localStorage.setItem("chickenBetBalance", bet.balance.toFixed(6));
}

function formatUsdAmount(amount) {
  const value = Number(amount || 0);
  return "$" + value.toFixed(5);
}

function normalizeStakeInput(value, fallback = DEFAULT_STAKE) {
  const parsed = Number(value);
  if (!isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(6));
}

function isValidStakeAmount(stake) {
  return isFinite(stake) && stake >= MIN_STAKE && stake <= MAX_STAKE;
}

function formatSignedUsdAmount(amount) {
  const value = Number(amount || 0);
  const sign = value < 0 ? "-" : "";
  return `${sign}${formatUsdAmount(Math.abs(value))}`;
}

function renderBalance() {
  const formatted = formatUsdAmount(bet.balance);
  const mainBalance = document.getElementById("balance");
  if (mainBalance) mainBalance.innerText = formatted;
  const mobileBalance = document.getElementById("balance-mobile");
  if (mobileBalance) mobileBalance.innerText = formatted;
}

function dispatchPlayStatus({
  message = "",
  tone = "info",
  sticky = false,
  clear = false,
  durationMs,
} = {}) {
  window.dispatchEvent(
    new CustomEvent("chicken:play-status", {
      detail: { message, tone, sticky, clear, durationMs },
    }),
  );
}

let liveBetNavUrgent = false;

function syncLiveBetNavState(timerRemainingMs) {
  if (!document.body) return;

  const live = Boolean(bet.active && !bet.reconnecting);
  if (typeof timerRemainingMs === "number" && isFinite(timerRemainingMs)) {
    liveBetNavUrgent = live && timerRemainingMs <= 10000;
  } else if (!live) {
    liveBetNavUrgent = false;
  }

  document.body.classList.toggle("chicken-bet-live", live);
  document.body.classList.toggle(
    "chicken-bet-live-urgent",
    live && liveBetNavUrgent,
  );
}

function syncLiveBetStatus() {
  if (!bet.active || settlementPending || bet.reconnecting) {
    lastLiveBetStatusMessage = "";
    return;
  }

  const mult = bet.multiplierBp / 10000;
  const payout = bet.stake * mult;
  const message = `LIVE RUN ${formatUsdAmount(bet.stake)} • ${mult.toFixed(
    2,
  )}x • ${formatUsdAmount(payout)} • CP ${bet.currentCp}`;

  if (message === lastLiveBetStatusMessage) return;
  lastLiveBetStatusMessage = message;
  dispatchPlayStatus({
    message,
    tone: "ready",
    sticky: true,
  });
}

function formatBridgeError(error, fallback, userRejectedMessage) {
  const rawMessage =
    typeof error === "string"
      ? String(error || "").trim()
      : error && typeof error === "object" && "message" in error
        ? String(error.message || "").trim()
        : "";

  const message = rawMessage || fallback;
  const lower = message.toLowerCase();

  if (isUserRejectedBridgeError(error)) {
    return userRejectedMessage || "Request was canceled in wallet.";
  }

  if (
    lower.includes("already pending") ||
    lower.includes("pending request") ||
    lower.includes("request of type") ||
    lower.includes("user is already processing")
  ) {
    return "There is still a pending wallet request.";
  }

  if (
    lower.includes("insufficient funds") ||
    lower.includes("needs sol for network fees") ||
    lower.includes("no record of a prior credit") ||
    lower.includes("insufficient lamports") ||
    lower.includes("gas required exceeds allowance") ||
    lower.includes("intrinsic gas too low") ||
    lower.includes("exceeds allowance")
  ) {
    return "Wallet needs CELO for network fees before starting a bet.";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network error") ||
    lower.includes("network request failed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("disconnected") ||
    lower.includes("socket hang up") ||
    lower.includes("rpc")
  ) {
    return "Wallet or RPC connection is unstable. Please try again.";
  }

  let simplified = message.split(/\r?\n/)[0]?.trim() || "";
  [
    "Details:",
    "Request Arguments:",
    "Request body:",
    "URL:",
    "Version:",
  ].forEach((marker) => {
    const index = simplified.indexOf(marker);
    if (index >= 0) {
      simplified = simplified.slice(0, index).trim();
    }
  });
  simplified = simplified.replace(/^execution reverted:?\s*/i, "").trim();

  if (!simplified) return fallback;
  if (simplified.length > 140) return fallback;
  if (
    simplified.toLowerCase().includes("details:") ||
    simplified.toLowerCase().includes("request arguments:") ||
    simplified.toLowerCase().includes("version:")
  ) {
    return fallback;
  }

  return simplified;
}

function isUserRejectedBridgeError(error) {
  const message =
    typeof error === "string"
      ? String(error || "").toLowerCase()
      : error && typeof error === "object" && "message" in error
        ? String(error.message || "").toLowerCase()
        : "";
  return (
    message.includes("userrejectedrequesterror") ||
    message.includes("user rejected") ||
    message.includes("rejected the request") ||
    message.includes("user denied") ||
    message.includes("rejected by user")
  );
}

function setDepositButtonState(label = "DEPOSIT", busy = false) {
  window.dispatchEvent(
    new CustomEvent("chicken:deposit-ui-state", {
      detail: { label, busy },
    }),
  );
}

function setBetButtonState() {
  syncLiveBetNavState();

  const betBtn = document.getElementById("bet-btn");
  if (!betBtn) return;

  if (settlementPending) {
    betBtn.innerText = "SETTLING...";
    betBtn.classList.add("busy");
    betBtn.classList.remove("active");
    betBtn.disabled = true;
    return;
  }

  if (bet.reconnecting) {
    betBtn.innerText = "RECONNECTING...";
    betBtn.classList.add("busy");
    betBtn.classList.remove("active");
    betBtn.disabled = true;
    return;
  }

  if (bet.active) {
    betBtn.innerText = "RUN LIVE";
    betBtn.classList.add("active");
    betBtn.classList.remove("busy");
    betBtn.disabled = false;
    return;
  }

  betBtn.innerText = "PLAY";
  betBtn.classList.remove("active");
  betBtn.classList.remove("busy");
  betBtn.disabled = false;
}

function deposit(amount) {
  if (!isFinite(amount) || amount <= 0) return false;
  if (hasLiveBridge()) return false;
  bet.balance += amount;
  saveBalance();
  renderBalance();
  return true;
}

function activateBet(stake, availableBalance) {
  if (isFinite(availableBalance)) {
    bet.balance = availableBalance;
    renderBalance();
  }

  settlementPending = false;
  if (!isFinite(stake) || stake <= 0) return false;

  bet.active = true;
  bet.stake = stake;
  bet.multiplierBp = 0;
  bet.decayCarryBp = 0;
  bet.maxRow = 0;
  bet.currentCp = 0;
  bet.cashoutWindow = false;
  bet.cpEnterTime = 0;
  bet.cpRowIndex = 0;
  bet.cpStayRemainingMs = 0;
  bet.segmentActive = true;
  bet.segmentStart = Date.now();
  bet.lastDecayTick = Date.now();
  bet.isDecaying = false;
  bet.reconnecting = false;

  startBetTicker();
  renderBetHud();
  showBetHud(true);
  showBetPanel(false);
  hideResult();
  setBetButtonState();
  dispatchPlayStatus({ clear: true });
  lastLiveBetStatusMessage = "";

  initializeGame();
  playStartBetSfx();
  return true;
}

function calculateRowMultiplierBp(rowIndex) {
  let multiplierBp = 0;
  const safeRowIndex = Math.max(0, Math.floor(Number(rowIndex) || 0));

  for (let step = 1; step <= safeRowIndex; step += 1) {
    multiplierBp += STEP_INCREMENT_BP;
    if (step % CP_INTERVAL === 0) {
      multiplierBp = Math.floor((multiplierBp * CP_BONUS_NUM) / CP_BONUS_DEN);
    }
  }

  return multiplierBp;
}

function getCurrentDecayPenaltyBp(now = Date.now()) {
  if (!bet.active || bet.cashoutWindow || !bet.segmentActive) {
    return 0;
  }

  const elapsed = now - bet.segmentStart;
  const overtime = elapsed - SEGMENT_TIME_MS;
  if (overtime <= 0) {
    return 0;
  }

  return Math.floor((DECAY_BP_PER_SEC * overtime) / 1000);
}

function getCurrentEffectiveMultiplierBp(now = Date.now()) {
  if (bet.cashoutWindow && !bet.segmentActive) {
    return Math.max(0, bet.multiplierBp);
  }

  const baseMultiplierBp = calculateRowMultiplierBp(position.currentRow);
  return Math.max(
    0,
    baseMultiplierBp - bet.decayCarryBp - getCurrentDecayPenaltyBp(now),
  );
}

async function startBet(stake) {
  const effectiveStake = normalizeStakeInput(stake, DEFAULT_STAKE);

  if (hasLiveBridge()) {
    try {
      const result = await getBridge().startBet(effectiveStake);
      return activateBet(effectiveStake, result.availableBalance);
    } catch (error) {
      const message = formatBridgeError(
        error,
        "Failed to start live bet.",
        "Start bet was canceled in wallet.",
      );
      console.warn("Failed to start live bet:", message);
      window.dispatchEvent(
        new CustomEvent("chicken:game-error", { detail: { message } }),
      );
      void loadBalance();
      return false;
    }
  }

  if (effectiveStake > bet.balance) return false;

  bet.balance -= effectiveStake;
  saveBalance();
  renderBalance();
  return activateBet(effectiveStake, bet.balance);
}

function onPlayerAdvance(newRowIndex) {
  if (!bet.active) return;
  if (newRowIndex > 0 && newRowIndex % CP_INTERVAL === 0) {
    reachCheckpoint(newRowIndex);
  } else {
    if (bet.cashoutWindow && newRowIndex > bet.cpRowIndex) {
      closeCashoutWindow();
    }
  }

  renderBetHud();
}

function reachCheckpoint(rowIndex) {
  playCheckpointSfx();
  showCheckpointArrivalCue();
  const lockedMultiplierBp = getCurrentEffectiveMultiplierBp();
  bet.currentCp += 1;
  bet.cpRowIndex = rowIndex;
  bet.multiplierBp = lockedMultiplierBp;
  bet.decayCarryBp = Math.max(
    0,
    calculateRowMultiplierBp(rowIndex) - lockedMultiplierBp,
  );
  bet.cashoutWindow = true;
  bet.cpEnterTime = Date.now();
  bet.segmentActive = false;

  renderBetHud();
}

function showCheckpointArrivalCue() {
  document.body?.classList.add("checkpoint-arrival");
  window.setTimeout(() => {
    document.body?.classList.remove("checkpoint-arrival");
  }, 850);
  window.dispatchEvent(
    new CustomEvent("chicken:play-status", {
      detail: {
        message: "CHECKPOINT REACHED",
        tone: "ready",
        durationMs: 2400,
      },
    }),
  );
}

function closeCashoutWindow() {
  bet.cashoutWindow = false;
  bet.cpStayRemainingMs = 0;
  bet.segmentActive = true;
  bet.segmentStart = Date.now();
  bet.lastDecayTick = Date.now();
}

function hasCpStayTimeRemaining(now = Date.now()) {
  if (!bet.cashoutWindow || !bet.cpEnterTime) return false;
  return Math.max(0, CP_MAX_STAY_MS - (now - bet.cpEnterTime)) > 0;
}

function canCashOut() {
  return (
    bet.active &&
    bet.cashoutWindow &&
    hasCpStayTimeRemaining() &&
    !bet.reconnecting
  );
}

async function cashOut(reason) {
  if (!bet.active) return;
  if (!canCashOut()) return;
  if (settlementPending) return;

  if (hasLiveBridge()) {
    settlementPending = true;
    setBetButtonState();
    let keepStatusMessage = false;
    dispatchPlayStatus({
      message: "SETTLING CASH OUT...",
      tone: "busy",
      sticky: true,
    });
    try {
      const result = await getBridge().cashOut();
      bet.active = false;
      stopBetTicker();
      bet.balance = result.availableBalance;
      renderBalance();
      showBetHud(false);
      showResult({
        type: "cashout",
        reason: reason || "manual",
        stake: bet.stake,
        multiplier: result.multiplier,
        payout: result.payoutAmount,
        profit: result.profit,
        rows: bet.maxRow,
        cp: bet.currentCp,
      });
    } catch (error) {
      console.error("Failed to settle cashout:", error);
      bet.active = false;
      bet.cashoutWindow = false;
      bet.segmentActive = false;
      stopBetTicker();
      showBetHud(false);
      showBetPanel(true);
      const fallbackMessage = isUserRejectedBridgeError(error)
        ? "Cash out was canceled in wallet. Resolve pending settlement, then start playing again."
        : "Failed to settle cashout.";
      const message = formatBridgeError(
        error,
        fallbackMessage,
        "Cash out was canceled in wallet.",
      );
      keepStatusMessage = true;
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      alert(message);
    } finally {
      settlementPending = false;
      setBetButtonState();
      if (!keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
      void loadBalance();
    }
    return;
  }

  const mult = getCurrentEffectiveMultiplierBp() / 10000;
  bet.active = false;
  stopBetTicker();
  setBetButtonState();

  const payout = bet.stake * mult;
  const profit = payout - bet.stake;
  bet.balance += payout;
  saveBalance();
  renderBalance();

  showBetHud(false);
  showResult({
    type: "cashout",
    reason: reason || "manual",
    stake: bet.stake,
    multiplier: mult,
    payout,
    profit,
    rows: bet.maxRow,
    cp: bet.currentCp,
  });
}

async function crashBet(reason) {
  if (!bet.active) return;
  if (settlementPending) return;

  playCrashSfx();

  if (hasLiveBridge()) {
    settlementPending = true;
    setBetButtonState();
    let keepStatusMessage = false;
    const mult = getCurrentEffectiveMultiplierBp() / 10000;
    const lostStake = bet.stake;
    bet.active = false;
    stopBetTicker();
    showBetHud(false);
    showResult({
      type: "crash",
      stake: lostStake,
      multiplier: mult,
      payout: 0,
      profit: -lostStake,
      rows: bet.maxRow,
      cp: bet.currentCp,
    });
    dispatchPlayStatus({
      message: "CRASHED. SETTLING...",
      tone: "warning",
      sticky: true,
    });

    try {
      const result = await getBridge().crash(reason || "collision");
      if (result && isFinite(result.availableBalance)) {
        bet.balance = result.availableBalance;
        renderBalance();
      }
      showResult({
        type: "crash",
        stake: lostStake,
        multiplier: result ? result.multiplier : mult,
        payout: 0,
        profit: -lostStake,
        rows: bet.maxRow,
        cp: bet.currentCp,
        silent: true,
      });
    } catch (error) {
      console.error("Failed to settle crash:", error);
      const message = formatBridgeError(
        error,
        "Failed to settle crash.",
        "Run settlement was canceled in wallet.",
      );
      keepStatusMessage = true;
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      alert(message);
    } finally {
      settlementPending = false;
      setBetButtonState();
      if (!keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
      void loadBalance();
    }
    return;
  }

  const mult = getCurrentEffectiveMultiplierBp() / 10000;
  bet.active = false;
  stopBetTicker();
  setBetButtonState();

  showBetHud(false);
  showResult({
    type: "crash",
    stake: bet.stake,
    multiplier: mult,
    payout: 0,
    profit: -bet.stake,
    rows: bet.maxRow,
    cp: bet.currentCp,
  });
}

function startBetTicker() {
  stopBetTicker();
  bet.timerInterval = setInterval(tickBet, 100);
}

function stopBetTicker({ resetTimer = true } = {}) {
  if (bet.timerInterval) {
    clearInterval(bet.timerInterval);
    bet.timerInterval = null;
  }
  if (resetTimer) {
    renderTimer(SEGMENT_TIME_MS, false);
  }
}

function tickBet() {
  if (!bet.active) return;
  const now = Date.now();
  if (bet.cashoutWindow) {
    const stayElapsed = now - bet.cpEnterTime;
    const remaining = Math.max(0, CP_MAX_STAY_MS - stayElapsed);
    renderTimer(remaining, true);
    bet.cpStayRemainingMs = remaining;
    bet.isDecaying = false;
    bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
    renderBetHud();
    if (remaining <= 0) {
      closeCashoutWindow();
      renderBetHud();
    }
  } else if (bet.segmentActive) {
    const segElapsed = now - bet.segmentStart;
    const remaining = Math.max(0, SEGMENT_TIME_MS - segElapsed);
    renderTimer(remaining, false);
    bet.cpStayRemainingMs = 0;
    const decayWasActive = bet.isDecaying;
    const decayPenaltyBp = getCurrentDecayPenaltyBp(now);

    if (decayPenaltyBp > 0) {
      bet.isDecaying = true;
      bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
      bet.lastDecayTick = now;
      renderBetHud();
    } else {
      bet.isDecaying = false;
      bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
      bet.lastDecayTick = now;
      if (decayWasActive) {
        renderBetHud();
      }
    }
  } else {
    bet.isDecaying = false;
    bet.cpStayRemainingMs = 0;
    bet.multiplierBp = getCurrentEffectiveMultiplierBp(now);
  }
}

function renderTimer(ms, atCp) {
  const el = document.getElementById("timer");
  const card = document.getElementById("timer-card");
  const labelEl = document.getElementById("timer-label");
  syncLiveBetNavState(ms);
  if (!el) return;

  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  el.innerText = `${m}:${s.toString().padStart(2, "0")}`;

  if (labelEl) labelEl.innerText = atCp ? "AT CP" : "RUSH";
  if (bet.active && ms <= 10000) {
    el.classList.add("timer-flash");
    el.style.color = "#ffffff";
  } else {
    el.classList.remove("timer-flash");
    el.style.color = "#ffffff";
  }

  if (card) {
    if (ms < 15000 && bet.active) card.classList.add("timer-warning");
    else card.classList.remove("timer-warning");
  }
}

function renderBetHud() {
  const effectiveMultiplierBp = getCurrentEffectiveMultiplierBp();
  const decayPenaltyBp = getCurrentDecayPenaltyBp();
  const isDecayActive =
    bet.active && !bet.reconnecting && !bet.cashoutWindow && decayPenaltyBp > 0;
  const mult = effectiveMultiplierBp / 10000;
  const payout = bet.stake * mult;
  const headKickerEl = document.querySelector(".bet-hud-kicker");
  const headLineEl = document.querySelector(".bet-hud-headline");
  const stakeEl = document.getElementById("bet-stake");
  const multEl = document.getElementById("bet-multiplier");
  const payEl = document.getElementById("bet-payout");
  const scoreCpEl = document.getElementById("score-cp");
  const activeHudEl = document.getElementById("bet-hud-active");
  const idleHudEl = document.getElementById("bet-hud-idle");
  const cashoutBtn = document.getElementById("cash-out-btn");
  const decayRow = document.getElementById("bet-hud-decay");
  const decayValueEl = document.getElementById("bet-decay");

  bet.multiplierBp = effectiveMultiplierBp;
  bet.isDecaying = isDecayActive;

  if (stakeEl) stakeEl.innerText = formatUsdAmount(bet.stake);
  if (multEl) multEl.innerText = mult.toFixed(2) + "x";
  if (payEl) payEl.innerText = formatUsdAmount(payout);
  if (scoreCpEl) {
    scoreCpEl.innerText = String(bet.currentCp);
    const cpColors = ["#f6fbff", "#b9dcf4", "#6fa9cf", "#f7a45a", "#d86c32", "#8fc8e8", "#ffffff"];
    const cpColorIndex = bet.currentCp % cpColors.length;
    scoreCpEl.style.color = cpColors[cpColorIndex];
  }

  if (headKickerEl) {
    headKickerEl.textContent = bet.active ? "Live Bet" : "Run Summary";
  }
  if (headLineEl) {
    if (bet.reconnecting) {
      headLineEl.textContent = "Reconnecting...";
    } else if (!bet.active) {
      headLineEl.textContent = "No active bet";
    } else if (bet.cashoutWindow) {
      headLineEl.textContent = "Checkpoint window open";
    } else if (isDecayActive) {
      headLineEl.textContent = "DECAYING IS ACTIVE";
    } else {
      headLineEl.textContent = "Run in progress";
    }
  }

  if (activeHudEl) {
    activeHudEl.style.display = bet.active ? "block" : "none";
  }
  if (idleHudEl) {
    idleHudEl.style.display = bet.active ? "none" : "block";
  }
  if (decayRow) {
    decayRow.hidden = !isDecayActive;
    decayRow.style.display = isDecayActive ? "flex" : "none";
  }
  if (decayValueEl) {
    decayValueEl.innerText = "-0.1x / sec";
  }

  const isCashoutAvailable = canCashOut();
  if (cashoutBtn) {
    if (!bet.active || bet.reconnecting) {
      cashoutBtn.style.display = "none";
      cashoutBtn.disabled = true;
      cashoutBtn.classList.add("disabled");
      cashoutBtn.innerText = "RECONNECTING...";
    } else if (isCashoutAvailable) {
      cashoutBtn.style.display = "block";
      cashoutBtn.disabled = false;
      cashoutBtn.classList.remove("disabled");
      cashoutBtn.innerText = "CASH OUT";
    } else {
      cashoutBtn.style.display = "none";
      cashoutBtn.disabled = true;
      cashoutBtn.classList.add("disabled");
      cashoutBtn.innerText = "RUN TO NEXT CP";
    }
  }

  if (!bet.active) {
    wasCashoutAvailable = false;
  } else if (isCashoutAvailable && !wasCashoutAvailable) {
    playCashoutReadySfx();
    wasCashoutAvailable = true;
  } else if (!isCashoutAvailable) {
    wasCashoutAvailable = false;
  }

  syncLiveBetStatus();
}

function showBetPanel(show) {
  const el = document.getElementById("bet-panel");
  if (el) {
    const wasVisible = el.style.display !== "none";
    if (show !== wasVisible) {
      if (show) playPanelOpenSfx();
      else playPanelCloseSfx();
    }
    el.style.display = show ? "flex" : "none";
  }
}

function showBetHud(show) {
  const el = document.getElementById("bet-hud");
  if (el) el.style.display = "block";
  renderBetHud();
}

function syncPlayerToGrid() {
  player.position.x = position.currentTile * tileSize;
  player.position.y = position.currentRow * tileSize;
  player.children[0].position.z = 0;
}

function pauseActiveBetForReconnect() {
  if (!bet.active) return;

  bet.reconnecting = true;
  bet.isDecaying = false;
  movesQueue.length = 0;

  if (moveClock.running) moveClock.stop();

  syncPlayerToGrid();
  stopBetTicker({ resetTimer: false });
  hideResult();
  showBetHud(true);
  showBetPanel(false);
  setBetButtonState();
  renderBetHud();
}

function restoreActiveBetFromSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;

  const row = Math.max(0, Number(snapshot.row) || 0);
  const maxRow = Math.max(row, Number(snapshot.maxRow) || 0);
  const currentCp = Math.max(0, Number(snapshot.cp) || 0);
  const cashoutWindow = Boolean(snapshot.cashoutWindow);
  const segmentRemainingMs = Math.max(
    0,
    Number(snapshot.segmentRemainingMs) || 0,
  );
  const cpStayRemainingMs = Math.max(
    0,
    Number(snapshot.cpStayRemainingMs) || 0,
  );
  const decayBp = Math.max(0, Number(snapshot.decayBp) || 0);
  const now = Date.now();

  settlementPending = false;
  gameOver = false;
  bet.active = true;
  bet.reconnecting = false;
  bet.stake = Math.max(0, Number(snapshot.stake) || 0);
  bet.maxRow = maxRow;
  bet.currentCp = currentCp;
  const snapshotMultiplierBp = Math.max(0, Number(snapshot.multiplierBp) || 0);
  bet.decayCarryBp = Math.max(
    0,
    calculateRowMultiplierBp(row) -
      snapshotMultiplierBp -
      (cashoutWindow ? 0 : decayBp),
  );
  bet.cashoutWindow = cashoutWindow;
  bet.cpRowIndex = cashoutWindow ? row : currentCp * CP_INTERVAL;
  bet.cpStayRemainingMs = cashoutWindow ? cpStayRemainingMs : 0;
  bet.cpEnterTime = cashoutWindow
    ? now - Math.max(0, CP_MAX_STAY_MS - cpStayRemainingMs)
    : 0;
  bet.segmentActive = !cashoutWindow;
  bet.segmentStart =
    segmentRemainingMs > 0
      ? now - Math.max(0, SEGMENT_TIME_MS - segmentRemainingMs)
      : now - SEGMENT_TIME_MS - Math.floor((decayBp * 1000) / DECAY_BP_PER_SEC);
  bet.lastDecayTick = now;
  bet.isDecaying = !cashoutWindow && decayBp > 0;
  bet.multiplierBp = cashoutWindow
    ? snapshotMultiplierBp
    : getCurrentEffectiveMultiplierBp(now);

  movesQueue.length = 0;
  if (moveClock.running) moveClock.stop();
  position.currentRow = row;

  syncPlayerToGrid();

  if (scoreDOM) scoreDOM.innerText = String(position.currentRow);
  if (scoreCpDOM) scoreCpDOM.innerText = String(bet.currentCp);

  hideResult();
  showBetPanel(false);
  showBetHud(true);
  setBetButtonState();
  renderBetHud();
  tickBet();
  startBetTicker();
  return true;
}

function resetBetAfterReconnectFailure() {
  settlementPending = false;
  bet.active = false;
  bet.reconnecting = false;
  bet.cashoutWindow = false;
  bet.segmentActive = false;
  bet.cpStayRemainingMs = 0;
  bet.decayCarryBp = 0;
  bet.isDecaying = false;
  movesQueue.length = 0;

  if (moveClock.running) moveClock.stop();

  stopBetTicker();
  setBetButtonState();
  renderBetHud();
  showBetHud(false);
}

function showResult(data) {
  gameOver = true;
  movesQueue.length = 0;

  const resultDOM = document.getElementById("result-container");
  const titleEl = document.getElementById("result-title");
  const bodyEl = document.getElementById("result-body");
  if (!resultDOM || !titleEl || !bodyEl) return;

  const shouldPlaySfx = !data.silent;
  resultDOM.dataset.result = data.type || "gameover";

  if (data.type === "cashout") {
    if (shouldPlaySfx) playCashoutSfx();
    titleEl.innerText = "CASHED OUT";
    const profitClass =
      data.profit >= 0 ? "profit-positive" : "profit-negative";
    const profitSign = data.profit >= 0 ? "+" : "-";
    bodyEl.innerHTML = `
      <p>Checkpoint: <strong>${data.cp}</strong></p>
      <p>Hops survived: <strong>${data.rows}</strong></p>
      <p>Multiplier: <strong>${data.multiplier.toFixed(2)}x</strong></p>
      <p>Payout: <strong>${formatUsdAmount(data.payout)}</strong></p>
      <p class="${profitClass}">Profit: ${profitSign}${formatUsdAmount(Math.abs(data.profit))}</p>
    `;
  } else if (data.type === "crash") {
    if (shouldPlaySfx) playCrashSfx();
    titleEl.innerText = "CRASHED";
    bodyEl.innerHTML = `
      <p>Last checkpoint: <strong>${data.cp}</strong></p>
      <p>Hops survived: <strong>${data.rows}</strong></p>
      <p>Last multiplier: <strong>${data.multiplier.toFixed(2)}x</strong></p>
      <p class="profit-negative">Lost: -${formatUsdAmount(data.stake)}</p>
    `;
  } else {
    if (shouldPlaySfx) playCrashSfx();
    titleEl.innerText = "GAME OVER";
    bodyEl.innerHTML = `<p><span>HOPS:</span><strong>${position.currentRow}</strong></p>`;
  }
  resultDOM.style.visibility = "visible";
}

function hideResult() {
  const el = document.getElementById("result-container");
  if (el) {
    el.style.visibility = "hidden";
    delete el.dataset.result;
  }
}

function startFreePracticeRun() {
  hideResult();
  showBetPanel(false);
  stopBetTicker();
  bet.active = false;
  bet.decayCarryBp = 0;
  setBetButtonState();
  initializeGame();
}

function Camera() {
  const isMobile = window.innerWidth <= 768;
  const size = isMobile ? 240 : 300;
  const viewRatio = window.innerWidth / window.innerHeight;
  const width = viewRatio < 1 ? size : size * viewRatio;
  const height = viewRatio < 1 ? size / viewRatio : size;

  const camera = new THREE.OrthographicCamera(
    width / -2,
    width / 2,
    height / 2,
    height / -2,
    1,
    3000,
  );

  camera.up.set(0, 0, 1);
  applyCameraPose(camera, isMobile);

  return camera;
}

function applyCameraPose(camera, isMobile = window.innerWidth <= 768) {
  camera.position.set(190, -420, 370);
  camera.lookAt(-108, 250, -100);
}

function Texture(width, height, rects) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(0,0,0,0.6)";
  rects.forEach((rect) => {
    context.fillRect(rect.x, rect.y, rect.w, rect.h);
  });
  return new THREE.CanvasTexture(canvas);
}

const carFrontTexture = new Texture(40, 80, [{ x: 0, y: 10, w: 30, h: 60 }]);
const carBackTexture = new Texture(40, 80, [{ x: 10, y: 10, w: 30, h: 60 }]);
const carRightSideTexture = new Texture(110, 40, [
  { x: 10, y: 0, w: 50, h: 30 },
  { x: 70, y: 0, w: 30, h: 30 },
]);
const carLeftSideTexture = new Texture(110, 40, [
  { x: 10, y: 10, w: 50, h: 30 },
  { x: 70, y: 10, w: 30, h: 30 },
]);

export const truckFrontTexture = Texture(30, 30, [
  { x: 5, y: 0, w: 10, h: 30 },
]);
export const truckRightSideTexture = Texture(25, 30, [
  { x: 15, y: 5, w: 10, h: 10 },
]);
export const truckLeftSideTexture = Texture(25, 30, [
  { x: 15, y: 15, w: 10, h: 10 },
]);

function RoadVehicle(initialTileIndex, direction, color, kind = "car") {
  if (kind === "taxi") return Taxi(initialTileIndex, direction);
  if (kind === "police") return PoliceCar(initialTileIndex, direction);
  if (kind === "coupe") return Coupe(initialTileIndex, direction, color);
  if (kind === "truck") return Truck(initialTileIndex, direction, color);
  return Car(initialTileIndex, direction, color);
}

function Car(initialTileIndex, direction, color) {
  const car = new THREE.Group();
  car.position.x = initialTileIndex * tileSize;
  if (!direction) car.rotation.z = Math.PI;

  const main = new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 15),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  main.position.z = 12;
  main.castShadow = true;
  main.receiveShadow = true;
  car.add(main);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(33, 24, 12), [
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carBackTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carFrontTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carRightSideTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carLeftSideTexture,
    }),
    new THREE.MeshPhongMaterial({ color: 0xd9ecff, flatShading: true }),
    new THREE.MeshPhongMaterial({ color: 0xcccccc, flatShading: true }),
  ]);
  cabin.position.x = -6;
  cabin.position.z = 25.5;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  car.add(cabin);

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
  const headlightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    headlightMat,
  );
  headlightL.position.set(30.5, -10, 11);
  car.add(headlightL);

  const headlightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    headlightMat,
  );
  headlightR.position.set(30.5, 10, 11);
  car.add(headlightR);

  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  const taillightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 2.5),
    taillightMat,
  );
  taillightL.position.set(-30.5, -10, 11);
  car.add(taillightL);

  const taillightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 2.5),
    taillightMat,
  );
  taillightR.position.set(-30.5, 10, 11);
  car.add(taillightR);

  const bumperMat = new THREE.MeshLambertMaterial({
    color: 0x2c2c2c,
    flatShading: true,
  });
  const bumperFront = new THREE.Mesh(
    new THREE.BoxGeometry(1, 28, 4),
    bumperMat,
  );
  bumperFront.position.set(30.5, 0, 8);
  car.add(bumperFront);

  const bumperBack = new THREE.Mesh(new THREE.BoxGeometry(1, 28, 4), bumperMat);
  bumperBack.position.set(-30.5, 0, 8);
  car.add(bumperBack);

  const frontWheel = Wheel(18);
  car.add(frontWheel);

  const backWheel = Wheel(-18);
  car.add(backWheel);

  return car;
}

function Taxi(initialTileIndex, direction) {
  const taxiYellow = 0xffd64a;
  const taxi = Car(initialTileIndex, direction, taxiYellow);

  const signBaseMat = new THREE.MeshLambertMaterial({
    color: 0x1f1f1f,
    flatShading: true,
  });
  const signTopMat = new THREE.MeshLambertMaterial({
    color: 0xfff3b0,
    flatShading: true,
  });

  const lightbox = new THREE.Group();
  lightbox.position.set(-2, 0, 36);

  const signBase = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 4), signBaseMat);
  signBase.position.z = 0;
  lightbox.add(signBase);

  const signTop = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 2), signTopMat);
  signTop.position.z = 2.5;
  lightbox.add(signTop);

  const signStripe = new THREE.Mesh(
    new THREE.BoxGeometry(12, 1.2, 0.8),
    signBaseMat,
  );
  signStripe.position.set(0, 0, 2.7);
  lightbox.add(signStripe);

  taxi.add(lightbox);
  return taxi;
}

function Coupe(initialTileIndex, direction, color) {
  const coupeColor = color || 0xf4a261;
  const coupe = new THREE.Group();
  coupe.position.x = initialTileIndex * tileSize;
  if (!direction) coupe.rotation.z = Math.PI;

  const main = new THREE.Mesh(
    new THREE.BoxGeometry(54, 28, 14),
    new THREE.MeshLambertMaterial({ color: coupeColor, flatShading: true }),
  );
  main.position.z = 11;
  main.castShadow = true;
  main.receiveShadow = true;
  coupe.add(main);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(26, 22, 10), [
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carBackTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carFrontTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carRightSideTexture,
    }),
    new THREE.MeshPhongMaterial({
      color: 0xe8f4ff,
      flatShading: true,
      map: carLeftSideTexture,
    }),
    new THREE.MeshPhongMaterial({ color: 0xd9ecff, flatShading: true }),
    new THREE.MeshPhongMaterial({ color: 0xcccccc, flatShading: true }),
  ]);
  cabin.position.x = -4;
  cabin.position.z = 21;
  cabin.castShadow = true;
  cabin.receiveShadow = true;
  coupe.add(cabin);

  addVehicleLights(coupe, 27, 9, 10);
  coupe.add(Wheel(16));
  coupe.add(Wheel(-16));

  return coupe;
}

function PoliceCar(initialTileIndex, direction) {
  const police = Car(initialTileIndex, direction, 0x111827);
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0x3b82f6, flatShading: true });

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(44, 2.5, 3), stripeMat);
  stripe.position.z = 20;
  police.add(stripe);

  const lightbar = new THREE.Group();
  lightbar.position.set(-4, 0, 36);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(18, 8, 3),
    new THREE.MeshLambertMaterial({ color: 0x1f2937, flatShading: true }),
  );
  lightbar.add(base);

  const red = new THREE.Mesh(
    new THREE.BoxGeometry(7, 6, 2),
    new THREE.MeshLambertMaterial({ color: 0xef4444, flatShading: true }),
  );
  red.position.set(4, 0, 2.2);
  lightbar.add(red);

  const blue = new THREE.Mesh(
    new THREE.BoxGeometry(7, 6, 2),
    new THREE.MeshLambertMaterial({ color: 0x3b82f6, flatShading: true }),
  );
  blue.position.set(-4, 0, 2.2);
  lightbar.add(blue);

  police.add(lightbar);
  return police;
}


function addVehicleLights(vehicle, frontX, sideY, z) {
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
  [-1, 1].forEach((side) => {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 4, 3),
      headlightMat,
    );
    headlight.position.set(frontX, side * sideY, z);
    vehicle.add(headlight);
  });

  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  [-1, 1].forEach((side) => {
    const taillight = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 4, 3),
      taillightMat,
    );
    taillight.position.set(-frontX, side * sideY, z);
    vehicle.add(taillight);
  });
}


function DirectionalLight() {
  const dirLight = new THREE.DirectionalLight();
  dirLight.position.set(-100, -100, 200);
  dirLight.up.set(0, 0, 1);
  dirLight.castShadow = true;

  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;

  dirLight.shadow.camera.up.set(0, 0, 1);
  dirLight.shadow.camera.left = -400;
  dirLight.shadow.camera.right = 400;
  dirLight.shadow.camera.top = 400;
  dirLight.shadow.camera.bottom = -400;
  dirLight.shadow.camera.near = 50;
  dirLight.shadow.camera.far = 400;

  return dirLight;
}

function createProofOfShipCheckpointGroundTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 4096;
  canvas.height = 80;
  const ctx = canvas.getContext("2d");

  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.fillStyle = "#17001f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(
    canvas.width * 0.5,
    canvas.height * 0.52,
    canvas.height * 0.1,
    canvas.width * 0.5,
    canvas.height * 0.52,
    canvas.width * 0.42,
  );
  glow.addColorStop(0, "rgba(184, 137, 255, 0.22)");
  glow.addColorStop(0.52, "rgba(72, 190, 255, 0.1)");
  glow.addColorStop(1, "rgba(72, 190, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(244, 225, 255, 0.12)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let x = 18; x < canvas.width; x += 32) {
    for (let y = 10; y < canvas.height; y += 14) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const pipeMat = [
    "rgba(255, 255, 255, 0.18)",
    "rgba(179, 155, 204, 0.22)",
    "rgba(255, 141, 221, 0.22)",
    "rgba(107, 196, 255, 0.22)",
  ];
  for (let x = 0; x < canvas.width; x += 760) {
    ctx.fillStyle = pipeMat[(x / 760) % pipeMat.length];
    ctx.fillRect(x + 42, 0, 18, 58);
    ctx.fillRect(x + 42, 42, 210, 16);
    ctx.fillRect(x + 234, 42, 18, 38);
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeRect(x + 42, 0, 210, 58);
  }

  const chipX = canvas.width * 0.22;
  const chipY = 8;
  const chipW = 92;
  const chips = [
    { label: "BUILD", color: "#b794ff" },
    { label: "SHIP", color: "#62c9ff" },
    { label: "GROW", color: "#ff8de5" },
  ];
  ctx.font = "900 15px Arial Black, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  chips.forEach((chip, index) => {
    ctx.fillStyle = chip.color;
    ctx.fillRect(chipX + index * chipW, chipY, chipW, 18);
    ctx.fillStyle = "#180021";
    ctx.fillText(chip.label, chipX + index * chipW + chipW / 2, chipY + 10);
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "900 18px Arial Black, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("CELO", canvas.width - 260, 18);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 42px Arial Black, Arial, sans-serif";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(15, 0, 24, 0.95)";
  ctx.lineWidth = 7;
  ctx.strokeText("PROOF OF SHIP", canvas.width / 2, canvas.height / 2 + 12);
  ctx.fillStyle = "#fff9ff";
  ctx.fillText("PROOF OF SHIP", canvas.width / 2, canvas.height / 2 + 12);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function FinishFlag(direction) {
  const flag = new THREE.Group();
  const poleMat = new THREE.MeshLambertMaterial({
    color: 0x253041,
    flatShading: true,
  });
  const whiteMat = new THREE.MeshLambertMaterial({
    color: 0xfff8e8,
    flatShading: true,
  });
  const blackMat = new THREE.MeshLambertMaterial({
    color: 0x151c26,
    flatShading: true,
  });

  const pole = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 22), poleMat);
  pole.position.z = 11;
  pole.castShadow = true;
  flag.add(pole);

  const squareSize = 4.5;
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 2; row += 1) {
      const square = new THREE.Mesh(
        new THREE.BoxGeometry(squareSize, 1.2, squareSize),
        (col + row) % 2 === 0 ? blackMat : whiteMat,
      );
      square.position.set(
        direction * (4 + col * squareSize),
        0,
        18 - row * squareSize,
      );
      square.castShadow = true;
      flag.add(square);
    }
  }

  return flag;
}

function CheckpointBanner(width) {
  const banner = new THREE.Group();
  const whiteMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e8,
  });
  const blackMat = new THREE.MeshBasicMaterial({
    color: 0x151c26,
  });
  const cols = 12;
  const rows = 3;
  const squareW = width / cols;
  const squareH = 7.2;

  for (let col = 0; col < cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const square = new THREE.Mesh(
        new THREE.BoxGeometry(squareW, 1.2, squareH),
        (col + row) % 2 === 0 ? blackMat : whiteMat,
      );
      square.position.set(
        -width / 2 + squareW / 2 + col * squareW,
        0,
        -((rows - 1) * squareH) / 2 + row * squareH,
      );
      banner.add(square);
    }
  }

  return banner;
}

function CheckpointStringLights(width) {
  const lights = new THREE.Group();
  const colors = [
    { on: 0xfff0a0, off: 0x6b4a16 },
    { on: 0x7ef4c9, off: 0x174b3e },
    { on: 0xff7c7c, off: 0x5e1e1e },
    { on: 0x9bdcff, off: 0x1f4c66 },
  ];
  const count = 13;

  for (let i = 0; i < count; i += 1) {
    const color = colors[i % colors.length];
    const material = new THREE.MeshBasicMaterial({
      color: color.off,
      transparent: true,
      opacity: 0.8,
    });
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(4, 1.4, 4), material);
    bulb.position.set(-width / 2 + (width / (count - 1)) * i, -1.4, 14.8);
    lights.add(bulb);
    checkpointDecorations.push({
      type: "bulb",
      mesh: bulb,
      material,
      onHex: color.on,
      offHex: color.off,
      phase: i * 0.68,
      speed: 220,
    });
  }

  return lights;
}

function CheckpointFireworkBurst(seed, colorHex) {
  const burst = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.58,
  });
  const sparkGeometry = new THREE.BoxGeometry(4, 1.2, 4);
  const sparkPositions = [
    [0, 0, 0],
    [10, 0, 0],
    [-10, 0, 0],
    [0, 0, 10],
    [0, 0, -10],
    [7, 0, 7],
    [-7, 0, 7],
    [7, 0, -7],
    [-7, 0, -7],
  ];

  sparkPositions.forEach(([x, y, z], index) => {
    const spark = new THREE.Mesh(sparkGeometry, material);
    spark.position.set(x, y, z);
    burst.add(spark);
    checkpointDecorations.push({
      type: "spark",
      mesh: spark,
      material,
      phase: seed + index * 0.72,
      speed: 360 + seed * 30,
    });
  });

  return burst;
}

function CheckpointBeacon() {
  const beacon = new THREE.Group();
  const baseMat = new THREE.MeshLambertMaterial({
    color: 0x253041,
    flatShading: true,
  });
  const goldMat = new THREE.MeshLambertMaterial({
    color: 0xffc957,
    flatShading: true,
  });
  const lightMat = new THREE.MeshBasicMaterial({
    color: 0xffe59a,
    transparent: true,
    opacity: 0.62,
  });

  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 5), baseMat);
  base.position.z = 2.5;
  base.castShadow = true;
  beacon.add(base);

  const core = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 18), goldMat);
  core.position.z = 13;
  core.castShadow = true;
  beacon.add(core);

  const glow = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 8), lightMat);
  glow.position.z = 24;
  beacon.add(glow);

  return beacon;
}

const __rockMatA = new THREE.MeshLambertMaterial({
  color: 0x6a6358,
  flatShading: true,
});
const __rockMatB = new THREE.MeshLambertMaterial({
  color: 0x4f4a42,
  flatShading: true,
});
const __rockMatC = new THREE.MeshLambertMaterial({
  color: 0x3b362f,
  flatShading: true,
});
const __nonTunnelRockLayers = [
  { tilePos: 9.5, sx: 1.0, sy: 1.0, h: 78, mat: __rockMatA, yOff: 0 },
  { tilePos: 11.0, sx: 2.0, sy: 1.05, h: 116, mat: __rockMatB, yOff: 7 },
  { tilePos: 13.0, sx: 2.0, sy: 1.0, h: 138, mat: __rockMatC, yOff: -5 },
  { tilePos: 15.0, sx: 2.0, sy: 1.05, h: 102, mat: __rockMatA, yOff: 4 },
  { tilePos: 16.5, sx: 1.0, sy: 1.0, h: 86, mat: __rockMatB, yOff: 0 },
];
const __tunnelRockLayers = [
  { tilePos: 10.5, sx: 1.0, sy: 1.05, h: 96, mat: __rockMatA, yOff: 5 },
  { tilePos: 12.0, sx: 2.0, sy: 1.0, h: 130, mat: __rockMatC, yOff: -3 },
  { tilePos: 14.0, sx: 2.0, sy: 1.05, h: 112, mat: __rockMatB, yOff: 6 },
  { tilePos: 16.0, sx: 2.0, sy: 1.0, h: 92, mat: __rockMatA, yOff: 0 },
];

function MapEdgeRocks(opts = {}) {
  const layers = opts.tunnelGap ? __tunnelRockLayers : __nonTunnelRockLayers;
  const group = new THREE.Group();

  [-1, 1].forEach((side) => {
    layers.forEach((layer) => {
      const rock = new THREE.Mesh(
        new THREE.BoxGeometry(
          layer.sx * tileSize,
          layer.sy * tileSize,
          layer.h,
        ),
        layer.mat,
      );
      rock.position.set(
        side * layer.tilePos * tileSize,
        layer.yOff,
        layer.h / 2,
      );
      rock.castShadow = true;
      rock.receiveShadow = true;
      group.add(rock);
    });
  });

  return group;
}

function Grass(rowIndex, isCheckpoint) {
  const grass = new THREE.Group();
  grass.position.y = rowIndex * tileSize;

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.BoxGeometry(tilesPerRow * tileSize, tileSize, 3),
      new THREE.MeshLambertMaterial({ color }),
    );

  const middleColor = 0xbaf455;
  const sideColor = 0x99c846;

  const middle = createSection(middleColor);
  middle.receiveShadow = true;
  grass.add(middle);

  const left = createSection(sideColor);
  left.position.x = -tilesPerRow * tileSize;
  grass.add(left);

  const right = createSection(sideColor);
  right.position.x = tilesPerRow * tileSize;
  grass.add(right);

  if (isCheckpoint) {
    const proofOfShipGround = new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize * 3, tileSize),
      new THREE.MeshBasicMaterial({
        map: createProofOfShipCheckpointGroundTexture(),
        depthWrite: false,
      }),
    );
    proofOfShipGround.position.set(0, 0, 1.72);
    grass.add(proofOfShipGround);

    const postMat = new THREE.MeshLambertMaterial({
      color: 0x253041,
      flatShading: true,
    });

    const postSpan = tilesPerRow * tileSize * 0.7;
    const postL = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 40), postMat);
    postL.position.set(-postSpan / 2, -5, 20);
    postL.castShadow = true;
    grass.add(postL);

    const postR = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 40), postMat);
    postR.position.set(postSpan / 2, -5, 20);
    postR.castShadow = true;
    grass.add(postR);

    const banner = CheckpointBanner(postSpan);
    banner.position.set(0, -5, 36);
    grass.add(banner);

    const stringLights = CheckpointStringLights(postSpan);
    stringLights.position.set(0, -5, 36);
    grass.add(stringLights);

    [
      { x: -postSpan * 0.34, z: 54, color: 0xffd35f },
      { x: 0, z: 60, color: 0x7ef4c9 },
      { x: postSpan * 0.34, z: 54, color: 0xff7c7c },
    ].forEach((firework, index) => {
      const burst = CheckpointFireworkBurst(index + 1, firework.color);
      burst.position.set(firework.x, -12, firework.z);
      grass.add(burst);
    });

    [-1, 1].forEach((side) => {
      const beacon = CheckpointBeacon();
      beacon.position.set(side * tileSize * 3.8, tileSize * 0.18, 2);
      grass.add(beacon);
    });

    [-1, 1].forEach((side) => {
      const flag = FinishFlag(side);
      flag.position.set(side * tilesPerRow * tileSize * 0.42, 15, 0);
      grass.add(flag);
    });
  }

  const flowerColors = [0xff6b9d, 0xffd93d, 0xffffff, 0xc780ff, 0xff8a5c];
  const flowerCount = 5 + Math.floor(Math.random() * 4);
  for (let i = 0; i < flowerCount; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const flowerGroup = new THREE.Group();

    const stem = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 3),
      new THREE.MeshLambertMaterial({ color: 0x4a7c1f, flatShading: true }),
    );
    stem.position.z = 3;
    flowerGroup.add(stem);

    const petal = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, 2.5, 2),
      new THREE.MeshLambertMaterial({
        color: flowerColors[Math.floor(Math.random() * flowerColors.length)],
        flatShading: true,
      }),
    );
    petal.position.z = 5.5;
    flowerGroup.add(petal);

    flowerGroup.position.x =
      side * ((tilesPerRow / 2) * tileSize + 30 + Math.random() * 260);
    flowerGroup.position.y = (Math.random() - 0.5) * tileSize * 0.8;
    grass.add(flowerGroup);
  }

  if (Math.random() < 0.4) {
    const bush = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x6fa832, flatShading: true }),
    );
    const side = Math.random() < 0.5 ? -1 : 1;
    bush.position.x =
      side * ((tilesPerRow / 2) * tileSize + 50 + Math.random() * 200);
    bush.position.y = (Math.random() - 0.5) * tileSize * 0.6;
    bush.position.z = 4.5;
    bush.castShadow = true;
    grass.add(bush);
  }

  grass.add(MapEdgeRocks());

  return grass;
}

const metadata = [];

const map = new THREE.Group();

function initializeMap() {
  metadata.length = 0;
  map.remove(...map.children);
  railwayLights.length = 0;
  checkpointDecorations.length = 0;
  pendingRoadRowsInSegment = 0;
  pendingRiverRowsInSegment = 0;
  consecutiveRoadRows = 0;
  consecutiveRiverRows = 0;
  riverCooldownRows = 0;
  lastRiverPlatformOffset = null;
  riverDecorations.length = 0;
  for (let rowIndex = 0; rowIndex > -10; rowIndex--) {
    const grass = Grass(rowIndex);
    map.add(grass);
  }
  addRows();
}

function addRows() {
  const startIndex = metadata.length;
  const newMetadata = generateRows(20, startIndex);

  metadata.push(...newMetadata);

  newMetadata.forEach((rowData, index) => {
    const rowIndex = startIndex + index + 1;

    if (rowData.type === "forest") {
      const row = Grass(rowIndex, rowData.isCheckpoint);

      rowData.trees.forEach(({ tileIndex, height, variant }) => {
        const three = Tree(tileIndex, height, variant);
        row.add(three);
      });

      map.add(row);
    }

    if (rowData.type === "car" || rowData.type === "truck") {
      const row = Road(rowIndex);

      rowData.vehicles.forEach((vehicle) => {
        const roadVehicle = RoadVehicle(
          vehicle.initialTileIndex,
          rowData.direction,
          vehicle.color,
          vehicle.kind,
        );
        vehicle.ref = roadVehicle;
        row.add(roadVehicle);
      });

      map.add(row);
    }

    if (rowData.type === "river") {
      const row = River(rowIndex, {
        bankBack: rowData.bankBack,
        bankFront: rowData.bankFront,
        direction: rowData.direction,
      });
      const platforms = rowData.platforms || rowData.boats || [];

      platforms.forEach((platform) => {
        const platformMesh =
          platform.kind === "lily"
            ? LilyPad(platform.initialTileIndex, platform.color)
            : platform.kind === "log"
              ? LogPlatform(platform.initialTileIndex, platform.color)
              : platform.kind === "stone"
                ? RiverStone(platform.initialTileIndex, platform.color)
            : Boat(
                platform.initialTileIndex,
                rowData.direction,
                platform.color,
              );

        platformMesh.userData.rideHalfWidth = platform.rideHalfWidth;
        platformMesh.userData.platformKind = platform.kind;
        platformMesh.userData.bobPhase = platform.bobPhase;
        platformMesh.userData.bobAmplitude = platform.bobAmplitude;
        platformMesh.userData.submergePhase = platform.submergePhase;
        platformMesh.userData.submergeSpeed = platform.submergeSpeed;
        platformMesh.userData.isSubmerged = false;
        platformMesh.userData.baseZ = platformMesh.position.z;
        platform.ref = platformMesh;
        row.add(platformMesh);
      });

      map.add(row);
    }

    if (rowData.type === "train") {
      const row = Rail(rowIndex, rowData);

      rowData.vehicles.forEach((vehicle) => {
        const carMesh = Train(
          vehicle.initialTileIndex,
          rowData.direction,
          vehicle.isLocomotive,
          vehicle.color,
        );
        vehicle.ref = carMesh;
        row.add(carMesh);
      });

      map.add(row);
    }
  });
}

const PLAYER_CHARACTER_IDS = [
  "chicken",
  "duck",
  "goose",
  "turkey",
  "quail",
  "peacock",
];

const PLAYER_CHARACTER_CONFIGS = {
  chicken: {
    body: 0xfafafa,
    accent: 0xe63946,
    beak: 0xff9f1c,
    legs: 0xff9f1c,
    variant: "chicken",
  },
  duck: {
    body: 0xffd35a,
    head: 0xf8c74d,
    accent: 0x2f7d4f,
    beak: 0xf07f21,
    legs: 0xf07f21,
    variant: "duck",
  },
  goose: {
    body: 0xf4f1df,
    head: 0xf7f4e7,
    accent: 0xd8d3bd,
    beak: 0xf59b22,
    legs: 0xd9791d,
    variant: "goose",
  },
  turkey: {
    body: 0x8f5532,
    head: 0x5c7fa3,
    accent: 0xd13f2f,
    beak: 0xf1aa42,
    legs: 0xd1873a,
    variant: "turkey",
  },
  quail: {
    body: 0xb78a58,
    head: 0x9b7145,
    accent: 0x3e2c1d,
    beak: 0xe0a13a,
    legs: 0xc06f2c,
    variant: "quail",
  },
  peacock: {
    body: 0x157a9a,
    head: 0x1f9fc0,
    accent: 0x35a853,
    beak: 0xf0b23f,
    legs: 0xb66d2f,
    variant: "peacock",
  },
};

function getStoredPlayerCharacterId() {
  try {
    const stored = localStorage.getItem(CHARACTER_STORAGE_KEY);
    return PLAYER_CHARACTER_IDS.includes(stored) ? stored : "chicken";
  } catch (_error) {
    return "chicken";
  }
}

function createPlayerBox(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    material,
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function mixPlayerColor(color, target, amount) {
  return new THREE.Color(color).lerp(new THREE.Color(target), amount).getHex();
}

function disposePlayerModel(model) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function createPlayerModel(characterId = "chicken") {
  const config =
    PLAYER_CHARACTER_CONFIGS[characterId] || PLAYER_CHARACTER_CONFIGS.chicken;
  const model = new THREE.Group();
  model.userData.characterId = characterId;

  const bodyMat = new THREE.MeshLambertMaterial({
    color: config.body,
    flatShading: true,
  });
  const headMat = new THREE.MeshLambertMaterial({
    color: config.head || config.body,
    flatShading: true,
  });
  const accentMat = new THREE.MeshLambertMaterial({
    color: config.accent,
    flatShading: true,
  });
  const beakMat = new THREE.MeshLambertMaterial({
    color: config.beak,
    flatShading: true,
  });
  const eyeMat = new THREE.MeshLambertMaterial({
    color: 0x111111,
    flatShading: true,
  });
  const legMat = new THREE.MeshLambertMaterial({
    color: config.legs,
    flatShading: true,
  });
  const bodyHighlightMat = new THREE.MeshLambertMaterial({
    color: mixPlayerColor(config.body, 0xffffff, 0.38),
    flatShading: true,
  });
  const bodyShadowMat = new THREE.MeshLambertMaterial({
    color: mixPlayerColor(config.body, 0x000000, 0.2),
    flatShading: true,
  });
  const accentHighlightMat = new THREE.MeshLambertMaterial({
    color: mixPlayerColor(config.accent, 0xffffff, 0.22),
    flatShading: true,
  });
  const eyeShineMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
  });
  const nostrilMat = new THREE.MeshLambertMaterial({
    color: mixPlayerColor(config.beak, 0x000000, 0.55),
    flatShading: true,
  });

  const isQuail = config.variant === "quail";
  const isGoose = config.variant === "goose";
  const bodyW = isQuail ? 12 : 14;
  const bodyH = isGoose ? 12 : 13;
  const bodyD = isQuail ? 10 : 12;
  const headZ = isGoose ? 20 : isQuail ? 15.5 : 17;

  model.add(createPlayerBox(bodyW, bodyH, bodyD, bodyMat, 0, 0, 7));
  model.add(
    createPlayerBox(bodyW - 4.5, 1, bodyD - 3, bodyHighlightMat, 0, bodyH / 2 + 0.35, 8),
  );
  model.add(
    createPlayerBox(bodyW - 7, 1, Math.max(3.5, bodyD - 6), bodyShadowMat, 0, -bodyH / 2 - 0.25, 6),
  );

  if (isGoose) {
    model.add(createPlayerBox(5, 5, 9, headMat, 0, 3.5, 14.5));
    model.add(createPlayerBox(7.5, 7, 6.5, headMat, 0, 5, headZ));
    model.add(createPlayerBox(5.8, 1, 2, accentMat, 0, 6.4, 16));
  } else {
    model.add(
      createPlayerBox(
        isQuail ? 7.5 : 9,
        isQuail ? 7 : 8,
        isQuail ? 6 : 7,
        headMat,
        0,
        isQuail ? 3.5 : 4,
        headZ,
      ),
    );
    model.add(createPlayerBox(isQuail ? 4.5 : 5.5, 1, 1.2, bodyHighlightMat, 0, isQuail ? 6.9 : 7.5, headZ - 1.8));
  }

  const beakWidth = config.variant === "duck" ? 4.5 : 2.5;
  const beakHeight = config.variant === "duck" ? 2.6 : 2;
  model.add(
    createPlayerBox(
      beakWidth,
      beakHeight,
      1.5,
      beakMat,
      0,
      isGoose ? 9.5 : 9,
      isGoose ? 19.5 : isQuail ? 15 : 16.5,
    ),
  );
  model.add(
    createPlayerBox(
      Math.max(1.2, beakWidth - 1.2),
      0.45,
      0.45,
      nostrilMat,
      0,
      isGoose ? 10 : 9.5,
      isGoose ? 19.7 : isQuail ? 15.2 : 16.7,
    ),
  );

  if (config.variant === "chicken") {
    model.add(createPlayerBox(2, 2, 2, accentMat, -2, 2, 22));
    model.add(createPlayerBox(2, 2, 3, accentMat, 0, 3, 22.5));
    model.add(createPlayerBox(2, 2, 2, accentMat, 2, 4, 22));
    model.add(createPlayerBox(1.5, 1.5, 2, accentMat, 0, 8.5, 14));
    model.add(createPlayerBox(1.4, 1.2, 1.2, accentHighlightMat, 0, 3.4, 24.2));
    model.add(createPlayerBox(2.5, 1.2, 4, accentMat, -3.6, -7.2, 14));
    model.add(createPlayerBox(2.5, 1.2, 4, accentMat, 3.6, -7.2, 14));
  }

  if (config.variant === "turkey") {
    model.add(createPlayerBox(2, 1.5, 3, accentMat, 0, 8.2, 13.5));
    model.add(createPlayerBox(11, 1.5, 9, accentMat, 0, -7.8, 14));
    model.add(createPlayerBox(7, 1.2, 11, beakMat, 0, -8.8, 17));
    model.add(createPlayerBox(3, 1.2, 7, accentHighlightMat, -4, -7.6, 17));
    model.add(createPlayerBox(3, 1.2, 7, accentHighlightMat, 4, -7.6, 17));
    model.add(createPlayerBox(7, 1, 2.5, bodyHighlightMat, 0, 6.8, 8.5));
  }

  if (config.variant === "quail") {
    model.add(createPlayerBox(1.2, 1.2, 5, accentMat, -1.8, 1.2, 20));
    model.add(createPlayerBox(1.2, 1.2, 6, accentMat, 0, 1.6, 20.8));
    model.add(createPlayerBox(1.2, 1.2, 5, accentMat, 1.8, 1.2, 20));
    model.add(createPlayerBox(8, 1, 2, accentMat, 0, 0, 12));
    model.add(createPlayerBox(5, 1, 1.2, accentMat, 0, 7, 17.2));
    model.add(createPlayerBox(3.5, 1, 2, bodyHighlightMat, 0, 6.8, 12.5));
  }

  if (config.variant === "peacock") {
    model.add(createPlayerBox(12, 1.2, 10, accentMat, 0, -7.5, 15));
    model.add(createPlayerBox(8, 1, 12, beakMat, 0, -8.6, 17));
    model.add(createPlayerBox(1.2, 1.2, 4, accentMat, -2, 2, 22));
    model.add(createPlayerBox(1.2, 1.2, 5, accentMat, 0, 2.5, 22.8));
    model.add(createPlayerBox(1.2, 1.2, 4, accentMat, 2, 2, 22));
    model.add(createPlayerBox(2, 0.9, 2, beakMat, -4.2, -7.8, 18));
    model.add(createPlayerBox(2, 0.9, 2, beakMat, 0, -7.9, 20));
    model.add(createPlayerBox(2, 0.9, 2, beakMat, 4.2, -7.8, 18));
    model.add(createPlayerBox(4, 1, 2, bodyHighlightMat, 0, 7.5, 17.5));
  }

  model.add(createPlayerBox(1, 1, 1, eyeMat, -2.5, 7.5, headZ + 1));
  model.add(createPlayerBox(1, 1, 1, eyeMat, 2.5, 7.5, headZ + 1));
  model.add(createPlayerBox(0.35, 0.35, 0.35, eyeShineMat, -2.3, 7.75, headZ + 1.25));
  model.add(createPlayerBox(0.35, 0.35, 0.35, eyeShineMat, 2.7, 7.75, headZ + 1.25));

  model.add(
    createPlayerBox(1, 8, isQuail ? 5 : 7, bodyMat, -7, -1, isQuail ? 7 : 8),
  );
  model.add(
    createPlayerBox(1, 8, isQuail ? 5 : 7, bodyMat, 7, -1, isQuail ? 7 : 8),
  );
  model.add(createPlayerBox(0.8, 5.5, 1.2, bodyShadowMat, -7.05, -1.2, isQuail ? 5 : 5.8));
  model.add(createPlayerBox(0.8, 5.5, 1.2, bodyShadowMat, 7.05, -1.2, isQuail ? 5 : 5.8));
  model.add(createPlayerBox(0.75, 3.2, 1.1, bodyHighlightMat, -7.05, 1.8, isQuail ? 8.8 : 10.2));
  model.add(createPlayerBox(0.75, 3.2, 1.1, bodyHighlightMat, 7.05, 1.8, isQuail ? 8.8 : 10.2));

  if (!["turkey", "peacock"].includes(config.variant)) {
    model.add(createPlayerBox(5, 2, 6, bodyMat, 0, -7, 13));
    model.add(createPlayerBox(3, 1.5, 4, bodyMat, 0, -8, 17));
    model.add(createPlayerBox(4, 1, 3, bodyShadowMat, 0, -7.8, 12));
  }

  model.add(createPlayerBox(1.5, 1.5, 2, legMat, -3, 0, 0.5));
  model.add(createPlayerBox(1.5, 1.5, 2, legMat, 3, 0, 0.5));
  model.add(createPlayerBox(3.4, 1.1, 0.8, legMat, -3, 1.5, 0.05));
  model.add(createPlayerBox(3.4, 1.1, 0.8, legMat, 3, 1.5, 0.05));

  return model;
}

const player = Player();

function Player() {
  const playerContainer = new THREE.Group();
  playerContainer.add(createPlayerModel(getStoredPlayerCharacterId()));
  return playerContainer;
}

function setPlayerCharacter(characterId) {
  const nextCharacterId = PLAYER_CHARACTER_IDS.includes(characterId)
    ? characterId
    : "chicken";
  const currentModel = player.children[0];
  if (currentModel?.userData?.characterId === nextCharacterId) return;
  if (currentModel) {
    player.remove(currentModel);
    disposePlayerModel(currentModel);
  }
  const nextModel = createPlayerModel(nextCharacterId);
  player.add(nextModel);
  const nextModelIndex = player.children.indexOf(nextModel);
  if (nextModelIndex > 0) {
    player.children.splice(nextModelIndex, 1);
    player.children.unshift(nextModel);
  }
}

const position = {
  currentRow: 0,
  currentTile: 0,
  ridingBoat: null,
};

const movesQueue = [];
let moveStartX = 0;
let moveStartY = 0;

const PLAYER_PLATFORM_RIDE_Z = 11;
const BOAT_HALF_WIDTH = 50;
const LILY_PAD_HALF_WIDTH = 24;
const LOG_HALF_WIDTH = 42;
const STONE_HALF_WIDTH = 22;

function initializePlayer() {
  player.position.x = 0;
  player.position.y = 0;
  player.position.z = 0;
  player.children[0].position.z = 0;
  position.currentRow = 0;
  position.currentTile = 0;
  position.ridingBoat = null;
  movesQueue.length = 0;
  moveStartX = 0;
  moveStartY = 0;
}

function getRiverPlatforms(rowData) {
  return rowData?.platforms || rowData?.boats || [];
}

function getPlatformRideHalfWidth(platform) {
  const configuredWidth =
    platform?.rideHalfWidth || platform?.ref?.userData?.rideHalfWidth;
  if (isFinite(configuredWidth)) return configuredWidth;
  if (platform?.kind === "lily") return LILY_PAD_HALF_WIDTH;
  if (platform?.kind === "log") return LOG_HALF_WIDTH;
  if (platform?.kind === "stone") return STONE_HALF_WIDTH;
  return BOAT_HALF_WIDTH;
}

function findRiverPlatformAtTile(rowData, tileIndex) {
  if (!rowData) return null;
  const targetX = tileIndex * tileSize;
  for (const platform of getRiverPlatforms(rowData)) {
    if (!platform.ref) continue;
    if (platform.ref.userData.isSubmerged) continue;
    if (
      Math.abs(platform.ref.position.x - targetX) <=
      getPlatformRideHalfWidth(platform)
    ) {
      return platform.ref;
    }
  }
  return null;
}

function onDrown() {
  if (gameOver || settlementPending) return;
  movesQueue.length = 0;
  position.ridingBoat = null;
  player.position.z = 0;
  playSplashSfx();
  if (typeof playCrashSfx === "function") playCrashSfx();
  if (bet.active) {
    void crashBet("drowned");
  } else {
    showResult({ type: "gameover" });
  }
}

function evaluateBoatRide() {
  const newRow = metadata[position.currentRow - 1];
  if (newRow && newRow.type === "river") {
    const platformRef = findRiverPlatformAtTile(newRow, position.currentTile);
    if (platformRef) {
      position.ridingBoat = platformRef;
      player.position.z =
        PLAYER_PLATFORM_RIDE_Z + (platformRef.position.z || 0);
      return;
    }
    position.ridingBoat = null;
    player.position.z = 0;
    onDrown();
    return;
  }
  position.ridingBoat = null;
  player.position.z = 0;
}

function isInputBlocked() {
  if (gameOver) return true;
  if (bet.reconnecting) return true;
  const betPanel = document.getElementById("bet-panel");
  const depositModal = document.getElementById("deposit-modal");
  if (betPanel && betPanel.style.display !== "none") return true;
  if (depositModal && depositModal.style.display !== "none") return true;
  return false;
}

function queueMove(direction) {
  if (isInputBlocked()) return;

  if (movesQueue.length >= MAX_MOVE_QUEUE) return;

  const isValidMove = endsUpInValidPosition(
    {
      rowIndex: position.currentRow,
      tileIndex: position.currentTile,
    },
    [...movesQueue, direction],
  );

  if (!isValidMove) {
    playDeniedSfx();
    return;
  }

  movesQueue.push(direction);
}

function stepCompleted() {
  const direction = movesQueue.shift();
  if (!direction) return;

  playStepSfx();

  if (direction === "forward") position.currentRow += 1;
  if (direction === "backward") position.currentRow -= 1;
  if (direction === "left") position.currentTile -= 1;
  if (direction === "right") position.currentTile += 1;

  if (hasLiveBridge()) {
    getBridge().sendMove(direction);
  }
  if (position.currentRow > metadata.length - 10) addRows();
  if (bet.active) {
    if (direction === "forward") {
      if (position.currentRow > bet.maxRow) {
        bet.maxRow = position.currentRow;
        onPlayerAdvance(position.currentRow);
      } else {
        if (bet.cashoutWindow && position.currentRow > bet.cpRowIndex) {
          closeCashoutWindow();
        }
        renderBetHud();
      }
    } else if (direction === "backward") {
      if (bet.cashoutWindow && position.currentRow !== bet.cpRowIndex) {
        closeCashoutWindow();
      }
      renderBetHud();
    } else {
      renderBetHud();
    }
  }

  const scoreDOM = document.getElementById("score");
  if (scoreDOM) {
    scoreDOM.innerText = position.currentRow.toString();
    const colors = ["#ffffff", "#50e3c2", "#ffb703", "#ff70a6", "#70d6ff", "#ff9770", "#ffd670", "#e9ff70"];
    const colorIndex = Math.floor(position.currentRow / 20) % colors.length;
    scoreDOM.style.color = colors[colorIndex];
  }

  evaluateBoatRide();
}

function Renderer() {
  const canvas = document.querySelector("canvas.game");
  if (!canvas) throw new Error("Canvas not found");

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas: canvas,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  return renderer;
}

function RoadTunnelPortal(direction) {
  const portal = new THREE.Group();

  const stoneMat = new THREE.MeshLambertMaterial({
    color: 0x4d525c,
    flatShading: true,
  });
  const stoneDarkMat = new THREE.MeshLambertMaterial({
    color: 0x2a2d35,
    flatShading: true,
  });
  const trimMat = new THREE.MeshLambertMaterial({
    color: 0x7a8294,
    flatShading: true,
  });

  const portalDepth = 22;
  const portalWidth = tileSize + 12;
  const wallHeight = 38;

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(portalDepth, portalWidth, wallHeight),
    stoneDarkMat,
  );
  backWall.position.set(direction * (portalDepth / 2 + 4), 0, wallHeight / 2);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  portal.add(backWall);

  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(portalDepth + 10, portalWidth, 8),
    stoneMat,
  );
  lintel.position.set(direction * (portalDepth / 2 - 1), 0, wallHeight + 4);
  lintel.castShadow = true;
  portal.add(lintel);

  const lintelTrim = new THREE.Mesh(
    new THREE.BoxGeometry(portalDepth + 12, portalWidth - 10, 2),
    trimMat,
  );
  lintelTrim.position.set(direction * (portalDepth / 2 - 1), 0, wallHeight + 9);
  portal.add(lintelTrim);

  [-1, 1].forEach((sideY) => {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(10, 6, wallHeight + 4),
      stoneMat,
    );
    pillar.position.set(
      direction * 5,
      sideY * (tileSize / 2 + 1.5),
      (wallHeight + 4) / 2,
    );
    pillar.castShadow = true;
    portal.add(pillar);

    const pillarBase = new THREE.Mesh(
      new THREE.BoxGeometry(14, 8, 4),
      trimMat,
    );
    pillarBase.position.set(
      direction * 5,
      sideY * (tileSize / 2 + 1.5),
      2,
    );
    portal.add(pillarBase);
  });

  return portal;
}

function Road(rowIndex) {
  const road = new THREE.Group();
  road.position.y = rowIndex * tileSize;

  const createSection = (color) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(tilesPerRow * tileSize, tileSize),
      new THREE.MeshLambertMaterial({ color }),
    );

  const middle = createSection(0x454a59);
  middle.receiveShadow = true;
  road.add(middle);

  const left = createSection(0x393d49);
  left.position.x = -tilesPerRow * tileSize;
  road.add(left);

  const right = createSection(0x393d49);
  right.position.x = tilesPerRow * tileSize;
  road.add(right);

  const curbMat = new THREE.MeshLambertMaterial({
    color: 0xd6d8dd,
    flatShading: true,
  });
  const curbFront = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, 1.5, 2),
    curbMat,
  );
  curbFront.position.set(0, tileSize / 2 - 0.5, 1);
  road.add(curbFront);

  const curbBack = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, 1.5, 2),
    curbMat,
  );
  curbBack.position.set(0, -tileSize / 2 + 0.5, 1);
  road.add(curbBack);

  const tunnelL = RoadTunnelPortal(-1);
  tunnelL.position.x = -(tilesPerRow / 2 + 0.5) * tileSize;
  road.add(tunnelL);

  const tunnelR = RoadTunnelPortal(1);
  tunnelR.position.x = (tilesPerRow / 2 + 0.5) * tileSize;
  road.add(tunnelR);

  road.add(MapEdgeRocks({ tunnelGap: true }));

  return road;
}

function River(rowIndex, opts = {}) {
  const river = new THREE.Group();
  river.position.y = rowIndex * tileSize;
  const bankBackEnabled = opts.bankBack !== false;
  const bankFrontEnabled = opts.bankFront !== false;
  const flowDirection = opts.direction === false ? -1 : 1;

  const waterMat = new THREE.MeshLambertMaterial({ color: 0x3aa3d6 });
  const sideMat = new THREE.MeshLambertMaterial({ color: 0x276f9f });

  const middle = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, tileSize, 3),
    waterMat,
  );
  middle.receiveShadow = true;
  river.add(middle);

  const left = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, tileSize, 3),
    sideMat,
  );
  left.position.x = -tilesPerRow * tileSize;
  river.add(left);

  const right = new THREE.Mesh(
    new THREE.BoxGeometry(tilesPerRow * tileSize, tileSize, 3),
    sideMat,
  );
  right.position.x = tilesPerRow * tileSize;
  river.add(right);

  addRiverFlowDecorations(river, flowDirection);

  const bankMat = new THREE.MeshLambertMaterial({
    color: 0x8a6f4a,
    flatShading: true,
  });
  if (bankFrontEnabled) {
    const bankFront = new THREE.Mesh(
      new THREE.BoxGeometry(tilesPerRow * tileSize, 3, 6),
      bankMat,
    );
    bankFront.position.set(0, tileSize / 2 - 1.5, 3);
    bankFront.receiveShadow = true;
    river.add(bankFront);
  }

  if (bankBackEnabled) {
    const bankBack = new THREE.Mesh(
      new THREE.BoxGeometry(tilesPerRow * tileSize, 3, 6),
      bankMat,
    );
    bankBack.position.set(0, -tileSize / 2 + 1.5, 3);
    bankBack.receiveShadow = true;
    river.add(bankBack);
  }

  river.add(MapEdgeRocks());

  return river;
}

function addRiverFlowDecorations(river, direction) {
  const flowMat = new THREE.MeshBasicMaterial({
    color: 0xcff8ff,
    transparent: true,
    opacity: 0.42,
  });
  const shimmerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.32,
  });
  const flowSpan = tilesPerRow * tileSize;
  const wrapPadding = 44;

  for (let i = 0; i < 10; i += 1) {
    const lineLength = randomElement([18, 24, 32, 42]);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(lineLength, 1.2, 0.5),
      i % 3 === 0 ? shimmerMat.clone() : flowMat.clone(),
    );
    line.position.set(
      (Math.random() - 0.5) * flowSpan,
      (Math.random() - 0.5) * tileSize * 0.72,
      2.25,
    );
    line.rotation.z = (Math.random() - 0.5) * 0.08;
    river.add(line);
    riverDecorations.push({
      type: "flow",
      mesh: line,
      material: line.material,
      direction,
      speed: randomElement([18, 24, 30, 36]),
      minX: -flowSpan / 2 - wrapPadding,
      maxX: flowSpan / 2 + wrapPadding,
      phase: Math.random() * Math.PI * 2,
    });
  }

}

function Boat(initialTileIndex, direction, color) {
  const boat = new THREE.Group();
  boat.position.x = initialTileIndex * tileSize;
  if (!direction) boat.rotation.z = Math.PI;

  const woodMat = new THREE.MeshLambertMaterial({
    color: 0x6b4226,
    flatShading: true,
  });
  const woodLightMat = new THREE.MeshLambertMaterial({
    color: 0x8b5a2b,
    flatShading: true,
  });
  const accentMat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
  });
  const cabinMat = new THREE.MeshLambertMaterial({
    color: 0xefe2c4,
    flatShading: true,
  });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(100, 28, 9), woodMat);
  hull.position.z = 5;
  hull.castShadow = true;
  hull.receiveShadow = true;
  boat.add(hull);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(96, 28, 1.5), woodLightMat);
  deck.position.z = 10.2;
  deck.receiveShadow = true;
  boat.add(deck);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(102, 30, 2), accentMat);
  stripe.position.z = 8.5;
  boat.add(stripe);

  const bow = new THREE.Mesh(new THREE.BoxGeometry(16, 18, 6), woodMat);
  bow.position.set(50, 0, 6.5);
  boat.add(bow);

  const stern = new THREE.Mesh(new THREE.BoxGeometry(8, 22, 7), woodMat);
  stern.position.set(-50, 0, 6.5);
  boat.add(stern);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(26, 18, 10), cabinMat);
  cabin.position.set(-22, 0, 16);
  cabin.castShadow = true;
  boat.add(cabin);

  const cabinWindow = new THREE.Mesh(
    new THREE.BoxGeometry(20, 18.5, 4),
    new THREE.MeshBasicMaterial({ color: 0x9bdcff }),
  );
  cabinWindow.position.set(-22, 0, 16);
  boat.add(cabinWindow);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(28, 20, 2), accentMat);
  roof.position.set(-22, 0, 22);
  roof.castShadow = true;
  boat.add(roof);

  const mast = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 22),
    new THREE.MeshLambertMaterial({ color: 0x4a3320, flatShading: true }),
  );
  mast.position.set(8, 0, 22);
  boat.add(mast);

  const flag = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 8, 5),
    new THREE.MeshLambertMaterial({ color: 0xff5252, flatShading: true }),
  );
  flag.position.set(8, 5, 30);
  boat.add(flag);

  return boat;
}

function LilyPad(initialTileIndex, color = 0x4f9b49) {
  const pad = new THREE.Group();
  pad.position.x = initialTileIndex * tileSize;

  const padMat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
  });
  const padDarkMat = new THREE.MeshLambertMaterial({
    color: 0x2f6e3c,
    flatShading: true,
  });
  const flowerMat = new THREE.MeshLambertMaterial({
    color: 0xffc4e1,
    flatShading: true,
  });
  const pollenMat = new THREE.MeshLambertMaterial({
    color: 0xfff0a8,
    flatShading: true,
  });

  const leaf = new THREE.Mesh(new THREE.CylinderGeometry(21, 23, 3, 28), padMat);
  leaf.rotation.x = Math.PI / 2;
  leaf.position.z = 4;
  leaf.castShadow = true;
  leaf.receiveShadow = true;
  pad.add(leaf);

  const notch = new THREE.Mesh(new THREE.BoxGeometry(14, 18, 3.2), padDarkMat);
  notch.position.set(15, 0, 4.3);
  notch.rotation.z = Math.PI / 4;
  pad.add(notch);

  const vein = new THREE.Mesh(new THREE.BoxGeometry(26, 2, 1), padDarkMat);
  vein.position.set(-2, 0, 6);
  pad.add(vein);

  const flowerCenter = new THREE.Mesh(
    new THREE.CylinderGeometry(3.5, 3.5, 2, 12),
    pollenMat,
  );
  flowerCenter.rotation.x = Math.PI / 2;
  flowerCenter.position.set(-7, 7, 7.2);
  pad.add(flowerCenter);

  for (let i = 0; i < 5; i += 1) {
    const petal = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 8, 1.5),
      flowerMat,
    );
    petal.position.set(-7, 7, 7.4);
    petal.rotation.z = (i / 5) * Math.PI * 2;
    pad.add(petal);
  }

  return pad;
}

function LogPlatform(initialTileIndex, color = 0x7a4c2b) {
  const log = new THREE.Group();
  log.position.x = initialTileIndex * tileSize;

  const barkMat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
  });
  const cutMat = new THREE.MeshLambertMaterial({
    color: 0xc28f5f,
    flatShading: true,
  });
  const ringMat = new THREE.MeshLambertMaterial({
    color: 0x6a3a20,
    flatShading: true,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(92, 24, 14), barkMat);
  body.position.z = 7;
  body.castShadow = true;
  body.receiveShadow = true;
  log.add(body);

  [-47, 47].forEach((x) => {
    const endCap = new THREE.Mesh(new THREE.BoxGeometry(3, 25, 15), cutMat);
    endCap.position.set(x, 0, 7);
    log.add(endCap);

    const ring = new THREE.Mesh(new THREE.BoxGeometry(3.4, 14, 8), ringMat);
    ring.position.set(x + (x < 0 ? -0.2 : 0.2), 0, 7);
    log.add(ring);
  });

  [-22, 7, 31].forEach((x, index) => {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(4, 25, 15.5),
      ringMat,
    );
    stripe.position.set(x, 0, 7.2);
    stripe.rotation.z = index % 2 === 0 ? 0.14 : -0.12;
    log.add(stripe);
  });

  return log;
}

function RiverStone(initialTileIndex, color = 0x7c8a90) {
  const stone = new THREE.Group();
  stone.position.x = initialTileIndex * tileSize;

  const stoneMat = new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
  });
  const highlightMat = new THREE.MeshLambertMaterial({
    color: 0xaeb8ba,
    flatShading: true,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(42, 29, 8), stoneMat);
  body.position.z = 4;
  body.rotation.z = 0.1;
  body.castShadow = true;
  body.receiveShadow = true;
  stone.add(body);

  const crown = new THREE.Mesh(new THREE.BoxGeometry(27, 18, 4), highlightMat);
  crown.position.set(-3, 1, 9);
  crown.rotation.z = -0.16;
  stone.add(crown);

  stone.userData.bodyMaterial = stoneMat;
  stone.userData.highlightMaterial = highlightMat;

  return stone;
}

const railwayLights = [];
const checkpointDecorations = [];
const riverDecorations = [];

const RAILWAY_LIGHT_ON_HEX = 0xff3030;
const RAILWAY_LIGHT_OFF_HEX = 0x4a1010;

function animateRailwayLights() {
  if (!railwayLights.length) return;
  const onPhase = Math.floor(performance.now() / 280) % 2;
  for (let i = 0; i < railwayLights.length; i++) {
    const entry = railwayLights[i];
    const active = Boolean(entry.rowData?.lightsActive);
    const lit = active && entry.phase === onPhase;
    entry.material.color.setHex(lit ? RAILWAY_LIGHT_ON_HEX : RAILWAY_LIGHT_OFF_HEX);
    if (entry.haloMaterial) {
      entry.haloMaterial.opacity = lit ? 0.28 : 0;
    }
  }
}

function animateCheckpointDecorations() {
  if (!checkpointDecorations.length) return;
  const now = performance.now();
  checkpointDecorations.forEach((entry) => {
    const wave = (Math.sin(now / entry.speed + entry.phase) + 1) / 2;
    if (entry.type === "bulb") {
      entry.material.color.setHex(wave > 0.5 ? entry.onHex : entry.offHex);
      entry.material.opacity = 0.72 + wave * 0.28;
    } else if (entry.type === "spark") {
      const pulse = 0.36 + wave * 0.9;
      entry.material.opacity = 0.18 + wave * 0.74;
      entry.mesh.scale.setScalar(pulse);
    }
  });
}

function animateRiverDecorations(delta) {
  if (!riverDecorations.length) return;
  const now = performance.now() / 1000;

  riverDecorations.forEach((entry) => {
    if (!entry.mesh) return;

    if (entry.type === "flow") {
      entry.mesh.position.x += entry.direction * entry.speed * delta;
      if (entry.direction > 0 && entry.mesh.position.x > entry.maxX) {
        entry.mesh.position.x = entry.minX;
      } else if (entry.direction < 0 && entry.mesh.position.x < entry.minX) {
        entry.mesh.position.x = entry.maxX;
      }
      entry.material.opacity =
        0.24 + (Math.sin(now * 2.2 + entry.phase) + 1) * 0.12;
      return;
    }

  });
}

function updateStoneWarning(ref, sinkWave) {
  const bodyMaterial = ref.userData.bodyMaterial;
  const highlightMaterial = ref.userData.highlightMaterial;
  const danger = THREE.MathUtils.clamp((-sinkWave - 0.08) / 0.52, 0, 1);

  if (bodyMaterial) {
    bodyMaterial.color.setHex(danger > 0.35 ? 0x56656a : 0x78888d);
  }
  if (highlightMaterial) {
    highlightMaterial.color.setHex(danger > 0.35 ? 0x8fa1a4 : 0xaeb8ba);
  }
}

function RailwayCrossingSign(direction, rowData) {
  const sign = new THREE.Group();

  const poleMat = new THREE.MeshLambertMaterial({
    color: 0xefefef,
    flatShading: true,
  });
  const whiteMat = new THREE.MeshLambertMaterial({
    color: 0xfafafa,
    flatShading: true,
  });
  const redMat = new THREE.MeshLambertMaterial({
    color: 0xd7262f,
    flatShading: true,
  });
  const grooveMat = new THREE.MeshLambertMaterial({
    color: 0xd9dde1,
    flatShading: true,
  });
  const blackMat = new THREE.MeshLambertMaterial({
    color: 0x1a1a1a,
    flatShading: true,
  });
  const yellowMat = new THREE.MeshLambertMaterial({
    color: 0xffd84a,
    flatShading: true,
  });

  const pole = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 56), poleMat);
  pole.position.z = 28;
  pole.castShadow = true;
  sign.add(pole);

  function addCrossbuckArm(rotationY) {
    const arm = new THREE.Group();
    arm.position.z = 54;
    arm.rotation.y = rotationY;

    const face = new THREE.Mesh(new THREE.BoxGeometry(34, 4.6, 5.2), whiteMat);
    face.castShadow = true;
    arm.add(face);

    [-2.65, 2.65].forEach((z) => {
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(34.5, 4.8, 0.8),
        redMat,
      );
      edge.position.z = z;
      edge.castShadow = true;
      arm.add(edge);
    });

    [-17.2, 17.2].forEach((x) => {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 4.8, 5.8),
        redMat,
      );
      cap.position.x = x;
      cap.castShadow = true;
      arm.add(cap);
    });

    [-8, 0, 8].forEach((x) => {
      const groove = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 4.9, 3.6),
        grooveMat,
      );
      groove.position.set(x, 0.05, 0);
      arm.add(groove);
    });

    sign.add(arm);
  }

  addCrossbuckArm(Math.PI / 4);
  addCrossbuckArm(-Math.PI / 4);

  const centerBolt = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 5.2, 5.2),
    new THREE.MeshLambertMaterial({ color: 0xb9bfc4, flatShading: true }),
  );
  centerBolt.position.z = 54;
  sign.add(centerBolt);

  [-1, 1].forEach((dy, idx) => {
    const lightMat = new THREE.MeshBasicMaterial({
      color: RAILWAY_LIGHT_OFF_HEX,
    });
    const light = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 6), lightMat);
    light.position.set(0, dy * 10, 40);
    sign.add(light);

    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
    });
    const halo = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 8),
      haloMat,
    );
    halo.position.copy(light.position);
    sign.add(halo);
    railwayLights.push({
      material: lightMat,
      haloMaterial: haloMat,
      phase: idx,
      rowData,
    });
  });

  const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 14, 12), yellowMat);
  panel.position.set(direction * -3, 0, 22);
  sign.add(panel);

  const panelStripe = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 10, 2),
    blackMat,
  );
  panelStripe.position.set(direction * -3.6, 0, 22);
  sign.add(panelStripe);

  const base = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 4), blackMat);
  base.position.z = 2;
  sign.add(base);

  return sign;
}

function Rail(rowIndex, rowData) {
  const rail = new THREE.Group();
  rail.position.y = rowIndex * tileSize;

  const groundMat = new THREE.MeshLambertMaterial({ color: 0x55504a });
  const middle = new THREE.Mesh(
    new THREE.PlaneGeometry(tilesPerRow * tileSize, tileSize),
    groundMat,
  );
  middle.receiveShadow = true;
  rail.add(middle);

  const sideMat = new THREE.MeshLambertMaterial({ color: 0x3f3b35 });
  const left = new THREE.Mesh(
    new THREE.PlaneGeometry(tilesPerRow * tileSize, tileSize),
    sideMat,
  );
  left.position.x = -tilesPerRow * tileSize;
  rail.add(left);

  const right = new THREE.Mesh(
    new THREE.PlaneGeometry(tilesPerRow * tileSize, tileSize),
    sideMat,
  );
  right.position.x = tilesPerRow * tileSize;
  rail.add(right);

  const tieMat = new THREE.MeshLambertMaterial({
    color: 0x4a3320,
    flatShading: true,
  });
  const tieSpacing = 14;
  const totalSpan = tilesPerRow * tileSize * 3;
  const tieCount = Math.ceil(totalSpan / tieSpacing);
  const startX = -((tieCount - 1) / 2) * tieSpacing;
  for (let i = 0; i < tieCount; i++) {
    const tie = new THREE.Mesh(
      new THREE.BoxGeometry(7, tileSize * 0.85, 2),
      tieMat,
    );
    tie.position.set(startX + i * tieSpacing, 0, 1);
    rail.add(tie);
  }

  const railMetalMat = new THREE.MeshLambertMaterial({
    color: 0x9aa0a8,
    flatShading: true,
  });
  [-1, 1].forEach((side) => {
    const r = new THREE.Mesh(
      new THREE.BoxGeometry(totalSpan, 2, 3),
      railMetalMat,
    );
    r.position.set(0, side * 9, 3);
    rail.add(r);
  });

  const sign = RailwayCrossingSign(1, rowData);
  sign.position.set(0, -tileSize / 2 + 4, 0);
  rail.add(sign);

  rail.add(MapEdgeRocks());

  return rail;
}

function Train(initialTileIndex, direction, isLocomotive, color) {
  const car = new THREE.Group();
  car.position.x = initialTileIndex * tileSize;
  if (!direction) car.rotation.z = Math.PI;

  if (isLocomotive) {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(72, 36, 30),
      new THREE.MeshLambertMaterial({ color, flatShading: true }),
    );
    body.position.set(-4, 0, 22);
    body.castShadow = true;
    body.receiveShadow = true;
    car.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(28, 30, 22),
      new THREE.MeshLambertMaterial({ color: 0x222a44, flatShading: true }),
    );
    cabin.position.set(-22, 0, 48);
    cabin.castShadow = true;
    car.add(cabin);

    const window1 = new THREE.Mesh(
      new THREE.BoxGeometry(2, 14, 8),
      new THREE.MeshBasicMaterial({ color: 0x9bdcff }),
    );
    window1.position.set(-7.5, 0, 50);
    car.add(window1);

    const stack = new THREE.Mesh(
      new THREE.BoxGeometry(8, 8, 14),
      new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true }),
    );
    stack.position.set(16, 0, 44);
    stack.castShadow = true;
    car.add(stack);

    const stackTop = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 2),
      new THREE.MeshLambertMaterial({ color: 0x000000, flatShading: true }),
    );
    stackTop.position.set(16, 0, 51.5);
    car.add(stackTop);

    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(2, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff4b0 }),
    );
    headlight.position.set(33, 0, 22);
    car.add(headlight);

    const grill = new THREE.Mesh(
      new THREE.BoxGeometry(8, 32, 14),
      new THREE.MeshLambertMaterial({ color: 0xc9c9c9, flatShading: true }),
    );
    grill.position.set(36, 0, 12);
    grill.castShadow = true;
    car.add(grill);
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(72, 34, 30),
      new THREE.MeshLambertMaterial({ color, flatShading: true }),
    );
    body.position.z = 22;
    body.castShadow = true;
    body.receiveShadow = true;
    car.add(body);

    const top = new THREE.Mesh(
      new THREE.BoxGeometry(70, 36, 2),
      new THREE.MeshLambertMaterial({ color: 0x42485a, flatShading: true }),
    );
    top.position.z = 38;
    car.add(top);

    const sideStripe = new THREE.Mesh(
      new THREE.BoxGeometry(60, 36.5, 4),
      new THREE.MeshBasicMaterial({ color: 0x9bdcff }),
    );
    sideStripe.position.z = 28;
    car.add(sideStripe);

    [-1, 1].forEach((side) => {
      const coupler = new THREE.Mesh(
        new THREE.BoxGeometry(3, 5, 3),
        new THREE.MeshLambertMaterial({ color: 0x444444, flatShading: true }),
      );
      coupler.position.set(side * 38, 0, 12);
      car.add(coupler);
    });
  }

  [-26, 0, 26].forEach((x) => {
    const wheel = new THREE.Mesh(
      new THREE.BoxGeometry(8, 36, 8),
      new THREE.MeshLambertMaterial({ color: 0x222222, flatShading: true }),
    );
    wheel.position.set(x, 0, 5);
    car.add(wheel);
  });

  return car;
}

function Tree(tileIndex, height, variant = "round") {
  const tree = new THREE.Group();
  tree.position.x = tileIndex * tileSize;

  const trunk = new THREE.Mesh(
    new THREE.BoxGeometry(12, 12, 20),
    new THREE.MeshLambertMaterial({
      color: 0x6b4226,
      flatShading: true,
    }),
  );
  trunk.position.z = 10;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  tree.add(trunk);

  if (variant === "pine") {
    const tiers = 3;
    const tierH = height / tiers;
    for (let i = 0; i < tiers; i++) {
      const size = 32 - i * 8;
      const shade = i === 0 ? 0x2f7a3a : i === 1 ? 0x3d8f47 : 0x4fa558;
      const tier = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, tierH),
        new THREE.MeshLambertMaterial({ color: shade, flatShading: true }),
      );
      tier.position.z = 20 + i * tierH + tierH / 2;
      tier.castShadow = true;
      tier.receiveShadow = true;
      tree.add(tier);
    }
  } else {
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(30, 30, height),
      new THREE.MeshLambertMaterial({
        color: 0x7aa21d,
        flatShading: true,
      }),
    );
    crown.position.z = height / 2 + 20;
    crown.castShadow = true;
    crown.receiveShadow = true;
    tree.add(crown);

    const crownTop = new THREE.Mesh(
      new THREE.BoxGeometry(22, 22, 8),
      new THREE.MeshLambertMaterial({
        color: 0x94c043,
        flatShading: true,
      }),
    );
    crownTop.position.z = height + 20 + 4;
    crownTop.castShadow = true;
    tree.add(crownTop);

    const bump = new THREE.Mesh(
      new THREE.BoxGeometry(10, 10, 6),
      new THREE.MeshLambertMaterial({
        color: 0x5c8510,
        flatShading: true,
      }),
    );
    bump.position.set(6, 6, height / 2 + 20 + height / 4);
    tree.add(bump);
  }

  return tree;
}

function Truck(initialTileIndex, direction, color) {
  const truck = new THREE.Group();
  truck.position.x = initialTileIndex * tileSize;
  if (!direction) truck.rotation.z = Math.PI;

  const cargo = new THREE.Mesh(
    new THREE.BoxGeometry(70, 35, 35),
    new THREE.MeshLambertMaterial({
      color: 0xf2f2f2,
      flatShading: true,
    }),
  );
  cargo.position.x = -15;
  cargo.position.z = 25;
  cargo.castShadow = true;
  cargo.receiveShadow = true;
  truck.add(cargo);

  const cargoStripe = new THREE.Mesh(
    new THREE.BoxGeometry(72, 37, 3),
    new THREE.MeshLambertMaterial({ color, flatShading: true }),
  );
  cargoStripe.position.set(-15, 0, 22);
  truck.add(cargoStripe);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), [
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckFrontTexture,
    }),
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
    }),
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckLeftSideTexture,
    }),
    new THREE.MeshLambertMaterial({
      color,
      flatShading: true,
      map: truckRightSideTexture,
    }),
    new THREE.MeshPhongMaterial({ color, flatShading: true }),
    new THREE.MeshPhongMaterial({ color, flatShading: true }),
  ]);
  cabin.position.x = 35;
  cabin.position.z = 20;
  cabin.castShadow = true;
  cabin.receiveShadow = true;

  truck.add(cabin);

  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff4b0 });
  const headlightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    headlightMat,
  );
  headlightL.position.set(50.5, -10, 12);
  truck.add(headlightL);

  const headlightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    headlightMat,
  );
  headlightR.position.set(50.5, 10, 12);
  truck.add(headlightR);

  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff4d4d });
  const taillightL = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    taillightMat,
  );
  taillightL.position.set(-50.5, -12, 15);
  truck.add(taillightL);

  const taillightR = new THREE.Mesh(
    new THREE.BoxGeometry(1, 4, 3),
    taillightMat,
  );
  taillightR.position.set(-50.5, 12, 15);
  truck.add(taillightR);

  const exhaust = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 12),
    new THREE.MeshLambertMaterial({ color: 0x555555, flatShading: true }),
  );
  exhaust.position.set(25, -15, 43);
  truck.add(exhaust);

  const frontWheel = Wheel(37);
  truck.add(frontWheel);

  const middleWheel = Wheel(5);
  truck.add(middleWheel);

  const backWheel = Wheel(-35);
  truck.add(backWheel);

  return truck;
}

function Wheel(x) {
  const wheel = new THREE.Mesh(
    new THREE.BoxGeometry(12, 33, 12),
    new THREE.MeshLambertMaterial({
      color: 0x333333,
      flatShading: true,
    }),
  );
  wheel.position.x = x;
  wheel.position.z = 6;
  return wheel;
}

function calculateFinalPosition(currentPosition, moves) {
  return moves.reduce((position, direction) => {
    if (direction === "forward")
      return {
        rowIndex: position.rowIndex + 1,
        tileIndex: position.tileIndex,
      };
    if (direction === "backward")
      return {
        rowIndex: position.rowIndex - 1,
        tileIndex: position.tileIndex,
      };
    if (direction === "left")
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex - 1,
      };
    if (direction === "right")
      return {
        rowIndex: position.rowIndex,
        tileIndex: position.tileIndex + 1,
      };
    return position;
  }, currentPosition);
}

function endsUpInValidPosition(currentPosition, moves) {
  const finalPosition = calculateFinalPosition(currentPosition, moves);
  if (
    finalPosition.rowIndex === -1 ||
    finalPosition.tileIndex === minTileIndex - 1 ||
    finalPosition.tileIndex === maxTileIndex + 1
  ) {
    return false;
  }
  const finalRow = metadata[finalPosition.rowIndex - 1];
  if (
    finalRow &&
    finalRow.type === "forest" &&
    finalRow.trees.some((tree) => tree.tileIndex === finalPosition.tileIndex)
  ) {
    return false;
  }

  return true;
}

function generateRows(amount, startIndex) {
  const rows = [];
  for (let i = 0; i < amount; i++) {
    const rowIndex = startIndex + i + 1;
    rows.push(generateRow(rowIndex));
  }
  return rows;
}

function resetRiverLayoutMemory() {
  lastRiverPlatformOffset = null;
  currentRiverSegmentStartDirection = null;
  currentRiverSegmentLineIndex = 0;
}

function generateRow(rowIndex) {
  if (trainCooldownRows > 0) {
    trainCooldownRows = Math.max(0, trainCooldownRows - 1);
  }
  if (riverCooldownRows > 0) {
    riverCooldownRows = Math.max(0, riverCooldownRows - 1);
  }
  if (rowIndex > 0 && rowIndex % CP_INTERVAL === 0) {
    pendingRoadRowsInSegment = 0;
    pendingRiverRowsInSegment = 0;
    consecutiveRoadRows = 0;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    return generateCheckpointMetadata();
  }

  const nearCheckpoint = isNearCheckpointRow(rowIndex);

  if (pendingRiverRowsInSegment > 0) {
    if (nearCheckpoint) {
      pendingRiverRowsInSegment = 0;
      consecutiveRiverRows = 0;
    } else {
      const isLastRiverRow = pendingRiverRowsInSegment === 1;
      pendingRiverRowsInSegment -= 1;
      consecutiveRiverRows += 1;
      pendingRoadRowsInSegment = 0;
      consecutiveRoadRows = 0;
      return generateRiverMetadata({
        bankBack: false,
        bankFront: isLastRiverRow,
        direction: nextRiverLineDirection(),
      });
    }
  }

  if (shouldStartRiverSegment(rowIndex, nearCheckpoint)) {
    const segmentLength = getRiverSegmentLength(rowIndex);
    if (segmentLength > 0) {
      pendingRiverRowsInSegment = Math.max(0, segmentLength - 1);
      riverCooldownRows = RIVER_SEGMENT_COOLDOWN_ROWS + segmentLength;
      consecutiveRiverRows = 1;
      pendingRoadRowsInSegment = 0;
      consecutiveRoadRows = 0;
      return generateRiverMetadata({
        bankBack: true,
        bankFront: segmentLength === 1,
        direction: nextRiverLineDirection(),
      });
    }
  }

  if (nearCheckpoint && consecutiveRiverRows > 0) {
    pendingRoadRowsInSegment = 0;
    pendingRiverRowsInSegment = 0;
    consecutiveRoadRows = 0;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    return generateForesMetadata();
  }
  if (consecutiveRoadRows >= MAX_CONSECUTIVE_ROAD_ROWS) {
    pendingRoadRowsInSegment = 0;
    pendingRiverRowsInSegment = 0;
    consecutiveRoadRows = 0;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    return generateForesMetadata();
  }

  if (pendingRoadRowsInSegment > 0) {
    pendingRoadRowsInSegment -= 1;
    consecutiveRoadRows += 1;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    return generateRoadLaneMetadata();
  }
  if (
    trainCooldownRows === 0 &&
    !isTrainBlockedNearCheckpoint(rowIndex) &&
    Date.now() >= nextTrainRowAtMs
  ) {
    pendingRoadRowsInSegment = 0;
    pendingRiverRowsInSegment = 0;
    consecutiveRoadRows = 0;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    nextTrainRowAtMs =
      Date.now() + THREE.MathUtils.randInt(TRAIN_SPAWN_MIN_MS, TRAIN_SPAWN_MAX_MS);
    trainCooldownRows = TRAIN_COOLDOWN_ROWS;
    return generateTrainLaneMetadata();
  }

  const shouldStartRoadSegment = Math.random() < 0.65;
  if (shouldStartRoadSegment) {
    const maxLength = Math.max(1, MAX_CONSECUTIVE_ROAD_ROWS - consecutiveRoadRows);
    const segmentLength = THREE.MathUtils.randInt(1, maxLength);
    pendingRoadRowsInSegment = Math.max(0, segmentLength - 1);
    consecutiveRoadRows += 1;
    consecutiveRiverRows = 0;
    resetRiverLayoutMemory();
    return generateRoadLaneMetadata();
  }

  consecutiveRoadRows = 0;
  consecutiveRiverRows = 0;
  resetRiverLayoutMemory();
  return generateForesMetadata();
}

function isNearCheckpointRow(rowIndex) {
  if (rowIndex <= 0) return false;
  const checkpointRemainder = rowIndex % CP_INTERVAL;
  const rowsUntilCheckpoint =
    checkpointRemainder === 0 ? 0 : CP_INTERVAL - checkpointRemainder;
  return (
    checkpointRemainder <= RIVER_CHECKPOINT_BUFFER_ROWS ||
    rowsUntilCheckpoint <= RIVER_CHECKPOINT_BUFFER_ROWS
  );
}

function isTrainBlockedNearCheckpoint(rowIndex) {
  if (rowIndex <= 0) return true;
  const checkpointRemainder = rowIndex % CP_INTERVAL;
  const rowsUntilCheckpoint =
    checkpointRemainder === 0 ? 0 : CP_INTERVAL - checkpointRemainder;
  return (
    checkpointRemainder <= TRAIN_CHECKPOINT_BUFFER_ROWS ||
    rowsUntilCheckpoint <= RIVER_CHECKPOINT_BUFFER_ROWS
  );
}

function getRowsUntilCheckpoint(rowIndex) {
  if (rowIndex <= 0) return CP_INTERVAL;
  const checkpointRemainder = rowIndex % CP_INTERVAL;
  return checkpointRemainder === 0 ? CP_INTERVAL : CP_INTERVAL - checkpointRemainder;
}

function nextRiverLineDirection() {
  if (currentRiverSegmentStartDirection == null) {
    currentRiverSegmentStartDirection = Math.random() >= 0.5;
    currentRiverSegmentLineIndex = 0;
  }
  const isEvenLine = currentRiverSegmentLineIndex % 2 === 0;
  const direction = isEvenLine
    ? currentRiverSegmentStartDirection
    : !currentRiverSegmentStartDirection;
  currentRiverSegmentLineIndex += 1;
  return direction;
}

function getRiverSegmentLength(rowIndex) {
  const rowsBeforeCheckpointBuffer =
    getRowsUntilCheckpoint(rowIndex) - RIVER_CHECKPOINT_BUFFER_ROWS;
  const maxLength = Math.min(
    MAX_CONSECUTIVE_RIVER_ROWS,
    Math.max(0, rowsBeforeCheckpointBuffer),
  );
  if (maxLength <= 0) return 0;
  return THREE.MathUtils.randInt(1, maxLength);
}

function shouldStartRiverSegment(rowIndex, nearCheckpoint) {
  return (
    rowIndex >= RIVER_SAFE_START_ROW &&
    !nearCheckpoint &&
    riverCooldownRows === 0 &&
    consecutiveRiverRows < MAX_CONSECUTIVE_RIVER_ROWS &&
    Math.random() < RIVER_SEGMENT_START_CHANCE
  );
}

function generateRoadLaneMetadata() {
  const profile = randomElement(["city", "heavy", "fast", "mixed", "service"]);
  if (profile === "city") {
    return generateVehicleLaneMetadata({
      type: "car",
      speed: randomElement([65, 80, 95]),
      kinds: ["car", "taxi", "coupe", "car"],
    });
  }
  if (profile === "heavy") {
    return generateVehicleLaneMetadata({
      type: "truck",
      speed: randomElement([50, 65, 80]),
      kinds: ["truck", "truck"],
    });
  }
  if (profile === "fast") {
    return generateVehicleLaneMetadata({
      type: "car",
      speed: randomElement([100, 120, 140]),
      kinds: ["car", "coupe", "truck"],
    });
  }
  if (profile === "service") {
    return generateVehicleLaneMetadata({
      type: "car",
      speed: randomElement([75, 95, 115]),
      kinds: ["car", "police"],
    });
  }
  return generateVehicleLaneMetadata({
    type: "car",
    speed: randomElement([75, 90, 105]),
    kinds: ["car", "taxi", "truck"],
  });
}

function generateVehicleLaneMetadata({ type, speed, kinds }) {
  const direction = randomElement([true, false]);
  const shuffledKinds = shuffleArray(kinds);
  const vehicles = [];
  const occupiedTiles = new Set();

  shuffledKinds.forEach((kind) => {
    const initialTileIndex = findOpenVehicleTile(occupiedTiles, kind);
    markVehicleTiles(occupiedTiles, initialTileIndex, kind);
    vehicles.push({
      kind,
      initialTileIndex,
      color: getVehicleColor(kind),
    });
  });

  return { type, direction, speed, vehicles };
}

function findOpenVehicleTile(occupiedTiles, kind) {
  const footprint = getVehicleTileFootprint(kind);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const tile = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    let open = true;
    const safeGap = 1;
    for (let offset = -footprint - safeGap; offset <= footprint + safeGap; offset += 1) {
      if (occupiedTiles.has(tile + offset)) {
        open = false;
        break;
      }
    }
    if (open) return tile;
  }
  return THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
}

function markVehicleTiles(occupiedTiles, tile, kind) {
  const footprint = getVehicleTileFootprint(kind);
  for (let offset = -footprint; offset <= footprint; offset += 1) {
    occupiedTiles.add(tile + offset);
  }
}

function getVehicleTileFootprint(kind) {
  if (kind === "truck") return 2;
  return 1;
}

function getVehicleColor(kind) {
  if (kind === "taxi") {
    return 0xffd64a;
  }
  if (kind === "police") {
    return 0x111827;
  }
  if (kind === "coupe") {
    return randomElement([0xf4a261, 0x2a9d8f, 0xe76f51, 0x457b9d]);
  }
  if (kind === "truck") {
    return randomElement([0x1d3557, 0xe63946, 0x2a9d8f, 0xe76f51, 0x6d597a]);
  }
  return randomElement([
    0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xe76f51, 0xffb703, 0x9b5de5,
    0x06d6a0,
  ]);
}

function generateCheckpointMetadata() {
  return { type: "forest", trees: [], isCheckpoint: true };
}

function generateRiverMetadata({
  bankBack = true,
  bankFront = true,
  direction = true,
} = {}) {
  const speed = randomElement([42, 54, 66, 78]);
  const platformPattern = "mixed";
  const platformKinds = shuffleArray(["lily", "log", "stone", "boat"]);
  const platformCount = platformKinds.length;
  const stride = Math.max(1, Math.floor(tilesPerRow / platformCount));
  const offsetOptions = Array.from({ length: stride }, (_, index) => index);
  const availableOffsets =
    lastRiverPlatformOffset == null
      ? offsetOptions
      : offsetOptions.filter((option) => option !== lastRiverPlatformOffset);
  const offset = randomElement(availableOffsets.length ? availableOffsets : offsetOptions);
  lastRiverPlatformOffset = offset;
  const platforms = Array.from({ length: platformCount }, (_, i) => {
    let tile = minTileIndex + offset + i * stride;
    if (tile > maxTileIndex) tile -= tilesPerRow;
    const kind = platformKinds[i % platformKinds.length];
    return {
      kind,
      initialTileIndex: tile,
      color: getRiverPlatformColor(kind),
      rideHalfWidth: getRiverPlatformRideHalfWidth(kind),
      bobPhase: Math.random() * Math.PI * 2,
      bobAmplitude: kind === "lily" || kind === "stone" ? 1.8 : 0.8,
      submergePhase: Math.random() * Math.PI * 2,
      submergeSpeed: kind === "stone" ? randomElement([0.45, 0.55, 0.65]) : 0,
    };
  });

  return {
    type: "river",
    platforms,
    direction,
    speed,
    platformPattern,
    bankBack,
    bankFront,
  };
}

function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = THREE.MathUtils.randInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getRiverPlatformColor(kind) {
  if (kind === "lily") {
    return randomElement([0x3d8f4d, 0x54a65b, 0x2f7d46, 0x6dbb63]);
  }
  if (kind === "log") {
    return randomElement([0x6b4226, 0x7a4c2b, 0x8b5a2b, 0x5f351f]);
  }
  if (kind === "stone") {
    return randomElement([0x66767d, 0x78888d, 0x5f6f76, 0x849093]);
  }
  return randomElement([0xc94a4a, 0xe6a23c, 0x7c5cff, 0x4ecdc4, 0xf76b8a]);
}

function getRiverPlatformRideHalfWidth(kind) {
  if (kind === "lily") return LILY_PAD_HALF_WIDTH;
  if (kind === "log") return LOG_HALF_WIDTH;
  if (kind === "stone") return STONE_HALF_WIDTH;
  return BOAT_HALF_WIDTH;
}

function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateForesMetadata() {
  const occupiedTiles = new Set();
  const trees = Array.from({ length: 4 }, () => {
    let tileIndex;
    do {
      tileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(tileIndex));
    occupiedTiles.add(tileIndex);

    const height = randomElement([20, 45, 60]);
    const variant = randomElement(["round", "round", "pine"]);

    return { tileIndex, height, variant };
  });

  return { type: "forest", trees };
}

function generateCarLaneMetadata() {
  const direction = randomElement([true, false]);
  const speed = randomElement([70, 90, 110]);

  const occupiedTiles = new Set();

  const vehicles = Array.from({ length: 3 }, () => {
    let initialTileIndex;
    do {
      initialTileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);

    const color = randomElement([
      0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xe76f51, 0xffb703, 0x9b5de5,
      0x06d6a0,
    ]);

    return { initialTileIndex, color };
  });

  return { type: "car", direction, speed, vehicles };
}

function generateTruckLaneMetadata() {
  const direction = randomElement([true, false]);
  const speed = randomElement([130, 165, 200]);

  const occupiedTiles = new Set();

  const vehicles = Array.from({ length: 2 }, () => {
    let initialTileIndex;
    do {
      initialTileIndex = THREE.MathUtils.randInt(minTileIndex, maxTileIndex);
    } while (occupiedTiles.has(initialTileIndex));
    occupiedTiles.add(initialTileIndex - 2);
    occupiedTiles.add(initialTileIndex - 1);
    occupiedTiles.add(initialTileIndex);
    occupiedTiles.add(initialTileIndex + 1);
    occupiedTiles.add(initialTileIndex + 2);

    const color = randomElement([
      0x1d3557, 0xe63946, 0x2a9d8f, 0xe76f51, 0x6d597a, 0x8338ec,
    ]);

    return { initialTileIndex, color };
  });

  return { type: "truck", direction, speed, vehicles };
}

function generateTrainLaneMetadata() {
  const direction = randomElement([true, false]);
  const speed = randomElement([220, 250, 280]);
  const trainGapMs = THREE.MathUtils.randInt(
    TRAIN_LOOP_GAP_MIN_MS,
    TRAIN_LOOP_GAP_MAX_MS,
  );

  const carCount = 6;
  const segmentSpacing = 2;
  const maxStart = Math.max(
    minTileIndex,
    maxTileIndex - (carCount - 1) * segmentSpacing,
  );
  const startTile = THREE.MathUtils.randInt(minTileIndex, maxStart);
  const locomotiveColor = randomElement([0x1a3a6e, 0x6b1f1f, 0x3a5e2c, 0x4a2c5e]);
  const carColor = randomElement([0x9a5b3f, 0xc7a04a, 0x4d738a, 0x6f7a8c]);

  const vehicles = Array.from({ length: carCount }, (_, i) => ({
    initialTileIndex: startTile + i * segmentSpacing,
    color: i === 0 ? locomotiveColor : carColor,
    isLocomotive: i === 0,
  }));

  return { type: "train", direction, speed, vehicles, trainGapMs, lightsActive: false };
}

const moveClock = new THREE.Clock(false);

function animatePlayer() {
  if (!movesQueue.length) {
    if (position.ridingBoat && !gameOver) {
      if (position.ridingBoat.userData.isSubmerged) {
        onDrown();
        return;
      }
      const platformX = position.ridingBoat.position.x;
      const newTile = Math.round(platformX / tileSize);
      if (newTile < minTileIndex || newTile > maxTileIndex) {
        onDrown();
        return;
      }
      player.position.x = platformX;
      player.position.z =
        PLAYER_PLATFORM_RIDE_Z + (position.ridingBoat.position.z || 0);
      position.currentTile = newTile;
    }
    return;
  }

  if (!moveClock.running) {
    moveClock.start();
    moveStartX = player.position.x;
    moveStartY = player.position.y;
  }

  const stepTime = 0.2;
  const progress = Math.min(1, moveClock.getElapsedTime() / stepTime);

  setPosition(progress);
  setRotation(progress);
  if (progress >= 1) {
    stepCompleted();
    moveClock.stop();
  }
}

function setPosition(progress) {
  let endX = position.currentTile * tileSize;
  let endY = position.currentRow * tileSize;

  if (movesQueue[0] === "left") endX -= tileSize;
  if (movesQueue[0] === "right") endX += tileSize;
  if (movesQueue[0] === "forward") endY += tileSize;
  if (movesQueue[0] === "backward") endY -= tileSize;

  player.position.x = THREE.MathUtils.lerp(moveStartX, endX, progress);
  player.position.y = THREE.MathUtils.lerp(moveStartY, endY, progress);
  player.children[0].position.z = Math.sin(progress * Math.PI) * 8;
}

function setRotation(progress) {
  let endRotation = 0;
  if (movesQueue[0] == "forward") endRotation = 0;
  if (movesQueue[0] == "left") endRotation = Math.PI / 2;
  if (movesQueue[0] == "right") endRotation = -Math.PI / 2;
  if (movesQueue[0] == "backward") endRotation = Math.PI;

  player.children[0].rotation.z = THREE.MathUtils.lerp(
    player.children[0].rotation.z,
    endRotation,
    progress,
  );
}

const clock = new THREE.Clock();

function animateVehicles(delta = clock.getDelta()) {
  const playerX = position.currentTile * tileSize;
  const playerRowIndex = position.currentRow - 1;
  const speedMultiplier = bet.active
    ? Math.pow(SPEED_MULT_PER_CP, bet.currentCp)
    : 1;

  const beginningOfRow = (minTileIndex - 2) * tileSize;
  const endOfRow = (maxTileIndex + 2) * tileSize;

  metadata.forEach((rowData, rowIndex) => {
    if (
      rowData.type === "car" ||
      rowData.type === "truck" ||
      rowData.type === "train"
    ) {
      const effectiveSpeed = rowData.speed * speedMultiplier;
      const trainGapDistance =
        rowData.type === "train" && rowData.trainGapMs
          ? (effectiveSpeed * rowData.trainGapMs) / 1000
          : 0;

      if (rowIndex === playerRowIndex) {
        const nearPlayer = rowData.vehicles.some(({ ref }) =>
          ref ? Math.abs(ref.position.x - playerX) < tileSize * 0.7 : false,
        );
        if (nearPlayer) {
          if (rowData.type === "train") {
            playTrainPassSfx();
          } else if (Math.random() < 0.7) {
            playHornSfx();
          }
        }
      }

      if (rowData.type === "train") {
        rowData.lightsActive = rowData.vehicles.some(({ ref }) =>
          ref ? Math.abs(ref.position.x) < tilesPerRow * tileSize * 0.62 : false,
        );
      }

      rowData.vehicles.forEach(({ ref }) => {
        if (!ref) throw Error("Vehicle reference is missing");

        if (rowData.direction) {
          ref.position.x =
            ref.position.x > endOfRow
              ? beginningOfRow - trainGapDistance
              : ref.position.x + effectiveSpeed * delta;
        } else {
          ref.position.x =
            ref.position.x < beginningOfRow
              ? endOfRow + trainGapDistance
              : ref.position.x - effectiveSpeed * delta;
        }
      });
    }

    if (rowData.type === "river") {
      const boatSpeed = rowData.speed;
      const platforms = getRiverPlatforms(rowData);
      const now = performance.now() / 1000;

      platforms.forEach(({ ref }) => {
        if (!ref) return;

        if (rowData.direction) {
          ref.position.x =
            ref.position.x > endOfRow
              ? beginningOfRow
              : ref.position.x + boatSpeed * delta;
        } else {
          ref.position.x =
            ref.position.x < beginningOfRow
              ? endOfRow
              : ref.position.x - boatSpeed * delta;
        }

        const baseZ = ref.userData.baseZ || 0;
        const bobPhase = ref.userData.bobPhase || 0;
        const bobAmplitude = ref.userData.bobAmplitude || 0;
        const platformKind = ref.userData.platformKind;
        let submergeOffset = 0;
        if (platformKind === "stone") {
          const submergePhase = ref.userData.submergePhase || 0;
          const submergeSpeed = ref.userData.submergeSpeed || 0.55;
          const sinkWave = Math.sin(now * submergeSpeed + submergePhase);
          updateStoneWarning(ref, sinkWave);
          ref.userData.isSubmerged = sinkWave < -0.45;
          submergeOffset = ref.userData.isSubmerged ? -11 : 0;
        } else {
          ref.userData.isSubmerged = false;
        }
        ref.position.z =
          baseZ + Math.sin(now * 2.4 + bobPhase) * bobAmplitude + submergeOffset;
      });
    }
  });
}

document
  .getElementById("forward")
  ?.addEventListener("click", () => queueMove("forward"));

document
  .getElementById("backward")
  ?.addEventListener("click", () => queueMove("backward"));

document
  .getElementById("left")
  ?.addEventListener("click", () => queueMove("left"));

document
  .getElementById("right")
  ?.addEventListener("click", () => queueMove("right"));

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  ) {
    return;
  }

  const key = String(event.key || "").toLowerCase();
  if (event.key === "ArrowUp" || key === "w") {
    event.preventDefault();
    queueMove("forward");
  } else if (event.key === "ArrowDown" || key === "s") {
    event.preventDefault();
    queueMove("backward");
  } else if (event.key === "ArrowLeft" || key === "a") {
    event.preventDefault();
    queueMove("left");
  } else if (event.key === "ArrowRight" || key === "d") {
    event.preventDefault();
    queueMove("right");
  }
});

const SWIPE_MIN_DISTANCE_PX = 24;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeTracking = false;

const gameCanvas = document.querySelector("canvas.game");
if (gameCanvas) {
  gameCanvas.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length !== 1) {
        swipeTracking = false;
        return;
      }
      const touch = event.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;
      swipeTracking = true;
    },
    { passive: true },
  );

  gameCanvas.addEventListener(
    "touchmove",
    (event) => {
      if (!swipeTracking) return;
      event.preventDefault();
    },
    { passive: false },
  );

  gameCanvas.addEventListener(
    "touchend",
    (event) => {
      if (!swipeTracking) return;
      swipeTracking = false;

      const touch = event.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (
        absX < SWIPE_MIN_DISTANCE_PX &&
        absY < SWIPE_MIN_DISTANCE_PX
      ) {
        queueMove("forward");
        return;
      }

      if (absX > absY) {
        queueMove(dx > 0 ? "right" : "left");
      } else {
        queueMove(dy > 0 ? "backward" : "forward");
      }
    },
    { passive: true },
  );

  gameCanvas.addEventListener("touchcancel", () => {
    swipeTracking = false;
  });
}

function hitTest() {
  if (gameOver || settlementPending) return;
  const row = metadata[position.currentRow - 1];
  if (!row) return;

  if (row.type === "car" || row.type === "truck" || row.type === "train") {
    const playerBoundingBox = new THREE.Box3();
    playerBoundingBox.setFromObject(player);

    row.vehicles.forEach(({ ref }) => {
      if (!ref) throw Error("Vehicle reference is missing");

      const vehicleBoundingBox = new THREE.Box3();
      vehicleBoundingBox.setFromObject(ref);

      if (playerBoundingBox.intersectsBox(vehicleBoundingBox)) {
        if (bet.active) {
          void crashBet("collision");
        } else {
          showResult({ type: "gameover" });
        }
      }
    });
  }
}

const scene = new THREE.Scene();
scene.add(player);
scene.add(map);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xb3d9ff, 0x88c070, 0.5);
hemiLight.position.set(0, 0, 200);
scene.add(hemiLight);

const dirLight = DirectionalLight();
dirLight.target = player;
player.add(dirLight);

const camera = Camera();
player.add(camera);

const scoreDOM = document.getElementById("score");
const scoreCpDOM = document.getElementById("score-cp");
const resultDOM = document.getElementById("result-container");

initializeGame();
initBettingUI();

function initializeGame() {
  initializePlayer();
  initializeMap();
  gameOver = false;
  bet.reconnecting = false;
  bet.cpStayRemainingMs = 0;
  bet.isDecaying = false;
  setBetButtonState();

  if (scoreDOM) scoreDOM.innerText = "0";
  if (scoreCpDOM) scoreCpDOM.innerText = "0";
  if (resultDOM) resultDOM.style.visibility = "hidden";
}

function initBettingUI() {
  void loadBalance();
  startLiveBalanceSync();
  renderTimer(SEGMENT_TIME_MS, false);

  const depositModal = document.getElementById("deposit-modal");
  const depositAmount = document.getElementById("deposit-amount");
  const depositConfirm = document.getElementById("deposit-confirm");
  const depositManageFunds = document.getElementById("deposit-manage-funds");
  const depositStatus = document.getElementById("deposit-status");
  const depositWalletBalance = document.getElementById(
    "deposit-wallet-balance",
  );
  const depositVaultAvailable = document.getElementById(
    "deposit-vault-available",
  );
  const depositVaultLocked = document.getElementById("deposit-vault-locked");
  const depositAllowance = document.getElementById("deposit-allowance");
  const leaderboardBtn = document.getElementById("leaderboard-btn");
  const leaderboardModal = document.getElementById("leaderboard-modal");
  const leaderboardRefresh = document.getElementById("leaderboard-refresh");
  const leaderboardStatus = document.getElementById("leaderboard-status");
  const leaderboardYourRank = document.getElementById("leaderboard-your-rank");
  const leaderboardList = document.getElementById("leaderboard-list");
  const leaderboardFilterAll = document.getElementById(
    "leaderboard-filter-all",
  );
  const leaderboardFilterVerified = document.getElementById(
    "leaderboard-filter-verified",
  );
  const statsBtn = document.getElementById("stats-btn");
  const statsModal = document.getElementById("stats-modal");
  const statsRefresh = document.getElementById("stats-refresh");
  const statsStatus = document.getElementById("stats-status");
  const statsTotalGames = document.getElementById("stats-total-games");
  const statsTotalWins = document.getElementById("stats-total-wins");
  const statsTotalLosses = document.getElementById("stats-total-losses");
  const statsWinRate = document.getElementById("stats-win-rate");
  const statsTotalProfit = document.getElementById("stats-total-profit");
  const statsLastFiveRuns = document.getElementById("stats-last-five-runs");
  const statsJoined = document.getElementById("stats-joined");
  const statsList = document.getElementById("stats-list");
  const statsTabButtons = document.querySelectorAll("[data-stats-tab]");
  const gameHelpBtn = document.getElementById("game-help-btn");
  const gameHelpModal = document.getElementById("game-help-modal");
  const gameHelpClose = document.getElementById("game-help-close");
  const gameHelpGotIt = document.getElementById("game-help-got-it");
  const characterBtn = document.getElementById("character-btn");
  let depositBusy = false;
  let startBetBusy = false;
  let leaderboardBusy = false;
  let leaderboardLastLoadedAt = 0;
  let leaderboardFilter = "all";
  let leaderboardCachedEntries = [];
  let statsBusy = false;
  let statsLastLoadedAt = 0;
  let statsActiveTab = "runs";
  let statsWalletKey = "";
  const statsCache = {
    player: null,
    sessions: [],
    transactions: [],
  };

  function setDepositStatus(message, isError = false) {
    if (!depositStatus) return;
    depositStatus.innerText = message || "";
    if (isError) depositStatus.classList.add("error");
    else depositStatus.classList.remove("error");
  }

  function setDepositBusy(nextBusy) {
    depositBusy = nextBusy;
    if (depositConfirm) depositConfirm.disabled = nextBusy;
    if (depositManageFunds) {
      if (nextBusy) {
        depositManageFunds.setAttribute("aria-disabled", "true");
        depositManageFunds.setAttribute("tabindex", "-1");
        depositManageFunds.style.pointerEvents = "none";
      } else {
        depositManageFunds.removeAttribute("aria-disabled");
        depositManageFunds.removeAttribute("tabindex");
        depositManageFunds.style.pointerEvents = "";
      }
    }
    if (!nextBusy) {
      setDepositButtonState("DEPOSIT", false);
    }
  }

  function formatDepositAmount(value, fallback = "-") {
    if (!isFinite(value)) return fallback;
    return formatUsdAmount(Number(value));
  }

  function shortWalletAddress(address) {
    const value = String(address || "");
    if (!value) return "-";
    if (value.length <= 13) return value;
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  function normalizeWallet(address) {
    return String(address || "")
      .trim()
      .toLowerCase();
  }

  function leaderboardBestScore(entry) {
    const best = Number(entry?.best_score);
    if (isFinite(best)) return best;
    const fallback = Number(entry?.max_row_reached);
    if (isFinite(fallback)) return fallback;
    return 0;
  }

  function leaderboardPassportTier(entry) {
    const tier = Number(entry?.passportTier);
    if (!isFinite(tier)) return 0;
    return Math.max(0, Math.min(4, Math.floor(tier)));
  }

  function leaderboardPassportTierLabel(entry) {
    const explicit = String(entry?.passportTierLabel || "").trim();
    if (explicit) return explicit;
    const tier = leaderboardPassportTier(entry);
    if (tier >= 4) return "Oracle";
    if (tier >= 3) return "Elite";
    if (tier >= 2) return "Steady";
    if (tier >= 1) return "Runner";
    return "Rookie";
  }

  function leaderboardPassportTierIcon(entry) {
    const tier = leaderboardPassportTier(entry);
    if (tier >= 4) return "/images/oracle.png";
    if (tier >= 3) return "/images/elite.png";
    if (tier >= 2) return "/images/steady.png";
    if (tier >= 1) return "/images/runner.png";
    return "/images/rookie.png";
  }

  function leaderboardPassportReward(entry) {
    if (entry?.passportReward) return String(entry.passportReward);
    const tier = leaderboardPassportTier(entry);
    if (tier >= 4) return "Partner Perks Passport";
    if (tier >= 3) return "Tournament Access";
    if (tier >= 2) return "Allowlist Eligible";
    if (tier >= 1) return "Verified Identity";
    return "";
  }

  function setLeaderboardFilter(nextFilter) {
    leaderboardFilter = nextFilter === "verified" ? "verified" : "all";
    const isVerified = leaderboardFilter === "verified";

    leaderboardFilterAll?.classList.toggle("active", !isVerified);
    leaderboardFilterAll?.setAttribute(
      "aria-selected",
      !isVerified ? "true" : "false",
    );
    leaderboardFilterVerified?.classList.toggle("active", isVerified);
    leaderboardFilterVerified?.setAttribute(
      "aria-selected",
      isVerified ? "true" : "false",
    );

    renderLeaderboardRows(leaderboardCachedEntries);
  }

  function setLeaderboardStatus(message, isError = false) {
    if (!leaderboardStatus) return;
    leaderboardStatus.innerText = message || "";
    if (isError) leaderboardStatus.classList.add("error");
    else leaderboardStatus.classList.remove("error");
  }

  function toFiniteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
  }

  function formatStatsUsd(value, { signed = false } = {}) {
    const amount = toFiniteNumber(value, 0);
    if (!signed) return formatUsdAmount(amount);
    const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
    return `${sign}${formatUsdAmount(Math.abs(amount))}`;
  }

  function formatStatsDate(value, fallback = "-") {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatJoinedText(value) {
    if (!value) return "Joined: -";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Joined: -";
    return (
      "Joined: " +
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date)
    );
  }

  function shortHash(value) {
    const text = String(value || "");
    if (!text) return "-";
    if (text.length <= 13) return text;
    return `${text.slice(0, 6)}...${text.slice(-4)}`;
  }

  function setStatsStatus(message, isError = false) {
    if (!statsStatus) return;
    statsStatus.innerText = message || "";
    if (isError) statsStatus.classList.add("error");
    else statsStatus.classList.remove("error");
  }

  function setStatsSummary(playerStats) {
    const totalGames = toFiniteNumber(playerStats?.total_games, 0);
    const totalWins = toFiniteNumber(playerStats?.total_wins, 0);
    const totalLosses = toFiniteNumber(playerStats?.total_losses, 0);
    const totalProfit = toFiniteNumber(playerStats?.total_profit, 0);

    if (statsTotalGames) statsTotalGames.innerText = String(totalGames);
    if (statsTotalWins) statsTotalWins.innerText = String(totalWins);
    if (statsTotalLosses) statsTotalLosses.innerText = String(totalLosses);
    if (statsWinRate) {
      const winRate = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
      statsWinRate.innerText = `${Math.round(winRate)}%`;
    }
    if (statsJoined)
      statsJoined.innerText = formatJoinedText(playerStats?.created_at);

    if (statsTotalProfit) {
      statsTotalProfit.innerText = formatStatsUsd(totalProfit, {
        signed: true,
      });
      statsTotalProfit.classList.remove("positive", "negative");
      if (totalProfit > 0) statsTotalProfit.classList.add("positive");
      if (totalProfit < 0) statsTotalProfit.classList.add("negative");
    }

    if (statsLastFiveRuns) {
      const recentRuns = Array.isArray(statsCache.sessions)
        ? statsCache.sessions.slice(0, 5)
        : [];
      if (!recentRuns.length) {
        statsLastFiveRuns.innerHTML = "-";
      } else {
        statsLastFiveRuns.innerHTML = recentRuns
          .map((run) => {
            const status = String(run?.status || "").toUpperCase();
            if (status === "CASHED_OUT") return '<span class="run-mark win">W</span>';
            if (status === "CRASHED") return '<span class="run-mark loss">L</span>';
            return '<span class="run-mark neutral">-</span>';
          })
          .join('<span class="run-mark-sep"> </span>');
      }
    }
  }

  function renderStatsEmpty(message) {
    if (!statsList) return;
    statsList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "stats-empty";
    empty.innerText = message;
    statsList.appendChild(empty);
  }

  function getRunBadge(status) {
    const normalized = String(status || "").toUpperCase();
    if (normalized === "CASHED_OUT") {
      return { label: "WIN", className: "win" };
    }
    if (normalized === "CRASHED") {
      return { label: "CRASH", className: "loss" };
    }
    return { label: normalized || "RUN", className: "other" };
  }

  function getTransactionBadge(type) {
    const normalized = String(type || "").toUpperCase();
    if (normalized === "DEPOSIT")
      return { label: "DEPOSIT", className: "deposit" };
    if (normalized === "WITHDRAW")
      return { label: "WITHDRAW", className: "withdraw" };
    if (normalized === "TREASURY_FUNDED")
      return { label: "FAUCET", className: "deposit" };
    if (normalized === "SESSION_STARTED")
      return { label: "RUN", className: "start" };
    if (normalized === "SESSION_SETTLED")
      return { label: "SETTLED", className: "settle" };
    return { label: normalized || "EVENT", className: "other" };
  }

  function createStatsRow({
    badge,
    topText,
    dateText,
    mainText,
    valueText,
    valueTone,
  }) {
    const row = document.createElement("div");
    row.className = "stats-row";

    const top = document.createElement("div");
    top.className = "stats-row-top";

    const meta = document.createElement("div");
    meta.className = "stats-row-meta";

    const badgeEl = document.createElement("span");
    badgeEl.className = `stats-badge ${badge.className}`;
    badgeEl.innerText = badge.label;

    const topSubtle = document.createElement("span");
    topSubtle.className = "stats-row-subtle";
    topSubtle.innerText = topText;

    const dateEl = document.createElement("span");
    dateEl.className = "stats-row-date";
    dateEl.innerText = dateText;

    meta.appendChild(badgeEl);
    meta.appendChild(topSubtle);
    top.appendChild(meta);
    top.appendChild(dateEl);

    const bottom = document.createElement("div");
    bottom.className = "stats-row-bottom";

    const main = document.createElement("span");
    main.className = "stats-row-main";
    main.innerText = mainText;

    const value = document.createElement("strong");
    value.className = "stats-row-value";
    if (valueTone) value.classList.add(valueTone);
    value.innerText = valueText;

    bottom.appendChild(main);
    bottom.appendChild(value);

    row.appendChild(top);
    row.appendChild(bottom);
    return row;
  }

  function renderStatsRows() {
    if (!statsList) return;
    statsList.innerHTML = "";

    if (statsActiveTab === "txs") {
      if (!statsCache.transactions.length) {
        renderStatsEmpty("No transactions yet.");
        return;
      }

      statsCache.transactions.forEach((entry) => {
        const badge = getTransactionBadge(entry?.type);
        const amount = toFiniteNumber(entry?.amount, 0);
        const tone =
          badge.className === "withdraw" || badge.className === "settle"
            ? "positive"
            : badge.className === "deposit" || badge.className === "start"
              ? "negative"
              : "";

        const descriptor = entry?.onchain_session_id
          ? `SESSION ${shortHash(entry?.onchain_session_id)}`
          : `TX ${shortHash(entry?.tx_hash)}`;

        statsList.appendChild(
          createStatsRow({
            badge,
            topText: descriptor,
            dateText: formatStatsDate(entry?.created_at),
            mainText: `HASH ${shortHash(entry?.tx_hash)}`,
            valueText: formatStatsUsd(amount, { signed: false }),
            valueTone: tone,
          }),
        );
      });
      return;
    }

    if (!statsCache.sessions.length) {
      renderStatsEmpty("No completed runs yet.");
      return;
    }

    statsCache.sessions.forEach((entry) => {
      const badge = getRunBadge(entry?.status);
      const stake = toFiniteNumber(entry?.stake_amount, 0);
      const payout = toFiniteNumber(entry?.payout_amount, 0);
      const profit = payout - stake;
      const hops = toFiniteNumber(entry?.max_row_reached, 0);
      const multiplier = toFiniteNumber(entry?.final_multiplier, 0);

      statsList.appendChild(
        createStatsRow({
          badge,
          topText: `STAKE ${formatStatsUsd(stake)}`,
          dateText: formatStatsDate(entry?.ended_at || entry?.created_at),
          mainText: `HOPS ${hops} / ${multiplier.toFixed(2)}x`,
          valueText: formatStatsUsd(profit, { signed: true }),
          valueTone: profit > 0 ? "positive" : profit < 0 ? "negative" : "",
        }),
      );
    });
  }

  function setStatsTab(nextTab) {
    if (nextTab !== "runs" && nextTab !== "txs") return;
    statsActiveTab = nextTab;

    statsTabButtons.forEach((button) => {
      const isActive = button.dataset.statsTab === nextTab;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    renderStatsRows();
  }

  function renderLeaderboardRows(entries) {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = "";

    const visibleEntries =
      leaderboardFilter === "verified"
        ? entries.filter((entry) => leaderboardPassportTier(entry) >= 1)
        : entries;

    if (!visibleEntries.length) {
      const empty = document.createElement("li");
      empty.className = "leaderboard-empty";
      empty.innerText =
        leaderboardFilter === "verified"
          ? "No verified players yet."
          : "No leaderboard data yet.";
      leaderboardList.appendChild(empty);
      return;
    }

    visibleEntries.forEach((entry, index) => {
      const tier = leaderboardPassportTier(entry);
      const reward = leaderboardPassportReward(entry);
      const row = document.createElement("li");
      row.className = tier >= 1 ? "leaderboard-row verified" : "leaderboard-row";

      const rankEl = document.createElement("span");
      rankEl.className = "leaderboard-rank";
      rankEl.innerText = `#${index + 1}`;

      const walletEl = document.createElement("div");
      walletEl.className = "leaderboard-wallet-stack";

      const walletAddressEl = document.createElement("span");
      walletAddressEl.className = "leaderboard-wallet";
      walletAddressEl.innerText = shortWalletAddress(entry?.wallet_address);
      walletEl.appendChild(walletAddressEl);

      const tierEl = document.createElement("img");
      tierEl.className = "leaderboard-tier-badge";
      tierEl.src = leaderboardPassportTierIcon(entry);
      tierEl.alt = `${leaderboardPassportTierLabel(entry)} passport badge`;
      tierEl.title = `Tier ${tier} - ${leaderboardPassportTierLabel(entry)}`;
      walletEl.appendChild(tierEl);

      if (reward) {
        const rewardEl = document.createElement("span");
        rewardEl.className = "leaderboard-reward-label";
        rewardEl.innerText =
          tier >= 3 ? `Cup Eligible - ${reward}` : reward;
        walletEl.appendChild(rewardEl);
      }

      const scoreEl = document.createElement("strong");
      scoreEl.className = "leaderboard-score";
      scoreEl.innerText = `HOPS ${leaderboardBestScore(entry)}`;

      row.appendChild(rankEl);
      row.appendChild(walletEl);
      row.appendChild(scoreEl);
      leaderboardList.appendChild(row);
    });
  }

  async function refreshLeaderboard(forceReload = false) {
    if (!document.getElementById("leaderboard-modal")) return;
    if (leaderboardBusy) return;

    const hasFreshCache =
      leaderboardList &&
      leaderboardList.children.length > 0 &&
      Date.now() - leaderboardLastLoadedAt < 12000;
    if (!forceReload && hasFreshCache) return;

    leaderboardBusy = true;
    if (leaderboardRefresh) leaderboardRefresh.disabled = true;
    setLeaderboardStatus("Loading leaderboard...");

    try {
      if (!hasLiveBridge()) {
        leaderboardCachedEntries = [];
        if (leaderboardList) leaderboardList.innerHTML = "";
        if (leaderboardYourRank) leaderboardYourRank.innerText = "Demo mode";
        setLeaderboardStatus(
          "Connect wallet + backend session to view leaderboard.",
        );
        return;
      }

      const bridge = getBridge();
      if (!bridge?.loadLeaderboard) {
        throw new Error("Leaderboard bridge is not ready yet.");
      }

      const payload = await bridge.loadLeaderboard();
      const leaderboard = Array.isArray(payload?.leaderboard)
        ? [...payload.leaderboard]
        : [];
      leaderboard.sort(
        (a, b) => leaderboardBestScore(b) - leaderboardBestScore(a),
      );

      const topTen = leaderboard.slice(0, 10);
      leaderboardCachedEntries = topTen;
      renderLeaderboardRows(leaderboardCachedEntries);

      const bridgeWallet = bridge?.getWalletAddress
        ? bridge.getWalletAddress()
        : "";
      const walletAddress = String(
        payload?.walletAddress || bridgeWallet || "",
      );
      const normalizedWallet = normalizeWallet(walletAddress);

      if (leaderboardYourRank) {
        if (!normalizedWallet) {
          leaderboardYourRank.innerText = "Wallet not found";
        } else {
          const rankIndex = leaderboard.findIndex(
            (entry) =>
              normalizeWallet(entry?.wallet_address) === normalizedWallet,
          );

          if (rankIndex >= 0) {
            const bestScore = leaderboardBestScore(leaderboard[rankIndex]);
            leaderboardYourRank.innerText = `#${rankIndex + 1} (HOPS ${bestScore})`;
          } else if (leaderboard.length > 0) {
            leaderboardYourRank.innerText = "Outside Top 100";
          } else {
            leaderboardYourRank.innerText = "-";
          }
        }
      }

      if (topTen.length === 0) {
        setLeaderboardStatus("No leaderboard data yet.");
      } else if (leaderboardFilter === "verified") {
        const verifiedCount = topTen.filter(
          (entry) => leaderboardPassportTier(entry) >= 1,
        ).length;
        setLeaderboardStatus(
          verifiedCount > 0
            ? "Verified players by best hops."
            : "No verified players in the current top 10 yet.",
        );
      } else {
        setLeaderboardStatus("Top 10 players by best hops.");
      }
      leaderboardLastLoadedAt = Date.now();
    } catch (error) {
      leaderboardCachedEntries = [];
      if (leaderboardList) leaderboardList.innerHTML = "";
      if (leaderboardYourRank) leaderboardYourRank.innerText = "-";
      setLeaderboardStatus(
        formatBridgeError(error, "Failed to load leaderboard."),
        true,
      );
    } finally {
      leaderboardBusy = false;
      if (leaderboardRefresh) leaderboardRefresh.disabled = false;
    }
  }

  function openLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    closeStatsModal();
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    leaderboardBtn?.classList.add("open");
    leaderboardBtn?.setAttribute("aria-expanded", "true");
    playPanelOpenSfx();
    void refreshLeaderboard();
  }

  function closeLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
    leaderboardBtn?.classList.remove("open");
    leaderboardBtn?.setAttribute("aria-expanded", "false");
    playPanelCloseSfx();
  }

  function toggleLeaderboardModal() {
    const el = document.getElementById("leaderboard-modal");
    if (!el) return;
    const isVisible = el.style.display !== "none";
    if (isVisible) closeLeaderboardModal();
    else openLeaderboardModal();
  }

  async function refreshStats(forceReload = false) {
    if (!document.getElementById("stats-modal")) return;
    if (statsBusy) return;

    const bridge = hasLiveBridge() ? getBridge() : null;
    const currentWalletKey = normalizeWallet(
      bridge?.getWalletAddress ? bridge.getWalletAddress() : "",
    );
    const hasFreshCache =
      statsCache.player &&
      statsWalletKey === currentWalletKey &&
      Date.now() - statsLastLoadedAt < 12000;
    if (!forceReload && hasFreshCache) {
      renderStatsRows();
      return;
    }

    statsBusy = true;
    if (statsRefresh) statsRefresh.disabled = true;
    setStatsStatus("Loading player stats...");
    renderStatsEmpty("Loading stats...");

    try {
      if (!hasLiveBridge()) {
        statsWalletKey = "";
        statsCache.player = null;
        statsCache.sessions = [];
        statsCache.transactions = [];
        setStatsSummary(null);
        renderStatsEmpty("Connect wallet + backend session to view stats.");
        setStatsStatus("Connect wallet + backend session to view stats.");
        return;
      }

      if (
        !bridge?.loadPlayerStats ||
        !bridge?.loadGameHistory ||
        !bridge?.loadPlayerTransactions
      ) {
        throw new Error("Stats bridge is not ready yet.");
      }

      const [playerStats, historyPayload, transactionPayload] =
        await Promise.all([
          bridge.loadPlayerStats(),
          bridge.loadGameHistory(5),
          bridge.loadPlayerTransactions(3),
        ]);

      statsCache.player = playerStats || null;
      statsCache.sessions = Array.isArray(historyPayload?.sessions)
        ? historyPayload.sessions
        : [];
      statsCache.transactions = Array.isArray(transactionPayload?.transactions)
        ? transactionPayload.transactions
        : [];
      statsWalletKey = normalizeWallet(
        playerStats?.wallet_address || currentWalletKey,
      );

      setStatsSummary(statsCache.player);
      renderStatsRows();

      if (!statsCache.sessions.length && !statsCache.transactions.length) {
        setStatsStatus("No player history yet.");
      } else {
        setStatsStatus("Recent runs and onchain activity.");
      }

      statsLastLoadedAt = Date.now();
    } catch (error) {
      statsWalletKey = "";
      statsCache.player = null;
      statsCache.sessions = [];
      statsCache.transactions = [];
      setStatsSummary(null);
      renderStatsEmpty("Could not load player stats.");
      setStatsStatus(
        formatBridgeError(error, "Failed to load player stats."),
        true,
      );
    } finally {
      statsBusy = false;
      if (statsRefresh) statsRefresh.disabled = false;
    }
  }

  function openStatsModal() {
    const el = document.getElementById("stats-modal");
    if (!el) return;
    closeLeaderboardModal();
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
    statsBtn?.classList.add("open");
    statsBtn?.setAttribute("aria-expanded", "true");
    playPanelOpenSfx();
    void refreshStats();
  }

  function closeStatsModal() {
    const el = document.getElementById("stats-modal") || statsModal;
    if (!el) return;
    const trigger = document.getElementById("stats-btn") || statsBtn;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
    trigger?.classList.remove("open");
    trigger?.setAttribute("aria-expanded", "false");
    playPanelCloseSfx();
  }

  function toggleStatsModal() {
    const el = document.getElementById("stats-modal");
    if (!el) return;
    const isVisible = el.style.display !== "none";
    if (isVisible) closeStatsModal();
    else openStatsModal();
  }

  function setDepositBalanceCard(snapshot) {
    if (depositWalletBalance) {
      depositWalletBalance.innerText = formatDepositAmount(
        snapshot?.walletBalance,
      );
    }
    if (depositVaultAvailable) {
      depositVaultAvailable.innerText = formatDepositAmount(
        snapshot?.availableBalance,
        "$0.0000",
      );
    }
    if (depositVaultLocked) {
      depositVaultLocked.innerText = formatDepositAmount(
        snapshot?.lockedBalance,
        "$0.0000",
      );
    }
    if (depositAllowance) {
      const allowance = snapshot?.allowance;
      if (!isFinite(allowance)) depositAllowance.innerText = "-";
      else if (allowance > 999999)
        depositAllowance.innerText = "Unlimited (approved)";
      else
        depositAllowance.innerText = formatDepositAmount(allowance, "$0.0000");
    }
  }

  async function refreshDepositBalanceCard() {
    if (hasLiveBridge()) {
      const bridge = getBridge();
      try {
        if (bridge?.loadDepositBalances) {
          const snapshot = await bridge.loadDepositBalances();
          if (isFinite(snapshot?.availableBalance)) {
            bet.balance = snapshot.availableBalance;
            renderBalance();
          }
          setDepositBalanceCard(snapshot);
          return;
        }
      } catch (error) {
        console.error("Failed to load deposit balance card:", error);
      }

      try {
        if (bridge?.loadAvailableBalance) {
          const availableBalance = await bridge.loadAvailableBalance();
          if (isFinite(availableBalance)) {
            bet.balance = availableBalance;
            renderBalance();
          }
          setDepositBalanceCard({
            walletBalance: Number.NaN,
            availableBalance,
            lockedBalance: Number.NaN,
            allowance: Number.NaN,
          });
          return;
        }
      } catch (error) {
        console.error("Failed to load fallback available balance:", error);
      }
    }

    setDepositBalanceCard({
      walletBalance: Number.NaN,
      availableBalance: bet.balance,
      lockedBalance: 0,
      allowance: Number.NaN,
    });
  }

  function openDepositModal(presetAmount) {
    if (depositAmount) {
      if (isFinite(presetAmount) && presetAmount > 0) {
        depositAmount.value = String(presetAmount);
      } else {
        depositAmount.value = "0.0001";
      }
    }
    setDepositStatus("");
    void refreshDepositBalanceCard();
    if (depositModal) {
      depositModal.style.display = "flex";
      playPanelOpenSfx();
    }
  }

  function closeDepositModal() {
    if (depositBusy) return;
    if (depositModal) {
      depositModal.style.display = "none";
      playPanelCloseSfx();
    }
  }

  function openGameHelpModal() {
    if (gameHelpModal) {
      gameHelpModal.style.display = "flex";
      playPanelOpenSfx();
    }
  }

  function closeGameHelpModal() {
    if (gameHelpModal) {
      gameHelpModal.style.display = "none";
      playPanelCloseSfx();
    }
  }

  function isBetPanelVisible() {
    const panel = document.getElementById("bet-panel");
    if (!panel) return false;
    return panel.style.display !== "none";
  }

  window.addEventListener("chicken:open-deposit-modal", (event) => {
    const detail = event && "detail" in event ? event.detail : undefined;
    const presetAmount = Number(detail?.amount);
    openDepositModal(presetAmount);
  });

  window.addEventListener("chicken:open-leaderboard", () => {
    console.log("script.js: received chicken:open-leaderboard event");
    openLeaderboardModal();
  });

  window.addEventListener("chicken:open-stats", () => {
    console.log("script.js: received chicken:open-stats event");
    openStatsModal();
  });

  leaderboardBtn?.addEventListener("click", () => {
    playUiClickSfx();
    toggleLeaderboardModal();
  });

  statsBtn?.addEventListener("click", () => {
    playUiClickSfx();
    toggleStatsModal();
  });

  statsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setStatsTab(button.dataset.statsTab || "runs");
    });
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;

    const leaderboardVisible =
      leaderboardModal &&
      leaderboardBtn &&
      leaderboardModal.style.display !== "none";
    if (
      leaderboardVisible &&
      !leaderboardModal.contains(target) &&
      !leaderboardBtn.contains(target)
    ) {
      closeLeaderboardModal();
    }

    const statsModalEl = document.getElementById("stats-modal") || statsModal;
    const statsBtnEl = document.getElementById("stats-btn") || statsBtn;
    const statsVisible =
      statsModalEl && statsBtnEl && statsModalEl.style.display !== "none";
    if (
      statsVisible &&
      !statsModalEl.contains(target) &&
      !statsBtnEl.contains(target)
    ) {
      closeStatsModal();
    }
  });

  leaderboardRefresh?.addEventListener("click", () => {
    playUiClickSfx();
    void refreshLeaderboard(true);
  });

  leaderboardFilterAll?.addEventListener("click", () => {
    playUiClickSfx();
    setLeaderboardFilter("all");
    setLeaderboardStatus("Top 10 players by best hops.");
  });

  leaderboardFilterVerified?.addEventListener("click", () => {
    playUiClickSfx();
    setLeaderboardFilter("verified");
    const verifiedCount = leaderboardCachedEntries.filter(
      (entry) => leaderboardPassportTier(entry) >= 1,
    ).length;
    setLeaderboardStatus(
      verifiedCount > 0
        ? "Verified players by best hops."
        : "No verified players in the current top 10 yet.",
    );
  });

  statsRefresh?.addEventListener("click", () => {
    playUiClickSfx();
    void refreshStats(true);
  });

  gameHelpBtn?.addEventListener("click", () => {
    playUiClickSfx();
    openGameHelpModal();
  });

  gameHelpClose?.addEventListener("click", () => {
    playUiClickSfx();
    closeGameHelpModal();
  });

  gameHelpGotIt?.addEventListener("click", () => {
    playUiClickSfx();
    closeGameHelpModal();
  });

  gameHelpModal?.addEventListener("click", (event) => {
    if (event.target === gameHelpModal) closeGameHelpModal();
  });

  characterBtn?.addEventListener("click", () => {
    playUiClickSfx();
    window.dispatchEvent(
      new CustomEvent("chicken:open-character-menu"),
    );
  });

  window.addEventListener("chicken:character-selected", (event) => {
    const characterId = event?.detail?.characterId;
    setPlayerCharacter(characterId);
    playUiClickSfx();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeGameHelpModal();
      closeLeaderboardModal();
      closeStatsModal();
    }
  });

  window.addEventListener("chicken:deposit-progress", (event) => {
    const detail = event && "detail" in event ? event.detail : undefined;
    const phase = String(detail?.phase || "");
    const message = String(detail?.message || "");

    if (message) setDepositStatus(message, false);

    if (phase === "done") {
      dispatchPlayStatus({ clear: true });
      setDepositButtonState("DEPOSIT", false);
      return;
    }

    if (message) {
      dispatchPlayStatus({
        message,
        tone: "busy",
        sticky: true,
      });
    }

    if (phase === "approve_sign") {
      setDepositButtonState("SIGN 1/2", true);
      return;
    }
    if (phase === "approve_pending") {
      setDepositButtonState("PENDING...", true);
      return;
    }
    if (phase === "deposit_sign") {
      setDepositButtonState("SIGN 2/2", true);
      return;
    }
    if (phase === "deposit_pending") {
      setDepositButtonState("PENDING...", true);
      return;
    }
  });

  document.getElementById("bet-btn")?.addEventListener("click", () => {
    if (bet.active) return;
    if (startBetBusy) return;
    playUiClickSfx();
    hideResult();
    showBetPanel(!isBetPanelVisible());
  });

  depositConfirm?.addEventListener("click", async () => {
    playUiClickSfx();
    const amountText = String(depositAmount?.value || "").trim();
    const amt = parseFloat(amountText);
    if (!isFinite(amt) || amt <= 0) {
      setDepositStatus("Enter a valid USDC amount.", true);
      return;
    }

    if (hasLiveBridge()) {
      const bridge = getBridge();
      if (!bridge?.depositToVault) {
        setDepositStatus("Deposit bridge is not ready yet.", true);
        return;
      }

      setDepositBusy(true);
      setDepositButtonState("PROCESSING...", true);
      setDepositStatus("Submitting deposit...");
      try {
        const result = await bridge.depositToVault(amountText);
        if (isFinite(result?.availableBalance)) {
          bet.balance = result.availableBalance;
          renderBalance();
        }

        if (result?.approveTxHash) {
          setDepositStatus("Approve + deposit confirmed.");
        } else {
          setDepositStatus("Deposit confirmed.");
        }
        dispatchPlayStatus({
          message: "DEPOSIT CONFIRMED.",
          tone: "ready",
          durationMs: 2600,
        });

        window.setTimeout(() => {
          closeDepositModal();
        }, 350);
      } catch (error) {
        const message = formatBridgeError(
          error,
          "Deposit failed.",
          "Deposit was canceled in wallet.",
        );
        setDepositStatus(message, true);
        dispatchPlayStatus({
          message,
          tone: "error",
          durationMs: 4200,
        });
        setDepositButtonState("DEPOSIT", false);
      } finally {
        setDepositBusy(false);
        void loadBalance();
        void refreshDepositBalanceCard();
      }
      return;
    }

    const success = deposit(amt);
    if (success) {
      void refreshDepositBalanceCard();
      closeDepositModal();
    } else setDepositStatus("Deposit failed.", true);
  });

  document.getElementById("deposit-close")?.addEventListener("click", () => {
    playUiClickSfx();
    closeDepositModal();
  });

  document.getElementById("bet-panel-close")?.addEventListener("click", () => {
    playUiClickSfx();
    showBetPanel(false);
  });

  document.querySelectorAll("[data-deposit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      playUiClickSfx();
      if (depositAmount) depositAmount.value = btn.dataset.deposit;
    });
  });

  const stakeInput = document.getElementById("bet-stake-input");
  const syncStakeInput = () => {
    return DEFAULT_STAKE;
  };



  function showErrorToast(msg) {
    const panel = document.getElementById("bet-panel");
    if (!panel) return;
    playDeniedSfx();
    let toast = document.getElementById("bet-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "bet-toast";
      toast.className = "flow-alert";
      toast.style.marginTop = "10px";
      toast.style.marginBottom = "10px";
      const btnContainer =
        document.getElementById("start-bet-btn")?.parentElement;
      if (btnContainer && btnContainer.parentNode) {
        btnContainer.parentNode.insertBefore(toast, btnContainer);
      } else {
        panel.appendChild(toast);
      }
    }
    toast.innerText = msg;
    toast.style.display = "block";
    setTimeout(() => {
      toast.style.display = "none";
    }, 3000);
  }

  const startBetBtn = document.getElementById("start-bet-btn");
  startBetBtn?.addEventListener("click", async () => {
    if (startBetBusy) return;
    playUiClickSfx();
    const stake = syncStakeInput();
    if (!isValidStakeAmount(stake)) {
      showErrorToast(`Stake must be between ${MIN_STAKE} and ${MAX_STAKE} USDC.`);
      return;
    }
    if (!hasLiveBridge() && stake > bet.balance) {
      showErrorToast(
        `Insufficient balance. You have ${formatUsdAmount(bet.balance)}. Deposit more first.`,
      );
      return;
    }

    if (hasLiveBridge()) {
      const bridge = getBridge();
      if (bridge?.loadAvailableBalance) {
        try {
          const available = await bridge.loadAvailableBalance();
          if (!isFinite(available) || available < stake) {
            showErrorToast(
              `Insufficient vault balance. Available ${formatUsdAmount(available || 0)}. Deposit first.`,
            );
            return;
          }
        } catch (error) {
          const message = formatBridgeError(
            error,
            "Failed to check vault balance.",
            "Request was canceled in wallet.",
          );
          console.error("Failed to load available vault balance:", error);
          dispatchPlayStatus({
            message,
            tone: "error",
            durationMs: 4200,
          });
          showErrorToast(message);
          return;
        }
      }
    }

    startBetBusy = true;
    let keepStatusMessage = false;
    dispatchPlayStatus({
      message: "STARTING RUN...",
      tone: "busy",
      sticky: true,
    });
    if (startBetBtn) {
      startBetBtn.innerText = "STARTING...";
      startBetBtn.disabled = true;
    }

    try {
      const started = await startBet(stake);
      if (!started) {
        keepStatusMessage = true;
      } else {
        dispatchPlayStatus({ clear: true });
      }
    } finally {
      startBetBusy = false;
      if (startBetBtn) {
        startBetBtn.innerText = "START PLAY";
        startBetBtn.disabled = false;
      }
      if (!bet.active && !keepStatusMessage) {
        dispatchPlayStatus({ clear: true });
      }
    }
  });

  document.getElementById("free-play-btn")?.addEventListener("click", () => {
    playUiClickSfx();
    startFreePracticeRun();
  });

  document.getElementById("cash-out-btn")?.addEventListener("click", () => {
    playUiClickSfx();
    void cashOut("manual");
  });

  document.getElementById("retry")?.addEventListener("click", () => {
    playUiClickSfx();
    hideResult();
    showBetPanel(true);
    stopBetTicker();
    bet.active = false;
    setBetButtonState();
    initializeGame();
  });

  document.getElementById("result-close")?.addEventListener("click", () => {
    playUiClickSfx();
    startFreePracticeRun();
  });

  showBetPanel(true);
  setBetButtonState();
  setDepositButtonState("DEPOSIT", false);
  setStatsSummary(null);
  setStatsTab("runs");

  window.addEventListener("chicken:game-error", (event) => {
    const message = event?.detail?.message;
    if (message) {
      console.warn("Backend game error:", message);
      dispatchPlayStatus({
        message,
        tone: "error",
        durationMs: 4200,
      });
      showErrorToast(message);
    }
  });

  window.addEventListener("chicken:start-bet-failed", (event) => {
    const message =
      event?.detail?.message || "Start bet failed. Please try again.";

    const wasBetActive = bet.active;
    stopBetTicker();
    bet.active = false;
    bet.reconnecting = false;
    bet.cashoutWindow = false;
    bet.segmentActive = false;
    bet.cpStayRemainingMs = 0;
    bet.decayCarryBp = 0;
    bet.isDecaying = false;
    setBetButtonState();
    renderBetHud();
    showBetHud(false);
    if (!wasBetActive) {
      showBetPanel(true);
    } else {
      showBetPanel(false);
    }
    dispatchPlayStatus({
      message,
      tone: "error",
      durationMs: 4200,
    });
    showErrorToast(message);
    void loadBalance();
  });

  window.addEventListener("chicken:game-disconnected", () => {
    if (!bet.active) return;

    pauseActiveBetForReconnect();
    dispatchPlayStatus({
      message: "RUN PAUSED. RECONNECTING...",
      tone: "busy",
      sticky: true,
    });
  });

  window.addEventListener("chicken:game-reconnected", (event) => {
    const restored = restoreActiveBetFromSnapshot(event?.detail);
    if (!restored) return;

    dispatchPlayStatus({
      message: "RUN RECONNECTED.",
      tone: "ready",
      durationMs: 2600,
    });
  });

  window.addEventListener("chicken:game-reconnect-expired", (event) => {
    const message =
      event?.detail?.message ||
      "Connection to server was lost too long. Run stopped.";

    resetBetAfterReconnectFailure();
    initializeGame();
    showBetPanel(true);
    dispatchPlayStatus({
      message,
      tone: "error",
      durationMs: 4200,
    });
    showErrorToast(message);
    void loadBalance();
  });

  window.addEventListener("chicken:cp-expired", (event) => {
    closeCashoutWindow();
    bet.isDecaying = false;
    renderBetHud();
    const msg =
      event?.detail?.message || "Checkpoint window expired — keep moving!";
    dispatchPlayStatus({
      message: msg,
      tone: "info",
      durationMs: 3200,
    });
    showErrorToast("⏰ " + msg);
  });

  document
    .getElementById("leaderboard-close-btn")
    ?.addEventListener("click", () => {
      closeLeaderboardModal();
    });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("#stats-close-btn")) {
      closeStatsModal();
    }
  });

  document
    .getElementById("leaderboard-modal")
    ?.addEventListener("click", (e) => {
      if (e.target.id === "leaderboard-modal") closeLeaderboardModal();
    });

  document.getElementById("stats-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "stats-modal") closeStatsModal();
  });
}

const renderer = Renderer();
renderer.setAnimationLoop(animate);

window.addEventListener("resize", () => {
  const isMobile = window.innerWidth <= 768;
  const size = isMobile ? 240 : 300;
  const viewRatio = window.innerWidth / window.innerHeight;
  const width = viewRatio < 1 ? size : size * viewRatio;
  const height = viewRatio < 1 ? size / viewRatio : size;

  camera.left = width / -2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = height / -2;
  camera.updateProjectionMatrix();

  applyCameraPose(camera, isMobile);

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
});

function animate() {
  const delta = clock.getDelta();
  animateVehicles(delta);
  animateRiverDecorations(delta);
  animatePlayer();
  animateRailwayLights();
  animateCheckpointDecorations();
  hitTest();

  renderer.render(scene, camera);
}
setTimeout(() => {
  const loader = document.getElementById("loading-screen");
  if (loader) {
    loader.classList.add("hidden");
    setTimeout(() => {
      loader.style.display = "none";
    }, 500);
  }
}, 800);

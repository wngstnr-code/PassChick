"use client";

import { GameBridgeClient } from "./GameBridgeClient";
import Image from "next/image";
import Script from "next/script";
import { useEffect, useState } from "react";

type GameCanvasProps = {
  backgroundMode?: boolean;
};

const CHARACTER_STORAGE_KEY = "passchickCharacter";

const characters = [
  {
    id: "chicken",
    name: "Chicken",
    role: "Classic runner",
    tone: "Balanced",
    imageSrc: "/images/chick.png",
  },
  {
    id: "duck",
    name: "Duck",
    role: "Waddly charm",
    tone: "Playful",
    imageSrc: "/images/duck.png",
  },
  {
    id: "goose",
    name: "Goose",
    role: "Long-neck menace",
    tone: "Bold",
    imageSrc: "/images/goose.png",
  },
  {
    id: "turkey",
    name: "Turkey",
    role: "Chunky strutter",
    tone: "Rare",
    imageSrc: "/images/turkey.png",
  },
  {
    id: "quail",
    name: "Quail",
    role: "Tiny scout",
    tone: "Quick",
    imageSrc: "/images/quail.png",
  },
  {
    id: "peacock",
    name: "Peacock",
    role: "Flashy flex",
    tone: "Fancy",
    imageSrc: "/images/peacock.png",
  },
];


export function GameCanvas({ backgroundMode = false }: GameCanvasProps) {
  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [selectedCharacter, setSelectedCharacter] = useState(() => {
    if (typeof window === "undefined") return "chicken";
    try {
      const stored = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
      return stored && characters.some((c) => c.id === stored) ? stored : "chicken";
    } catch {
      return "chicken";
    }
  });

  useEffect(() => {
    const openCharacterMenu = () => {
      setCharacterModalOpen(true);
    };

    window.addEventListener("chicken:open-character-menu", openCharacterMenu);
    return () => {
      window.removeEventListener(
        "chicken:open-character-menu",
        openCharacterMenu,
      );
    };
  }, []);

  useEffect(() => {
    if (!characterModalOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCharacterModalOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [characterModalOpen]);

  function selectCharacter(characterId: string) {
    setSelectedCharacter(characterId);
    try {
      window.localStorage.setItem(CHARACTER_STORAGE_KEY, characterId);
    } catch (error) {
      console.warn("Failed to save character to localStorage", error);
    }
    window.dispatchEvent(
      new CustomEvent("chicken:character-selected", {
        detail: { characterId },
      }),
    );
  }

  const selectedCharacterName =
    characters.find((character) => character.id === selectedCharacter)?.name ??
    "Chicken";

  return (
    <>
      <GameBridgeClient backgroundMode={backgroundMode} />
      <canvas className="game" />

      {!backgroundMode ? (
        <div id="loading-screen">
          <div className="loading-content">
            <div className="loading-spinner" aria-hidden="true" />
            <h2>LOADING GAME...</h2>
            <p>Preparing the road ahead</p>
          </div>
        </div>
      ) : null}

      <div id="hud-scrim" aria-hidden="true" />

      <div id="top-bar">
        <div id="top-bar-left">
          <div className="stat-card score-card">
            <div className="score-card-main">
              <div className="score-metric">
                <span className="score-meta">HOPS</span>
                <span className="stat-value" id="score">
                  0
                </span>
              </div>
              <div className="hud-divider hud-divider-primary" />
              <div className="score-separator" aria-hidden="true" />
              <div className="hud-divider hud-divider-secondary" />
              <div className="score-metric">
                <span className="score-meta">CURRENT CP</span>
                <span className="score-cp-value" id="score-cp">
                  0
                </span>
              </div>
            </div>
          </div>

          <div id="bet-hud" style={{ display: "block" }}>
            <div
              id="bet-hud-active"
              className="bet-hud-active"
              style={{ display: "none" }}
            >
              <div className="bet-hud-metric-grid">
                <div className="bet-hud-metric bet-hud-metric-primary">
                  <span className="bet-hud-metric-label">STAKE</span>
                  <span id="bet-stake" className="bet-hud-metric-value">
                    $0.00000
                  </span>
                </div>
                <div className="bet-hud-metric bet-hud-metric-primary">
                  <span className="bet-hud-metric-label">MULTIPLIER</span>
                  <span
                    id="bet-multiplier"
                    className="bet-hud-metric-value multiplier-value"
                  >
                    0.00x
                  </span>
                </div>
                <div className="bet-hud-metric bet-hud-metric-wide">
                  <span className="bet-hud-metric-label">CASH OUT</span>
                  <span
                    id="bet-payout"
                    className="bet-hud-metric-value payout-value"
                  >
                    $0.00000
                  </span>
                </div>
              </div>

              <div
                id="bet-hud-decay"
                className="bet-hud-decay"
                style={{ display: "none" }}
              >
                <span className="bet-hud-decay-label">DECAYING</span>
                <span id="bet-decay" className="bet-hud-decay-value">
                  -0.1x
                </span>
              </div>
            </div>

            <div id="bet-hud-idle" className="bet-hud-idle">
              Paid run shows live payout and multiplier.
            </div>

            <button
              id="cash-out-btn"
              className="disabled"
              disabled
              style={{ display: "none" }}
            >
              CASH OUT
            </button>
          </div>
        </div>
        <div id="top-bar-center">
          <div className="stat-card play-balance-card">
            <div className="stat-label">BALANCE</div>
            <div className="stat-value" id="balance">
              $0.00000
            </div>
          </div>
          <div className="stat-card timer-card" id="timer-card">
            <div className="stat-label" id="timer-label">
              RUSH
            </div>
            <div className="stat-value" id="timer">
              1:00
            </div>
          </div>
          <button id="bet-btn">PLAY</button>
        </div>
      </div>

      <div id="bet-panel" className="modal-bg">
        <div className="modal-box modal-box-bet">
          <button className="close-btn" id="bet-panel-close" aria-label="Close">
            X
          </button>
          <h2>CONFIRM PAID RUN</h2>
          <p className="subtitle">
            Set your stake, on-chain outcome, checkpoint cash out
          </p>

          <div className="odds-info">
            <div className="field bet-stake-form">
              <label>ENTRY FEE (USDC)</label>
              <div className="bet-stake-fixed" style={{ fontSize: "1.2rem", fontWeight: "bold", padding: "10px 0", textAlign: "center", color: "#f6fbff" }}>
                0.0001
              </div>
              <input type="hidden" id="bet-stake-input" value="0.0001" />
            </div>
          </div>

          <div className="odds-info">
            <p className="odds-title">RUN RULES</p>
            <div className="odds-row">
              <span className="odds-key">Start multiplier</span>
              <strong>0.00x</strong>
            </div>
            <div className="odds-row">
              <span className="odds-key">Per forward step</span>
              <strong>+0.025x</strong>
            </div>
            <div className="odds-row">
              <span className="odds-key">Every 40 steps</span>
              <strong>Checkpoint x1.2</strong>
            </div>
            <div className="odds-row">
              <span className="odds-key">Speed per checkpoint</span>
              <strong>x1.10</strong>
            </div>
            <div className="odds-divider" aria-hidden="true" />
            <div className="odds-note-list">
              <div className="odds-note-item">
                <span className="dot dot-yellow" aria-hidden="true" /> 60s timer
                between checkpoints
              </div>
              <div className="odds-note-item">
                <span className="dot dot-green" aria-hidden="true" /> Cash out
                only while at checkpoint
              </div>
              <div className="odds-note-item">
                <span className="dot dot-red" aria-hidden="true" /> Overtime
                penalty: -0.1x per second
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button id="start-bet-btn" className="primary">
              START PLAY
            </button>
            <button id="free-play-btn" className="ghost">
              FREE PRACTICE
            </button>
          </div>
        </div>
      </div>

      <div id="deposit-modal" className="modal-bg" style={{ display: "none" }}>
        <div className="modal-box modal-box-deposit">
          <button className="close-btn" id="deposit-close" aria-label="Close">
            X
          </button>
          <h2>DEPOSIT TO VAULT</h2>

          <div className="field">
            <label>AMOUNT (USDC)</label>
            <input
              type="number"
              id="deposit-amount"
              defaultValue="0.0001"
              min="0.0001"
              step="0.0001"
            />
          </div>

          <div className="quick-picks">
            <button data-deposit="0.0001">0.0001</button>
            <button data-deposit="0.0005">0.0005</button>
            <button data-deposit="0.001">0.0010</button>
            <button data-deposit="0.0025">0.0025</button>
            <button data-deposit="0.005">0.0050</button>
            <button data-deposit="0.01">0.0100</button>
          </div>

          <div className="deposit-balances" id="deposit-balances">
            <p>
              <span>WALLET USDC</span>
              <strong id="deposit-wallet-balance">-</strong>
            </p>
            <p>
              <span>VAULT AVAILABLE</span>
              <strong id="deposit-vault-available">-</strong>
            </p>
            <p>
              <span>VAULT LOCKED</span>
              <strong id="deposit-vault-locked">-</strong>
            </p>
            <p>
              <span>ALLOWANCE</span>
              <strong id="deposit-allowance">-</strong>
            </p>
          </div>

          <p id="deposit-status" className="subtitle" />

          <div className="modal-actions modal-actions-deposit">
            <button id="deposit-confirm" className="primary">
              DEPOSIT NOW
            </button>
            <button
              id="deposit-manage-funds"
              className="manage"
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("chicken:open-money-panel"));
              }}
            >
              MANAGE MONEY
            </button>
          </div>
        </div>
      </div>

      <div id="result-container">
        <div id="result">
          <button className="close-btn" id="result-close" aria-label="Close">
            X
          </button>
          <h1 id="result-title">GAME OVER</h1>
          <div id="result-body" />
          <div className="modal-actions">
            <button id="retry" className="primary">
              PLAY AGAIN
            </button>
          </div>
        </div>
      </div>

      <button
        id="game-help-btn"
        className="fixed-help"
        type="button"
        title="Game Rules"
        aria-label="Game Rules"
      >
        <Image
          src="/images/how.png"
          alt=""
          width={96}
          height={96}
          className="fixed-help-image"
          aria-hidden="true"
        />
      </button>

      <button
        id="character-btn"
        className="fixed-character"
        type="button"
        title="Character"
        aria-label="Open character menu"
        onClick={() => {
          setCharacterModalOpen(true);
        }}
      >
        <Image
          src="/images/char.png"
          alt=""
          width={96}
          height={96}
          className="character-badge-image"
          aria-hidden="true"
        />
      </button>

      {!backgroundMode && characterModalOpen ? (
        <div
          id="character-modal"
          className="modal-bg character-modal"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setCharacterModalOpen(false);
            }
          }}
        >
          <div
            className="modal-box character-modal-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="character-modal-title"
          >
            <button
              className="close-btn"
              type="button"
              aria-label="Close character menu"
              onClick={() => {
                setCharacterModalOpen(false);
              }}
            >
              X
            </button>
            <div className="character-modal-header">
              <span className="character-modal-kicker">RUNNER SELECT</span>
              <h2 id="character-modal-title">CHOOSE BIRD</h2>
              <p className="subtitle">Current pick: {selectedCharacterName}</p>
            </div>

            <div className="character-grid" aria-label="Character choices">
              {characters.map((character) => {
                const isSelected = selectedCharacter === character.id;
                return (
                  <button
                    key={character.id}
                    type="button"
                    className={`character-card${isSelected ? " active" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => {
                      selectCharacter(character.id);
                    }}
                  >
                    <span className="character-token" aria-hidden="true">
                      <Image
                        src={character.imageSrc}
                        alt=""
                        width={96}
                        height={96}
                        className="character-token-image"
                      />
                    </span>
                    <span className="character-card-copy">
                      <strong>{character.name}</strong>
                      <small>{character.role}</small>
                    </span>
                    <span className="character-card-tone">
                      {isSelected ? "ACTIVE" : character.tone}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div
        id="game-help-modal"
        className="info-modal-overlay"
        style={{ display: "none" }}
      >
        <div
          className="info-modal-box game-help-box"
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-help-title"
        >
          <button
            className="info-modal-close"
            id="game-help-close"
            aria-label="Close"
          >
            X
          </button>
          <div className="game-help-header">
            <span className="game-help-kicker">HOW TO PLAY</span>
            <h2 id="game-help-title">GAME RULES</h2>
            <p>Hop smart, reach checkpoint, cash out before the road wins.</p>
          </div>
          <div className="home-help-content">
            <div className="help-step">
              <span className="step-num">1</span>
              <div>
                <p className="step-title">CORE LOOP</p>
                <p>
                  Move forward to increase multiplier. Survive traffic and reach
                  checkpoints.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-num">2</span>
              <div>
                <p className="step-title">MULTIPLIER</p>
                <p>
                  Every forward step adds +0.025x. Checkpoint bonus is x1.2
                  compound.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-num">3</span>
              <div>
                <p className="step-title">CHECKPOINT WINDOW</p>
                <p>
                  Checkpoint appears every 40 hops. Cash out only while you are
                  at a checkpoint.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-num">4</span>
              <div>
                <p className="step-title">TIME & DECAY</p>
                <p>
                  You have 60s between checkpoints. If overtime, multiplier
                  decays at -0.1x per second.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-num">5</span>
              <div>
                <p className="step-title">LOSE CONDITION</p>
                <p>Hit by a vehicle before cash out means stake is lost.</p>
              </div>
            </div>
          </div>
          <button
            className="flow-btn secondary info-modal-action"
            id="game-help-got-it"
            type="button"
          >
            GOT IT
          </button>
        </div>
      </div>

      <Script src="/script.js" strategy="afterInteractive" type="module" />
    </>
  );
}

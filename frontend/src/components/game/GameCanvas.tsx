import { GameBridgeClient } from "./GameBridgeClient";
import Link from "next/link";
import Script from "next/script";

type GameCanvasProps = {
  backgroundMode?: boolean;
};

export function GameCanvas({ backgroundMode = false }: GameCanvasProps) {
  return (
    <>
      <GameBridgeClient backgroundMode={backgroundMode} />
      <canvas className="game" />
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
              <div className="score-separator" aria-hidden="true" />
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
                    $0.0000
                  </span>
                </div>
                <div className="bet-hud-metric bet-hud-metric-primary">
                  <span className="bet-hud-metric-label">CASH OUT</span>
                  <span
                    id="bet-payout"
                    className="bet-hud-metric-value payout-value"
                  >
                    $0.0000
                  </span>
                </div>
                <div className="bet-hud-metric bet-hud-metric-wide">
                  <span className="bet-hud-metric-label">MULTIPLIER</span>
                  <span
                    id="bet-multiplier"
                    className="bet-hud-metric-value multiplier-value"
                  >
                    0.00x
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
              Start a paid run to see live payout and multiplier.
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
              $0.0000
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
          <button id="bet-btn">START RUN</button>
        </div>
      </div>

      <div id="controls">
        <div>
          <button id="forward">{"\u25B2"}</button>
          <button id="left">{"\u25C0"}</button>
          <button id="backward">{"\u25BC"}</button>
          <button id="right">{"\u25B6"}</button>
        </div>
      </div>

      <div id="bet-panel" className="modal-bg">
        <div className="modal-box modal-box-bet">
          <button className="close-btn" id="bet-panel-close" aria-label="Close">
            X
          </button>
          <h2>CONFIRM PAID RUN</h2>
          <p className="subtitle">
            Fixed stake, on-chain outcome, checkpoint cash out
          </p>

          <div className="odds-info">
            <p className="odds-title">FIXED STAKE</p>
            <div className="odds-row">
              <span className="odds-key">Per run</span>
              <strong>0.0001 USDC</strong>
            </div>
            <div className="odds-row">
              <span className="odds-key">Editable</span>
              <strong>NO</strong>
            </div>
          </div>

          <div className="odds-info">
            <p className="odds-title">VALUE RISK</p>
            <div className="odds-note-list">
              <div className="odds-note-item">
                <span className="dot dot-yellow" aria-hidden="true" /> Starting
                a live run spends 0.0001 USDC from your vault balance.
              </div>
              <div className="odds-note-item">
                <span className="dot dot-red" aria-hidden="true" /> If you lose
                before cash out, that 0.0001 USDC is lost.
              </div>
              <div className="odds-note-item">
                <span className="dot dot-green" aria-hidden="true" /> If you win
                and cash out, the stake returns with the payout reward.
              </div>
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
              START 0.0001 USDC RUN
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
            <Link
              id="deposit-manage-funds"
              className="manage"
              href="/managemoney"
            >
              MANAGE MONEY
            </Link>
          </div>
        </div>
      </div>

      <div id="result-container">
        <div id="result">
          <h1 id="result-title">Game Over</h1>
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
      >
        ?
      </button>

      <div
        id="game-help-modal"
        className="info-modal-overlay"
        style={{ display: "none" }}
      >
        <div
          className="info-modal-box"
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
          <h2 id="game-help-title">GAME RULES</h2>
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

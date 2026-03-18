import { useState } from "react";

import { type TimeControlMinutes } from "../game-setup";

type OnlineWaitingScreenProps = {
  connectionLabel: string;
  gameCode: string;
  onCancel: () => void;
  timeControlMinutes: TimeControlMinutes;
};

function getTimeLabel(timeControlMinutes: TimeControlMinutes) {
  return `${timeControlMinutes} min`;
}

export function OnlineWaitingScreen({
  connectionLabel,
  gameCode,
  onCancel,
  timeControlMinutes,
}: OnlineWaitingScreenProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(gameCode);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return (
    <main className="app-shell start-screen-shell">
      <section className="start-layout">
        <section className="board-panel waiting-panel">
          <div className="setup-header waiting-header">
            <div className="setup-header-copy">
              <p className="panel-label">Waiting For Opponent</p>
              <h1 className="setup-title">Share this match code</h1>
              <p className="panel-caption">
                The room is live. As soon as a second browser joins, the game will begin
                automatically and you will play as White.
              </p>
            </div>

            <div className="setup-header-actions waiting-actions">
              <p className="setup-current-selection">{connectionLabel}</p>
              <button type="button" className="secondary-button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>

          <div className="waiting-code-card" aria-live="polite">
            <span className="metric-label">Session Code</span>
            <strong>{gameCode}</strong>
            <div className="inline-field-row">
              <button
                type="button"
                className="secondary-button primary-action"
                onClick={handleCopyCode}
              >
                {copyState === "copied" ? "Copied" : "Copy Code"}
              </button>
              {copyState === "error" ? (
                <span className="supporting-copy">
                  Clipboard access is unavailable in this browser.
                </span>
              ) : null}
            </div>
          </div>

          <div className="setup-summary-strip" aria-label="Waiting room details">
            <div className="setup-summary-chip">
              <span className="metric-label">You Are</span>
              <strong>White</strong>
            </div>
            <div className="setup-summary-chip">
              <span className="metric-label">Clock</span>
              <strong>{getTimeLabel(timeControlMinutes)}</strong>
            </div>
            <div className="setup-summary-chip">
              <span className="metric-label">Status</span>
              <strong>Opponent needed</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

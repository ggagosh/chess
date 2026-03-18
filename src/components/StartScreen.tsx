import { useState, type FormEvent } from "react";

import { OPPONENT_MODE_OPTIONS } from "../computer-opponent";
import {
  COLOR_PREFERENCE_OPTIONS,
  TIME_CONTROL_OPTIONS,
  type ColorPreference,
  type GameSettings,
  type TimeControlMinutes,
} from "../game-setup";

type StartScreenProps = {
  onlineError: string | null;
  onlinePendingAction: "create" | "join" | null;
  onlineReady: boolean;
  onCreateOnlineGame: () => void;
  onJoinOnlineGame: (code: string) => void;
  onSettingChange: (update: Partial<GameSettings>) => void;
  onStartGame: () => void;
  settings: GameSettings;
};

function getColorSummary(colorPreference: ColorPreference) {
  if (colorPreference === "random") {
    return "White or Black will be assigned when the game starts.";
  }

  return `${colorPreference[0].toUpperCase()}${colorPreference.slice(1)} starts at the bottom of the board.`;
}

function getTimeLabel(timeControlMinutes: TimeControlMinutes) {
  return `${timeControlMinutes} min`;
}

export function StartScreen({
  onlineError,
  onlinePendingAction,
  onlineReady,
  onCreateOnlineGame,
  onJoinOnlineGame,
  onSettingChange,
  onStartGame,
  settings,
}: StartScreenProps) {
  const [joinCode, setJoinCode] = useState("");
  const activeOpponent =
    OPPONENT_MODE_OPTIONS.find((option) => option.value === settings.opponentMode) ??
    OPPONENT_MODE_OPTIONS[0];
  const colorLabel =
    settings.colorPreference === "random"
      ? "Random"
      : `${settings.colorPreference[0].toUpperCase()}${settings.colorPreference.slice(1)}`;
  const selectionSummary = `${getTimeLabel(settings.timeControlMinutes)} • ${activeOpponent.label} • ${colorLabel}`;
  const isOnlineBusy = onlinePendingAction !== null;
  const onlineStatusCopy = onlineReady
    ? `The selected ${getTimeLabel(settings.timeControlMinutes)} clock will be used for new online games. The host plays White.`
    : "Preparing your anonymous player ID for online games.";

  function handleJoinGameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoinOnlineGame(joinCode);
  }

  return (
    <main className="app-shell start-screen-shell">
      <section className="start-layout">
        <section className="board-panel setup-panel">
          <div className="setup-header">
            <div className="setup-header-copy">
              <p className="panel-label">Game Setup</p>
              <h1 className="setup-title">Start a game</h1>
              <p className="panel-caption">
                Choose a local setup or open an online session code. Your latest local settings stay
                selected between visits.
              </p>
            </div>
          </div>

          <div className="play-path-grid">
            <section className="setup-card play-path-card">
              <div className="setup-card-copy">
                <p className="panel-label">Play Locally</p>
                <p className="supporting-copy">
                  Start on this device with the current clock, opponent, and color settings.
                </p>
              </div>

              <p className="setup-current-selection">{selectionSummary}</p>
              <button
                type="button"
                className="secondary-button primary-action"
                onClick={onStartGame}
              >
                Start Local Game
              </button>
            </section>

            <section className="setup-card play-path-card">
              <div className="setup-card-copy">
                <p className="panel-label">Play Online</p>
                <p className="supporting-copy">
                  Create a shareable code or join an existing room for real-time browser-to-browser
                  play.
                </p>
              </div>

              <div className="online-actions">
                <button
                  type="button"
                  className="secondary-button primary-action"
                  disabled={!onlineReady || isOnlineBusy}
                  onClick={onCreateOnlineGame}
                >
                  {onlinePendingAction === "create" ? "Creating..." : "Create Game"}
                </button>

                <form className="online-join-form" onSubmit={handleJoinGameSubmit}>
                  <label className="compact-field">
                    <span className="compact-label">Session Code</span>
                    <div className="inline-field-row">
                      <input
                        className="text-input"
                        disabled={!onlineReady || isOnlineBusy}
                        inputMode="text"
                        onChange={(event) => setJoinCode(event.target.value)}
                        placeholder="KNIGHT-4829"
                        spellCheck={false}
                        type="text"
                        value={joinCode}
                      />
                      <button
                        type="submit"
                        className="secondary-button"
                        disabled={!onlineReady || isOnlineBusy || joinCode.trim().length === 0}
                      >
                        {onlinePendingAction === "join" ? "Joining..." : "Join Game"}
                      </button>
                    </div>
                  </label>
                </form>
              </div>

              <p className="supporting-copy">{onlineStatusCopy}</p>
              {onlineError ? (
                <p className="toolbar-notice start-screen-notice">{onlineError}</p>
              ) : null}
            </section>
          </div>

          <div className="local-setup-header">
            <div>
              <p className="panel-label">Local Setup</p>
              <p className="supporting-copy">These controls only affect the local play path.</p>
            </div>
          </div>

          <div className="setup-summary-strip" aria-label="Selected local setup">
            <div className="setup-summary-chip">
              <span className="metric-label">Clock</span>
              <strong>{getTimeLabel(settings.timeControlMinutes)}</strong>
            </div>
            <div className="setup-summary-chip">
              <span className="metric-label">Opponent</span>
              <strong>{activeOpponent.label}</strong>
            </div>
            <div className="setup-summary-chip">
              <span className="metric-label">Color</span>
              <strong>{colorLabel}</strong>
            </div>
          </div>

          <div className="setup-stack">
            <section className="setup-card">
              <div className="setup-card-copy">
                <p className="panel-label">Time Control</p>
                <p className="supporting-copy">Pick the pace for both clocks.</p>
              </div>

              <div className="setting-grid" role="group" aria-label="Time control">
                {TIME_CONTROL_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`setting-button ${settings.timeControlMinutes === option.value ? "is-active" : ""}`}
                    aria-pressed={settings.timeControlMinutes === option.value}
                    onClick={() => onSettingChange({ timeControlMinutes: option.value })}
                  >
                    <span className="setting-button-label">{option.label}</span>
                    <span className="setting-button-copy">{option.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="setup-card">
              <div className="setup-card-copy">
                <p className="panel-label">Opponent Mode</p>
                <p className="supporting-copy">
                  Set the opening opponent before the board appears.
                </p>
              </div>

              <div className="setting-grid" role="group" aria-label="Opponent mode">
                {OPPONENT_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`setting-button ${settings.opponentMode === option.value ? "is-active" : ""}`}
                    aria-pressed={settings.opponentMode === option.value}
                    onClick={() => onSettingChange({ opponentMode: option.value })}
                  >
                    <span className="setting-button-label">{option.label}</span>
                    <span className="setting-button-copy">{option.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="setup-card">
              <div className="setup-card-copy">
                <p className="panel-label">Color Preference</p>
                <p className="supporting-copy">{getColorSummary(settings.colorPreference)}</p>
              </div>

              <div className="setting-grid" role="group" aria-label="Color preference">
                {COLOR_PREFERENCE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`setting-button ${settings.colorPreference === option.value ? "is-active" : ""}`}
                    aria-pressed={settings.colorPreference === option.value}
                    onClick={() => onSettingChange({ colorPreference: option.value })}
                  >
                    <span className="setting-button-label">{option.label}</span>
                    <span className="setting-button-copy">{option.description}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

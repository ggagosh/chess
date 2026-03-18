import { OPPONENT_MODE_OPTIONS } from "../computer-opponent";
import {
  COLOR_PREFERENCE_OPTIONS,
  TIME_CONTROL_OPTIONS,
  type ColorPreference,
  type GameSettings,
  type TimeControlMinutes,
} from "../game-setup";

type StartScreenProps = {
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

export function StartScreen({ onSettingChange, onStartGame, settings }: StartScreenProps) {
  const activeOpponent =
    OPPONENT_MODE_OPTIONS.find((option) => option.value === settings.opponentMode) ??
    OPPONENT_MODE_OPTIONS[0];
  const colorLabel =
    settings.colorPreference === "random"
      ? "Random"
      : `${settings.colorPreference[0].toUpperCase()}${settings.colorPreference.slice(1)}`;
  const selectionSummary = `${getTimeLabel(settings.timeControlMinutes)} • ${activeOpponent.label} • ${colorLabel}`;

  return (
    <main className="app-shell start-screen-shell">
      <section className="start-layout">
        <section className="board-panel setup-panel">
          <div className="setup-header">
            <div className="setup-header-copy">
              <p className="panel-label">Game Setup</p>
              <h1 className="setup-title">Start a game</h1>
              <p className="panel-caption">
                Choose the clock, opponent, and side. Your latest setup stays selected between
                sessions.
              </p>
            </div>

            <div className="setup-header-actions">
              <p className="setup-current-selection">{selectionSummary}</p>
              <button
                type="button"
                className="secondary-button primary-action"
                onClick={onStartGame}
              >
                Start Game
              </button>
            </div>
          </div>

          <div className="setup-summary-strip" aria-label="Selected setup">
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

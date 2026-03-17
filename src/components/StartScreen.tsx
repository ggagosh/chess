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

  return (
    <main className="app-shell start-screen-shell">
      <section className="hero-panel start-hero">
        <div className="hero-copy">
          <p className="eyebrow">Game Setup</p>
          <h1>Choose the board, the clock, and the opponent before the first move.</h1>
          <p className="lede">
            Set the pace, decide whether the board belongs to two players or an engine, and pick the
            side you want before dropping into the existing chess surface.
          </p>
        </div>

        <div className="hero-stats" aria-label="Selected setup">
          <div className="status-card phase-active">
            <span className="status-pill">Ready</span>
            <h2>{activeOpponent.label}</h2>
            <p>{activeOpponent.description}</p>
          </div>

          <div className="metrics-card">
            <div className="metric">
              <span className="metric-label">Clock</span>
              <strong>{getTimeLabel(settings.timeControlMinutes)}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Opponent</span>
              <strong>{activeOpponent.label}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Color</span>
              <strong>
                {settings.colorPreference[0].toUpperCase()}
                {settings.colorPreference.slice(1)}
              </strong>
            </div>
            <div className="metric">
              <span className="metric-label">Restore</span>
              <strong>Session saved</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="start-layout">
        <section className="board-panel setup-panel">
          <div className="setup-header">
            <div>
              <p className="panel-label">Start Screen</p>
              <p className="panel-caption">
                Every choice below is stored in the browser session. Starting a new game from the
                board will bring you back here with the latest configuration preselected.
              </p>
            </div>

            <button type="button" className="secondary-button primary-action" onClick={onStartGame}>
              Start Game
            </button>
          </div>

          <div className="setup-stack">
            <section className="setup-card">
              <div className="setup-card-copy">
                <p className="panel-label">Time Control</p>
                <p className="supporting-copy">
                  Both clocks start with the same amount of time and begin counting down immediately
                  when the game screen opens.
                </p>
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
                  The game screen keeps its live opponent controls, but this choice sets the opening
                  mode before the board appears.
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

        <aside className="inspector-panel">
          <div className="info-card">
            <p className="panel-label">Launch Path</p>
            <ul className="rule-list">
              <li>Choose the clock, opponent, and color.</li>
              <li>Press `Start Game` to enter the existing board surface.</li>
              <li>Refresh mid-game to stay on the board with the same session.</li>
              <li>Press `New Game` from the board to return here.</li>
            </ul>
          </div>

          <div className="info-card">
            <p className="panel-label">Current Selection</p>
            <p className="pgn-preview">
              {getTimeLabel(settings.timeControlMinutes)} · {activeOpponent.label} ·{" "}
              {settings.colorPreference === "random"
                ? "Random color"
                : `${settings.colorPreference[0].toUpperCase()}${settings.colorPreference.slice(1)} side`}
            </p>
            <p className="supporting-copy">
              The game screen still includes move history, sounds, undo/redo, captures, promotion,
              and result handling exactly where they are today.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

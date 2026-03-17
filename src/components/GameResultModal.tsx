import type { EngineMove, GamePhase, PlayerColor } from "../chess-engine";

type ResultState = {
  detail: string;
  headline: string;
  phase: Extract<GamePhase, "checkmate" | "stalemate">;
  winner: PlayerColor | null;
};

type GameResultModalProps = {
  isOpen: boolean;
  lastMove: EngineMove | null;
  moveCount: number;
  onClose: () => void;
  onReset: () => void;
  result: ResultState | null;
};

function playerName(player: PlayerColor) {
  return player === "white" ? "White" : "Black";
}

function buildOutcome(result: ResultState) {
  if (result.winner) {
    return `${playerName(result.winner)} wins`;
  }

  return "Draw";
}

export function GameResultModal({
  isOpen,
  lastMove,
  moveCount,
  onClose,
  onReset,
  result,
}: GameResultModalProps) {
  if (!isOpen || !result) {
    return null;
  }

  return (
    <div className="dialog-scrim" role="presentation">
      <section
        aria-labelledby="game-result-title"
        aria-modal="true"
        className="dialog-card result-dialog"
        role="dialog"
      >
        <p className="dialog-kicker">{result.phase}</p>
        <h2 id="game-result-title">{result.headline}</h2>
        <p className="dialog-copy">{result.detail}</p>

        <div className="result-grid">
          <div className="result-metric">
            <span>Outcome</span>
            <strong>{buildOutcome(result)}</strong>
          </div>
          <div className="result-metric">
            <span>Plies</span>
            <strong>{moveCount}</strong>
          </div>
          <div className="result-metric">
            <span>Final move</span>
            <strong>{lastMove ? lastMove.san : "Opening position"}</strong>
          </div>
        </div>

        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Review board
          </button>
          <button type="button" className="secondary-button primary-action" onClick={onReset}>
            Play again
          </button>
        </div>
      </section>
    </div>
  );
}

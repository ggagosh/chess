import { useEffect, useState } from "react";
import type { Square } from "chess.js";

import "./App.css";
import { GameClock } from "./components/GameClock";
import { GameResultModal } from "./components/GameResultModal";
import { MoveHistoryPanel } from "./components/MoveHistoryPanel";
import { PawnPromotionDialog } from "./components/PawnPromotionDialog";
import {
  STARTING_FEN,
  applyMove,
  createGame,
  getAllLegalMoves,
  getBoardCells,
  getCapturedPieces,
  getGameStatus,
  getLegalMoves,
  getMoveTargets,
  type EngineMove,
  type PromotionPiece,
} from "./chess-engine";
import { createInitialClockState, tickClock } from "./game-clock";

type PromotionRequest = {
  moves: EngineMove[];
  to: Square;
};

const SPECIAL_RULES = [
  "Castling rights are unlocked only when the king and rook stay unmoved, the path is clear, and the king never crosses check.",
  "En passant appears only on the immediately following turn after a two-square pawn advance.",
  "Promotion now pauses board input until you choose queen, rook, bishop, or knight.",
];

function toTitleCase(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function isTerminalPhase(phase: ReturnType<typeof getGameStatus>["phase"]) {
  return phase === "checkmate" || phase === "stalemate";
}

function App() {
  const [fen, setFen] = useState(STARTING_FEN);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [moveLog, setMoveLog] = useState<EngineMove[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<PromotionRequest | null>(null);
  const [clockState, setClockState] = useState(createInitialClockState);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const game = createGame(fen);
  const boardCells = getBoardCells(game);
  const gameStatus = getGameStatus(game);
  const capturedPieces = getCapturedPieces(game);
  const legalMoveCount = getAllLegalMoves(game).length;
  const selectedMoves = selectedSquare ? getLegalMoves(game, selectedSquare) : [];
  const moveTargets = getMoveTargets(selectedMoves);
  const lastMove = moveLog.at(-1) ?? null;
  const isGameOver = isTerminalPhase(gameStatus.phase);
  const terminalPhase: "checkmate" | "stalemate" =
    gameStatus.phase === "checkmate" ? "checkmate" : "stalemate";
  const statusDetail = pendingPromotion
    ? `${toTitleCase(gameStatus.turn)} reached ${pendingPromotion.to}. Choose a promotion piece to complete the move.`
    : gameStatus.detail;
  const gameResult = isGameOver
    ? {
        detail: gameStatus.detail,
        headline: gameStatus.headline,
        phase: terminalPhase,
        winner: gameStatus.winner,
      }
    : null;

  useEffect(() => {
    if (isGameOver) {
      setIsResultModalOpen(true);
      return;
    }

    setIsResultModalOpen(false);
  }, [fen, gameStatus.phase, isGameOver]);

  useEffect(() => {
    if (isGameOver) {
      return;
    }

    let previousTick = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - previousTick;
      previousTick = now;

      setClockState((current) => {
        if (current[gameStatus.turn] <= 0) {
          return current;
        }

        return tickClock(current, gameStatus.turn, elapsedMs);
      });
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [gameStatus.turn, isGameOver]);

  function commitMove(move: EngineMove) {
    const nextGame = createGame(fen);
    const executed = applyMove(nextGame, move);

    setFen(nextGame.fen());
    setMoveLog((current) => [...current, executed]);
    setPendingPromotion(null);
    setSelectedSquare(null);
  }

  function resetGame() {
    setFen(STARTING_FEN);
    setMoveLog([]);
    setPendingPromotion(null);
    setSelectedSquare(null);
    setClockState(createInitialClockState());
    setIsResultModalOpen(false);
  }

  function handlePromotionChoice(piece: PromotionPiece) {
    if (!pendingPromotion) {
      return;
    }

    const selectedMove = pendingPromotion.moves.find((move) => move.promotion === piece);

    if (!selectedMove) {
      return;
    }

    commitMove(selectedMove);
  }

  function handleSquareClick(square: Square) {
    if (isGameOver || pendingPromotion) {
      return;
    }

    const destinationMoves = selectedSquare ? moveTargets.get(square) : undefined;

    if (selectedSquare && destinationMoves) {
      const promotionMoves = destinationMoves.filter((move) => move.promotion);

      if (promotionMoves.length > 0) {
        setPendingPromotion({
          moves: promotionMoves,
          to: square,
        });
        return;
      }

      commitMove(destinationMoves[0]);
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    const piece = game.get(square);

    if (!piece) {
      setSelectedSquare(null);
      return;
    }

    const pieceColor = piece.color === "w" ? "white" : "black";

    if (pieceColor !== gameStatus.turn) {
      setSelectedSquare(null);
      return;
    }

    setSelectedSquare(square);
  }

  function cancelPromotion() {
    setPendingPromotion(null);
  }

  return (
    <>
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Playable Chess Engine</p>
            <h1>Board state, clocks, move history, and game endings in one play surface.</h1>
            <p className="lede">
              The starter shell now carries the full game loop plus the supporting match UI: clocks
              tick with the active side, promotions resolve in a focused dialog, every move lands in
              history, and completed games surface a result modal.
            </p>
          </div>

          <div className="hero-stats" aria-label="Game snapshot">
            <div className={`status-card phase-${gameStatus.phase}`}>
              <span className="status-pill">{gameStatus.phase}</span>
              <h2>{gameStatus.headline}</h2>
              <p>{statusDetail}</p>
            </div>

            <div className="metrics-card">
              <div className="metric">
                <span className="metric-label">Turn</span>
                <strong>{toTitleCase(gameStatus.turn)}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Legal moves</span>
                <strong>{legalMoveCount}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Last move</span>
                <strong>{lastMove ? lastMove.san : "Opening position"}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Move count</span>
                <strong>{moveLog.length}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="experience-grid">
          <div className="board-panel">
            <div className="board-toolbar">
              <div>
                <p className="panel-label">Board</p>
                <p className="panel-caption">
                  Click a piece to reveal legal moves. The board locks only while promotion is
                  awaiting your choice or after the game ends.
                </p>
              </div>
              <button type="button" className="secondary-button" onClick={resetGame}>
                Reset game
              </button>
            </div>

            <div className="board-frame">
              <div className="side-rack">
                <div className="side-rack-copy">
                  <span className="side-rack-player">Black</span>
                  <span className="side-rack-caption">Pieces captured by White</span>
                </div>
                <GameClock
                  isActive={!isGameOver && gameStatus.turn === "black"}
                  isGameOver={isGameOver}
                  isInCheck={!isGameOver && gameStatus.turn === "black" && gameStatus.inCheck}
                  player="black"
                  timeRemainingMs={clockState.black}
                />
                <div className="captured-row">
                  {capturedPieces.black.length > 0 ? (
                    capturedPieces.black.map((piece, index) => (
                      <span
                        key={`${piece.label}-black-${index}`}
                        className="captured-piece"
                        aria-label={piece.label}
                        title={piece.label}
                      >
                        {piece.glyph}
                      </span>
                    ))
                  ) : (
                    <span className="captured-empty">None</span>
                  )}
                </div>
              </div>

              <div className="board-grid" role="grid" aria-label="Interactive chess board">
                {boardCells.map((cell) => {
                  const targetMoves = moveTargets.get(cell.square) ?? [];
                  const isSelected = selectedSquare === cell.square;
                  const isLegalTarget = targetMoves.length > 0;
                  const isCaptureTarget = targetMoves.some((move) => move.isCapture);
                  const isPromotionTarget = targetMoves.some((move) => move.promotion);
                  const isLastMoveSquare =
                    lastMove?.from === cell.square || lastMove?.to === cell.square;
                  const isCheckedKing =
                    gameStatus.inCheck &&
                    cell.piece?.color === gameStatus.turn &&
                    cell.piece?.type === "king";
                  const squareLabel = [
                    `${cell.square}`,
                    cell.piece ? cell.piece.label : "empty square",
                    isSelected ? "selected" : null,
                    isLegalTarget ? "legal move target" : null,
                    isCheckedKing ? "king in check" : null,
                  ]
                    .filter(Boolean)
                    .join(", ");

                  return (
                    <button
                      key={cell.square}
                      type="button"
                      className={[
                        "board-square",
                        cell.isLight ? "light" : "dark",
                        isSelected ? "selected" : "",
                        isLegalTarget ? "target" : "",
                        isCaptureTarget ? "capture" : "",
                        isPromotionTarget ? "promotion" : "",
                        isLastMoveSquare ? "last-move" : "",
                        isCheckedKing ? "checked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={squareLabel}
                      onClick={() => handleSquareClick(cell.square)}
                    >
                      {cell.file === "a" ? <span className="rank-label">{cell.rank}</span> : null}
                      {cell.rank === 1 ? <span className="file-label">{cell.file}</span> : null}
                      {cell.piece ? (
                        <span className={`piece piece-${cell.piece.color}`}>
                          {cell.piece.glyph}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="side-rack">
                <div className="side-rack-copy">
                  <span className="side-rack-player">White</span>
                  <span className="side-rack-caption">Pieces captured by Black</span>
                </div>
                <GameClock
                  isActive={!isGameOver && gameStatus.turn === "white"}
                  isGameOver={isGameOver}
                  isInCheck={!isGameOver && gameStatus.turn === "white" && gameStatus.inCheck}
                  player="white"
                  timeRemainingMs={clockState.white}
                />
                <div className="captured-row">
                  {capturedPieces.white.length > 0 ? (
                    capturedPieces.white.map((piece, index) => (
                      <span
                        key={`${piece.label}-white-${index}`}
                        className="captured-piece"
                        aria-label={piece.label}
                        title={piece.label}
                      >
                        {piece.glyph}
                      </span>
                    ))
                  ) : (
                    <span className="captured-empty">None</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <aside className="inspector-panel">
            <div className="info-card">
              <p className="panel-label">Special Rules</p>
              <ul className="rule-list">
                {SPECIAL_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>

            <MoveHistoryPanel moves={moveLog} />
          </aside>
        </section>
      </main>

      <PawnPromotionDialog
        color={gameStatus.turn}
        isOpen={pendingPromotion !== null}
        onCancel={cancelPromotion}
        onChoose={handlePromotionChoice}
        square={pendingPromotion?.to ?? null}
      />

      <GameResultModal
        isOpen={isResultModalOpen}
        lastMove={lastMove}
        moveCount={moveLog.length}
        onClose={() => setIsResultModalOpen(false)}
        onReset={resetGame}
        result={gameResult}
      />
    </>
  );
}

export default App;

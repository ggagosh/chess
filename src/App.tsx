import { useEffect, useReducer, useState } from "react";
import type { Square } from "chess.js";

import "./App.css";
import { GameClock } from "./components/GameClock";
import { GameResultModal } from "./components/GameResultModal";
import { MoveHistoryPanel } from "./components/MoveHistoryPanel";
import { PawnPromotionDialog } from "./components/PawnPromotionDialog";
import {
  getBoardCells,
  getLegalMoves,
  getMoveTargets,
  type EngineMove,
  type MoveInput,
  type PromotionPiece,
} from "./chess-engine";
import { createInitialClockState, tickClock } from "./game-clock";
import {
  INITIAL_GAME_TIMELINE_STATE,
  buildGameTimelineSnapshot,
  gameTimelineReducer,
} from "./game-state";

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

function toMoveInput(move: EngineMove): MoveInput {
  return {
    from: move.from,
    promotion: move.promotion,
    to: move.to,
  };
}

function App() {
  const [timelineState, dispatchTimeline] = useReducer(
    gameTimelineReducer,
    INITIAL_GAME_TIMELINE_STATE,
  );
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PromotionRequest | null>(null);
  const [clockState, setClockState] = useState(createInitialClockState);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);

  const {
    canRedo,
    canUndo,
    capturedPieces,
    futureCount,
    game,
    historyIndex,
    legalMoveCount,
    moveLog,
    pgn,
    status: gameStatus,
    totalMoves,
  } = buildGameTimelineSnapshot(timelineState);
  const boardCells = getBoardCells(game);
  const selectedMoves = selectedSquare ? getLegalMoves(game, selectedSquare) : [];
  const moveTargets = getMoveTargets(selectedMoves);
  const lastMove = moveLog.at(-1) ?? null;
  const isGameOver = gameStatus.phase === "checkmate" || gameStatus.phase === "stalemate";
  const resultPhase: "checkmate" | "stalemate" | null =
    gameStatus.phase === "checkmate"
      ? "checkmate"
      : gameStatus.phase === "stalemate"
        ? "stalemate"
        : null;
  const timelineSummary =
    futureCount > 0 ? `${historyIndex} active / ${totalMoves} recorded` : `${historyIndex} plies`;
  const pgnPreview = pgn || "No moves played yet. White has the first turn.";
  const statusDetail = pendingPromotion
    ? `${toTitleCase(gameStatus.turn)} reached ${pendingPromotion.to}. Choose a promotion piece to complete the move.`
    : gameStatus.detail;
  const gameResult = resultPhase
    ? {
        detail: gameStatus.detail,
        headline: gameStatus.headline,
        phase: resultPhase,
        winner: gameStatus.winner,
      }
    : null;

  useEffect(() => {
    if (isGameOver) {
      setIsResultModalOpen(true);
      return;
    }

    setIsResultModalOpen(false);
  }, [historyIndex, isGameOver, gameStatus.phase]);

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

  function clearTransientSelection() {
    setPendingPromotion(null);
    setSelectedSquare(null);
  }

  function commitMove(move: MoveInput) {
    dispatchTimeline({
      move,
      type: "commit",
    });
    clearTransientSelection();
  }

  function resetGame() {
    dispatchTimeline({ type: "reset" });
    clearTransientSelection();
    setClockState(createInitialClockState());
    setIsResultModalOpen(false);
  }

  function handleUndo() {
    if (!canUndo) {
      return;
    }

    dispatchTimeline({ type: "undo" });
    clearTransientSelection();
  }

  function handleRedo() {
    if (!canRedo) {
      return;
    }

    dispatchTimeline({ type: "redo" });
    clearTransientSelection();
  }

  function handlePromotionChoice(piece: PromotionPiece) {
    if (!pendingPromotion) {
      return;
    }

    const selectedMove = pendingPromotion.moves.find((move) => move.promotion === piece);

    if (!selectedMove) {
      return;
    }

    commitMove(toMoveInput(selectedMove));
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

      commitMove(toMoveInput(destinationMoves[0]));
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
              history, and turn state, PGN history, captured pieces, and undo/redo stay synchronized
              through the same engine timeline.
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
                <strong>{historyIndex}</strong>
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
                  Click a piece to reveal legal moves. Undo, redo, and reset all rebuild the live
                  board from the active move timeline, and the board locks while promotion is
                  awaiting your choice or after the game ends.
                </p>
              </div>

              <div className="toolbar-actions" aria-label="Game state controls">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleUndo}
                  disabled={!canUndo}
                >
                  Undo move
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleRedo}
                  disabled={!canRedo}
                >
                  Redo move
                </button>
                <button type="button" className="secondary-button" onClick={resetGame}>
                  Reset game
                </button>
              </div>
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

            <MoveHistoryPanel
              futureCount={futureCount}
              historyIndex={historyIndex}
              inCheck={gameStatus.inCheck}
              moves={moveLog}
              pgn={pgnPreview}
              timelineSummary={timelineSummary}
              turnLabel={toTitleCase(gameStatus.turn)}
            />
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
        moveCount={historyIndex}
        onClose={() => setIsResultModalOpen(false)}
        onReset={resetGame}
        result={gameResult}
      />
    </>
  );
}

export default App;

import { useState } from "react";
import type { Square } from "chess.js";

import "./App.css";
import {
  PROMOTION_OPTIONS,
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

type PromotionRequest = {
  moves: EngineMove[];
  to: Square;
};

const SPECIAL_RULES = [
  "Castling rights are unlocked only when the king and rook stay unmoved, the path is clear, and the king never crosses check.",
  "En passant appears only on the immediately following turn after a two-square pawn advance.",
  "Promotion lets you choose queen, rook, bishop, or knight before the move is finalized.",
];

const PROMOTION_GLYPHS: Record<"white" | "black", Record<PromotionPiece, string>> = {
  black: {
    bishop: "♝",
    knight: "♞",
    queen: "♛",
    rook: "♜",
  },
  white: {
    bishop: "♗",
    knight: "♘",
    queen: "♕",
    rook: "♖",
  },
};

function toTitleCase(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function buildMoveRows(moves: EngineMove[]) {
  const rows: Array<{
    black?: EngineMove;
    number: number;
    white: EngineMove;
  }> = [];

  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      black: moves[index + 1],
      number: Math.floor(index / 2) + 1,
      white: moves[index],
    });
  }

  return rows;
}

function App() {
  const [fen, setFen] = useState(STARTING_FEN);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [moveLog, setMoveLog] = useState<EngineMove[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<PromotionRequest | null>(null);

  const game = createGame(fen);
  const boardCells = getBoardCells(game);
  const gameStatus = getGameStatus(game);
  const capturedPieces = getCapturedPieces(game);
  const legalMoveCount = getAllLegalMoves(game).length;
  const selectedMoves = selectedSquare ? getLegalMoves(game, selectedSquare) : [];
  const moveTargets = getMoveTargets(selectedMoves);
  const lastMove = moveLog.at(-1) ?? null;
  const moveRows = buildMoveRows(moveLog);
  const statusDetail = pendingPromotion
    ? `${toTitleCase(gameStatus.turn)} reached ${pendingPromotion.to}. Choose a promotion piece to complete the move.`
    : gameStatus.detail;
  const canInteract = gameStatus.phase !== "checkmate" && gameStatus.phase !== "stalemate";

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
    if (!canInteract || pendingPromotion) {
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

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Playable Chess Engine</p>
          <h1>Legal move generation, special rules, and end-state detection in one board.</h1>
          <p className="lede">
            The starter shell is now replaced with a full game loop: every move is validated, the
            board only exposes legal targets, and the engine surfaces check, checkmate, stalemate,
            castling, en passant, and promotion.
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
                Click a piece to reveal legal moves. Illegal moves never become selectable.
              </p>
            </div>
            <button type="button" className="secondary-button" onClick={resetGame}>
              Reset game
            </button>
          </div>

          <div className="board-frame">
            <div className="captured-strip">
              <span>Captured from Black</span>
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
                      <span className={`piece piece-${cell.piece.color}`}>{cell.piece.glyph}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="captured-strip">
              <span>Captured from White</span>
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

          <div className="info-card">
            <p className="panel-label">Promotion</p>
            {pendingPromotion ? (
              <div className="promotion-panel">
                <p className="promotion-copy">
                  Promote the pawn on <strong>{pendingPromotion.to}</strong>.
                </p>
                <div className="promotion-grid">
                  {PROMOTION_OPTIONS.map((piece) => (
                    <button
                      key={piece}
                      type="button"
                      className="promotion-option"
                      onClick={() => handlePromotionChoice(piece)}
                    >
                      <span className="promotion-glyph">
                        {PROMOTION_GLYPHS[gameStatus.turn][piece]}
                      </span>
                      <span>{toTitleCase(piece)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="supporting-copy">
                Promotion choices appear here as soon as a pawn reaches the back rank.
              </p>
            )}
          </div>

          <div className="info-card move-log-card">
            <div className="move-log-header">
              <p className="panel-label">Move Log</p>
              <span className="move-log-total">{moveLog.length} plies</span>
            </div>
            {moveRows.length > 0 ? (
              <ol className="move-list">
                {moveRows.map((row) => (
                  <li key={row.number} className="move-row">
                    <span className="move-number">{row.number}.</span>
                    <span className="move-san">{row.white.san}</span>
                    <span className="move-san">{row.black?.san ?? "..."}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="supporting-copy">No moves played yet. White has the first turn.</p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

export default App;

import { useState } from "react";
import "./App.css";
import {
  BOARD_SIZE,
  applyMove,
  countLegalMoves,
  createCheckDemoSnapshot,
  createInitialSnapshot,
  getLegalMoves,
  getPieceLabel,
  indexToSquare,
  isKingInCheck,
  type GameSnapshot,
  type Move,
  type PieceColor,
} from "./chess";
import { getPieceAsset } from "./pieceAssets";

const boardSquares = Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index);
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];

function describeTurnState(
  turn: PieceColor,
  legalMoveCount: number,
  turnInCheck: boolean,
  whiteInCheck: boolean,
  blackInCheck: boolean,
) {
  if (legalMoveCount === 0 && turnInCheck) {
    return `${capitalize(turn)} is checkmated.`;
  }

  if (legalMoveCount === 0) {
    return "Stalemate.";
  }

  if (whiteInCheck && blackInCheck) {
    return "Both kings are under pressure in the current demo state.";
  }

  if (turnInCheck) {
    return `${capitalize(turn)} is in check.`;
  }

  if (whiteInCheck || blackInCheck) {
    const colorInCheck = whiteInCheck ? "white" : "black";
    return `${capitalize(colorInCheck)} is in check.`;
  }

  return `${capitalize(turn)} to move.`;
}

function App() {
  const [snapshot, setSnapshot] = useState<GameSnapshot>(createInitialSnapshot);
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null);
  const [dragSource, setDragSource] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);

  const interactionSquare = dragSource ?? selectedSquare;
  const legalTargets =
    interactionSquare === null || snapshot.board[interactionSquare]?.color !== snapshot.turn
      ? []
      : getLegalMoves(snapshot.board, interactionSquare);
  const legalTargetSet = new Set(legalTargets);
  const whiteInCheck = isKingInCheck(snapshot.board, "white");
  const blackInCheck = isKingInCheck(snapshot.board, "black");
  const turnInCheck = snapshot.turn === "white" ? whiteInCheck : blackInCheck;
  const legalMoveCount = countLegalMoves(snapshot.board, snapshot.turn);
  const statusLine = describeTurnState(
    snapshot.turn,
    legalMoveCount,
    turnInCheck,
    whiteInCheck,
    blackInCheck,
  );
  const checkSummary =
    whiteInCheck || blackInCheck
      ? `${[whiteInCheck ? "White" : "", blackInCheck ? "Black" : ""]
          .filter(Boolean)
          .join(" and ")} king in check`
      : "No king in check";

  const commitMove = (from: number, to: number) => {
    if (!legalTargetSet.has(to)) {
      return;
    }

    setSnapshot((current) => ({
      board: applyMove(current.board, { from, to }),
      turn: current.turn === "white" ? "black" : "white",
      label: current.label,
    }));
    setLastMove({ from, to });
    setSelectedSquare(null);
    setDragSource(null);
  };

  const resetBoard = (nextSnapshot: GameSnapshot) => {
    setSnapshot(nextSnapshot);
    setLastMove(null);
    setSelectedSquare(null);
    setDragSource(null);
  };

  const handleSquareClick = (index: number) => {
    if (selectedSquare !== null && legalTargetSet.has(index)) {
      commitMove(selectedSquare, index);
      return;
    }

    const piece = snapshot.board[index];

    if (piece?.color !== snapshot.turn) {
      setSelectedSquare(null);
      return;
    }

    setSelectedSquare((current) => (current === index ? null : index));
  };

  const handleDragStart = (index: number, event: React.DragEvent<HTMLImageElement>) => {
    if (snapshot.board[index]?.color !== snapshot.turn) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${index}`);
    setDragSource(index);
    setSelectedSquare(index);
  };

  const handleDragOver = (index: number, event: React.DragEvent<HTMLButtonElement>) => {
    if (!legalTargetSet.has(index)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (index: number, event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();

    const source = dragSource ?? Number.parseInt(event.dataTransfer.getData("text/plain"), 10);
    if (Number.isNaN(source)) {
      return;
    }

    commitMove(source, index);
  };

  const checkSquares = new Set<number>();
  snapshot.board.forEach((piece, index) => {
    if (!piece || piece.kind !== "king") {
      return;
    }

    if ((piece.color === "white" && whiteInCheck) || (piece.color === "black" && blackInCheck)) {
      checkSquares.add(index);
    }
  });

  return (
    <main className="app-shell">
      <section className="board-panel">
        <div className="board-frame">
          <div className="board-header">
            <div>
              <p className="eyebrow">Interactive board</p>
              <h1>Drag, drop, and test checks on a responsive chessboard.</h1>
            </div>
            <div className="chip-row" aria-label="Board state">
              <span className="chip">{snapshot.label}</span>
              <span className="chip chip-contrast">{statusLine}</span>
            </div>
          </div>

          <div className="board-grid" aria-label="Chessboard">
            {boardSquares.map((square) => {
              const row = Math.floor(square / BOARD_SIZE);
              const file = square % BOARD_SIZE;
              const isLightSquare = (row + file) % 2 === 0;
              const piece = snapshot.board[square];
              const isSelected = interactionSquare === square;
              const isLegalTarget = legalTargetSet.has(square);
              const isLastFrom = lastMove?.from === square;
              const isLastTo = lastMove?.to === square;
              const isCheckSquare = checkSquares.has(square);
              const fileLabel = row === BOARD_SIZE - 1 ? files[file] : "";
              const rankLabel = file === 0 ? `${BOARD_SIZE - row}` : "";
              const squareLabel = piece
                ? `${indexToSquare(square)}, ${getPieceLabel(piece)}`
                : `${indexToSquare(square)}, empty`;

              return (
                <button
                  key={square}
                  type="button"
                  className={[
                    "square",
                    isLightSquare ? "light" : "dark",
                    isSelected ? "square-selected" : "",
                    isLegalTarget ? "square-target" : "",
                    isLastFrom ? "square-last-from" : "",
                    isLastTo ? "square-last-to" : "",
                    isCheckSquare ? "square-check" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleSquareClick(square)}
                  onDragOver={(event) => handleDragOver(square, event)}
                  onDrop={(event) => handleDrop(square, event)}
                  aria-label={squareLabel}
                  aria-pressed={isSelected}
                >
                  {rankLabel ? <span className="rank-label">{rankLabel}</span> : null}
                  {fileLabel ? <span className="file-label">{fileLabel}</span> : null}
                  {piece ? (
                    <img
                      className="piece"
                      src={getPieceAsset(piece)}
                      alt=""
                      draggable={piece.color === snapshot.turn}
                      onDragStart={(event) => handleDragStart(square, event)}
                      onDragEnd={() => setDragSource(null)}
                    />
                  ) : null}
                  {isLegalTarget ? <span className="move-indicator" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="info-panel">
        <div className="panel-card hero-card">
          <p className="eyebrow">Board controls</p>
          <h2>Local move rules, check detection, and highlight states are wired in.</h2>
          <p className="lede">
            Drag a piece on desktop or tap a piece and a destination square on smaller screens.
            Legal targets appear during interaction, the last move stays marked, and checked kings
            pulse in place.
          </p>
          <div className="control-row">
            <button
              type="button"
              className="primary-action"
              onClick={() => resetBoard(createInitialSnapshot())}
            >
              Reset to start
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => resetBoard(createCheckDemoSnapshot())}
            >
              Load check demo
            </button>
          </div>
        </div>

        <div className="panel-card">
          <h3>Position summary</h3>
          <dl className="status-list">
            <div>
              <dt>Turn</dt>
              <dd>{capitalize(snapshot.turn)}</dd>
            </div>
            <div>
              <dt>Legal moves</dt>
              <dd>{legalMoveCount}</dd>
            </div>
            <div>
              <dt>Latest move</dt>
              <dd>
                {lastMove
                  ? `${indexToSquare(lastMove.from)} -> ${indexToSquare(lastMove.to)}`
                  : "None yet"}
              </dd>
            </div>
            <div>
              <dt>Check status</dt>
              <dd>{checkSummary}</dd>
            </div>
          </dl>
        </div>

        <div className="panel-card">
          <h3>Highlight legend</h3>
          <ul className="legend-list">
            <li>
              <span className="legend-swatch legend-target" />
              Valid move target
            </li>
            <li>
              <span className="legend-swatch legend-last" />
              Most recent move
            </li>
            <li>
              <span className="legend-swatch legend-check" />
              King in check
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;

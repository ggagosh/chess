import { useEffect, useRef, useState } from "react";

import type { EngineMove } from "../chess-engine";

type MoveHistoryPanelProps = {
  futureCount: number;
  historyIndex: number;
  inCheck: boolean;
  moves: EngineMove[];
  pgn: string;
  timelineSummary: string;
  turnLabel: string;
};

type MoveRow = {
  black?: EngineMove;
  number: number;
  white: EngineMove;
};

function buildMoveRows(moves: EngineMove[]): MoveRow[] {
  const rows: MoveRow[] = [];

  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      black: moves[index + 1],
      number: Math.floor(index / 2) + 1,
      white: moves[index],
    });
  }

  return rows;
}

function buildMoveTitle(move: EngineMove) {
  if (move.promotion) {
    return `${move.san} promotes to ${move.promotion}`;
  }

  if (move.isKingsideCastle || move.isQueensideCastle) {
    return `${move.san} castles`;
  }

  if (move.isEnPassant) {
    return `${move.san} captures en passant`;
  }

  if (move.isCapture) {
    return `${move.san} capture`;
  }

  return move.san;
}

export function MoveHistoryPanel({
  futureCount,
  historyIndex,
  inCheck,
  moves,
  pgn,
  timelineSummary,
  turnLabel,
}: MoveHistoryPanelProps) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const currentMoveRef = useRef<HTMLSpanElement | null>(null);
  const previousHistoryIndex = useRef(historyIndex);
  const [flashPlyIndex, setFlashPlyIndex] = useState<number | null>(null);
  const moveRows = buildMoveRows(moves);
  const currentPlyIndex = historyIndex > 0 ? historyIndex - 1 : null;

  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return;
    }

    if (currentMoveRef.current) {
      currentMoveRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
      return;
    }

    list.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPlyIndex, historyIndex]);

  useEffect(() => {
    const previous = previousHistoryIndex.current;

    previousHistoryIndex.current = historyIndex;

    if (historyIndex <= previous || currentPlyIndex === null) {
      return;
    }

    setFlashPlyIndex(currentPlyIndex);

    const timeoutId = window.setTimeout(() => {
      setFlashPlyIndex((current) => (current === currentPlyIndex ? null : current));
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [currentPlyIndex, historyIndex]);

  return (
    <section className="info-card move-history-panel">
      <div className="move-log-header">
        <div>
          <p className="panel-label">PGN Move History</p>
          <p className="panel-caption">
            The active line stays aligned with captures, clocks, and board state.
          </p>
        </div>
        <span className="move-log-total">{timelineSummary}</span>
      </div>
      <p className="pgn-preview">{pgn}</p>

      {moveRows.length > 0 ? (
        <ol ref={listRef} className="move-list" aria-label="Move history">
          {moveRows.map((row, rowIndex) => {
            const whitePlyIndex = rowIndex * 2;
            const blackPlyIndex = whitePlyIndex + 1;
            const isCurrentWhiteMove = currentPlyIndex === whitePlyIndex;
            const isCurrentBlackMove = currentPlyIndex === blackPlyIndex;
            const isCurrentRow = isCurrentWhiteMove || isCurrentBlackMove;
            const isFlashRow = flashPlyIndex === whitePlyIndex || flashPlyIndex === blackPlyIndex;

            return (
              <li
                key={row.number}
                className={[
                  "move-row",
                  isCurrentRow ? "current-row" : "",
                  isFlashRow ? "flash-row" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="move-number">{row.number}.</span>
                <span
                  ref={isCurrentWhiteMove ? currentMoveRef : null}
                  className={["move-san", isCurrentWhiteMove ? "current" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={buildMoveTitle(row.white)}
                >
                  {row.white.san}
                </span>
                <span
                  ref={isCurrentBlackMove ? currentMoveRef : null}
                  className={["move-san", isCurrentBlackMove ? "current" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={row.black ? buildMoveTitle(row.black) : "Black has not moved yet."}
                >
                  {row.black?.san ?? "..."}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="supporting-copy">No moves played yet. White has the first turn.</p>
      )}

      {inCheck ? (
        <p className="supporting-copy">
          {turnLabel} remains in check until a legal response is committed.
        </p>
      ) : null}

      {futureCount > 0 ? (
        <p className="supporting-copy">
          Redo buffer available: {futureCount} future {futureCount === 1 ? "move" : "moves"}.
        </p>
      ) : null}

      {historyIndex === 0 ? (
        <p className="supporting-copy">
          The timeline starts tracking as soon as the first move is committed.
        </p>
      ) : null}
    </section>
  );
}

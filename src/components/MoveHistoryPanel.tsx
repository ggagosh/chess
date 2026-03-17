import { useEffect, useRef } from "react";

import type { EngineMove } from "../chess-engine";

type MoveHistoryPanelProps = {
  moves: EngineMove[];
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

export function MoveHistoryPanel({ moves }: MoveHistoryPanelProps) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const moveRows = buildMoveRows(moves);
  const lastPlyIndex = moves.length - 1;

  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return;
    }

    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [moves.length]);

  return (
    <section className="info-card move-history-panel">
      <div className="move-log-header">
        <div>
          <p className="panel-label">Move History</p>
          <p className="panel-caption">Each legal move lands here as soon as it resolves.</p>
        </div>
        <span className="move-log-total">{moves.length} plies</span>
      </div>

      {moveRows.length > 0 ? (
        <ol ref={listRef} className="move-list">
          {moveRows.map((row, rowIndex) => {
            const whitePlyIndex = rowIndex * 2;
            const blackPlyIndex = whitePlyIndex + 1;

            return (
              <li key={row.number} className="move-row">
                <span className="move-number">{row.number}.</span>
                <span
                  className={["move-san", lastPlyIndex === whitePlyIndex ? "current" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={buildMoveTitle(row.white)}
                >
                  {row.white.san}
                </span>
                <span
                  className={["move-san", lastPlyIndex === blackPlyIndex ? "current" : ""]
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
    </section>
  );
}

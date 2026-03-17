import { useEffect, useRef } from "react";
import type { Square } from "chess.js";

import { PROMOTION_OPTIONS, type PlayerColor, type PromotionPiece } from "../chess-engine";

type PawnPromotionDialogProps = {
  color: PlayerColor;
  isOpen: boolean;
  onCancel: () => void;
  onChoose: (piece: PromotionPiece) => void;
  square: Square | null;
};

const PROMOTION_GLYPHS: Record<PlayerColor, Record<PromotionPiece, string>> = {
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

function titleCase(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

export function PawnPromotionDialog({
  color,
  isOpen,
  onCancel,
  onChoose,
  square,
}: PawnPromotionDialogProps) {
  const defaultOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    defaultOptionRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || !square) {
    return null;
  }

  return (
    <div className="dialog-scrim" role="presentation">
      <section
        aria-labelledby="promotion-dialog-title"
        aria-modal="true"
        className="dialog-card promotion-dialog"
        role="dialog"
      >
        <p className="dialog-kicker">Promotion</p>
        <h2 id="promotion-dialog-title">Choose the promotion piece</h2>
        <p className="dialog-copy">
          The pawn has reached <strong>{square}</strong>. Pick the piece before the move is
          finalized.
        </p>

        <div className="promotion-grid">
          {PROMOTION_OPTIONS.map((piece) => (
            <button
              key={piece}
              ref={piece === "queen" ? defaultOptionRef : null}
              type="button"
              className="promotion-option"
              onClick={() => onChoose(piece)}
            >
              <span className="promotion-glyph">{PROMOTION_GLYPHS[color][piece]}</span>
              <span>{titleCase(piece)}</span>
            </button>
          ))}
        </div>

        <div className="dialog-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Back to board
          </button>
        </div>
      </section>
    </div>
  );
}

import {
  Chess,
  DEFAULT_POSITION,
  type Color,
  type Move,
  type PieceSymbol,
  type Square,
} from "chess.js";

export type PlayerColor = "white" | "black";
export type BoardOrientation = PlayerColor;
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type PromotionPiece = Extract<PieceType, "queen" | "rook" | "bishop" | "knight">;
export type GamePhase = "active" | "check" | "checkmate" | "stalemate";

export type BoardPiece = {
  color: PlayerColor;
  glyph: string;
  label: string;
  type: PieceType;
};

export type BoardCell = {
  file: string;
  isLight: boolean;
  piece: BoardPiece | null;
  rank: number;
  square: Square;
};

export type EngineMove = {
  color: PlayerColor;
  from: Square;
  isCapture: boolean;
  isEnPassant: boolean;
  isKingsideCastle: boolean;
  isQueensideCastle: boolean;
  lan: string;
  piece: PieceType;
  promotion?: PromotionPiece;
  san: string;
  to: Square;
};

export type GameStatus = {
  detail: string;
  headline: string;
  inCheck: boolean;
  phase: GamePhase;
  turn: PlayerColor;
  winner: PlayerColor | null;
};

export type MoveInput = {
  from: Square;
  promotion?: PromotionPiece;
  to: Square;
};

export type CapturedPieces = {
  black: BoardPiece[];
  white: BoardPiece[];
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const PIECE_ORDER = ["queen", "rook", "bishop", "knight", "pawn"] as const;
const STARTING_COUNTS: Record<PieceType, number> = {
  bishop: 2,
  king: 1,
  knight: 2,
  pawn: 8,
  queen: 1,
  rook: 2,
};
const COLOR_NAMES: Record<Color, PlayerColor> = {
  b: "black",
  w: "white",
};
const PIECE_NAMES: Record<PieceSymbol, PieceType> = {
  b: "bishop",
  k: "king",
  n: "knight",
  p: "pawn",
  q: "queen",
  r: "rook",
};
const PIECE_SYMBOLS: Record<PlayerColor, Record<PieceType, string>> = {
  black: {
    bishop: "♝",
    king: "♚",
    knight: "♞",
    pawn: "♟",
    queen: "♛",
    rook: "♜",
  },
  white: {
    bishop: "♗",
    king: "♔",
    knight: "♘",
    pawn: "♙",
    queen: "♕",
    rook: "♖",
  },
};
const PROMOTION_SYMBOLS: Record<PromotionPiece, PieceSymbol> = {
  bishop: "b",
  knight: "n",
  queen: "q",
  rook: "r",
};

function colorName(color: Color): PlayerColor {
  return COLOR_NAMES[color];
}

function pieceName(piece: PieceSymbol): PieceType {
  return PIECE_NAMES[piece];
}

function toTitleCase(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function makePiece(color: PlayerColor, type: PieceType): BoardPiece {
  return {
    color,
    glyph: PIECE_SYMBOLS[color][type],
    label: `${color} ${type}`,
    type,
  };
}

function normalizeMove(move: Move): EngineMove {
  return {
    color: colorName(move.color),
    from: move.from,
    isCapture: move.isCapture(),
    isEnPassant: move.isEnPassant(),
    isKingsideCastle: move.isKingsideCastle(),
    isQueensideCastle: move.isQueensideCastle(),
    lan: move.lan,
    piece: pieceName(move.piece),
    promotion: move.promotion ? (pieceName(move.promotion) as PromotionPiece) : undefined,
    san: move.san,
    to: move.to,
  };
}

export const STARTING_FEN = DEFAULT_POSITION;
export const PROMOTION_OPTIONS: readonly PromotionPiece[] = ["queen", "rook", "bishop", "knight"];

export function createGame(fen = STARTING_FEN): Chess {
  return new Chess(fen);
}

export function getBoardCells(game: Chess, orientation: BoardOrientation = "white"): BoardCell[] {
  const cells = game.board().flatMap((rankRow, rankIndex) =>
    rankRow.map((piece, fileIndex) => {
      const rank = 8 - rankIndex;
      const file = FILES[fileIndex];
      const square = `${file}${rank}` as Square;

      return {
        file,
        isLight: game.squareColor(square) === "light",
        piece: piece ? makePiece(colorName(piece.color), pieceName(piece.type)) : null,
        rank,
        square,
      };
    }),
  );

  return orientation === "white" ? cells : [...cells].reverse();
}

export function getLegalMoves(game: Chess, square: Square): EngineMove[] {
  return game.moves({ square, verbose: true }).map(normalizeMove);
}

export function getAllLegalMoves(game: Chess): EngineMove[] {
  return game.moves({ verbose: true }).map(normalizeMove);
}

export function getMoveTargets(moves: EngineMove[]): Map<Square, EngineMove[]> {
  const targets = new Map<Square, EngineMove[]>();

  for (const move of moves) {
    const current = targets.get(move.to);

    if (current) {
      current.push(move);
      continue;
    }

    targets.set(move.to, [move]);
  }

  return targets;
}

export function applyMove(game: Chess, move: MoveInput): EngineMove {
  const executed = game.move({
    from: move.from,
    promotion: move.promotion ? PROMOTION_SYMBOLS[move.promotion] : undefined,
    to: move.to,
  });

  return normalizeMove(executed);
}

export function getCapturedPieces(game: Chess): CapturedPieces {
  const currentCounts: Record<PlayerColor, Record<PieceType, number>> = {
    black: {
      bishop: 0,
      king: 0,
      knight: 0,
      pawn: 0,
      queen: 0,
      rook: 0,
    },
    white: {
      bishop: 0,
      king: 0,
      knight: 0,
      pawn: 0,
      queen: 0,
      rook: 0,
    },
  };

  for (const cell of getBoardCells(game)) {
    if (!cell.piece) {
      continue;
    }

    currentCounts[cell.piece.color][cell.piece.type] += 1;
  }

  const captured: CapturedPieces = {
    black: [],
    white: [],
  };

  for (const color of ["white", "black"] as const) {
    for (const type of PIECE_ORDER) {
      const missing = STARTING_COUNTS[type] - currentCounts[color][type];

      for (let index = 0; index < missing; index += 1) {
        captured[color].push(makePiece(color, type));
      }
    }
  }

  return captured;
}

export function getGameStatus(game: Chess): GameStatus {
  const turn = colorName(game.turn());
  const inCheck = game.isCheck();

  if (game.isCheckmate()) {
    const winner = turn === "white" ? "black" : "white";

    return {
      detail: `${toTitleCase(turn)} has no legal moves and the king is trapped.`,
      headline: `${toTitleCase(winner)} wins by checkmate`,
      inCheck,
      phase: "checkmate",
      turn,
      winner,
    };
  }

  if (game.isStalemate()) {
    return {
      detail: `${toTitleCase(turn)} has no legal moves, but the king is not in check.`,
      headline: "Draw by stalemate",
      inCheck,
      phase: "stalemate",
      turn,
      winner: null,
    };
  }

  if (inCheck) {
    return {
      detail: `${toTitleCase(turn)} is in check. Choose a legal response.`,
      headline: `${toTitleCase(turn)} to move`,
      inCheck,
      phase: "check",
      turn,
      winner: null,
    };
  }

  return {
    detail: "Select a piece to reveal every legal move, including special rules when available.",
    headline: `${toTitleCase(turn)} to move`,
    inCheck,
    phase: "active",
    turn,
    winner: null,
  };
}

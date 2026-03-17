export const BOARD_SIZE = 8;

export type PieceColor = "white" | "black";
export type PieceKind = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";

export interface Piece {
  color: PieceColor;
  kind: PieceKind;
}

export interface Move {
  from: number;
  to: number;
}

export interface GameSnapshot {
  board: Array<Piece | null>;
  turn: PieceColor;
  label: string;
}

const BACK_RANK: PieceKind[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

const KNIGHT_OFFSETS = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
] as const;

const KING_OFFSETS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const;

const BISHOP_DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const ROOK_DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

export function createInitialSnapshot(): GameSnapshot {
  const board = createEmptyBoard();

  for (let file = 0; file < BOARD_SIZE; file += 1) {
    placePiece(board, 0, file, { color: "black", kind: BACK_RANK[file] });
    placePiece(board, 1, file, { color: "black", kind: "pawn" });
    placePiece(board, 6, file, { color: "white", kind: "pawn" });
    placePiece(board, 7, file, { color: "white", kind: BACK_RANK[file] });
  }

  return {
    board,
    turn: "white",
    label: "Starting position",
  };
}

export function createCheckDemoSnapshot(): GameSnapshot {
  const board = createEmptyBoard();

  placePiece(board, 0, 4, { color: "black", kind: "king" });
  placePiece(board, 0, 0, { color: "black", kind: "rook" });
  placePiece(board, 5, 4, { color: "white", kind: "rook" });
  placePiece(board, 7, 6, { color: "white", kind: "king" });

  return {
    board,
    turn: "black",
    label: "Check demo",
  };
}

export function indexToSquare(index: number) {
  const row = Math.floor(index / BOARD_SIZE);
  const column = index % BOARD_SIZE;

  return `${FILES[column]}${BOARD_SIZE - row}`;
}

export function getPieceLabel(piece: Piece) {
  return `${piece.color} ${piece.kind}`;
}

export function getLegalMoves(board: Array<Piece | null>, from: number) {
  const piece = board[from];

  if (!piece) {
    return [];
  }

  return getPseudoTargets(board, from, false).filter((target) => {
    const nextBoard = applyMove(board, { from, to: target });

    return !isKingInCheck(nextBoard, piece.color);
  });
}

export function applyMove(board: Array<Piece | null>, move: Move) {
  const piece = board[move.from];

  if (!piece) {
    return board;
  }

  const nextBoard = [...board];
  nextBoard[move.from] = null;

  const destinationRow = Math.floor(move.to / BOARD_SIZE);
  const shouldPromote =
    piece.kind === "pawn" &&
    ((piece.color === "white" && destinationRow === 0) ||
      (piece.color === "black" && destinationRow === BOARD_SIZE - 1));

  nextBoard[move.to] = shouldPromote ? { ...piece, kind: "queen" } : piece;

  return nextBoard;
}

export function isKingInCheck(board: Array<Piece | null>, color: PieceColor) {
  const kingIndex = board.findIndex((piece) => piece?.color === color && piece.kind === "king");

  if (kingIndex === -1) {
    return false;
  }

  return isSquareAttacked(board, kingIndex, oppositeColor(color));
}

export function countLegalMoves(board: Array<Piece | null>, color: PieceColor) {
  let total = 0;

  for (let index = 0; index < board.length; index += 1) {
    const piece = board[index];

    if (piece?.color !== color) {
      continue;
    }

    total += getLegalMoves(board, index).length;
  }

  return total;
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE * BOARD_SIZE }, () => null) as Array<Piece | null>;
}

function placePiece(board: Array<Piece | null>, row: number, column: number, piece: Piece) {
  board[row * BOARD_SIZE + column] = piece;
}

function getPseudoTargets(
  board: Array<Piece | null>,
  from: number,
  attacksOnly: boolean,
): number[] {
  const piece = board[from];

  if (!piece) {
    return [];
  }

  const row = Math.floor(from / BOARD_SIZE);
  const column = from % BOARD_SIZE;

  switch (piece.kind) {
    case "pawn":
      return getPawnTargets(board, row, column, piece.color, attacksOnly);
    case "knight":
      return KNIGHT_OFFSETS.flatMap(([rowOffset, columnOffset]) => {
        const target = toIndex(row + rowOffset, column + columnOffset);
        return target !== null && canOccupy(board, target, piece.color) ? [target] : [];
      });
    case "bishop":
      return collectSlidingTargets(board, row, column, piece.color, BISHOP_DIRECTIONS);
    case "rook":
      return collectSlidingTargets(board, row, column, piece.color, ROOK_DIRECTIONS);
    case "queen":
      return collectSlidingTargets(board, row, column, piece.color, [
        ...BISHOP_DIRECTIONS,
        ...ROOK_DIRECTIONS,
      ]);
    case "king":
      return KING_OFFSETS.flatMap(([rowOffset, columnOffset]) => {
        const target = toIndex(row + rowOffset, column + columnOffset);
        return target !== null && canOccupy(board, target, piece.color) ? [target] : [];
      });
    default:
      return [];
  }
}

function getPawnTargets(
  board: Array<Piece | null>,
  row: number,
  column: number,
  color: PieceColor,
  attacksOnly: boolean,
): number[] {
  const direction = color === "white" ? -1 : 1;
  const startRow = color === "white" ? BOARD_SIZE - 2 : 1;
  const nextRow = row + direction;
  const targets: number[] = [];

  for (const captureColumn of [column - 1, column + 1]) {
    const captureIndex = toIndex(nextRow, captureColumn);

    if (captureIndex === null) {
      continue;
    }

    if (attacksOnly) {
      targets.push(captureIndex);
      continue;
    }

    const occupant = board[captureIndex];
    if (occupant && occupant.color !== color) {
      targets.push(captureIndex);
    }
  }

  if (attacksOnly) {
    return targets;
  }

  const oneStep = toIndex(nextRow, column);
  if (oneStep === null || board[oneStep]) {
    return targets;
  }

  targets.push(oneStep);

  if (row !== startRow) {
    return targets;
  }

  const twoStep = toIndex(row + direction * 2, column);
  if (twoStep !== null && !board[twoStep]) {
    targets.push(twoStep);
  }

  return targets;
}

function collectSlidingTargets(
  board: Array<Piece | null>,
  row: number,
  column: number,
  color: PieceColor,
  directions: ReadonlyArray<readonly [number, number]>,
): number[] {
  const targets: number[] = [];

  for (const [rowOffset, columnOffset] of directions) {
    let nextRow = row + rowOffset;
    let nextColumn = column + columnOffset;

    while (true) {
      const target = toIndex(nextRow, nextColumn);

      if (target === null) {
        break;
      }

      const occupant = board[target];
      if (!occupant) {
        targets.push(target);
      } else {
        if (occupant.color !== color) {
          targets.push(target);
        }
        break;
      }

      nextRow += rowOffset;
      nextColumn += columnOffset;
    }
  }

  return targets;
}

function canOccupy(board: Array<Piece | null>, target: number, color: PieceColor) {
  return !board[target] || board[target]?.color !== color;
}

function toIndex(row: number, column: number) {
  if (row < 0 || row >= BOARD_SIZE || column < 0 || column >= BOARD_SIZE) {
    return null;
  }

  return row * BOARD_SIZE + column;
}

function isSquareAttacked(board: Array<Piece | null>, target: number, byColor: PieceColor) {
  for (let index = 0; index < board.length; index += 1) {
    const piece = board[index];

    if (piece?.color !== byColor) {
      continue;
    }

    const attacks =
      piece.kind === "pawn"
        ? getPseudoTargets(board, index, true)
        : getPseudoTargets(board, index, false);

    if (attacks.includes(target)) {
      return true;
    }
  }

  return false;
}

function oppositeColor(color: PieceColor): PieceColor {
  return color === "white" ? "black" : "white";
}

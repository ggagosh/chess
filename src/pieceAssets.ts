import blackBishop from "./assets/pieces/black-bishop.svg";
import blackKing from "./assets/pieces/black-king.svg";
import blackKnight from "./assets/pieces/black-knight.svg";
import blackPawn from "./assets/pieces/black-pawn.svg";
import blackQueen from "./assets/pieces/black-queen.svg";
import blackRook from "./assets/pieces/black-rook.svg";
import whiteBishop from "./assets/pieces/white-bishop.svg";
import whiteKing from "./assets/pieces/white-king.svg";
import whiteKnight from "./assets/pieces/white-knight.svg";
import whitePawn from "./assets/pieces/white-pawn.svg";
import whiteQueen from "./assets/pieces/white-queen.svg";
import whiteRook from "./assets/pieces/white-rook.svg";
import type { Piece } from "./chess";

const pieceAssets = {
  white: {
    bishop: whiteBishop,
    king: whiteKing,
    knight: whiteKnight,
    pawn: whitePawn,
    queen: whiteQueen,
    rook: whiteRook,
  },
  black: {
    bishop: blackBishop,
    king: blackKing,
    knight: blackKnight,
    pawn: blackPawn,
    queen: blackQueen,
    rook: blackRook,
  },
} as const;

export function getPieceAsset(piece: Piece) {
  return pieceAssets[piece.color][piece.kind];
}

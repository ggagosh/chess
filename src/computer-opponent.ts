import type { Chess, Square } from "chess.js";

import { applyMove, createGame, type MoveInput, type PromotionPiece } from "./chess-engine";

export type OpponentMode = "human" | "random" | "stockfish";
export type ComputerMoveSource = Exclude<OpponentMode, "human">;
export type StockfishMoveResolver = (fen: string) => Promise<MoveInput>;

export type OpponentModeOption = {
  description: string;
  label: string;
  value: OpponentMode;
};

export type ComputerMoveResult = {
  fallbackReason?: string;
  move: MoveInput;
  source: ComputerMoveSource;
};

export const DEFAULT_OPPONENT_MODE: OpponentMode = "human";

export const OPPONENT_MODE_OPTIONS: readonly OpponentModeOption[] = [
  {
    description: "Two human players take alternating turns on the same board.",
    label: "Two players",
    value: "human",
  },
  {
    description: "Black responds with a random legal move after each white turn.",
    label: "Random AI",
    value: "random",
  },
  {
    description:
      "Black tries Stockfish first and falls back to random play if the engine is unavailable.",
    label: "Stockfish",
    value: "stockfish",
  },
];

const PROMOTION_BY_UCI: Record<string, PromotionPiece> = {
  b: "bishop",
  n: "knight",
  q: "queen",
  r: "rook",
};

function isPromotionPiece(value: string): value is keyof typeof PROMOTION_BY_UCI {
  return value in PROMOTION_BY_UCI;
}

export function isOpponentMode(value: unknown): value is OpponentMode {
  return value === "human" || value === "random" || value === "stockfish";
}

export function isComputerOpponentMode(
  value: OpponentMode,
): value is Exclude<OpponentMode, "human"> {
  return value !== "human";
}

export function getOpponentModeLabel(mode: OpponentMode): string {
  return OPPONENT_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? "Two players";
}

export function pickRandomMove(game: Chess, random: () => number = Math.random): MoveInput | null {
  const moves = game.moves({ verbose: true });

  if (moves.length === 0) {
    return null;
  }

  const index = Math.floor(random() * moves.length);
  const selected = moves[index];

  return {
    from: selected.from,
    promotion: selected.promotion
      ? PROMOTION_BY_UCI[selected.promotion as keyof typeof PROMOTION_BY_UCI]
      : undefined,
    to: selected.to,
  };
}

export function parseUciMove(move: string): MoveInput {
  const normalized = move.trim().toLowerCase();
  const match = /^([a-h][1-8])([a-h][1-8])([bnqr])?$/.exec(normalized);

  if (!match) {
    throw new Error(`Unsupported UCI move: ${move}`);
  }

  const [, from, to, promotion] = match;

  return {
    from: from as Square,
    promotion: promotion && isPromotionPiece(promotion) ? PROMOTION_BY_UCI[promotion] : undefined,
    to: to as Square,
  };
}

function ensureLegalMove(fen: string, move: MoveInput): MoveInput {
  const validationGame = createGame(fen);

  applyMove(validationGame, move);

  return move;
}

export async function resolveComputerMove({
  fen,
  getStockfishMove,
  mode,
  random = Math.random,
}: {
  fen: string;
  getStockfishMove: StockfishMoveResolver;
  mode: Exclude<OpponentMode, "human">;
  random?: () => number;
}): Promise<ComputerMoveResult> {
  const game = createGame(fen);
  const fallbackMove = pickRandomMove(game, random);

  if (!fallbackMove) {
    throw new Error("No legal computer move is available for the current position.");
  }

  if (mode === "random") {
    return {
      move: fallbackMove,
      source: "random",
    };
  }

  try {
    const stockfishMove = await getStockfishMove(fen);

    return {
      move: ensureLegalMove(fen, stockfishMove),
      source: "stockfish",
    };
  } catch {
    return {
      fallbackReason: "Stockfish was unavailable, so the turn fell back to a random legal move.",
      move: fallbackMove,
      source: "random",
    };
  }
}

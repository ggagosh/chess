import type { Chess } from "chess.js";

import {
  STARTING_FEN,
  applyMove,
  createGame,
  getAllLegalMoves,
  getCapturedPieces,
  getGameStatus,
  type CapturedPieces,
  type EngineMove,
  type GameStatus,
  type MoveInput,
} from "./chess-engine";

export type GameTimelineState = {
  cursor: number;
  moves: MoveInput[];
};

export type GameTimelineAction =
  | {
      move: MoveInput;
      type: "commit";
    }
  | {
      type: "undo";
    }
  | {
      type: "redo";
    }
  | {
      type: "reset";
    };

export type GameTimelineSnapshot = {
  canRedo: boolean;
  canUndo: boolean;
  capturedPieces: CapturedPieces;
  fen: string;
  futureCount: number;
  game: Chess;
  historyIndex: number;
  legalMoveCount: number;
  moveLog: EngineMove[];
  pgn: string;
  status: GameStatus;
  totalMoves: number;
};

export const INITIAL_GAME_TIMELINE_STATE: GameTimelineState = {
  cursor: 0,
  moves: [],
};

function createInitialGameTimelineState(): GameTimelineState {
  return {
    cursor: 0,
    moves: [],
  };
}

function clampHistoryIndex(cursor: number, totalMoves: number) {
  return Math.min(Math.max(cursor, 0), totalMoves);
}

function formatPgn(moveLog: EngineMove[]) {
  const tokens: string[] = [];

  for (let index = 0; index < moveLog.length; index += 2) {
    const moveNumber = Math.floor(index / 2) + 1;
    const white = moveLog[index];
    const black = moveLog[index + 1];

    tokens.push(`${moveNumber}. ${white.san}`);

    if (black) {
      tokens.push(black.san);
    }
  }

  return tokens.join(" ");
}

export function gameTimelineReducer(
  state: GameTimelineState,
  action: GameTimelineAction,
): GameTimelineState {
  switch (action.type) {
    case "commit": {
      const historyIndex = clampHistoryIndex(state.cursor, state.moves.length);
      const moves = [...state.moves.slice(0, historyIndex), action.move];

      return {
        cursor: moves.length,
        moves,
      };
    }

    case "undo": {
      const historyIndex = clampHistoryIndex(state.cursor, state.moves.length);

      return {
        ...state,
        cursor: Math.max(historyIndex - 1, 0),
      };
    }

    case "redo": {
      const historyIndex = clampHistoryIndex(state.cursor, state.moves.length);

      return {
        ...state,
        cursor: Math.min(historyIndex + 1, state.moves.length),
      };
    }

    case "reset":
      return createInitialGameTimelineState();
  }
}

export function buildGameTimelineSnapshot(state: GameTimelineState): GameTimelineSnapshot {
  const historyIndex = clampHistoryIndex(state.cursor, state.moves.length);
  const activeMoves = state.moves.slice(0, historyIndex);
  const game = createGame();
  const moveLog: EngineMove[] = [];

  for (const move of activeMoves) {
    moveLog.push(applyMove(game, move));
  }

  return {
    canRedo: historyIndex < state.moves.length,
    canUndo: historyIndex > 0,
    capturedPieces: getCapturedPieces(game),
    fen: historyIndex === 0 ? STARTING_FEN : game.fen(),
    futureCount: state.moves.length - historyIndex,
    game,
    historyIndex,
    legalMoveCount: getAllLegalMoves(game).length,
    moveLog,
    pgn: formatPgn(moveLog),
    status: getGameStatus(game),
    totalMoves: state.moves.length,
  };
}

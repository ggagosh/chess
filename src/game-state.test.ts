import { describe, expect, it } from "vitest";

import { STARTING_FEN, type MoveInput } from "./chess-engine";
import {
  INITIAL_GAME_TIMELINE_STATE,
  buildGameTimelineSnapshot,
  gameTimelineReducer,
} from "./game-state";

const CAPTURE_SEQUENCE: MoveInput[] = [
  { from: "e2", to: "e4" },
  { from: "d7", to: "d5" },
  { from: "e4", to: "d5" },
];

function commitSequence(moves: MoveInput[]) {
  return moves.reduce(
    (state, move) => gameTimelineReducer(state, { move, type: "commit" }),
    INITIAL_GAME_TIMELINE_STATE,
  );
}

describe("game-state", () => {
  it("derives PGN, move history, captures, and turn from committed moves", () => {
    const snapshot = buildGameTimelineSnapshot(commitSequence(CAPTURE_SEQUENCE));

    expect(snapshot.historyIndex).toBe(3);
    expect(snapshot.totalMoves).toBe(3);
    expect(snapshot.canUndo).toBe(true);
    expect(snapshot.canRedo).toBe(false);
    expect(snapshot.moveLog.map((move) => move.san)).toEqual(["e4", "d5", "exd5"]);
    expect(snapshot.pgn).toBe("1. e4 d5 2. exd5");
    expect(snapshot.capturedPieces.black).toHaveLength(1);
    expect(snapshot.capturedPieces.black[0]).toMatchObject({
      color: "black",
      type: "pawn",
    });
    expect(snapshot.game.get("d5")).toMatchObject({ color: "w", type: "p" });
    expect(snapshot.status.turn).toBe("black");
  });

  it("keeps board state, captures, and PGN consistent across undo and redo", () => {
    const committed = commitSequence(CAPTURE_SEQUENCE);
    const undone = gameTimelineReducer(committed, { type: "undo" });
    const undoSnapshot = buildGameTimelineSnapshot(undone);

    expect(undoSnapshot.historyIndex).toBe(2);
    expect(undoSnapshot.futureCount).toBe(1);
    expect(undoSnapshot.canUndo).toBe(true);
    expect(undoSnapshot.canRedo).toBe(true);
    expect(undoSnapshot.moveLog.map((move) => move.san)).toEqual(["e4", "d5"]);
    expect(undoSnapshot.pgn).toBe("1. e4 d5");
    expect(undoSnapshot.capturedPieces.black).toHaveLength(0);
    expect(undoSnapshot.game.get("d5")).toMatchObject({ color: "b", type: "p" });
    expect(undoSnapshot.status.turn).toBe("white");

    const redone = gameTimelineReducer(undone, { type: "redo" });
    const redoSnapshot = buildGameTimelineSnapshot(redone);

    expect(redoSnapshot.historyIndex).toBe(3);
    expect(redoSnapshot.futureCount).toBe(0);
    expect(redoSnapshot.moveLog.map((move) => move.san)).toEqual(["e4", "d5", "exd5"]);
    expect(redoSnapshot.pgn).toBe("1. e4 d5 2. exd5");
    expect(redoSnapshot.capturedPieces.black).toHaveLength(1);
    expect(redoSnapshot.game.get("d5")).toMatchObject({ color: "w", type: "p" });
  });

  it("drops future moves when a new move is committed from an undone position", () => {
    const committed = commitSequence(CAPTURE_SEQUENCE);
    const undone = gameTimelineReducer(committed, { type: "undo" });
    const branched = gameTimelineReducer(undone, {
      move: { from: "g1", to: "f3" },
      type: "commit",
    });
    const snapshot = buildGameTimelineSnapshot(branched);

    expect(snapshot.historyIndex).toBe(3);
    expect(snapshot.totalMoves).toBe(3);
    expect(snapshot.futureCount).toBe(0);
    expect(snapshot.canRedo).toBe(false);
    expect(snapshot.moveLog.map((move) => move.san)).toEqual(["e4", "d5", "Nf3"]);
    expect(snapshot.pgn).toBe("1. e4 d5 2. Nf3");
    expect(snapshot.game.get("f3")).toMatchObject({ color: "w", type: "n" });
    expect(snapshot.game.get("d5")).toMatchObject({ color: "b", type: "p" });
  });

  it("resets back to the starting timeline", () => {
    const state = gameTimelineReducer(commitSequence(CAPTURE_SEQUENCE), { type: "reset" });
    const snapshot = buildGameTimelineSnapshot(state);

    expect(snapshot.historyIndex).toBe(0);
    expect(snapshot.totalMoves).toBe(0);
    expect(snapshot.futureCount).toBe(0);
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.canRedo).toBe(false);
    expect(snapshot.fen).toBe(STARTING_FEN);
    expect(snapshot.pgn).toBe("");
    expect(snapshot.moveLog).toEqual([]);
    expect(snapshot.legalMoveCount).toBe(20);
    expect(snapshot.status.turn).toBe("white");
  });
});

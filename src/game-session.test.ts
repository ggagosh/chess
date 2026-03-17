import { describe, expect, it } from "vitest";

import { applyMove, createGame, type MoveInput } from "./chess-engine";
import {
  GAME_SESSION_STORAGE_KEY,
  createFreshSession,
  loadGameSession,
  persistGameSession,
} from "./game-session";

function createMemoryStorage(seed?: Record<string, string>) {
  const values = new Map(Object.entries(seed ?? {}));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function buildMoves(history: MoveInput[]) {
  const game = createGame();
  const moveLog = history.map((move) => applyMove(game, move));

  return {
    fen: game.fen(),
    moveLog,
  };
}

describe("game-session", () => {
  it("returns a fresh session when storage is empty", () => {
    expect(loadGameSession(createMemoryStorage())).toEqual(createFreshSession());
  });

  it("persists and restores move history, orientation, and sound preference", () => {
    const history: MoveInput[] = [
      { from: "e2", to: "e4" },
      { from: "e7", to: "e5" },
      { from: "g1", to: "f3" },
    ];
    const { fen, moveLog } = buildMoves(history);
    const storage = createMemoryStorage();

    persistGameSession(
      {
        fen,
        history,
        moveLog,
        orientation: "black",
        soundEnabled: false,
      },
      storage,
    );

    expect(loadGameSession(storage)).toMatchObject({
      fen,
      history,
      moveLog,
      orientation: "black",
      soundEnabled: false,
    });
  });

  it("falls back to a fresh session when persisted data is inconsistent", () => {
    const storage = createMemoryStorage({
      [GAME_SESSION_STORAGE_KEY]: JSON.stringify({
        fen: "invalid fen",
        history: [{ from: "e2", to: "e4" }],
        orientation: "white",
        soundEnabled: true,
        version: 1,
      }),
    });

    expect(loadGameSession(storage)).toEqual(createFreshSession());
  });
});

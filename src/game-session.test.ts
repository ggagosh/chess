import { describe, expect, it } from "vitest";

import type { MoveInput } from "./chess-engine";
import {
  GAME_SESSION_STORAGE_KEY,
  createFreshSession,
  loadGameSession,
  persistGameSession,
} from "./game-session";
import { buildGameTimelineSnapshot } from "./game-state";

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

describe("game-session", () => {
  it("returns a fresh session when storage is empty", () => {
    expect(loadGameSession(createMemoryStorage())).toEqual(createFreshSession());
  });

  it("persists and restores the active timeline, orientation, and sound preference", () => {
    const moves: MoveInput[] = [
      { from: "e2", to: "e4" },
      { from: "e7", to: "e5" },
      { from: "g1", to: "f3" },
    ];
    const storage = createMemoryStorage();
    const session = {
      orientation: "black" as const,
      soundEnabled: false,
      timeline: {
        cursor: 2,
        moves,
      },
    };

    persistGameSession(session, storage);

    const restored = loadGameSession(storage);
    const snapshot = buildGameTimelineSnapshot(restored.timeline);

    expect(restored).toEqual(session);
    expect(snapshot.moveLog.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(snapshot.futureCount).toBe(1);
  });

  it("loads legacy persisted history data from the first session format", () => {
    const history: MoveInput[] = [
      { from: "e2", to: "e4" },
      { from: "e7", to: "e5" },
      { from: "g1", to: "f3" },
    ];
    const active = buildGameTimelineSnapshot({
      cursor: history.length,
      moves: history,
    });
    const storage = createMemoryStorage({
      [GAME_SESSION_STORAGE_KEY]: JSON.stringify({
        fen: active.fen,
        history,
        orientation: "black",
        soundEnabled: true,
        version: 1,
      }),
    });

    expect(loadGameSession(storage)).toEqual({
      orientation: "black",
      soundEnabled: true,
      timeline: {
        cursor: history.length,
        moves: history,
      },
    });
  });

  it("falls back to a fresh session when persisted data is inconsistent", () => {
    const storage = createMemoryStorage({
      [GAME_SESSION_STORAGE_KEY]: JSON.stringify({
        activeFen: "invalid fen",
        cursor: 1,
        moves: [{ from: "e2", to: "e4" }],
        orientation: "white",
        soundEnabled: true,
        version: 2,
      }),
    });

    expect(loadGameSession(storage)).toEqual(createFreshSession());
  });
});

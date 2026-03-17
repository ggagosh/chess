import { describe, expect, it } from "vitest";

import {
  APP_SESSION_STORAGE_KEY,
  createGameSessionFromSettings,
  loadAppSession,
  persistAppSession,
} from "./app-session";
import { GAME_SESSION_STORAGE_KEY, loadGameSession, persistGameSession } from "./game-session";
import type { GameSettings } from "./game-setup";
import { buildGameTimelineSnapshot, gameTimelineReducer } from "./game-state";

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

describe("app-session", () => {
  it("returns the default start screen state when storage is empty", () => {
    const restored = loadAppSession(createMemoryStorage());

    expect(restored.screen).toBe("start");
    expect(restored.playerColor).toBe("white");
    expect(restored.settings).toEqual({
      colorPreference: "white",
      opponentMode: "human",
      timeControlMinutes: 10,
    });
    expect(restored.gameSession.clockState).toEqual({
      black: 600_000,
      white: 600_000,
    });
  });

  it("creates a fresh game session from the selected setup", () => {
    const settings: GameSettings = {
      colorPreference: "black",
      opponentMode: "stockfish",
      timeControlMinutes: 5,
    };

    const created = createGameSessionFromSettings(settings, {
      soundEnabled: false,
    });

    expect(created.playerColor).toBe("black");
    expect(created.session).toEqual({
      clockState: {
        black: 300_000,
        white: 300_000,
      },
      opponentMode: "stockfish",
      orientation: "black",
      soundEnabled: false,
      timeline: {
        cursor: 0,
        moves: [],
      },
    });
  });

  it("persists and restores the screen, settings, player color, and active game session", () => {
    const storage = createMemoryStorage();
    const created = createGameSessionFromSettings(
      {
        colorPreference: "random",
        opponentMode: "random",
        timeControlMinutes: 15,
      },
      {
        playerColor: "black",
      },
    );
    const advancedSession = {
      ...created.session,
      clockState: {
        black: 875_000,
        white: 822_000,
      },
      timeline: gameTimelineReducer(created.session.timeline, {
        move: { from: "e2", to: "e4" },
        type: "commit",
      }),
    };

    persistAppSession(
      {
        gameSession: advancedSession,
        playerColor: created.playerColor,
        screen: "game",
        settings: {
          colorPreference: "random",
          opponentMode: "random",
          timeControlMinutes: 15,
        },
      },
      storage,
    );

    const restored = loadAppSession(storage);
    const snapshot = buildGameTimelineSnapshot(restored.gameSession.timeline);

    expect(restored).toEqual({
      gameSession: advancedSession,
      playerColor: "black",
      screen: "game",
      settings: {
        colorPreference: "random",
        opponentMode: "random",
        timeControlMinutes: 15,
      },
    });
    expect(JSON.parse(storage.getItem(APP_SESSION_STORAGE_KEY) ?? "")).toEqual({
      playerColor: "black",
      screen: "game",
      settings: {
        colorPreference: "random",
        opponentMode: "random",
        timeControlMinutes: 15,
      },
      version: 1,
    });
    expect(loadGameSession(storage)).toEqual(advancedSession);
    expect(snapshot.moveLog.map((move) => move.san)).toEqual(["e4"]);
  });

  it("upgrades legacy game-session-only storage into the game screen flow", () => {
    const storage = createMemoryStorage();
    const legacySession = createGameSessionFromSettings(
      {
        colorPreference: "white",
        opponentMode: "stockfish",
        timeControlMinutes: 10,
      },
      {
        playerColor: "white",
      },
    ).session;

    persistGameSession(
      {
        ...legacySession,
        clockState: {
          black: 410_000,
          white: 430_000,
        },
      },
      storage,
    );

    const restored = loadAppSession(storage);

    expect(storage.getItem(APP_SESSION_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(GAME_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(restored).toEqual({
      gameSession: {
        ...legacySession,
        clockState: {
          black: 410_000,
          white: 430_000,
        },
      },
      playerColor: "white",
      screen: "game",
      settings: {
        colorPreference: "white",
        opponentMode: "stockfish",
        timeControlMinutes: 10,
      },
    });
  });
});

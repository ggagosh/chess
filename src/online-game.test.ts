import { describe, expect, it } from "vitest";

import {
  ONLINE_STALE_GAME_TIMEOUT_MS,
  ONLINE_PLAYER_STORAGE_KEY,
  ONLINE_SESSION_STORAGE_KEY,
  buildOnlineGameSession,
  canJoinOnlineGame,
  createOnlineGamePayload,
  createSessionCode,
  getOnlineGameUpdatedAt,
  getOnlinePlayerAlias,
  isOnlineOpponentConnected,
  isStaleOnlineGame,
  loadOnlineSession,
  loadOrCreateOnlinePlayerId,
  normalizeSessionCode,
  persistOnlineSession,
  resolveOnlinePlayerColor,
  selectOnlineGameByCode,
  type OnlineGameRecord,
} from "./online-game";
import { buildGameTimelineSnapshot } from "./game-state";

function createMemoryStorage(seed?: Record<string, string>) {
  const values = new Map(Object.entries(seed ?? {}));

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createGame(overrides: Partial<OnlineGameRecord> = {}): OnlineGameRecord {
  return {
    blackPlayerId: null,
    blackTimeRemaining: 300_000,
    code: "KNIGHT-4829",
    createdAt: 10,
    id: "game-1",
    moves: [],
    result: null,
    status: "waiting",
    timeControl: 300,
    updatedAt: 10,
    whitePlayerId: "white-player",
    whiteTimeRemaining: 300_000,
    ...overrides,
  };
}

describe("online-game", () => {
  it("normalizes session codes into the shareable lookup format", () => {
    expect(normalizeSessionCode("  knight 4829 ")).toBe("KNIGHT-4829");
    expect(normalizeSessionCode("rook__7788")).toBe("ROOK-7788");
  });

  it("creates a short human-friendly session code", () => {
    expect(createSessionCode(() => 0)).toBe("BISHOP-1000");
  });

  it("derives a stable funny alias from the player id", () => {
    expect(getOnlinePlayerAlias("player-1")).toBe(getOnlinePlayerAlias("player-1"));
    expect(getOnlinePlayerAlias("player-1")).not.toBe(getOnlinePlayerAlias("player-2"));
  });

  it("creates and persists a stable anonymous player id", () => {
    const storage = createMemoryStorage();
    const first = loadOrCreateOnlinePlayerId(storage);
    const second = loadOrCreateOnlinePlayerId(storage);

    expect(first).toBe(second);
    expect(storage.getItem(ONLINE_PLAYER_STORAGE_KEY)).toBe(first);
  });

  it("persists and clears the current online session reference", () => {
    const storage = createMemoryStorage();

    persistOnlineSession(
      {
        gameCode: "KNIGHT-4829",
        playerId: "player-1",
      },
      storage,
    );

    expect(loadOnlineSession(storage)).toEqual({
      gameCode: "KNIGHT-4829",
      playerId: "player-1",
    });

    persistOnlineSession(null, storage);

    expect(loadOnlineSession(storage)).toBeNull();
    expect(storage.getItem(ONLINE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("selects the newest matching game for a share code", () => {
    const selected = selectOnlineGameByCode(
      [
        createGame({ createdAt: 1, id: "older" }),
        createGame({ createdAt: 2, id: "newer" }),
        createGame({ code: "ROOK-7788", id: "other" }),
      ],
      "knight-4829",
    );

    expect(selected?.id).toBe("newer");
  });

  it("resolves the local player color from the game record", () => {
    const game = createGame({ blackPlayerId: "black-player" });

    expect(resolveOnlinePlayerColor(game, "white-player")).toBe("white");
    expect(resolveOnlinePlayerColor(game, "black-player")).toBe("black");
    expect(resolveOnlinePlayerColor(game, "spectator")).toBeNull();
  });

  it("only allows a second unique player to join a waiting game", () => {
    expect(canJoinOnlineGame(createGame(), "black-player")).toBe(true);
    expect(canJoinOnlineGame(createGame(), "white-player")).toBe(false);
    expect(
      canJoinOnlineGame(createGame({ blackPlayerId: "joined-player", status: "active" }), "other"),
    ).toBe(false);
  });

  it("creates the waiting-room payload with synced clocks", () => {
    expect(createOnlineGamePayload("knight 4829", "white-player", 300)).toEqual({
      blackPlayerId: null,
      blackTimeRemaining: 300_000,
      code: "KNIGHT-4829",
      createdAt: expect.any(Number),
      moves: [],
      result: null,
      status: "waiting",
      timeControl: 300,
      updatedAt: expect.any(Number),
      whitePlayerId: "white-player",
      whiteTimeRemaining: 300_000,
    });
  });

  it("falls back to createdAt when older games do not yet have updatedAt", () => {
    expect(
      getOnlineGameUpdatedAt(
        createGame({
          createdAt: 42,
          updatedAt: undefined,
        }),
      ),
    ).toBe(42);
  });

  it("detects when the current opponent still has a live presence peer", () => {
    expect(
      isOnlineOpponentConnected(
        {
          "peer-1": {
            playerId: "white-player",
            status: "online",
          },
        },
        "white-player",
      ),
    ).toBe(true);

    expect(
      isOnlineOpponentConnected(
        {
          "peer-1": {
            playerId: "white-player",
            status: "offline",
          },
        },
        "white-player",
      ),
    ).toBe(false);

    expect(isOnlineOpponentConnected({}, "white-player")).toBe(false);
  });

  it("marks long-idle active games as stale for abandonment cleanup", () => {
    expect(
      isStaleOnlineGame(
        createGame({
          status: "active",
          updatedAt: 1_000,
        }),
        1_000 + ONLINE_STALE_GAME_TIMEOUT_MS - 1,
      ),
    ).toBe(false);

    expect(
      isStaleOnlineGame(
        createGame({
          status: "active",
          updatedAt: 1_000,
        }),
        1_000 + ONLINE_STALE_GAME_TIMEOUT_MS,
      ),
    ).toBe(true);
  });

  it("rebuilds a playable local session from SAN move history and stored clocks", () => {
    const session = buildOnlineGameSession(
      createGame({
        blackPlayerId: "black-player",
        blackTimeRemaining: 289_000,
        moves: ["e4", "e5", "Nf3"],
        status: "active",
        whiteTimeRemaining: 295_500,
      }),
      {
        playerColor: "black",
        soundEnabled: false,
      },
    );

    expect(session).not.toBeNull();
    expect(session?.clockState).toEqual({
      black: 289_000,
      white: 295_500,
    });
    expect(session?.orientation).toBe("black");
    expect(session?.soundEnabled).toBe(false);
    expect(buildGameTimelineSnapshot(session!.timeline).moveLog.map((move) => move.san)).toEqual([
      "e4",
      "e5",
      "Nf3",
    ]);
  });

  it("rejects malformed SAN histories instead of building a broken board state", () => {
    expect(
      buildOnlineGameSession(
        createGame({
          moves: ["e4", "not-a-move"],
        }),
        {
          playerColor: "white",
        },
      ),
    ).toBeNull();
  });
});

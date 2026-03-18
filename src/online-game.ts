import {
  applySanMove,
  createGame,
  toMoveInput,
  type MoveInput,
  type PlayerColor,
} from "./chess-engine";
import { DEFAULT_SOUND_ENABLED, type GameSession } from "./game-session";

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type PersistedOnlineSessionV1 = {
  gameCode: string;
  playerId: string;
  version: 1;
};

export type OnlineGameStatus = "waiting" | "active" | "completed";
export type OnlineGameResult = PlayerColor | "draw" | "stalemate" | null;

export type OnlineGameRecord = {
  blackPlayerId: string | null;
  blackTimeRemaining: number;
  code: string;
  createdAt: number;
  id: string;
  moves: string[];
  result: OnlineGameResult;
  status: OnlineGameStatus;
  timeControl: number;
  whitePlayerId: string;
  whiteTimeRemaining: number;
};

export type OnlineSessionReference = {
  gameCode: string;
  playerId: string;
};

const SESSION_CODE_WORDS = [
  "bishop",
  "castle",
  "check",
  "file",
  "fork",
  "gambit",
  "knight",
  "pawn",
  "queen",
  "rank",
  "rook",
  "tempo",
] as const;

export const ONLINE_PLAYER_STORAGE_KEY = "chess.online-player.v1";
export const ONLINE_SESSION_STORAGE_KEY = "chess.online-session.v1";

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isOnlineGameStatus(value: unknown): value is OnlineGameStatus {
  return value === "waiting" || value === "active" || value === "completed";
}

function isOnlineGameResult(value: unknown): value is OnlineGameResult {
  return (
    value === null ||
    value === "white" ||
    value === "black" ||
    value === "draw" ||
    value === "stalemate"
  );
}

function isPersistedOnlineSessionV1(value: unknown): value is PersistedOnlineSessionV1 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof PersistedOnlineSessionV1, unknown>>;

  return (
    candidate.version === 1 &&
    typeof candidate.gameCode === "string" &&
    candidate.gameCode.length > 0 &&
    typeof candidate.playerId === "string" &&
    candidate.playerId.length > 0
  );
}

function clampClock(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function createRandomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `player-${Math.random().toString(36).slice(2, 12)}`;
}

export function normalizeSessionCode(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createSessionCode(random: () => number = Math.random) {
  const word =
    SESSION_CODE_WORDS[Math.floor(random() * SESSION_CODE_WORDS.length)] ?? SESSION_CODE_WORDS[0];
  const number = 1000 + Math.floor(random() * 9000);

  return `${word}-${number}`.toUpperCase();
}

export function loadOrCreateOnlinePlayerId(storage?: StorageLike | null) {
  const target = getStorage(storage);

  if (!target) {
    return createRandomId();
  }

  try {
    const current = target.getItem(ONLINE_PLAYER_STORAGE_KEY);

    if (current) {
      return current;
    }

    const next = createRandomId();

    target.setItem(ONLINE_PLAYER_STORAGE_KEY, next);

    return next;
  } catch {
    return createRandomId();
  }
}

export function loadOnlineSession(storage?: StorageLike | null): OnlineSessionReference | null {
  const target = getStorage(storage);

  if (!target) {
    return null;
  }

  try {
    const raw = target.getItem(ONLINE_SESSION_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isPersistedOnlineSessionV1(parsed)) {
      return null;
    }

    return {
      gameCode: parsed.gameCode,
      playerId: parsed.playerId,
    };
  } catch {
    return null;
  }
}

export function persistOnlineSession(
  session: OnlineSessionReference | null,
  storage?: StorageLike | null,
) {
  const target = getStorage(storage);

  if (!target) {
    return;
  }

  try {
    if (!session) {
      target.removeItem(ONLINE_SESSION_STORAGE_KEY);
      return;
    }

    const payload: PersistedOnlineSessionV1 = {
      gameCode: session.gameCode,
      playerId: session.playerId,
      version: 1,
    };

    target.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures so the live game can continue.
  }
}

export function isOnlineGameRecord(value: unknown): value is OnlineGameRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof OnlineGameRecord, unknown>>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.code === "string" &&
    isOnlineGameStatus(candidate.status) &&
    Array.isArray(candidate.moves) &&
    candidate.moves.every((move) => typeof move === "string") &&
    typeof candidate.whitePlayerId === "string" &&
    (candidate.blackPlayerId === null || typeof candidate.blackPlayerId === "string") &&
    typeof candidate.whiteTimeRemaining === "number" &&
    typeof candidate.blackTimeRemaining === "number" &&
    typeof candidate.timeControl === "number" &&
    typeof candidate.createdAt === "number" &&
    isOnlineGameResult(candidate.result)
  );
}

export function selectOnlineGameByCode(games: unknown, code: string): OnlineGameRecord | null {
  if (!Array.isArray(games)) {
    return null;
  }

  const normalizedCode = normalizeSessionCode(code);
  const matches = games.filter(isOnlineGameRecord).filter((game) => game.code === normalizedCode);

  if (matches.length === 0) {
    return null;
  }

  return [...matches].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

export function resolveOnlinePlayerColor(
  game: OnlineGameRecord,
  playerId: string,
): PlayerColor | null {
  if (game.whitePlayerId === playerId) {
    return "white";
  }

  if (game.blackPlayerId === playerId) {
    return "black";
  }

  return null;
}

export function canJoinOnlineGame(game: OnlineGameRecord, playerId: string) {
  return game.status === "waiting" && !game.blackPlayerId && game.whitePlayerId !== playerId;
}

export function createOnlineGamePayload(
  code: string,
  playerId: string,
  timeControlSeconds: number,
) {
  const startingTimeMs = Math.max(0, timeControlSeconds) * 1000;

  return {
    blackPlayerId: null,
    blackTimeRemaining: startingTimeMs,
    code: normalizeSessionCode(code),
    createdAt: Date.now(),
    moves: [] as string[],
    result: null as OnlineGameResult,
    status: "waiting" as const,
    timeControl: Math.max(0, timeControlSeconds),
    whitePlayerId: playerId,
    whiteTimeRemaining: startingTimeMs,
  };
}

export function buildOnlineGameSession(
  game: OnlineGameRecord,
  options: {
    orientation?: PlayerColor;
    playerColor: PlayerColor;
    soundEnabled?: boolean;
  },
): GameSession | null {
  const activeGame = createGame();
  const moves: MoveInput[] = [];

  try {
    for (const san of game.moves) {
      moves.push(toMoveInput(applySanMove(activeGame, san)));
    }
  } catch {
    return null;
  }

  return {
    clockState: {
      black: clampClock(game.blackTimeRemaining),
      white: clampClock(game.whiteTimeRemaining),
    },
    opponentMode: "human",
    orientation: options.orientation ?? options.playerColor,
    soundEnabled: options.soundEnabled ?? DEFAULT_SOUND_ENABLED,
    timeline: {
      cursor: moves.length,
      moves,
    },
  };
}

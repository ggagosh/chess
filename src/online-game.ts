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
export type OnlineGameResult = PlayerColor | "abandoned" | "draw" | "stalemate" | null;

export const ONLINE_ABANDONMENT_TIMEOUT_MS = 60_000;
export const ONLINE_DISCONNECT_DEBOUNCE_MS = 4_000;
export const ONLINE_ROOM_TYPE = "game";
export const ONLINE_STALE_GAME_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

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
  updatedAt?: number;
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

const ONLINE_ALIAS_GIVEN_NAMES = [
  "Arwen",
  "Bilbo",
  "Chewie",
  "Frodo",
  "Gimli",
  "Han",
  "Leia",
  "Lando",
  "Merry",
  "Obi",
  "Pippin",
  "Rey",
  "Samwise",
  "Yoda",
] as const;

const ONLINE_ALIAS_FAMILY_NAMES = [
  "Baggins",
  "Brandybuck",
  "Gamgee",
  "Greenleaf",
  "Kenobi",
  "Organa",
  "Ren",
  "Skywalker",
  "Solo",
  "Took",
  "Wookiee",
  "Wormtongue",
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
    value === "abandoned" ||
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

function hashValue(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
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

export function getOnlinePlayerAlias(playerId: string) {
  const hash = hashValue(playerId);
  const givenName =
    ONLINE_ALIAS_GIVEN_NAMES[hash % ONLINE_ALIAS_GIVEN_NAMES.length] ??
    ONLINE_ALIAS_GIVEN_NAMES[0];
  const familyName =
    ONLINE_ALIAS_FAMILY_NAMES[
      Math.floor(hash / ONLINE_ALIAS_GIVEN_NAMES.length) % ONLINE_ALIAS_FAMILY_NAMES.length
    ] ?? ONLINE_ALIAS_FAMILY_NAMES[0];

  return `${givenName} ${familyName}`;
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
    (candidate.updatedAt === undefined || typeof candidate.updatedAt === "number") &&
    isOnlineGameResult(candidate.result)
  );
}

export function getOnlineGameUpdatedAt(game: OnlineGameRecord) {
  return typeof game.updatedAt === "number" ? game.updatedAt : game.createdAt;
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

export function isOnlineOpponentConnected(
  peers: Record<string, { playerId?: string; status?: string }>,
  opponentPlayerId: string | null,
) {
  if (!opponentPlayerId) {
    return false;
  }

  return Object.values(peers).some(
    (peer) => peer.playerId === opponentPlayerId && peer.status === "online",
  );
}

export function isStaleOnlineGame(
  game: OnlineGameRecord,
  now: number = Date.now(),
  staleAfterMs: number = ONLINE_STALE_GAME_TIMEOUT_MS,
) {
  return game.status === "active" && now - getOnlineGameUpdatedAt(game) >= staleAfterMs;
}

export function createOnlineGamePayload(
  code: string,
  playerId: string,
  timeControlSeconds: number,
) {
  const startingTimeMs = Math.max(0, timeControlSeconds) * 1000;
  const now = Date.now();

  return {
    blackPlayerId: null,
    blackTimeRemaining: startingTimeMs,
    code: normalizeSessionCode(code),
    createdAt: now,
    moves: [] as string[],
    result: null as OnlineGameResult,
    status: "waiting" as const,
    timeControl: Math.max(0, timeControlSeconds),
    updatedAt: now,
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

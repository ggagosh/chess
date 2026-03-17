import {
  PROMOTION_OPTIONS,
  STARTING_FEN,
  applyMove,
  createGame,
  type BoardOrientation,
  type EngineMove,
  type MoveInput,
} from "./chess-engine";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type PersistedGameSession = {
  fen: string;
  history: MoveInput[];
  orientation: BoardOrientation;
  soundEnabled: boolean;
  version: 1;
};

export type GameSession = {
  fen: string;
  history: MoveInput[];
  moveLog: EngineMove[];
  orientation: BoardOrientation;
  soundEnabled: boolean;
};

export const GAME_SESSION_STORAGE_KEY = "chess.session.v1";
export const DEFAULT_BOARD_ORIENTATION: BoardOrientation = "white";
export const DEFAULT_SOUND_ENABLED = true;

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isBoardOrientation(value: unknown): value is BoardOrientation {
  return value === "white" || value === "black";
}

function isMoveInput(value: unknown): value is MoveInput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof MoveInput, unknown>>;

  return (
    typeof candidate.from === "string" &&
    typeof candidate.to === "string" &&
    (candidate.promotion === undefined ||
      PROMOTION_OPTIONS.includes(candidate.promotion as (typeof PROMOTION_OPTIONS)[number]))
  );
}

function isPersistedGameSession(value: unknown): value is PersistedGameSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof PersistedGameSession, unknown>>;

  return (
    candidate.version === 1 &&
    typeof candidate.fen === "string" &&
    Array.isArray(candidate.history) &&
    candidate.history.every(isMoveInput) &&
    typeof candidate.soundEnabled === "boolean" &&
    isBoardOrientation(candidate.orientation)
  );
}

function buildSession(
  history: MoveInput[],
  orientation = DEFAULT_BOARD_ORIENTATION,
  soundEnabled = DEFAULT_SOUND_ENABLED,
): GameSession {
  const game = createGame();
  const moveLog = history.map((move) => applyMove(game, move));

  return {
    fen: game.fen(),
    history: [...history],
    moveLog,
    orientation,
    soundEnabled,
  };
}

export function createFreshSession(
  options: Partial<Pick<GameSession, "orientation" | "soundEnabled">> = {},
): GameSession {
  return {
    fen: STARTING_FEN,
    history: [],
    moveLog: [],
    orientation: options.orientation ?? DEFAULT_BOARD_ORIENTATION,
    soundEnabled: options.soundEnabled ?? DEFAULT_SOUND_ENABLED,
  };
}

export function loadGameSession(storage?: StorageLike | null): GameSession {
  const target = getStorage(storage);

  if (!target) {
    return createFreshSession();
  }

  try {
    const raw = target.getItem(GAME_SESSION_STORAGE_KEY);

    if (!raw) {
      return createFreshSession();
    }

    const parsed: unknown = JSON.parse(raw);

    if (!isPersistedGameSession(parsed)) {
      return createFreshSession();
    }

    const session = buildSession(parsed.history, parsed.orientation, parsed.soundEnabled);

    return session.fen === parsed.fen ? session : createFreshSession();
  } catch {
    return createFreshSession();
  }
}

export function persistGameSession(session: GameSession, storage?: StorageLike | null) {
  const target = getStorage(storage);

  if (!target) {
    return;
  }

  const payload: PersistedGameSession = {
    fen: session.fen,
    history: session.history,
    orientation: session.orientation,
    soundEnabled: session.soundEnabled,
    version: 1,
  };

  try {
    target.setItem(GAME_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures so gameplay still works in restricted browsers.
  }
}

import { PROMOTION_OPTIONS, type BoardOrientation, type MoveInput } from "./chess-engine";
import {
  INITIAL_GAME_TIMELINE_STATE,
  buildGameTimelineSnapshot,
  type GameTimelineState,
} from "./game-state";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type PersistedGameSessionV1 = {
  fen: string;
  history: MoveInput[];
  orientation: BoardOrientation;
  soundEnabled: boolean;
  version: 1;
};

type PersistedGameSessionV2 = {
  activeFen: string;
  cursor: number;
  moves: MoveInput[];
  orientation: BoardOrientation;
  soundEnabled: boolean;
  version: 2;
};

export type GameSession = {
  orientation: BoardOrientation;
  soundEnabled: boolean;
  timeline: GameTimelineState;
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

function isPersistedGameSessionV1(value: unknown): value is PersistedGameSessionV1 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof PersistedGameSessionV1, unknown>>;

  return (
    candidate.version === 1 &&
    typeof candidate.fen === "string" &&
    Array.isArray(candidate.history) &&
    candidate.history.every(isMoveInput) &&
    typeof candidate.soundEnabled === "boolean" &&
    isBoardOrientation(candidate.orientation)
  );
}

function isPersistedGameSessionV2(value: unknown): value is PersistedGameSessionV2 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof PersistedGameSessionV2, unknown>>;

  return (
    candidate.version === 2 &&
    typeof candidate.activeFen === "string" &&
    Number.isInteger(candidate.cursor) &&
    Array.isArray(candidate.moves) &&
    candidate.moves.every(isMoveInput) &&
    typeof candidate.soundEnabled === "boolean" &&
    isBoardOrientation(candidate.orientation)
  );
}

function createTimelineState(moves: MoveInput[], cursor = moves.length): GameTimelineState {
  return {
    cursor: Math.min(Math.max(cursor, 0), moves.length),
    moves: [...moves],
  };
}

function createSession(
  timeline: GameTimelineState,
  orientation = DEFAULT_BOARD_ORIENTATION,
  soundEnabled = DEFAULT_SOUND_ENABLED,
): GameSession {
  return {
    orientation,
    soundEnabled,
    timeline: createTimelineState(timeline.moves, timeline.cursor),
  };
}

export function createFreshSession(
  options: Partial<Pick<GameSession, "orientation" | "soundEnabled">> = {},
): GameSession {
  return {
    orientation: options.orientation ?? DEFAULT_BOARD_ORIENTATION,
    soundEnabled: options.soundEnabled ?? DEFAULT_SOUND_ENABLED,
    timeline: { ...INITIAL_GAME_TIMELINE_STATE },
  };
}

function loadLegacySession(session: PersistedGameSessionV1): GameSession {
  const nextSession = createSession(
    createTimelineState(session.history),
    session.orientation,
    session.soundEnabled,
  );
  const snapshot = buildGameTimelineSnapshot(nextSession.timeline);

  return snapshot.fen === session.fen ? nextSession : createFreshSession();
}

function loadCurrentSession(session: PersistedGameSessionV2): GameSession {
  const nextSession = createSession(
    createTimelineState(session.moves, session.cursor),
    session.orientation,
    session.soundEnabled,
  );
  const snapshot = buildGameTimelineSnapshot(nextSession.timeline);

  return snapshot.fen === session.activeFen ? nextSession : createFreshSession();
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

    if (isPersistedGameSessionV2(parsed)) {
      return loadCurrentSession(parsed);
    }

    if (isPersistedGameSessionV1(parsed)) {
      return loadLegacySession(parsed);
    }

    return createFreshSession();
  } catch {
    return createFreshSession();
  }
}

export function persistGameSession(session: GameSession, storage?: StorageLike | null) {
  const target = getStorage(storage);

  if (!target) {
    return;
  }

  const snapshot = buildGameTimelineSnapshot(session.timeline);
  const payload: PersistedGameSessionV2 = {
    activeFen: snapshot.fen,
    cursor: session.timeline.cursor,
    moves: session.timeline.moves,
    orientation: session.orientation,
    soundEnabled: session.soundEnabled,
    version: 2,
  };

  try {
    target.setItem(GAME_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures so gameplay still works in restricted browsers.
  }
}

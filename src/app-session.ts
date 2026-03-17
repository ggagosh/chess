import type { PlayerColor } from "./chess-engine";
import {
  DEFAULT_SOUND_ENABLED,
  GAME_SESSION_STORAGE_KEY,
  createFreshSession,
  loadGameSession,
  persistGameSession,
  type GameSession,
} from "./game-session";
import {
  DEFAULT_GAME_SETTINGS,
  DEFAULT_TIME_CONTROL_MINUTES,
  isGameSettings,
  resolvePlayerColor,
  timeControlMinutesToMs,
  type GameSettings,
} from "./game-setup";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type PersistedAppSessionV1 = {
  playerColor: PlayerColor;
  screen: AppScreen;
  settings: GameSettings;
  version: 1;
};

export type AppScreen = "start" | "game";

export type AppSessionState = {
  gameSession: GameSession;
  playerColor: PlayerColor;
  screen: AppScreen;
  settings: GameSettings;
};

export const APP_SESSION_STORAGE_KEY = "chess.app.v1";

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function isPlayerColor(value: unknown): value is PlayerColor {
  return value === "white" || value === "black";
}

function isAppScreen(value: unknown): value is AppScreen {
  return value === "start" || value === "game";
}

function isPersistedAppSessionV1(value: unknown): value is PersistedAppSessionV1 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof PersistedAppSessionV1, unknown>>;

  return (
    candidate.version === 1 &&
    isPlayerColor(candidate.playerColor) &&
    isAppScreen(candidate.screen) &&
    isGameSettings(candidate.settings)
  );
}

function deriveLegacyPlayerColor(gameSession: GameSession): PlayerColor {
  if (gameSession.opponentMode === "human") {
    return gameSession.orientation;
  }

  return "white";
}

function deriveLegacySettings(gameSession: GameSession, playerColor: PlayerColor): GameSettings {
  return {
    colorPreference: gameSession.opponentMode === "human" ? gameSession.orientation : playerColor,
    opponentMode: gameSession.opponentMode,
    timeControlMinutes: DEFAULT_TIME_CONTROL_MINUTES,
  };
}

function createDefaultState(): AppSessionState {
  const playerColor = resolvePlayerColor(DEFAULT_GAME_SETTINGS.colorPreference, () => 0);

  return {
    gameSession: createFreshSession({
      opponentMode: DEFAULT_GAME_SETTINGS.opponentMode,
      orientation: playerColor,
      soundEnabled: DEFAULT_SOUND_ENABLED,
      startingTimeMs: timeControlMinutesToMs(DEFAULT_GAME_SETTINGS.timeControlMinutes),
    }),
    playerColor,
    screen: "start",
    settings: { ...DEFAULT_GAME_SETTINGS },
  };
}

function loadLegacyState(target: StorageLike): AppSessionState {
  const gameSession = loadGameSession(target);

  if (!target.getItem(GAME_SESSION_STORAGE_KEY)) {
    return createDefaultState();
  }

  const playerColor = deriveLegacyPlayerColor(gameSession);

  return {
    gameSession,
    playerColor,
    screen: "game",
    settings: deriveLegacySettings(gameSession, playerColor),
  };
}

export function createGameSessionFromSettings(
  settings: GameSettings,
  options: {
    playerColor?: PlayerColor;
    random?: () => number;
    soundEnabled?: boolean;
  } = {},
) {
  const playerColor =
    options.playerColor ?? resolvePlayerColor(settings.colorPreference, options.random);

  return {
    playerColor,
    session: createFreshSession({
      opponentMode: settings.opponentMode,
      orientation: playerColor,
      soundEnabled: options.soundEnabled,
      startingTimeMs: timeControlMinutesToMs(settings.timeControlMinutes),
    }),
  };
}

export function loadAppSession(storage?: StorageLike | null): AppSessionState {
  const target = getStorage(storage);

  if (!target) {
    return createDefaultState();
  }

  const raw = target.getItem(APP_SESSION_STORAGE_KEY);

  if (!raw) {
    return loadLegacyState(target);
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isPersistedAppSessionV1(parsed)) {
      return loadLegacyState(target);
    }

    return {
      gameSession: loadGameSession(target),
      playerColor: parsed.playerColor,
      screen: parsed.screen,
      settings: parsed.settings,
    };
  } catch {
    return loadLegacyState(target);
  }
}

export function persistAppSession(appSession: AppSessionState, storage?: StorageLike | null) {
  const target = getStorage(storage);

  if (!target) {
    return;
  }

  persistGameSession(appSession.gameSession, target);

  const payload: PersistedAppSessionV1 = {
    playerColor: appSession.playerColor,
    screen: appSession.screen,
    settings: appSession.settings,
    version: 1,
  };

  try {
    target.setItem(APP_SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore persistence failures so gameplay still works in restricted browsers.
  }
}

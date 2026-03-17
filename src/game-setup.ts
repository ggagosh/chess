import type { PlayerColor } from "./chess-engine";
import type { OpponentMode } from "./computer-opponent";

export type TimeControlMinutes = 5 | 10 | 15;
export type ColorPreference = PlayerColor | "random";

export type GameSettings = {
  colorPreference: ColorPreference;
  opponentMode: OpponentMode;
  timeControlMinutes: TimeControlMinutes;
};

export type SettingOption<T extends string | number> = {
  description: string;
  label: string;
  value: T;
};

export const TIME_CONTROL_OPTIONS: readonly SettingOption<TimeControlMinutes>[] = [
  {
    description: "A fast blitz game with five minutes on each clock.",
    label: "5 min",
    value: 5,
  },
  {
    description: "The current default pace with ten minutes per side.",
    label: "10 min",
    value: 10,
  },
  {
    description: "A slower rapid game with fifteen minutes per side.",
    label: "15 min",
    value: 15,
  },
];

export const COLOR_PREFERENCE_OPTIONS: readonly SettingOption<ColorPreference>[] = [
  {
    description: "Begin from White's side of the board and move first against AI.",
    label: "White",
    value: "white",
  },
  {
    description: "Begin from Black's side of the board and let AI move first as White.",
    label: "Black",
    value: "black",
  },
  {
    description: "Randomly assign White or Black when the game starts.",
    label: "Random",
    value: "random",
  },
];

export const DEFAULT_TIME_CONTROL_MINUTES: TimeControlMinutes = 10;

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  colorPreference: "white",
  opponentMode: "human",
  timeControlMinutes: DEFAULT_TIME_CONTROL_MINUTES,
};

export function isTimeControlMinutes(value: unknown): value is TimeControlMinutes {
  return value === 5 || value === 10 || value === 15;
}

export function isColorPreference(value: unknown): value is ColorPreference {
  return value === "white" || value === "black" || value === "random";
}

export function isGameSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof GameSettings, unknown>>;

  return (
    isColorPreference(candidate.colorPreference) &&
    (candidate.opponentMode === "human" ||
      candidate.opponentMode === "random" ||
      candidate.opponentMode === "stockfish") &&
    isTimeControlMinutes(candidate.timeControlMinutes)
  );
}

export function resolvePlayerColor(
  colorPreference: ColorPreference,
  random: () => number = Math.random,
): PlayerColor {
  if (colorPreference === "random") {
    return random() < 0.5 ? "white" : "black";
  }

  return colorPreference;
}

export function timeControlMinutesToMs(minutes: TimeControlMinutes): number {
  return minutes * 60 * 1000;
}

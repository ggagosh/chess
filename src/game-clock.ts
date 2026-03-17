import type { PlayerColor } from "./chess-engine";

export type ClockState = Record<PlayerColor, number>;

export const DEFAULT_CLOCK_MS = 10 * 60 * 1000;

export function createInitialClockState(startingTimeMs = DEFAULT_CLOCK_MS): ClockState {
  const clamped = Math.max(0, startingTimeMs);

  return {
    black: clamped,
    white: clamped,
  };
}

export function formatClockTime(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function tickClock(
  clockState: ClockState,
  activePlayer: PlayerColor,
  elapsedMs: number,
): ClockState {
  if (elapsedMs <= 0) {
    return clockState;
  }

  return {
    ...clockState,
    [activePlayer]: Math.max(0, clockState[activePlayer] - elapsedMs),
  };
}

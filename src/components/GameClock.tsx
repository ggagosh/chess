import type { CSSProperties } from "react";

import { DEFAULT_CLOCK_MS, formatClockTime } from "../game-clock";
import type { PlayerColor } from "../chess-engine";

type GameClockProps = {
  isActive: boolean;
  isGameOver: boolean;
  isInCheck: boolean;
  isPaused?: boolean;
  label?: string;
  player: PlayerColor;
  timeRemainingMs: number;
};

function playerName(player: PlayerColor) {
  return player === "white" ? "White" : "Black";
}

function buildStatusLabel({
  isActive,
  isGameOver,
  isInCheck,
  isPaused,
}: Pick<GameClockProps, "isActive" | "isGameOver" | "isInCheck" | "isPaused">) {
  if (isGameOver) {
    return "Clock stopped";
  }

  if (isPaused) {
    return "Paused";
  }

  if (isInCheck) {
    return "In check";
  }

  return isActive ? "On move" : "Waiting";
}

export function GameClock({
  isActive,
  isGameOver,
  isInCheck,
  isPaused = false,
  label,
  player,
  timeRemainingMs,
}: GameClockProps) {
  const progress = `${Math.max(0, Math.min(100, (timeRemainingMs / DEFAULT_CLOCK_MS) * 100))}%`;
  const isCritical = timeRemainingMs <= 60_000;
  const accessibleLabel = `${label ?? playerName(player)} clock, ${formatClockTime(timeRemainingMs)}, ${buildStatusLabel(
    {
      isActive,
      isGameOver,
      isInCheck,
      isPaused,
    },
  )}`;

  return (
    <div
      className={[
        "clock-card",
        `clock-${player}`,
        isActive ? "active" : "",
        isCritical ? "critical" : "",
        isPaused ? "paused" : "",
        isInCheck ? "in-check" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={accessibleLabel}
      role="timer"
      style={{ "--clock-progress": progress } as CSSProperties}
    >
      <div className="clock-copy">
        <span className="clock-player">{label ?? playerName(player)}</span>
        <span className="clock-status">
          {buildStatusLabel({ isActive, isGameOver, isInCheck, isPaused })}
        </span>
      </div>
      <strong className="clock-face">{formatClockTime(timeRemainingMs)}</strong>
      <span className="clock-track" aria-hidden="true">
        <span className="clock-track-fill" />
      </span>
    </div>
  );
}

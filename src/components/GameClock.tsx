import type { CSSProperties } from "react";

import { DEFAULT_CLOCK_MS, formatClockTime } from "../game-clock";
import type { PlayerColor } from "../chess-engine";

type GameClockProps = {
  isActive: boolean;
  isGameOver: boolean;
  isInCheck: boolean;
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
}: Pick<GameClockProps, "isActive" | "isGameOver" | "isInCheck">) {
  if (isGameOver) {
    return "Clock stopped";
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
  player,
  timeRemainingMs,
}: GameClockProps) {
  const progress = `${Math.max(0, Math.min(100, (timeRemainingMs / DEFAULT_CLOCK_MS) * 100))}%`;
  const isCritical = timeRemainingMs <= 60_000;

  return (
    <div
      className={[
        "clock-card",
        `clock-${player}`,
        isActive ? "active" : "",
        isCritical ? "critical" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--clock-progress": progress } as CSSProperties}
    >
      <div className="clock-copy">
        <span className="clock-player">{playerName(player)}</span>
        <span className="clock-status">
          {buildStatusLabel({ isActive, isGameOver, isInCheck })}
        </span>
      </div>
      <strong className="clock-face" aria-live={isActive && !isGameOver ? "polite" : "off"}>
        {formatClockTime(timeRemainingMs)}
      </strong>
      <span className="clock-track" aria-hidden="true">
        <span className="clock-track-fill" />
      </span>
    </div>
  );
}

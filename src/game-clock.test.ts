import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLOCK_MS,
  createInitialClockState,
  formatClockTime,
  tickClock,
} from "./game-clock";

describe("game-clock", () => {
  it("creates a fresh default clock state for both players", () => {
    expect(createInitialClockState()).toEqual({
      black: DEFAULT_CLOCK_MS,
      white: DEFAULT_CLOCK_MS,
    });
  });

  it("supports a custom starting time and clamps negative values", () => {
    expect(createInitialClockState(90_000)).toEqual({
      black: 90_000,
      white: 90_000,
    });

    expect(createInitialClockState(-500)).toEqual({
      black: 0,
      white: 0,
    });
  });

  it("formats remaining time as zero-padded minutes and seconds", () => {
    expect(formatClockTime(DEFAULT_CLOCK_MS)).toBe("10:00");
    expect(formatClockTime(61_000)).toBe("01:01");
    expect(formatClockTime(59_001)).toBe("01:00");
    expect(formatClockTime(59_000)).toBe("00:59");
    expect(formatClockTime(-250)).toBe("00:00");
  });

  it("ticks down only the active player's clock", () => {
    expect(
      tickClock(
        {
          black: DEFAULT_CLOCK_MS,
          white: DEFAULT_CLOCK_MS,
        },
        "white",
        1_250,
      ),
    ).toEqual({
      black: DEFAULT_CLOCK_MS,
      white: DEFAULT_CLOCK_MS - 1_250,
    });
  });

  it("clamps the active clock at zero and ignores non-positive elapsed time", () => {
    const state = {
      black: 2_000,
      white: 500,
    };

    expect(tickClock(state, "white", 1_200)).toEqual({
      black: 2_000,
      white: 0,
    });

    expect(tickClock(state, "black", 0)).toBe(state);
    expect(tickClock(state, "black", -150)).toBe(state);
  });
});

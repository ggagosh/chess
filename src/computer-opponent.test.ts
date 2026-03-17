import { describe, expect, it, vi } from "vitest";

import { applyMove, createGame } from "./chess-engine";
import { parseUciMove, pickRandomMove, resolveComputerMove } from "./computer-opponent";

describe("computer-opponent", () => {
  it("picks a deterministic legal random move when provided a stub random source", () => {
    const move = pickRandomMove(createGame(), () => 0);

    expect(move).toEqual({
      from: "a2",
      to: "a3",
    });
  });

  it("parses UCI moves including promotion notation", () => {
    expect(parseUciMove("e7e8q")).toEqual({
      from: "e7",
      promotion: "queen",
      to: "e8",
    });
  });

  it("uses Stockfish when the stronger engine returns a legal move", async () => {
    const getStockfishMove = vi.fn().mockResolvedValue({
      from: "e7",
      to: "e5",
    });

    await expect(
      resolveComputerMove({
        fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
        getStockfishMove,
        mode: "stockfish",
      }),
    ).resolves.toEqual({
      move: {
        from: "e7",
        to: "e5",
      },
      source: "stockfish",
    });
  });

  it("falls back to a random legal move when Stockfish fails", async () => {
    const result = await resolveComputerMove({
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      getStockfishMove: vi.fn().mockRejectedValue(new Error("worker exploded")),
      mode: "stockfish",
      random: () => 0,
    });

    expect(result.fallbackReason).toContain("Stockfish was unavailable");

    const game = createGame("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");

    expect(() => applyMove(game, result.move)).not.toThrow();
    expect(result.source).toBe("random");
  });
});

import { describe, expect, it } from "vitest";

import {
  STARTING_FEN,
  applyMove,
  createGame,
  getAllLegalMoves,
  getGameStatus,
  getLegalMoves,
} from "./chess-engine";

describe("chess-engine", () => {
  it("exposes the expected opening move count and piece moves", () => {
    const game = createGame(STARTING_FEN);

    expect(getAllLegalMoves(game)).toHaveLength(20);
    expect(
      getLegalMoves(game, "e2")
        .map((move) => move.to)
        .sort(),
    ).toEqual(["e3", "e4"]);
  });

  it("prevents pinned pieces from leaving the king exposed", () => {
    const game = createGame("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1");
    const rookMoves = getLegalMoves(game, "e2").map((move) => move.to);

    expect(rookMoves).toContain("e8");
    expect(rookMoves).not.toContain("d2");
  });

  it("supports castling and repositions the rook correctly", () => {
    const game = createGame("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const castlingTargets = getLegalMoves(game, "e1")
      .filter((move) => move.isKingsideCastle || move.isQueensideCastle)
      .map((move) => move.to)
      .sort();

    expect(castlingTargets).toEqual(["c1", "g1"]);

    applyMove(game, {
      from: "e1",
      to: "g1",
    });

    expect(game.get("g1")).toMatchObject({ color: "w", type: "k" });
    expect(game.get("f1")).toMatchObject({ color: "w", type: "r" });
  });

  it("supports en passant captures", () => {
    const game = createGame("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
    const moves = getLegalMoves(game, "e5");
    const enPassant = moves.find((move) => move.isEnPassant);

    expect(enPassant).toBeDefined();
    expect(enPassant?.to).toBe("d6");

    applyMove(game, {
      from: "e5",
      to: "d6",
    });

    expect(game.get("d6")).toMatchObject({ color: "w", type: "p" });
    expect(game.get("d5")).toBeUndefined();
  });

  it("requires explicit promotion choice and applies the promoted piece", () => {
    const game = createGame("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    const promotionMoves = getLegalMoves(game, "a7")
      .filter((move) => move.promotion)
      .map((move) => move.promotion)
      .sort();

    expect(promotionMoves).toEqual(["bishop", "knight", "queen", "rook"]);

    applyMove(game, {
      from: "a7",
      promotion: "queen",
      to: "a8",
    });

    expect(game.get("a8")).toMatchObject({ color: "w", type: "q" });
  });

  it("detects checkmate from a legal move sequence", () => {
    const game = createGame(STARTING_FEN);

    applyMove(game, { from: "f2", to: "f3" });
    applyMove(game, { from: "e7", to: "e5" });
    applyMove(game, { from: "g2", to: "g4" });
    applyMove(game, { from: "d8", to: "h4" });

    expect(getGameStatus(game)).toMatchObject({
      phase: "checkmate",
      winner: "black",
    });
  });

  it("detects stalemate positions", () => {
    const game = createGame("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");

    expect(getGameStatus(game)).toMatchObject({
      phase: "stalemate",
      winner: null,
    });
    expect(getAllLegalMoves(game)).toHaveLength(0);
  });
});

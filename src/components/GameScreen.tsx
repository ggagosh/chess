import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Square } from "chess.js";

import {
  getOpponentModeLabel,
  isComputerOpponentMode,
  OPPONENT_MODE_OPTIONS,
  resolveComputerMove,
  type ComputerMoveSource,
  type OpponentMode,
} from "../computer-opponent";
import {
  applyMove,
  createGame,
  getBoardCells,
  getGameStatus,
  getLegalMoves,
  getMoveTargets,
  type EngineMove,
  type GamePhase,
  type MoveInput,
  type PlayerColor,
  type PromotionPiece,
} from "../chess-engine";
import { tickClock } from "../game-clock";
import { playGameSound, type GameSound } from "../game-sounds";
import { createFreshSession, type GameSession } from "../game-session";
import { timeControlMinutesToMs, type TimeControlMinutes } from "../game-setup";
import { buildGameTimelineSnapshot, gameTimelineReducer } from "../game-state";
import { cancelStockfishSearch, getStockfishBestMove } from "../stockfish-client";
import { GameClock } from "./GameClock";
import { GameResultModal } from "./GameResultModal";
import { MoveHistoryPanel } from "./MoveHistoryPanel";
import { PawnPromotionDialog } from "./PawnPromotionDialog";

type PromotionRequest = {
  moves: EngineMove[];
  to: Square;
};

type SessionUpdate = GameSession | ((current: GameSession) => GameSession);

type GameScreenProps = {
  onReturnToSetup: () => void;
  onSessionChange: (update: SessionUpdate) => void;
  playerColor: PlayerColor;
  session: GameSession;
  timeControlMinutes: TimeControlMinutes;
};

const SPECIAL_RULES = [
  "Castling rights are unlocked only when the king and rook stay unmoved, the path is clear, and the king never crosses check.",
  "En passant appears only on the immediately following turn after a two-square pawn advance.",
  "Promotion now pauses board input until you choose queen, rook, bishop, or knight.",
];

function toTitleCase(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function toMoveInput(move: EngineMove): MoveInput {
  return {
    from: move.from,
    promotion: move.promotion,
    to: move.to,
  };
}

function getBoardPerspectiveLabel(orientation: PlayerColor) {
  return `${toTitleCase(orientation)} at bottom`;
}

function getCaptureRailColors(orientation: PlayerColor) {
  return orientation === "white"
    ? { bottom: "white" as const, top: "black" as const }
    : { bottom: "black" as const, top: "white" as const };
}

function getCaptureCaption(color: PlayerColor) {
  return color === "white" ? "Pieces captured by Black" : "Pieces captured by White";
}

function getMoveSound(move: EngineMove, phase: GamePhase, inCheck: boolean): GameSound {
  if (phase === "checkmate" || phase === "stalemate") {
    return "game-over";
  }

  if (inCheck) {
    return "check";
  }

  return move.isCapture || move.isEnPassant ? "capture" : "move";
}

function getComputerStatusLabel(
  mode: OpponentMode,
  isThinking: boolean,
  lastSource: ComputerMoveSource | null,
  notice: string | null,
) {
  if (!isComputerOpponentMode(mode)) {
    return "Off";
  }

  if (isThinking) {
    return mode === "stockfish" ? "Thinking" : "Choosing";
  }

  if (notice) {
    return "Fallback";
  }

  if (mode === "stockfish" && lastSource === "stockfish") {
    return "Ready";
  }

  return mode === "stockfish" ? "Standby" : "Random";
}

export function GameScreen({
  onReturnToSetup,
  onSessionChange,
  playerColor,
  session,
  timeControlMinutes,
}: GameScreenProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<PromotionRequest | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [computerNotice, setComputerNotice] = useState<string | null>(null);
  const [lastComputerSource, setLastComputerSource] = useState<ComputerMoveSource | null>(null);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const computerTurnRequestId = useRef(0);
  const updateSession = useEffectEvent((update: SessionUpdate) => {
    onSessionChange(update);
  });
  const computerColor: PlayerColor = playerColor === "white" ? "black" : "white";

  const {
    canRedo,
    canUndo,
    capturedPieces,
    fen,
    futureCount,
    game,
    historyIndex,
    legalMoveCount,
    moveLog,
    pgn,
    status: gameStatus,
    totalMoves,
  } = buildGameTimelineSnapshot(session.timeline);
  const clockState = session.clockState;
  const boardCells = getBoardCells(game, session.orientation);
  const selectedMoves = selectedSquare ? getLegalMoves(game, selectedSquare) : [];
  const moveTargets = getMoveTargets(selectedMoves);
  const lastMove = moveLog.at(-1) ?? null;
  const isGameOver = gameStatus.phase === "checkmate" || gameStatus.phase === "stalemate";
  const isLivePosition = futureCount === 0;
  const isComputerMode = isComputerOpponentMode(session.opponentMode);
  const isComputerTurn = isComputerMode && isLivePosition && gameStatus.turn === computerColor;
  const resultPhase: "checkmate" | "stalemate" | null =
    gameStatus.phase === "checkmate"
      ? "checkmate"
      : gameStatus.phase === "stalemate"
        ? "stalemate"
        : null;
  const timelineSummary =
    futureCount > 0 ? `${historyIndex} active / ${totalMoves} recorded` : `${historyIndex} plies`;
  const pgnPreview = pgn || "No moves played yet. White has the first turn.";
  const statusDetail = pendingPromotion
    ? `${toTitleCase(gameStatus.turn)} reached ${pendingPromotion.to}. Choose a promotion piece to complete the move.`
    : isComputerThinking
      ? `${toTitleCase(gameStatus.turn)} is thinking. The reply move will land automatically when the computer finishes.`
      : gameStatus.detail;
  const gameResult = resultPhase
    ? {
        detail: gameStatus.detail,
        headline: gameStatus.headline,
        phase: resultPhase,
        winner: gameStatus.winner,
      }
    : null;
  const boardPerspective = getBoardPerspectiveLabel(session.orientation);
  const captureRails = getCaptureRailColors(session.orientation);
  const activeOpponentOption =
    OPPONENT_MODE_OPTIONS.find((option) => option.value === session.opponentMode) ??
    OPPONENT_MODE_OPTIONS[0];
  const computerStatus = getComputerStatusLabel(
    session.opponentMode,
    isComputerThinking,
    lastComputerSource,
    computerNotice,
  );
  const boardInputLocked =
    isGameOver || pendingPromotion !== null || isComputerThinking || isComputerTurn;

  useEffect(() => {
    if (session.opponentMode === "human") {
      setComputerNotice(null);
      setLastComputerSource(null);
      return;
    }

    if (session.opponentMode === "random") {
      setComputerNotice(null);
    }
  }, [session.opponentMode]);

  useEffect(() => {
    if (isGameOver) {
      setIsResultModalOpen(true);
      return;
    }

    setIsResultModalOpen(false);
  }, [historyIndex, isGameOver, gameStatus.phase]);

  useEffect(() => {
    if (isGameOver) {
      return;
    }

    let previousTick = performance.now();
    const intervalId = window.setInterval(() => {
      const now = performance.now();
      const elapsedMs = now - previousTick;
      previousTick = now;

      updateSession((current) => {
        if (current.clockState[gameStatus.turn] <= 0) {
          return current;
        }

        return {
          ...current,
          clockState: tickClock(current.clockState, gameStatus.turn, elapsedMs),
        };
      });
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [gameStatus.turn, isGameOver]);

  const commitMove = useEffectEvent((sourceFen: string, move: MoveInput) => {
    const nextGame = createGame(sourceFen);
    const executed = applyMove(nextGame, move);
    const nextStatus = getGameStatus(nextGame);

    updateSession((current) => ({
      ...current,
      timeline: gameTimelineReducer(current.timeline, {
        move: toMoveInput(executed),
        type: "commit",
      }),
    }));
    clearTransientSelection();

    void playGameSound(
      getMoveSound(executed, nextStatus.phase, nextStatus.inCheck),
      session.soundEnabled,
    );
  });

  const playComputerTurn = useEffectEvent(
    async (requestId: number, sourceFen: string, mode: Exclude<OpponentMode, "human">) => {
      setIsComputerThinking(true);

      try {
        const result = await resolveComputerMove({
          fen: sourceFen,
          getStockfishMove: getStockfishBestMove,
          mode,
        });

        if (computerTurnRequestId.current !== requestId) {
          return;
        }

        setLastComputerSource(result.source);
        setComputerNotice(result.fallbackReason ?? null);
        commitMove(sourceFen, result.move);
      } catch {
        if (computerTurnRequestId.current !== requestId) {
          return;
        }

        setComputerNotice(
          mode === "stockfish"
            ? "Stockfish could not complete the turn. Switch to random mode or start a new game to keep playing."
            : "The computer could not produce a legal move for this position.",
        );
      } finally {
        if (computerTurnRequestId.current === requestId) {
          setIsComputerThinking(false);
        }
      }
    },
  );

  useEffect(() => {
    if (!isComputerTurn || pendingPromotion !== null) {
      return;
    }

    const requestId = computerTurnRequestId.current + 1;

    computerTurnRequestId.current = requestId;

    const timeoutId = window.setTimeout(
      () => {
        if (!isComputerOpponentMode(session.opponentMode)) {
          return;
        }

        void playComputerTurn(requestId, fen, session.opponentMode);
      },
      session.opponentMode === "stockfish" ? 320 : 180,
    );

    return () => {
      window.clearTimeout(timeoutId);

      if (computerTurnRequestId.current === requestId) {
        computerTurnRequestId.current += 1;
      }

      cancelStockfishSearch();
      setIsComputerThinking(false);
    };
  }, [fen, isComputerTurn, pendingPromotion, session.opponentMode]);

  function clearTransientSelection() {
    setPendingPromotion(null);
    setSelectedSquare(null);
  }

  function renderSideRack(color: PlayerColor) {
    const pieces = capturedPieces[color];

    return (
      <div className="side-rack">
        <div className="side-rack-copy">
          <span className="side-rack-player">{toTitleCase(color)}</span>
          <span className="side-rack-caption">{getCaptureCaption(color)}</span>
        </div>
        <GameClock
          isActive={!isGameOver && gameStatus.turn === color}
          isGameOver={isGameOver}
          isInCheck={!isGameOver && gameStatus.turn === color && gameStatus.inCheck}
          player={color}
          timeRemainingMs={clockState[color]}
        />
        <div className="captured-row">
          {pieces.length > 0 ? (
            pieces.map((piece, index) => (
              <span
                key={`${piece.label}-${color}-${index}`}
                className="captured-piece"
                aria-label={piece.label}
                title={piece.label}
              >
                {piece.glyph}
              </span>
            ))
          ) : (
            <span className="captured-empty">None</span>
          )}
        </div>
      </div>
    );
  }

  function handleUndo() {
    if (!canUndo) {
      return;
    }

    updateSession((current) => ({
      ...current,
      timeline: gameTimelineReducer(current.timeline, { type: "undo" }),
    }));
    clearTransientSelection();
  }

  function handleRedo() {
    if (!canRedo) {
      return;
    }

    updateSession((current) => ({
      ...current,
      timeline: gameTimelineReducer(current.timeline, { type: "redo" }),
    }));
    clearTransientSelection();
  }

  function restartCurrentGame() {
    computerTurnRequestId.current += 1;
    cancelStockfishSearch();
    updateSession((current) =>
      createFreshSession({
        opponentMode: current.opponentMode,
        orientation: playerColor,
        soundEnabled: current.soundEnabled,
        startingTimeMs: timeControlMinutesToMs(timeControlMinutes),
      }),
    );
    setComputerNotice(null);
    setLastComputerSource(null);
    setIsComputerThinking(false);
    clearTransientSelection();
    setIsResultModalOpen(false);

    void playGameSound("reset", session.soundEnabled);
  }

  function returnToStartScreen() {
    computerTurnRequestId.current += 1;
    cancelStockfishSearch();
    setComputerNotice(null);
    setLastComputerSource(null);
    setIsComputerThinking(false);
    clearTransientSelection();
    setIsResultModalOpen(false);

    void playGameSound("reset", session.soundEnabled);
    onReturnToSetup();
  }

  function flipBoard() {
    updateSession((current) => ({
      ...current,
      orientation: current.orientation === "white" ? "black" : "white",
    }));
  }

  function toggleSound() {
    updateSession((current) => ({
      ...current,
      soundEnabled: !current.soundEnabled,
    }));
  }

  function handlePromotionChoice(piece: PromotionPiece) {
    if (!pendingPromotion) {
      return;
    }

    const selectedMove = pendingPromotion.moves.find((move) => move.promotion === piece);

    if (!selectedMove) {
      return;
    }

    commitMove(fen, toMoveInput(selectedMove));
  }

  function handleSquareClick(square: Square) {
    if (boardInputLocked) {
      return;
    }

    const destinationMoves = selectedSquare ? moveTargets.get(square) : undefined;

    if (selectedSquare && destinationMoves) {
      const promotionMoves = destinationMoves.filter((move) => move.promotion);

      if (promotionMoves.length > 0) {
        setPendingPromotion({
          moves: promotionMoves,
          to: square,
        });
        return;
      }

      commitMove(fen, toMoveInput(destinationMoves[0]));
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    const piece = game.get(square);

    if (!piece) {
      setSelectedSquare(null);
      return;
    }

    const pieceColor = piece.color === "w" ? "white" : "black";

    if (pieceColor !== gameStatus.turn) {
      setSelectedSquare(null);
      return;
    }

    setSelectedSquare(square);
  }

  function handleOpponentModeChange(mode: OpponentMode) {
    computerTurnRequestId.current += 1;
    cancelStockfishSearch();
    updateSession((current) => ({
      ...current,
      opponentMode: mode,
    }));
    setComputerNotice(null);
    setLastComputerSource(null);
    setIsComputerThinking(false);
    clearTransientSelection();
  }

  function cancelPromotion() {
    setPendingPromotion(null);
  }

  return (
    <>
      <main className="app-shell">
        <section className="hero-panel">
          <div className="hero-copy">
            <p className="eyebrow">Playable Chess Engine</p>
            <h1>Board state, clocks, move history, and game endings in one play surface.</h1>
            <p className="lede">
              The starter shell now carries the full game loop plus opponent modes for solo play:
              clocks tick with the active side, promotions resolve in a focused dialog, random and
              Stockfish-backed replies can take over either color, and board perspective, sound, and
              session recovery stay synchronized through the same engine timeline.
            </p>
          </div>

          <div className="hero-stats" aria-label="Game snapshot">
            <div className={`status-card phase-${gameStatus.phase}`}>
              <span className="status-pill">{gameStatus.phase}</span>
              <h2>{gameStatus.headline}</h2>
              <p>{statusDetail}</p>
            </div>

            <div className="metrics-card">
              <div className="metric">
                <span className="metric-label">Turn</span>
                <strong>{toTitleCase(gameStatus.turn)}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Opponent</span>
                <strong>{getOpponentModeLabel(session.opponentMode)}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Legal moves</span>
                <strong>{legalMoveCount}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Computer</span>
                <strong>{computerStatus}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Last move</span>
                <strong>{lastMove ? lastMove.san : "Opening position"}</strong>
              </div>
              <div className="metric">
                <span className="metric-label">Move count</span>
                <strong>{historyIndex}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="experience-grid">
          <div className="board-panel">
            <div className="board-toolbar">
              <div className="toolbar-copy">
                <p className="panel-label">Board</p>
                <p className="panel-caption">
                  {boardPerspective}. Click a piece to reveal legal moves. Undo and redo rebuild the
                  live board from the active move timeline, and the board locks while promotion is
                  awaiting your choice, while the computer is thinking, or after the game ends.
                </p>
              </div>

              <div className="toolbar-aside">
                <div className="opponent-control">
                  <div className="opponent-control-header">
                    <div>
                      <p className="panel-label">Opponent</p>
                      <p className="supporting-copy">
                        {activeOpponentOption.description}
                        {computerNotice ? ` ${computerNotice}` : ""}
                      </p>
                    </div>
                    <span
                      className={`engine-pill ${session.opponentMode === "stockfish" ? "stockfish" : ""}`}
                    >
                      {computerStatus}
                    </span>
                  </div>

                  <div className="mode-switch" role="group" aria-label="Opponent mode">
                    {OPPONENT_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`mode-button ${session.opponentMode === option.value ? "is-active" : ""}`}
                        aria-pressed={session.opponentMode === option.value}
                        onClick={() => handleOpponentModeChange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="toolbar-actions" aria-label="Game controls">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleUndo}
                    disabled={!canUndo}
                  >
                    Undo move
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRedo}
                    disabled={!canRedo}
                  >
                    Redo move
                  </button>
                  <button type="button" className="secondary-button" onClick={flipBoard}>
                    Flip board
                  </button>
                  <button
                    type="button"
                    className={`secondary-button toggle-button ${session.soundEnabled ? "is-active" : ""}`}
                    aria-pressed={session.soundEnabled}
                    onClick={toggleSound}
                  >
                    {session.soundEnabled ? "Sound on" : "Sound off"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button primary-action"
                    onClick={returnToStartScreen}
                  >
                    New Game
                  </button>
                </div>
              </div>
            </div>

            <div className="board-frame">
              {renderSideRack(captureRails.top)}

              <div className="board-grid" role="grid" aria-label="Interactive chess board">
                {boardCells.map((cell, index) => {
                  const targetMoves = moveTargets.get(cell.square) ?? [];
                  const isSelected = selectedSquare === cell.square;
                  const isLegalTarget = targetMoves.length > 0;
                  const isCaptureTarget = targetMoves.some((move) => move.isCapture);
                  const isPromotionTarget = targetMoves.some((move) => move.promotion);
                  const isLastMoveSquare =
                    lastMove?.from === cell.square || lastMove?.to === cell.square;
                  const isCheckedKing =
                    gameStatus.inCheck &&
                    cell.piece?.color === gameStatus.turn &&
                    cell.piece?.type === "king";
                  const squareLabel = [
                    `${cell.square}`,
                    cell.piece ? cell.piece.label : "empty square",
                    isSelected ? "selected" : null,
                    isLegalTarget ? "legal move target" : null,
                    isCheckedKing ? "king in check" : null,
                  ]
                    .filter(Boolean)
                    .join(", ");
                  const displayFileIndex = index % 8;
                  const displayRankIndex = Math.floor(index / 8);
                  const shouldShowRankLabel = displayFileIndex === 0;
                  const shouldShowFileLabel = displayRankIndex === 7;

                  return (
                    <button
                      key={cell.square}
                      type="button"
                      className={[
                        "board-square",
                        cell.isLight ? "light" : "dark",
                        isSelected ? "selected" : "",
                        isLegalTarget ? "target" : "",
                        isCaptureTarget ? "capture" : "",
                        isPromotionTarget ? "promotion" : "",
                        isLastMoveSquare ? "last-move" : "",
                        isCheckedKing ? "checked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-label={squareLabel}
                      disabled={boardInputLocked}
                      onClick={() => handleSquareClick(cell.square)}
                    >
                      {shouldShowRankLabel ? <span className="rank-label">{cell.rank}</span> : null}
                      {shouldShowFileLabel ? <span className="file-label">{cell.file}</span> : null}
                      {cell.piece ? (
                        <span className={`piece piece-${cell.piece.color}`}>
                          {cell.piece.glyph}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {renderSideRack(captureRails.bottom)}
            </div>
          </div>

          <aside className="inspector-panel">
            <div className="info-card">
              <p className="panel-label">Special Rules</p>
              <ul className="rule-list">
                {SPECIAL_RULES.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
            </div>

            <MoveHistoryPanel
              futureCount={futureCount}
              historyIndex={historyIndex}
              inCheck={gameStatus.inCheck}
              moves={moveLog}
              pgn={pgnPreview}
              timelineSummary={timelineSummary}
              turnLabel={toTitleCase(gameStatus.turn)}
            />
          </aside>
        </section>
      </main>

      <PawnPromotionDialog
        color={gameStatus.turn}
        isOpen={pendingPromotion !== null}
        onCancel={cancelPromotion}
        onChoose={handlePromotionChoice}
        square={pendingPromotion?.to ?? null}
      />

      <GameResultModal
        isOpen={isResultModalOpen}
        lastMove={lastMove}
        moveCount={historyIndex}
        onClose={() => setIsResultModalOpen(false)}
        onReset={restartCurrentGame}
        result={gameResult}
      />
    </>
  );
}

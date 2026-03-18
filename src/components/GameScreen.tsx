import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Square } from "chess.js";

import {
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
  type GameStatus,
  type MoveInput,
  type PlayerColor,
  type PromotionPiece,
  toMoveInput,
} from "../chess-engine";
import { formatClockTime, tickClock, type ClockState } from "../game-clock";
import { playGameSound, type GameSound } from "../game-sounds";
import { createFreshSession, type GameSession } from "../game-session";
import { timeControlMinutesToMs, type TimeControlMinutes } from "../game-setup";
import { buildGameTimelineSnapshot, gameTimelineReducer } from "../game-state";
import type { OnlineGameResult } from "../online-game";
import { cancelStockfishSearch, getStockfishBestMove } from "../stockfish-client";
import { GameClock } from "./GameClock";
import { GameResultModal, type ResultState } from "./GameResultModal";
import { MoveHistoryPanel } from "./MoveHistoryPanel";
import { PawnPromotionDialog } from "./PawnPromotionDialog";

type PromotionRequest = {
  moves: EngineMove[];
  to: Square;
};

type SessionUpdate = GameSession | ((current: GameSession) => GameSession);

type OnlineMovePayload = {
  clockState: ClockState;
  move: EngineMove;
  nextStatus: GameStatus;
};

type OnlineDisconnectBanner = {
  canClaimWin: boolean;
  countdownMs: number;
  isPending: boolean;
  onClaimWin: () => void;
  onKeepWaiting: () => void;
  opponentLabel: string;
};

type OnlineGameOptions = {
  actionError: string | null;
  completedResult: OnlineGameResult;
  connectionLabel: string;
  disconnectBanner: OnlineDisconnectBanner | null;
  onMove: (payload: OnlineMovePayload) => Promise<void>;
  opponentConnected: boolean;
  pauseClockOnOpponentTurn: boolean;
  playerLabels: Record<PlayerColor, string>;
  sessionCode: string;
};

type GameScreenProps = {
  onlineGame?: OnlineGameOptions;
  onReturnToSetup: () => void;
  onSessionChange: (update: SessionUpdate) => void;
  playerColor: PlayerColor;
  session: GameSession;
  timeControlMinutes: TimeControlMinutes;
};

function toTitleCase(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
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

function buildOnlineCompletionResult(
  completedResult: OnlineGameResult,
  playerColor: PlayerColor,
  playerLabels: Record<PlayerColor, string>,
): ResultState | null {
  if (completedResult === null) {
    return null;
  }

  if (completedResult === "abandoned") {
    return {
      detail: "Nobody returned to this online match for 24 hours, so it was closed as abandoned.",
      headline: "Match abandoned",
      phase: "abandoned",
      winner: null,
    };
  }

  if (completedResult === "draw" || completedResult === "stalemate") {
    return {
      detail:
        completedResult === "draw"
          ? "Both players agreed to a draw."
          : "Neither side has a legal move, so the game ends in stalemate.",
      headline: completedResult === "draw" ? "Draw" : "Stalemate",
      phase: completedResult === "draw" ? "draw" : "stalemate",
      winner: null,
    };
  }

  const losingColor = completedResult === "white" ? "black" : "white";
  const winningLabel = playerLabels[completedResult];
  const losingLabel = playerLabels[losingColor];

  return {
    detail:
      completedResult === playerColor
        ? `${losingLabel} stayed disconnected past the timer, so the match was awarded to you.`
        : `${winningLabel} claimed the win after ${losingLabel} stayed disconnected past the timer.`,
    headline:
      completedResult === playerColor
        ? "You win by disconnect"
        : `${winningLabel} wins by disconnect`,
    phase: "disconnect",
    winner: completedResult,
  };
}

export function GameScreen({
  onlineGame,
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
  const [onlineSyncError, setOnlineSyncError] = useState<string | null>(null);
  const [isOnlineMovePending, setIsOnlineMovePending] = useState(false);
  const computerTurnRequestId = useRef(0);
  const lastObservedOnlineMoveCount = useRef<number | null>(null);
  const updateSession = useEffectEvent((update: SessionUpdate) => {
    onSessionChange(update);
  });
  const isOnlineGame = onlineGame !== undefined;
  const computerColor: PlayerColor = playerColor === "white" ? "black" : "white";

  const {
    canRedo,
    canUndo,
    capturedPieces,
    fen,
    futureCount,
    game,
    historyIndex,
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
  const isLivePosition = futureCount === 0;
  const isComputerMode = isComputerOpponentMode(session.opponentMode);
  const isComputerTurn = isComputerMode && isLivePosition && gameStatus.turn === computerColor;
  const boardResult =
    gameStatus.phase === "checkmate" || gameStatus.phase === "stalemate"
      ? {
          detail: gameStatus.detail,
          headline: gameStatus.headline,
          phase: gameStatus.phase,
          winner: gameStatus.winner,
        }
      : null;
  const onlineCompletionResult =
    isOnlineGame && onlineGame
      ? buildOnlineCompletionResult(
          boardResult ? null : onlineGame.completedResult,
          playerColor,
          onlineGame.playerLabels,
        )
      : null;
  const gameResult = boardResult ?? onlineCompletionResult;
  const isGameOver = gameResult !== null;
  const pausedOnlineTurn =
    isOnlineGame &&
    onlineGame &&
    onlineGame.pauseClockOnOpponentTurn &&
    gameStatus.turn !== playerColor;
  const timelineSummary = isOnlineGame
    ? `${historyIndex} synced plies`
    : futureCount > 0
      ? `${historyIndex} active / ${totalMoves} recorded`
      : `${historyIndex} plies`;
  const pgnPreview = pgn || "No moves played yet. White has the first turn.";
  const statusDetail =
    pendingPromotion !== null
      ? `Choose a piece for ${pendingPromotion.to}.`
      : isOnlineMovePending
        ? "Syncing move…"
        : gameResult
          ? gameResult.detail
        : isOnlineGame
          ? gameStatus.turn === playerColor
            ? "Your move."
            : "Waiting for opponent move."
          : isComputerThinking
            ? `${toTitleCase(gameStatus.turn)} is thinking.`
            : null;
  const boardPerspective = getBoardPerspectiveLabel(session.orientation);
  const captureRails = getCaptureRailColors(session.orientation);
  const displayStatusHeadline = gameResult ? gameResult.headline : gameStatus.headline;
  const displayStatusPhase = gameResult ? gameResult.phase : gameStatus.phase;
  const activeOpponentOption =
    OPPONENT_MODE_OPTIONS.find((option) => option.value === session.opponentMode) ??
    OPPONENT_MODE_OPTIONS[0];
  const opponentSummaryLabel = isOnlineGame ? "Match" : "Opponent";
  const opponentSummaryValue = isOnlineGame ? onlineGame.sessionCode : activeOpponentOption.label;
  const computerStatus = getComputerStatusLabel(
    session.opponentMode,
    isComputerThinking,
    lastComputerSource,
    computerNotice,
  );
  const toolbarNotice = isOnlineGame
    ? onlineSyncError ?? onlineGame?.actionError ?? null
    : computerNotice;
  const boardInputLocked =
    isGameOver ||
    pendingPromotion !== null ||
    isComputerThinking ||
    isComputerTurn ||
    isOnlineMovePending ||
    (isOnlineGame && gameStatus.turn !== playerColor);

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
    if (!isOnlineGame) {
      setOnlineSyncError(null);
      setIsOnlineMovePending(false);
      lastObservedOnlineMoveCount.current = null;
      return;
    }

    if (lastObservedOnlineMoveCount.current === null) {
      lastObservedOnlineMoveCount.current = historyIndex;
      return;
    }

    if (historyIndex > lastObservedOnlineMoveCount.current) {
      const syncedMove = moveLog.at(-1);

      if (syncedMove) {
        void playGameSound(
          getMoveSound(syncedMove, gameStatus.phase, gameStatus.inCheck),
          session.soundEnabled,
        );
      }
    }

    lastObservedOnlineMoveCount.current = historyIndex;
  }, [
    gameStatus.inCheck,
    gameStatus.phase,
    historyIndex,
    isOnlineGame,
    moveLog,
    session.soundEnabled,
  ]);

  useEffect(() => {
    if (!isOnlineGame) {
      return;
    }

    setOnlineSyncError(null);
  }, [historyIndex, isOnlineGame]);

  useEffect(() => {
    if (isGameOver) {
      setIsResultModalOpen(true);
      return;
    }

    setIsResultModalOpen(false);
  }, [historyIndex, isGameOver, gameStatus.phase]);

  useEffect(() => {
    if (isGameOver || pausedOnlineTurn) {
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
  }, [gameStatus.turn, isGameOver, pausedOnlineTurn]);

  const commitMove = useEffectEvent(async (sourceFen: string, move: MoveInput) => {
    const nextGame = createGame(sourceFen);
    const executed = applyMove(nextGame, move);
    const nextStatus = getGameStatus(nextGame);

    if (isOnlineGame && onlineGame) {
      clearTransientSelection();
      setIsOnlineMovePending(true);
      setOnlineSyncError(null);

      try {
        await onlineGame.onMove({
          clockState: session.clockState,
          move: executed,
          nextStatus,
        });
      } catch {
        setOnlineSyncError("Move sync failed. Wait for the connection to recover and try again.");
      } finally {
        setIsOnlineMovePending(false);
      }

      return;
    }

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
    const isPaused = pausedOnlineTurn && gameStatus.turn === color;
    const label = isOnlineGame && onlineGame ? onlineGame.playerLabels[color] : toTitleCase(color);

    return (
      <div className="side-rack">
        <div className="side-rack-copy">
          <span className="side-rack-player">{label}</span>
          <span className="side-rack-caption">{getCaptureCaption(color)}</span>
        </div>
        <GameClock
          isActive={!isPaused && !isGameOver && gameStatus.turn === color}
          isGameOver={isGameOver}
          isInCheck={!isGameOver && gameStatus.turn === color && gameStatus.inCheck}
          isPaused={isPaused}
          label={label}
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
    if (isOnlineGame) {
      returnToStartScreen();
      return;
    }

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
        <section className="experience-grid">
          <div className="board-panel">
            <div className={`game-status-strip phase-${displayStatusPhase}`}>
              <div className="status-strip-primary">
                <span className="status-pill">{displayStatusPhase}</span>
                <div className="status-strip-copy">
                  <strong className="status-strip-headline">{displayStatusHeadline}</strong>
                  {statusDetail ? (
                    <span className="status-strip-detail">{statusDetail}</span>
                  ) : null}
                </div>
              </div>

              <div className="status-strip-metrics" aria-label="Game snapshot">
                <span className="status-chip">
                  <span className="status-chip-label">Turn</span>
                  <strong>{toTitleCase(gameStatus.turn)}</strong>
                </span>
                <span className="status-chip">
                  <span className="status-chip-label">Move count</span>
                  <strong>{historyIndex}</strong>
                </span>
                <span className="status-chip">
                  <span className="status-chip-label">{opponentSummaryLabel}</span>
                  <strong>{opponentSummaryValue}</strong>
                </span>
              </div>
            </div>

            <div className="board-toolbar">
              <div className="toolbar-meta">
                {isOnlineGame ? (
                  <div className="toolbar-context">
                    <span className="toolbar-note">{boardPerspective}</span>
                    <span className="toolbar-note">{onlineGame.playerLabels[playerColor]}</span>
                    <span className="toolbar-note">
                      Rival {onlineGame.playerLabels[playerColor === "white" ? "black" : "white"]}
                    </span>
                    <span className="toolbar-note">Session {onlineGame.sessionCode}</span>
                    <span className="toolbar-note">{onlineGame.connectionLabel}</span>
                    <span
                      className={`toolbar-note presence-note ${onlineGame.opponentConnected ? "is-online" : "is-offline"}`}
                    >
                      {onlineGame.opponentConnected ? "Opponent connected" : "Opponent disconnected"}
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="compact-field">
                      <span className="compact-label">Opponent</span>
                      <select
                        aria-label="Opponent mode"
                        className="toolbar-select"
                        onChange={(event) =>
                          handleOpponentModeChange(event.target.value as OpponentMode)
                        }
                        value={session.opponentMode}
                      >
                        {OPPONENT_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="toolbar-context">
                      <span className="toolbar-note">{boardPerspective}</span>
                      <span className="toolbar-note">{computerStatus}</span>
                    </div>
                  </>
                )}

                {toolbarNotice ? <p className="toolbar-notice">{toolbarNotice}</p> : null}
              </div>

              <div className="toolbar-actions" aria-label="Game controls">
                {!isOnlineGame ? (
                  <>
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
                  </>
                ) : null}
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

            {isOnlineGame && onlineGame.disconnectBanner ? (
              <div
                className={`disconnect-banner ${onlineGame.disconnectBanner.canClaimWin ? "is-expired" : ""}`}
                aria-live="polite"
                role="status"
              >
                <div className="disconnect-banner-copy">
                  <span className="disconnect-banner-kicker">Connection</span>
                  <strong>{onlineGame.disconnectBanner.opponentLabel} disconnected</strong>
                  <span>
                    {onlineGame.disconnectBanner.canClaimWin
                      ? "The timer expired. Claim the win or keep waiting for a reconnect."
                      : `Waiting ${formatClockTime(onlineGame.disconnectBanner.countdownMs)} for them to return.`}
                  </span>
                </div>

                <div className="disconnect-banner-actions">
                  {onlineGame.disconnectBanner.canClaimWin ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button primary-action"
                        disabled={onlineGame.disconnectBanner.isPending}
                        onClick={onlineGame.disconnectBanner.onClaimWin}
                      >
                        {onlineGame.disconnectBanner.isPending ? "Working..." : "Claim win"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={onlineGame.disconnectBanner.isPending}
                        onClick={onlineGame.disconnectBanner.onKeepWaiting}
                      >
                        Keep waiting
                      </button>
                    </>
                  ) : (
                    <span className="disconnect-banner-chip">
                      {formatClockTime(onlineGame.disconnectBanner.countdownMs)} left
                    </span>
                  )}
                </div>
              </div>
            ) : null}

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

          <aside className="inspector-panel move-history-sidebar">
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
        onReset={isOnlineGame ? returnToStartScreen : restartCurrentGame}
        result={gameResult}
      />
    </>
  );
}

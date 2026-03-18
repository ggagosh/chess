import { useEffect, useEffectEvent, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";

import {
  isComputerOpponentMode,
  OPPONENT_MODE_OPTIONS,
  resolveComputerMove,
  type ComputerMoveSource,
  type OpponentMode,
} from "../computer-opponent";
import {
  applyMove,
  type BoardPiece,
  createGame,
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

const MATERIAL_VALUES: Record<BoardPiece["type"], number> = {
  bishop: 3,
  king: 0,
  knight: 3,
  pawn: 1,
  queen: 9,
  rook: 5,
};

function toTitleCase(value: string) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function getBoardPerspectiveLabel(orientation: PlayerColor) {
  return `${toTitleCase(orientation)} at bottom`;
}

function getCapturedByPlayerCaption(color: PlayerColor) {
  return color === "white" ? "Black pieces captured" : "White pieces captured";
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

function ensureSquareStyle(styles: Record<string, CSSProperties>, square: Square): CSSProperties {
  styles[square] ??= {};

  return styles[square];
}

function appendBoxShadow(style: CSSProperties, boxShadow: string) {
  style.boxShadow = style.boxShadow ? `${style.boxShadow}, ${boxShadow}` : boxShadow;
}

function appendBackgroundLayer(style: CSSProperties, layer: string) {
  style.backgroundImage = style.backgroundImage ? `${layer}, ${style.backgroundImage}` : layer;
}

function getCheckedKingSquare(
  game: ReturnType<typeof createGame>,
  color: PlayerColor,
): Square | null {
  const files = "abcdefgh";
  const targetColor = color === "white" ? "w" : "b";

  for (const [rowIndex, row] of game.board().entries()) {
    for (const [columnIndex, piece] of row.entries()) {
      if (piece?.type !== "k" || piece.color !== targetColor) {
        continue;
      }

      return `${files[columnIndex]}${8 - rowIndex}` as Square;
    }
  }

  return null;
}

function getMaterialScore(pieces: BoardPiece[]) {
  return pieces.reduce((total, piece) => total + MATERIAL_VALUES[piece.type], 0);
}

function getMaterialAdvantageLabel(
  capturedPieces: ReturnType<typeof buildGameTimelineSnapshot>["capturedPieces"],
  player: PlayerColor,
) {
  const playerScore =
    player === "white"
      ? getMaterialScore(capturedPieces.black)
      : getMaterialScore(capturedPieces.white);
  const opponentScore =
    player === "white"
      ? getMaterialScore(capturedPieces.white)
      : getMaterialScore(capturedPieces.black);
  const advantage = playerScore - opponentScore;

  return advantage > 0 ? `+${advantage}` : null;
}

function getPlayerMoveActorLabel(
  moveColor: PlayerColor,
  {
    isComputerMode,
    isOnlineGame,
    playerColor,
  }: { isComputerMode: boolean; isOnlineGame: boolean; playerColor: PlayerColor },
) {
  if (isOnlineGame || isComputerMode) {
    return moveColor === playerColor ? "You" : "Opponent";
  }

  return toTitleCase(moveColor);
}

function buildMoveAnnouncement(
  move: EngineMove,
  gameStatus: GameStatus,
  options: { isComputerMode: boolean; isOnlineGame: boolean; playerColor: PlayerColor },
) {
  const actor = getPlayerMoveActorLabel(move.color, options);

  if (gameStatus.phase === "checkmate") {
    return `${actor} played ${move.san}, checkmate.`;
  }

  if (gameStatus.inCheck) {
    return `${actor} played ${move.san}, check.`;
  }

  return `${actor} played ${move.san}.`;
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
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const moveAnnouncementHistoryIndex = useRef<number | null>(null);
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
  const recordedMoveLog = useMemo(() => {
    const recordedGame = createGame();

    return session.timeline.moves.map((move) => applyMove(recordedGame, move));
  }, [session.timeline.moves]);
  const checkedKingSquare = useMemo(
    () => (gameStatus.inCheck ? getCheckedKingSquare(game, gameStatus.turn) : null),
    [game, gameStatus.inCheck, gameStatus.turn],
  );
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
  const displayStatusHeadline = gameResult ? gameResult.headline : gameStatus.headline;
  const displayStatusPhase = gameResult ? gameResult.phase : gameStatus.phase;
  const activeOpponentOption =
    OPPONENT_MODE_OPTIONS.find((option) => option.value === session.opponentMode) ??
    OPPONENT_MODE_OPTIONS[0];
  const computerStatus = getComputerStatusLabel(
    session.opponentMode,
    isComputerThinking,
    lastComputerSource,
    computerNotice,
  );
  const toolbarNotice = isOnlineGame
    ? (onlineSyncError ?? onlineGame?.actionError ?? null)
    : computerNotice;
  const boardInputLocked =
    isGameOver ||
    pendingPromotion !== null ||
    isComputerThinking ||
    isComputerTurn ||
    isOnlineMovePending ||
    (isOnlineGame && gameStatus.turn !== playerColor);
  const playerLabels = isOnlineGame
    ? onlineGame.playerLabels
    : {
        black: "Black",
        white: "White",
      };
  const topPlayerColor: PlayerColor = session.orientation === "white" ? "black" : "white";
  const bottomPlayerColor: PlayerColor = session.orientation === "white" ? "white" : "black";
  const turnStatusLabel = gameResult
    ? displayStatusHeadline
    : isOnlineGame
      ? gameStatus.turn === playerColor
        ? "Your turn"
        : "Opponent's turn"
      : isComputerMode
        ? gameStatus.turn === playerColor
          ? "Your turn"
          : "Opponent's turn"
        : `${toTitleCase(gameStatus.turn)} to move`;
  const turnStatusMeta =
    isOnlineGame && !gameResult
      ? `${playerLabels[gameStatus.turn]} is on move`
      : (statusDetail ?? boardPerspective);
  const boardSquareStyles = useMemo<Record<string, CSSProperties>>(() => {
    const styles: Record<string, CSSProperties> = {};

    if (lastMove) {
      appendBoxShadow(
        ensureSquareStyle(styles, lastMove.from),
        "inset 0 0 0 999px rgba(244, 196, 94, 0.18)",
      );
      appendBoxShadow(
        ensureSquareStyle(styles, lastMove.to),
        "inset 0 0 0 999px rgba(244, 196, 94, 0.34)",
      );
    }

    if (checkedKingSquare) {
      const checkedStyle = ensureSquareStyle(styles, checkedKingSquare);
      appendBoxShadow(checkedStyle, "inset 0 0 0 999px rgba(203, 45, 45, 0.28)");
      appendBoxShadow(checkedStyle, "inset 0 0 0 3px rgba(203, 45, 45, 0.94)");
    }

    if (selectedSquare) {
      const selectedStyle = ensureSquareStyle(styles, selectedSquare);
      appendBoxShadow(selectedStyle, "inset 0 0 0 3px rgba(56, 153, 228, 0.96)");
      appendBackgroundLayer(
        selectedStyle,
        "linear-gradient(0deg, rgba(67, 189, 255, 0.16), rgba(67, 189, 255, 0.16))",
      );
    }

    for (const [square, targetMoves] of moveTargets.entries()) {
      const targetStyle = ensureSquareStyle(styles, square);

      if (targetMoves.some((move) => move.isCapture)) {
        appendBoxShadow(targetStyle, "inset 0 0 0 5px rgba(126, 35, 35, 0.72)");
        appendBackgroundLayer(
          targetStyle,
          "linear-gradient(0deg, rgba(203, 68, 56, 0.12), rgba(203, 68, 56, 0.12))",
        );
        continue;
      }

      appendBackgroundLayer(
        targetStyle,
        "radial-gradient(circle, rgba(30, 24, 18, 0.42) 0 16%, transparent 17% 100%)",
      );
    }

    return styles;
  }, [checkedKingSquare, lastMove, moveTargets, selectedSquare]);

  useEffect(() => {
    const previousHistoryIndex = moveAnnouncementHistoryIndex.current;

    moveAnnouncementHistoryIndex.current = historyIndex;

    if (previousHistoryIndex === null || historyIndex === previousHistoryIndex) {
      return;
    }

    if (historyIndex < previousHistoryIndex) {
      setLiveAnnouncement(
        historyIndex === 0
          ? "Returned to the starting position."
          : `Move taken back. ${displayStatusHeadline}.`,
      );
      return;
    }

    const announcedMove = recordedMoveLog[historyIndex - 1];

    if (!announcedMove) {
      return;
    }

    setLiveAnnouncement(
      buildMoveAnnouncement(announcedMove, gameStatus, {
        isComputerMode,
        isOnlineGame,
        playerColor,
      }),
    );
  }, [
    displayStatusHeadline,
    gameStatus,
    historyIndex,
    isComputerMode,
    isOnlineGame,
    playerColor,
    recordedMoveLog,
  ]);

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

  function renderPlayerBanner(color: PlayerColor) {
    const capturedByPlayer = color === "white" ? capturedPieces.black : capturedPieces.white;
    const isPaused = pausedOnlineTurn && gameStatus.turn === color;
    const label = playerLabels[color];
    const materialAdvantage = getMaterialAdvantageLabel(capturedPieces, color);
    const isActiveTurn = !isPaused && !isGameOver && gameStatus.turn === color;

    return (
      <div
        className={[
          "player-banner",
          `player-${color}`,
          isActiveTurn ? "active" : "",
          color === playerColor ? "is-self" : "is-opponent",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="player-banner-copy">
          <div className="player-banner-heading">
            <span className="player-banner-name">{label}</span>
            {materialAdvantage ? (
              <span
                className="material-advantage"
                aria-label={`${label} is ahead by ${materialAdvantage.replace("+", "")} points`}
              >
                {materialAdvantage}
              </span>
            ) : null}
          </div>
          <span className="player-banner-caption">
            {isActiveTurn
              ? color === playerColor && (isOnlineGame || isComputerMode)
                ? "On move"
                : "To move"
              : getCapturedByPlayerCaption(color)}
          </span>
          <div className="captured-strip" aria-label={getCapturedByPlayerCaption(color)}>
            {capturedByPlayer.length > 0 ? (
              capturedByPlayer.map((piece, index) => (
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
              <span className="captured-empty">No captures</span>
            )}
          </div>
        </div>
        <GameClock
          isActive={isActiveTurn}
          isGameOver={isGameOver}
          isInCheck={isActiveTurn && gameStatus.inCheck}
          isPaused={isPaused}
          label={label}
          player={color}
          timeRemainingMs={clockState[color]}
        />
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

  function handleBoardSquareClick(square: Square) {
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

  function handlePieceDrop(sourceSquare: Square, targetSquare: Square | null) {
    if (!targetSquare || boardInputLocked) {
      return false;
    }

    const destinationMoves = getLegalMoves(game, sourceSquare).filter(
      (move) => move.to === targetSquare,
    );

    if (destinationMoves.length === 0) {
      return false;
    }

    const promotionMoves = destinationMoves.filter((move) => move.promotion);

    if (promotionMoves.length > 0) {
      setSelectedSquare(null);
      setPendingPromotion({
        moves: promotionMoves,
        to: targetSquare,
      });
      return false;
    }

    commitMove(fen, toMoveInput(destinationMoves[0]));
    return true;
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
      <main className="app-shell game-shell">
        <section className="game-layout">
          <section className="game-board-panel">
            <div className="game-stage-shell">
              <div className="game-focus-panel">
                {renderPlayerBanner(topPlayerColor)}

                <div className="board-center">
                  <div className="board-frame">
                    <Chessboard
                      options={{
                        id: "game-board",
                        position: fen,
                        boardOrientation: session.orientation,
                        allowAutoScroll: false,
                        allowDragging: !boardInputLocked,
                        allowDrawingArrows: false,
                        animationDurationInMs: 180,
                        boardStyle: {
                          borderRadius: "28px",
                          boxShadow: "0 28px 56px rgba(29, 20, 12, 0.22)",
                          overflow: "hidden",
                        },
                        squareStyle: {
                          boxSizing: "border-box",
                        },
                        squareStyles: boardSquareStyles,
                        darkSquareStyle: {
                          backgroundColor: "#7b9577",
                        },
                        lightSquareStyle: {
                          backgroundColor: "#ead4a7",
                        },
                        darkSquareNotationStyle: {
                          color: "rgba(26, 20, 13, 0.58)",
                        },
                        lightSquareNotationStyle: {
                          color: "rgba(26, 20, 13, 0.72)",
                        },
                        alphaNotationStyle: {
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        },
                        numericNotationStyle: {
                          fontSize: "0.72rem",
                          fontWeight: 700,
                        },
                        canDragPiece: ({ square }) => {
                          if (!square || boardInputLocked) {
                            return false;
                          }

                          const piece = game.get(square as Square);

                          if (!piece) {
                            return false;
                          }

                          return (piece.color === "w" ? "white" : "black") === gameStatus.turn;
                        },
                        onPieceDrop: ({ sourceSquare, targetSquare }) =>
                          handlePieceDrop(sourceSquare as Square, targetSquare as Square | null),
                        onSquareClick: ({ square }) => handleBoardSquareClick(square as Square),
                      }}
                    />
                  </div>
                </div>

                <div className="board-footer">
                  {renderPlayerBanner(bottomPlayerColor)}
                  <p id="board-help" className="board-help">
                    Drag a piece or tap a square to select it, then commit a highlighted move.
                  </p>
                </div>
              </div>
            </div>

            <aside className="game-side-rail">
              <header className="game-toolbar" aria-label="Game status and controls">
                <div className="toolbar-primary">
                  <div className="toolbar-status-stack">
                    <div
                      className={[
                        "turn-indicator",
                        `phase-${displayStatusPhase}`,
                        gameStatus.turn === playerColor ? "is-player-turn" : "is-opponent-turn",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <span className="turn-indicator-dot" aria-hidden="true" />
                      <div className="turn-indicator-copy">
                        <span className="turn-indicator-kicker">Turn</span>
                        <strong>{turnStatusLabel}</strong>
                        <span>{turnStatusMeta}</span>
                      </div>
                    </div>

                    <div className="toolbar-summary" aria-label="Game snapshot">
                      <span className="toolbar-chip">{displayStatusPhase}</span>
                      <span className="toolbar-chip">Move {historyIndex}</span>
                      <span className="toolbar-chip">
                        {isOnlineGame
                          ? `Session ${onlineGame.sessionCode}`
                          : activeOpponentOption.label}
                      </span>
                      {futureCount > 0 ? (
                        <span className="toolbar-chip">
                          {futureCount} future {futureCount === 1 ? "move" : "moves"}
                        </span>
                      ) : null}
                    </div>
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
                          Undo
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={handleRedo}
                          disabled={!canRedo}
                        >
                          Redo
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="secondary-button" onClick={flipBoard}>
                      Flip
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

                <div className="toolbar-secondary">
                  <div className="toolbar-meta">
                    {isOnlineGame ? (
                      <div className="toolbar-context">
                        <span className="toolbar-note">{boardPerspective}</span>
                        <span className="toolbar-note">{onlineGame.connectionLabel}</span>
                        <span
                          className={`toolbar-note presence-note ${onlineGame.opponentConnected ? "is-online" : "is-offline"}`}
                        >
                          {onlineGame.opponentConnected
                            ? "Opponent connected"
                            : "Opponent disconnected"}
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
                          <span
                            className={`toolbar-note ${isComputerMode ? "presence-note is-online" : ""}`}
                          >
                            {computerStatus}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {toolbarNotice ? <p className="toolbar-notice">{toolbarNotice}</p> : null}
              </header>

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

              <section className="game-secondary-panel">
                <MoveHistoryPanel
                  futureCount={futureCount}
                  historyIndex={historyIndex}
                  inCheck={gameStatus.inCheck}
                  moves={moveLog}
                  pgn={pgnPreview}
                  timelineSummary={timelineSummary}
                  turnLabel={toTitleCase(gameStatus.turn)}
                />
              </section>
            </aside>
          </section>

          <p className="sr-only" aria-live="polite" role="status">
            {liveAnnouncement}
          </p>
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

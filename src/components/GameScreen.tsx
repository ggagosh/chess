import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
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
  type BoardPiece,
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

type MoveAnimationState = {
  destinationSquare: Square;
  deltaX: number;
  deltaY: number;
  id: number;
  isSettled: boolean;
  piece: BoardPiece;
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

function getInitialFocusedSquare(orientation: PlayerColor): Square {
  return orientation === "white" ? "e2" : "e7";
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
  const [focusedSquare, setFocusedSquare] = useState<Square>(() =>
    getInitialFocusedSquare(session.orientation),
  );
  const [pendingPromotion, setPendingPromotion] = useState<PromotionRequest | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [computerNotice, setComputerNotice] = useState<string | null>(null);
  const [lastComputerSource, setLastComputerSource] = useState<ComputerMoveSource | null>(null);
  const [isComputerThinking, setIsComputerThinking] = useState(false);
  const [onlineSyncError, setOnlineSyncError] = useState<string | null>(null);
  const [isOnlineMovePending, setIsOnlineMovePending] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [boardSize, setBoardSize] = useState(0);
  const [moveAnimation, setMoveAnimation] = useState<MoveAnimationState | null>(null);
  const boardGridRef = useRef<HTMLDivElement | null>(null);
  const squareRefs = useRef(new Map<Square, HTMLButtonElement | null>());
  const moveAnnouncementHistoryIndex = useRef<number | null>(null);
  const moveAnimationHistoryIndex = useRef<number | null>(null);
  const moveAnimationFrameRef = useRef<number | null>(null);
  const moveAnimationSerial = useRef(0);
  const moveAnimationTimeoutRef = useRef<number | null>(null);
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
  const recordedMoveLog = useMemo(() => {
    const recordedGame = createGame();

    return session.timeline.moves.map((move) => applyMove(recordedGame, move));
  }, [session.timeline.moves]);
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
  const boardPositions = useMemo(() => {
    const positions = new Map<Square, { col: number; row: number }>();

    boardCells.forEach((cell, index) => {
      positions.set(cell.square, {
        col: index % 8,
        row: Math.floor(index / 8),
      });
    });

    return positions;
  }, [boardCells]);

  useEffect(() => {
    if (!boardPositions.has(focusedSquare)) {
      setFocusedSquare(getInitialFocusedSquare(session.orientation));
    }
  }, [boardPositions, focusedSquare, session.orientation]);

  useLayoutEffect(() => {
    const boardGrid = boardGridRef.current;

    if (!boardGrid) {
      return;
    }

    const updateBoardSize = () => {
      const { width } = boardGrid.getBoundingClientRect();
      setBoardSize(Math.max(0, Math.floor(width)));
    };

    updateBoardSize();

    const observer = new ResizeObserver(() => {
      updateBoardSize();
    });

    observer.observe(boardGrid);

    return () => {
      observer.disconnect();
    };
  }, []);

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
    const previousHistoryIndex = moveAnimationHistoryIndex.current;

    moveAnimationHistoryIndex.current = historyIndex;

    if (previousHistoryIndex === null || historyIndex === previousHistoryIndex || boardSize === 0) {
      return;
    }

    if (moveAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(moveAnimationFrameRef.current);
    }

    if (moveAnimationTimeoutRef.current !== null) {
      window.clearTimeout(moveAnimationTimeoutRef.current);
    }

    const animatedMove =
      historyIndex > previousHistoryIndex
        ? recordedMoveLog[historyIndex - 1]
        : recordedMoveLog[historyIndex];

    if (!animatedMove) {
      setMoveAnimation(null);
      return;
    }

    const startSquare = historyIndex > previousHistoryIndex ? animatedMove.from : animatedMove.to;
    const destinationSquare =
      historyIndex > previousHistoryIndex ? animatedMove.to : animatedMove.from;
    const startPosition = boardPositions.get(startSquare);
    const destinationPosition = boardPositions.get(destinationSquare);
    const destinationPiece =
      boardCells.find((cell) => cell.square === destinationSquare)?.piece ??
      boardCells.find((cell) => cell.square === startSquare)?.piece;

    if (!startPosition || !destinationPosition || !destinationPiece) {
      setMoveAnimation(null);
      return;
    }

    const squareSize = boardSize / 8;

    moveAnimationSerial.current += 1;

    const animationId = moveAnimationSerial.current;

    setMoveAnimation({
      destinationSquare,
      deltaX: (startPosition.col - destinationPosition.col) * squareSize,
      deltaY: (startPosition.row - destinationPosition.row) * squareSize,
      id: animationId,
      isSettled: false,
      piece: destinationPiece,
    });

    moveAnimationFrameRef.current = window.requestAnimationFrame(() => {
      setMoveAnimation((current) =>
        current && current.id === animationId
          ? {
              ...current,
              isSettled: true,
            }
          : current,
      );
    });

    moveAnimationTimeoutRef.current = window.setTimeout(() => {
      setMoveAnimation((current) => (current && current.id === animationId ? null : current));
    }, 260);

    return () => {
      if (moveAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(moveAnimationFrameRef.current);
        moveAnimationFrameRef.current = null;
      }

      if (moveAnimationTimeoutRef.current !== null) {
        window.clearTimeout(moveAnimationTimeoutRef.current);
        moveAnimationTimeoutRef.current = null;
      }
    };
  }, [boardCells, boardPositions, boardSize, historyIndex, recordedMoveLog]);

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

  function focusSquareButton(square: Square) {
    const button =
      squareRefs.current.get(square) ??
      document.querySelector<HTMLButtonElement>(`button[data-square="${square}"]`);

    if (!button) {
      return;
    }

    setFocusedSquare(square);
    button.focus();
  }

  function registerSquareRef(square: Square, node: HTMLButtonElement | null) {
    squareRefs.current.set(square, node);
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLButtonElement>, square: Square) {
    const currentPosition = boardPositions.get(square);

    if (!currentPosition) {
      return;
    }

    const movement =
      event.key === "ArrowUp"
        ? { col: 0, row: -1 }
        : event.key === "ArrowDown"
          ? { col: 0, row: 1 }
          : event.key === "ArrowLeft"
            ? { col: -1, row: 0 }
            : event.key === "ArrowRight"
              ? { col: 1, row: 0 }
              : null;

    if (!movement) {
      return;
    }

    event.preventDefault();

    const nextCol = Math.min(7, Math.max(0, currentPosition.col + movement.col));
    const nextRow = Math.min(7, Math.max(0, currentPosition.row + movement.row));
    const nextSquare = boardCells[nextRow * 8 + nextCol]?.square;

    if (!nextSquare) {
      return;
    }

    focusSquareButton(nextSquare);
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

  function handleSquareClick(square: Square) {
    setFocusedSquare(square);

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

  const boardShellStyle =
    boardSize > 0
      ? ({
          "--board-grid-size": `${boardSize}px`,
        } as CSSProperties)
      : undefined;
  const moveAnimationStyle =
    moveAnimation && boardSize > 0
      ? ({
          "--move-start-x": `${moveAnimation.deltaX}px`,
          "--move-start-y": `${moveAnimation.deltaY}px`,
        } as CSSProperties)
      : undefined;

  return (
    <>
      <main className="app-shell game-shell">
        <section className="game-layout">
          <section className="board-panel game-board-panel">
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

            <div className="game-focus-panel">
              {renderPlayerBanner(topPlayerColor)}

              <div className="board-center">
                <div className="board-frame">
                  <div className="board-shell" style={boardShellStyle}>
                    <div
                      ref={boardGridRef}
                      className="board-grid"
                      role="grid"
                      aria-describedby="board-help"
                      aria-label="Interactive chess board"
                    >
                    {boardCells.map((cell, index) => {
                      const targetMoves = moveTargets.get(cell.square) ?? [];
                      const isSelected = selectedSquare === cell.square;
                      const isLegalTarget = targetMoves.length > 0;
                      const isCaptureTarget = targetMoves.some((move) => move.isCapture);
                      const isPromotionTarget = targetMoves.some((move) => move.promotion);
                      const isLastMoveFrom = lastMove?.from === cell.square;
                      const isLastMoveTo = lastMove?.to === cell.square;
                      const isCheckedKing =
                        gameStatus.inCheck &&
                        cell.piece?.color === gameStatus.turn &&
                        cell.piece?.type === "king";
                      const isArrivalSquare = moveAnimation?.destinationSquare === cell.square;
                      const squareLabel = [
                        `${cell.square}`,
                        cell.piece ? cell.piece.label : "empty square",
                        isSelected ? "selected" : null,
                        isLegalTarget ? "legal move target" : null,
                        isCaptureTarget ? "capture target" : null,
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
                          ref={(node) => registerSquareRef(cell.square, node)}
                          type="button"
                          className={[
                            "board-square",
                            cell.isLight ? "light" : "dark",
                            isSelected ? "selected" : "",
                            isLastMoveFrom ? "last-move-origin" : "",
                            isLastMoveTo ? "last-move-destination" : "",
                            isCheckedKing ? "checked" : "",
                            isArrivalSquare ? "arrival-flash" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          data-square={cell.square}
                          aria-disabled={boardInputLocked}
                          aria-label={squareLabel}
                          onClick={() => handleSquareClick(cell.square)}
                          onFocus={() => setFocusedSquare(cell.square)}
                          onKeyDown={(event) => handleBoardKeyDown(event, cell.square)}
                          tabIndex={focusedSquare === cell.square ? 0 : -1}
                        >
                          {shouldShowRankLabel ? (
                            <span className="rank-label">{cell.rank}</span>
                          ) : null}
                          {shouldShowFileLabel ? (
                            <span className="file-label">{cell.file}</span>
                          ) : null}
                          {isLastMoveFrom ? (
                            <span
                              className="square-overlay last-origin-overlay"
                              aria-hidden="true"
                            />
                          ) : null}
                          {isLastMoveTo ? (
                            <span
                              className="square-overlay last-destination-overlay"
                              aria-hidden="true"
                            />
                          ) : null}
                          {isSelected ? (
                            <span className="square-overlay selection-overlay" aria-hidden="true" />
                          ) : null}
                          {isCheckedKing ? (
                            <span className="square-overlay check-overlay" aria-hidden="true" />
                          ) : null}
                          {isArrivalSquare ? (
                            <span className="square-overlay arrival-overlay" aria-hidden="true" />
                          ) : null}
                          {isLegalTarget ? (
                            <span
                              className={[
                                "square-indicator",
                                isCaptureTarget ? "capture-indicator" : "move-indicator",
                              ]
                                .filter(Boolean)
                                .join(" ")}
                              aria-hidden="true"
                            />
                          ) : null}
                          {isPromotionTarget ? (
                            <span className="promotion-badge" aria-hidden="true">
                              Promote
                            </span>
                          ) : null}
                          {cell.piece && !isArrivalSquare ? (
                            <span className={`piece piece-${cell.piece.color}`}>
                              {cell.piece.glyph}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}

                      {moveAnimation ? (
                        <div className="move-animation-layer" aria-hidden="true">
                          <span
                            className={[
                              "piece",
                              `piece-${moveAnimation.piece.color}`,
                              "moving-piece",
                              moveAnimation.isSettled ? "is-settled" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              ...moveAnimationStyle,
                              left: `${(boardPositions.get(moveAnimation.destinationSquare)?.col ?? 0) * (boardSize / 8)}px`,
                              top: `${(boardPositions.get(moveAnimation.destinationSquare)?.row ?? 0) * (boardSize / 8)}px`,
                            }}
                          >
                            {moveAnimation.piece.glyph}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="board-footer">
                {renderPlayerBanner(bottomPlayerColor)}
                <p id="board-help" className="board-help">
                  Use arrow keys to move square focus. Press Enter or Space to select a piece and
                  commit a highlighted legal move.
                </p>
              </div>
            </div>

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

            <p className="sr-only" aria-live="polite" role="status">
              {liveAnnouncement}
            </p>
          </section>
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

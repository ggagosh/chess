import { id } from "@instantdb/react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import "./App.css";
import {
  createGameSessionFromSettings,
  loadAppSession,
  persistAppSession,
  type AppSessionState,
} from "./app-session";
import { GameScreen } from "./components/GameScreen";
import { OnlineWaitingScreen } from "./components/OnlineWaitingScreen";
import { StartScreen } from "./components/StartScreen";
import type { GameStatus } from "./chess-engine";
import type { ClockState } from "./game-clock";
import type { GameSession } from "./game-session";
import { timeControlMinutesToMs } from "./game-setup";
import { instantDb } from "./instant-db";
import {
  buildOnlineGameSession,
  canJoinOnlineGame,
  createOnlineGamePayload,
  createSessionCode,
  loadOnlineSession,
  loadOrCreateOnlinePlayerId,
  normalizeSessionCode,
  persistOnlineSession,
  resolveOnlinePlayerColor,
  selectOnlineGameByCode,
  type OnlineGameResult,
  type OnlineSessionReference,
} from "./online-game";

type SessionUpdate = GameSession | ((current: GameSession) => GameSession);
type PendingOnlineAction = "create" | "join" | null;

function getConnectionLabel(status: ReturnType<typeof instantDb.useConnectionStatus>) {
  switch (status) {
    case "authenticated":
      return "Connected to InstantDB";
    case "closed":
    case "errored":
      return "Reconnecting to InstantDB…";
    default:
      return "Connecting to InstantDB…";
  }
}

function resolveCompletedResult(status: GameStatus): OnlineGameResult {
  if (status.phase === "checkmate") {
    return status.winner;
  }

  if (status.phase === "stalemate") {
    return "stalemate";
  }

  return null;
}

function syncOpponentMode(current: AppSessionState, nextGameSession: GameSession): AppSessionState {
  if (current.settings.opponentMode === nextGameSession.opponentMode) {
    return {
      ...current,
      gameSession: nextGameSession,
    };
  }

  return {
    ...current,
    gameSession: nextGameSession,
    settings: {
      ...current.settings,
      opponentMode: nextGameSession.opponentMode,
    },
  };
}

function ReconnectingScreen({
  gameCode,
  onCancel,
  statusLabel,
}: {
  gameCode: string;
  onCancel: () => void;
  statusLabel: string;
}) {
  return (
    <main className="app-shell start-screen-shell">
      <section className="start-layout">
        <section className="board-panel waiting-panel">
          <div className="setup-header">
            <div className="setup-header-copy">
              <p className="panel-label">Reconnecting</p>
              <h1 className="setup-title">Restoring online match</h1>
              <p className="panel-caption">
                Rejoining session <strong>{gameCode}</strong>. The board will appear as soon as the
                latest InstantDB snapshot is available.
              </p>
            </div>

            <div className="setup-header-actions waiting-actions">
              <p className="setup-current-selection">{statusLabel}</p>
              <button type="button" className="secondary-button" onClick={onCancel}>
                Leave match
              </button>
            </div>
          </div>

          <div className="setup-summary-strip" aria-label="Reconnect status">
            <div className="setup-summary-chip">
              <span className="metric-label">Session</span>
              <strong>{gameCode}</strong>
            </div>
            <div className="setup-summary-chip">
              <span className="metric-label">Status</span>
              <strong>{statusLabel}</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function App() {
  const [appSession, setAppSession] = useState(() => loadAppSession());
  const [onlineSession, setOnlineSession] = useState<OnlineSessionReference | null>(() =>
    loadOnlineSession(),
  );
  const [onlinePendingAction, setOnlinePendingAction] = useState<PendingOnlineAction>(null);
  const [onlineError, setOnlineError] = useState<string | null>(null);
  const [onlineViewSession, setOnlineViewSession] = useState<GameSession | null>(null);
  const [onlineViewPreferences, setOnlineViewPreferences] = useState(() => ({
    orientation: appSession.playerColor,
    sessionCode: null as string | null,
    soundEnabled: appSession.gameSession.soundEnabled,
  }));
  const anonymousPlayerId = useMemo(() => loadOrCreateOnlinePlayerId(), []);
  const onlineConnectionStatus = instantDb.useConnectionStatus();
  const onlineQuery = useMemo(
    () =>
      onlineSession
        ? {
            games: {
              $: {
                where: {
                  code: onlineSession.gameCode,
                },
              },
            },
          }
        : null,
    [onlineSession],
  );
  const {
    data: onlineData,
    error: onlineQueryError,
    isLoading: isOnlineLoading,
  } = instantDb.useQuery(onlineQuery);
  const liveOnlineGame = onlineSession
    ? selectOnlineGameByCode(onlineData?.games, onlineSession.gameCode)
    : null;
  const onlinePlayerColor =
    liveOnlineGame && onlineSession
      ? resolveOnlinePlayerColor(liveOnlineGame, onlineSession.playerId)
      : null;
  const onlineGameSignature = liveOnlineGame
    ? JSON.stringify({
        blackPlayerId: liveOnlineGame.blackPlayerId,
        blackTimeRemaining: liveOnlineGame.blackTimeRemaining,
        moves: liveOnlineGame.moves,
        result: liveOnlineGame.result,
        status: liveOnlineGame.status,
        whiteTimeRemaining: liveOnlineGame.whiteTimeRemaining,
      })
    : null;
  const connectionLabel = getConnectionLabel(onlineConnectionStatus);
  const shouldShowOnlineWaiting =
    !!onlineSession &&
    !!liveOnlineGame &&
    onlinePlayerColor === "white" &&
    liveOnlineGame.status === "waiting";
  const shouldShowOnlineGame =
    !!onlineSession && !!liveOnlineGame && !!onlinePlayerColor && !!onlineViewSession;

  useEffect(() => {
    persistAppSession(appSession);
  }, [appSession]);

  useEffect(() => {
    persistOnlineSession(onlineSession);
  }, [onlineSession]);

  useEffect(() => {
    if (!onlineViewSession) {
      return;
    }

    setOnlineViewPreferences((current) =>
      current.orientation === onlineViewSession.orientation &&
      current.soundEnabled === onlineViewSession.soundEnabled
        ? current
        : {
            orientation: onlineViewSession.orientation,
            sessionCode: onlineSession?.gameCode ?? current.sessionCode,
            soundEnabled: onlineViewSession.soundEnabled,
          },
    );
  }, [onlineSession, onlineViewSession]);

  useEffect(() => {
    if (!onlineSession) {
      setOnlineViewSession(null);
      return;
    }

    if (isOnlineLoading || onlineQueryError) {
      return;
    }

    if (!liveOnlineGame) {
      setOnlineSession(null);
      setOnlineViewSession(null);
      setOnlinePendingAction(null);
      setOnlineError("The saved online session could not be found.");
      setAppSession((current) => ({
        ...current,
        screen: "start",
      }));
      return;
    }

    if (!onlinePlayerColor) {
      setOnlineSession(null);
      setOnlineViewSession(null);
      setOnlinePendingAction(null);
      setOnlineError("This browser is not one of the players in the saved online session.");
      setAppSession((current) => ({
        ...current,
        screen: "start",
      }));
      return;
    }

    const preferredOrientation =
      onlineViewPreferences.sessionCode === onlineSession.gameCode
        ? onlineViewPreferences.orientation
        : onlinePlayerColor;
    const rebuiltSession = buildOnlineGameSession(liveOnlineGame, {
      orientation: preferredOrientation,
      playerColor: onlinePlayerColor,
      soundEnabled: onlineViewPreferences.soundEnabled,
    });

    if (!rebuiltSession) {
      setOnlineSession(null);
      setOnlineViewSession(null);
      setOnlinePendingAction(null);
      setOnlineError("The online move history is invalid and could not be restored.");
      setAppSession((current) => ({
        ...current,
        screen: "start",
      }));
      return;
    }

    setOnlineViewSession(rebuiltSession);
    setOnlinePendingAction(null);
    setOnlineError(null);
    setAppSession((current) =>
      current.screen === "game"
        ? current
        : {
            ...current,
            screen: "game",
          },
    );
  }, [
    isOnlineLoading,
    liveOnlineGame,
    onlineGameSignature,
    onlinePlayerColor,
    onlineQueryError,
    onlineSession,
    onlineViewPreferences.orientation,
    onlineViewPreferences.sessionCode,
    onlineViewPreferences.soundEnabled,
  ]);

  function updateSettings(update: Partial<AppSessionState["settings"]>) {
    setAppSession((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...update,
      },
    }));
  }

  function handleStartLocalGame() {
    setOnlineSession(null);
    setOnlineViewSession(null);
    setOnlinePendingAction(null);
    setOnlineError(null);
    setAppSession((current) => {
      const nextGame = createGameSessionFromSettings(current.settings, {
        soundEnabled: current.gameSession.soundEnabled,
      });

      return {
        ...current,
        gameSession: nextGame.session,
        playerColor: nextGame.playerColor,
        screen: "game",
      };
    });
  }

  function handleReturnToSetup() {
    setOnlineSession(null);
    setOnlineViewSession(null);
    setOnlinePendingAction(null);
    setOnlineError(null);
    setAppSession((current) => ({
      ...current,
      screen: "start",
    }));
  }

  function handleLocalSessionChange(update: SessionUpdate) {
    setAppSession((current) => {
      const nextGameSession = typeof update === "function" ? update(current.gameSession) : update;

      return syncOpponentMode(current, nextGameSession);
    });
  }

  function handleOnlineSessionChange(update: SessionUpdate) {
    setOnlineViewSession((current) => {
      if (!current) {
        return current;
      }

      return typeof update === "function" ? update(current) : update;
    });
  }

  const handleCreateOnlineGame = useEffectEvent(async () => {
    setOnlinePendingAction("create");
    setOnlineError(null);

    try {
      let reservedCode: string | null = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const nextCode = createSessionCode();
        const response = await instantDb.queryOnce({
          games: {
            $: {
              where: {
                code: nextCode,
              },
            },
          },
        });

        if (!selectOnlineGameByCode(response.data.games, nextCode)) {
          reservedCode = nextCode;
          break;
        }
      }

      if (!reservedCode) {
        throw new Error("Could not reserve a unique session code. Please try again.");
      }

      const timeControlSeconds = Math.round(
        timeControlMinutesToMs(appSession.settings.timeControlMinutes) / 1000,
      );

      await instantDb.transact(
        instantDb.tx.games[id()].update(
          createOnlineGamePayload(reservedCode, anonymousPlayerId, timeControlSeconds),
        ),
      );

      setOnlineViewPreferences({
        orientation: "white",
        sessionCode: reservedCode,
        soundEnabled: appSession.gameSession.soundEnabled,
      });
      setOnlineSession({
        gameCode: reservedCode,
        playerId: anonymousPlayerId,
      });
      setAppSession((current) => ({
        ...current,
        screen: "game",
      }));
    } catch (error) {
      setOnlineError(
        error instanceof Error
          ? error.message
          : "The online room could not be created. Please try again.",
      );
      setOnlinePendingAction(null);
    }
  });

  const handleJoinOnlineGame = useEffectEvent(async (rawCode: string) => {
    const normalizedCode = normalizeSessionCode(rawCode);

    if (!normalizedCode) {
      setOnlineError("Enter a valid session code before joining.");
      return;
    }

    setOnlinePendingAction("join");
    setOnlineError(null);

    try {
      const response = await instantDb.queryOnce({
        games: {
          $: {
            where: {
              code: normalizedCode,
            },
          },
        },
      });
      const match = selectOnlineGameByCode(response.data.games, normalizedCode);

      if (!match) {
        throw new Error("No waiting game was found for that session code.");
      }

      if (!canJoinOnlineGame(match, anonymousPlayerId)) {
        throw new Error("That game is no longer waiting for an opponent.");
      }

      await instantDb.transact(
        instantDb.tx.games[match.id].update({
          blackPlayerId: anonymousPlayerId,
          status: "active",
        }),
      );

      setOnlineViewPreferences({
        orientation: "black",
        sessionCode: normalizedCode,
        soundEnabled: appSession.gameSession.soundEnabled,
      });
      setOnlineSession({
        gameCode: normalizedCode,
        playerId: anonymousPlayerId,
      });
      setAppSession((current) => ({
        ...current,
        screen: "game",
      }));
    } catch (error) {
      setOnlineError(
        error instanceof Error
          ? error.message
          : "The online game could not be joined. Please try again.",
      );
      setOnlinePendingAction(null);
    }
  });

  const handleOnlineMove = useEffectEvent(
    async (payload: { clockState: ClockState; move: { san: string }; nextStatus: GameStatus }) => {
      if (!onlineSession || !liveOnlineGame) {
        throw new Error("The online game is no longer available.");
      }

      await instantDb.transact(
        instantDb.tx.games[liveOnlineGame.id].update({
          blackTimeRemaining: Math.max(0, payload.clockState.black),
          moves: [...liveOnlineGame.moves, payload.move.san],
          result: resolveCompletedResult(payload.nextStatus),
          status:
            payload.nextStatus.phase === "checkmate" || payload.nextStatus.phase === "stalemate"
              ? "completed"
              : "active",
          whiteTimeRemaining: Math.max(0, payload.clockState.white),
        }),
      );
    },
  );

  if (onlineSession) {
    if (shouldShowOnlineWaiting && liveOnlineGame) {
      return (
        <OnlineWaitingScreen
          connectionLabel={connectionLabel}
          gameCode={liveOnlineGame.code}
          onCancel={handleReturnToSetup}
          timeControlMinutes={appSession.settings.timeControlMinutes}
        />
      );
    }

    if (shouldShowOnlineGame && liveOnlineGame && onlinePlayerColor && onlineViewSession) {
      return (
        <GameScreen
          onlineGame={{
            connectionLabel,
            onMove: handleOnlineMove,
            sessionCode: liveOnlineGame.code,
          }}
          onReturnToSetup={handleReturnToSetup}
          onSessionChange={handleOnlineSessionChange}
          playerColor={onlinePlayerColor}
          session={onlineViewSession}
          timeControlMinutes={appSession.settings.timeControlMinutes}
        />
      );
    }

    return (
      <ReconnectingScreen
        gameCode={onlineSession.gameCode}
        onCancel={handleReturnToSetup}
        statusLabel={connectionLabel}
      />
    );
  }

  if (appSession.screen === "start") {
    return (
      <StartScreen
        onlineError={onlineError}
        onlinePendingAction={onlinePendingAction}
        onlineReady
        onCreateOnlineGame={handleCreateOnlineGame}
        onJoinOnlineGame={handleJoinOnlineGame}
        onSettingChange={updateSettings}
        onStartGame={handleStartLocalGame}
        settings={appSession.settings}
      />
    );
  }

  return (
    <GameScreen
      onReturnToSetup={handleReturnToSetup}
      onSessionChange={handleLocalSessionChange}
      playerColor={appSession.playerColor}
      session={appSession.gameSession}
      timeControlMinutes={appSession.settings.timeControlMinutes}
    />
  );
}

export default App;

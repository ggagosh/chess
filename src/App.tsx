import { useEffect, useState } from "react";

import "./App.css";
import {
  createGameSessionFromSettings,
  loadAppSession,
  persistAppSession,
  type AppSessionState,
} from "./app-session";
import { GameScreen } from "./components/GameScreen";
import { StartScreen } from "./components/StartScreen";
import type { GameSession } from "./game-session";
import type { GameSettings } from "./game-setup";

type SessionUpdate = GameSession | ((current: GameSession) => GameSession);

function App() {
  const [appSession, setAppSession] = useState(() => loadAppSession());

  useEffect(() => {
    persistAppSession(appSession);
  }, [appSession]);

  function updateSettings(update: Partial<GameSettings>) {
    setAppSession((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ...update,
      },
    }));
  }

  function handleStartGame() {
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
    setAppSession((current) => ({
      ...current,
      screen: "start",
    }));
  }

  function handleSessionChange(update: SessionUpdate) {
    setAppSession((current) => {
      const nextGameSession = typeof update === "function" ? update(current.gameSession) : update;

      return syncOpponentMode(current, nextGameSession);
    });
  }

  if (appSession.screen === "start") {
    return (
      <StartScreen
        onSettingChange={updateSettings}
        onStartGame={handleStartGame}
        settings={appSession.settings}
      />
    );
  }

  return (
    <GameScreen
      onReturnToSetup={handleReturnToSetup}
      onSessionChange={handleSessionChange}
      playerColor={appSession.playerColor}
      session={appSession.gameSession}
      timeControlMinutes={appSession.settings.timeControlMinutes}
    />
  );
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

export default App;

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Arena,
  Car,
  CarEffects,
  DustCloud,
  ExplosionEffect,
  GameOverScreen,
  HUD,
  Sparks,
  StatsPanel,
  TireMarks,
} from "./_components";
import { createInitialGameState, restartGame, updateGame } from "./gameEngine";
import { ARENA_CONFIG, GameState } from "./types";

export default function DerbyPage() {
  // Auto-start the game immediately
  const [gameState, setGameState] = useState<GameState>(() => {
    const state = createInitialGameState();
    state.gamePhase = "playing"; // Start playing immediately
    return state;
  });
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const gameLoop = useCallback((timestamp: number) => {
    if (lastTimeRef.current === 0) {
      lastTimeRef.current = timestamp;
    }

    const deltaTime = Math.min(timestamp - lastTimeRef.current, 50); // Cap delta to prevent huge jumps
    lastTimeRef.current = timestamp;

    setGameState(prevState => {
      if (prevState.gamePhase !== "playing") {
        return prevState;
      }
      return updateGame(prevState, deltaTime);
    });

    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);

  useEffect(() => {
    if (gameState.gamePhase === "playing") {
      lastTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [gameState.gamePhase, gameLoop]);

  const handleRestart = () => {
    setGameState(restartGame());
  };

  // Responsive scaling
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const maxWidth = Math.min(containerWidth - 32, ARENA_CONFIG.width);
        setScale(maxWidth / ARENA_CONFIG.width);
      }
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 py-4"
    >
      {/* Header */}
      <header className="w-full max-w-4xl px-4 mb-4">
        <h1 className="text-2xl font-black text-center text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 tracking-tight">
          DEMOLITION DERBY
        </h1>
      </header>

      {/* Main content */}
      <main className="w-full max-w-4xl flex flex-col items-center">
        {gameState.gamePhase === "gameover" && (
          <GameOverScreen
            winner={gameState.winner}
            cars={gameState.cars}
            gameTime={gameState.gameTime}
            onRestart={handleRestart}
          />
        )}

        {gameState.gamePhase === "playing" && (
          <>
            {/* HUD */}
            <div
              className="w-full rounded-t-xl overflow-hidden"
              style={{
                maxWidth: ARENA_CONFIG.width * scale,
              }}
            >
              <HUD cars={gameState.cars} />
            </div>

            {/* Arena */}
            <div
              className="relative bg-zinc-800 rounded-b-xl overflow-hidden shadow-2xl border-x-4 border-b-4 border-amber-900/50"
              style={{
                width: ARENA_CONFIG.width * scale,
                height: ARENA_CONFIG.height * scale,
              }}
            >
              <svg
                viewBox={`0 0 ${ARENA_CONFIG.width} ${ARENA_CONFIG.height}`}
                width={ARENA_CONFIG.width * scale}
                height={ARENA_CONFIG.height * scale}
                style={{ display: "block" }}
              >
                {/* Arena background and walls */}
                <Arena />

                {/* Tire marks (rendered first, below everything) */}
                <TireMarks marks={gameState.tireMarks} />

                {/* Dust clouds */}
                {gameState.cars.map(car => (
                  <DustCloud key={`dust-${car.id}`} car={car} />
                ))}

                {/* Cars */}
                {gameState.cars.map(car => (
                  <Car key={car.id} car={car} />
                ))}

                {/* Car effects (smoke, fire) */}
                {gameState.cars.map(car => (
                  <CarEffects key={`effects-${car.id}`} car={car} />
                ))}

                {/* Sparks */}
                <Sparks sparks={gameState.sparks} />

                {/* Explosions */}
                {gameState.explosions.map(explosion => (
                  <ExplosionEffect key={explosion.id} explosion={explosion} />
                ))}
              </svg>
            </div>

            {/* Stats Panel */}
            <div
              className="w-full rounded-xl overflow-hidden mt-4"
              style={{
                maxWidth: ARENA_CONFIG.width * scale,
              }}
            >
              <StatsPanel cars={gameState.cars} />
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-8 text-zinc-600 text-sm text-center">
        <p>Midwest Mayhem &apos;95</p>
      </footer>
    </div>
  );
}

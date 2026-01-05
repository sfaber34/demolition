"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Arena,
  Car,
  CarEffects,
  DamageNumbers,
  DustCloud,
  ExplosionEffect,
  GameOverScreen,
  HUD,
  Sparks,
  StatsPanel,
  TireMarks,
  TitleScreen,
} from "./_components";
import { DebugOverlay } from "./debug/DebugOverlay";
import { GameEngine, GameSnapshot } from "./engine/GameEngine";
import { ARENA_CONFIG } from "./sim/typesSim";

export default function DerbyPage() {
  // Create engine once and store in ref
  const engineRef = useRef<GameEngine | null>(null);

  // Get initial snapshot for state
  const [gameSnapshot, setGameSnapshot] = useState<GameSnapshot>(() => {
    const engine = new GameEngine(16);
    engineRef.current = engine;
    return engine.getSnapshot();
  });

  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  const gameLoop = useCallback((timestamp: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (lastTimeRef.current === 0) {
      lastTimeRef.current = timestamp;
    }

    const deltaTime = Math.min(timestamp - lastTimeRef.current, 50); // Cap delta
    lastTimeRef.current = timestamp;

    if (engine.getPhase() === "playing") {
      engine.step(deltaTime);
      setGameSnapshot(engine.getSnapshot());
    }

    animationRef.current = requestAnimationFrame(gameLoop);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (engine.getPhase() === "playing") {
      lastTimeRef.current = 0;
      animationRef.current = requestAnimationFrame(gameLoop);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      // Clean up keyboard event listeners
      engineRef.current?.cleanup();
    };
  }, [gameLoop]);

  const handleStart = () => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.start();
    setGameSnapshot(engine.getSnapshot());

    lastTimeRef.current = 0;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = requestAnimationFrame(gameLoop);
  };

  const handleRestart = () => {
    const engine = engineRef.current;
    if (engine) {
      engine.restart();
      setGameSnapshot(engine.getSnapshot());
      lastTimeRef.current = 0;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      animationRef.current = requestAnimationFrame(gameLoop);
    }
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
        {gameSnapshot.gamePhase === "title" && <TitleScreen onStart={handleStart} />}

        {gameSnapshot.gamePhase === "gameover" && (
          <GameOverScreen
            winner={gameSnapshot.winner}
            cars={gameSnapshot.cars}
            gameTime={gameSnapshot.gameTime}
            onRestart={handleRestart}
          />
        )}

        {gameSnapshot.gamePhase === "playing" && (
          <>
            {/* HUD */}
            <div
              className="w-full rounded-t-xl overflow-hidden"
              style={{
                maxWidth: ARENA_CONFIG.width * scale,
              }}
            >
              <HUD cars={gameSnapshot.cars} />
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
                <TireMarks marks={gameSnapshot.effects.tireMarks} />

                {/* Dust clouds */}
                {gameSnapshot.cars.map(car => (
                  <DustCloud key={`dust-${car.id}`} car={car} />
                ))}

                {/* Cars */}
                {gameSnapshot.cars.map(car => (
                  <Car key={car.id} car={car} />
                ))}

                {/* Car effects (smoke, fire) */}
                {gameSnapshot.cars.map(car => (
                  <CarEffects key={`effects-${car.id}`} car={car} />
                ))}

                {/* Sparks */}
                <Sparks sparks={gameSnapshot.effects.sparks} />

                {/* Explosions */}
                {gameSnapshot.effects.explosions.map(explosion => (
                  <ExplosionEffect key={explosion.id} explosion={explosion} />
                ))}

                {/* Floating damage numbers */}
                <DamageNumbers damageNumbers={gameSnapshot.effects.damageNumbers} />

                {/* Debug overlay (toggle in debug/debugConfig.ts) */}
                <DebugOverlay cars={gameSnapshot.cars} />
              </svg>
            </div>

            {/* Stats Panel */}
            <div
              className="w-full rounded-xl overflow-hidden mt-4"
              style={{
                maxWidth: ARENA_CONFIG.width * scale,
              }}
            >
              <StatsPanel cars={gameSnapshot.cars} />
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

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Arena,
  Car,
  CarEffects,
  DamageNumbers,
  DeadCarFlames,
  DeadCarSmoke,
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
import { GameSnapshot } from "./engine/GameEngine";
import type { IDerbyEngine } from "./engine/IDerbyEngine";
import { createDerbyEngine, createDerbyEngineAsync } from "./engine/createDerbyEngine";
import { ZERO_BYTES32, parseSeedBytes32 } from "./sim/deterministicRandom";
import { ARENA_CONFIG } from "./sim/typesSim";

export default function DerbyPage() {
  // Create engine once and store in ref
  const engineRef = useRef<IDerbyEngine | null>(null);

  const [runSeedInput, setRunSeedInput] = useState<string>("0");
  const resolvedRunSeed = parseSeedBytes32(runSeedInput) ?? ZERO_BYTES32;

  // Get initial snapshot for state
  const [gameSnapshot, setGameSnapshot] = useState<GameSnapshot>(() => {
    const engine = createDerbyEngine(8, { runSeed: ZERO_BYTES32 });
    engineRef.current = engine;
    return engine.getSnapshot();
  });

  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const wallClockStartRef = useRef<number | null>(null);
  const lastLogWallRef = useRef<number | null>(null);
  const lastLogSimRef = useRef<number | null>(null);
  const simTimeRef = useRef<number>(0);
  const phaseRef = useRef<GameSnapshot["gamePhase"]>("title");

  // Keep latest values in refs for the logger interval (avoid effect re-running every frame).
  useEffect(() => {
    simTimeRef.current = gameSnapshot.gameTime;
    phaseRef.current = gameSnapshot.gamePhase;
  }, [gameSnapshot.gameTime, gameSnapshot.gamePhase]);

  const gameLoop = useCallback((timestamp: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    if (lastTimeRef.current === 0) {
      lastTimeRef.current = timestamp;
    }

    const deltaTime = Math.min(timestamp - lastTimeRef.current, 50); // Cap delta
    lastTimeRef.current = timestamp;

    const phase = engine.getPhase();
    // Only schedule frames while actively simulating.
    // If we keep scheduling during "gameover"/"title", it's easy to accidentally end up with
    // multiple overlapping RAF loops across restarts (which makes timing nondeterministic).
    if (phase === "playing" || phase === "victory") {
      engine.step(deltaTime);
      setGameSnapshot(engine.getSnapshot());
      animationRef.current = requestAnimationFrame(gameLoop);
    } else {
      animationRef.current = null;
    }
  }, []);

  // Log sim-time vs wall-time once per second while running (helps diagnose "game feels faster/slower").
  useEffect(() => {
    const phase = phaseRef.current;
    if (phase !== "playing" && phase !== "victory") {
      wallClockStartRef.current = null;
      lastLogWallRef.current = null;
      lastLogSimRef.current = null;
      return;
    }

    if (wallClockStartRef.current === null) wallClockStartRef.current = performance.now();

    const id = window.setInterval(() => {
      const wallNow = performance.now();
      const wallStart = wallClockStartRef.current ?? wallNow;
      const wallElapsedMs = wallNow - wallStart;

      const prevWall = lastLogWallRef.current ?? wallNow;
      const simNow = simTimeRef.current;
      const prevSim = lastLogSimRef.current ?? simNow;

      const wallDelta = wallNow - prevWall;
      const simDelta = simNow - prevSim;
      const ratio = wallDelta > 0 ? simDelta / wallDelta : 0;

      console.log(
        `[derby] phase=${phaseRef.current} wallElapsedMs=${wallElapsedMs.toFixed(0)} simTimeMs=${simNow.toFixed(
          0,
        )} wallDeltaMs=${wallDelta.toFixed(0)} simDeltaMs=${simDelta.toFixed(0)} ratio=${ratio.toFixed(3)}`,
      );

      lastLogWallRef.current = wallNow;
      lastLogSimRef.current = simNow;
    }, 1000);

    return () => window.clearInterval(id);
  }, [gameSnapshot.gamePhase]);

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

  // Prefer WASM engine once it is async-loaded; keep TS engine as an immediate fallback.
  useEffect(() => {
    let cancelled = false;

    const maybeSwapToAsyncEngine = async () => {
      const current = engineRef.current;
      // Only swap while on title screen so we don't disrupt an active run.
      if (!current || current.getPhase() !== "title") return;

      const newEngine = await createDerbyEngineAsync(8, { runSeed: resolvedRunSeed });
      if (cancelled) {
        newEngine.cleanup();
        return;
      }

      current.cleanup();
      engineRef.current = newEngine;
      setGameSnapshot(newEngine.getSnapshot());
      lastTimeRef.current = 0;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };

    void maybeSwapToAsyncEngine();
    return () => {
      cancelled = true;
    };
    // Intentionally depend on resolvedRunSeed so we load the right seed if user edits before starting.
  }, [resolvedRunSeed]);

  // If the user changes seed on the title screen, rebuild the engine so the very first run uses that seed.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.getPhase() !== "title") return;

    // Allow the input to be temporarily empty/invalid while editing (common on iOS).
    // Only rebuild when we have a valid seed.
    const parsed = parseSeedBytes32(runSeedInput);
    if (parsed === null) return;

    let cancelled = false;
    const rebuild = async () => {
      const current = engineRef.current;
      if (!current || current.getPhase() !== "title") return;

      const newEngine = await createDerbyEngineAsync(8, { runSeed: parsed });
      if (cancelled) {
        newEngine.cleanup();
        return;
      }

      current.cleanup();
      engineRef.current = newEngine;
      setGameSnapshot(newEngine.getSnapshot());
      lastTimeRef.current = 0;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };

    void rebuild();
    return () => {
      cancelled = true;
    };
  }, [runSeedInput]);

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
      engine.restart(resolvedRunSeed);
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
        {gameSnapshot.gamePhase === "title" && (
          <TitleScreen onStart={handleStart} runSeedInput={runSeedInput} onRunSeedInputChange={setRunSeedInput} />
        )}

        {gameSnapshot.gamePhase === "gameover" && (
          <GameOverScreen
            winner={gameSnapshot.winner}
            cars={gameSnapshot.cars}
            gameTime={gameSnapshot.gameTime}
            onRestart={handleRestart}
            runSeedInput={runSeedInput}
            onRunSeedInputChange={setRunSeedInput}
            onGetRecording={() => engineRef.current?.getRecording?.() ?? null}
          />
        )}

        {(gameSnapshot.gamePhase === "playing" || gameSnapshot.gamePhase === "victory") && (
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

                {(() => {
                  const deadCars = gameSnapshot.cars.filter(c => !c.isAlive);
                  const liveCars = gameSnapshot.cars.filter(c => c.isAlive);
                  const tMs = gameSnapshot.gameTime + gameSnapshot.alpha * 8;

                  return (
                    <>
                      {/* Dead car bodies under everything else */}
                      {deadCars.map(car => (
                        <Car key={`dead-${car.id}`} car={car} />
                      ))}

                      {/* Dead flames above dead body but below live cars */}
                      {deadCars.map(car => (
                        <DeadCarFlames key={`dead-flames-${car.id}`} car={car} tMs={tMs} />
                      ))}

                      {/* Live cars always drive over dead body + flames */}
                      {liveCars.map(car => (
                        <Car key={`live-${car.id}`} car={car} />
                      ))}

                      {/* Live car effects */}
                      {liveCars.map(car => (
                        <CarEffects key={`effects-${car.id}`} car={car} tMs={tMs} />
                      ))}

                      {/* Dead smoke always above cars */}
                      {deadCars.map(car => (
                        <DeadCarSmoke key={`dead-smoke-${car.id}`} car={car} tMs={tMs} />
                      ))}
                    </>
                  );
                })()}

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

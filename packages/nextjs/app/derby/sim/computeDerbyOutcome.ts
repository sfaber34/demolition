import { DerbyAiController } from "../controllers/DerbyAiController";
import { createInitialWorld } from "./createInitialWorld";
import { stepWorldSim } from "./stepWorldSim";
import type { WorldSim } from "./typesSim";
import type { Hex } from "viem";

export type DerbyOutcome = {
  seed: Hex;
  fixedDtMs: number;
  ticks: number;
  completed: boolean;
  phase: WorldSim["gamePhase"];
  gameTimeMs: number;
  winner: { id: string; name: string; color: string } | null;
  cars: Array<{ id: string; name: string; color: string; isAlive: boolean; health: number; damageDealt: number }>;
};

/**
 * Compute the deterministic outcome of a derby run as fast as possible (no rendering, no VFX).
 * Uses the same AI and sim step as the live game.
 */
export function computeDerbyOutcome(
  seed: Hex,
  opts: {
    fixedDtMs?: number;
    maxSimMs?: number;
  } = {},
): DerbyOutcome {
  const fixedDtMs = opts.fixedDtMs ?? 8;
  const maxSimMs = opts.maxSimMs ?? 5 * 60_000; // safety

  const world = createInitialWorld();
  // Help TS understand this can transition across phases via `stepWorldSim` (mutation through function calls).
  world.gamePhase = "playing" as WorldSim["gamePhase"];

  const ai = new DerbyAiController({ runSeed: seed });

  let ticks = 0;
  const maxTicks = Math.ceil(maxSimMs / fixedDtMs);

  while (world.gamePhase !== ("gameover" as WorldSim["gamePhase"]) && ticks < maxTicks) {
    // Match GameEngine: during victory, sim still steps but controllers stop updating.
    if (world.gamePhase === "playing") {
      ai.update(world, fixedDtMs, world.gameTime);
    }

    stepWorldSim(world, fixedDtMs);
    ticks++;
  }

  const winner = world.winner ? { id: world.winner.id, name: world.winner.name, color: world.winner.color } : null;

  return {
    seed,
    fixedDtMs,
    ticks,
    completed: world.gamePhase === "gameover",
    phase: world.gamePhase,
    gameTimeMs: world.gameTime,
    winner,
    cars: world.cars.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      isAlive: c.isAlive,
      health: c.health,
      damageDealt: c.damageDealt,
    })),
  };
}

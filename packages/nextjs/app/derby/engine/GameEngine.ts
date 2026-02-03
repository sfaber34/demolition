// GameEngine - Orchestrates simulation, effects, and controllers
// This is the main entry point for the game loop.
//
// Architecture:
// - Owns mutable WorldSim and EffectsState
// - Calls AI controllers to set car.input
// - Calls stepWorldSim to advance physics (emits SimEvents)
// - Calls stepEffects to update VFX from events
// - Provides getSnapshot() for React rendering (immutable copy)
import { DerbyAiController } from "../controllers/DerbyAiController";
import type { CarController } from "../controllers/controllerTypes";
import { KeyboardController } from "../controllers/keyboardController";
import { EffectsState, createEmptyEffectsState } from "../effects/effectsTypes";
import { snapshotEffects, stepEffects } from "../effects/stepEffects";
import { createInitialWorld } from "../sim/createInitialWorld";
import { ZERO_BYTES32 } from "../sim/deterministicRandom";
import { stepWorldSim } from "../sim/stepWorldSim";
import { CarSim, Vector2D, WorldSim } from "../sim/typesSim";
import type { Hex } from "viem";

// ============ Types for UI Snapshot ============

/** Snapshot of game state for React rendering (immutable) */
export interface GameSnapshot {
  cars: CarSim[];
  effects: EffectsState;
  gamePhase: "title" | "playing" | "victory" | "gameover";
  winner: CarSim | null;
  gameTime: number;
  /** Interpolation alpha (0-1) for smooth rendering between physics steps */
  alpha: number;
}

// ============ Game Engine Class ============

/** Previous state for interpolation */
interface PreviousCarState {
  position: Vector2D;
  rotation: number;
}

export class GameEngine {
  private world: WorldSim;
  private effects: EffectsState;
  private fixedDtMs: number;
  private accumulator: number;
  private keyboardController: KeyboardController;
  private aiController: CarController;
  private runSeed: Hex;
  /** Previous car states for render interpolation */
  private previousStates: Map<string, PreviousCarState> = new Map();

  // Default to 120Hz physics step. With time-step invariant damping, this improves visual smoothness
  // on high refresh displays without changing feel.
  constructor(fixedDtMs: number = 8, opts: { runSeed?: Hex } = {}) {
    this.fixedDtMs = fixedDtMs;
    this.accumulator = 0;
    this.runSeed = opts.runSeed ?? ZERO_BYTES32;
    this.world = this.createInitialWorld();
    this.effects = createEmptyEffectsState();
    // Car 0 is red by default. Player controls car 0 with keyboard.
    this.keyboardController = new KeyboardController(0);
    // AI drives cars 1-3 (skip car 0 for player control)
    this.aiController = new DerbyAiController({ runSeed: this.runSeed, skipIndices: [0] });
    // Initialize previous states
    this.savePreviousStates();
  }

  private createInitialWorld(): WorldSim {
    return createInitialWorld();
  }

  /** Start the game */
  start(): void {
    this.world.gamePhase = "playing";
  }

  /** Restart the game with fresh state */
  restart(runSeed?: Hex): void {
    if (runSeed !== undefined) {
      this.runSeed = runSeed;
    }
    this.world = this.createInitialWorld();
    this.world.gamePhase = "playing";
    this.effects = createEmptyEffectsState();
    this.accumulator = 0;
    // Important: car IDs are re-used (carIdCounter reset) and gameTime rewinds to 0.
    // Controllers that keep per-car memory keyed by ID must be reset as well.
    this.aiController = new DerbyAiController({ runSeed: this.runSeed, skipIndices: [0] });
    this.previousStates.clear();
    this.savePreviousStates();
  }

  /** Save current car positions/rotations for interpolation */
  private savePreviousStates(): void {
    for (const car of this.world.cars) {
      this.previousStates.set(car.id, {
        position: { x: car.position.x, y: car.position.y },
        rotation: car.rotation,
      });
    }
  }

  /**
   * Main step function - call this from the game loop with delta time.
   * Uses fixed timestep internally for determinism.
   *
   * Interpolation approach (from "Fix Your Timestep!"):
   * - previousStates holds the state from ONE physics step ago
   * - currentState (this.world) holds the latest physics state
   * - alpha = accumulator / fixedDtMs (0 to ~1)
   * - render = lerp(previous, current, alpha)
   */
  step(dtMs: number): void {
    // Only step during playing or victory phases
    if (this.world.gamePhase !== "playing" && this.world.gamePhase !== "victory") {
      return;
    }

    // Fixed timestep accumulator
    this.accumulator += dtMs;

    while (this.accumulator >= this.fixedDtMs) {
      // Save current state as "previous" BEFORE running physics
      // This means previousStates always holds the state from 1 physics tick ago
      this.savePreviousStates();

      // During victory, step the sim (for timer) and effects (for animations)
      // but skip controller updates
      if (this.world.gamePhase === "victory") {
        stepWorldSim(this.world, this.fixedDtMs);
        stepEffects(this.effects, [], this.fixedDtMs, this.world.cars);
        this.accumulator -= this.fixedDtMs;
        continue;
      }

      // 1. Update controllers (sets car.input)
      // AI controller handles cars 1-3 (skips car 0)
      this.aiController.update(this.world, this.fixedDtMs, this.world.gameTime);
      // Keyboard controller handles car 0 (player)
      this.keyboardController.update(this.world, this.fixedDtMs, this.world.gameTime);

      // 2. Step simulation (applies inputs, physics, collisions)
      const events = stepWorldSim(this.world, this.fixedDtMs);

      // 3. Update effects with events
      stepEffects(this.effects, events, this.fixedDtMs, this.world.cars);

      this.accumulator -= this.fixedDtMs;
    }
  }

  /** Get immutable snapshot for React rendering with interpolated positions */
  getSnapshot(): GameSnapshot {
    // Interpolation alpha (0..1): how far we are between the previous physics tick and the current one.
    // Using interpolation avoids "prediction pops" (common with extrapolation) at high speeds / collisions.
    const alpha = Math.max(0, Math.min(1, this.accumulator / this.fixedDtMs));

    // Create shallow copies of cars array with INTERPOLATED position/rotation
    const carsCopy = this.world.cars.map(car => {
      const prev = this.previousStates.get(car.id);

      // Default: current state (no interpolation available)
      let interpPosition: Vector2D = { x: car.position.x, y: car.position.y };
      let interpRotation = car.rotation;

      if (prev) {
        interpPosition = {
          x: prev.position.x + (car.position.x - prev.position.x) * alpha,
          y: prev.position.y + (car.position.y - prev.position.y) * alpha,
        };

        // Interpolate rotation via shortest path (handle wrap-around at +/- PI)
        let deltaRotation = car.rotation - prev.rotation;
        while (deltaRotation > Math.PI) deltaRotation -= Math.PI * 2;
        while (deltaRotation < -Math.PI) deltaRotation += Math.PI * 2;
        interpRotation = prev.rotation + deltaRotation * alpha;
      }

      return {
        ...car,
        position: interpPosition,
        rotation: interpRotation,
        velocity: { ...car.velocity },
        lastPosition: { ...car.lastPosition },
        input: { ...car.input },
      };
    });

    return {
      cars: carsCopy,
      effects: snapshotEffects(this.effects),
      gamePhase: this.world.gamePhase,
      winner: this.world.winner ? { ...this.world.winner } : null,
      gameTime: this.world.gameTime,
      alpha,
    };
  }

  /** Get current game phase */
  getPhase(): "title" | "playing" | "victory" | "gameover" {
    return this.world.gamePhase;
  }

  /** Get direct access to world sim (for rollout planning) */
  getWorldSim(): WorldSim {
    return this.world;
  }

  /** Get the fixed timestep in ms */
  getFixedDtMs(): number {
    return this.fixedDtMs;
  }

  /** Clean up resources (event listeners, etc.) */
  cleanup(): void {
    this.keyboardController.cleanup();
  }
}

// ============ Legacy Compatibility Layer ============
// These functions provide backward compatibility with the old API

let globalEngine: GameEngine | null = null;

export function createInitialGameState(): GameSnapshot {
  globalEngine = new GameEngine(8);
  return globalEngine.getSnapshot();
}

export function startGame(): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(8);
  }
  globalEngine.start();
  return globalEngine.getSnapshot();
}

export function restartGame(): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(8);
  }
  globalEngine.restart();
  return globalEngine.getSnapshot();
}

export function updateGame(deltaTime: number): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(8);
    globalEngine.start();
  }
  globalEngine.step(deltaTime);
  return globalEngine.getSnapshot();
}

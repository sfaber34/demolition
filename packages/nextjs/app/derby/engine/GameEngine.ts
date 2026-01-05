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
import { stepWorldSim } from "../sim/stepWorldSim";
import { ARENA_CONFIG, CAR_COLORS, CAR_CONFIG, CAR_NAMES, CarSim, Vector2D, WorldSim } from "../sim/typesSim";

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

// ============ Car Factory ============

let carIdCounter = 0;
function generateCarId(): string {
  return `car-${++carIdCounter}`;
}

function createCar(name: string, color: string, position: Vector2D, rotation: number): CarSim {
  // Slight stat variations for each car (using deterministic seed based on name)
  const seed = name.charCodeAt(0) / 255;
  const accelVariation = 0.9 + seed * 0.3;
  const corneringVariation = 0.85 + ((seed * 7) % 1) * 0.3;
  const tractionVariation = 0.75 + ((seed * 13) % 1) * 0.3;

  return {
    id: generateCarId(),
    name,
    color,
    position: { x: position.x, y: position.y },
    velocity: { x: 0, y: 0 },
    rotation,
    angularVelocity: 0,
    health: CAR_CONFIG.maxHealth,
    maxHealth: CAR_CONFIG.maxHealth,
    damageDealt: 0,
    isAlive: true,
    width: CAR_CONFIG.width,
    height: CAR_CONFIG.height,
    acceleration: 0.35 * accelVariation,
    maxSpeed: 15, // Actual achievable max with friction physics is ~10-15
    cornering: 1.0 * corneringVariation,
    traction: 0.75 * tractionVariation,
    input: { throttle: 0, steer: 0 },
    aiState: "orbiting",
    stateTimer: 0,
    targetId: null,
    stuckTimer: 0,
    lastPosition: { x: position.x, y: position.y },
    aiDebug: {},
  };
}

function createInitialCars(): CarSim[] {
  const { width, height, wallThickness } = ARENA_CONFIG;
  const margin = 80;

  // Spawn positions near corners
  const spawnPositions: { pos: Vector2D; rotation: number }[] = [
    {
      pos: { x: wallThickness + margin + 15, y: wallThickness + margin + 15 },
      rotation: Math.PI / 4,
    },
    {
      pos: { x: width - wallThickness - margin - 15, y: wallThickness + margin + 15 },
      rotation: (3 * Math.PI) / 4,
    },
    {
      pos: { x: wallThickness + margin + 15, y: height - wallThickness - margin - 15 },
      rotation: -Math.PI / 4,
    },
    {
      pos: { x: width - wallThickness - margin - 15, y: height - wallThickness - margin - 15 },
      rotation: (-3 * Math.PI) / 4,
    },
  ];

  const colors = Object.values(CAR_COLORS);
  return spawnPositions.map((spawn, i) => createCar(CAR_NAMES[i], colors[i], spawn.pos, spawn.rotation));
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
  /** Previous car states for render interpolation */
  private previousStates: Map<string, PreviousCarState> = new Map();

  // Default to 120Hz physics step. With time-step invariant damping, this improves visual smoothness
  // on high refresh displays without changing feel.
  constructor(fixedDtMs: number = 8) {
    this.fixedDtMs = fixedDtMs;
    this.accumulator = 0;
    this.world = this.createInitialWorld();
    this.effects = createEmptyEffectsState();
    // Car 0 is red by default. Keep keyboard controller around for optional testing,
    // but by default we let AI drive all cars (including red).
    this.keyboardController = new KeyboardController(0);
    // AI drives all cars (0-3)
    this.aiController = new DerbyAiController();
    // Initialize previous states
    this.savePreviousStates();
  }

  private createInitialWorld(): WorldSim {
    return {
      cars: createInitialCars(),
      gamePhase: "title",
      winner: null,
      gameTime: 0,
      victoryTime: 0,
      collisionCooldowns: {},
    };
  }

  /** Start the game */
  start(): void {
    this.world.gamePhase = "playing";
  }

  /** Restart the game with fresh state */
  restart(): void {
    carIdCounter = 0; // Reset for determinism
    this.world = this.createInitialWorld();
    this.world.gamePhase = "playing";
    this.effects = createEmptyEffectsState();
    this.accumulator = 0;
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
        stepEffects(this.effects, [], this.fixedDtMs);
        this.accumulator -= this.fixedDtMs;
        continue;
      }

      // 1. Update controllers (sets car.input)
      // AI controller handles all cars (including red / car 0)
      this.aiController.update(this.world, this.fixedDtMs, this.world.gameTime);

      // 2. Step simulation (applies inputs, physics, collisions)
      const events = stepWorldSim(this.world, this.fixedDtMs);

      // 3. Update effects with events
      stepEffects(this.effects, events, this.fixedDtMs);

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

// GameEngine - Orchestrates simulation, effects, and controllers
// This is the main entry point for the game loop.
//
// Architecture:
// - Owns mutable WorldSim and EffectsState
// - Calls AI controllers to set car.input
// - Calls stepWorldSim to advance physics (emits SimEvents)
// - Calls stepEffects to update VFX from events
// - Provides getSnapshot() for React rendering (immutable copy)
import type { CarController } from "../controllers/controllerTypes";
import { KeyboardController } from "../controllers/keyboardController";
import { NoopController } from "../controllers/noopController";
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
  };
}

function createInitialCars(): CarSim[] {
  const { width, height, wallThickness } = ARENA_CONFIG;
  const margin = 80;

  // Spawn positions near corners
  // const spawnPositions: { pos: Vector2D; rotation: number }[] = [
  //   {
  //     pos: { x: wallThickness + margin + 15, y: wallThickness + margin + 15 },
  //     rotation: Math.PI / 4,
  //   },
  //   {
  //     pos: { x: width - wallThickness - margin - 15, y: wallThickness + margin + 15 },
  //     rotation: (3 * Math.PI) / 4,
  //   },
  //   {
  //     pos: { x: wallThickness + margin + 15, y: height - wallThickness - margin - 15 },
  //     rotation: -Math.PI / 4,
  //   },
  //   {
  //     pos: { x: width - wallThickness - margin - 15, y: height - wallThickness - margin - 15 },
  //     rotation: (-3 * Math.PI) / 4,
  //   },
  // ];

  const spawnPositions: { pos: Vector2D; rotation: number }[] = [
    {
      pos: { x: 100, y: 300 },
      rotation: Math.PI * 2,
    },
    {
      pos: { x: 700, y: 300 },
      rotation: Math.PI * 2,
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
  private noopController: CarController;
  /** Previous car states for render interpolation */
  private previousStates: Map<string, PreviousCarState> = new Map();

  constructor(fixedDtMs: number = 16) {
    this.fixedDtMs = fixedDtMs;
    this.accumulator = 0;
    this.world = this.createInitialWorld();
    this.effects = createEmptyEffectsState();
    // Car 0 is player-controlled via keyboard
    this.keyboardController = new KeyboardController(0);
    // Cars 1-3 are controlled by NoopController (just sit there)
    // Skip index 0 since it's player-controlled
    this.noopController = new NoopController([0]);
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
      // Keyboard controller handles car 0, NoopController handles the rest
      this.keyboardController.update(this.world, this.fixedDtMs, this.world.gameTime);
      this.noopController.update(this.world, this.fixedDtMs, this.world.gameTime);

      // 2. Step simulation (applies inputs, physics, collisions)
      const events = stepWorldSim(this.world, this.fixedDtMs);

      // 3. Update effects with events
      stepEffects(this.effects, events, this.fixedDtMs);

      this.accumulator -= this.fixedDtMs;
    }
  }

  /** Get immutable snapshot for React rendering with extrapolated positions */
  getSnapshot(): GameSnapshot {
    // Calculate extrapolation factor - how much time since last physics step
    // We use extrapolation (predict forward) instead of interpolation (look back)
    // because it feels more responsive
    const extrapolateMs = this.accumulator;
    const extrapolateFactor = extrapolateMs / this.fixedDtMs;

    // Create shallow copies of cars array with EXTRAPOLATED position/rotation
    const carsCopy = this.world.cars.map(car => {
      // Extrapolate position based on current velocity
      // This predicts where the car WILL be at render time
      const extrapPosition = {
        x: car.position.x + car.velocity.x * extrapolateFactor,
        y: car.position.y + car.velocity.y * extrapolateFactor,
      };

      // Extrapolate rotation based on angular velocity
      const extrapRotation = car.rotation + car.angularVelocity * extrapolateFactor;

      return {
        ...car,
        position: extrapPosition,
        rotation: extrapRotation,
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
      alpha: extrapolateFactor,
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
  globalEngine = new GameEngine(16);
  return globalEngine.getSnapshot();
}

export function startGame(): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(16);
  }
  globalEngine.start();
  return globalEngine.getSnapshot();
}

export function restartGame(): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(16);
  }
  globalEngine.restart();
  return globalEngine.getSnapshot();
}

export function updateGame(deltaTime: number): GameSnapshot {
  if (!globalEngine) {
    globalEngine = new GameEngine(16);
    globalEngine.start();
  }
  globalEngine.step(deltaTime);
  return globalEngine.getSnapshot();
}

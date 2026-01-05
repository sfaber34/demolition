// Core Simulation Types - Pure data, no effects, no timestamps
// These types are used by the deterministic simulation step

export interface Vector2D {
  x: number;
  y: number;
}

/** Control inputs for a car - set by AI or player controller */
export interface CarInput {
  throttle: number; // -1 to 1.5 (reverse to boost)
  steer: number; // -1 to 1 (left to right)
}

/** AI behavioral state - used by AI controller */
export type AIBehavior = "orbiting" | "striking" | "repositioning";

/** Core car simulation state - mutable during sim step */
export interface CarSim {
  id: string;
  name: string;
  color: string;

  // Physics state
  position: Vector2D;
  velocity: Vector2D;
  rotation: number; // radians
  angularVelocity: number;

  // Dimensions
  width: number;
  height: number;

  // Stats (immutable during sim)
  acceleration: number;
  maxSpeed: number;
  cornering: number;
  traction: number;

  // Health/damage
  health: number;
  maxHealth: number;
  damageDealt: number;
  isAlive: boolean;

  // Current control input (set by controller, read by physics)
  input: CarInput;

  // AI state (read/written by AI controller)
  aiState: AIBehavior;
  stateTimer: number;
  targetId: string | null;
  stuckTimer: number;
  lastPosition: Vector2D; // For AI stuck detection

  // Optional: AI debug info written by controllers (for HUD/debug overlays)
  aiDebug?: {
    frontWallDist?: number;
    rearWallDist?: number;
    recoverMode?: "front" | "rear" | null;
  };
}

/** Core world simulation state */
export interface WorldSim {
  cars: CarSim[];
  gamePhase: "title" | "playing" | "victory" | "gameover";
  winner: CarSim | null;
  gameTime: number; // accumulated sim time in ms
  victoryTime: number; // when victory phase started (for delay before gameover)

  /**
   * Deterministic collision damage cooldowns (ms in sim-time), keyed by "carA:carB".
   * Stored on the world so rollouts clone it and predictions match live sim.
   */
  collisionCooldowns: Record<string, number>;
}

// ============ Simulation Events ============
// These are emitted by stepWorldSim and consumed by effects layer

export interface CarImpactEvent {
  type: "car_impact";
  carAId: string;
  carBId: string;
  damageA: number;
  damageB: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

export interface WallImpactEvent {
  type: "wall_impact";
  carId: string;
  damage: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

export interface CarDeathEvent {
  type: "car_death";
  carId: string;
  position: Vector2D;
}

export interface TireMarkEvent {
  type: "tire_mark";
  carId: string;
  position: Vector2D;
  rotation: number;
}

export type SimEvent = CarImpactEvent | WallImpactEvent | CarDeathEvent | TireMarkEvent;

// ============ Collision Detection Results ============
// Internal types used by physics, but exposed for adapter interface

export interface Collision {
  carA: CarSim;
  carB: CarSim;
  normal: Vector2D;
  penetration: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

export interface WallCollision {
  car: CarSim;
  normal: Vector2D;
  penetration: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

// ============ Config Constants ============

export interface ArenaConfig {
  width: number;
  height: number;
  wallThickness: number;
}

export const ARENA_CONFIG: ArenaConfig = {
  width: 900,
  height: 600,
  wallThickness: 30,
};

export const CAR_CONFIG = {
  width: 50,
  height: 28,
  maxHealth: 100,
  baseDamageMultiplier: 2.0,
  minDamageSpeed: 5,
  wallDamageMultiplier: 0.08,
  pinnedDamageMultiplier: 2.5,
};

export const PHYSICS_CONFIG = {
  friction: 0.975,
  angularFriction: 0.88,
  bounceRestitution: 0.5, // Increased for bouncier wall hits
  spinOutThreshold: 0.45,
  collisionPushForce: 0.6,
};

// Note: Max achievable car speed is ~10-15 due to friction physics
// All speed thresholds must be proportional to this range
export const AI_CONFIG = {
  seekDistance: 400,
  attackDistance: 450,
  minAttackSpeed: 6, // Lowered from 25 - cars max at ~10-15
  circleRadius: 180,
  disengageTime: 500,
  recoveryTime: 400,
  wallAvoidDistance: 50,
  wallAvoidStrength: 1.0,
  stuckThreshold: 3,
  stuckTime: 500,
  clusterAvoidDistance: 50,
  lowHealthThreshold: 30,
  criticalHealthThreshold: 15,
  idealAttackDistance: 250,
  minDamageSpeed: 5, // Lowered from 20 - cars max at ~10-15
};

export const CAR_COLORS: Record<string, string> = {
  red: "#e74c3c",
  blue: "#3498db",
  green: "#2ecc71",
  yellow: "#f1c40f",
};

export const CAR_NAMES = ["Crusher", "Destroyer", "Havoc", "Rammer"];

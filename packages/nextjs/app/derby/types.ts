// Demolition Derby Game Types

export interface Vector2D {
  x: number;
  y: number;
}

export interface Car {
  id: string;
  name: string;
  color: string;
  position: Vector2D;
  velocity: Vector2D;
  rotation: number; // in radians
  angularVelocity: number;
  health: number;
  maxHealth: number;
  damageDealt: number;
  isAlive: boolean;
  width: number;
  height: number;
  // Stats
  acceleration: number;
  maxSpeed: number;
  cornering: number; // turn rate multiplier
  traction: number; // affects acceleration and spin-out threshold
  // AI State
  aiState: AIState;
  stateTimer: number;
  targetId: string | null;
  lastImpactTime: number;
  stuckTimer: number;
  lastPosition: Vector2D;
}

export type AIState =
  | "seeking" // Legacy
  | "circling" // Legacy
  | "attacking" // Legacy
  | "disengaging" // Legacy
  | "evading" // Legacy
  | "recovering" // Legacy
  | "charging" // Legacy
  | "orbiting" // Circle the arena edge, build speed
  | "striking" // Dive in for the hit!
  | "repositioning"; // Brief reposition to edge

export interface Collision {
  carA: Car;
  carB: Car;
  normal: Vector2D;
  penetration: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

export interface WallCollision {
  car: Car;
  normal: Vector2D;
  penetration: number;
  impactSpeed: number;
  contactPoint: Vector2D;
}

export interface TireMark {
  id: string;
  position: Vector2D;
  rotation: number;
  opacity: number;
  timestamp: number;
}

export interface Spark {
  id: string;
  position: Vector2D;
  velocity: Vector2D;
  life: number;
  maxLife: number;
  color: string;
}

export interface SmokeParticle {
  id: string;
  position: Vector2D;
  velocity: Vector2D;
  life: number;
  maxLife: number;
  size: number;
  opacity: number;
}

export interface Explosion {
  id: string;
  position: Vector2D;
  particles: ExplosionParticle[];
  startTime: number;
  duration: number;
}

export interface ExplosionParticle {
  angle: number;
  distance: number;
  speed: number;
  size: number;
  color: string;
  rotation: number;
}

export interface GameState {
  cars: Car[];
  tireMarks: TireMark[];
  sparks: Spark[];
  smokeParticles: SmokeParticle[];
  explosions: Explosion[];
  gamePhase: "title" | "playing" | "gameover";
  winner: Car | null;
  gameTime: number;
}

export interface ArenaConfig {
  width: number;
  height: number;
  wallThickness: number;
}

// Game Constants
export const ARENA_CONFIG: ArenaConfig = {
  width: 900,
  height: 600,
  wallThickness: 30,
};

export const CAR_CONFIG = {
  width: 50,
  height: 28,
  maxHealth: 100,
  baseDamageMultiplier: 2.0, // HIGH damage - big hits matter!
  minDamageSpeed: 5, // Very low threshold - most collisions deal damage
  wallDamageMultiplier: 0.08,
  pinnedDamageMultiplier: 2.5,
};

export const CAR_COLORS = {
  red: "#e74c3c",
  blue: "#3498db",
  green: "#2ecc71",
  yellow: "#f1c40f",
};

export const CAR_NAMES = ["Crusher", "Destroyer", "Havoc", "Rammer"];

export const PHYSICS_CONFIG = {
  friction: 0.975, // More friction for realistic deceleration
  angularFriction: 0.88,
  bounceRestitution: 0.3,
  spinOutThreshold: 0.45, // radians/frame threshold for spin-out
  collisionPushForce: 0.6,
};

export const AI_CONFIG = {
  seekDistance: 400,
  attackDistance: 450, // Long attack runs for speed buildup
  minAttackSpeed: 25, // Lower threshold for slower cars
  circleRadius: 180, // Get in close
  disengageTime: 500, // ms - slightly longer to build distance
  recoveryTime: 400, // ms - recovery time
  wallAvoidDistance: 50,
  wallAvoidStrength: 1.0,
  stuckThreshold: 3, // pixels
  stuckTime: 500, // ms before considered stuck
  clusterAvoidDistance: 50,
  lowHealthThreshold: 30, // Berserker mode below this
  criticalHealthThreshold: 15, // Ultra berserker mode
  idealAttackDistance: 250, // Need more distance to build speed
  minDamageSpeed: 20, // Lower threshold for slower max speeds
};

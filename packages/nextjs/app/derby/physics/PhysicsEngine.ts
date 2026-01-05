// Physics Engine Adapter - Stable interface for physics operations
// This allows swapping out the physics implementation later without
// changing game logic, AI, or effects code.
import {
  ARENA_CONFIG,
  CAR_CONFIG,
  CarInput,
  CarSim,
  Collision,
  PHYSICS_CONFIG,
  Vector2D,
  WallCollision,
} from "../sim/typesSim";
import { CarSnapshot, debugLog } from "../utils/debugLog";

// Re-export Vector2D for convenience
export type { Vector2D };

// ============ Vector Utilities ============

export const vec = {
  add: (a: Vector2D, b: Vector2D): Vector2D => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vector2D, b: Vector2D): Vector2D => ({ x: a.x - b.x, y: a.y - b.y }),
  mul: (v: Vector2D, s: number): Vector2D => ({ x: v.x * s, y: v.y * s }),
  dot: (a: Vector2D, b: Vector2D): number => a.x * b.x + a.y * b.y,
  length: (v: Vector2D): number => Math.sqrt(v.x * v.x + v.y * v.y),
  normalize: (v: Vector2D): Vector2D => {
    const len = vec.length(v);
    return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
  },
  rotate: (v: Vector2D, angle: number): Vector2D => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
  },
  perpendicular: (v: Vector2D): Vector2D => ({ x: -v.y, y: v.x }),
  distance: (a: Vector2D, b: Vector2D): number => vec.length(vec.sub(b, a)),
  angle: (v: Vector2D): number => Math.atan2(v.y, v.x),
  fromAngle: (angle: number): Vector2D => ({ x: Math.cos(angle), y: Math.sin(angle) }),
  lerp: (a: Vector2D, b: Vector2D, t: number): Vector2D => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  }),
};

// ============ Real Velocity Utilities ============
// SINGLE SOURCE OF TRUTH for real velocity calculations
// All code MUST use these functions - never calculate position delta manually!

/**
 * Calculate the REAL velocity of a car based on actual position movement.
 * This is the true velocity, not state velocity which can be high when blocked.
 *
 * @param car - The car to get real velocity for
 * @param dtMs - Frame time in milliseconds (default 16ms for 60fps)
 * @returns Real velocity vector in same units as car.velocity (0-10 range at max speed)
 */
export function getRealVelocity(car: CarSim, dtMs: number = 16): Vector2D {
  const dt = dtMs / 16.67;
  const positionDelta = vec.sub(car.position, car.lastPosition);
  return vec.mul(positionDelta, 1 / dt);
}

/**
 * Get the REAL speed (magnitude of real velocity).
 *
 * @param car - The car to get real speed for
 * @param dtMs - Frame time in milliseconds (default 16ms for 60fps)
 * @returns Real speed in same units as car.velocity magnitude (0-10 range at max speed)
 */
export function getRealSpeed(car: CarSim, dtMs: number = 16): number {
  return vec.length(getRealVelocity(car, dtMs));
}

/**
 * Get the STATE velocity speed (physics state, may not reflect actual movement).
 * Use this only when you specifically need the physics state, not actual movement.
 */
export function getStateSpeed(car: CarSim): number {
  return vec.length(car.velocity);
}

// ============ Physics Interface ============

export interface IPhysicsEngine {
  // Apply control inputs to car (throttle/steer → velocity/angular changes)
  applyControls(car: CarSim, input: CarInput, dtMs: number): void;

  // Integrate car position/rotation (velocity/friction)
  integrateCar(car: CarSim, dtMs: number): void;

  // Check for collision between two cars
  checkCarCollision(carA: CarSim, carB: CarSim): Collision | null;

  // Resolve a car-car collision, returns damage values
  resolveCarCollision(
    collision: Collision,
    nowMs: number,
    cooldowns: CollisionCooldowns,
    dtMs: number,
  ): { damageA: number; damageB: number };

  // Check for collision with arena walls
  checkWallCollision(car: CarSim, dtMs: number): WallCollision | null;

  // Resolve a wall collision, returns damage
  resolveWallCollision(collision: WallCollision, dtMs: number): number;

  // Check if car is pinned against wall by another car
  isCarPinned(car: CarSim, cars: CarSim[], wallCollision: WallCollision | null, dtMs: number): boolean;

  // Utility: get car corners for collision detection
  getCarCorners(car: CarSim): Vector2D[];

  // Utility: get car forward direction
  getCarForward(car: CarSim): Vector2D;

  // Utility: get car right direction
  getCarRight(car: CarSim): Vector2D;
}

// ============ Default Physics Implementation ============
// (Current SAT-based physics)

// Collision cooldown tracking - prevents grinding damage
const COLLISION_COOLDOWN_MS = 400; // Minimum time between damage for same car pair
export type CollisionCooldowns = Record<string, number>;

function getCollisionPairKey(idA: string, idB: string): string {
  // Always put smaller id first for consistent key
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

function canDealDamage(idA: string, idB: string, nowMs: number, cooldowns: CollisionCooldowns): boolean {
  const key = getCollisionPairKey(idA, idB);
  const lastCollision = cooldowns[key];
  if (lastCollision !== undefined && nowMs - lastCollision < COLLISION_COOLDOWN_MS) {
    return false;
  }
  return true;
}

function recordCollision(idA: string, idB: string, nowMs: number, cooldowns: CollisionCooldowns): void {
  const key = getCollisionPairKey(idA, idB);
  cooldowns[key] = nowMs;
}

// Clean up old cooldowns periodically
function cleanupCooldowns(nowMs: number, cooldowns: CollisionCooldowns): void {
  for (const [key, time] of Object.entries(cooldowns)) {
    if (nowMs - time > COLLISION_COOLDOWN_MS * 2) delete cooldowns[key];
  }
}

class DefaultPhysicsEngine implements IPhysicsEngine {
  applyControls(car: CarSim, input: CarInput, dtMs: number): void {
    if (!car.isAlive) return;

    const dt = dtMs / 16.67;
    const forward = this.getCarForward(car);

    // Use centralized real velocity calculation
    const realSpeed = getRealSpeed(car, dtMs);

    // Apply throttle
    const accelForce = input.throttle * car.acceleration * car.traction;

    if (input.throttle > 0) {
      car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt * 1.2));
    } else if (input.throttle < 0) {
      car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt));
    }

    // Apply steering - use real speed (max achievable is ~10)
    // Steering effectiveness scales from 0 at standstill to 1.0 at max speed
    const MAX_REAL_SPEED = 10;
    const steerEffectiveness = Math.min(1.0, realSpeed / MAX_REAL_SPEED) * car.cornering;
    car.angularVelocity += input.steer * 0.14 * steerEffectiveness * dt;

    // Clamp angular velocity
    const maxAngularVel = 0.18 / car.traction;
    car.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, car.angularVelocity));
  }

  integrateCar(car: CarSim, dtMs: number): void {
    if (!car.isAlive) return;

    const dt = dtMs / 16.67;

    // Apply velocity
    car.position = vec.add(car.position, vec.mul(car.velocity, dt));

    // Apply rotation
    car.rotation += car.angularVelocity * dt;

    // Normalize rotation
    while (car.rotation > Math.PI) car.rotation -= Math.PI * 2;
    while (car.rotation < -Math.PI) car.rotation += Math.PI * 2;

    // Apply friction
    car.velocity = vec.mul(car.velocity, PHYSICS_CONFIG.friction);

    // Apply angular friction
    car.angularVelocity *= PHYSICS_CONFIG.angularFriction;

    // Lateral friction
    const forward = this.getCarForward(car);
    const right = this.getCarRight(car);
    const forwardSpeed = vec.dot(car.velocity, forward);
    const lateralSpeed = vec.dot(car.velocity, right);

    const lateralFriction = 0.85 - car.traction * 0.1;
    const newLateralSpeed = lateralSpeed * lateralFriction;

    car.velocity = vec.add(vec.mul(forward, forwardSpeed), vec.mul(right, newLateralSpeed));

    // Check for spin-out - use centralized real velocity calculation
    // A car pushing against a wall has high state velocity but isn't actually spinning out
    const realSpeed = getRealSpeed(car, dtMs);
    if (Math.abs(car.angularVelocity) > PHYSICS_CONFIG.spinOutThreshold && realSpeed > 6) {
      car.velocity = vec.mul(car.velocity, 0.98);
    }

    // Clamp velocity to max speed (use state velocity for clamping the physics state)
    const stateSpeed = vec.length(car.velocity);
    if (stateSpeed > car.maxSpeed) {
      car.velocity = vec.mul(vec.normalize(car.velocity), car.maxSpeed);
    }
  }

  checkCarCollision(carA: CarSim, carB: CarSim): Collision | null {
    if (!carA.isAlive || !carB.isAlive) return null;

    const cornersA = this.getCarCorners(carA);
    const cornersB = this.getCarCorners(carB);
    const axesA = this._getAxes(cornersA);
    const axesB = this._getAxes(cornersB);
    const allAxes = [...axesA, ...axesB];

    let minOverlap = Infinity;
    let collisionNormal: Vector2D = { x: 0, y: 0 };

    for (const axis of allAxes) {
      const { overlap, overlapping } = this._overlapOnAxis(cornersA, cornersB, axis);
      if (!overlapping) return null;
      if (overlap < minOverlap) {
        minOverlap = overlap;
        collisionNormal = axis;
      }
    }

    // Ensure normal points from A to B
    const centerDiff = vec.sub(carB.position, carA.position);
    if (vec.dot(collisionNormal, centerDiff) < 0) {
      collisionNormal = vec.mul(collisionNormal, -1);
    }

    // Calculate impact speed for physics and damage
    //
    // IMPORTANT: car.velocity is the PHYSICS STATE velocity, NOT actual movement!
    // In a stalemate, throttle keeps adding to velocity even though cars are blocked.
    // So we need TWO different velocity concepts:
    // 1. stateVelocity (car.velocity) - used for physics impulse calculations
    // 2. actualMovement (position - lastPosition) - used for damage eligibility
    //
    const relVel = vec.sub(carA.velocity, carB.velocity);
    const velAlongNormal = vec.dot(relVel, collisionNormal);
    // velAlongNormal > 0 means cars have velocity vectors CLOSING (A approaching B along normal)
    // velAlongNormal < 0 means velocity vectors are SEPARATING
    // Note: This can be positive in a stalemate due to throttle!
    const closingStateVelocity = velAlongNormal > 0 ? velAlongNormal : 0;
    const stateSpeedA = vec.length(carA.velocity);
    const stateSpeedB = vec.length(carB.velocity);
    const combinedStateSpeed = (stateSpeedA + stateSpeedB) * 0.5;

    // For physics resolution (impulses/bouncing), use state velocity
    const impactSpeed = Math.max(closingStateVelocity, combinedStateSpeed);

    // For DAMAGE calculation, we'll use closingStateVelocity as a baseline,
    // but the actual damage eligibility check in resolveCarCollision uses
    // actual movement (position - lastPosition) to filter out stalemates.
    const damageImpactSpeed = closingStateVelocity;

    const contactPoint = vec.lerp(carA.position, carB.position, 0.5);

    return {
      carA,
      carB,
      normal: collisionNormal,
      penetration: minOverlap,
      impactSpeed,
      damageImpactSpeed,
      contactPoint,
    };
  }

  resolveCarCollision(
    collision: Collision,
    nowMs: number,
    cooldowns: CollisionCooldowns,
    dtMs: number,
  ): { damageA: number; damageB: number } {
    const { carA, carB, normal, penetration, impactSpeed, damageImpactSpeed } = collision;

    // Separate cars
    const separation = vec.mul(normal, penetration / 2 + 2);
    carA.position = vec.sub(carA.position, separation);
    carB.position = vec.add(carB.position, separation);

    // Get STATE speeds (velocity magnitude, NOT actual movement!)
    // In a stalemate, these can be high even though cars aren't moving
    const stateSpeedA = vec.length(carA.velocity);
    const stateSpeedB = vec.length(carB.velocity);

    // Calculate relative velocity along collision normal
    const relVel = vec.sub(carA.velocity, carB.velocity);
    const velAlongNormal = vec.dot(relVel, normal);

    if (velAlongNormal < 0) {
      const restitution = PHYSICS_CONFIG.bounceRestitution;
      const impulseMag = (-(1 + restitution) * velAlongNormal) / 2;
      const impulseVec = vec.mul(normal, impulseMag);

      carA.velocity = vec.add(carA.velocity, impulseVec);
      carB.velocity = vec.sub(carB.velocity, impulseVec);

      // Momentum transfer
      // Note: Max achievable speed is ~10-15, so use proportional thresholds
      if (stateSpeedA > stateSpeedB + 3) {
        const pushStrength = (stateSpeedA - stateSpeedB) * 0.4;
        const pushDir = vec.normalize(carA.velocity);
        carB.velocity = vec.add(carB.velocity, vec.mul(pushDir, pushStrength));
        carA.velocity = vec.mul(carA.velocity, 0.7);
      } else if (stateSpeedB > stateSpeedA + 3) {
        const pushStrength = (stateSpeedB - stateSpeedA) * 0.4;
        const pushDir = vec.normalize(carB.velocity);
        carA.velocity = vec.add(carA.velocity, vec.mul(pushDir, pushStrength));
        carB.velocity = vec.mul(carB.velocity, 0.7);
      } else {
        carA.velocity = vec.mul(carA.velocity, 0.8);
        carB.velocity = vec.mul(carB.velocity, 0.8);
      }
    }

    // Angular impulse - only apply significant spin for off-center/side impacts
    // For head-on collisions, the impact should NOT cause spinning
    const forwardA = this.getCarForward(carA);
    const forwardB = this.getCarForward(carB);

    // How much is this a side hit? (0 = head-on, 1 = pure side)
    // Use dot product of forward direction with collision normal
    const sideFactorA = 1 - Math.abs(vec.dot(forwardA, normal));
    const sideFactorB = 1 - Math.abs(vec.dot(forwardB, normal));

    // Contact offset from center (cross product gives torque arm)
    const contactToA = vec.sub(collision.contactPoint, carA.position);
    const contactToB = vec.sub(collision.contactPoint, carB.position);
    const torqueArmA = contactToA.x * normal.y - contactToA.y * normal.x;
    const torqueArmB = contactToB.x * normal.y - contactToB.y * normal.x;

    // Much lower base multiplier, scaled by side factor
    // Head-on (sideFactor ~= 0) → almost no spin
    // Side hit (sideFactor ~= 1) → some spin
    const angularMultiplier = 0.0015;
    const angularImpulseA = torqueArmA * impactSpeed * angularMultiplier * sideFactorA;
    const angularImpulseB = torqueArmB * impactSpeed * angularMultiplier * sideFactorB;

    // Apply with reduced traction effect and cap max change
    const maxAngularChange = 0.08; // Cap the spin per collision
    const clampedImpulseA = Math.max(-maxAngularChange, Math.min(maxAngularChange, angularImpulseA));
    const clampedImpulseB = Math.max(-maxAngularChange, Math.min(maxAngularChange, angularImpulseB));

    carA.angularVelocity += clampedImpulseA;
    carB.angularVelocity -= clampedImpulseB;

    // Apply extra angular damping after collision to prevent runaway spinning
    carA.angularVelocity *= 0.85;
    carB.angularVelocity *= 0.85;

    // Calculate damage using damageImpactSpeed
    // Based on log analysis: max car speed is ~10, typical collisions have damageImpactSpeed 8-15
    // Most collisions were at 8-10, so lowering threshold to allow more damage
    const MIN_DAMAGE_SPEED = 6;

    // Cleanup old cooldowns periodically (sim-time, deterministic)
    cleanupCooldowns(nowMs, cooldowns);

    // Helper to create car snapshot
    const makeSnapshot = (car: CarSim, speed: number): CarSnapshot => ({
      id: car.id,
      name: car.name,
      position: { x: car.position.x, y: car.position.y },
      velocity: { x: car.velocity.x, y: car.velocity.y },
      speed,
      rotation: (car.rotation * 180) / Math.PI,
      rotationRad: car.rotation,
      angularVelocity: car.angularVelocity,
      health: car.health,
      isAlive: car.isAlive,
    });

    const relVelForLog = vec.sub(carA.velocity, carB.velocity);

    if (damageImpactSpeed < MIN_DAMAGE_SPEED) {
      // Log filtered collision with full detail
      debugLog.log({
        timestamp: nowMs,
        gameTimeMs: nowMs,
        type: "car_collision",
        carA: makeSnapshot(carA, stateSpeedA),
        carB: makeSnapshot(carB, stateSpeedB),
        contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
        collisionNormal: { x: normal.x, y: normal.y },
        penetration,
        relativeVelocity: { x: relVelForLog.x, y: relVelForLog.y },
        relativeImpact: collision.damageImpactSpeed,
        combinedSpeed: impactSpeed,
        damageImpactSpeed,
        damageA: 0,
        damageB: 0,
        totalDamage: 0,
        wasFiltered: true,
        filterReason: `damageImpactSpeed ${damageImpactSpeed.toFixed(1)} < ${MIN_DAMAGE_SPEED}`,
      });
      return { damageA: 0, damageB: 0 };
    }

    // State velocity check:
    // If both cars have low state velocity (not pushing hard), skip damage.
    // NOTE: This checks velocity magnitude, not actual movement!
    // A car in a stalemate applying throttle will have HIGH state velocity.
    const MIN_STATE_SPEED_FOR_DAMAGE = 6;
    if (Math.max(stateSpeedA, stateSpeedB) < MIN_STATE_SPEED_FOR_DAMAGE) {
      debugLog.log({
        timestamp: nowMs,
        gameTimeMs: nowMs,
        type: "car_collision",
        carA: makeSnapshot(carA, stateSpeedA),
        carB: makeSnapshot(carB, stateSpeedB),
        contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
        collisionNormal: { x: normal.x, y: normal.y },
        penetration,
        relativeVelocity: { x: relVelForLog.x, y: relVelForLog.y },
        relativeImpact: collision.damageImpactSpeed,
        combinedSpeed: impactSpeed,
        damageImpactSpeed,
        damageA: 0,
        damageB: 0,
        totalDamage: 0,
        wasFiltered: true,
        filterReason: `low state velocity (max ${Math.max(stateSpeedA, stateSpeedB).toFixed(1)} < ${MIN_STATE_SPEED_FOR_DAMAGE})`,
      });
      return { damageA: 0, damageB: 0 };
    }

    // STALEMATE PROTECTION:
    // Check actual position movement, not just velocity. In a stalemate, cars apply throttle
    // (so velocity is non-zero) but don't actually move (position stays same).
    // If neither car has moved significantly, they're locked up - no damage.
    const MIN_MOVEMENT_FOR_DAMAGE = 3.0; // pixels moved since last frame
    const movementA = vec.distance(carA.position, carA.lastPosition);
    const movementB = vec.distance(carB.position, carB.lastPosition);
    const maxMovement = Math.max(movementA, movementB);
    if (maxMovement < MIN_MOVEMENT_FOR_DAMAGE) {
      debugLog.log({
        timestamp: nowMs,
        gameTimeMs: nowMs,
        type: "car_collision",
        carA: makeSnapshot(carA, stateSpeedA),
        carB: makeSnapshot(carB, stateSpeedB),
        contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
        collisionNormal: { x: normal.x, y: normal.y },
        penetration,
        relativeVelocity: { x: relVelForLog.x, y: relVelForLog.y },
        relativeImpact: collision.damageImpactSpeed,
        combinedSpeed: impactSpeed,
        damageImpactSpeed,
        damageA: 0,
        damageB: 0,
        totalDamage: 0,
        wasFiltered: true,
        filterReason: `stalemate - no movement (maxMovement ${maxMovement.toFixed(1)} < ${MIN_MOVEMENT_FOR_DAMAGE})`,
      });
      return { damageA: 0, damageB: 0 };
    }

    // ACTUAL VELOCITY for damage calculations - use centralized functions
    // State velocity can be high when a car is applying throttle but not actually moving.
    const actualVelA = getRealVelocity(carA, dtMs);
    const actualVelB = getRealVelocity(carB, dtMs);
    const actualSpeedA = getRealSpeed(carA, dtMs);
    const actualSpeedB = getRealSpeed(carB, dtMs);

    // Recalculate damage impact speed using ACTUAL relative velocity, not state velocity
    const actualRelVel = vec.sub(actualVelA, actualVelB);
    const actualVelAlongNormal = vec.dot(actualRelVel, normal);
    // Positive = cars closing, negative = separating
    const actualDamageImpactSpeed =
      actualVelAlongNormal > 0 ? actualVelAlongNormal : Math.abs(actualVelAlongNormal) * 0.5;

    // Check collision cooldown - prevents grinding damage from repeated collisions
    if (!canDealDamage(carA.id, carB.id, nowMs, cooldowns)) {
      debugLog.log({
        timestamp: nowMs,
        gameTimeMs: nowMs,
        type: "car_collision",
        carA: makeSnapshot(carA, stateSpeedA),
        carB: makeSnapshot(carB, stateSpeedB),
        contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
        collisionNormal: { x: normal.x, y: normal.y },
        penetration,
        relativeVelocity: { x: relVelForLog.x, y: relVelForLog.y },
        relativeImpact: collision.damageImpactSpeed,
        combinedSpeed: impactSpeed,
        damageImpactSpeed,
        damageA: 0,
        damageB: 0,
        totalDamage: 0,
        wasFiltered: true,
        filterReason: `collision cooldown active`,
      });
      return { damageA: 0, damageB: 0 };
    }

    // Damage scales with ACTUAL relative impact speed (not state velocity!)
    // Use actualDamageImpactSpeed which is based on true position movement
    // Scale formula to realistic max observed
    const REALISTIC_MAX_IMPACT = 16;
    const speedFactor = Math.min(1, actualDamageImpactSpeed / REALISTIC_MAX_IMPACT);
    // At max impact (15): baseDamage = 15 * 2.0 * 0.94 = 28 total, split = 14 each (strong hit)
    // At typical impact (10): baseDamage = 10 * 2.0 * 0.625 = 12.5 total, split = 6 each (medium hit)
    // At threshold (6): baseDamage = 6 * 2.0 * 0.375 = 4.5 total, split = 2.25 each (light hit)
    const baseDamage = actualDamageImpactSpeed * CAR_CONFIG.baseDamageMultiplier * speedFactor;

    let damageA: number;
    let damageB: number;

    // Attacker (faster car) deals more damage
    // Use ACTUAL speeds (movement) instead of state velocity!
    // A car holding throttle into another has high state velocity but low actual speed.
    if (actualSpeedA > actualSpeedB + 2) {
      // Car A is actually moving faster - B takes more damage
      damageA = baseDamage * 0.3;
      damageB = baseDamage * 0.7;
    } else if (actualSpeedB > actualSpeedA + 2) {
      // Car B is actually moving faster - A takes more damage
      damageA = baseDamage * 0.7;
      damageB = baseDamage * 0.3;
    } else {
      // Similar actual speeds - both take moderate damage
      damageA = baseDamage * 0.5;
      damageB = baseDamage * 0.5;
    }

    // Side/rear hits deal more damage (reuse forwardA/forwardB from above)
    const hitAngleA = Math.abs(vec.dot(forwardA, normal));
    const hitAngleB = Math.abs(vec.dot(forwardB, normal));

    damageA *= 1 + (1 - hitAngleA) * 0.6;
    damageB *= 1 + (1 - hitAngleB) * 0.6;

    // Cap maximum damage per hit
    damageA = Math.min(damageA, 35);
    damageB = Math.min(damageB, 35);

    // Record collision for cooldown tracking
    recordCollision(carA.id, carB.id, nowMs, cooldowns);

    // Log collision with damage - full detail
    debugLog.log({
      timestamp: nowMs,
      gameTimeMs: nowMs,
      type: "car_collision",
      carA: makeSnapshot(carA, stateSpeedA),
      carB: makeSnapshot(carB, stateSpeedB),
      contactPoint: { x: collision.contactPoint.x, y: collision.contactPoint.y },
      collisionNormal: { x: normal.x, y: normal.y },
      penetration,
      relativeVelocity: { x: relVelForLog.x, y: relVelForLog.y },
      relativeImpact: collision.damageImpactSpeed,
      combinedSpeed: impactSpeed,
      damageImpactSpeed,
      // Actual movement-based values used for damage
      actualSpeedA,
      actualSpeedB,
      actualDamageImpactSpeed,
      damageA,
      damageB,
      totalDamage: damageA + damageB,
      wasFiltered: false,
    });

    return { damageA, damageB };
  }

  checkWallCollision(car: CarSim, dtMs: number): WallCollision | null {
    if (!car.isAlive) return null;

    const corners = this.getCarCorners(car);
    const innerLeft = ARENA_CONFIG.wallThickness;
    const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
    const innerTop = ARENA_CONFIG.wallThickness;
    const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

    let maxPenetration = 0;
    let collisionNormal: Vector2D = { x: 0, y: 0 };
    let contactPoint: Vector2D = { x: 0, y: 0 };

    for (const corner of corners) {
      if (corner.x < innerLeft) {
        const pen = innerLeft - corner.x;
        if (pen > maxPenetration) {
          maxPenetration = pen;
          collisionNormal = { x: 1, y: 0 };
          contactPoint = corner;
        }
      }
      if (corner.x > innerRight) {
        const pen = corner.x - innerRight;
        if (pen > maxPenetration) {
          maxPenetration = pen;
          collisionNormal = { x: -1, y: 0 };
          contactPoint = corner;
        }
      }
      if (corner.y < innerTop) {
        const pen = innerTop - corner.y;
        if (pen > maxPenetration) {
          maxPenetration = pen;
          collisionNormal = { x: 0, y: 1 };
          contactPoint = corner;
        }
      }
      if (corner.y > innerBottom) {
        const pen = corner.y - innerBottom;
        if (pen > maxPenetration) {
          maxPenetration = pen;
          collisionNormal = { x: 0, y: -1 };
          contactPoint = corner;
        }
      }
    }

    if (maxPenetration > 0) {
      // Use centralized real velocity calculation
      const realVelocity = getRealVelocity(car, dtMs);
      const realSpeed = getRealSpeed(car, dtMs);
      const impactSpeed = Math.abs(vec.dot(realVelocity, collisionNormal));
      return {
        car,
        normal: collisionNormal,
        penetration: maxPenetration,
        impactSpeed: impactSpeed > 0 ? impactSpeed : realSpeed * 0.5,
        contactPoint,
      };
    }

    return null;
  }

  resolveWallCollision(collision: WallCollision, dtMs: number): number {
    const { car, normal, penetration, impactSpeed } = collision;

    // Push car away from wall
    // Small extra offset prevents re-penetration from floating point error without "popping" too far.
    car.position = vec.add(car.position, vec.mul(normal, penetration + 0.75));

    // Wall contact response:
    // For low-speed "pushing into the wall" contacts, bouncing each frame causes visible jitter and can
    // prevent controllers from detecting stable wall contact. So we make low-speed contacts inelastic
    // (remove the normal component), and only allow bounce for genuinely high-speed impacts.
    // Note: Max achievable speed is ~10, so threshold must be proportional
    const velAlongNormal = vec.dot(car.velocity, normal);
    if (velAlongNormal < 0) {
      const BOUNCE_SPEED_THRESHOLD = 6;
      const restitution = impactSpeed > BOUNCE_SPEED_THRESHOLD ? PHYSICS_CONFIG.bounceRestitution * 0.7 : 0;
      // Subtract the velocity component into the wall; with restitution=0 this is purely inelastic.
      car.velocity = vec.sub(car.velocity, vec.mul(normal, velAlongNormal * (1 + restitution)));
    }

    // Add angular velocity on wall hit - only for glancing blows
    const forward = this.getCarForward(car);
    const sideFactor = 1 - Math.abs(vec.dot(forward, normal)); // 0 = head-on, 1 = side
    const perpComponent = car.velocity.x * normal.y - car.velocity.y * normal.x;
    const angularChange = perpComponent * 0.001 * sideFactor;
    const clampedChange = Math.max(-0.05, Math.min(0.05, angularChange));
    car.angularVelocity += clampedChange;
    car.angularVelocity *= 0.9; // Damping on wall hit

    // Calculate wall damage using centralized real velocity
    const realVelocity = getRealVelocity(car, dtMs);
    const actualImpactSpeed = Math.abs(vec.dot(realVelocity, normal));

    let damage = 0;
    if (actualImpactSpeed > CAR_CONFIG.minDamageSpeed * 0.5) {
      damage = actualImpactSpeed * CAR_CONFIG.wallDamageMultiplier;
    }

    return damage;
  }

  isCarPinned(car: CarSim, cars: CarSim[], wallCollision: WallCollision | null, dtMs: number): boolean {
    if (!wallCollision) return false;

    // Use centralized real velocity functions
    const realSpeed = getRealSpeed(car, dtMs);
    if (realSpeed > 3) return false; // Car is actually moving, not pinned

    for (const other of cars) {
      if (other.id === car.id || !other.isAlive) continue;
      const dist = vec.distance(car.position, other.position);
      if (dist < car.width + other.width) {
        // Check if other car is actually moving towards this car
        const otherRealVelocity = getRealVelocity(other, dtMs);
        const towardsCar = vec.normalize(vec.sub(car.position, other.position));
        const pushingTowards = vec.dot(otherRealVelocity, towardsCar);
        if (pushingTowards > 2) {
          return true;
        }
      }
    }

    return false;
  }

  getCarCorners(car: CarSim): Vector2D[] {
    const halfW = car.width / 2;
    const halfH = car.height / 2;
    const corners = [
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
      { x: -halfW, y: -halfH },
    ];
    return corners.map(c => vec.add(car.position, vec.rotate(c, car.rotation)));
  }

  getCarForward(car: CarSim): Vector2D {
    return vec.fromAngle(car.rotation);
  }

  getCarRight(car: CarSim): Vector2D {
    return vec.fromAngle(car.rotation + Math.PI / 2);
  }

  // Private helpers

  private _projectOntoAxis(corners: Vector2D[], axis: Vector2D): { min: number; max: number } {
    let min = Infinity;
    let max = -Infinity;
    for (const corner of corners) {
      const projection = vec.dot(corner, axis);
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
    return { min, max };
  }

  private _getAxes(corners: Vector2D[]): Vector2D[] {
    const axes: Vector2D[] = [];
    for (let i = 0; i < corners.length; i++) {
      const next = (i + 1) % corners.length;
      const edge = vec.sub(corners[next], corners[i]);
      axes.push(vec.normalize(vec.perpendicular(edge)));
    }
    return axes;
  }

  private _overlapOnAxis(
    cornersA: Vector2D[],
    cornersB: Vector2D[],
    axis: Vector2D,
  ): { overlap: number; overlapping: boolean } {
    const projA = this._projectOntoAxis(cornersA, axis);
    const projB = this._projectOntoAxis(cornersB, axis);
    const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
    return { overlap, overlapping: overlap > 0 };
  }
}

// Export singleton instance
export const physicsEngine: IPhysicsEngine = new DefaultPhysicsEngine();

// Also export the class for testing or subclassing
export { DefaultPhysicsEngine };

// ============ Standalone Car Physics Utilities ============
// SINGLE SOURCE OF TRUTH for all car physics calculations
// All code MUST use these functions - never calculate car geometry manually!

/** Get car's forward direction vector from its rotation */
export function getCarForward(car: CarSim): Vector2D {
  return vec.fromAngle(car.rotation);
}

/** Get car's right direction vector from its rotation */
export function getCarRight(car: CarSim): Vector2D {
  return vec.fromAngle(car.rotation + Math.PI / 2);
}

/**
 * Get the 4 corners of a car in world coordinates.
 * Order: front-right, front-left, back-left, back-right
 */
export function getCarCorners(car: CarSim): Vector2D[] {
  const halfW = car.width / 2;
  const halfH = car.height / 2;
  const localCorners = [
    { x: halfW, y: -halfH }, // front-right
    { x: halfW, y: halfH }, // front-left
    { x: -halfW, y: halfH }, // back-left
    { x: -halfW, y: -halfH }, // back-right
  ];
  return localCorners.map(c => vec.add(car.position, vec.rotate(c, car.rotation)));
}

/** Get the front center position of a car */
export function getCarFront(car: CarSim): Vector2D {
  const forward = getCarForward(car);
  return vec.add(car.position, vec.mul(forward, car.width / 2));
}

/** Get the rear center position of a car */
export function getCarRear(car: CarSim): Vector2D {
  const forward = getCarForward(car);
  return vec.sub(car.position, vec.mul(forward, car.width / 2));
}

// ============ Arena Bounds Utilities ============
// SINGLE SOURCE OF TRUTH for arena collision bounds

/** Inner bounds of the arena (where cars can move) */
export const ARENA_INNER_BOUNDS = {
  left: ARENA_CONFIG.wallThickness,
  right: ARENA_CONFIG.width - ARENA_CONFIG.wallThickness,
  top: ARENA_CONFIG.wallThickness,
  bottom: ARENA_CONFIG.height - ARENA_CONFIG.wallThickness,
};

/** Distance from a point to the nearest wall (positive = inside arena) */
export function pointToWallDistance(x: number, y: number): number {
  const dx = Math.min(x - ARENA_INNER_BOUNDS.left, ARENA_INNER_BOUNDS.right - x);
  const dy = Math.min(y - ARENA_INNER_BOUNDS.top, ARENA_INNER_BOUNDS.bottom - y);
  return Math.min(dx, dy);
}

/**
 * Get distance from a car's nearest corner to the nearest wall.
 * This matches how wall collision detection works.
 */
export function getCarWallDistance(car: CarSim): number {
  const corners = getCarCorners(car);
  let minDist = Infinity;
  for (const corner of corners) {
    const d = pointToWallDistance(corner.x, corner.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

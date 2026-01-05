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

// ============ Velocity Utilities ============
// After velocity correction in integrateCar(), car.velocity IS the true velocity.
// Use getSpeed() for most cases. The other functions are for special internal use.

/**
 * Get the car's speed (magnitude of velocity).
 * After physics runs, car.velocity is corrected to match actual movement,
 * so this IS the real speed.
 */
export function getSpeed(car: CarSim): number {
  return vec.length(car.velocity);
}

/**
 * Get the car's velocity vector.
 * After physics runs, car.velocity is corrected to match actual movement,
 * so this IS the real velocity.
 */
export function getVelocity(car: CarSim): Vector2D {
  return car.velocity;
}

/**
 * INTERNAL: Calculate velocity from position delta (used for velocity correction).
 * External code should use getSpeed()/getVelocity() instead.
 */
export function _calcVelocityFromPositionDelta(car: CarSim, dtMs: number = 16): Vector2D {
  const dt = dtMs / 16.67;
  const positionDelta = vec.sub(car.position, car.lastPosition);
  return vec.mul(positionDelta, 1 / dt);
}

/**
 * Get the velocity from the PREVIOUS frame (before current frame's position updates).
 * Used by applyControls for steering, since position hasn't moved yet.
 */
export function getPrevFrameVelocity(car: CarSim): Vector2D {
  return car.prevFrameRealVelocity;
}

/**
 * Get the speed from the PREVIOUS frame (before current frame's position updates).
 * Used by applyControls for steering, since position hasn't moved yet.
 */
export function getPrevFrameSpeed(car: CarSim): number {
  return vec.length(car.prevFrameRealVelocity);
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
  ): { damageA: number; damageB: number };

  // Check for collision with arena walls
  checkWallCollision(car: CarSim): WallCollision | null;

  // Resolve a wall collision, returns damage
  resolveWallCollision(collision: WallCollision): number;

  // Check if car is pinned against wall by another car
  isCarPinned(car: CarSim, cars: CarSim[], wallCollision: WallCollision | null): boolean;

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

    // Use REAL speed from PREVIOUS FRAME for steering effectiveness
    // This is the actual movement that occurred, stored before lastPosition was updated.
    // A car blocked against a wall will have low real speed even with high state velocity.
    const realSpeed = getPrevFrameSpeed(car);

    // Apply throttle
    const accelForce = input.throttle * car.acceleration * car.traction;

    if (input.throttle > 0) {
      car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt * 1.2));
    } else if (input.throttle < 0) {
      car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt));
    }

    // Apply steering - use real speed from previous frame (max achievable is ~10)
    // Steering effectiveness scales from 0 at standstill to 1.0 at max speed
    const MAX_REAL_SPEED = 10;
    const steerEffectiveness = Math.min(1.0, realSpeed / MAX_REAL_SPEED) * car.cornering;
    car.angularVelocity += input.steer * 0.02 * steerEffectiveness * dt;

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

    // ============ VELOCITY CORRECTION ============
    // Sync state velocity to reality. If the car didn't actually move as much as
    // state velocity suggests (e.g., blocked by wall/car), reduce state velocity.
    // This ensures car.velocity accurately represents actual movement.
    const realVelocity = _calcVelocityFromPositionDelta(car, dtMs);
    const realSpeed = vec.length(realVelocity);
    const stateSpeed = vec.length(car.velocity);

    // If state velocity is significantly higher than real velocity, the car is blocked
    // Blend state velocity toward real velocity to keep physics honest
    if (stateSpeed > 0.1 && realSpeed < stateSpeed * 0.5) {
      // Car is blocked - state says moving fast, reality says not moving
      // Lerp state velocity toward real velocity (75% correction)
      car.velocity = vec.lerp(car.velocity, realVelocity, 0.75);
    }

    // Check for spin-out - uses real speed (actual movement)
    if (Math.abs(car.angularVelocity) > PHYSICS_CONFIG.spinOutThreshold && realSpeed > 6) {
      car.velocity = vec.mul(car.velocity, 0.98);
    }

    // Clamp velocity to max speed
    const finalSpeed = vec.length(car.velocity);
    if (finalSpeed > car.maxSpeed) {
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
    // For physics (impulses/bouncing): use state velocity
    const relVel = vec.sub(carA.velocity, carB.velocity);
    const velAlongNormal = vec.dot(relVel, collisionNormal);
    const closingStateVelocity = velAlongNormal > 0 ? velAlongNormal : 0;
    const stateSpeedA = vec.length(carA.velocity);
    const stateSpeedB = vec.length(carB.velocity);
    const combinedStateSpeed = (stateSpeedA + stateSpeedB) * 0.5;
    const impactSpeed = Math.max(closingStateVelocity, combinedStateSpeed);

    // For DAMAGE: use ACTUAL closing rate based on position change
    // This prevents damage during grinding (cars pushing but not actually closing)
    // prevFrameRealVelocity captures actual movement from last frame
    const actualRelVel = vec.sub(carA.prevFrameRealVelocity, carB.prevFrameRealVelocity);
    const actualClosingRate = vec.dot(actualRelVel, collisionNormal);
    // Only count as damage-worthy if cars were ACTUALLY closing (not just in contact)
    const damageImpactSpeed = actualClosingRate > 1 ? actualClosingRate : 0;

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
  ): { damageA: number; damageB: number } {
    const { carA, carB, normal, penetration, impactSpeed, damageImpactSpeed } = collision;

    // Get STATE speeds (velocity magnitude, NOT actual movement!)
    // In a stalemate, these can be high even though cars aren't moving
    const stateSpeedA = vec.length(carA.velocity);
    const stateSpeedB = vec.length(carB.velocity);

    // ============ MOMENTUM-BASED SEPARATION ============
    // Cars with more momentum "own" less of the penetration correction.
    // A fast car hitting a stationary car should push the stationary one more.
    const momentumA = stateSpeedA + 0.1; // avoid division by zero
    const momentumB = stateSpeedB + 0.1;
    const totalMomentum = momentumA + momentumB;
    // Inverse ratio: fast car gets pushed LESS, slow car gets pushed MORE
    const separationRatioA = momentumB / totalMomentum;
    const separationRatioB = momentumA / totalMomentum;

    const separationTotal = penetration + 2; // extra buffer to prevent re-collision
    carA.position = vec.sub(carA.position, vec.mul(normal, separationTotal * separationRatioA));
    carB.position = vec.add(carB.position, vec.mul(normal, separationTotal * separationRatioB));

    // ============ MOMENTUM-BASED IMPULSE PHYSICS ============
    // Calculate relative velocity along collision normal
    const relVel = vec.sub(carA.velocity, carB.velocity);
    const velAlongNormal = vec.dot(relVel, normal);

    // Only apply impulse if cars are closing (moving toward each other)
    if (velAlongNormal > 0) {
      // Low restitution - cars are heavy metal, not rubber balls
      const restitution = 0.25;

      // ============ MASS-WEIGHTED IMPULSE ============
      // All cars have similar mass - speed difference creates momentum difference
      // but we want grounded physics, not pinball
      const baseMass = 2.0;
      const massA = baseMass + stateSpeedA * 0.15;
      const massB = baseMass + stateSpeedB * 0.15;
      const invMassA = 1 / massA;
      const invMassB = 1 / massB;

      // Impulse formula: j = -(1+e) * Vrel·n / (1/mA + 1/mB)
      const impulseMag = (-(1 + restitution) * velAlongNormal) / (invMassA + invMassB);

      // Apply impulse - lighter car (less momentum) receives MORE velocity change
      const impulseA = vec.mul(normal, impulseMag * invMassA);
      const impulseB = vec.mul(normal, impulseMag * invMassB);

      carA.velocity = vec.add(carA.velocity, impulseA);
      carB.velocity = vec.sub(carB.velocity, impulseB);

      // ============ POST-COLLISION DAMPING ============
      // Heavy cars lose energy in collisions - apply damping to both
      // This prevents the "ice skating" effect
      const collisionDamping = 0.7; // Lose 30% velocity on impact
      carA.velocity = vec.mul(carA.velocity, collisionDamping);
      carB.velocity = vec.mul(carB.velocity, collisionDamping);

      // ============ MOMENTUM TRANSFER ============
      // Faster car pushes slower car, but modestly
      const speedDiff = stateSpeedA - stateSpeedB;
      if (speedDiff > 3) {
        // Car A is faster - B gets pushed along normal
        const pushStrength = Math.min(speedDiff * 0.08, 1.5); // Capped push
        carB.velocity = vec.add(carB.velocity, vec.mul(normal, pushStrength));
        // Attacker loses some momentum
        carA.velocity = vec.mul(carA.velocity, 0.85);
      } else if (speedDiff < -3) {
        // Car B is faster - A gets pushed
        const pushStrength = Math.min(Math.abs(speedDiff) * 0.08, 1.5);
        carA.velocity = vec.sub(carA.velocity, vec.mul(normal, pushStrength));
        carB.velocity = vec.mul(carB.velocity, 0.85);
      }
    }

    // ============ ANGULAR IMPULSE (TORQUE) ============
    // Off-center hits cause rotation. Torque = r × F
    // Hit center → no spin. Hit corner → spin.
    // IMPORTANT: Stationary/slow cars should spin MORE than fast moving cars
    const forwardA = this.getCarForward(carA);
    const forwardB = this.getCarForward(carB);

    // Calculate where the contact point is relative to each car's center
    const contactToA = vec.sub(collision.contactPoint, carA.position);
    const contactToB = vec.sub(collision.contactPoint, carB.position);

    // Cross product gives signed torque arm
    // Flipped sign so hitting right-front spins car left (CCW)
    const torqueArmA = contactToA.y * normal.x - contactToA.x * normal.y;
    const torqueArmB = contactToB.y * normal.x - contactToB.x * normal.y;

    // Normalize torque arm by car half-width to get 0-1 range for corner hits
    const halfWidthA = carA.width / 2;
    const halfWidthB = carB.width / 2;
    const normalizedTorqueA = torqueArmA / halfWidthA;
    const normalizedTorqueB = torqueArmB / halfWidthB;

    // Base angular impulse from the collision
    const baseAngularMultiplier = 0.015; // Halved from 0.03
    const baseImpulse = impactSpeed * baseAngularMultiplier;

    // Speed-based angular resistance: faster cars resist spinning more
    // A stationary car (speed=0) gets full spin, a fast car (speed=10) gets less
    const maxSpeed = 10;
    const resistanceA = 0.55 + (stateSpeedA / maxSpeed) * 0.45; // 0.55 to 1.0
    const resistanceB = 0.55 + (stateSpeedB / maxSpeed) * 0.45; // 0.55 to 1.0

    // Inverse resistance = how much spin they receive
    // Stationary car: resistance=0.55, receives ~1.8x multiplier
    // Fast car: resistance=1.0, receives 1x multiplier
    const spinMultiplierA = 1 / resistanceA;
    const spinMultiplierB = 1 / resistanceB;

    // Apply torque with speed-based scaling
    const angularImpulseA = normalizedTorqueA * baseImpulse * spinMultiplierA;
    const angularImpulseB = normalizedTorqueB * baseImpulse * spinMultiplierB;

    // Cap max angular change per collision
    const maxAngularChange = 0.35; // Halved from 0.35
    const clampedImpulseA = Math.max(-maxAngularChange, Math.min(maxAngularChange, angularImpulseA));
    const clampedImpulseB = Math.max(-maxAngularChange, Math.min(maxAngularChange, angularImpulseB));

    carA.angularVelocity += clampedImpulseA;
    carB.angularVelocity -= clampedImpulseB;

    // Light damping - allow spin to follow through
    carA.angularVelocity *= 0.95;
    carB.angularVelocity *= 0.95;

    // Calculate damage using damageImpactSpeed
    // Based on log analysis: max car speed is ~10, typical collisions have damageImpactSpeed 8-15
    // Most collisions were at 8-10, so lowering threshold to allow more damage
    const MIN_DAMAGE_SPEED = 6;

    // Cleanup old cooldowns periodically (sim-time, deterministic)
    cleanupCooldowns(nowMs, cooldowns);

    if (damageImpactSpeed < MIN_DAMAGE_SPEED) {
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
      return { damageA: 0, damageB: 0 };
    }

    // Use REAL speeds for damage calculation (from actual position movement, not state velocity)
    // prevFrameRealVelocity captures how much each car ACTUALLY moved last frame
    const actualSpeedA = vec.length(carA.prevFrameRealVelocity);
    const actualSpeedB = vec.length(carB.prevFrameRealVelocity);

    // Use damageImpactSpeed from collision - it's calculated from prevFrameRealVelocity
    // which captures actual movement before collision resolution modified anything
    const actualDamageImpactSpeed = damageImpactSpeed;

    // Check collision cooldown - prevents grinding damage from repeated collisions
    if (!canDealDamage(carA.id, carB.id, nowMs, cooldowns)) {
      return { damageA: 0, damageB: 0 };
    }

    // Damage scales with ACTUAL relative impact speed (not state velocity!)
    // Use actualDamageImpactSpeed which is based on true position movement
    // Scale formula to realistic max observed
    const REALISTIC_MAX_IMPACT = 10;
    const speedFactor = Math.min(1, actualDamageImpactSpeed / REALISTIC_MAX_IMPACT);
    // At max impact (15): baseDamage = 15 * 2.0 * 0.94 = 28 total, split = 14 each (strong hit)
    // At typical impact (10): baseDamage = 10 * 2.0 * 0.625 = 12.5 total, split = 6 each (medium hit)
    // At threshold (6): baseDamage = 6 * 2.0 * 0.375 = 4.5 total, split = 2.25 each (light hit)
    const baseDamage = actualDamageImpactSpeed * CAR_CONFIG.baseDamageMultiplier * speedFactor;

    let damageA: number;
    let damageB: number;

    // Attacker (faster car) takes less damage, target takes more
    // Use ACTUAL speeds (movement) instead of state velocity!
    if (actualSpeedA > actualSpeedB + 2) {
      // Car A is attacking - A takes 15%, B takes 85%
      damageA = baseDamage * 0.15;
      damageB = baseDamage * 0.85;
    } else if (actualSpeedB > actualSpeedA + 2) {
      // Car B is attacking - B takes 15%, A takes 85%
      damageA = baseDamage * 0.85;
      damageB = baseDamage * 0.15;
    } else {
      // Similar speeds - split evenly
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

    return { damageA, damageB };
  }

  checkWallCollision(car: CarSim): WallCollision | null {
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
      // car.velocity IS accurate after velocity correction
      const speed = vec.length(car.velocity);
      const impactSpeed = Math.abs(vec.dot(car.velocity, collisionNormal));
      return {
        car,
        normal: collisionNormal,
        penetration: maxPenetration,
        impactSpeed: impactSpeed > 0 ? impactSpeed : speed * 0.5,
        contactPoint,
      };
    }

    return null;
  }

  resolveWallCollision(collision: WallCollision): number {
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

    // Calculate wall damage - car.velocity IS accurate after velocity correction
    const actualImpactSpeed = Math.abs(vec.dot(car.velocity, normal));

    let damage = 0;
    if (actualImpactSpeed > CAR_CONFIG.minDamageSpeed * 0.5) {
      damage = actualImpactSpeed * CAR_CONFIG.wallDamageMultiplier;
    }

    return damage;
  }

  isCarPinned(car: CarSim, cars: CarSim[], wallCollision: WallCollision | null): boolean {
    if (!wallCollision) return false;

    // car.velocity IS accurate after velocity correction
    const speed = vec.length(car.velocity);
    if (speed > 3) return false; // Car is actually moving, not pinned

    for (const other of cars) {
      if (other.id === car.id || !other.isAlive) continue;
      const dist = vec.distance(car.position, other.position);
      if (dist < car.width + other.width) {
        // Check if other car is actually moving towards this car
        const towardsCar = vec.normalize(vec.sub(car.position, other.position));
        const pushingTowards = vec.dot(other.velocity, towardsCar);
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

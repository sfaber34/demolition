// Physics Engine for Demolition Derby
import { ARENA_CONFIG, CAR_CONFIG, Car, Collision, PHYSICS_CONFIG, Vector2D, WallCollision } from "./types";

// Vector utilities
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

// Get the four corners of a car (OBB)
export function getCarCorners(car: Car): Vector2D[] {
  const halfW = car.width / 2;
  const halfH = car.height / 2;
  const corners = [
    { x: halfW, y: -halfH }, // front-right
    { x: halfW, y: halfH }, // front-left
    { x: -halfW, y: halfH }, // back-left
    { x: -halfW, y: -halfH }, // back-right
  ];
  return corners.map(c => vec.add(car.position, vec.rotate(c, car.rotation)));
}

// Get car's forward direction
export function getCarForward(car: Car): Vector2D {
  return vec.fromAngle(car.rotation);
}

// Get car's right direction
export function getCarRight(car: Car): Vector2D {
  return vec.fromAngle(car.rotation + Math.PI / 2);
}

// Separating Axis Theorem for OBB collision
function projectOntoAxis(corners: Vector2D[], axis: Vector2D): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const corner of corners) {
    const projection = vec.dot(corner, axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }
  return { min, max };
}

function getAxes(corners: Vector2D[]): Vector2D[] {
  const axes: Vector2D[] = [];
  for (let i = 0; i < corners.length; i++) {
    const next = (i + 1) % corners.length;
    const edge = vec.sub(corners[next], corners[i]);
    axes.push(vec.normalize(vec.perpendicular(edge)));
  }
  return axes;
}

function overlapOnAxis(
  cornersA: Vector2D[],
  cornersB: Vector2D[],
  axis: Vector2D,
): { overlap: number; overlapping: boolean } {
  const projA = projectOntoAxis(cornersA, axis);
  const projB = projectOntoAxis(cornersB, axis);
  const overlap = Math.min(projA.max - projB.min, projB.max - projA.min);
  return { overlap, overlapping: overlap > 0 };
}

// Check collision between two cars using SAT
export function checkCarCollision(carA: Car, carB: Car): Collision | null {
  if (!carA.isAlive || !carB.isAlive) return null;

  const cornersA = getCarCorners(carA);
  const cornersB = getCarCorners(carB);
  const axesA = getAxes(cornersA);
  const axesB = getAxes(cornersB);
  const allAxes = [...axesA, ...axesB];

  let minOverlap = Infinity;
  let collisionNormal: Vector2D = { x: 0, y: 0 };

  for (const axis of allAxes) {
    const { overlap, overlapping } = overlapOnAxis(cornersA, cornersB, axis);
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

  // Calculate impact speed - use COMBINED approach:
  // For head-on: high relative velocity
  // For chasing: use absolute speeds since they're actually colliding
  const relVel = vec.sub(carA.velocity, carB.velocity);
  const relativeImpact = Math.abs(vec.dot(relVel, collisionNormal));

  // Also consider combined speed for side impacts and chasing
  // Higher multiplier = more damage from chasing/side hits
  const speedA = vec.length(carA.velocity);
  const speedB = vec.length(carB.velocity);
  const combinedSpeed = (speedA + speedB) * 0.5; // Higher multiplier for more action

  // Use the higher of relative impact or combined speed
  const impactSpeed = Math.max(relativeImpact, combinedSpeed);

  // Contact point (midpoint between centers, projected towards collision)
  const contactPoint = vec.lerp(carA.position, carB.position, 0.5);

  return {
    carA,
    carB,
    normal: collisionNormal,
    penetration: minOverlap,
    impactSpeed,
    contactPoint,
  };
}

// Check collision between car and arena walls
export function checkWallCollision(car: Car): WallCollision | null {
  if (!car.isAlive) return null;

  const corners = getCarCorners(car);
  const innerLeft = ARENA_CONFIG.wallThickness;
  const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerTop = ARENA_CONFIG.wallThickness;
  const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  let maxPenetration = 0;
  let collisionNormal: Vector2D = { x: 0, y: 0 };
  let contactPoint: Vector2D = { x: 0, y: 0 };

  for (const corner of corners) {
    // Left wall
    if (corner.x < innerLeft) {
      const pen = innerLeft - corner.x;
      if (pen > maxPenetration) {
        maxPenetration = pen;
        collisionNormal = { x: 1, y: 0 };
        contactPoint = corner;
      }
    }
    // Right wall
    if (corner.x > innerRight) {
      const pen = corner.x - innerRight;
      if (pen > maxPenetration) {
        maxPenetration = pen;
        collisionNormal = { x: -1, y: 0 };
        contactPoint = corner;
      }
    }
    // Top wall
    if (corner.y < innerTop) {
      const pen = innerTop - corner.y;
      if (pen > maxPenetration) {
        maxPenetration = pen;
        collisionNormal = { x: 0, y: 1 };
        contactPoint = corner;
      }
    }
    // Bottom wall
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

// Resolve collision between two cars
export function resolveCarCollision(collision: Collision): { damageA: number; damageB: number } {
  const { carA, carB, normal, penetration, impactSpeed } = collision;

  // Separate cars
  const separation = vec.mul(normal, penetration / 2 + 1);
  carA.position = vec.sub(carA.position, separation);
  carB.position = vec.add(carB.position, separation);

  // Calculate collision response
  const relVel = vec.sub(carA.velocity, carB.velocity);
  const velAlongNormal = vec.dot(relVel, normal);

  // Don't resolve if velocities are separating
  if (velAlongNormal > 0) {
    // Apply impulse with bounce
    const restitution = PHYSICS_CONFIG.bounceRestitution;
    const impulse = (-(1 + restitution) * velAlongNormal) / 2;
    const impulseVec = vec.mul(normal, impulse);

    carA.velocity = vec.add(carA.velocity, impulseVec);
    carB.velocity = vec.sub(carB.velocity, impulseVec);
  }

  // Calculate angular impulse based on contact point relative to center
  const contactToA = vec.sub(collision.contactPoint, carA.position);
  const contactToB = vec.sub(collision.contactPoint, carB.position);

  // Cross product in 2D gives angular impulse
  const angularImpulseA = (contactToA.x * normal.y - contactToA.y * normal.x) * impactSpeed * 0.002;
  const angularImpulseB = (contactToB.x * normal.y - contactToB.y * normal.x) * impactSpeed * 0.002;

  // Apply angular impulse (spin-out effect)
  carA.angularVelocity += angularImpulseA / carA.traction;
  carB.angularVelocity -= angularImpulseB / carB.traction;

  // Calculate damage based on impact speed
  let damageA = 0;
  let damageB = 0;

  // Very low threshold - stationary bumps don't hurt
  const MIN_DAMAGE_SPEED = 5;
  if (impactSpeed < MIN_DAMAGE_SPEED) {
    return { damageA: 0, damageB: 0 };
  }

  // Higher speeds = more damage (exponential scaling)
  const speedFactor = Math.min(1, impactSpeed / 100);
  // Base 5 damage per collision + speed bonus
  const baseDamage = 5 + impactSpeed * CAR_CONFIG.baseDamageMultiplier * (0.4 + speedFactor * 0.6);

  // Determine who hit whom (car moving faster towards collision point takes less damage)
  const speedA = vec.length(carA.velocity);
  const speedB = vec.length(carB.velocity);

  // Attacker (higher speed) deals more damage, takes less
  if (speedA > speedB + 25) {
    damageA = baseDamage * 0.2;
    damageB = baseDamage * 1.5;
  } else if (speedB > speedA + 25) {
    damageA = baseDamage * 1.5;
    damageB = baseDamage * 0.2;
  } else {
    // Both moving at similar speeds - both take moderate damage
    damageA = baseDamage * 0.6;
    damageB = baseDamage * 0.6;
  }

  // Side/rear hits deal more damage (vulnerable spots)
  const forwardA = getCarForward(carA);
  const forwardB = getCarForward(carB);
  const hitAngleA = Math.abs(vec.dot(forwardA, normal));
  const hitAngleB = Math.abs(vec.dot(forwardB, normal));

  // If hit from side (hitAngle close to 0), take more damage
  damageA *= 1 + (1 - hitAngleA) * 0.8;
  damageB *= 1 + (1 - hitAngleB) * 0.8;

  // Cap maximum damage per hit - allow BIG HITS but no instant kills
  damageA = Math.min(damageA, 35);
  damageB = Math.min(damageB, 35);

  return { damageA, damageB };
}

// Resolve wall collision
export function resolveWallCollision(collision: WallCollision): number {
  const { car, normal, penetration, impactSpeed } = collision;

  // Push car away from wall
  car.position = vec.add(car.position, vec.mul(normal, penetration + 2));

  // Reflect velocity with bounce
  const velAlongNormal = vec.dot(car.velocity, normal);
  if (velAlongNormal < 0) {
    const restitution = PHYSICS_CONFIG.bounceRestitution * 0.7;
    car.velocity = vec.sub(car.velocity, vec.mul(normal, velAlongNormal * (1 + restitution)));
  }

  // Add some angular velocity on wall hit
  const perpComponent = car.velocity.x * normal.y - car.velocity.y * normal.x;
  car.angularVelocity += (perpComponent * 0.003) / car.traction;

  // Calculate wall damage
  let damage = 0;
  if (impactSpeed > CAR_CONFIG.minDamageSpeed * 0.5) {
    damage = impactSpeed * CAR_CONFIG.wallDamageMultiplier;
  }

  return damage;
}

// Update car physics
export function updateCarPhysics(car: Car, deltaTime: number): void {
  if (!car.isAlive) return;

  const dt = deltaTime / 16.67; // Normalize to 60fps

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

  // Lateral friction (cars grip better in their forward direction)
  const forward = getCarForward(car);
  const right = getCarRight(car);
  const forwardSpeed = vec.dot(car.velocity, forward);
  const lateralSpeed = vec.dot(car.velocity, right);

  // Apply more friction to lateral movement based on traction
  const lateralFriction = 0.85 - car.traction * 0.1;
  const newLateralSpeed = lateralSpeed * lateralFriction;

  car.velocity = vec.add(vec.mul(forward, forwardSpeed), vec.mul(right, newLateralSpeed));

  // Check for spin-out (high angular velocity with movement)
  const speed = vec.length(car.velocity);
  if (Math.abs(car.angularVelocity) > PHYSICS_CONFIG.spinOutThreshold && speed > 50) {
    // Reduce traction temporarily during spin
    car.velocity = vec.mul(car.velocity, 0.98);
  }

  // Clamp velocity to max speed
  if (speed > car.maxSpeed) {
    car.velocity = vec.mul(vec.normalize(car.velocity), car.maxSpeed);
  }
}

// Check if a car is pinned against a wall by another car
export function isCarPinned(car: Car, cars: Car[], wallCollision: WallCollision | null): boolean {
  if (!wallCollision) return false;

  const speed = vec.length(car.velocity);
  if (speed > 20) return false; // Not pinned if moving

  // Check if another car is pushing this car
  for (const other of cars) {
    if (other.id === car.id || !other.isAlive) continue;
    const dist = vec.distance(car.position, other.position);
    if (dist < car.width + other.width) {
      // Another car is close
      const towardsCar = vec.normalize(vec.sub(car.position, other.position));
      const pushingTowards = vec.dot(other.velocity, towardsCar);
      if (pushingTowards > 20) {
        return true; // Being pushed towards wall
      }
    }
  }

  return false;
}

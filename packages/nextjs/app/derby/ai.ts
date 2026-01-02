// AGGRESSIVE AI Driver System for Demolition Derby
// Philosophy: Orbit the arena, build speed, dive in for BIG HITS
// Two winners: Last car standing AND most damage dealt.
import { getCarCorners, getCarForward, vec } from "./physics";
import { ARENA_CONFIG, Car, Vector2D } from "./types";

// AI States - orbit around arena, then strike
type AIBehavior = "orbiting" | "striking" | "repositioning";

// Arena center and orbit settings
const CENTER = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
const ORBIT_RADIUS = Math.min(ARENA_CONFIG.width, ARENA_CONFIG.height) * 0.38; // Close to walls
const MIN_ORBIT_TIME = 1500; // Minimum time orbiting before striking (ms)
const MAX_ORBIT_TIME = 4000; // Maximum orbit time before forced strike

// Get the nearest alive enemy
function getNearestTarget(self: Car, cars: Car[]): Car | undefined {
  let nearest: Car | undefined = undefined;
  let minDist = Infinity;

  for (const other of cars) {
    if (other.id === self.id || !other.isAlive) continue;
    const dist = vec.distance(self.position, other.position);
    if (dist < minDist) {
      minDist = dist;
      nearest = other;
    }
  }
  return nearest;
}

// Get weakest alive enemy (to finish them off)
function getWeakestTarget(self: Car, cars: Car[]): Car | undefined {
  let weakest: Car | undefined = undefined;
  let minHealth = Infinity;

  for (const other of cars) {
    if (other.id === self.id || !other.isAlive) continue;
    if (other.health < minHealth) {
      minHealth = other.health;
      weakest = other;
    }
  }
  return weakest;
}

// Find a target that's more towards the center (good strike opportunity)
function getCenterTarget(self: Car, cars: Car[]): Car | undefined {
  let best: Car | undefined = undefined;
  let bestScore = -Infinity;

  for (const other of cars) {
    if (other.id === self.id || !other.isAlive) continue;

    const otherDistFromCenter = vec.distance(other.position, CENTER);
    const myDistFromCenter = vec.distance(self.position, CENTER);

    // Prefer targets closer to center than us (we're on the edge)
    // Also prefer weaker targets
    const centerScore = myDistFromCenter - otherDistFromCenter;
    const healthScore = (100 - other.health) * 0.5;
    const score = centerScore + healthScore;

    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

// Check if position is near the arena edge (good for orbiting)
function isNearEdge(pos: Vector2D): boolean {
  const distFromCenter = vec.distance(pos, CENTER);
  return distFromCenter > ORBIT_RADIUS * 0.7;
}

// Get the tangent direction for orbiting (clockwise or counter-clockwise)
function getOrbitDirection(car: Car, clockwise: boolean): Vector2D {
  const toCenter = vec.sub(CENTER, car.position);
  const tangent = clockwise ? { x: -toCenter.y, y: toCenter.x } : { x: toCenter.y, y: -toCenter.x };
  return vec.normalize(tangent);
}

// Check if car is heading towards a wall
function isHeadingTowardsWall(car: Car): boolean {
  const speed = vec.length(car.velocity);
  if (speed < 20) return false;

  const margin = 60;
  const lookAhead = speed * 0.5;
  const futurePos = vec.add(car.position, vec.mul(vec.normalize(car.velocity), lookAhead));

  const corners = getCarCorners(car);
  const checkPoints = [futurePos, ...corners];

  for (const pos of checkPoints) {
    if (pos.x < ARENA_CONFIG.wallThickness + margin) return true;
    if (pos.x > ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - margin) return true;
    if (pos.y < ARENA_CONFIG.wallThickness + margin) return true;
    if (pos.y > ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - margin) return true;
  }
  return false;
}

// Determine which orbit direction is better (away from walls)
function getBestOrbitDirection(car: Car): boolean {
  // Try both directions, pick the one that doesn't hit a wall
  const clockwiseTangent = getOrbitDirection(car, true);
  const counterTangent = getOrbitDirection(car, false);

  const speed = vec.length(car.velocity);
  const lookAhead = Math.max(80, speed * 0.6);

  const clockwisePos = vec.add(car.position, vec.mul(clockwiseTangent, lookAhead));
  const counterPos = vec.add(car.position, vec.mul(counterTangent, lookAhead));

  // Check which position is safer
  const clockwiseSafe = isPositionSafe(clockwisePos);
  const counterSafe = isPositionSafe(counterPos);

  if (clockwiseSafe && !counterSafe) return true;
  if (counterSafe && !clockwiseSafe) return false;

  // Both safe or both unsafe - pick based on current velocity to maintain momentum
  const clockwiseAlign = vec.dot(vec.normalize(car.velocity), clockwiseTangent);
  const counterAlign = vec.dot(vec.normalize(car.velocity), counterTangent);

  return clockwiseAlign > counterAlign;
}

function isPositionSafe(pos: Vector2D): boolean {
  const margin = 50;
  return (
    pos.x > ARENA_CONFIG.wallThickness + margin &&
    pos.x < ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - margin &&
    pos.y > ARENA_CONFIG.wallThickness + margin &&
    pos.y < ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - margin
  );
}

// Update AI state machine
export function updateAI(car: Car, cars: Car[], deltaTime: number): void {
  if (!car.isAlive) return;

  const speed = vec.length(car.velocity);
  const distFromCenter = vec.distance(car.position, CENTER);

  // Track movement for stuck detection
  const distMoved = vec.distance(car.position, car.lastPosition);
  if (distMoved < 1.5) {
    car.stuckTimer += deltaTime;
  } else {
    car.stuckTimer = 0;
  }
  car.lastPosition = { ...car.position };

  // Get current behavior
  const behavior = car.aiState as AIBehavior;

  // Find a target
  let target = cars.find(c => c.id === car.targetId && c.isAlive);
  if (!target) {
    target = getCenterTarget(car, cars) ?? getNearestTarget(car, cars);
    car.targetId = target?.id ?? null;
  }

  // Finish off weak targets immediately
  const weakest = getWeakestTarget(car, cars);
  if (weakest && weakest.health < 20 && vec.distance(car.position, weakest.position) < 300) {
    car.targetId = weakest.id;
    car.aiState = "striking";
    return;
  }

  // STUCK - reposition
  if (car.stuckTimer > 800 && speed < 15) {
    car.aiState = "repositioning";
    car.stateTimer = 0;
    car.stuckTimer = 0;
    return;
  }

  // State machine
  switch (behavior) {
    case "orbiting": {
      car.stateTimer += deltaTime;

      // Check if we should strike
      const hasMinOrbitTime = car.stateTimer > MIN_ORBIT_TIME;
      const forcedStrike = car.stateTimer > MAX_ORBIT_TIME;
      const hasGoodSpeed = speed > 60;
      const targetInCenter = target && vec.distance(target.position, CENTER) < ORBIT_RADIUS * 0.8;

      // Strike conditions: orbited enough + good speed + target available
      if ((hasMinOrbitTime && hasGoodSpeed && targetInCenter) || forcedStrike) {
        car.aiState = "striking";
        car.stateTimer = 0;
        // Pick best target for the strike
        target = getCenterTarget(car, cars) ?? getNearestTarget(car, cars);
        car.targetId = target?.id ?? null;
      }

      // If we're too close to center, go back to edge
      if (distFromCenter < ORBIT_RADIUS * 0.5) {
        car.aiState = "repositioning";
        car.stateTimer = 0;
      }
      break;
    }

    case "striking": {
      car.stateTimer += deltaTime;

      // Check if strike is complete (passed through or target dead)
      if (!target || !target.isAlive) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
        car.targetId = null;
        break;
      }

      const distToTarget = vec.distance(car.position, target.position);

      // If we've passed the target or been striking too long, go back to orbiting
      if (car.stateTimer > 2000 || (car.stateTimer > 500 && distToTarget > 350)) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
      }

      // If we're now near the edge after striking, start orbiting
      if (isNearEdge(car.position) && car.stateTimer > 800) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
      }
      break;
    }

    case "repositioning": {
      car.stateTimer += deltaTime;

      // Brief reposition - head towards nearest edge
      if (car.stateTimer > 600 || isNearEdge(car.position)) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
      }
      break;
    }

    default:
      car.aiState = "orbiting";
      car.stateTimer = 0;
  }
}

// Get AI steering and throttle
export function getAIControls(car: Car, cars: Car[]): { throttle: number; steer: number } {
  if (!car.isAlive) return { throttle: 0, steer: 0 };

  const forward = getCarForward(car);
  const speed = vec.length(car.velocity);
  const behavior = car.aiState as AIBehavior;

  let targetDir: Vector2D;
  let throttle = 1.0;

  switch (behavior) {
    case "orbiting": {
      // Orbit around the arena edge, building speed
      const clockwise = getBestOrbitDirection(car);
      const orbitDir = getOrbitDirection(car, clockwise);

      // Blend orbit direction with slight outward push to stay near edge
      const toEdge = vec.normalize(vec.sub(car.position, CENTER));
      const distFromCenter = vec.distance(car.position, CENTER);

      // If too close to center, push outward more
      const edgeWeight = distFromCenter < ORBIT_RADIUS ? 0.4 : 0.1;
      targetDir = vec.normalize(vec.add(vec.mul(orbitDir, 1 - edgeWeight), vec.mul(toEdge, edgeWeight)));

      // Wall avoidance while orbiting
      if (isHeadingTowardsWall(car)) {
        // Steer more towards center temporarily
        const toCenter = vec.normalize(vec.sub(CENTER, car.position));
        targetDir = vec.normalize(vec.add(vec.mul(targetDir, 0.4), vec.mul(toCenter, 0.6)));
      }

      throttle = 1.2; // Build speed while orbiting
      break;
    }

    case "striking": {
      // FULL SPEED at target!
      const target = cars.find(c => c.id === car.targetId && c.isAlive);

      if (target) {
        // Lead the target for better hits
        const distToTarget = vec.distance(car.position, target.position);
        const leadTime = Math.min(0.4, distToTarget / 300);
        const predictedPos = vec.add(target.position, vec.mul(target.velocity, leadTime));
        targetDir = vec.normalize(vec.sub(predictedPos, car.position));
        throttle = 1.5; // Maximum acceleration during strike!
      } else {
        // No target, curve towards center to find one
        targetDir = vec.normalize(vec.sub(CENTER, car.position));
        throttle = 1.0;
      }
      break;
    }

    case "repositioning": {
      // Head towards the nearest edge point
      const toEdge = vec.normalize(vec.sub(car.position, CENTER));
      const edgePoint = vec.add(CENTER, vec.mul(toEdge, ORBIT_RADIUS));
      targetDir = vec.normalize(vec.sub(edgePoint, car.position));

      // If close to wall, orbit instead
      if (isHeadingTowardsWall(car)) {
        const clockwise = getBestOrbitDirection(car);
        targetDir = getOrbitDirection(car, clockwise);
      }

      throttle = 1.0;
      break;
    }

    default:
      targetDir = forward;
      throttle = 1.0;
  }

  // Calculate steering
  const targetAngle = Math.atan2(targetDir.y, targetDir.x);
  let angleDiff = targetAngle - car.rotation;

  // Normalize angle difference
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  // If target is directly behind and we're slow, reverse briefly
  if (Math.abs(angleDiff) > Math.PI * 0.7 && speed < 40) {
    throttle = -0.6;
    angleDiff = angleDiff > 0 ? angleDiff - Math.PI : angleDiff + Math.PI;
  }

  // Steering intensity
  let steer = Math.max(-1, Math.min(1, angleDiff * 2.5));

  // Reduce steering at very high speed to prevent spin-outs
  if (speed > 100) {
    const reduction = Math.min(0.3, (speed - 100) / 150);
    steer *= 1 - reduction;
  }

  return { throttle, steer };
}

// Apply AI controls to car
export function applyAIControls(car: Car, controls: { throttle: number; steer: number }, deltaTime: number): void {
  if (!car.isAlive) return;

  const dt = deltaTime / 16.67;
  const forward = getCarForward(car);
  const speed = vec.length(car.velocity);

  // Apply throttle
  const accelForce = controls.throttle * car.acceleration * car.traction;

  if (controls.throttle > 0) {
    car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt * 1.2));
  } else if (controls.throttle < 0) {
    car.velocity = vec.add(car.velocity, vec.mul(forward, accelForce * dt));
  }

  // Apply steering
  const steerEffectiveness = Math.min(1.2, speed / 30) * car.cornering;
  car.angularVelocity += controls.steer * 0.14 * steerEffectiveness * dt;

  // Clamp angular velocity
  const maxAngularVel = 0.18 / car.traction;
  car.angularVelocity = Math.max(-maxAngularVel, Math.min(maxAngularVel, car.angularVelocity));
}

// Handle impact event
export function onCarImpact(car: Car): void {
  car.lastImpactTime = Date.now();
  // After a hit, go back to orbiting to build speed for next strike
  car.aiState = "orbiting";
  car.stateTimer = 0;
}

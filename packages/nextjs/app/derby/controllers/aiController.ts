// AI Controller - Computes inputs for AI-controlled cars
// This module:
// - Updates AI state machine (orbiting, striking, repositioning)
// - Outputs CarInput (throttle, steer)
// Does NOT directly modify car physics - just sets car.input
import { physicsEngine, vec } from "../physics/PhysicsEngine";
import { AIBehavior, ARENA_CONFIG, CarInput, CarSim, Vector2D } from "../sim/typesSim";

// Constants
const CENTER: Vector2D = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
const ORBIT_RADIUS = Math.min(ARENA_CONFIG.width, ARENA_CONFIG.height) * 0.38;
const MIN_ORBIT_TIME = 1500;
const MAX_ORBIT_TIME = 4000;

// ============ Target Selection ============

function getNearestTarget(self: CarSim, cars: CarSim[]): CarSim | undefined {
  let nearest: CarSim | undefined = undefined;
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

function getWeakestTarget(self: CarSim, cars: CarSim[]): CarSim | undefined {
  let weakest: CarSim | undefined = undefined;
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

function getCenterTarget(self: CarSim, cars: CarSim[]): CarSim | undefined {
  let best: CarSim | undefined = undefined;
  let bestScore = -Infinity;

  for (const other of cars) {
    if (other.id === self.id || !other.isAlive) continue;

    const otherDistFromCenter = vec.distance(other.position, CENTER);
    const myDistFromCenter = vec.distance(self.position, CENTER);

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

// ============ Position Utilities ============

function isNearEdge(pos: Vector2D): boolean {
  const distFromCenter = vec.distance(pos, CENTER);
  return distFromCenter > ORBIT_RADIUS * 0.7;
}

function getOrbitDirection(car: CarSim, clockwise: boolean): Vector2D {
  const toCenter = vec.sub(CENTER, car.position);
  const tangent = clockwise ? { x: -toCenter.y, y: toCenter.x } : { x: toCenter.y, y: -toCenter.x };
  return vec.normalize(tangent);
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

function isHeadingTowardsWall(car: CarSim): boolean {
  const speed = vec.length(car.velocity);
  if (speed < 20) return false;

  const margin = 60;
  const lookAhead = speed * 0.5;
  const futurePos = vec.add(car.position, vec.mul(vec.normalize(car.velocity), lookAhead));

  const corners = physicsEngine.getCarCorners(car);
  const checkPoints = [futurePos, ...corners];

  for (const pos of checkPoints) {
    if (pos.x < ARENA_CONFIG.wallThickness + margin) return true;
    if (pos.x > ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - margin) return true;
    if (pos.y < ARENA_CONFIG.wallThickness + margin) return true;
    if (pos.y > ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - margin) return true;
  }
  return false;
}

function getBestOrbitDirection(car: CarSim): boolean {
  const clockwiseTangent = getOrbitDirection(car, true);
  const counterTangent = getOrbitDirection(car, false);

  const speed = vec.length(car.velocity);
  const lookAhead = Math.max(80, speed * 0.6);

  const clockwisePos = vec.add(car.position, vec.mul(clockwiseTangent, lookAhead));
  const counterPos = vec.add(car.position, vec.mul(counterTangent, lookAhead));

  const clockwiseSafe = isPositionSafe(clockwisePos);
  const counterSafe = isPositionSafe(counterPos);

  if (clockwiseSafe && !counterSafe) return true;
  if (counterSafe && !clockwiseSafe) return false;

  const clockwiseAlign = vec.dot(vec.normalize(car.velocity), clockwiseTangent);
  const counterAlign = vec.dot(vec.normalize(car.velocity), counterTangent);

  return clockwiseAlign > counterAlign;
}

// ============ AI State Machine ============

/**
 * Update AI state machine for a car.
 * Modifies: car.aiState, car.stateTimer, car.targetId, car.stuckTimer, car.lastPosition
 */
export function updateAIState(car: CarSim, cars: CarSim[], dtMs: number): void {
  if (!car.isAlive) return;

  const speed = vec.length(car.velocity);
  const distFromCenter = vec.distance(car.position, CENTER);

  // Track movement for stuck detection
  const distMoved = vec.distance(car.position, car.lastPosition);
  if (distMoved < 1.5) {
    car.stuckTimer += dtMs;
  } else {
    car.stuckTimer = 0;
  }
  car.lastPosition = { x: car.position.x, y: car.position.y };

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
      car.stateTimer += dtMs;

      const hasMinOrbitTime = car.stateTimer > MIN_ORBIT_TIME;
      const forcedStrike = car.stateTimer > MAX_ORBIT_TIME;
      const hasGoodSpeed = speed > 60;
      const targetInCenter = target && vec.distance(target.position, CENTER) < ORBIT_RADIUS * 0.8;

      if ((hasMinOrbitTime && hasGoodSpeed && targetInCenter) || forcedStrike) {
        car.aiState = "striking";
        car.stateTimer = 0;
        target = getCenterTarget(car, cars) ?? getNearestTarget(car, cars);
        car.targetId = target?.id ?? null;
      }

      if (distFromCenter < ORBIT_RADIUS * 0.5) {
        car.aiState = "repositioning";
        car.stateTimer = 0;
      }
      break;
    }

    case "striking": {
      car.stateTimer += dtMs;

      if (!target || !target.isAlive) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
        car.targetId = null;
        break;
      }

      const distToTarget = vec.distance(car.position, target.position);

      if (car.stateTimer > 2000 || (car.stateTimer > 500 && distToTarget > 350)) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
      }

      if (isNearEdge(car.position) && car.stateTimer > 800) {
        car.aiState = "orbiting";
        car.stateTimer = 0;
      }
      break;
    }

    case "repositioning": {
      car.stateTimer += dtMs;

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

/**
 * Compute AI control inputs for a car.
 * Does NOT modify the car - returns the input to be applied.
 */
export function computeAIInputs(car: CarSim, cars: CarSim[]): CarInput {
  if (!car.isAlive) return { throttle: 0, steer: 0 };

  const forward = physicsEngine.getCarForward(car);
  const speed = vec.length(car.velocity);
  const behavior = car.aiState as AIBehavior;

  let targetDir: Vector2D;
  let throttle = 1.0;

  switch (behavior) {
    case "orbiting": {
      const clockwise = getBestOrbitDirection(car);
      const orbitDir = getOrbitDirection(car, clockwise);

      const toEdge = vec.normalize(vec.sub(car.position, CENTER));
      const distFromCenter = vec.distance(car.position, CENTER);

      const edgeWeight = distFromCenter < ORBIT_RADIUS ? 0.4 : 0.1;
      targetDir = vec.normalize(vec.add(vec.mul(orbitDir, 1 - edgeWeight), vec.mul(toEdge, edgeWeight)));

      if (isHeadingTowardsWall(car)) {
        const toCenter = vec.normalize(vec.sub(CENTER, car.position));
        targetDir = vec.normalize(vec.add(vec.mul(targetDir, 0.4), vec.mul(toCenter, 0.6)));
      }

      throttle = 1.2;
      break;
    }

    case "striking": {
      const target = cars.find(c => c.id === car.targetId && c.isAlive);

      if (target) {
        const distToTarget = vec.distance(car.position, target.position);
        const leadTime = Math.min(0.4, distToTarget / 300);
        const predictedPos = vec.add(target.position, vec.mul(target.velocity, leadTime));
        targetDir = vec.normalize(vec.sub(predictedPos, car.position));
        throttle = 1.5;
      } else {
        targetDir = vec.normalize(vec.sub(CENTER, car.position));
        throttle = 1.0;
      }
      break;
    }

    case "repositioning": {
      const toEdge = vec.normalize(vec.sub(car.position, CENTER));
      const edgePoint = vec.add(CENTER, vec.mul(toEdge, ORBIT_RADIUS));
      targetDir = vec.normalize(vec.sub(edgePoint, car.position));

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

  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  // If target is behind and slow, reverse
  if (Math.abs(angleDiff) > Math.PI * 0.7 && speed < 40) {
    throttle = -0.6;
    angleDiff = angleDiff > 0 ? angleDiff - Math.PI : angleDiff + Math.PI;
  }

  let steer = Math.max(-1, Math.min(1, angleDiff * 2.5));

  // Reduce steering at high speed
  if (speed > 100) {
    const reduction = Math.min(0.3, (speed - 100) / 150);
    steer *= 1 - reduction;
  }

  return { throttle, steer };
}

/**
 * Handle impact event - transitions AI to orbiting state.
 * Call this after a collision is detected.
 */
export function onAICarImpact(car: CarSim): void {
  car.aiState = "orbiting";
  car.stateTimer = 0;
}

/**
 * Full AI update: update state + compute and set inputs.
 * This is the main entry point for AI-controlled cars.
 */
export function updateAI(car: CarSim, cars: CarSim[], dtMs: number): void {
  updateAIState(car, cars, dtMs);
  car.input = computeAIInputs(car, cars);
}

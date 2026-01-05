// AI Helper - Easy access to car data for AI decision making
// Usage: const me = aiView(myCar); me.speed, me.distanceTo(other), etc.
import { Vector2D, getCarForward, getCarRight, getCarWallDistance, getSpeed, vec } from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";

/**
 * AI-friendly view of a car with easy access to common data.
 * All computed values are cached for the frame - call aiView() once per car per frame.
 */
export interface AICarView {
  // The underlying car
  car: CarSim;

  // Identity
  id: string;
  name: string;

  // Position & movement
  x: number;
  y: number;
  speed: number;
  rotation: number; // radians
  rotationDeg: number; // degrees (easier for debugging)

  // Direction vectors
  forward: Vector2D;
  right: Vector2D;

  // State
  health: number;
  healthPercent: number;
  isAlive: boolean;

  // Environment
  wallDistance: number;

  // Helpers for targeting other cars
  distanceTo(other: CarSim | AICarView): number;
  angleTo(other: CarSim | AICarView): number; // radians, 0 = directly ahead, positive = right
  angleToTarget(x: number, y: number): number;
  isFacing(other: CarSim | AICarView, toleranceRad?: number): boolean;
  isMovingToward(other: CarSim | AICarView): boolean;

  // Prediction
  predictPosition(frames: number): Vector2D; // Where will this car be in N frames?
}

/**
 * Create an AI-friendly view of a car.
 * Call this once per car per frame - values are computed on creation.
 */
export function aiView(car: CarSim): AICarView {
  const speed = getSpeed(car);
  const forward = getCarForward(car);
  const right = getCarRight(car);
  const wallDistance = getCarWallDistance(car);

  const getCar = (other: CarSim | AICarView): CarSim => {
    return "car" in other ? other.car : other;
  };

  return {
    car,
    id: car.id,
    name: car.name,

    x: car.position.x,
    y: car.position.y,
    speed,
    rotation: car.rotation,
    rotationDeg: (car.rotation * 180) / Math.PI,

    forward,
    right,

    health: car.health,
    healthPercent: car.health / car.maxHealth,
    isAlive: car.isAlive,

    wallDistance,

    distanceTo(other: CarSim | AICarView): number {
      const o = getCar(other);
      return vec.distance(car.position, o.position);
    },

    angleTo(other: CarSim | AICarView): number {
      const o = getCar(other);
      return angleToTarget(car, o.position.x, o.position.y);
    },

    angleToTarget(x: number, y: number): number {
      return angleToTarget(car, x, y);
    },

    isFacing(other: CarSim | AICarView, toleranceRad: number = Math.PI / 4): boolean {
      const angle = Math.abs(this.angleTo(other));
      return angle < toleranceRad;
    },

    isMovingToward(other: CarSim | AICarView): boolean {
      if (speed < 0.5) return false; // Not really moving
      const o = getCar(other);
      const toOther = vec.normalize(vec.sub(o.position, car.position));
      const velocityDir = vec.normalize(car.velocity);
      return vec.dot(velocityDir, toOther) > 0.5; // Moving roughly toward
    },

    predictPosition(frames: number): Vector2D {
      // Simple linear prediction (doesn't account for steering/collisions)
      return {
        x: car.position.x + car.velocity.x * frames,
        y: car.position.y + car.velocity.y * frames,
      };
    },
  };
}

/**
 * Get angle from a car to a target point.
 * Returns radians: 0 = directly ahead, positive = target is to the right, negative = left.
 * Range: -PI to PI
 */
function angleToTarget(car: CarSim, targetX: number, targetY: number): number {
  const dx = targetX - car.position.x;
  const dy = targetY - car.position.y;
  const targetAngle = Math.atan2(dy, dx);
  let diff = targetAngle - car.rotation;

  // Normalize to -PI to PI
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  return diff;
}

// ============ World Queries ============

/**
 * Find the nearest alive enemy car.
 */
export function findNearestEnemy(me: CarSim, allCars: CarSim[]): CarSim | null {
  let nearest: CarSim | null = null;
  let nearestDist = Infinity;

  for (const other of allCars) {
    if (other.id === me.id || !other.isAlive) continue;
    const dist = vec.distance(me.position, other.position);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = other;
    }
  }

  return nearest;
}

/**
 * Find the weakest (lowest health) alive enemy car.
 */
export function findWeakestEnemy(me: CarSim, allCars: CarSim[]): CarSim | null {
  let weakest: CarSim | null = null;
  let lowestHealth = Infinity;

  for (const other of allCars) {
    if (other.id === me.id || !other.isAlive) continue;
    if (other.health < lowestHealth) {
      lowestHealth = other.health;
      weakest = other;
    }
  }

  return weakest;
}

/**
 * Get all alive enemy cars sorted by distance (nearest first).
 */
export function getEnemiesByDistance(me: CarSim, allCars: CarSim[]): CarSim[] {
  return allCars
    .filter(c => c.id !== me.id && c.isAlive)
    .sort((a, b) => {
      const distA = vec.distance(me.position, a.position);
      const distB = vec.distance(me.position, b.position);
      return distA - distB;
    });
}

/**
 * Check if a car is in danger (low health or near wall).
 */
export function isInDanger(car: CarSim): boolean {
  const healthPercent = car.health / car.maxHealth;
  const wallDist = getCarWallDistance(car);
  return healthPercent < 0.3 || wallDist < 20;
}

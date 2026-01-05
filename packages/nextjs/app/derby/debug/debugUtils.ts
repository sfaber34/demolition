// Debug utilities for game values
// These wrap the physics engine functions for convenience.
// Since car.velocity is corrected to match reality, it IS the true velocity.
import {
  type Vector2D,
  getCarCorners as physicsGetCarCorners,
  getCarForward as physicsGetCarForward,
  getCarRear as physicsGetCarRear,
  getCarRight as physicsGetCarRight,
  getCarWallDistance as physicsGetCarWallDistance,
  getSpeed as physicsGetSpeed,
  getVelocity as physicsGetVelocity,
} from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";

// ============ Car Geometry (wrappers around physics engine) ============

/** Get the 4 corners of a car - wraps physics engine function */
export function getCarCorners(car: CarSim): Vector2D[] {
  return physicsGetCarCorners(car);
}

/** Get car's forward direction vector - wraps physics engine function */
export function getCarForward(car: CarSim): Vector2D {
  return physicsGetCarForward(car);
}

/** Get car's right direction vector - wraps physics engine function */
export function getCarRight(car: CarSim): Vector2D {
  return physicsGetCarRight(car);
}

/** Get rear center position of car - wraps physics engine function */
export function getCarRear(car: CarSim): Vector2D {
  return physicsGetCarRear(car);
}

// ============ Wall Distance (wrapper around physics engine) ============

/** Get distance from car to nearest wall - wraps physics engine function */
export function getWallDistance(car: CarSim): number {
  return physicsGetCarWallDistance(car);
}

/**
 * Get color based on wall distance (green=safe, yellow=caution, red=danger).
 * Tiers match the game's wall-safety heuristics.
 */
export function getWallDistColor(dist: number): string {
  if (dist < 10) return "#ff4444"; // Critical - red (almost touching)
  if (dist < 35) return "#ffaa00"; // Danger - orange
  if (dist < 65) return "#ffff44"; // Caution - yellow
  return "#44ff44"; // Safe - green
}

// ============ Velocity (car.velocity IS the true velocity) ============

/** Get car's velocity - this IS the true velocity after physics correction */
export function getVelocity(car: CarSim): Vector2D {
  return physicsGetVelocity(car);
}

/** Get car's speed - this IS the true speed after physics correction */
export function getSpeed(car: CarSim): number {
  return physicsGetSpeed(car);
}

/** Get color for speed display (0-10 range) */
export function getSpeedColor(speed: number): string {
  if (speed > 6) return "#44ff44"; // Fast - green
  if (speed > 3) return "#ffff44"; // Medium - yellow
  return "#aaaaaa"; // Slow - gray
}

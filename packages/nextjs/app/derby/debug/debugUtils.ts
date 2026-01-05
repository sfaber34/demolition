// Debug utilities for calculating real game values
// These functions wrap the CENTRALIZED physics engine functions
// to ensure debug displays show EXACTLY the same values as the game uses.
import {
  type Vector2D,
  getCarCorners as physicsGetCarCorners,
  getCarForward as physicsGetCarForward,
  getCarRear as physicsGetCarRear,
  getCarRight as physicsGetCarRight,
  getCarWallDistance as physicsGetCarWallDistance,
  getRealSpeed as physicsGetRealSpeed,
  getRealVelocity as physicsGetRealVelocity,
  getStateSpeed as physicsGetStateSpeed,
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

/**
 * Get the REAL velocity of a car based on actual position movement.
 * This wraps the centralized physics engine function.
 *
 * @param car - The car to get real velocity for
 * @param dtMs - Frame time in ms (default 16 for 60fps) - MUST match physics engine
 * @returns Real velocity in same units as car.velocity (0-10 range at max speed)
 */
export function getRealVelocity(car: CarSim, dtMs: number = 16): { x: number; y: number } {
  return physicsGetRealVelocity(car, dtMs);
}

/**
 * Get the REAL speed (magnitude of real velocity).
 * This wraps the centralized physics engine function.
 *
 * @param car - The car to get real speed for
 * @param dtMs - Frame time in ms (default 16 for 60fps) - MUST match physics engine
 * @returns Real speed in same units as car.velocity magnitude (0-10 range at max speed)
 */
export function getRealSpeed(car: CarSim, dtMs: number = 16): number {
  return physicsGetRealSpeed(car, dtMs);
}

/**
 * Get the state velocity speed (physics state, may not reflect actual movement).
 * This wraps the centralized physics engine function.
 */
export function getStateSpeed(car: CarSim): number {
  return physicsGetStateSpeed(car);
}

/**
 * Get color for speed display.
 * Both real speed and state speed are now in the same scale (0-10 range at max).
 */
export function getSpeedColor(speed: number, isRealSpeed: boolean = true): string {
  // Both real and state speed use same scale (max ~10)
  // Real speed may be lower when blocked, state speed may be higher when pushing
  if (isRealSpeed) {
    // Real speed - actual movement, typically 0-10
    if (speed > 6) return "#44ff44"; // Fast - green
    if (speed > 3) return "#ffff44"; // Medium - yellow
    return "#aaaaaa"; // Slow - gray
  } else {
    // State speed - physics state, max achievable is ~10
    if (speed > 8) return "#44ff44"; // Fast - green
    if (speed > 4) return "#ffff44"; // Medium - yellow
    return "#aaaaaa"; // Slow - gray
  }
}

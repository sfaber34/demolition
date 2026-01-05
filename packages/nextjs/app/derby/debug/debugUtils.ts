// Debug utilities for calculating real game values
// These functions use the SAME centralized functions as the game engine
// to ensure debug displays show accurate values.
import {
  getRealSpeed as physicsGetRealSpeed,
  getRealVelocity as physicsGetRealVelocity,
  getStateSpeed as physicsGetStateSpeed,
  vec,
} from "../physics/PhysicsEngine";
import { ARENA_CONFIG, CarSim } from "../sim/typesSim";

// Arena inner bounds (same as physics engine uses)
const innerLeft = ARENA_CONFIG.wallThickness;
const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
const innerTop = ARENA_CONFIG.wallThickness;
const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

/**
 * Get the 4 corners of a car given its center position, rotation, and dimensions.
 * Uses same calculation as physics engine.
 */
export function getCarCorners(car: CarSim): { x: number; y: number }[] {
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

/**
 * Distance from a single point to the nearest wall.
 */
function pointToWallDist(px: number, py: number): number {
  const dx = Math.min(px - innerLeft, innerRight - px);
  const dy = Math.min(py - innerTop, innerBottom - py);
  return Math.min(dx, dy);
}

/**
 * Calculate distance from a car's nearest CORNER to the nearest wall.
 * This matches how the physics engine does wall collision detection.
 */
export function getWallDistance(car: CarSim): number {
  const corners = getCarCorners(car);
  let minDist = Infinity;
  for (const corner of corners) {
    const d = pointToWallDist(corner.x, corner.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
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

// Debug utilities for calculating real game values
// These functions use the same calculations as the game engine
// to ensure debug displays show accurate values.
import { vec } from "../physics/PhysicsEngine";
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
 * This is the true velocity, not the state velocity which can be high
 * when a car is pushing against something but not actually moving.
 */
export function getRealVelocity(car: CarSim): { x: number; y: number } {
  return {
    x: car.position.x - car.lastPosition.x,
    y: car.position.y - car.lastPosition.y,
  };
}

/**
 * Get the REAL speed (magnitude of real velocity).
 */
export function getRealSpeed(car: CarSim): number {
  const realVel = getRealVelocity(car);
  return Math.sqrt(realVel.x * realVel.x + realVel.y * realVel.y);
}

/**
 * Get the state velocity speed (physics state, may not reflect actual movement).
 */
export function getStateSpeed(car: CarSim): number {
  return vec.length(car.velocity);
}

/**
 * Get color for speed display.
 */
export function getSpeedColor(speed: number, isRealSpeed: boolean = true): string {
  // Real speed is per-frame movement, so values are smaller
  if (isRealSpeed) {
    if (speed > 5) return "#44ff44"; // Fast - green
    if (speed > 2) return "#ffff44"; // Medium - yellow
    return "#aaaaaa"; // Slow - gray
  } else {
    // State speed - max achievable is ~10-15 due to friction physics
    if (speed > 8) return "#44ff44"; // Fast - green
    if (speed > 4) return "#ffff44"; // Medium - yellow
    return "#aaaaaa"; // Slow - gray
  }
}

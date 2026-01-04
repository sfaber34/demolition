"use client";

import React from "react";
import { vec } from "../physics/PhysicsEngine";
import { ARENA_CONFIG, CarSim } from "../sim/typesSim";
import { DEBUG_CONFIG } from "./debugConfig";

interface DebugOverlayProps {
  cars: CarSim[];
}

// Arena inner bounds (same as AI uses)
const innerLeft = ARENA_CONFIG.wallThickness;
const innerRight = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
const innerTop = ARENA_CONFIG.wallThickness;
const innerBottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

/**
 * Get the 4 corners of a car given its center position, rotation, and dimensions
 */
function getCarCorners(
  x: number,
  y: number,
  rotation: number,
  carWidth: number,
  carHeight: number,
): { x: number; y: number }[] {
  const halfW = carWidth / 2;
  const halfH = carHeight / 2;
  const corners = [
    { x: halfW, y: -halfH }, // front-right
    { x: halfW, y: halfH }, // front-left
    { x: -halfW, y: halfH }, // back-left
    { x: -halfW, y: -halfH }, // back-right
  ];
  return corners.map(c => vec.add({ x, y }, vec.rotate(c, rotation)));
}

/**
 * Distance from a single point to the nearest wall
 */
function pointToWallDist(px: number, py: number): number {
  const dx = Math.min(px - innerLeft, innerRight - px);
  const dy = Math.min(py - innerTop, innerBottom - py);
  return Math.min(dx, dy);
}

/**
 * Calculate distance from a car's nearest CORNER to the nearest wall.
 * This matches how the physics engine and AI do wall collision detection.
 */
function distToWall(x: number, y: number, rotation: number, carWidth: number, carHeight: number): number {
  const corners = getCarCorners(x, y, rotation, carWidth, carHeight);
  let minDist = Infinity;
  for (const corner of corners) {
    const d = pointToWallDist(corner.x, corner.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Get color based on wall distance (green=safe, yellow=caution, red=danger)
 * NOTE: These thresholds match AI_TUNING in simpleAiController.ts
 */
function getWallDistColor(dist: number): string {
  if (dist < 10) return "#ff4444"; // Critical - red (almost touching)
  if (dist < 35) return "#ffaa00"; // Danger - orange
  if (dist < 65) return "#ffff44"; // Caution - yellow
  return "#44ff44"; // Safe - green
}

/**
 * Debug overlay for a single car
 */
const CarDebugInfo: React.FC<{ car: CarSim }> = ({ car }) => {
  const { position, velocity, rotation, name, width, height } = car;

  // Calculate values we might display
  const wallDist = distToWall(position.x, position.y, rotation, width, height);
  const speed = vec.length(velocity);

  // Build array of text lines to display
  const lines: { text: string; color: string }[] = [];

  if (DEBUG_CONFIG.showWallDistance) {
    lines.push({
      text: `wall: ${Math.round(wallDist)}`,
      color: getWallDistColor(wallDist),
    });
  }

  if (DEBUG_CONFIG.showSpeed) {
    lines.push({
      text: `spd: ${Math.round(speed)}`,
      color: speed > 80 ? "#44ff44" : speed > 40 ? "#ffff44" : "#aaaaaa",
    });
  }

  if (DEBUG_CONFIG.showHealth) {
    const healthPct = (car.health / car.maxHealth) * 100;
    lines.push({
      text: `hp: ${Math.round(car.health)}`,
      color: healthPct > 50 ? "#44ff44" : healthPct > 25 ? "#ffaa00" : "#ff4444",
    });
  }

  if (DEBUG_CONFIG.showCarId) {
    lines.push({
      text: name,
      color: "#ffffff",
    });
  }

  // Starting Y offset above car
  const textStartY = -car.height / 2 - 8 - lines.length * 12;

  return (
    <g transform={`translate(${position.x}, ${position.y})`}>
      {/* Text labels - positioned above car, not rotated */}
      {lines.map((line, i) => (
        <text
          key={i}
          x={0}
          y={textStartY + i * 14}
          textAnchor="middle"
          fill={line.color}
          fontSize={11}
          fontFamily="monospace"
          fontWeight="bold"
          style={{
            textShadow: "0 0 3px #000, 0 0 3px #000",
            pointerEvents: "none",
          }}
        >
          {line.text}
        </text>
      ))}

      {/* Velocity vector arrow */}
      {DEBUG_CONFIG.showVelocityVector && speed > 5 && (
        <line
          x1={0}
          y1={0}
          x2={velocity.x * 0.8}
          y2={velocity.y * 0.8}
          stroke="#00ffff"
          strokeWidth={2}
          markerEnd="url(#arrowhead-cyan)"
        />
      )}

      {/* Forward direction arrow */}
      {DEBUG_CONFIG.showForwardVector && (
        <line
          x1={0}
          y1={0}
          x2={Math.cos(rotation) * 40}
          y2={Math.sin(rotation) * 40}
          stroke="#ff00ff"
          strokeWidth={2}
          strokeDasharray="4,4"
        />
      )}
    </g>
  );
};

/**
 * Main debug overlay component - renders debug info for all cars
 */
export const DebugOverlay: React.FC<DebugOverlayProps> = ({ cars }) => {
  // Early exit if debug is disabled
  if (!DEBUG_CONFIG.enabled) {
    return null;
  }

  // Check if any individual overlay is enabled
  const anyOverlayActive =
    DEBUG_CONFIG.showWallDistance ||
    DEBUG_CONFIG.showSpeed ||
    DEBUG_CONFIG.showVelocityVector ||
    DEBUG_CONFIG.showForwardVector ||
    DEBUG_CONFIG.showCarId ||
    DEBUG_CONFIG.showHealth;

  if (!anyOverlayActive) {
    return null;
  }

  return (
    <g className="debug-overlay">
      {/* Arrow marker definitions */}
      <defs>
        <marker id="arrowhead-cyan" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#00ffff" />
        </marker>
        <marker id="arrowhead-magenta" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#ff00ff" />
        </marker>
      </defs>

      {/* Render debug info for each alive car */}
      {cars
        .filter(car => car.isAlive)
        .map(car => (
          <CarDebugInfo key={`debug-${car.id}`} car={car} />
        ))}
    </g>
  );
};

export default DebugOverlay;

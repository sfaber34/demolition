"use client";

import React, { memo } from "react";
import { getCarForward, getCarWallDistance, getSpeed, getVelocity } from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";
import { DEBUG_CONFIG } from "./debugConfig";
import { getSpeedColor, getWallDistColor } from "./debugUtils";

interface DebugOverlayProps {
  cars: CarSim[];
}

/**
 * Debug overlay for a single car (rendered in SVG on the arena)
 */
const CarDebugInfo: React.FC<{ car: CarSim }> = memo(({ car }) => {
  const { position } = car;

  // Build array of text lines to display
  const lines: { text: string; color: string }[] = [];

  if (DEBUG_CONFIG.showWallDistance) {
    const wallDist = getCarWallDistance(car);
    lines.push({
      text: `wall: ${Math.round(wallDist)}`,
      color: getWallDistColor(wallDist),
    });
  }

  if (DEBUG_CONFIG.showSpeed) {
    // car.velocity is the velocity
    const speed = getSpeed(car);
    lines.push({
      text: `spd: ${speed.toFixed(1)}`,
      color: getSpeedColor(speed),
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
      text: car.name,
      color: "#ffffff",
    });
  }

  // Starting Y offset above car
  const textStartY = -car.height / 2 - 8 - lines.length * 12;

  // Get physics values - car.velocity IS the true velocity
  const speed = getSpeed(car);
  const vel = getVelocity(car);
  const forward = getCarForward(car);

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

      {/* Velocity vector arrow - car.velocity IS the true velocity */}
      {DEBUG_CONFIG.showVelocityVector && speed > 0.5 && (
        <line
          x1={0}
          y1={0}
          x2={vel.x * 3}
          y2={vel.y * 3}
          stroke="#00ff00"
          strokeWidth={3}
          markerEnd="url(#arrowhead-green)"
        />
      )}

      {/* Forward direction arrow - uses centralized getCarForward */}
      {DEBUG_CONFIG.showForwardVector && (
        <line
          x1={0}
          y1={0}
          x2={forward.x * 40}
          y2={forward.y * 40}
          stroke="#ff00ff"
          strokeWidth={2}
          strokeDasharray="4,4"
        />
      )}
    </g>
  );
});
CarDebugInfo.displayName = "CarDebugInfo";

/**
 * Main debug overlay component - renders debug info for all cars
 */
export const DebugOverlay: React.FC<DebugOverlayProps> = memo(({ cars }) => {
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
        <marker id="arrowhead-green" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <polygon points="0 0, 6 3, 0 6" fill="#00ff00" />
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
});
DebugOverlay.displayName = "DebugOverlay";

export default DebugOverlay;

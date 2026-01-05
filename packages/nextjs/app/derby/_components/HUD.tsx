"use client";

import React, { memo } from "react";
import { DEBUG_CONFIG, HudDebugValue } from "../debug/debugConfig";
import { getSpeedColor, getWallDistColor } from "../debug/debugUtils";
import { getCarWallDistance, getSpeed } from "../physics/PhysicsEngine";
import { CarSim } from "../sim/typesSim";

interface HUDProps {
  cars: CarSim[];
}

export const HUD: React.FC<HUDProps> = memo(({ cars }) => {
  return (
    <div className="w-full px-4 py-3 bg-gradient-to-b from-zinc-900 to-zinc-800 border-b-2 border-amber-900/50">
      <div className="flex justify-center gap-4 flex-wrap">
        {cars.map(car => (
          <CarStatus key={car.id} car={car} isActive={car.isAlive} />
        ))}
      </div>
    </div>
  );
});
HUD.displayName = "HUD";

interface CarStatusProps {
  car: CarSim;
  isActive: boolean;
}

/**
 * Get the debug value to display based on config.
 * Returns { label, value, color } for rendering.
 */
function getDebugDisplay(car: CarSim, debugValue: HudDebugValue): { label: string; value: string; color: string } {
  switch (debugValue) {
    case "wallDistance": {
      const front = car.aiDebug?.frontWallDist;
      const rear = car.aiDebug?.rearWallDist;
      const mode = car.aiDebug?.recoverMode ?? null;

      // If AI hasn't populated aiDebug yet, fall back to standard wall distance.
      if (front === undefined || rear === undefined) {
        const dist = getCarWallDistance(car);
        return {
          label: "WALL:",
          value: Math.round(dist).toString(),
          color: getWallDistColor(dist),
        };
      }

      const minDist = Math.min(front, rear);
      const f = Math.max(0, Math.round(front));
      const r = Math.max(0, Math.round(rear));
      return {
        label: "",
        value: `F:${f}\nR:${r}\nM:${mode ?? "-"}`,
        color: getWallDistColor(minDist),
      };
    }
    case "speed": {
      const speed = getSpeed(car);
      return {
        label: "SPD:",
        value: speed.toFixed(1),
        color: getSpeedColor(speed),
      };
    }
    case "throttle": {
      const throttle = car.input.throttle;
      return {
        label: "THR:",
        value: throttle.toFixed(1),
        color: throttle > 0 ? "#44ff44" : throttle < 0 ? "#ff4444" : "#aaaaaa",
      };
    }
    case "dmg":
    default:
      return {
        label: "DMG:",
        value: Math.round(car.damageDealt).toString(),
        color: "", // Use default styling
      };
  }
}

const CarStatus: React.FC<CarStatusProps> = memo(({ car, isActive }) => {
  const healthPercent = Math.max(0, (car.health / car.maxHealth) * 100);

  // Health bar color based on health level
  const getHealthColor = () => {
    if (healthPercent > 60) return "bg-green-500";
    if (healthPercent > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  // Get what to display below health bar
  const showDebug = DEBUG_CONFIG.enabled && DEBUG_CONFIG.hudDebugValue !== "dmg";
  const display = showDebug ? getDebugDisplay(car, DEBUG_CONFIG.hudDebugValue) : getDebugDisplay(car, "dmg");

  return (
    <div
      className={`flex flex-col items-center p-3 rounded-lg min-w-[140px] transition-all duration-300 ${
        isActive ? "bg-zinc-700/80 border border-zinc-600" : "bg-zinc-800/50 border border-zinc-700/50 opacity-60"
      }`}
    >
      {/* Car name with color indicator */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-4 h-4 rounded-full border-2 border-zinc-400 shadow-lg"
          style={{ backgroundColor: car.color }}
        />
        <span
          className={`font-bold text-sm tracking-wide ${isActive ? "text-zinc-100" : "text-zinc-400 line-through"}`}
        >
          {car.name}
        </span>
        {!isActive && <span className="text-xs text-red-400 font-bold">WRECKED</span>}
      </div>

      {/* Health bar */}
      <div className="w-full h-4 bg-zinc-900 rounded-full overflow-hidden border border-zinc-600 mb-1">
        <div
          className={`h-full transition-all duration-200 ${getHealthColor()}`}
          style={{ width: `${healthPercent}%` }}
        >
          {/* Health bar shine effect */}
          <div className="h-1 bg-white/20 rounded-full mx-0.5 mt-0.5" />
        </div>
      </div>

      {/* Health percentage */}
      <div className="text-xs text-zinc-400 font-mono">{Math.round(healthPercent)}%</div>

      {/* Debug value or Damage dealt counter */}
      <div className="flex items-center gap-1 mt-1">
        {showDebug ? (
          <>
            <span className="text-xs" style={{ color: display.color || "#fb923c" }}>
              {display.label}
            </span>
            <span
              className="text-sm font-bold font-mono whitespace-pre-line"
              style={{ color: display.color || "#fdba74" }}
            >
              {display.value}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-orange-400">{display.label}</span>
            <span className="text-sm font-bold text-orange-300 font-mono whitespace-pre-line">{display.value}</span>
          </>
        )}
      </div>
    </div>
  );
});
CarStatus.displayName = "CarStatus";

export default HUD;

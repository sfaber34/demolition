"use client";

import React from "react";
import { Car as CarType } from "../types";

interface HUDProps {
  cars: CarType[];
}

export const HUD: React.FC<HUDProps> = ({ cars }) => {
  const aliveCars = cars.filter(c => c.isAlive);

  return (
    <div className="w-full px-4 py-3 bg-gradient-to-b from-zinc-900 to-zinc-800 border-b-2 border-amber-900/50">
      <div className="flex justify-center gap-4 flex-wrap">
        {cars.map(car => (
          <CarStatus key={car.id} car={car} isActive={car.isAlive} />
        ))}
      </div>
      {aliveCars.length <= 1 && aliveCars.length > 0 && (
        <div className="text-center mt-2 text-amber-400 font-bold animate-pulse">
          {aliveCars[0].name} is the last one standing!
        </div>
      )}
    </div>
  );
};

interface CarStatusProps {
  car: CarType;
  isActive: boolean;
}

const CarStatus: React.FC<CarStatusProps> = ({ car, isActive }) => {
  const healthPercent = Math.max(0, (car.health / car.maxHealth) * 100);

  // Health bar color based on health level
  const getHealthColor = () => {
    if (healthPercent > 60) return "bg-green-500";
    if (healthPercent > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

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

      {/* Damage dealt counter */}
      <div className="flex items-center gap-1 mt-1">
        <span className="text-xs text-orange-400">DMG:</span>
        <span className="text-sm font-bold text-orange-300 font-mono">{Math.round(car.damageDealt)}</span>
      </div>
    </div>
  );
};

export default HUD;

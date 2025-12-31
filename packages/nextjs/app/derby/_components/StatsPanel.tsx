"use client";

import React from "react";
import { Car as CarType } from "../types";

interface StatsPanelProps {
  cars: CarType[];
}

export const StatsPanel: React.FC<StatsPanelProps> = ({ cars }) => {
  return (
    <div className="w-full px-4 py-4 bg-gradient-to-t from-zinc-900 to-zinc-800 border-t-2 border-amber-900/50">
      <h3 className="text-center text-amber-500 font-bold text-sm mb-3 uppercase tracking-widest">Driver Stats</h3>
      <div className="flex justify-center gap-4 flex-wrap">
        {cars.map(car => (
          <CarStats key={car.id} car={car} />
        ))}
      </div>
    </div>
  );
};

interface CarStatsProps {
  car: CarType;
}

const CarStats: React.FC<CarStatsProps> = ({ car }) => {
  // Normalize stats for progress bars (assuming max values)
  const maxAcceleration = 1.5;
  const maxCornering = 1.2;
  const maxTraction = 1.0;

  const stats = [
    {
      label: "Acceleration",
      value: car.acceleration,
      max: maxAcceleration,
      color: "bg-blue-500",
    },
    {
      label: "Cornering",
      value: car.cornering,
      max: maxCornering,
      color: "bg-purple-500",
    },
    {
      label: "Traction",
      value: car.traction,
      max: maxTraction,
      color: "bg-green-500",
    },
  ];

  return (
    <div
      className={`flex flex-col p-3 rounded-lg min-w-[150px] bg-zinc-700/60 border border-zinc-600 ${
        !car.isAlive ? "opacity-50" : ""
      }`}
    >
      {/* Car name with color */}
      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-zinc-600">
        <div className="w-3 h-3 rounded-full shadow" style={{ backgroundColor: car.color }} />
        <span className="font-bold text-xs text-zinc-200 tracking-wide">{car.name}</span>
      </div>

      {/* Stats */}
      {stats.map(stat => {
        const percent = Math.min(100, (stat.value / stat.max) * 100);
        return (
          <div key={stat.label} className="mb-1.5">
            <div className="flex justify-between text-xs text-zinc-400 mb-0.5">
              <span>{stat.label}</span>
              <span className="font-mono">{(stat.value * 100).toFixed(0)}</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full ${stat.color} transition-all duration-300`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatsPanel;

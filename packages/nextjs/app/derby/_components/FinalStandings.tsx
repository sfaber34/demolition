"use client";

import React from "react";

export interface CarResult {
  id: string;
  name: string;
  color: string;
  isAlive: boolean;
  health: number;
  damageDealt: number;
}

interface FinalStandingsProps {
  cars: CarResult[];
  winnerId?: string | null;
  title?: string;
  className?: string;
}

export const FinalStandings: React.FC<FinalStandingsProps> = ({
  cars,
  winnerId,
  title = "Final Standings",
  className = "",
}) => {
  // Sort cars by damage dealt for standings
  const sortedCars = [...cars].sort((a, b) => b.damageDealt - a.damageDealt);

  return (
    <div className={`w-full max-w-xl bg-zinc-800/80 rounded-xl border border-zinc-600 p-6 ${className}`}>
      <h2 className="text-center text-amber-500 font-bold text-lg mb-4 uppercase tracking-widest">{title}</h2>
      <div className="space-y-3">
        {sortedCars.map((car, index) => {
          const isWinner = winnerId && car.id === winnerId;
          return (
            <div
              key={car.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                isWinner ? "bg-amber-900/40 border border-amber-600" : "bg-zinc-700/50 border border-zinc-600"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`text-2xl font-black ${
                    index === 0
                      ? "text-amber-400"
                      : index === 1
                        ? "text-zinc-300"
                        : index === 2
                          ? "text-amber-700"
                          : "text-zinc-500"
                  }`}
                >
                  #{index + 1}
                </span>
                <div className="w-5 h-5 rounded-full border-2 border-zinc-400" style={{ backgroundColor: car.color }} />
                <span className={`font-bold ${isWinner ? "text-amber-200" : "text-zinc-300"}`}>{car.name}</span>
                {isWinner && <span className="text-amber-400 text-sm">👑</span>}
                {!car.isAlive && !isWinner && <span className="text-red-400 text-xs">WRECKED</span>}
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <div className="text-xs text-zinc-500">Damage Dealt</div>
                  <div className="text-lg font-bold text-orange-400 font-mono">{Math.round(car.damageDealt)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">Final Health</div>
                  <div className={`text-lg font-bold font-mono ${car.isAlive ? "text-green-400" : "text-red-400"}`}>
                    {car.isAlive ? `${Math.round(car.health)}%` : "0%"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FinalStandings;

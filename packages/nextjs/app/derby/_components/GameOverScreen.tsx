"use client";

import React from "react";
import { CarSim } from "../sim/typesSim";

interface GameOverScreenProps {
  winner: CarSim | null;
  cars: CarSim[];
  gameTime: number;
  onRestart: () => void;
  runSeed: number;
  onRunSeedChange: (seed: number) => void;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({
  winner,
  cars,
  gameTime,
  onRestart,
  runSeed,
  onRunSeedChange,
}) => {
  // Sort cars by damage dealt for final standings
  const sortedCars = [...cars].sort((a, b) => b.damageDealt - a.damageDealt);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] bg-gradient-to-b from-zinc-900 via-amber-950/20 to-zinc-900 rounded-xl border-4 border-amber-900/50 relative overflow-hidden p-8">
      {/* Victory banner */}
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-400 to-orange-600 mb-2">
          {winner ? "VICTORY!" : "DRAW!"}
        </h1>
        {winner && (
          <div className="flex items-center justify-center gap-3">
            <div
              className="w-8 h-8 rounded-full border-4 border-amber-300 shadow-lg animate-pulse"
              style={{ backgroundColor: winner.color }}
            />
            <span className="text-3xl font-bold text-amber-300">{winner.name}</span>
            <span className="text-xl text-amber-500">wins!</span>
          </div>
        )}
        <div className="text-zinc-500 mt-2">Battle Duration: {formatTime(gameTime)}</div>
      </div>

      {/* Trophy/crown animation for winner */}
      {winner && <div className="text-6xl mb-6 animate-bounce">🏆</div>}

      {/* Final standings */}
      <div className="w-full max-w-xl bg-zinc-800/80 rounded-xl border border-zinc-600 p-6 mb-8">
        <h2 className="text-center text-amber-500 font-bold text-lg mb-4 uppercase tracking-widest">Final Standings</h2>
        <div className="space-y-3">
          {sortedCars.map((car, index) => {
            const isWinner = winner && car.id === winner.id;
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
                  <div
                    className="w-5 h-5 rounded-full border-2 border-zinc-400"
                    style={{ backgroundColor: car.color }}
                  />
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

      {/* Play again button */}
      <div className="flex items-center gap-4 flex-wrap justify-center">
        <label className="flex items-center gap-2 text-zinc-300 font-mono text-sm">
          <span className="text-zinc-500">Run seed</span>
          <input
            type="number"
            value={runSeed}
            onChange={e => onRunSeedChange(Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0)}
            className="w-24 px-2 py-1 rounded-md bg-zinc-900/70 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </label>
        <button
          onClick={onRestart}
          className="group px-10 py-4 bg-gradient-to-b from-green-600 to-green-800 hover:from-green-500 hover:to-green-700 text-white font-black text-xl uppercase tracking-widest rounded-lg border-4 border-green-900 shadow-[0_6px_0_#1a4d1a,0_8px_15px_rgba(0,0,0,0.5)] hover:shadow-[0_4px_0_#1a4d1a,0_6px_10px_rgba(0,0,0,0.5)] hover:translate-y-[2px] transition-all duration-100"
        >
          <span className="relative">
            Play Again
            <span className="absolute -right-6 top-1/2 -translate-y-1/2 text-yellow-300 group-hover:rotate-45 transition-transform">
              ⟳
            </span>
          </span>
        </button>
      </div>
    </div>
  );
};

export default GameOverScreen;

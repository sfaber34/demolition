"use client";

import React from "react";

interface TitleScreenProps {
  onStart: () => void;
  runSeed: number;
  onRunSeedChange: (seed: number) => void;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStart, runSeed, onRunSeedChange }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] bg-gradient-to-b from-zinc-900 via-amber-950/20 to-zinc-900 rounded-xl border-4 border-amber-900/50 relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(
              0deg,
              transparent,
              transparent 20px,
              rgba(139, 69, 19, 0.5) 20px,
              rgba(139, 69, 19, 0.5) 22px
            )`,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `repeating-linear-gradient(
              90deg,
              transparent,
              transparent 20px,
              rgba(139, 69, 19, 0.5) 20px,
              rgba(139, 69, 19, 0.5) 22px
            )`,
          }}
        />
      </div>

      {/* Decorative elements */}
      <div className="absolute top-8 left-8 w-16 h-16 border-4 border-amber-800/30 rounded-full" />
      <div className="absolute top-12 right-12 w-12 h-12 border-4 border-amber-800/30 rounded-full" />
      <div className="absolute bottom-16 left-16 w-10 h-10 border-4 border-amber-800/30 rounded-full" />
      <div className="absolute bottom-8 right-8 w-14 h-14 border-4 border-amber-800/30 rounded-full" />

      {/* Title */}
      <div className="relative z-10 text-center mb-12">
        <h1
          className="text-6xl md:text-8xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-amber-400 via-orange-500 to-red-600"
          style={{
            textShadow: "4px 4px 8px rgba(0,0,0,0.5)",
            WebkitTextStroke: "2px rgba(0,0,0,0.3)",
          }}
        >
          DEMOLITION
        </h1>
        <h2
          className="text-5xl md:text-7xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-yellow-300 via-amber-500 to-orange-600 -mt-2"
          style={{
            textShadow: "3px 3px 6px rgba(0,0,0,0.5)",
            WebkitTextStroke: "1px rgba(0,0,0,0.3)",
          }}
        >
          DERBY
        </h2>
        <div className="mt-4 text-amber-600/80 text-lg tracking-widest uppercase font-bold">
          Midwest Mayhem &apos;95
        </div>
      </div>

      {/* Start button */}
      <div className="relative z-10 flex items-center gap-4 flex-wrap justify-center">
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
          onClick={onStart}
          className="group px-12 py-4 bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white font-black text-2xl uppercase tracking-widest rounded-lg border-4 border-red-900 shadow-[0_6px_0_#5c1c1c,0_8px_15px_rgba(0,0,0,0.5)] hover:shadow-[0_4px_0_#5c1c1c,0_6px_10px_rgba(0,0,0,0.5)] active:shadow-[0_2px_0_#5c1c1c,0_3px_5px_rgba(0,0,0,0.5)] hover:translate-y-[2px] active:translate-y-[4px] transition-all duration-100"
        >
          <span className="relative">
            Start Engine
            <span className="absolute -right-6 top-1/2 -translate-y-1/2 text-yellow-400 group-hover:animate-pulse">
              ▶
            </span>
          </span>
        </button>
      </div>

      {/* Instructions */}
      <div className="relative z-10 mt-12 text-center text-zinc-500 text-sm max-w-md px-8">
        <p>4 AI drivers battle until only one remains.</p>
        <p className="mt-1">Ram opponents at high speed to deal damage!</p>
      </div>

      {/* Car silhouettes */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-8 opacity-20">
        {["#e74c3c", "#3498db", "#2ecc71", "#f1c40f"].map((color, i) => (
          <svg key={i} width="40" height="24" viewBox="0 0 50 28">
            <rect x="0" y="0" width="50" height="28" fill={color} rx="4" />
          </svg>
        ))}
      </div>
    </div>
  );
};

export default TitleScreen;

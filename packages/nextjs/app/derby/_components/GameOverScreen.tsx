"use client";

import React, { useState } from "react";
import type { GameRecording } from "../engine/recording";
import { parseSeedBytes32 } from "../sim/deterministicRandom";
import { CarSim } from "../sim/typesSim";
import { CopyableTextBox } from "./CopyableTextBox";
import { type CarResult, FinalStandings } from "./FinalStandings";

interface GameOverScreenProps {
  winner: CarSim | null;
  cars: CarSim[];
  gameTime: number;
  onRestart: () => void;
  runSeedInput: string;
  onRunSeedInputChange: (seed: string) => void;
  /** Optional callback to get the game recording */
  onGetRecording?: () => GameRecording | null;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({
  winner,
  cars,
  gameTime,
  onRestart,
  runSeedInput,
  onRunSeedInputChange,
  onGetRecording,
}) => {
  const [recordingJson, setRecordingJson] = useState<string | null>(null);
  const resolvedSeed = parseSeedBytes32(runSeedInput);
  const isIntSeed = /^-?\d+$/.test(runSeedInput.trim());

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Convert CarSim to CarResult for FinalStandings
  const carResults: CarResult[] = cars.map(car => ({
    id: car.id,
    name: car.name,
    color: car.color,
    isAlive: car.isAlive,
    health: car.health,
    damageDealt: car.damageDealt,
  }));

  const handleExportRecording = () => {
    if (!onGetRecording) return;
    const recording = onGetRecording();
    if (recording) {
      setRecordingJson(JSON.stringify(recording, null, 2));
    }
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

      {/* Final standings - using shared component */}
      <FinalStandings cars={carResults} winnerId={winner?.id} className="mb-8" />

      {/* Play again button */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <label className="flex items-center gap-2 text-zinc-300 font-mono text-sm">
            <span className="text-zinc-500">Run seed</span>
            <input
              type="text"
              value={runSeedInput}
              onChange={e => onRunSeedInputChange(e.target.value)}
              placeholder="123 or 0x…"
              className="w-52 px-2 py-1 rounded-md bg-zinc-900/70 border border-zinc-700 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
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

        {(resolvedSeed || isIntSeed) && (
          <div className="text-xs text-zinc-500 font-mono text-center max-w-[520px] px-4">
            <div className="uppercase tracking-widest text-[10px] text-zinc-600">
              {isIntSeed ? "Derived bytes32 seed" : "Resolved bytes32 seed"}
            </div>
            <div className="text-zinc-300 break-all">
              {resolvedSeed ?? "Invalid seed (enter an int or 0x + 64 hex)"}
            </div>
          </div>
        )}
      </div>

      {/* Recording export section */}
      {onGetRecording && (
        <div className="w-full max-w-xl mt-8 pt-6 border-t border-zinc-700">
          <div className="text-center mb-4">
            <h3 className="text-amber-500 font-bold uppercase tracking-widest text-sm">Game Recording</h3>
            <p className="text-zinc-500 text-xs mt-1">Export your game inputs for verification</p>
          </div>

          {!recordingJson ? (
            <div className="flex justify-center">
              <button
                onClick={handleExportRecording}
                className="px-6 py-3 bg-gradient-to-b from-zinc-600 to-zinc-700 hover:from-zinc-500 hover:to-zinc-600 text-white font-bold uppercase tracking-wider rounded-lg border-2 border-zinc-500 shadow-lg hover:shadow-xl transition-all"
              >
                📋 Export Recording
              </button>
            </div>
          ) : (
            <CopyableTextBox value={recordingJson} label="Game Recording JSON" rows={8} />
          )}
        </div>
      )}
    </div>
  );
};

export default GameOverScreen;

"use client";

import React, { useState } from "react";
import Link from "next/link";
import { type CarResult, FinalStandings } from "../derby/_components/FinalStandings";
import type { GameOutcome, GameRecording } from "../derby/engine/recording";

// Car names and colors for display
const CAR_NAMES: Record<string, string> = {
  "car-1": "Crusher",
  "car-2": "Destroyer",
  "car-3": "Havoc",
  "car-4": "Rammer",
};

const CAR_COLORS: Record<string, string> = {
  "car-1": "#E74C3C",
  "car-2": "#3498DB",
  "car-3": "#2ECC71",
  "car-4": "#F1C40F",
};

export default function VerifyPage() {
  const [recordingInput, setRecordingInput] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<GameOutcome | null>(null);
  const [parsedRecording, setParsedRecording] = useState<GameRecording | null>(null);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const handleVerify = async () => {
    setError(null);
    setOutcome(null);
    setParsedRecording(null);

    // Parse the input
    let recording: GameRecording;
    try {
      recording = JSON.parse(recordingInput);
      setParsedRecording(recording);
    } catch {
      setError("Invalid JSON. Please paste a valid game recording.");
      return;
    }

    // Basic validation
    if (!recording.runSeed || !Array.isArray(recording.inputs)) {
      setError("Invalid recording format. Missing runSeed or inputs.");
      return;
    }

    setIsVerifying(true);

    try {
      const response = await fetch("/api/derby/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recording),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Verification failed");
        return;
      }

      setOutcome(result as GameOutcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setIsVerifying(false);
    }
  };

  // Convert outcome to CarResult[] for FinalStandings
  const getCarResults = (): CarResult[] => {
    if (!outcome) return [];

    const carIds = Object.keys(outcome.finalHealth);
    return carIds.map(id => ({
      id,
      name: CAR_NAMES[id] || id,
      color: CAR_COLORS[id] || "#888888",
      isAlive: outcome.isAlive[id] ?? false,
      health: outcome.finalHealth[id] ?? 0,
      damageDealt: outcome.damageDealt[id] ?? 0,
    }));
  };

  const winnerName = outcome?.winnerId ? CAR_NAMES[outcome.winnerId] || outcome.winnerId : null;
  const winnerColor = outcome?.winnerId ? CAR_COLORS[outcome.winnerId] || "#888888" : null;

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 py-8 px-4">
      {/* Header */}
      <header className="w-full max-w-2xl mb-8">
        <Link href="/derby" className="text-amber-500 hover:text-amber-400 text-sm mb-4 inline-block">
          ← Back to Game
        </Link>
        <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 tracking-tight">
          VERIFY GAME
        </h1>
        <p className="text-zinc-500 mt-2">
          Paste a game recording to verify the results by replaying deterministically.
        </p>
      </header>

      {/* Main content */}
      <main className="w-full max-w-2xl flex flex-col gap-6">
        {/* Input section */}
        <div className="bg-zinc-800/60 rounded-xl border border-zinc-700 p-6">
          <label className="block text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">
            Paste Game Recording JSON
          </label>
          <textarea
            value={recordingInput}
            onChange={e => setRecordingInput(e.target.value)}
            placeholder='{"version":1,"runSeed":"0x...","playerCarIndex":0,"fixedDtMs":8,"inputs":[[0,0],[1,0],...]}'
            rows={10}
            className="w-full px-4 py-3 bg-zinc-900/80 border border-zinc-600 rounded-lg text-zinc-200 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder-zinc-600"
          />

          {error && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm">{error}</div>
          )}

          <button
            onClick={handleVerify}
            disabled={isVerifying || !recordingInput.trim()}
            className={`mt-4 w-full px-6 py-4 font-black text-lg uppercase tracking-widest rounded-lg border-4 transition-all ${
              isVerifying || !recordingInput.trim()
                ? "bg-zinc-700 border-zinc-600 text-zinc-500 cursor-not-allowed"
                : "bg-gradient-to-b from-amber-500 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-white border-amber-800 shadow-[0_4px_0_#78350f,0_6px_10px_rgba(0,0,0,0.4)] hover:shadow-[0_2px_0_#78350f,0_4px_8px_rgba(0,0,0,0.4)] hover:translate-y-[2px]"
            }`}
          >
            {isVerifying ? "⏳ Verifying..." : "🔍 Verify Recording"}
          </button>
        </div>

        {/* Recording info */}
        {parsedRecording && (
          <div className="bg-zinc-800/40 rounded-xl border border-zinc-700 p-4">
            <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3">Recording Info</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-zinc-500">Seed:</span>
                <span className="ml-2 text-zinc-300 font-mono text-xs break-all">{parsedRecording.runSeed}</span>
              </div>
              <div>
                <span className="text-zinc-500">Player Car:</span>
                <span className="ml-2 text-zinc-300">
                  {CAR_NAMES[`car-${parsedRecording.playerCarIndex + 1}`] ||
                    `Car ${parsedRecording.playerCarIndex + 1}`}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Input Ticks:</span>
                <span className="ml-2 text-zinc-300 font-mono">{parsedRecording.inputs.length.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-zinc-500">Duration:</span>
                <span className="ml-2 text-zinc-300">
                  ~{formatTime(parsedRecording.inputs.length * (parsedRecording.fixedDtMs || 8))}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Results section */}
        {outcome && (
          <div className="bg-gradient-to-b from-zinc-900 via-amber-950/20 to-zinc-900 rounded-xl border-4 border-amber-900/50 p-8">
            {/* Victory banner */}
            <div className="text-center mb-6">
              <div className="text-xs text-green-500 font-bold uppercase tracking-widest mb-2">
                ✓ Verification Complete
              </div>
              <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-b from-amber-400 to-orange-600 mb-2">
                {outcome.winnerId ? "VICTORY!" : "DRAW!"}
              </h2>
              {outcome.winnerId && winnerName && (
                <div className="flex items-center justify-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full border-4 border-amber-300 shadow-lg"
                    style={{ backgroundColor: winnerColor || "#888" }}
                  />
                  <span className="text-3xl font-bold text-amber-300">{winnerName}</span>
                  <span className="text-xl text-amber-500">wins!</span>
                </div>
              )}
              <div className="text-zinc-500 mt-2">Battle Duration: {formatTime(outcome.gameTimeMs)}</div>
            </div>

            {/* Trophy */}
            {outcome.winnerId && <div className="text-6xl text-center mb-6">🏆</div>}

            {/* Final standings */}
            <FinalStandings cars={getCarResults()} winnerId={outcome.winnerId} title="Verified Results" />

            {/* State hash */}
            <div className="mt-6 pt-4 border-t border-zinc-700">
              <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">
                State Hash (for on-chain verification)
              </div>
              <div className="font-mono text-xs text-zinc-400 break-all bg-zinc-900/50 p-2 rounded">
                {outcome.stateHash}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 text-zinc-600 text-sm text-center">
        <p>Demolition Derby Verification</p>
      </footer>
    </div>
  );
}

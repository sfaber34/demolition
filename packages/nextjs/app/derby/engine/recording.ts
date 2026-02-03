import type { Hex } from "viem";

/**
 * Recorded player inputs for a game session.
 * Used for verification - replaying the game deterministically to verify outcomes.
 */
export interface GameRecording {
  version: 1;
  runSeed: Hex;
  playerCarIndex: number;
  fixedDtMs: number;
  /**
   * Player inputs per physics tick.
   * Index = tick number, value = [throttle, steer]
   * throttle: -1 (reverse), 0 (none), 1 (forward)
   * steer: -1 (left), 0 (none), 1 (right)
   */
  inputs: [number, number][];
}

/**
 * Outcome of a verified game.
 * Returned by the verification endpoint after running the simulation.
 */
export interface GameOutcome {
  /** Whether the simulation completed successfully */
  valid: boolean;
  /** Error message if valid is false */
  error?: string;
  /** ID of winning car (e.g., "car-1") or null if draw */
  winnerId: string | null;
  /** Total game duration in milliseconds */
  gameTimeMs: number;
  /** Final health of each car */
  finalHealth: Record<string, number>;
  /** Total damage dealt by each car */
  damageDealt: Record<string, number>;
  /** Whether each car survived */
  isAlive: Record<string, boolean>;
  /** Keccak256 hash of final world state (for on-chain verification) */
  stateHash: Hex;
}

/**
 * Creates an empty recording ready to capture inputs.
 */
export function createEmptyRecording(runSeed: Hex, playerCarIndex: number, fixedDtMs: number): GameRecording {
  return {
    version: 1,
    runSeed,
    playerCarIndex,
    fixedDtMs,
    inputs: [],
  };
}

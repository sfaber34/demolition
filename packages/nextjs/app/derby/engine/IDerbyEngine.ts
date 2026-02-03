import type { GameSnapshot } from "./GameEngine";
import type { GameRecording } from "./recording";
import type { Hex } from "viem";

export type DerbyPhase = "title" | "playing" | "victory" | "gameover";

export interface IDerbyEngine {
  start(): void;
  restart(runSeed?: Hex): void;
  step(dtMs: number): void;
  getSnapshot(): GameSnapshot;
  getPhase(): DerbyPhase;
  getFixedDtMs(): number;
  cleanup(): void;
  /** Get recorded player inputs (optional, only WASM engine supports this) */
  getRecording?(): GameRecording;
  /** Get keccak256 hash of current world state (optional, only WASM engine supports this) */
  getStateHash?(): Hex;
}

import type { GameSnapshot } from "./GameEngine";
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
}

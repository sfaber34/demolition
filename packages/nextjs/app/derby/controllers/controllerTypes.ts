import type { CarInput, WorldSim } from "../sim/typesSim";

export type Controls = CarInput;

/**
 * A controller decides per-car inputs for the upcoming simulation step.
 * It must ONLY write `car.input` (no physics, no effects).
 */
export interface CarController {
  // Called before `stepWorldSim`.
  update(world: WorldSim, dtMs: number, nowMs: number): void;
}

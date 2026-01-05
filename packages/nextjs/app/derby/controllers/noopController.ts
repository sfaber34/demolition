import type { WorldSim } from "../sim/typesSim";
import type { CarController } from "./controllerTypes";

/**
 * No-op controller: disables all AI by setting inputs to zero.
 * Useful as a clean baseline when rebuilding the driving logic.
 * Can optionally skip certain car indices (e.g., player-controlled cars).
 */
export class NoopController implements CarController {
  private skipIndices: Set<number>;

  constructor(skipIndices: number[] = []) {
    this.skipIndices = new Set(skipIndices);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(world: WorldSim, dtMs: number, nowMs: number): void {
    if (world.gamePhase !== "playing") return;
    for (let i = 0; i < world.cars.length; i++) {
      if (this.skipIndices.has(i)) continue;
      const car = world.cars[i];
      if (!car.isAlive) continue;
      car.input = { throttle: 0, steer: 0 };
    }
  }
}

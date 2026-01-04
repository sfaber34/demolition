import type { WorldSim } from "../sim/typesSim";
import type { CarController } from "./controllerTypes";

/**
 * No-op controller: disables all AI by setting inputs to zero.
 * Useful as a clean baseline when rebuilding the driving logic.
 */
export class NoopController implements CarController {
  update(world: WorldSim): void {
    if (world.gamePhase !== "playing") return;
    for (const car of world.cars) {
      if (!car.isAlive) continue;
      car.input = { throttle: 0, steer: 0 };
    }
  }
}

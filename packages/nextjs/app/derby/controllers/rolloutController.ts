import { vec } from "../physics/PhysicsEngine";
import { ARENA_CONFIG, type WorldSim } from "../sim/typesSim";
import type { CarController, Controls } from "./controllerTypes";
import { planControlsByRollout } from "./rolloutPlanner";

const DEFAULT_FALLBACK: Controls = { throttle: 0.7, steer: 0 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function distanceToInnerWall(pos: { x: number; y: number }): number {
  const innerL = ARENA_CONFIG.wallThickness;
  const innerR = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerT = ARENA_CONFIG.wallThickness;
  const innerB = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  const dx = Math.min(pos.x - innerL, innerR - pos.x);
  const dy = Math.min(pos.y - innerT, innerB - pos.y);
  return Math.min(dx, dy);
}

function escapeControls(world: WorldSim, car: { position: { x: number; y: number }; rotation: number }): Controls {
  const center = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
  const toCenter = vec.sub(center, car.position);
  const centerAngle = Math.atan2(toCenter.y, toCenter.x);
  const diff = normAngle(centerAngle - car.rotation);
  const steer = clamp(diff * 1.8, -1, 1);
  // Commit to reverse strongly while steering to center.
  return { throttle: -0.85, steer };
}

export class RolloutController implements CarController {
  private lastControlsById = new Map<string, Controls>();
  private planCooldownById = new Map<string, number>();
  private escapeCooldownById = new Map<string, number>();

  /**
   * How often each car replans (ms). Lower = smarter but heavier.
   * 120ms ~= 8.3Hz
   */
  constructor(private planEveryMs: number = 120) {}

  update(world: WorldSim, dtMs: number, nowMs: number): void {
    // Part of the controller interface; currently unused.
    void nowMs;
    if (world.gamePhase !== "playing") return;

    for (const car of world.cars) {
      if (!car.isAlive) continue;

      // --- Wall escape mode (prevents rocking) ---
      const speed = vec.length(car.velocity);
      const wallDist = distanceToInnerWall(car.position);
      const isWallStuck = wallDist < 22 && speed < 10;
      const escapeLeft = (this.escapeCooldownById.get(car.id) ?? 0) - dtMs;

      if (isWallStuck && escapeLeft <= 0) {
        // Commit to backing up for a short window.
        this.escapeCooldownById.set(car.id, 360);
      } else {
        this.escapeCooldownById.set(car.id, Math.max(0, escapeLeft));
      }

      const escapeActive = (this.escapeCooldownById.get(car.id) ?? 0) > 0;
      if (escapeActive) {
        const esc = escapeControls(world, car);
        this.lastControlsById.set(car.id, esc);
        // Delay replans while escaping so rollout doesn’t flip-flop.
        this.planCooldownById.set(car.id, Math.max(this.planCooldownById.get(car.id) ?? 0, 120));
        car.input = esc;
        continue;
      }

      const nextCooldown = (this.planCooldownById.get(car.id) ?? 0) - dtMs;

      if (nextCooldown <= 0) {
        const last = this.lastControlsById.get(car.id);
        const planned = planControlsByRollout(world, car.id, last);
        const safePlanned =
          Number.isFinite(planned.throttle) && Number.isFinite(planned.steer) ? planned : (last ?? DEFAULT_FALLBACK);

        this.lastControlsById.set(car.id, safePlanned);
        this.planCooldownById.set(car.id, this.planEveryMs);
      } else {
        this.planCooldownById.set(car.id, nextCooldown);
      }

      car.input = this.lastControlsById.get(car.id) ?? DEFAULT_FALLBACK;
    }
  }
}

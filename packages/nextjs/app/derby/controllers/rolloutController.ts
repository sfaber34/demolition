import { physicsEngine, vec } from "../physics/PhysicsEngine";
import { ARENA_CONFIG, type WorldSim } from "../sim/typesSim";
import { type CarSnapshot, debugLog } from "../utils/debugLog";
import type { CarController, Controls } from "./controllerTypes";
import { planControlsByRollout } from "./rolloutPlanner";

const DEFAULT_FALLBACK: Controls = { throttle: 0.7, steer: 0 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

type WallInfo = { dist: number; normalIn: { x: number; y: number } };

function getNearestWallInfo(pos: { x: number; y: number }): WallInfo {
  const innerL = ARENA_CONFIG.wallThickness;
  const innerR = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerT = ARENA_CONFIG.wallThickness;
  const innerB = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  const dLeft = pos.x - innerL;
  const dRight = innerR - pos.x;
  const dTop = pos.y - innerT;
  const dBottom = innerB - pos.y;

  const minD = Math.min(dLeft, dRight, dTop, dBottom);

  // Corner handling: blend normals if close to multiple walls.
  const eps = 6;
  let nx = 0;
  let ny = 0;
  if (dLeft <= minD + eps) nx += 1; // away from left wall
  if (dRight <= minD + eps) nx -= 1; // away from right wall
  if (dTop <= minD + eps) ny += 1; // away from top wall
  if (dBottom <= minD + eps) ny -= 1; // away from bottom wall

  const normalIn = vec.normalize({ x: nx, y: ny });
  return { dist: minD, normalIn: normalIn.x === 0 && normalIn.y === 0 ? { x: 0, y: 0 } : normalIn };
}

type WallClearanceInfo = { clearance: number; normalIn: { x: number; y: number } };

/**
 * Geometry-aware wall clearance computed against the car's *rotated corners* (matches wall collision geometry),
 * plus a blended inward normal (stable in corners).
 *
 * - clearance > 0: closest-corner distance to the inner wall boundary
 * - clearance < 0: penetration (a corner is inside the wall thickness region)
 */
function getWallClearanceInfo(car: {
  position: { x: number; y: number };
  rotation: number;
  width: number;
  height: number;
}): WallClearanceInfo {
  const corners = physicsEngine.getCarCorners(car as any);
  const innerL = ARENA_CONFIG.wallThickness;
  const innerR = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerT = ARENA_CONFIG.wallThickness;
  const innerB = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  let clearance = Infinity;

  // Blend normals from any walls close to any corner.
  const TRIGGER_DIST = 40;
  let nx = 0;
  let ny = 0;

  for (const c of corners) {
    const dLeft = c.x - innerL;
    const dRight = innerR - c.x;
    const dTop = c.y - innerT;
    const dBottom = innerB - c.y;

    const cornerClear = Math.min(dLeft, dRight, dTop, dBottom);
    if (cornerClear < clearance) clearance = cornerClear;

    // Use clamped distance so penetrations count as "very close".
    const wLeft = clamp((TRIGGER_DIST - Math.max(0, dLeft)) / TRIGGER_DIST, 0, 1);
    const wRight = clamp((TRIGGER_DIST - Math.max(0, dRight)) / TRIGGER_DIST, 0, 1);
    const wTop = clamp((TRIGGER_DIST - Math.max(0, dTop)) / TRIGGER_DIST, 0, 1);
    const wBottom = clamp((TRIGGER_DIST - Math.max(0, dBottom)) / TRIGGER_DIST, 0, 1);

    nx += wLeft * 1 + wRight * -1;
    ny += wTop * 1 + wBottom * -1;
  }

  const blended = vec.normalize({ x: nx, y: ny });
  return {
    clearance: Number.isFinite(clearance) ? clearance : 0,
    normalIn: blended.x !== 0 || blended.y !== 0 ? blended : getNearestWallInfo(car.position).normalIn,
  };
}

function getCenterDir(pos: { x: number; y: number }): { x: number; y: number } {
  const center = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
  const v = vec.sub(center, pos);
  const n = vec.normalize(v);
  // If we're exactly at center (rare), pick an arbitrary stable direction.
  return n.x === 0 && n.y === 0 ? { x: 1, y: 0 } : n;
}

// (Legacy helper retained during experimentation; currently unused.)

export class RolloutController implements CarController {
  private lastControlsById = new Map<string, Controls>();
  private planCooldownById = new Map<string, number>();
  private planLastLogMsById = new Map<string, number>();
  private planPhaseOffsetById = new Map<string, number>();

  /**
   * How often each car replans (ms). Lower = smarter but heavier.
   * 120ms ~= 8.3Hz
   */
  constructor(private planEveryMs: number = 120) {}

  update(world: WorldSim, dtMs: number, nowMs: number): void {
    if (world.gamePhase !== "playing") return;

    for (const car of world.cars) {
      if (!car.isAlive) {
        // Cleanup per-car controller state to avoid stale timers/maps.
        this.lastControlsById.delete(car.id);
        this.planCooldownById.delete(car.id);
        this.planLastLogMsById.delete(car.id);
        this.planPhaseOffsetById.delete(car.id);
        continue;
      }

      // No separate escape logic: driving is entirely determined by rollout planning.
      // We still compute wall clearance for debug/telemetry only.
      const wallClear = getWallClearanceInfo(car).clearance;
      const forward = vec.fromAngle(car.rotation);

      // Stagger replans across cars to avoid CPU spikes (helps frame pacing).
      const phase =
        this.planPhaseOffsetById.get(car.id) ??
        Math.abs(car.id.split("").reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7)) % 120;
      this.planPhaseOffsetById.set(car.id, phase);

      const nextCooldown = (this.planCooldownById.get(car.id) ?? phase) - dtMs;

      if (nextCooldown <= 0) {
        const last = this.lastControlsById.get(car.id);
        const planned = planControlsByRollout(world, car.id, last);
        const safePlanned =
          Number.isFinite(planned.throttle) && Number.isFinite(planned.steer) ? planned : (last ?? DEFAULT_FALLBACK);

        // Minimal smoothing to prevent thrash (NOT an escape mode/state machine).
        const prev = last ?? DEFAULT_FALLBACK;
        const smoothT = clamp(dtMs / 180, 0.08, 0.35);
        const smoothed: Controls = {
          throttle: clamp(prev.throttle + (safePlanned.throttle - prev.throttle) * smoothT, -1, 1.5),
          steer: clamp(prev.steer + (safePlanned.steer - prev.steer) * smoothT, -1, 1),
        };

        this.lastControlsById.set(car.id, smoothed);
        this.planCooldownById.set(car.id, this.planEveryMs);

        // Log rollout planner decisions at low frequency (to debug non-escape wall rocking).
        const prevLog = this.planLastLogMsById.get(car.id) ?? -Infinity;
        if (nowMs - prevLog >= 250) {
          this.planLastLogMsById.set(car.id, nowMs);
          const toCenter = getCenterDir(car.position);
          const dot = vec.dot(forward, toCenter);
          debugLog.log({
            timestamp: nowMs,
            gameTimeMs: nowMs,
            type: "plan",
            car: this.makeCarSnapshot(car),
            input: { throttle: smoothed.throttle, steer: smoothed.steer },
            wallClear,
            toCenter,
            dotToCenter: dot,
            note: `cooldown=reset`,
          });
        }
      } else {
        this.planCooldownById.set(car.id, nextCooldown);
      }

      car.input = this.lastControlsById.get(car.id) ?? DEFAULT_FALLBACK;
    }
  }

  private makeCarSnapshot(car: any): CarSnapshot {
    const speed = vec.length(car.velocity);
    return {
      id: car.id,
      name: car.name,
      position: { x: car.position.x, y: car.position.y },
      velocity: { x: car.velocity.x, y: car.velocity.y },
      speed,
      rotation: (car.rotation * 180) / Math.PI,
      rotationRad: car.rotation,
      angularVelocity: car.angularVelocity,
      health: car.health,
      isAlive: car.isAlive,
    };
  }
}

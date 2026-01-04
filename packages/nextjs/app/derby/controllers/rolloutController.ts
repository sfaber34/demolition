import { physicsEngine, vec } from "../physics/PhysicsEngine";
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

// (Legacy helper retained during experimentation; currently unused.)

export class RolloutController implements CarController {
  private lastControlsById = new Map<string, Controls>();
  private planCooldownById = new Map<string, number>();
  // Escape state is goal-based: stay in escape until we are actually clear of the wall.
  private escapeMaxMsById = new Map<string, number>();
  private escapeMinMsById = new Map<string, number>();
  private escapeClearStableMsById = new Map<string, number>();
  private escapeLastThrottleById = new Map<string, number>();
  private escapeNormalById = new Map<string, { x: number; y: number }>();
  private wallContactMsById = new Map<string, number>();
  private wallPushMsById = new Map<string, number>();
  private lastPosById = new Map<string, { x: number; y: number }>();
  private wallStuckMsById = new Map<string, number>();

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

      // --- Wall escape mode (goal-based; avoids rocking) ---
      const speed = vec.length(car.velocity);
      const wallDist = distanceToInnerWall(car.position);
      const wallCollision = physicsEngine.checkWallCollision(car);
      const wallInfo = getNearestWallInfo(car.position);
      // In corners, a single wall normal flips every frame (left vs top), causing "rocking".
      // Blend away-from-wall normals for any walls within trigger distance and smooth over time.
      const ESCAPE_TRIGGER_DIST = 35;

      const d = {
        left: car.position.x - ARENA_CONFIG.wallThickness,
        right: ARENA_CONFIG.width - ARENA_CONFIG.wallThickness - car.position.x,
        top: car.position.y - ARENA_CONFIG.wallThickness,
        bottom: ARENA_CONFIG.height - ARENA_CONFIG.wallThickness - car.position.y,
      };
      const w = {
        left: clamp((ESCAPE_TRIGGER_DIST - d.left) / ESCAPE_TRIGGER_DIST, 0, 1),
        right: clamp((ESCAPE_TRIGGER_DIST - d.right) / ESCAPE_TRIGGER_DIST, 0, 1),
        top: clamp((ESCAPE_TRIGGER_DIST - d.top) / ESCAPE_TRIGGER_DIST, 0, 1),
        bottom: clamp((ESCAPE_TRIGGER_DIST - d.bottom) / ESCAPE_TRIGGER_DIST, 0, 1),
      };
      const blended = vec.normalize({
        x: w.left * 1 + w.right * -1,
        y: w.top * 1 + w.bottom * -1,
      });
      const instantWallNormalIn =
        blended.x !== 0 || blended.y !== 0 ? blended : (wallCollision?.normal ?? wallInfo.normalIn);

      const prevNormal = this.escapeNormalById.get(car.id);
      const smoothT = clamp(dtMs / 220, 0.05, 0.25);
      const wallNormalIn = prevNormal
        ? vec.normalize(vec.lerp(prevNormal, instantWallNormalIn, smoothT))
        : instantWallNormalIn;
      this.escapeNormalById.set(car.id, wallNormalIn);
      const forward = vec.fromAngle(car.rotation);

      // Key: escape ends based on clearance, not on a short timer.
      // These need to be big enough that the car can actually rotate + translate away from the wall.
      const ESCAPE_TARGET_CLEAR_DIST = 160;
      const ESCAPE_CLEAR_STABLE_MS = 600;
      const ESCAPE_MIN_MS = 1800;
      const ESCAPE_MAX_MS = 9000;
      const THROTTLE_MAG = 0.85;
      // Larger deadband reduces flip-flopping when we're near perpendicular.
      const DOT_DEADBAND = 0.45;

      // Escape should be a "stuck at wall" behavior. Trigger based on the *contact* normal when colliding,
      // otherwise fall back to the blended/smoothed normal.
      const triggerNormalIn = wallCollision?.normal ?? wallNormalIn;
      const nearWall = wallCollision !== null || wallDist < ESCAPE_TRIGGER_DIST;

      // Track continuous wall contact; this avoids "stuck for N seconds then escape".
      // `checkWallCollision` can flicker on/off by 1-2px due to discrete stepping. Use hysteresis:
      // - While colliding OR still very close to wall, accumulate.
      // - Otherwise decay instead of hard reset.
      const prevContact = this.wallContactMsById.get(car.id) ?? 0;
      const contactZone = wallCollision !== null || wallDist < ESCAPE_TRIGGER_DIST + 6;
      const nextContact = contactZone ? prevContact + dtMs : Math.max(0, prevContact - dtMs * 2);
      this.wallContactMsById.set(car.id, nextContact);

      // Robust "stuck pushing into wall" detector:
      // measure *progress* (delta position), not velocity/collision continuity.
      const lastPos = this.lastPosById.get(car.id) ?? { x: car.position.x, y: car.position.y };
      const moved = vec.distance(lastPos, car.position);
      this.lastPosById.set(car.id, { x: car.position.x, y: car.position.y });

      const throttle = car.input.throttle;
      const absThrottle = Math.abs(throttle);
      const throttleSign = throttle >= 0 ? 1 : -1;
      const pushDir = vec.mul(forward, throttleSign);
      const pushingIntoWall = contactZone && absThrottle > 0.55 && vec.dot(pushDir, triggerNormalIn) < -0.2;

      const prevStuck = this.wallStuckMsById.get(car.id) ?? 0;
      const stuckNow = pushingIntoWall && moved < 0.9; // jitter is ~1px; "stuck" means not making progress
      const nextStuck = stuckNow ? prevStuck + dtMs : Math.max(0, prevStuck - dtMs * 3);
      this.wallStuckMsById.set(car.id, nextStuck);

      // Keep for debugging/telemetry if needed later.
      this.wallPushMsById.set(car.id, pushingIntoWall ? (this.wallPushMsById.get(car.id) ?? 0) + dtMs : 0);

      // Trigger escape fast once we've been stuck for a short window.
      const shouldEnterEscape = nextStuck > 220 || (nearWall && speed < 10 && pushingIntoWall);

      let escapeMax = this.escapeMaxMsById.get(car.id) ?? 0;
      let escapeMin = this.escapeMinMsById.get(car.id) ?? 0;
      let clearStable = this.escapeClearStableMsById.get(car.id) ?? 0;
      const isEscaping = escapeMax > 0;

      if (!isEscaping && shouldEnterEscape) {
        escapeMax = ESCAPE_MAX_MS;
        escapeMin = ESCAPE_MIN_MS;
        clearStable = 0;
      }

      if (escapeMax > 0) {
        escapeMax = Math.max(0, escapeMax - dtMs);
        escapeMin = Math.max(0, escapeMin - dtMs);

        const clearNow = wallCollision === null && wallDist >= ESCAPE_TARGET_CLEAR_DIST;
        clearStable = clearNow ? clearStable + dtMs : 0;

        this.escapeMaxMsById.set(car.id, escapeMax);
        this.escapeMinMsById.set(car.id, escapeMin);
        this.escapeClearStableMsById.set(car.id, clearStable);

        const escapeActive = escapeMax > 0 && (escapeMin > 0 || clearStable < ESCAPE_CLEAR_STABLE_MS);
        if (escapeActive) {
          // Desired direction: strongly inward (away from wall). Keep center bias minimal so we don't "graze" walls.
          const center = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
          const toCenter = vec.normalize(vec.sub(center, car.position));
          const desiredDir = vec.normalize(vec.add(vec.mul(wallNormalIn, 0.94), vec.mul(toCenter, 0.06)));
          const desiredAngle = Math.atan2(desiredDir.y, desiredDir.x);
          // Reduce steering while escaping; too much rotation while reversing causes corner-to-corner bouncing.
          const rawSteer = normAngle(desiredAngle - car.rotation) * 1.35;
          let steer = clamp(rawSteer, -0.7, 0.7);

          const dot = vec.dot(forward, desiredDir);
          const prevThrottle = this.escapeLastThrottleById.get(car.id);
          const throttle =
            Math.abs(dot) < DOT_DEADBAND && prevThrottle !== undefined
              ? prevThrottle
              : (dot >= 0 ? 1 : -1) * THROTTLE_MAG;

          this.escapeLastThrottleById.set(car.id, throttle);

          if (throttle < 0) {
            steer = clamp(steer, -0.5, 0.5);
          }

          const esc: Controls = { throttle, steer };
          this.lastControlsById.set(car.id, esc);
          // Delay replans while escaping so rollout doesn’t flip-flop.
          this.planCooldownById.set(car.id, Math.max(this.planCooldownById.get(car.id) ?? 0, 240));
          car.input = esc;
          continue;
        }
      }

      // Not escaping: clear escape state.
      this.escapeMaxMsById.delete(car.id);
      this.escapeMinMsById.delete(car.id);
      this.escapeClearStableMsById.delete(car.id);
      this.escapeLastThrottleById.delete(car.id);
      this.escapeNormalById.delete(car.id);
      this.wallContactMsById.delete(car.id);
      this.wallPushMsById.delete(car.id);
      this.wallStuckMsById.delete(car.id);
      this.lastPosById.delete(car.id);

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

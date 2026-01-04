import { physicsEngine, vec } from "../physics/PhysicsEngine";
import { ARENA_CONFIG, type WorldSim } from "../sim/typesSim";
import { type CarSnapshot, debugLog } from "../utils/debugLog";
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
  // Escape state is goal-based: stay in escape until we are actually clear of the wall.
  private escapeMaxMsById = new Map<string, number>();
  private escapeMinMsById = new Map<string, number>();
  private escapeClearStableMsById = new Map<string, number>();
  private escapeGearById = new Map<string, 1 | -1>();
  private escapeGearHoldMsById = new Map<string, number>();
  private escapeStartClearById = new Map<string, number>();
  private escapeSteerById = new Map<string, number>();
  private wallContactMsById = new Map<string, number>();
  private wallPushMsById = new Map<string, number>();
  private lastPosById = new Map<string, { x: number; y: number }>();
  private wallStuckMsById = new Map<string, number>();
  private escapeLastLogMsById = new Map<string, number>();
  private wallBestClearById = new Map<string, number>();
  private wallClearStallMsById = new Map<string, number>();
  private planLastLogMsById = new Map<string, number>();

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
        this.escapeMaxMsById.delete(car.id);
        this.escapeMinMsById.delete(car.id);
        this.escapeClearStableMsById.delete(car.id);
        this.escapeGearById.delete(car.id);
        this.escapeGearHoldMsById.delete(car.id);
        this.escapeStartClearById.delete(car.id);
        this.escapeSteerById.delete(car.id);
        this.wallContactMsById.delete(car.id);
        this.wallPushMsById.delete(car.id);
        this.wallStuckMsById.delete(car.id);
        this.lastPosById.delete(car.id);
        this.escapeLastLogMsById.delete(car.id);
        this.wallBestClearById.delete(car.id);
        this.wallClearStallMsById.delete(car.id);
        this.planLastLogMsById.delete(car.id);
        continue;
      }

      // --- Wall escape mode (goal-based; avoids rocking) ---
      const speed = vec.length(car.velocity);
      const wallCollision = physicsEngine.checkWallCollision(car);
      const wallInfo = getWallClearanceInfo(car);
      const wallClear = wallInfo.clearance;
      const ESCAPE_TRIGGER_DIST = 35;
      const forward = vec.fromAngle(car.rotation);

      // Key: escape ends based on clearance, not on a short timer.
      // These need to be big enough that the car can actually rotate + translate away from the wall.
      const ESCAPE_TARGET_CLEAR_DIST = 110; // corner clearance target to consider ourselves safely off the wall
      const ESCAPE_CLEAR_STABLE_MS = 320;
      const ESCAPE_MIN_MS = 700;
      const ESCAPE_MAX_MS = 8000;
      const THROTTLE_MAG = 0.95;
      // Gear flips during escape are disabled to prevent rocking.

      // Escape should be a "stuck at wall" behavior. Trigger based on the *contact* normal when colliding,
      // otherwise fall back to the wallInfo normal.
      const triggerNormalIn = wallCollision?.normal ?? wallInfo.normalIn;
      const nearWall = wallCollision !== null || wallClear < ESCAPE_TRIGGER_DIST;

      // Track continuous wall contact; this avoids "stuck for N seconds then escape".
      // `checkWallCollision` can flicker on/off by 1-2px due to discrete stepping. Use hysteresis:
      // - While colliding OR still very close to wall, accumulate.
      // - Otherwise decay instead of hard reset.
      const prevContact = this.wallContactMsById.get(car.id) ?? 0;
      const contactZone = wallCollision !== null || wallClear < ESCAPE_TRIGGER_DIST + 8;
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
      const pushingIntoWall = contactZone && absThrottle > 0.5 && vec.dot(pushDir, triggerNormalIn) < -0.15;

      const prevStuck = this.wallStuckMsById.get(car.id) ?? 0;
      const stuckNow = pushingIntoWall && moved < 1.0; // jitter is ~1px; "stuck" means not making progress
      const nextStuck = stuckNow ? prevStuck + dtMs : Math.max(0, prevStuck - dtMs * 3);
      this.wallStuckMsById.set(car.id, nextStuck);

      // Keep for debugging/telemetry if needed later.
      this.wallPushMsById.set(car.id, pushingIntoWall ? (this.wallPushMsById.get(car.id) ?? 0) + dtMs : 0);

      // NEW: clearance-stall detector (catches the "rocking 20px from wall" mode).
      // If we're near a wall but wallClear isn't improving for a while, we're effectively stuck even if
      // we're not continuously "pushing into wall" (planner thrash, bounce, tangential rocking).
      const prevBestClear = this.wallBestClearById.get(car.id);
      const prevStall = this.wallClearStallMsById.get(car.id) ?? 0;
      if (nearWall) {
        const best = prevBestClear === undefined ? wallClear : Math.max(prevBestClear, wallClear);
        const improved = wallClear > best + 6;
        const nextBest = improved ? wallClear : best;
        const nextStall = improved ? 0 : prevStall + dtMs;
        this.wallBestClearById.set(car.id, nextBest);
        this.wallClearStallMsById.set(car.id, nextStall);
      } else {
        this.wallBestClearById.set(car.id, wallClear);
        this.wallClearStallMsById.set(car.id, Math.max(0, prevStall - dtMs * 4));
      }

      // Trigger escape fast once we've been stuck for a short window.
      const clearStallMs = this.wallClearStallMsById.get(car.id) ?? 0;
      const shouldEnterEscape =
        nextStuck > 120 ||
        // classic push-stuck
        (nearWall && speed < 10 && pushingIntoWall) ||
        // rocking/thrashing near wall without gaining clearance
        (nearWall && speed < 14 && clearStallMs > 650);

      let escapeMax = this.escapeMaxMsById.get(car.id) ?? 0;
      let escapeMin = this.escapeMinMsById.get(car.id) ?? 0;
      let clearStable = this.escapeClearStableMsById.get(car.id) ?? 0;
      const isEscaping = escapeMax > 0;

      if (!isEscaping && shouldEnterEscape) {
        escapeMax = ESCAPE_MAX_MS;
        escapeMin = ESCAPE_MIN_MS;
        clearStable = 0;
        this.escapeGearById.delete(car.id);
        this.escapeGearHoldMsById.set(car.id, 0);
        this.escapeStartClearById.set(car.id, wallClear);
        this.escapeSteerById.set(car.id, 0);
        this.wallBestClearById.set(car.id, wallClear);
        this.wallClearStallMsById.set(car.id, 0);

        // Log escape entry (throttled logger; enabled via window.debugLog.enable()).
        this.logEscape({
          nowMs,
          event: "enter",
          car,
          wallClear,
          nearWall,
          contactZone,
          pushingIntoWall,
          moved,
          wallStuckMs: nextStuck,
          escapeMaxMs: escapeMax,
          escapeMinMs: escapeMin,
          clearStableMs: clearStable,
          clearNow: false,
          startClear: wallClear,
          toCenter: getCenterDir(car.position),
          dotToCenter: vec.dot(forward, getCenterDir(car.position)),
          desiredGear: (vec.dot(forward, getCenterDir(car.position)) >= 0 ? 1 : -1) as 1 | -1,
          gear: (vec.dot(forward, getCenterDir(car.position)) >= 0 ? 1 : -1) as 1 | -1,
          gearHoldMs: 0,
          input: car.input,
          force: true,
        });
      }

      if (escapeMax > 0) {
        escapeMax = Math.max(0, escapeMax - dtMs);
        escapeMin = Math.max(0, escapeMin - dtMs);

        const startClear = this.escapeStartClearById.get(car.id) ?? wallClear;
        // Exit when we're clearly off the wall OR we've made significant clearance progress.
        const clearNow =
          wallCollision === null && (wallClear >= ESCAPE_TARGET_CLEAR_DIST || wallClear - startClear >= 70);
        clearStable = clearNow ? clearStable + dtMs : 0;

        this.escapeMaxMsById.set(car.id, escapeMax);
        this.escapeMinMsById.set(car.id, escapeMin);
        this.escapeClearStableMsById.set(car.id, clearStable);

        const escapeActive = escapeMax > 0 && (escapeMin > 0 || clearStable < ESCAPE_CLEAR_STABLE_MS);
        if (!escapeActive) {
          // Escape is complete (min time satisfied AND clearStable reached). Clear escape state immediately.
          // Previously we only cleared when escapeMax hit 0, which caused "stuck in escape forever" loops.
          this.logEscape({
            nowMs,
            event: "exit",
            car,
            wallClear,
            nearWall,
            contactZone,
            pushingIntoWall,
            moved,
            wallStuckMs: nextStuck,
            escapeMaxMs: escapeMax,
            escapeMinMs: escapeMin,
            clearStableMs: clearStable,
            clearNow,
            startClear,
            toCenter: getCenterDir(car.position),
            dotToCenter: vec.dot(forward, getCenterDir(car.position)),
            desiredGear: 1,
            gear: this.escapeGearById.get(car.id) ?? 1,
            gearHoldMs: this.escapeGearHoldMsById.get(car.id) ?? 0,
            input: car.input,
            force: true,
          });

          this.escapeMaxMsById.delete(car.id);
          this.escapeMinMsById.delete(car.id);
          this.escapeClearStableMsById.delete(car.id);
          this.escapeGearById.delete(car.id);
          this.escapeGearHoldMsById.delete(car.id);
          this.escapeStartClearById.delete(car.id);
          this.escapeSteerById.delete(car.id);
          this.escapeLastLogMsById.delete(car.id);
        } else {
          // Entire escape strategy:
          // If we're stuck on a wall, move toward the center of the play area.
          // Implementation details:
          // - Choose gear (forward/reverse) with strong hysteresis to prevent rocking.
          // - Steer toward center if forward, or toward -centerDir if reversing (so backing moves toward center).
          const toCenter = getCenterDir(car.position);
          const dot = vec.dot(forward, toCenter);
          const desiredGear = (dot >= 0 ? 1 : -1) as 1 | -1;

          // Rocking fix: once we enter escape, lock the gear for the duration of escape.
          // Flipping throttle sign mid-escape is the #1 cause of oscillation against walls.
          let gear = this.escapeGearById.get(car.id);
          const holdMs = (this.escapeGearHoldMsById.get(car.id) ?? 0) + dtMs;
          if (!gear) {
            gear = desiredGear;
            this.escapeGearById.set(car.id, gear);
          }
          this.escapeGearHoldMsById.set(car.id, holdMs);

          const steerTarget = gear > 0 ? toCenter : vec.mul(toCenter, -1);
          const steerAngle = Math.atan2(steerTarget.y, steerTarget.x);
          const steerDiff = normAngle(steerAngle - car.rotation);
          let steerOut = clamp(steerDiff * 2.4, -0.9, 0.9);
          if (gear < 0) steerOut = clamp(steerOut, -0.7, 0.7);

          // Smooth steering to avoid oscillations from contact resolution jitter.
          const prevSteer = this.escapeSteerById.get(car.id) ?? 0;
          steerOut = prevSteer * 0.7 + steerOut * 0.3;
          this.escapeSteerById.set(car.id, steerOut);

          const throttleOut = gear * THROTTLE_MAG;

          const esc: Controls = { throttle: throttleOut, steer: steerOut };
          this.lastControlsById.set(car.id, esc);
          // Delay replans while escaping so rollout doesn’t flip-flop.
          this.planCooldownById.set(car.id, Math.max(this.planCooldownById.get(car.id) ?? 0, 240));
          car.input = esc;

          // Periodic escape tick logging (every 250ms per car).
          this.logEscape({
            nowMs,
            event: "tick",
            car,
            wallClear,
            nearWall,
            contactZone,
            pushingIntoWall,
            moved,
            wallStuckMs: nextStuck,
            escapeMaxMs: escapeMax,
            escapeMinMs: escapeMin,
            clearStableMs: clearStable,
            clearNow,
            startClear,
            toCenter,
            dotToCenter: dot,
            desiredGear,
            gear,
            gearHoldMs: holdMs,
            input: esc,
          });
          continue;
        }
      }

      // Not currently escaping: clear only escape-specific state.
      // IMPORTANT: Keep wall/stuck detectors (with their built-in decay) so we can
      // actually accumulate "stuck time" across frames and trigger escape reliably.
      const escapeMaxStored = this.escapeMaxMsById.get(car.id) ?? 0;
      if (escapeMaxStored <= 0) {
        this.escapeMaxMsById.delete(car.id);
        this.escapeMinMsById.delete(car.id);
        this.escapeClearStableMsById.delete(car.id);
        this.escapeGearById.delete(car.id);
        this.escapeGearHoldMsById.delete(car.id);
        this.escapeStartClearById.delete(car.id);
        this.escapeSteerById.delete(car.id);
        this.escapeLastLogMsById.delete(car.id);
      }

      const nextCooldown = (this.planCooldownById.get(car.id) ?? 0) - dtMs;

      if (nextCooldown <= 0) {
        const last = this.lastControlsById.get(car.id);
        const planned = planControlsByRollout(world, car.id, last);
        const safePlanned =
          Number.isFinite(planned.throttle) && Number.isFinite(planned.steer) ? planned : (last ?? DEFAULT_FALLBACK);

        this.lastControlsById.set(car.id, safePlanned);
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
            input: { throttle: safePlanned.throttle, steer: safePlanned.steer },
            wallClear,
            toCenter,
            dotToCenter: dot,
            note: `cooldown=reset escapeMax=${this.escapeMaxMsById.get(car.id) ?? 0} stallMs=${this.wallClearStallMsById.get(car.id) ?? 0}`,
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

  private logEscape(args: {
    nowMs: number;
    event: "enter" | "tick" | "exit";
    car: any;
    wallClear: number;
    nearWall: boolean;
    contactZone: boolean;
    pushingIntoWall: boolean;
    moved: number;
    wallStuckMs: number;
    escapeMaxMs: number;
    escapeMinMs: number;
    clearStableMs: number;
    clearNow: boolean;
    startClear: number;
    toCenter: { x: number; y: number };
    dotToCenter: number;
    desiredGear: 1 | -1;
    gear: 1 | -1;
    gearHoldMs: number;
    input: { throttle: number; steer: number };
    force?: boolean;
  }) {
    const prev = this.escapeLastLogMsById.get(args.car.id) ?? -Infinity;
    if (!args.force && args.nowMs - prev < 250) return;
    this.escapeLastLogMsById.set(args.car.id, args.nowMs);

    debugLog.log({
      timestamp: args.nowMs,
      gameTimeMs: args.nowMs,
      type: "escape",
      event: args.event,
      car: this.makeCarSnapshot(args.car),
      input: { throttle: args.input.throttle, steer: args.input.steer },
      wallClear: args.wallClear,
      nearWall: args.nearWall,
      contactZone: args.contactZone,
      pushingIntoWall: args.pushingIntoWall,
      moved: args.moved,
      wallStuckMs: args.wallStuckMs,
      escapeMaxMs: args.escapeMaxMs,
      escapeMinMs: args.escapeMinMs,
      clearStableMs: args.clearStableMs,
      clearNow: args.clearNow,
      startClear: args.startClear,
      toCenter: args.toCenter,
      dotToCenter: args.dotToCenter,
      desiredGear: args.desiredGear,
      gear: args.gear,
      gearHoldMs: args.gearHoldMs,
    });
  }
}

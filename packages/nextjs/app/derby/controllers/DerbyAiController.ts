import { AI_TEST_CONFIG } from "../debug/debugConfig";
import { getCarCorners, getCarRear, getPointWallDistanceAndNormal, physicsEngine, vec } from "../physics/PhysicsEngine";
import type { AIBehavior, CarInput, CarSim, Vector2D, WorldSim } from "../sim/typesSim";
import { AI_CONFIG, ARENA_CONFIG } from "../sim/typesSim";
import { aiView, findNearestEnemy } from "./aiHelper";
import type { CarController } from "./controllerTypes";

type AiMode = "auto" | AIBehavior;

type ControlledCars =
  | { mode: "skipIndices"; skipIndices: Set<number> }
  | { mode: "onlyIndices"; onlyIndices: Set<number> };

interface CarMemory {
  // Deterministic tick counter (increments once per controller update call).
  // Used for scheduling (stance windows, waypoint refresh) without relying on nowMs.
  tick: number;

  // High-level behavior timers (ms, sim-time)
  evadeUntilMs: number;
  wallAvoidUntilMs: number;
  recoverUntilMs: number;
  recoverMode: "front" | "rear" | null;
  recoverWallNormal: Vector2D | null;

  // Wander target
  waypoint: Vector2D | null;
  nextWaypointAtTick: number;
  waypointPickCount: number;

  // Stuck detection (controller-side; do not rely on sim writing lastPosition)
  lastPos: Vector2D | null;
  stuckForMs: number;

  // Car-to-car "pinned" detection (when two cars are physically colliding for a while)
  contactCarId: string | null;
  contactForMs: number;
  contactLastDist: number | null;
  contactEscapeCooldownUntilMs: number;

  // High-level "stance" (orbit vs strike) selection in auto mode
  autoStance: "orbiting" | "striking";
  autoStanceUntilTick: number;
  stancePickCount: number;
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

function clampInput(input: CarInput): CarInput {
  return {
    throttle: clamp(input.throttle, -1, 1.5),
    steer: clamp(input.steer, -1, 1),
  };
}

function stableRand01(seed: string): number {
  // Deterministic pseudo-random in [0,1) from a string seed.
  // Not cryptographic; just avoids Math.random so behavior is reproducible.
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to [0,1)
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function randFromStream01(runSeed: number, carId: string, stream: string, index: number): number {
  // Deterministic "infinite array" of [0,1) values. No time component.
  return stableRand01(`${runSeed}:${carId}:${stream}:${index}`);
}

function pickWanderWaypoint(carId: string, runSeed: number, pickIndex: number): Vector2D {
  // Pick a point roughly around center but drifting over time.
  const cx = ARENA_CONFIG.width / 2;
  const cy = ARENA_CONFIG.height / 2;
  const margin = ARENA_CONFIG.wallThickness + 80;

  const r1 = randFromStream01(runSeed, carId, "waypoint:a", pickIndex);
  const r2 = randFromStream01(runSeed, carId, "waypoint:b", pickIndex);

  const angle = r1 * Math.PI * 2;
  const radius = 120 + r2 * 240; // 120..360

  const x = clamp(cx + Math.cos(angle) * radius, margin, ARENA_CONFIG.width - margin);
  const y = clamp(cy + Math.sin(angle) * radius, margin, ARENA_CONFIG.height - margin);

  return { x, y };
}

function steerTowardAngle(angleRad: number, gain: number = 1.6): number {
  // angleRad is -PI..PI. Convert to steer -1..1.
  return clamp(angleRad * gain, -1, 1);
}

function distance(a: Vector2D, b: Vector2D): number {
  return vec.distance(a, b);
}

function getNearestWallNormalForCar(car: CarSim): Vector2D {
  // Normal points inward (toward arena center), and we compute it from corners
  // so it matches how `getCarWallDistance()` is derived.
  let bestDist = Infinity;
  let bestNormal: Vector2D = { x: 0, y: 0 };

  for (const c of getCarCorners(car)) {
    const r = getPointWallDistanceAndNormal(c);
    if (r.dist < bestDist) {
      bestDist = r.dist;
      bestNormal = r.normal;
    }
  }

  return bestNormal;
}

function getFrontBackWallContact(car: CarSim): {
  front: { dist: number; normal: Vector2D };
  rear: { dist: number; normal: Vector2D };
} {
  // getCarCorners() exported order (PhysicsEngine.ts):
  // [0]=front-right, [1]=front-left, [2]=back-left, [3]=back-right
  const corners = getCarCorners(car);
  const frontCorners = [corners[0], corners[1]];
  const rearCorners = [corners[2], corners[3]];

  let bestFront = { dist: Infinity, normal: { x: 0, y: 0 } as Vector2D };
  for (const c of frontCorners) {
    const r = getPointWallDistanceAndNormal(c);
    if (r.dist < bestFront.dist) bestFront = r;
  }

  let bestRear = { dist: Infinity, normal: { x: 0, y: 0 } as Vector2D };
  for (const c of rearCorners) {
    const r = getPointWallDistanceAndNormal(c);
    if (r.dist < bestRear.dist) bestRear = r;
  }

  return { front: bestFront, rear: bestRear };
}

export class DerbyAiController implements CarController {
  private controlledCars: ControlledCars;
  private memoryByCarId: Map<string, CarMemory> = new Map();
  private lastNowMs: number = 0;
  private runSeed: number;

  // Make starts look cooler: orbit briefly before engaging.
  private static readonly START_ORBIT_TICKS = 250; // 2000ms / 8ms
  // Prevent rapid flip-flopping: once chosen, keep a stance for a while.
  private static readonly AUTO_STANCE_TICKS = 625; // 5000ms / 8ms
  private static readonly WAYPOINT_REPICK_TICKS = 175; // 1400ms / 8ms

  constructor(opts: { skipIndices?: number[]; onlyIndices?: number[]; runSeed?: number } = {}) {
    if (opts.onlyIndices && opts.onlyIndices.length > 0) {
      this.controlledCars = { mode: "onlyIndices", onlyIndices: new Set(opts.onlyIndices) };
    } else {
      this.controlledCars = { mode: "skipIndices", skipIndices: new Set(opts.skipIndices ?? []) };
    }
    this.runSeed = opts.runSeed ?? 0;
  }

  private shouldControlCarIndex(i: number): boolean {
    if (this.controlledCars.mode === "onlyIndices") return this.controlledCars.onlyIndices.has(i);
    return !this.controlledCars.skipIndices.has(i);
  }

  private getMemory(car: CarSim): CarMemory {
    const existing = this.memoryByCarId.get(car.id);
    if (existing) return existing;
    const created: CarMemory = {
      tick: 0,
      evadeUntilMs: 0,
      wallAvoidUntilMs: 0,
      recoverUntilMs: 0,
      recoverMode: null,
      recoverWallNormal: null,
      waypoint: null,
      nextWaypointAtTick: 0,
      waypointPickCount: 0,
      lastPos: null,
      stuckForMs: 0,
      contactCarId: null,
      contactForMs: 0,
      contactLastDist: null,
      contactEscapeCooldownUntilMs: 0,
      autoStance: "orbiting",
      autoStanceUntilTick: 0,
      stancePickCount: 0,
    };
    this.memoryByCarId.set(car.id, created);
    return created;
  }

  update(world: WorldSim, dtMs: number, nowMs: number): void {
    if (world.gamePhase !== "playing") return;
    const runSeed = this.runSeed;

    // Defensive reset: on game restart the sim time rewinds to 0, but car IDs may be re-used.
    // If we don't clear, old "untilMs" timers/waypoints can remain active and cause bad start behavior
    // (e.g. reversing into walls / ping-pong recovery).
    if (nowMs < this.lastNowMs) {
      this.memoryByCarId.clear();
    }
    this.lastNowMs = nowMs;

    // Clean up memory for cars that no longer exist (e.g. restart)
    const liveIds = new Set(world.cars.map(c => c.id));
    for (const id of this.memoryByCarId.keys()) {
      if (!liveIds.has(id)) this.memoryByCarId.delete(id);
    }

    for (let i = 0; i < world.cars.length; i++) {
      if (!this.shouldControlCarIndex(i)) continue;
      const car = world.cars[i];
      if (!car.isAlive) continue;

      const me = aiView(car);
      const mem = this.getMemory(car);
      mem.tick += 1;
      const contact = getFrontBackWallContact(car);

      // --- Controller-side stuck detection ---
      if (mem.lastPos) {
        const moved = distance(mem.lastPos, car.position);
        if (moved < 0.6) mem.stuckForMs += dtMs;
        else mem.stuckForMs = 0;
      }
      mem.lastPos = { x: car.position.x, y: car.position.y };

      // --- Car-to-car "pinned" detection: sustained collision + head-to-head pushing ---
      // This addresses cases where two cars get locked pushing into each other and never separate.
      // Important: we *cannot* rely only on SAT overlap (checkCarCollision), because the resolver adds a
      // separation buffer (penetration + 2) which often means cars are "touching/pinned" but not overlapping.
      // So we treat either SAT collision OR "very near" as contact.
      let bestContact: { other: CarSim; normalFromMeToOther: Vector2D; dist: number; isOverlap: boolean } | null = null;
      let bestOverlapPenetration = 0;
      let bestDist = Infinity;
      for (const other of world.cars) {
        if (!other.isAlive || other.id === car.id) continue;

        const toOtherRaw = vec.sub(other.position, car.position);
        const dist = vec.length(toOtherRaw);
        const toOther = dist > 0.0001 ? vec.mul(toOtherRaw, 1 / dist) : { x: 1, y: 0 };

        // Approx "bumper distance": car width is the fore/aft length in this sim.
        const contactDist = (car.width + other.width) * 0.5 + 8; // +epsilon for solver separation buffer

        const col = physicsEngine.checkCarCollision(car, other);
        const isOverlap = !!col;
        const isNear = dist <= contactDist;
        if (!isOverlap && !isNear) continue;

        if (isOverlap) {
          // Prefer real overlap contact if available; choose the deepest overlap
          if (col.penetration > bestOverlapPenetration) {
            bestOverlapPenetration = col.penetration;
            bestContact = { other, normalFromMeToOther: col.normal, dist, isOverlap: true };
          }
        } else if (!bestContact || (!bestContact.isOverlap && dist < bestDist)) {
          // Otherwise pick the nearest "near contact" candidate.
          bestDist = dist;
          bestContact = { other, normalFromMeToOther: toOther, dist, isOverlap: false };
        }
      }

      if (bestContact) {
        const other = bestContact.other;
        if (mem.contactCarId === other.id) mem.contactForMs += dtMs;
        else {
          mem.contactCarId = other.id;
          mem.contactForMs = 0;
          mem.contactLastDist = null;
        }

        const otherView = aiView(other);
        const toOther = vec.normalize(vec.sub(other.position, car.position));
        const toMe = vec.mul(toOther, -1);

        // "Car-to-car pinned" heuristics:
        // We want to trigger escape in two common deadlocks:
        // 1) Head-to-head shove (both facing each other)
        // 2) Rear-end shove (we're pushing into someone stuck on a wall / another car)
        //
        // Important: we must NOT require the *other* car to be pushing, because the victim may be
        // reversing (wall escape) or otherwise not applying forward throttle.
        const facingEachOther = vec.dot(me.forward, toOther) > 0.55 && vec.dot(otherView.forward, toMe) > 0.55;
        const iAmPushingIntoOther = car.input.throttle > 0.65 && vec.dot(me.forward, toOther) > 0.5;
        const relSpeed = vec.length(vec.sub(car.velocity, other.velocity));
        const lowRelativeMotion = relSpeed < 2.2 && me.speed < 3.8;

        // "Not making progress" guard: if we're pushing but distance to the other isn't increasing, count it as stuck.
        // This catches rear-ending a wall-stuck car where there is no overlap (solver separation) but still no progress.
        const distNow = bestContact.dist;
        const distDelta = mem.contactLastDist === null ? 0 : distNow - mem.contactLastDist;
        mem.contactLastDist = distNow;
        const notSeparating = distDelta < 0.15; // not opening the gap
        const pinnedByContact = iAmPushingIntoOther && notSeparating;

        const CONTACT_ESCAPE_MS = 500;
        if (
          mem.contactForMs >= CONTACT_ESCAPE_MS &&
          nowMs >= mem.contactEscapeCooldownUntilMs &&
          (facingEachOther || pinnedByContact) &&
          lowRelativeMotion
        ) {
          // Escape direction: away from the other car.
          // We can safely derive it from the collision normal (me -> other).
          const away = vec.normalize(vec.mul(bestContact.normalFromMeToOther, -1));
          mem.recoverMode = "front";
          mem.recoverWallNormal = away; // reused as a generic "escape normal"
          mem.recoverUntilMs = Math.max(mem.recoverUntilMs, nowMs + 650);
          mem.wallAvoidUntilMs = Math.max(mem.wallAvoidUntilMs, nowMs + 350);
          mem.contactEscapeCooldownUntilMs = nowMs + 1400;
          // Reset contact accumulation so we don't immediately re-trigger.
          mem.contactForMs = 0;
        }
      } else {
        mem.contactCarId = null;
        mem.contactForMs = 0;
        mem.contactLastDist = null;
      }

      // --- State forcing (for testing) ---
      const forced = (AI_TEST_CONFIG.forceMode ?? "auto") as AiMode;
      const effectiveMode: AiMode = forced === "auto" ? "auto" : forced;

      // --- Auto stance selection (orbit vs strike) ---
      // First 2 seconds: always orbit (looks better).
      // After that: each car randomly commits to orbiting or striking for ~5 seconds.
      let autoStance: "orbiting" | "striking" = "orbiting";
      if (effectiveMode === "auto") {
        if (mem.tick < DerbyAiController.START_ORBIT_TICKS) {
          mem.autoStance = "orbiting";
          mem.autoStanceUntilTick = DerbyAiController.START_ORBIT_TICKS;
          autoStance = "orbiting";
        } else {
          if (mem.tick >= mem.autoStanceUntilTick) {
            const r = randFromStream01(runSeed, car.id, "autoStance", mem.stancePickCount);
            mem.autoStance = r < 0.5 ? "orbiting" : "striking";
            mem.stancePickCount += 1;
            mem.autoStanceUntilTick = mem.tick + DerbyAiController.AUTO_STANCE_TICKS;
          }
          autoStance = mem.autoStance;
        }
      }

      // --- Global safety: wall avoidance commit ---
      if (me.wallDistance < AI_CONFIG.wallAvoidDistance) {
        mem.wallAvoidUntilMs = Math.max(mem.wallAvoidUntilMs, nowMs + 250);
      }

      // --- Wall "head-on" detection: close + pointing into the wall ---
      // If we're very close and either our nose is into the wall OR our tail is into the wall,
      // trigger an escape maneuver. Which direction we apply throttle depends on whether the
      // car is facing toward the arena interior or not.
      if (me.wallDistance < 22) {
        const lowSpeed = me.speed < 2.4;
        if ((contact.front.dist < 14 || contact.rear.dist < 14) && (lowSpeed || mem.stuckForMs > 160)) {
          // Always refresh which end is pinned based on actual corner distances.
          // Otherwise we can stay stuck in a wrong mode (e.g. "front") while the rear is touching.
          const rearIsCloser = contact.rear.dist + 0.25 < contact.front.dist;
          mem.recoverMode = rearIsCloser ? "rear" : "front";
          mem.recoverWallNormal = rearIsCloser ? contact.rear.normal : contact.front.normal;
          mem.recoverUntilMs = Math.max(mem.recoverUntilMs, nowMs + 520);
          mem.wallAvoidUntilMs = Math.max(mem.wallAvoidUntilMs, nowMs + 520);
        }
      }

      // Ultra-close contact case (wallDistance ~0-2): cars can "jitter" in place and never
      // accumulate stuck time. If we're basically touching a wall, force an escape quickly.
      if (me.wallDistance < 3 && me.speed < 4) {
        // Ultra-close jitter case: always refresh end selection even mid-recovery.
        const rearIsCloser = contact.rear.dist + 0.25 < contact.front.dist;
        mem.recoverMode = rearIsCloser ? "rear" : "front";
        mem.recoverWallNormal = rearIsCloser ? contact.rear.normal : contact.front.normal;
        mem.recoverUntilMs = Math.max(mem.recoverUntilMs, nowMs + 420);
        mem.wallAvoidUntilMs = Math.max(mem.wallAvoidUntilMs, nowMs + 420);
      }

      // --- Recover if pinned/stuck near wall ---
      const isStuckNearWall = mem.stuckForMs > 500 && me.wallDistance < 35;
      if (isStuckNearWall) {
        const rearIsCloser = contact.rear.dist + 0.25 < contact.front.dist;
        mem.recoverMode = rearIsCloser ? "rear" : "front";
        mem.recoverWallNormal = rearIsCloser ? contact.rear.normal : contact.front.normal;
        mem.recoverUntilMs = Math.max(mem.recoverUntilMs, nowMs + 450);
        mem.wallAvoidUntilMs = Math.max(mem.wallAvoidUntilMs, nowMs + 450);
      }

      // Clear stale recovery state once the timer is over (so debug doesn't show "front/rear" forever).
      if (mem.recoverUntilMs <= nowMs) {
        mem.recoverMode = null;
        mem.recoverWallNormal = null;
      }

      // --- Threat detection (very simple) ---
      let threat: CarSim | null = null;
      if (effectiveMode === "auto") {
        let bestScore = 0;
        for (const other of world.cars) {
          if (!other.isAlive || other.id === car.id) continue;
          const enemy = aiView(other);
          const d = me.distanceTo(enemy);
          if (d > 260) continue;
          if (enemy.speed < me.speed + 1.2) continue;
          if (!enemy.isMovingToward(me)) continue;
          // Favor nearer + faster threats
          const score = 260 - d + (enemy.speed - me.speed) * 20;
          if (score > bestScore) {
            bestScore = score;
            threat = other;
          }
        }
        if (threat) {
          mem.evadeUntilMs = Math.max(mem.evadeUntilMs, nowMs + 260);
        }
      }

      let input: CarInput = { throttle: 0.9, steer: 0 };

      // 1) Recovery should override wall-avoid; wall-avoid is not enough when steer effectiveness is ~0 at low speed.
      if (mem.recoverUntilMs > nowMs) {
        const wallNormal = mem.recoverWallNormal ?? getNearestWallNormalForCar(car);
        const escapeTarget = vec.add(car.position, vec.mul(wallNormal, 240));
        const escapeAngle = me.angleToTarget(escapeTarget.x, escapeTarget.y);

        if (mem.recoverMode === "rear") {
          // Rear is pinned: just drive forward and steer away from the wall.
          input = {
            throttle: 1.25,
            steer: steerTowardAngle(escapeAngle, 2.2),
          };
        } else {
          // Default/front pinned: reverse while turning, then surge forward.
          const phase = mem.recoverUntilMs - nowMs > 220 ? "reverse" : "forward";
          input = {
            throttle: phase === "reverse" ? -1 : 1.2,
            // Steering affects angular velocity regardless of throttle direction.
            // Aim to rotate toward the inward normal so our next forward acceleration escapes the wall.
            steer: steerTowardAngle(escapeAngle, 2.2),
          };
        }
      } else if (mem.wallAvoidUntilMs > nowMs) {
        // 2) Wall avoidance (drive toward center with reduced throttle)
        const centerX = ARENA_CONFIG.width / 2;
        const centerY = ARENA_CONFIG.height / 2;
        const angleToCenter = me.angleToTarget(centerX, centerY);
        input = {
          throttle: me.speed > 7 ? 0.35 : 0.8,
          steer: steerTowardAngle(angleToCenter, 1.8),
        };
      } else if (effectiveMode === "auto" && mem.evadeUntilMs > nowMs) {
        // 2) Evade threats
        if (threat) {
          // Dodge laterally away from the threat.
          const threatAngle = me.angleTo(threat);
          const dodgeDir = threatAngle > 0 ? -1 : 1; // threat on right -> go left
          const dodgePoint = vec.add(car.position, vec.add(vec.mul(me.right, dodgeDir * 160), vec.mul(me.forward, 90)));
          const angle = me.angleToTarget(dodgePoint.x, dodgePoint.y);
          input = {
            throttle: 1.15,
            steer: steerTowardAngle(angle, 1.9),
          };
        } else {
          // No explicit threat; just keep moving with slight drift
          input = { throttle: 1.0, steer: 0.2 };
        }
      } else {
        // 3) Attack or wander
        const target = findNearestEnemy(car, world.cars);

        const shouldStrike =
          effectiveMode === "striking" || (effectiveMode === "auto" && autoStance === "striking" && !!target);
        if (shouldStrike) {
          // Attack: aim for enemy rear + mild lead for side/rear damage and speed advantage.
          const enemy = target ?? world.cars.find(c => c.id !== car.id && c.isAlive) ?? null;
          if (enemy) {
            const enemyRear = getCarRear(enemy);
            const lead = vec.mul(enemy.velocity, 10); // ~10 frames
            const aim = vec.add(enemyRear, lead);
            const angle = me.angleToTarget(aim.x, aim.y);
            const dist = vec.distance(car.position, enemy.position);

            // Throttle strategy:
            // - build speed when lined up
            // - if turning sharply, ease off a bit to avoid scraping walls
            const absAngle = Math.abs(angle);
            const baseThrottle = absAngle > 1.0 ? 0.5 : absAngle > 0.5 ? 0.9 : 1.25;
            const safeThrottle = me.wallDistance < 60 ? Math.min(baseThrottle, 0.85) : baseThrottle;

            input = {
              throttle: safeThrottle,
              steer: steerTowardAngle(angle, dist < 140 ? 2.2 : 1.7),
            };
            car.targetId = enemy.id;
          }
        } else {
          // Wander/orbit: follow a waypoint that drifts around center.
          const needsNewWaypoint =
            !mem.waypoint || mem.tick >= mem.nextWaypointAtTick || vec.distance(car.position, mem.waypoint) < 65;

          if (needsNewWaypoint) {
            mem.waypoint = pickWanderWaypoint(car.id, runSeed, mem.waypointPickCount);
            mem.waypointPickCount += 1;
            mem.nextWaypointAtTick = mem.tick + DerbyAiController.WAYPOINT_REPICK_TICKS;
          }

          const wp = mem.waypoint ?? { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
          const angle = me.angleToTarget(wp.x, wp.y);

          // Keep speed up, but avoid wall-damage speeds if we drift too close.
          const throttle = me.wallDistance < 70 && me.speed > 7 ? 0.45 : 1.05;
          input = {
            throttle,
            steer: steerTowardAngle(angle, 1.5),
          };
        }
      }

      // Report "stance" as AI state so it persists for the configured window.
      // Moment-to-moment actions (recovery front/rear, etc.) are exposed via aiDebug.
      const reportedState: AIBehavior =
        effectiveMode === "auto" ? autoStance : effectiveMode === "striking" ? "striking" : "orbiting";
      car.aiState = reportedState;
      car.stateTimer += dtMs;
      car.input = clampInput(input);
      // HUD debug: expose front/rear wall distances and current recovery mode.
      car.aiDebug = {
        frontWallDist: contact.front.dist,
        rearWallDist: contact.rear.dist,
        recoverMode: mem.recoverUntilMs > nowMs ? mem.recoverMode : null,
      };
    }
  }
}

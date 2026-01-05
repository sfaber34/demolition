import { AI_TEST_CONFIG } from "../debug/debugConfig";
import { getCarCorners, getCarRear, vec } from "../physics/PhysicsEngine";
import type { AIBehavior, CarInput, CarSim, Vector2D, WorldSim } from "../sim/typesSim";
import { AI_CONFIG, ARENA_CONFIG } from "../sim/typesSim";
import { aiView, findNearestEnemy } from "./aiHelper";
import type { CarController } from "./controllerTypes";

type AiMode = "auto" | AIBehavior;

type ControlledCars =
  | { mode: "skipIndices"; skipIndices: Set<number> }
  | { mode: "onlyIndices"; onlyIndices: Set<number> };

interface CarMemory {
  // High-level behavior timers (ms, sim-time)
  evadeUntilMs: number;
  wallAvoidUntilMs: number;
  recoverUntilMs: number;
  recoverMode: "front" | "rear" | null;
  recoverWallNormal: Vector2D | null;

  // Wander target
  waypoint: Vector2D | null;
  nextWaypointAtMs: number;

  // Stuck detection (controller-side; do not rely on sim writing lastPosition)
  lastPos: Vector2D | null;
  stuckForMs: number;
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

function pickWanderWaypoint(carId: string, nowMs: number): Vector2D {
  // Pick a point roughly around center but drifting over time.
  const cx = ARENA_CONFIG.width / 2;
  const cy = ARENA_CONFIG.height / 2;
  const margin = ARENA_CONFIG.wallThickness + 80;

  const t = Math.floor(nowMs / 1200); // change ~ every 1.2s if forced to repick
  const r1 = stableRand01(`${carId}:${t}:a`);
  const r2 = stableRand01(`${carId}:${t}:b`);

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
  const left = ARENA_CONFIG.wallThickness;
  const right = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const top = ARENA_CONFIG.wallThickness;
  const bottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  let bestDist = Infinity;
  let bestNormal: Vector2D = { x: 0, y: 0 };

  for (const c of getCarCorners(car)) {
    // Distances to each inner wall from this corner
    const dLeft = c.x - left;
    if (dLeft < bestDist) {
      bestDist = dLeft;
      bestNormal = { x: 1, y: 0 };
    }
    const dRight = right - c.x;
    if (dRight < bestDist) {
      bestDist = dRight;
      bestNormal = { x: -1, y: 0 };
    }
    const dTop = c.y - top;
    if (dTop < bestDist) {
      bestDist = dTop;
      bestNormal = { x: 0, y: 1 };
    }
    const dBottom = bottom - c.y;
    if (dBottom < bestDist) {
      bestDist = dBottom;
      bestNormal = { x: 0, y: -1 };
    }
  }

  return bestNormal;
}

function pointToWallDistanceAndNormal(p: Vector2D): { dist: number; normal: Vector2D } {
  // Matches PhysicsEngine.pointToWallDistance() (internal), using inner wall bounds.
  const left = ARENA_CONFIG.wallThickness;
  const right = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const top = ARENA_CONFIG.wallThickness;
  const bottom = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  const dLeft = p.x - left;
  const dRight = right - p.x;
  const dTop = p.y - top;
  const dBottom = bottom - p.y;

  let dist = dLeft;
  let normal: Vector2D = { x: 1, y: 0 };

  if (dRight < dist) {
    dist = dRight;
    normal = { x: -1, y: 0 };
  }
  if (dTop < dist) {
    dist = dTop;
    normal = { x: 0, y: 1 };
  }
  if (dBottom < dist) {
    dist = dBottom;
    normal = { x: 0, y: -1 };
  }

  return { dist, normal };
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
    const r = pointToWallDistanceAndNormal(c);
    if (r.dist < bestFront.dist) bestFront = r;
  }

  let bestRear = { dist: Infinity, normal: { x: 0, y: 0 } as Vector2D };
  for (const c of rearCorners) {
    const r = pointToWallDistanceAndNormal(c);
    if (r.dist < bestRear.dist) bestRear = r;
  }

  return { front: bestFront, rear: bestRear };
}

export class DerbyAiController implements CarController {
  private controlledCars: ControlledCars;
  private memoryByCarId: Map<string, CarMemory> = new Map();

  constructor(opts: { skipIndices?: number[]; onlyIndices?: number[] } = {}) {
    if (opts.onlyIndices && opts.onlyIndices.length > 0) {
      this.controlledCars = { mode: "onlyIndices", onlyIndices: new Set(opts.onlyIndices) };
    } else {
      this.controlledCars = { mode: "skipIndices", skipIndices: new Set(opts.skipIndices ?? []) };
    }
  }

  private shouldControlCarIndex(i: number): boolean {
    if (this.controlledCars.mode === "onlyIndices") return this.controlledCars.onlyIndices.has(i);
    return !this.controlledCars.skipIndices.has(i);
  }

  private getMemory(car: CarSim): CarMemory {
    const existing = this.memoryByCarId.get(car.id);
    if (existing) return existing;
    const created: CarMemory = {
      evadeUntilMs: 0,
      wallAvoidUntilMs: 0,
      recoverUntilMs: 0,
      recoverMode: null,
      recoverWallNormal: null,
      waypoint: null,
      nextWaypointAtMs: 0,
      lastPos: null,
      stuckForMs: 0,
    };
    this.memoryByCarId.set(car.id, created);
    return created;
  }

  update(world: WorldSim, dtMs: number, nowMs: number): void {
    if (world.gamePhase !== "playing") return;

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
      const contact = getFrontBackWallContact(car);

      // --- Controller-side stuck detection ---
      if (mem.lastPos) {
        const moved = distance(mem.lastPos, car.position);
        if (moved < 0.6) mem.stuckForMs += dtMs;
        else mem.stuckForMs = 0;
      }
      mem.lastPos = { x: car.position.x, y: car.position.y };

      // --- State forcing (for testing) ---
      const forced = (AI_TEST_CONFIG.forceMode ?? "auto") as AiMode;
      const effectiveMode: AiMode = forced === "auto" ? "auto" : forced;

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

      // --- Decide behavior ---
      const mode: AiMode =
        effectiveMode !== "auto"
          ? effectiveMode
          : mem.recoverUntilMs > nowMs || mem.evadeUntilMs > nowMs
            ? "repositioning"
            : "auto";

      let chosenBehavior: AIBehavior = car.aiState;
      let input: CarInput = { throttle: 0.9, steer: 0 };

      // 1) Recovery should override wall-avoid; wall-avoid is not enough when steer effectiveness is ~0 at low speed.
      if (mem.recoverUntilMs > nowMs) {
        chosenBehavior = "repositioning";
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
        chosenBehavior = "orbiting";
      } else if (mode === "repositioning") {
        // 2) Recover / evade
        chosenBehavior = "repositioning";
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

        if (effectiveMode === "striking" || (effectiveMode === "auto" && target)) {
          // Attack: aim for enemy rear + mild lead for side/rear damage and speed advantage.
          chosenBehavior = "striking";
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
          chosenBehavior = "orbiting";
          const needsNewWaypoint =
            !mem.waypoint || nowMs >= mem.nextWaypointAtMs || vec.distance(car.position, mem.waypoint) < 65;

          if (needsNewWaypoint) {
            mem.waypoint = pickWanderWaypoint(car.id, nowMs);
            mem.nextWaypointAtMs = nowMs + 1400;
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

      car.aiState = chosenBehavior;
      car.stateTimer += dtMs;
      car.input = clampInput(input);
      // HUD debug: expose front/rear wall distances and current recovery mode.
      car.aiDebug = {
        frontWallDist: contact.front.dist,
        rearWallDist: contact.rear.dist,
        recoverMode: mem.recoverMode,
      };
    }
  }
}

import { physicsEngine, vec } from "../physics/PhysicsEngine";
import { cloneWorldSim, stepWorldSim } from "../sim/stepWorldSim";
import { ARENA_CONFIG, type CarSim, type SimEvent, type WorldSim } from "../sim/typesSim";
import type { Controls } from "./controllerTypes";

type ScoreBreakdown = {
  score: number;
  damageDealt: number;
  damageTaken: number;
  wallDamageTaken: number;
  kills: number;
  died: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function pickNearestTarget(self: CarSim, cars: CarSim[]): CarSim | undefined {
  let best: CarSim | undefined;
  let bestDist = Infinity;
  for (const other of cars) {
    if (!other.isAlive || other.id === self.id) continue;
    const d = vec.distance(self.position, other.position);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

function wallClearanceCorners(car: Pick<CarSim, "position" | "rotation" | "width" | "height">): number {
  // Use the same geometry basis as wall collisions (rotated corners), otherwise the planner
  // can think it's "safe" while a corner is actually scraping the wall -> oscillation/rocking loops.
  const corners = physicsEngine.getCarCorners(car as any);
  const innerL = ARENA_CONFIG.wallThickness;
  const innerR = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerT = ARENA_CONFIG.wallThickness;
  const innerB = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  let clearance = Infinity;
  for (const c of corners) {
    const dLeft = c.x - innerL;
    const dRight = innerR - c.x;
    const dTop = c.y - innerT;
    const dBottom = innerB - c.y;
    const cornerClear = Math.min(dLeft, dRight, dTop, dBottom);
    if (cornerClear < clearance) clearance = cornerClear;
  }
  return Number.isFinite(clearance) ? clearance : 0;
}

function aimedCandidate(self: CarSim, target: CarSim): Controls[] {
  const toTarget = vec.sub(target.position, self.position);
  const targetAngle = Math.atan2(toTarget.y, toTarget.x);
  const angleDiff = normAngle(targetAngle - self.rotation);
  // Slightly softer steering reduces spin-outs and “circle-lock”.
  const steer = clamp(angleDiff * 1.6, -1, 1);
  return [
    { throttle: 1.0, steer },
    { throttle: 1.3, steer },
  ];
}

function candidateGrid(): Controls[] {
  // Avoid extremes by default; rollout can still pick aggressive steering via penalties if needed.
  const throttles = [0.4, 0.8, 1.1, 1.4];
  const steers = [-0.8, -0.4, -0.2, 0, 0.2, 0.4, 0.8];
  const out: Controls[] = [];
  for (const t of throttles) {
    for (const s of steers) {
      out.push({ throttle: t, steer: s });
    }
  }
  return out;
}

function stickinessBonus(c: Controls, last?: Controls): number {
  if (!last) return 0;
  const dt = Math.abs(c.throttle - last.throttle);
  const ds = Math.abs(c.steer - last.steer);
  // Prefer not to thrash: exact match gets the biggest bump; near match gets a smaller bump.
  if (dt < 1e-6 && ds < 1e-6) return 1.0;
  if (dt <= 0.5 && ds <= 0.3) return 0.25;
  return 0;
}

function wallProximityPenalty(self: CarSim): number {
  // Smooth penalty when approaching walls; stronger than before to avoid “wall glue”.
  const margin = 110;
  const d = wallClearanceCorners(self);
  const t = clamp((margin - d) / margin, 0, 1); // 0 far from wall, 1 at/through wall
  return t * t * 60;
}

function scoreFromEvents(selfId: string, events: SimEvent[]): ScoreBreakdown {
  let damageDealt = 0;
  let damageTaken = 0;
  let wallDamageTaken = 0;
  let kills = 0;
  let died = false;

  for (const e of events) {
    if (e.type === "car_impact") {
      if (e.carAId === selfId) {
        damageTaken += e.damageA;
        damageDealt += e.damageB;
      } else if (e.carBId === selfId) {
        damageTaken += e.damageB;
        damageDealt += e.damageA;
      }
    } else if (e.type === "wall_impact") {
      if (e.carId === selfId) {
        wallDamageTaken += e.damage;
      }
    } else if (e.type === "car_death") {
      if (e.carId === selfId) died = true;
      else kills += 1;
    }
  }

  // Weights tuned for "deal damage but don't die / don't farm walls".
  const score = damageDealt * 2.2 - damageTaken * 2.6 - wallDamageTaken * 3.2 + kills * 120 - (died ? 220 : 0);
  return { score, damageDealt, damageTaken, wallDamageTaken, kills, died };
}

export function planControlsByRollout(world: WorldSim, selfId: string, lastControls?: Controls): Controls {
  const fallback: Controls = lastControls ?? { throttle: 0.7, steer: 0 };
  if (world.gamePhase !== "playing") return fallback;

  const selfLive = world.cars.find(c => c.id === selfId);
  if (!selfLive || !selfLive.isAlive) return fallback;

  const CENTER = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };

  // Freeze "other cars" inputs based on the real world at plan time.
  const othersInputs = new Map<string, Controls>();
  for (const car of world.cars) {
    othersInputs.set(car.id, { throttle: car.input.throttle, steer: car.input.steer });
  }

  // Candidate set = grid + a few aimed candidates.
  const candidates = candidateGrid();
  const target = pickNearestTarget(selfLive, world.cars);
  const targetId = target?.id ?? null;
  const distToTargetBefore = target
    ? vec.distance(selfLive.position, target.position)
    : vec.distance(selfLive.position, CENTER);
  const distToCenterBefore = vec.distance(selfLive.position, CENTER);
  const wallClearBefore = wallClearanceCorners(selfLive);

  if (target) {
    candidates.push(...aimedCandidate(selfLive, target));
  }

  const rolloutDtMs = 16;
  const horizonSteps = 14; // 224ms horizon; improves stability / reduces “spin circles”.

  // If we’re close to a wall, add “escape” candidates (including reverse) that bias back toward center.
  const wallClearNow = wallClearBefore;
  if (wallClearNow < 80) {
    const toCenter = vec.sub(CENTER, selfLive.position);
    const centerAngle = Math.atan2(toCenter.y, toCenter.x);
    const centerDiff = normAngle(centerAngle - selfLive.rotation);
    const centerSteer = clamp(centerDiff * 1.8, -1, 1);
    candidates.push(
      { throttle: 1.0, steer: centerSteer },
      { throttle: 0.6, steer: centerSteer },
      { throttle: -0.7, steer: centerSteer },
      { throttle: -0.7, steer: clamp(-centerSteer, -1, 1) },
    );
  }

  let best = fallback;
  let bestScore = -Infinity;

  for (const cand of candidates) {
    const c: Controls = {
      throttle: clamp(cand.throttle, -1, 1.5),
      steer: clamp(cand.steer, -1, 1),
    };

    const sim = cloneWorldSim(world);
    const simSelf = sim.cars.find(car => car.id === selfId);
    if (!simSelf || !simSelf.isAlive) continue;

    // Apply constant inputs for this rollout.
    for (const car of sim.cars) {
      if (!car.isAlive) continue;
      if (car.id === selfId) car.input = { ...c };
      else car.input = { ...(othersInputs.get(car.id) ?? { throttle: 0.7, steer: 0 }) };
    }

    const events: SimEvent[] = [];
    for (let i = 0; i < horizonSteps; i++) {
      events.push(...stepWorldSim(sim, rolloutDtMs));
      if (sim.gamePhase !== "playing") break;
    }

    const breakdown = scoreFromEvents(selfId, events);
    const simSelfAfter = sim.cars.find(car => car.id === selfId);
    if (!simSelfAfter) continue;

    // Shaping: prefer progress toward a target, avoid walls, avoid spin/circle-lock.
    const speed = vec.length(simSelfAfter.velocity);
    const angVel = Math.abs(simSelfAfter.angularVelocity);

    const simTarget = targetId ? sim.cars.find(car => car.id === targetId && car.isAlive) : undefined;
    const distToTargetAfter = simTarget
      ? vec.distance(simSelfAfter.position, simTarget.position)
      : vec.distance(simSelfAfter.position, CENTER);
    const progress = distToTargetBefore - distToTargetAfter; // + = moved closer
    const distToCenterAfter = vec.distance(simSelfAfter.position, CENTER);
    const centerProgress = distToCenterBefore - distToCenterAfter; // + = moved toward center

    const wallClearAfter = wallClearanceCorners(simSelfAfter);
    const wallStuckPenalty = wallClearAfter < 25 && speed < 10 ? 140 : wallClearAfter < 45 && speed < 10 ? 70 : 0;
    const wallClearGain = wallClearAfter - wallClearBefore;
    const wallClearLoss = Math.max(0, wallClearBefore - wallClearAfter);

    // Control thrash penalties (important near walls).
    const throttleSignFlip =
      lastControls && Math.sign(lastControls.throttle) !== 0 && Math.sign(c.throttle) !== 0
        ? Math.sign(lastControls.throttle) !== Math.sign(c.throttle)
        : false;
    const steerSignFlip =
      lastControls && Math.sign(lastControls.steer) !== 0 && Math.sign(c.steer) !== 0
        ? Math.sign(lastControls.steer) !== Math.sign(c.steer)
        : false;

    // When near a wall, center-progress matters more than target chasing (target can be near walls).
    const nearWallNow = wallClearBefore < 70;
    const progressWeight = nearWallNow ? 0.02 : 0.08;
    const centerWeight = nearWallNow ? 0.18 : 0.02;

    const shaped =
      breakdown.score +
      // Keep momentum, but much less important than “go somewhere”.
      speed * 0.015 +
      // Move toward a target (or center if none). Reduced near walls.
      progress * progressWeight +
      // Always include a bias toward the center; strongly increased near walls.
      centerProgress * centerWeight +
      // Strongly avoid walls.
      -wallProximityPenalty(simSelfAfter) -
      wallStuckPenalty +
      // Avoid the "back 30px then head back to wall" oscillation:
      // reward increasing wall clearance when we're already close.
      (wallClearBefore < 90 ? wallClearGain * 0.45 : 0) +
      // And heavily penalize *losing* clearance when we're near a wall.
      (nearWallNow ? -wallClearLoss * 3.5 : 0) +
      // Penalize flipping directions near walls (this creates rocking).
      (nearWallNow && throttleSignFlip ? -28 : 0) +
      (nearWallNow && steerSignFlip ? -10 : 0) +
      // Avoid circling/spin: penalize angular velocity and large steering.
      -angVel * 22 -
      Math.abs(c.steer) * 3.5 +
      stickinessBonus(c, lastControls);

    if (!Number.isFinite(shaped)) continue;
    if (shaped > bestScore) {
      bestScore = shaped;
      best = c;
    }
  }

  return best;
}

import { physicsEngine, vec } from "../physics/PhysicsEngine";
import { cloneWorldSim, stepWorldSim } from "../sim/stepWorldSim";
import { ARENA_CONFIG, type CarSim, type WorldSim } from "../sim/typesSim";
import type { Controls } from "./controllerTypes";

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

type WallClearanceInfo = { clearance: number; normalIn: { x: number; y: number } };

function wallClearanceInfo(car: Pick<CarSim, "position" | "rotation" | "width" | "height">): WallClearanceInfo {
  const corners = physicsEngine.getCarCorners(car as any);
  const innerL = ARENA_CONFIG.wallThickness;
  const innerR = ARENA_CONFIG.width - ARENA_CONFIG.wallThickness;
  const innerT = ARENA_CONFIG.wallThickness;
  const innerB = ARENA_CONFIG.height - ARENA_CONFIG.wallThickness;

  let clearance = Infinity;
  const TRIGGER_DIST = 55;
  let nx = 0;
  let ny = 0;

  for (const c of corners) {
    const dLeft = c.x - innerL;
    const dRight = innerR - c.x;
    const dTop = c.y - innerT;
    const dBottom = innerB - c.y;

    const cornerClear = Math.min(dLeft, dRight, dTop, dBottom);
    if (cornerClear < clearance) clearance = cornerClear;

    // Weights based on how close each corner is to each wall (penetration counts as max weight).
    const wLeft = clamp((TRIGGER_DIST - Math.max(0, dLeft)) / TRIGGER_DIST, 0, 1);
    const wRight = clamp((TRIGGER_DIST - Math.max(0, dRight)) / TRIGGER_DIST, 0, 1);
    const wTop = clamp((TRIGGER_DIST - Math.max(0, dTop)) / TRIGGER_DIST, 0, 1);
    const wBottom = clamp((TRIGGER_DIST - Math.max(0, dBottom)) / TRIGGER_DIST, 0, 1);

    nx += wLeft * 1 + wRight * -1;
    ny += wTop * 1 + wBottom * -1;
  }

  const normalIn = vec.normalize({ x: nx, y: ny });
  return {
    clearance: Number.isFinite(clearance) ? clearance : 0,
    normalIn: normalIn.x === 0 && normalIn.y === 0 ? { x: 0, y: 0 } : normalIn,
  };
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

function wallAvoidCandidates(self: CarSim): Controls[] {
  const { clearance, normalIn } = wallClearanceInfo(self);
  if (clearance >= 110) return [];

  const CENTER = { x: ARENA_CONFIG.width / 2, y: ARENA_CONFIG.height / 2 };
  const toCenter = vec.normalize(vec.sub(CENTER, self.position));

  // Use wall normal when available; otherwise fall back to center.
  const away = normalIn.x !== 0 || normalIn.y !== 0 ? normalIn : toCenter;
  const tangentL = vec.normalize({ x: -away.y, y: away.x });
  const tangentR = vec.mul(tangentL, -1);

  const dirs = [vec.normalize(vec.add(vec.mul(away, 0.85), vec.mul(toCenter, 0.15))), tangentL, tangentR];
  const out: Controls[] = [];

  for (const dir of dirs) {
    const ang = Math.atan2(dir.y, dir.x);
    const diff = normAngle(ang - self.rotation);
    const steer = clamp(diff * 1.9, -1, 1);
    // Throttle schedule: slower when very close to wall.
    const slow = clearance < 45 ? 0.45 : 0.8;
    out.push(
      { throttle: slow, steer },
      { throttle: 1.0, steer },
      // Reverse variants to rotate out of corners / pins.
      { throttle: -0.6, steer },
      { throttle: -0.6, steer: clamp(-steer, -1, 1) },
    );
  }

  // If extremely close, include a neutral throttle + hard steer to pivot.
  if (clearance < 30) {
    out.push({ throttle: 0.0, steer: -1 }, { throttle: 0.0, steer: 1 });
  }

  return out;
}

// NOTE: stickinessBonus / wallProximityPenalty / scoreFromEvents were removed as part of the
// first-principles rollout rewrite (trajectory scoring + beam search).

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

  // === First principles ===
  // We plan a short sequence of controls over ~1s horizon and score the WHOLE trajectory.
  // This avoids the common failure mode where a short 200-300ms rollout can't "see" that
  // turning away from a wall is beneficial until it's too late.

  const target = pickNearestTarget(selfLive, world.cars);
  const targetId = target?.id ?? null;

  const wallBefore = wallClearanceInfo(selfLive);
  const wallClearBefore = wallBefore.clearance;
  const nearWall = wallClearBefore < 70;

  const distToTargetBefore = target
    ? vec.distance(selfLive.position, target.position)
    : vec.distance(selfLive.position, CENTER);
  const distToCenterBefore = vec.distance(selfLive.position, CENTER);

  // Candidate actions.
  // IMPORTANT: keep this small for performance. We'll use a cheap planner most of the time,
  // and only use beam-search MPC when near walls.
  const baseActions: Controls[] = [];
  if (!nearWall) {
    baseActions.push(...candidateGrid());
    if (target) baseActions.push(...aimedCandidate(selfLive, target));
  } else {
    // Near wall: skip the full grid; use explicit wall-avoid set + a small stabilizing set.
    baseActions.push(...wallAvoidCandidates(selfLive));
    baseActions.push(
      { throttle: 0.6, steer: 0 },
      { throttle: 0.9, steer: 0 },
      { throttle: 0.6, steer: -0.6 },
      { throttle: 0.6, steer: 0.6 },
      { throttle: -0.6, steer: -0.6 },
      { throttle: -0.6, steer: 0.6 },
    );
  }

  // Deduplicate to avoid beam bloat.
  const uniq = new Map<string, Controls>();
  for (const a of baseActions) {
    const t = clamp(a.throttle, -1, 1.5);
    const s = clamp(a.steer, -1, 1);
    uniq.set(`${t.toFixed(2)}:${s.toFixed(2)}`, { throttle: t, steer: s });
  }
  const actions = [...uniq.values()];

  // Planner parameters (adaptive).
  // - Far from walls: cheap constant-action scoring (no beam search).
  // - Near walls: small beam search with reduced branching.
  const dtMs = nearWall ? 32 : 16;
  const segmentSteps = nearWall ? 4 : 6; // 128ms vs 96ms segments
  const segments = nearWall ? 5 : 1; // ~640ms horizon near walls; cheap mode otherwise
  const beamWidth = nearWall ? 6 : 1;

  type BeamState = {
    world: WorldSim;
    score: number;
    firstAction: Controls;
    prevAction: Controls;
    minWallClear: number;
  };

  function scoreStep(simSelf: CarSim, action: Controls): number {
    const wc = wallClearanceCorners(simSelf);
    const speed = vec.length(simSelf.velocity);
    const angVel = Math.abs(simSelf.angularVelocity);

    // Hard barrier + soft barrier near wall.
    const margin = 120;
    const barrier = Math.max(0, margin - wc);
    const softWall = -0.035 * barrier * barrier;
    const hardWall = wc < 0 ? -250 : 0;

    // Penalize pushing into wall (directional).
    let pushPenalty = 0;
    if (wc < 70) {
      const info = wallClearanceInfo(simSelf);
      if (info.normalIn.x !== 0 || info.normalIn.y !== 0) {
        const fwd = vec.fromAngle(simSelf.rotation);
        const inward = vec.dot(fwd, info.normalIn);
        const push = action.throttle * inward;
        if (push < -0.1 && Math.abs(action.throttle) > 0.25) pushPenalty = -55 * -push;
      }
    }

    // Prefer being away from wall; prefer stability.
    const steerMag = Math.abs(action.steer);
    const speedReward = nearWall ? speed * 0.001 : speed * 0.01;
    const stability = -angVel * 10 - steerMag * 2.0;

    return softWall + hardWall + pushPenalty + speedReward + stability;
  }

  function scoreTerminal(sim: WorldSim, prevAction: Controls): number {
    const me = sim.cars.find(c => c.id === selfId);
    if (!me) return -Infinity;

    const wc = wallClearanceCorners(me);

    const simTarget = targetId ? sim.cars.find(c => c.id === targetId && c.isAlive) : undefined;
    const distToTargetAfter = simTarget
      ? vec.distance(me.position, simTarget.position)
      : vec.distance(me.position, CENTER);
    const targetProgress = distToTargetBefore - distToTargetAfter;

    const distToCenterAfter = vec.distance(me.position, CENTER);
    const centerProgress = distToCenterBefore - distToCenterAfter;

    // Near walls, prioritize getting back toward center; otherwise allow target chasing.
    const progressScore = nearWall ? centerProgress * 0.35 : targetProgress * 0.12 + centerProgress * 0.04;

    // Strong terminal penalty for ending near wall.
    const terminalWall = wc < 20 ? -240 : wc < 45 ? -80 : 0;

    // Smoothness: avoid thrashing vs lastControls.
    const flipPenalty =
      lastControls && Math.sign(lastControls.throttle) !== 0 && Math.sign(prevAction.throttle) !== 0
        ? Math.sign(lastControls.throttle) !== Math.sign(prevAction.throttle)
          ? -35
          : 0
        : 0;

    return progressScore + terminalWall + flipPenalty;
  }

  // Cheap planner (dominant path): evaluate constant actions over a short horizon.
  // This avoids beam-search cost on every replan while still respecting wall barrier.
  if (!nearWall) {
    let best = fallback;
    let bestScore = -Infinity;
    const horizonSteps = 10; // 160ms @16ms; enough for smooth target tracking without heavy compute
    for (const a0 of actions) {
      const sim = cloneWorldSim(world);
      for (const car of sim.cars) {
        if (!car.isAlive) continue;
        if (car.id === selfId) car.input = { ...a0 };
        else car.input = { ...(othersInputs.get(car.id) ?? { throttle: 0.7, steer: 0 }) };
      }
      const me = sim.cars.find(c => c.id === selfId);
      if (!me) continue;
      let score = 0;
      for (let i = 0; i < horizonSteps; i++) {
        const stepEvents = stepWorldSim(sim, 16);
        for (const ev of stepEvents) {
          if (ev.type === "wall_impact" && (ev as any).carId === selfId) score -= 320;
        }
        if (sim.gamePhase !== "playing") break;
        score += scoreStep(me, a0);
      }
      score += scoreTerminal(sim, a0);
      if (score > bestScore) {
        bestScore = score;
        best = a0;
      }
    }
    return best;
  }

  // Near-wall MPC: Initialize beam with each possible first action.
  let beam: BeamState[] = [];
  for (const a0 of actions) {
    const sim = cloneWorldSim(world);
    for (const car of sim.cars) {
      if (!car.isAlive) continue;
      if (car.id === selfId) car.input = { ...a0 };
      else car.input = { ...(othersInputs.get(car.id) ?? { throttle: 0.7, steer: 0 }) };
    }
    const me = sim.cars.find(c => c.id === selfId);
    if (!me) continue;

    let score = 0;
    let minWC = wallClearBefore;
    for (let i = 0; i < segmentSteps; i++) {
      const stepEvents = stepWorldSim(sim, dtMs);
      for (const ev of stepEvents) {
        if (ev.type === "wall_impact" && (ev as any).carId === selfId) score -= 320;
      }
      if (sim.gamePhase !== "playing") break;
      minWC = Math.min(minWC, wallClearanceCorners(me));
      score += scoreStep(me, a0);
    }
    beam.push({ world: sim, score, firstAction: a0, prevAction: a0, minWallClear: minWC });
  }
  beam.sort((a, b) => b.score - a.score);
  beam = beam.slice(0, beamWidth);
  if (!beam.length) return fallback;

  // Expand beam over remaining segments.
  for (let seg = 1; seg < segments; seg++) {
    const next: BeamState[] = [];
    for (const state of beam) {
      for (const a of actions) {
        const sim = cloneWorldSim(state.world);
        for (const car of sim.cars) {
          if (!car.isAlive) continue;
          if (car.id === selfId) car.input = { ...a };
        }
        const me = sim.cars.find(c => c.id === selfId);
        if (!me) continue;

        let score = state.score;
        let minWC = state.minWallClear;
        for (let i = 0; i < segmentSteps; i++) {
          const stepEvents = stepWorldSim(sim, dtMs);
          for (const ev of stepEvents) {
            if (ev.type === "wall_impact" && (ev as any).carId === selfId) score -= 320;
          }
          if (sim.gamePhase !== "playing") break;
          minWC = Math.min(minWC, wallClearanceCorners(me));
          score += scoreStep(me, a);
        }

        // Small control-change penalty to avoid oscillation inside the plan.
        score -= Math.abs(a.steer - state.prevAction.steer) * 1.6;
        score -= Math.abs(a.throttle - state.prevAction.throttle) * 1.1;

        next.push({ world: sim, score, firstAction: state.firstAction, prevAction: a, minWallClear: minWC });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, beamWidth);
  }

  // Pick best terminal.
  let best = beam[0].firstAction;
  let bestScore = -Infinity;
  for (const s of beam) {
    const terminal = scoreTerminal(s.world, s.prevAction);
    const total = s.score + terminal;
    if (total > bestScore) {
      bestScore = total;
      best = s.firstAction;
    }
  }

  return best;
}

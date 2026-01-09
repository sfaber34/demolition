import { createEmptyEffectsState } from "../../effects/effectsTypes";
import { snapshotEffects, stepEffects } from "../../effects/stepEffects";
import { physicsEngine, vec } from "../../physics/PhysicsEngine";
import { ZERO_BYTES32 } from "../../sim/deterministicRandom";
import type { SimEvent } from "../../sim/typesSim";
import type { CarSim } from "../../sim/typesSim";
import type { GameSnapshot } from "../GameEngine";
import type { IDerbyEngine } from "../IDerbyEngine";
import { WorldHandle } from "./derby_core";
import type { Hex } from "viem";

/**
 * WASM-backed derby engine adapter.
 *
 * Current status: scaffolding only. Uses a stub `WorldHandle` until the Rust WASM build is wired.
 */
export class WasmDerbyEngine implements IDerbyEngine {
  private fixedDtMs: number;
  private runSeed: Hex;
  private world: WorldHandle;

  // Fixed-timestep accumulator (mirrors TS GameEngine determinism structure)
  private accumulator = 0;

  // Effects are kept in TS and driven by derived sim events.
  private effects = createEmptyEffectsState();

  // Cached snapshot (avoid re-parsing json in render)
  private lastSnapshot: GameSnapshot | null = null;
  private lastCarsForDiff: CarSim[] | null = null;

  constructor(fixedDtMs: number = 8, opts: { runSeed?: Hex } = {}) {
    this.fixedDtMs = fixedDtMs;
    this.runSeed = opts.runSeed ?? ZERO_BYTES32;
    this.world = new WorldHandle();
    // wasm-bindgen typings may lag until you rebuild `pkg/`; use a safe runtime call.
    (this.world as any).set_seed_hex?.(this.runSeed);
    // Prime snapshot cache
    const snap = this.buildSnapshot();
    this.lastSnapshot = snap;
    this.lastCarsForDiff = snap.cars;
  }

  start(): void {
    this.world.start();
    // Refresh cached snapshot immediately so `getPhase()` reflects "playing"
    // and the RAF loop begins stepping.
    this.accumulator = 0;
    const snap = this.buildSnapshot();
    this.lastSnapshot = snap;
    this.lastCarsForDiff = snap.cars;
  }

  restart(runSeed?: Hex): void {
    // TODO: plumb seed into wasm core init when available (deterministicRandom.ts parseSeedBytes32 output)
    if (runSeed) this.runSeed = runSeed;
    this.world = new WorldHandle();
    (this.world as any).set_seed_hex?.(this.runSeed);
    this.world.start();
    this.accumulator = 0;
    this.effects = createEmptyEffectsState();
    const snap = this.buildSnapshot();
    this.lastSnapshot = snap;
    this.lastCarsForDiff = snap.cars;
  }

  step(dtMs: number): void {
    this.accumulator += dtMs;

    // Step in fixed increments for determinism and to match the old engine cadence.
    while (this.accumulator >= this.fixedDtMs) {
      const beforeCars = this.lastCarsForDiff ?? this.buildSnapshot().cars;

      this.world.step(this.fixedDtMs);
      const after = this.buildSnapshot();
      const afterCars = after.cars;

      const events = deriveSimEvents(beforeCars, afterCars);
      stepEffects(this.effects, events, this.fixedDtMs, afterCars);

      this.lastSnapshot = {
        ...after,
        effects: snapshotEffects(this.effects),
        alpha: Math.max(0, Math.min(1, (this.accumulator - this.fixedDtMs) / this.fixedDtMs)),
      };
      this.lastCarsForDiff = afterCars;

      this.accumulator -= this.fixedDtMs;
    }
  }

  getSnapshot(): GameSnapshot {
    // Return cached snapshot; ensure effects are present even before first step.
    if (this.lastSnapshot) return this.lastSnapshot;
    const snap = this.buildSnapshot();
    return { ...snap, effects: snapshotEffects(this.effects), alpha: 0 };
  }

  getPhase(): "title" | "playing" | "victory" | "gameover" {
    // TODO: export phase directly from wasm core to avoid parsing.
    const snap = this.getSnapshot();
    return snap.gamePhase;
  }

  getFixedDtMs(): number {
    return this.fixedDtMs;
  }

  cleanup(): void {
    // no-op for now
  }

  private buildSnapshot(): GameSnapshot {
    // TODO: replace JSON with packed binary snapshot once implemented.
    const raw = JSON.parse(this.world.snapshot_json()) as any;

    const gamePhase = mapPhase(raw?.phase);
    const cars = mapCars(raw?.cars);

    const winnerId: number = typeof raw?.winner_id === "number" ? raw.winner_id : 0;
    const winner = winnerId ? (cars.find(c => c.id === `car-${winnerId}`) ?? null) : null;

    return {
      cars,
      effects: snapshotEffects(this.effects),
      gamePhase,
      winner,
      gameTime: typeof raw?.game_time_ms === "number" ? raw.game_time_ms : 0,
      alpha: 0,
    };
  }
}

export default WasmDerbyEngine;

function mapPhase(phase: unknown): "title" | "playing" | "victory" | "gameover" {
  switch (phase) {
    case "Title":
      return "title";
    case "Playing":
      return "playing";
    case "Victory":
      return "victory";
    case "GameOver":
      return "gameover";
    default:
      // Safe fallback: keep showing title screen.
      return "title";
  }
}

function rgbToHex(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function fxToNumber(raw: unknown): number {
  // Rust fixed-point uses SCALE=1e6, and serializes Fx(i64) as a number.
  if (typeof raw !== "number") return 0;
  return raw / 1_000_000;
}

function mapCars(rawCars: unknown): CarSim[] {
  if (!Array.isArray(rawCars)) return [];

  return rawCars.map((c: any) => {
    const idNum: number = typeof c?.id === "number" ? c.id : 0;
    const nameId: number = typeof c?.name_id === "number" ? c.name_id : 0;
    const colorRgb: number = typeof c?.color_rgb === "number" ? c.color_rgb : 0xffffff;

    const position = { x: fxToNumber(c?.position?.x), y: fxToNumber(c?.position?.y) };
    const velocity = { x: fxToNumber(c?.velocity?.x), y: fxToNumber(c?.velocity?.y) };

    const rotation = fxToNumber(c?.rotation_rad);
    const angularVelocity = fxToNumber(c?.angular_velocity);

    const throttle = fxToNumber(c?.throttle);
    const steer = fxToNumber(c?.steer);

    const width = fxToNumber(c?.width);
    const height = fxToNumber(c?.height);

    const acceleration = fxToNumber(c?.acceleration);
    const maxSpeed = fxToNumber(c?.max_speed);
    const cornering = fxToNumber(c?.cornering);
    const traction = fxToNumber(c?.traction);

    const lastPosition = { x: fxToNumber(c?.last_position?.x), y: fxToNumber(c?.last_position?.y) };

    const names = ["Crusher", "Destroyer", "Havoc", "Rammer"];

    const isAlive = !!c?.is_alive;
    const health = typeof c?.health === "number" ? c.health : 0;
    const maxHealth = typeof c?.max_health === "number" ? c.max_health : 0;
    const damageDealt = typeof c?.damage_dealt === "number" ? c.damage_dealt : 0;

    const aiStateRaw: number = typeof c?.ai_state === "number" ? c.ai_state : 0;
    const targetIdRaw: number = typeof c?.target_id === "number" ? c.target_id : 0;

    const car: CarSim = {
      id: `car-${idNum}`,
      name: names[nameId] ?? `Car ${idNum}`,
      color: rgbToHex(colorRgb),
      position,
      velocity,
      rotation,
      angularVelocity,
      health,
      maxHealth,
      damageDealt,
      isAlive,
      width,
      height,
      acceleration,
      maxSpeed,
      cornering,
      traction,
      input: { throttle, steer },
      aiState: aiStateRaw === 1 ? "striking" : "orbiting",
      stateTimer: 0,
      targetId: targetIdRaw ? `car-${targetIdRaw}` : null,
      stuckTimer: 0,
      lastPosition,
      aiDebug: {},
    };

    return car;
  });
}

function deriveSimEvents(beforeCars: CarSim[], afterCars: CarSim[]): SimEvent[] {
  const events: SimEvent[] = [];
  const byIdBefore = new Map(beforeCars.map(c => [c.id, c]));

  // Tire marks (mirror TS stepWorldSim rule)
  for (const car of afterCars) {
    if (!car.isAlive) continue;
    const speed = vec.length(car.velocity);
    if (speed > 4 && Math.abs(car.angularVelocity) > 0.05) {
      const posHash = Math.floor(car.position.x * 0.1) + Math.floor(car.position.y * 0.1);
      if (posHash % 3 === 0) {
        events.push({ type: "tire_mark", carId: car.id, position: { ...car.position }, rotation: car.rotation });
      }
    }
  }

  // Damage deltas for this fixed tick (per car)
  const remainingDamageByCar = new Map<string, number>();
  for (const after of afterCars) {
    const before = byIdBefore.get(after.id);
    if (!before) continue;
    const dmg = Math.max(0, before.health - after.health);
    if (dmg > 0) remainingDamageByCar.set(after.id, dmg);
  }

  // Only emit car impacts for pairs that are actually colliding.
  // Also allocate damage across the colliding pairs per-car so we don't duplicate deltas across unrelated pairs.
  type Pair = { i: number; j: number; col: any };
  const pairs: Pair[] = [];
  const collisionCountByCar = new Map<string, number>();
  const bumpCount = (id: string) => collisionCountByCar.set(id, (collisionCountByCar.get(id) ?? 0) + 1);

  for (let i = 0; i < afterCars.length; i++) {
    for (let j = i + 1; j < afterCars.length; j++) {
      const a = afterCars[i];
      const b = afterCars[j];
      const col = physicsEngine.checkCarCollision(a as any, b as any);
      if (!col) continue;
      pairs.push({ i, j, col });
      bumpCount(a.id);
      bumpCount(b.id);
    }
  }

  // Precompute allocation plan for each car across its collisions.
  const allocPlan = new Map<string, { per: number; extra: number; used: number }>();
  for (const [id, total] of remainingDamageByCar.entries()) {
    const c = collisionCountByCar.get(id) ?? 0;
    if (c <= 0) continue;
    allocPlan.set(id, { per: Math.floor(total / c), extra: total % c, used: 0 });
  }

  const alloc = (id: string): number => {
    const plan = allocPlan.get(id);
    const total = remainingDamageByCar.get(id) ?? 0;
    if (!plan) return 0;
    const n = plan.per + (plan.used < plan.extra ? 1 : 0);
    plan.used += 1;
    // decrement remaining for potential wall impacts
    remainingDamageByCar.set(id, Math.max(0, total - n));
    return n;
  };

  for (const p of pairs) {
    const a = afterCars[p.i];
    const b = afterCars[p.j];
    const dmgA = alloc(a.id);
    const dmgB = alloc(b.id);
    if (dmgA === 0 && dmgB === 0) continue;

    events.push({
      type: "car_impact",
      carAId: a.id,
      carBId: b.id,
      damageA: dmgA,
      damageB: dmgB,
      impactSpeed: p.col.impactSpeed,
      contactPoint: p.col.contactPoint,
    });
  }

  // Any remaining damage (not attributed to a car collision) is treated as wall damage.
  for (const after of afterCars) {
    const remaining = remainingDamageByCar.get(after.id) ?? 0;
    if (remaining <= 0) continue;
    const wallCol = physicsEngine.checkWallCollision(after as any);
    events.push({
      type: "wall_impact",
      carId: after.id,
      damage: remaining,
      impactSpeed: wallCol?.impactSpeed ?? vec.length(after.velocity),
      contactPoint: wallCol?.contactPoint ?? { ...after.position },
    });
  }

  // Car deaths
  for (const after of afterCars) {
    const before = byIdBefore.get(after.id);
    if (before && before.isAlive && !after.isAlive) {
      events.push({ type: "car_death", carId: after.id, position: { ...after.position } });
    }
  }

  return events;
}

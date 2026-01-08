import { createEmptyEffectsState } from "../../effects/effectsTypes";
import { ZERO_BYTES32 } from "../../sim/deterministicRandom";
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

  constructor(fixedDtMs: number = 8, opts: { runSeed?: Hex } = {}) {
    this.fixedDtMs = fixedDtMs;
    this.runSeed = opts.runSeed ?? ZERO_BYTES32;
    this.world = new WorldHandle();
  }

  start(): void {
    this.world.start();
  }

  restart(runSeed?: Hex): void {
    // TODO: plumb seed into wasm core init when available (deterministicRandom.ts parseSeedBytes32 output)
    if (runSeed) this.runSeed = runSeed;
    this.world = new WorldHandle();
    this.world.start();
  }

  step(dtMs: number): void {
    this.world.step(dtMs);
  }

  getSnapshot(): GameSnapshot {
    // TODO: replace JSON with packed binary snapshot once implemented.
    // wasm core currently exports Rust `World` JSON, so we adapt it into the existing TS `GameSnapshot`.
    const raw = JSON.parse(this.world.snapshot_json()) as any;

    const gamePhase = mapPhase(raw?.phase);
    const cars = mapCars(raw?.cars);

    const winnerId: number = typeof raw?.winner_id === "number" ? raw.winner_id : 0;
    const winner = winnerId ? (cars.find(c => c.id === `car-${winnerId}`) ?? null) : null;

    return {
      cars,
      effects: createEmptyEffectsState(),
      gamePhase,
      winner,
      gameTime: typeof raw?.game_time_ms === "number" ? raw.game_time_ms : 0,
      alpha: 0,
    };
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
      aiState: "orbiting",
      stateTimer: 0,
      targetId: null,
      stuckTimer: 0,
      lastPosition,
      aiDebug: {},
    };

    return car;
  });
}

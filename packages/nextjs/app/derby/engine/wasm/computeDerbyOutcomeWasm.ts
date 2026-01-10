import type { Hex } from "viem";
import type { DerbyOutcome } from "~~/app/derby/sim/computeDerbyOutcome";

/**
 * Compute a derby outcome using the Rust/WASM canonical engine.
 *
 * Note: This runs inside the Next.js server bundle (nodejs runtime) and relies on webpack asyncWebAssembly.
 */
export async function computeDerbyOutcomeWasm(
  seed: Hex,
  opts: {
    fixedDtMs?: number;
    maxSimMs?: number;
    phaseCheckEveryTicks?: number;
  } = {},
): Promise<DerbyOutcome & { engine: "wasm" }> {
  const fixedDtMs = opts.fixedDtMs ?? 8;
  const maxSimMs = opts.maxSimMs ?? 5 * 60_000;
  const phaseCheckEveryTicks = opts.phaseCheckEveryTicks ?? 50;

  // Import the wasm-bindgen module asynchronously.
  const { WorldHandle } = await import("~~/app/derby/engine/wasm/derby_core");

  // Construct world + seed
  const world: any = new (WorldHandle as any)();
  world.set_seed_hex?.(seed);
  world.start();

  const maxTicks = Math.ceil(maxSimMs / fixedDtMs);
  let ticks = 0;

  // Step in fixed ticks; avoid parsing JSON every tick for speed.
  let lastRaw: any = null;
  while (ticks < maxTicks) {
    world.step(fixedDtMs);
    ticks++;

    if (ticks % phaseCheckEveryTicks === 0) {
      lastRaw = JSON.parse(world.snapshot_json());
      if (lastRaw?.phase === "GameOver") break;
    }
  }

  if (!lastRaw) {
    lastRaw = JSON.parse(world.snapshot_json());
  }

  const cars = mapCarsToOutcome(lastRaw?.cars);
  const winnerId: number = typeof lastRaw?.winner_id === "number" ? lastRaw.winner_id : 0;
  const winner = winnerId ? (cars.find(c => c.id === `car-${winnerId}`) ?? null) : null;

  return {
    engine: "wasm",
    seed,
    fixedDtMs,
    ticks,
    completed: lastRaw?.phase === "GameOver",
    phase: mapPhaseToOutcome(lastRaw?.phase),
    gameTimeMs: typeof lastRaw?.game_time_ms === "number" ? lastRaw.game_time_ms : 0,
    winner,
    cars,
  };
}

function mapPhaseToOutcome(phase: unknown): "title" | "playing" | "victory" | "gameover" {
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
      return "playing";
  }
}

function fxToNumber(raw: unknown): number {
  if (typeof raw !== "number") return 0;
  return raw / 1_000_000;
}

function mapCarsToOutcome(rawCars: unknown): DerbyOutcome["cars"] {
  if (!Array.isArray(rawCars)) return [];
  const names = ["Crusher", "Destroyer", "Havoc", "Rammer"];

  return rawCars.map((c: any) => {
    const idNum: number = typeof c?.id === "number" ? c.id : 0;
    const nameId: number = typeof c?.name_id === "number" ? c.name_id : 0;
    const isAlive = !!c?.is_alive;
    const health = typeof c?.health === "number" ? c.health : 0;
    const damageDealt = typeof c?.damage_dealt === "number" ? c.damage_dealt : 0;

    // Keep response compatible with old endpoint shape (no positions), but stable ids/names.
    void fxToNumber; // reserved for future expanded response

    return {
      id: `car-${idNum}`,
      name: names[nameId] ?? `Car ${idNum}`,
      // Color is not included in Rust World JSON as a CSS string; old endpoint expects it, so set null-ish stable value.
      // If you want exact colors here, we can compute from color_rgb.
      color: typeof c?.color_rgb === "number" ? rgbToHex(c.color_rgb) : "#ffffff",
      isAlive,
      health,
      damageDealt,
    };
  });
}

function rgbToHex(rgb: number): string {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

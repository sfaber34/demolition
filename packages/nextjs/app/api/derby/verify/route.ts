import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import type { GameOutcome, GameRecording } from "~~/app/derby/engine/recording";
import { parseSeedBytes32 } from "~~/app/derby/sim/deterministicRandom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Verify a derby game by replaying recorded inputs and returning the outcome.
 *
 * POST /api/derby/verify
 * Body: GameRecording (seed, playerCarIndex, inputs)
 * Returns: GameOutcome (winner, stats, stateHash)
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate recording
  const recording = body as GameRecording;
  if (!recording || typeof recording !== "object") {
    return NextResponse.json({ error: "Missing recording object" }, { status: 400 });
  }

  if (recording.version !== 1) {
    return NextResponse.json({ error: "Unsupported recording version" }, { status: 400 });
  }

  const seed = parseSeedBytes32(recording.runSeed);
  if (seed === null) {
    return NextResponse.json({ error: "Invalid runSeed in recording" }, { status: 400 });
  }

  if (typeof recording.playerCarIndex !== "number" || recording.playerCarIndex < 0 || recording.playerCarIndex > 3) {
    return NextResponse.json({ error: "Invalid playerCarIndex (must be 0-3)" }, { status: 400 });
  }

  if (!Array.isArray(recording.inputs)) {
    return NextResponse.json({ error: "Missing inputs array" }, { status: 400 });
  }

  const fixedDtMs = recording.fixedDtMs ?? 8;

  try {
    const outcome = await verifyRecording(seed, recording.playerCarIndex, recording.inputs, fixedDtMs);
    return NextResponse.json(outcome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ valid: false, error: msg } as GameOutcome, { status: 500 });
  }
}

/**
 * Run the WASM simulation with recorded player inputs and return the outcome.
 */
async function verifyRecording(
  seed: Hex,
  playerCarIndex: number,
  inputs: [number, number][],
  fixedDtMs: number,
): Promise<GameOutcome> {
  // Import WASM module
  const { WorldHandle } = await import("~~/app/derby/engine/wasm/derby_core");

  // Create world with seed
  const world: any = new (WorldHandle as any)();
  world.set_seed_hex?.(seed);
  world.set_player_controlled?.(playerCarIndex, true);
  world.start();

  // Maximum simulation time (5 minutes) as safety limit
  const maxSimMs = 5 * 60_000;
  const maxTicks = Math.ceil(maxSimMs / fixedDtMs);
  const phaseCheckEveryTicks = 50;

  let tickIndex = 0;
  let lastRaw: any = null;

  // Step through simulation, applying recorded inputs
  while (tickIndex < maxTicks) {
    // Apply recorded input for this tick (or zero if past recording length)
    const input = inputs[tickIndex] ?? [0, 0];
    const [throttle, steer] = input;
    world.set_car_input?.(playerCarIndex, throttle, steer);

    world.step(fixedDtMs);
    tickIndex++;

    // Check phase periodically
    if (tickIndex % phaseCheckEveryTicks === 0) {
      lastRaw = JSON.parse(world.snapshot_json());
      if (lastRaw?.phase === "GameOver") break;
    }
  }

  // Final snapshot
  if (!lastRaw || lastRaw.phase !== "GameOver") {
    lastRaw = JSON.parse(world.snapshot_json());
  }

  // Get state hash
  const stateHash = (world.state_hash_hex?.() ?? "0x0") as Hex;

  // Build outcome
  const cars = lastRaw?.cars ?? [];

  const finalHealth: Record<string, number> = {};
  const damageDealt: Record<string, number> = {};
  const isAlive: Record<string, boolean> = {};

  for (const c of cars) {
    const id = `car-${c.id}`;
    finalHealth[id] = typeof c.health === "number" ? c.health : 0;
    damageDealt[id] = typeof c.damage_dealt === "number" ? c.damage_dealt : 0;
    isAlive[id] = !!c.is_alive;
  }

  const winnerId: number = typeof lastRaw?.winner_id === "number" ? lastRaw.winner_id : 0;

  return {
    valid: true,
    winnerId: winnerId ? `car-${winnerId}` : null,
    gameTimeMs: typeof lastRaw?.game_time_ms === "number" ? lastRaw.game_time_ms : 0,
    finalHealth,
    damageDealt,
    isAlive,
    stateHash,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { computeDerbyOutcome } from "~~/app/derby/sim/computeDerbyOutcome";
import { parseSeedBytes32 } from "~~/app/derby/sim/deterministicRandom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSeedFromRequest(req: NextRequest): string | null {
  const { searchParams } = req.nextUrl;
  // Accept a few aliases to make calling convenient.
  return searchParams.get("seed") ?? searchParams.get("hash") ?? searchParams.get("runSeed");
}

export async function GET(req: NextRequest) {
  const seedInput = getSeedFromRequest(req);
  if (!seedInput) {
    return NextResponse.json(
      { error: "Missing seed. Provide ?seed=0x... (bytes32) or ?seed=<decimal-string>." },
      { status: 400 },
    );
  }

  const seed = parseSeedBytes32(seedInput);
  if (seed === null) {
    return NextResponse.json(
      { error: "Invalid seed. Expected 0x + 64 hex chars (bytes32) or a decimal integer string." },
      { status: 400 },
    );
  }

  const outcome = computeDerbyOutcome(seed);
  return NextResponse.json(outcome);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const seedInput =
    (typeof body === "object" &&
      body &&
      "seed" in body &&
      typeof (body as any).seed === "string" &&
      (body as any).seed) ||
    (typeof body === "object" &&
      body &&
      "hash" in body &&
      typeof (body as any).hash === "string" &&
      (body as any).hash) ||
    (typeof body === "object" &&
      body &&
      "runSeed" in body &&
      typeof (body as any).runSeed === "string" &&
      (body as any).runSeed);

  if (!seedInput) {
    return NextResponse.json(
      { error: 'Missing seed in JSON body. Provide { seed: "0x..." } (bytes32) or { seed: "123" }.' },
      { status: 400 },
    );
  }

  const seed = parseSeedBytes32(seedInput);
  if (seed === null) {
    return NextResponse.json(
      { error: "Invalid seed. Expected 0x + 64 hex chars (bytes32) or a decimal integer string." },
      { status: 400 },
    );
  }

  const outcome = computeDerbyOutcome(seed);
  return NextResponse.json(outcome);
}

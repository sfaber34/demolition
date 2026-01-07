import { DeterministicDice } from "deterministic-dice";
import { type Hex, concatHex, keccak256, toHex } from "viem";

export const ZERO_BYTES32 = ("0x" + "00".repeat(32)) as Hex;

const isBytes32 = (value: string): value is Hex => /^0x[0-9a-fA-F]{64}$/.test(value);

/**
 * Normalize a user-provided seed input into a bytes32 hex seed.
 *
 * - If `seedInput` is already a bytes32 hex (0x + 64 hex chars), it's used as-is.
 * - If `seedInput` is a decimal integer string, we hash its UTF-8 bytes to bytes32.
 */
export function parseSeedBytes32(seedInput: string): Hex | null {
  const trimmed = seedInput.trim();
  if (trimmed === "") return null;

  if (isBytes32(trimmed)) return trimmed as Hex;

  // Allow decimal integer seeds (for quick testing).
  if (/^-?\d+$/.test(trimmed)) {
    return keccak256(toHex(trimmed));
  }

  return null;
}

/**
 * Derive a deterministic "stream seed" from a base bytes32 seed + stream identifiers.
 * This keeps random access O(1) (no need to roll `index` times).
 */
function deriveStreamSeed(baseSeed: Hex, carId: string, stream: string, index: number): Hex {
  // Hash stream metadata to 32 bytes, then hash (baseSeed || metaHash) to 32 bytes.
  const metaHash = keccak256(toHex(`${carId}:${stream}:${index}`));
  const combined = concatHex([baseSeed, metaHash]);
  return keccak256(combined);
}

/**
 * Deterministic random integer in [0, n).
 */
export function randFromStreamInt(baseSeed: Hex, carId: string, stream: string, index: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`randFromStreamInt: invalid n=${n}`);
  const seed = deriveStreamSeed(baseSeed, carId, stream, index);
  // Defensive: DeterministicDice accepts hex with/without 0x.
  const dice = new DeterministicDice(seed);
  return dice.roll(n);
}

/**
 * Deterministic float in [0, 1).
 */
export function randFromStream01(baseSeed: Hex, carId: string, stream: string, index: number): number {
  // 1e6 granularity is plenty for gameplay; rejection sampling in DeterministicDice avoids modulo bias.
  const x = randFromStreamInt(baseSeed, carId, stream, index, 1_000_000);
  return x / 1_000_000;
}

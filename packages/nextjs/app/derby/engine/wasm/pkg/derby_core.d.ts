/* tslint:disable */

export class WorldHandle {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Get the full world state as JSON (debug convenience).
   */
  snapshot_json(): string;
  /**
   * Return keccak256 hash of the stable binary encoding of the world.
   */
  state_hash_hex(): string;
  constructor();
  /**
   * Step the world by `dt_ms` milliseconds.
   */
  step(dt_ms: number): void;
  /**
   * Start playing (mirrors TS engine start/restart behavior).
   */
  start(): void;
}

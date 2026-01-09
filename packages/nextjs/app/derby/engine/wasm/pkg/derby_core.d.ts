/* tslint:disable */

export class WorldHandle {
  free(): void;
  [Symbol.dispose](): void;
  /**
   * Set run seed from a 0x-prefixed hex string (bytes32). Invalid input => sets to zero.
   */
  set_seed_hex(seed_hex: string): void;
  /**
   * Create a new world with the given run seed (0x... bytes32).
   */
  static new_with_seed(seed_hex: string): WorldHandle;
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

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
   * Set the input (throttle, steer) for a car.
   * car_index: 0-3, throttle: -1.0 to 1.5, steer: -1.0 to 1.0
   * Call this before step() for player-controlled cars.
   */
  set_car_input(car_index: number, throttle: number, steer: number): void;
  /**
   * Get the full world state as JSON (debug convenience).
   */
  snapshot_json(): string;
  /**
   * Return keccak256 hash of the stable binary encoding of the world.
   */
  state_hash_hex(): string;
  /**
   * Mark a car as player-controlled (AI will skip it).
   * car_index: 0-3
   */
  set_player_controlled(car_index: number, is_player: boolean): void;
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

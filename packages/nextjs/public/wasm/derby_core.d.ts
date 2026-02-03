/* tslint:disable */
/* eslint-disable */

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_worldhandle_free: (a: number, b: number) => void;
  readonly worldhandle_new: () => number;
  readonly worldhandle_new_with_seed: (a: number, b: number) => number;
  readonly worldhandle_set_seed_hex: (a: number, b: number, c: number) => void;
  readonly worldhandle_snapshot_json: (a: number) => [number, number];
  readonly worldhandle_start: (a: number) => void;
  readonly worldhandle_state_hash_hex: (a: number) => [number, number];
  readonly worldhandle_step: (a: number, b: number) => void;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

# derby-core (Rust)

Canonical Demolition Derby simulation core intended to be:

- **Executed in the browser** via WASM to drive real-time rendering.
- **Executed in a proving environment** later to generate proofs for dispute resolution.

This crate intentionally contains **no UI code** and should avoid any source of nondeterminism.

## Layout

- `src/fixed.rs`: fixed-point math primitives
- `src/types.rs`: core sim types (cars/world)
- `src/rng.rs`: deterministic keccak-based stream RNG
- `src/init.rs`: deterministic initial world/car placement
- `src/sim.rs`: simulation step (world transition)
- `src/lib.rs`: public API (+ optional WASM exports)

## Build

WASM build will be added once the toolchain is wired up (e.g. `wasm-bindgen` via `--features wasm`).



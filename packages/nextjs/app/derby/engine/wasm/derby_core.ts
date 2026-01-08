/**
 * Bridge module for the Rust→WASM derby core.
 *
 * This file intentionally provides a stable import path for the app code.
 * The actual wasm-bindgen artifacts live in `./pkg`.
 */

export const __DERBY_CORE_WASM_STUB__ = false;

export { WorldHandle } from "./pkg/derby_core";

import { GameEngine } from "./GameEngine";
import type { IDerbyEngine } from "./IDerbyEngine";
import { __DERBY_CORE_WASM_STUB__ } from "./wasm/derby_core";
import type { Hex } from "viem";

/**
 * Factory to select the engine implementation.
 *
 * This synchronous factory always returns the TS engine.
 *
 * Reason: the wasm-bindgen "bundler" output is an **async module** under webpack `asyncWebAssembly`,
 * so it cannot be loaded via sync `require()` and cannot be instantiated synchronously.
 */
export function createDerbyEngine(fixedDtMs: number, opts: { runSeed?: Hex } = {}): IDerbyEngine {
  return new GameEngine(fixedDtMs, opts);
}

export async function createDerbyEngineAsync(fixedDtMs: number, opts: { runSeed?: Hex } = {}): Promise<IDerbyEngine> {
  const engineKind = process.env.NEXT_PUBLIC_DERBY_ENGINE ?? "wasm";
  if (engineKind === "wasm" && !__DERBY_CORE_WASM_STUB__) {
    const mod = await import("./wasm/WasmDerbyEngine");
    const EngineCtor = (mod as any).WasmDerbyEngine ?? (mod as any).default;
    return new EngineCtor(fixedDtMs, opts) as IDerbyEngine;
  }
  return new GameEngine(fixedDtMs, opts);
}

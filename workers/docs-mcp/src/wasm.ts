// The engine validate_cypher runs on (src/validate.ts): a fresh WebAssembly
// instance of the bundled module per call, from the factory form of the
// glue (generated/wasm/relate-factory.js, written by scripts/bundle.ts),
// with an empty in-memory store. Never the docs instance of src/engine.ts:
// a trap or a planner fault here discards only this instance. The glue's
// console is silent, so a panic's message (which can quote the statement)
// never reaches the Worker's log.

import wasmModule from '../generated/wasm/relate_bg.wasm';
import { createRelate } from '../generated/wasm/relate-factory.js';
import { isWasmTrap } from '../generated/wasm/trap.js';
import type { FreshEngine } from './validate.ts';

const quiet = { error() {}, warn() {}, log() {} };

export function freshEngine(): FreshEngine {
  const glue = createRelate(quiet);
  glue.initSync({ module: wasmModule });
  return new glue.RelateDb();
}

export { isWasmTrap };

// The relate engine inside the Worker (DOCS-PLAN.md §3.7 "Shape"): the
// site's WASM build, initialized once per isolate, with the docs graph
// replayed from its seed script on the first request that needs it and
// reused by every request after (ADR-0015). The seed is replayed without
// its section vectors (ADR-0028: seedWithoutVectors in the bundle); the
// hybrid lane of search_docs loads them on its first use, as one parameter
// of VECTOR_LOAD_STATEMENT (generated/vectors.txt), so a cold isolate that
// only answers full-text searches never pays for them.
//
// The fence. `new RelateDb(true)` opens an in-memory store read-only, which
// in the WASM build means an empty store that refuses every write, the seed
// included (upstream ADR-0136: `:memory:` with read-only is a write fence).
// So the graph is replayed into a writable in-memory handle, and the fence
// is structural: no tool accepts Cypher, the only statement the Worker runs
// after the seed is SEARCH_STATEMENT below, a constant read with the
// caller's text bound as a parameter, never spliced in, plus the two
// constant statements of the hybrid lane (VECTOR_LOAD_STATEMENT once,
// VECTOR_STATEMENT with the query's vector bound). validate_cypher never
// touches this instance: it runs in a fresh one per call (src/wasm.ts,
// src/validate.ts). Free Cypher
// (`query_docs_graph`) stays gated until the engine has a statement deadline
// and a way to freeze a seeded handle (DOCS-PLAN.md §3.8).

import wasmModule from '../generated/wasm/relate_bg.wasm';
import { initSync, RelateDb } from '../generated/wasm/relate.js';
import { isWasmTrap } from '../generated/wasm/trap.js';
import seed from '../generated/graph.cypher';
import vectorParams from '../generated/vectors.txt';
import { CANDIDATES, SEARCH_STATEMENT, VECTOR_LOAD_STATEMENT, VECTOR_STATEMENT, type SearchRow } from './statements.ts';

export { CANDIDATES, SEARCH_STATEMENT, VECTOR_LOAD_STATEMENT, VECTOR_STATEMENT, type SearchRow };

interface Envelope {
  error: string | null;
  rows: Record<string, unknown>[];
}

export interface EngineState {
  db: RelateDb;
  /** Nodes in the replayed graph, counted once after the replay. */
  nodes: number;
  /** Statements the seed ran. */
  statements: number;
  /** Wall time of the initialization as workerd reports it (its clock does not advance during CPU work; see README). */
  initMs: number;
  /** Section vectors loaded (0 until the hybrid lane first runs), and the load's wall time. */
  vectors: number;
  vectorsMs: number | null;
}

let state: EngineState | null = null;
/**
 * Set when the instance trapped. wasm-bindgen keeps one instance per
 * module (initSync returns it again), so a trapped engine cannot be
 * replaced inside the isolate: search_docs answers "engine unavailable"
 * until Cloudflare recycles the isolate; the tools that read the bundled
 * pages are unaffected.
 */
let trapped: string | null = null;

export class EngineUnavailable extends Error {}

/** The isolate's engine, initialized on first use. Throws when the seed fails or the instance trapped. */
export function engine(): EngineState {
  if (state) return state;
  if (trapped) throw new EngineUnavailable(trapped);
  const t0 = Date.now();
  initSync({ module: wasmModule });
  const db = new RelateDb();
  const envelopes = db.executeScript(seed, null).map((e) => JSON.parse(e) as Envelope);
  const failed = envelopes.find((e) => e.error);
  if (failed) {
    db.free();
    throw new Error(`the docs graph seed failed: ${failed.error}`);
  }
  const count = JSON.parse(db.execute('MATCH (n) RETURN count(n) AS n', null)) as Envelope;
  state = { db, nodes: Number(count.rows[0]?.n ?? 0), statements: envelopes.length, initMs: Date.now() - t0, vectors: 0, vectorsMs: null };
  return state;
}

/** Run one constant statement on the docs instance; a trap marks the isolate's engine unavailable. */
function run(statement: string, params: string): Envelope {
  const { db } = engine();
  let out: string;
  try {
    out = db.execute(statement, params);
  } catch (err) {
    if (isWasmTrap(err)) {
      state = null;
      trapped = err instanceof Error ? err.message : String(err);
      throw new EngineUnavailable(trapped);
    }
    throw err;
  }
  const env = JSON.parse(out) as Envelope;
  if (env.error) throw new Error(env.error);
  return env;
}

/** Load the section vectors into the docs instance once (the hybrid lane's first use). */
export function ensureVectors(): EngineState {
  const e = engine();
  if (e.vectors) return e;
  const t0 = Date.now();
  const env = run(VECTOR_LOAD_STATEMENT, vectorParams);
  e.vectors = Number(env.rows[0]?.n ?? 0);
  e.vectorsMs = Date.now() - t0;
  if (!e.vectors) throw new Error('no section vector was loaded');
  return e;
}

/** The vector lane's candidates (at most CANDIDATES, filters applied), nearest first. Loads the vectors on first use. */
export function vectorSearch(vector: number[], section: string | null, surface: string | null): SearchRow[] {
  ensureVectors();
  return run(VECTOR_STATEMENT, JSON.stringify({ vector, k: CANDIDATES, section, surface })).rows as unknown as SearchRow[];
}

/** Whether the engine has been initialized in this isolate. */
export const engineReady = (): boolean => state !== null;

/** The candidate sections for a query (at most CANDIDATES, filters applied), in the engine's score order. */
export function search(q: string, section: string | null, surface: string | null): SearchRow[] {
  return run(SEARCH_STATEMENT, JSON.stringify({ q, k: CANDIDATES, section, surface })).rows as unknown as SearchRow[];
}

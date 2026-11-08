// The relate engine inside the Worker (DOCS-PLAN.md §3.7 "Shape"): the
// site's WASM build, initialized once per isolate, with the docs graph
// replayed from its seed script on the first request that needs it and
// reused by every request after (ADR-0015).
//
// The fence. `new RelateDb(true)` opens an in-memory store read-only, which
// in the WASM build means an empty store that refuses every write, the seed
// included (upstream ADR-0136: `:memory:` with read-only is a write fence).
// So the graph is replayed into a writable in-memory handle, and the fence
// is structural: no tool accepts Cypher, the only statement the Worker runs
// after the seed is SEARCH_STATEMENT below, a constant read with the
// caller's text bound as a parameter, never spliced in. Free Cypher
// (`query_docs_graph`) stays gated until the engine has a statement deadline
// and a way to freeze a seeded handle (DOCS-PLAN.md §3.8).

import wasmModule from '../generated/wasm/relate_bg.wasm';
import { initSync, RelateDb } from '../generated/wasm/relate.js';
import { isWasmTrap } from '../generated/wasm/trap.js';
import seed from '../generated/graph.cypher';

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
  state = { db, nodes: Number(count.rows[0]?.n ?? 0), statements: envelopes.length, initMs: Date.now() - t0 };
  return state;
}

/** Whether the engine has been initialized in this isolate. */
export const engineReady = (): boolean => state !== null;

/**
 * search_docs as one canned statement over the `docs` full-text index
 * (src/lib/docs/graph.ts FULLTEXT_INDEX: Section heading and text). The
 * index ranks `$k` candidate sections (CANDIDATES, filter or not); the page
 * filters apply after it, and src/docs.ts re-ranks the candidates and cuts
 * them to the caller's limit. The full-text score counts query-term
 * occurrences, so on its own it favors long sections over the one a heading
 * names; the re-rank needs each section's `length`.
 */
export const SEARCH_STATEMENT = `MATCH (s:Section) SEARCH s IN (FULLTEXT INDEX docs FOR $q LIMIT $k) SCORE AS score
MATCH (p:Page {id: s.page})
WHERE ($section IS NULL OR p.section = $section)
  AND ($surface IS NULL OR EXISTS { MATCH (p)-[:APPLIES_TO]->(:Surface {id: $surface}) })
RETURN s.id AS id, s.page AS page, s.anchor AS anchor, s.heading AS heading, s.url AS url, s.length AS length, score,
       p.title AS title, p.md_url AS md_url, p.section AS section
ORDER BY score DESC, id
LIMIT $k`;

/** How many sections the index ranks for every search, before the filters and the re-rank. */
export const CANDIDATES = 200;

export interface SearchRow {
  id: string;
  page: string;
  anchor: string;
  heading: string;
  url: string;
  text?: string;
  length?: number | null;
  score: number;
  title: string;
  md_url: string;
  section: string;
}

/** The candidate sections for a query (at most CANDIDATES, filters applied), in the engine's score order. */
export function search(q: string, section: string | null, surface: string | null): SearchRow[] {
  const { db } = engine();
  const params = { q, k: CANDIDATES, section, surface };
  let out: string;
  try {
    out = db.execute(SEARCH_STATEMENT, JSON.stringify(params));
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
  return env.rows as unknown as SearchRow[];
}

// The structural checks on the docs graph (DOCS-PLAN.md §8 item 3, ADR-0007):
// build the seed script (src/lib/docs/graph.ts), replay it on the WASM engine
// the site ships (public/wasm, loaded as the cookbook check loads it), then
// ask the graph as Cypher:
//
//   graph-seed    the seed replays without an error, every node and
//                 relationship it writes is there afterwards, the three search
//                 indexes exist (docs, docs_vector, problems), and as many sections carry a vector as the
//                 embeddings artifact has current entries for
//   graph-orphan  a published page nothing links to, lists as a prerequisite
//                 or as related, and that /docs/llms.txt does not list
//   graph-unlinked a published page no other page and not the landing links
//                 to (reachable only from the sidebar and llms.txt)
//   graph-cli     a command or flag of _data/cli.json that no published
//                 reference page names in a code block or inline code
//   graph-prereq  a published page whose prerequisite is a planned page
//   graph-prereq-cycle a page that is, through PREREQUISITE_OF, its own
//                 prerequisite (paths of up to 8 pages)
//   graph-term    a :term whose id has no glossary entry
//
// Each rule's severity is configurable: `DEFAULT_SEVERITY` below, then the
// `severity` option, then DOCS_GRAPH_SEVERITY=<rule>=<error|warning|off>[,…]
// in the environment. graph-cli was a warning until the CLI reference pages
// existed (DOCS-PLAN.md §10); since phase 2 part B it is an error.
//
// Synchronous, so it can run inside a synchronous check runner: the WASM
// bundle is loaded with require() (Node ≥ 22.12 loads an ES module that way),
// from the same directory and with the same entry points as
// src/lib/cookbook/run.ts's loadEngine.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { WASM_DIR, type Engine as WasmEngine } from '../../cookbook/run.ts';
import { ENGINE_FILE, type Engine, type PageFile } from '../content.ts';
import { buildGraph, CLI_FILE, EMBEDDING_PROPERTY, EMBEDDINGS_FILE, FULLTEXT_INDEX, graphInput, PROBLEMS_INDEX, seedScript, VECTOR_INDEX, type DocsGraph } from '../graph.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

export const GRAPH_RULES = ['graph-seed', 'graph-orphan', 'graph-unlinked', 'graph-cli', 'graph-prereq', 'graph-prereq-cycle', 'graph-term'] as const;
export type GraphRule = (typeof GRAPH_RULES)[number];

export const DEFAULT_SEVERITY: Record<GraphRule, Severity | 'off'> = {
  'graph-seed': 'error',
  'graph-orphan': 'error',
  'graph-unlinked': 'warning',
  'graph-cli': 'error',
  'graph-prereq': 'error',
  'graph-prereq-cycle': 'error',
  'graph-term': 'error',
};

/** What the check needs of the site: the page files and the engine version. */
export interface GraphSite {
  pages: PageFile[];
  engine: Engine;
}

export interface GraphCheckOptions {
  severity?: Partial<Record<GraphRule, Severity | 'off'>>;
  /** A loaded WASM engine to reuse; loaded from public/wasm when absent. */
  wasm?: WasmEngine;
  /** The graph to check; built from `site.pages` when absent. */
  graph?: DocsGraph;
}

export interface GraphCheckStats {
  seedBytes: number;
  seedLines: number;
  nodes: number;
  relationships: number;
  /** Milliseconds the WASM took to replay the seed (statements only, not loading the engine). */
  replayMs: number;
}

/** The severity of each rule after the option and DOCS_GRAPH_SEVERITY. */
export function severities(option: GraphCheckOptions['severity'] = {}, env = process.env.DOCS_GRAPH_SEVERITY ?? ''): Record<GraphRule, Severity | 'off'> {
  const out = { ...DEFAULT_SEVERITY, ...option };
  for (const part of env.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [rule, value] = part.split('=').map((s) => s.trim());
    if (!(GRAPH_RULES as readonly string[]).includes(rule) || !['error', 'warning', 'off'].includes(value)) {
      throw new Error(`DOCS_GRAPH_SEVERITY: "${part}" is not <rule>=<error|warning|off> with a rule of ${GRAPH_RULES.join(', ')}`);
    }
    out[rule as GraphRule] = value as Severity | 'off';
  }
  return out;
}

/** The site's WASM bundle, loaded synchronously. */
export function loadWasmSync(wasmDir = WASM_DIR): WasmEngine {
  const require = createRequire(import.meta.url);
  const mod = require(join(wasmDir, 'relate.js'));
  mod.initSync({ module: readFileSync(join(wasmDir, 'relate_bg.wasm')) });
  if (typeof mod.RelateDb?.prototype?.executeScript !== 'function') throw new Error(`${wasmDir}: the bundle has no executeScript; rebuild it`);
  return mod as WasmEngine;
}

interface Envelope {
  error: string | null;
  rows: Record<string, unknown>[];
}

/** The structural queries; each returns one row per finding, with `page` (a page id) or `id` (a cli.json id). */
export const QUERIES: Record<Exclude<GraphRule, 'graph-seed'>, string> = {
  'graph-orphan': `MATCH (p:Page) WHERE p.status <> 'planned'
  AND NOT EXISTS { MATCH (q:Page)-[:LINKS_TO|RELATED_TO]->(p) WHERE q.id <> p.id }
  AND NOT EXISTS { MATCH (p)-[:PREREQUISITE_OF]->(q:Page) WHERE q.id <> p.id }
  AND NOT EXISTS { MATCH (:Index {id: 'llms.txt'})-[:LISTS]->(p) }
RETURN p.id AS page ORDER BY page`,
  'graph-unlinked': `MATCH (p:Page) WHERE p.status <> 'planned'
  AND NOT EXISTS { MATCH (q:Page)-[:LINKS_TO|RELATED_TO]->(p) WHERE q.id <> p.id }
  AND NOT EXISTS { MATCH (p)-[:PREREQUISITE_OF]->(q:Page) WHERE q.id <> p.id }
  AND NOT EXISTS { MATCH (:Index {id: 'landing'})-[:LISTS]->(p) }
RETURN p.id AS page ORDER BY page`,
  'graph-cli': `MATCH (c:Command)
WHERE NOT EXISTS { MATCH (p:Page)-[:DOCUMENTS]->(c) WHERE p.type = 'reference' AND p.status <> 'planned' }
RETURN 'command' AS kind, c.id AS id, c.word AS name, c.id AS command
UNION ALL
MATCH (f:Flag)
WHERE NOT EXISTS { MATCH (p:Page)-[:DOCUMENTS]->(f) WHERE p.type = 'reference' AND p.status <> 'planned' }
RETURN 'flag' AS kind, f.id AS id, f.flag AS name, f.command AS command`,
  'graph-prereq': `MATCH (pre:Page)-[:PREREQUISITE_OF]->(p:Page)
WHERE pre.status = 'planned' AND p.status <> 'planned'
RETURN p.id AS page, pre.id AS prerequisite ORDER BY page, prerequisite`,
  'graph-prereq-cycle': `MATCH path = (p:Page)-[:PREREQUISITE_OF*1..8]->(p)
WHERE p.status <> 'planned'
WITH p, min(length(path)) AS hops
RETURN p.id AS page, hops ORDER BY page`,
  'graph-term': `MATCH (p:Page)-[:USES_TERM]->(t:Term) WHERE t.short IS NULL
RETURN p.id AS page, t.id AS term ORDER BY page, term`,
};

/**
 * Replay the docs graph's seed on the WASM engine and run the structural
 * checks, reporting each finding with its page. Returns the measurements.
 */
export function checkGraph(site: GraphSite, report: Report, options: GraphCheckOptions = {}): GraphCheckStats {
  const sev = severities(options.severity);
  const emit = (rule: GraphRule, file: string, line: number | null, message: string) => {
    const s = sev[rule];
    if (s !== 'off') report(file, line, s, rule, message);
  };
  let graph: DocsGraph;
  try {
    graph = options.graph ?? buildGraph(graphInput(site.pages));
  } catch (e) {
    emit('graph-seed', CLI_FILE, null, `the docs graph does not build: ${(e as Error).message}`);
    return { seedBytes: 0, seedLines: 0, nodes: 0, relationships: 0, replayMs: 0 };
  }
  const seed = seedScript(graph);
  const stats: GraphCheckStats = {
    seedBytes: Buffer.byteLength(seed),
    seedLines: seed.split('\n').length - 1,
    nodes: graph.nodes.length,
    relationships: graph.rels.length,
    replayMs: 0,
  };
  const fileOf = new Map(site.pages.map((p) => [p.id, p.file]));
  const pageFile = (id: unknown) => fileOf.get(String(id)) ?? String(id);

  const wasm = options.wasm ?? loadWasmSync();
  const db = new wasm.RelateDb();
  try {
    const t0 = performance.now();
    const envelopes = db.executeScript(seed, null).map((e) => JSON.parse(e) as Envelope);
    stats.replayMs = performance.now() - t0;
    const failed = envelopes.find((e) => e.error);
    if (failed) {
      emit('graph-seed', ENGINE_FILE, null, `the docs graph's seed script fails on public/wasm: ${failed.error}`);
      return stats;
    }
    const query = (cypher: string): Record<string, unknown>[] => {
      const out = db.executeScript(cypher, null).map((e) => JSON.parse(e) as Envelope);
      const err = out.find((e) => e.error);
      if (err) throw new Error(`a docs graph query fails on public/wasm: ${err.error}\n${cypher}`);
      return out.flatMap((e) => e.rows);
    };

    const [counts] = query('MATCH (n) WITH count(n) AS nodes OPTIONAL MATCH ()-[r]->() RETURN nodes, count(r) AS relationships');
    if (Number(counts.nodes) !== stats.nodes || Number(counts.relationships) !== stats.relationships) {
      emit(
        'graph-seed',
        ENGINE_FILE,
        null,
        `the seed script wrote ${counts.nodes} nodes and ${counts.relationships} relationships; the graph has ${stats.nodes} and ${stats.relationships}`,
      );
    }

    const indexes = new Set(query('SHOW INDEXES YIELD name RETURN name').map((r) => String(r.name)));
    for (const name of [FULLTEXT_INDEX, VECTOR_INDEX, PROBLEMS_INDEX]) {
      if (!indexes.has(name)) emit('graph-seed', ENGINE_FILE, null, `the seed script creates no index \`${name}\` on public/wasm`);
    }
    const [vectors] = query(`MATCH (s:Section) WHERE s.${EMBEDDING_PROPERTY} IS NOT NULL RETURN count(s) AS n`);
    if (Number(vectors.n) !== graph.vectors.size) {
      emit('graph-seed', EMBEDDINGS_FILE, null, `the seed script set ${vectors.n} section vectors; the embeddings artifact has ${graph.vectors.size} current ones`);
    }

    for (const row of query(QUERIES['graph-orphan'])) {
      emit('graph-orphan', pageFile(row.page), 1, `orphan page: no page links to it, lists it as a prerequisite or as related, and /docs/llms.txt does not list it`);
    }
    for (const row of query(QUERIES['graph-unlinked'])) {
      emit('graph-unlinked', pageFile(row.page), 1, `no other page and not the docs landing links to \`${row.page}\`; only the sidebar and llms.txt reach it`);
    }
    for (const row of query(QUERIES['graph-prereq'])) {
      emit('graph-prereq', pageFile(row.page), 1, `prerequisite \`${row.prerequisite}\` is a planned page; a published page cannot depend on a page that is not written yet`);
    }
    for (const row of query(QUERIES['graph-prereq-cycle'])) {
      emit('graph-prereq-cycle', pageFile(row.page), 1, `\`${row.page}\` is its own prerequisite through ${row.hops} PREREQUISITE_OF step(s); a reading order needs a page to start from`);
    }
    for (const row of query(QUERIES['graph-term'])) {
      emit('graph-term', pageFile(row.page), null, `:term id \`${row.term}\` has no glossary entry (src/content/docs/_glossary/${row.term}.mdx)`);
    }
    // One finding per command (with its flags) and one for the query-run flags, so the list stays readable.
    const missing = new Map<string, string[]>();
    for (const row of query(QUERIES['graph-cli'])) {
      const group = row.command ? `command \`${row.command}\`` : 'query-run flags';
      const what = row.kind === 'command' ? `the command itself (\`relate ${row.name}\`)` : `\`${row.name}\` (${row.id})`;
      missing.set(group, [...(missing.get(group) ?? []), what]);
    }
    for (const [group, list] of [...missing].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      emit('graph-cli', CLI_FILE, null, `${group}: no reference page documents ${list.join(', ')}`);
    }
  } finally {
    db.free();
  }
  return stats;
}

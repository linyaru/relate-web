// Runnable cells (DOCS-PLAN.md §8 item 2, §7.5): every page's ```cypher run
// cells replayed on the site's WASM build (public/wasm), in page order on one
// in-memory database, the cookbook's record model.
//
//   checkCells(site, report)   docs:check: each cell runs as its info string
//                              says (no error, or an error for `expect=error`),
//                              and the run matches the page's results sidecar
//                              entry for entry; every recorded graph has a
//                              fresh, inert light and dark static form; the
//                              graph view's double-click expansion finds each
//                              graph's first node's relationships
//   recordCells(site, log)     --record: rewrites each page's sidecar and its
//                              static graph forms from a run, and nothing else
//
// The example page (_example/) is checked and recorded too, built or not: it
// is the pipeline's fixture.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { surprise } from '../../cookbook/cells.ts';
import { THEMES, type Theme } from '../../cookbook/diagrams.ts';
import { caption, labelColor } from '../../cookbook/graph-model.ts';
import { MAX_RESULT_ROWS } from '../../cookbook/recipe.ts';
import { lastEnvelope } from '../../cookbook/result-view.ts';
import { expandProblem, loadEngine, type Engine as Wasm } from '../../cookbook/run.ts';
import { drawSchema, layoutSchema } from '../../cookbook/schema-graph.ts';
import { drawResultGraphWith, extrasKey } from '../elements/_graph-extras-static.ts';
import type { Font } from '../../cookbook/schema-text.ts';
import { DOCS_DIR, ROOT, splitFrontmatter, type Engine, type PageFile } from '../content.ts';
import { parsePage } from '../parse.ts';
import {
  collectCells,
  drawsStatic,
  graphCaption,
  graphHash,
  graphHashComment,
  pageDiagrams,
  readResultGraph,
  readResults,
  RECORD_COMMAND,
  resultGraphCell,
  resultGraphFile,
  resultsFile,
  type PageCell,
  type RecordedCell,
  type RecordedGraph,
  type Results,
} from '../results.ts';

type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** What the cells check needs of scripts/docs.ts's Site. */
export interface CellsSite {
  engine: Engine;
  published: Map<string, PageFile>;
}

const EXAMPLE = join(DOCS_DIR, '_example/example.mdx');

interface CellPage {
  file: string;
  cells: PageCell[];
  data: Map<string, string>;
  problems: string[];
  /** Lines the frontmatter takes, so body lines map to file lines. */
  offset: number;
}

/** The pages to replay: every published page, and the example page. */
function pagesOf(site: CellsSite): CellPage[] {
  const files = [...site.published.values()].map((p) => p.file);
  if (existsSync(EXAMPLE) && !files.includes(EXAMPLE)) files.push(EXAMPLE);
  const out: CellPage[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const { body } = splitFrontmatter(text, relative(ROOT, file));
    let found;
    try {
      found = collectCells(parsePage(body));
    } catch {
      continue; // not valid MDX: the parse check reports it
    }
    if (found.cells.length === 0 && !existsSync(resultsFile(file))) continue;
    out.push({ file, ...found, offset: text.slice(0, text.length - body.length).split('\n').length - 1 });
  }
  return out;
}

// ---------------------------------------------------------------- running

/** Envelope keys that change from run to run, left out of a recording. */
const TIMINGS = new Set(['elapsed_ms', 'execute_ms', 'parse_ms', 'plan_ms']);

/** A wire envelope as recorded: its keys sorted, timings left out. */
export function recordedEnvelope(envelope: unknown): unknown {
  if (envelope === null || typeof envelope !== 'object') return envelope ?? null;
  return Object.fromEntries(
    Object.entries(envelope as Record<string, unknown>)
      .filter(([k]) => !TIMINGS.has(k))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

export interface PageRun {
  results: Results;
  /** Why the run ended before the last cell, or null. */
  stopped: string | null;
  /** Other problems with the run: oversized results, expansions that miss relationships. */
  problems: string[];
}

/** The relate version of a WASM build, from `dbms.components()`. */
export function engineVersion(wasm: Wasm): string {
  const db = new wasm.RelateDb();
  try {
    const [env] = db.executeScript("CALL dbms.components() YIELD name, versions WHERE name = 'Relate' RETURN versions[0] AS v", null);
    const v = (JSON.parse(env) as { rows?: { v?: unknown }[] }).rows?.[0]?.v;
    if (typeof v !== 'string') throw new Error('dbms.components() names no Relate version');
    return v;
  } finally {
    db.free();
  }
}

/** Run a page's cells in order on a fresh in-memory database, as the page runtime does. */
export async function runCells(wasm: Wasm, cells: PageCell[], data: Map<string, string>, verified: string): Promise<PageRun> {
  const db = new wasm.RelateDb();
  const run = (code: string, params: string | null) => {
    const envelopes = db.executeScript(code, params);
    return { envelopes, recording: JSON.parse(wasm.renderResult(envelopes)) };
  };
  const results: Results = { format: 1, verified, cells: {} };
  const problems: string[] = [];
  try {
    for (const cell of cells) {
      const params = cell.params === null ? null : (data.get(cell.params) ?? null);
      const { envelopes, recording } = run(cell.code, params);
      if (envelopes.length === 0) return { results, stopped: `cell \`${cell.id}\` has no statements`, problems };
      const last = lastEnvelope(envelopes);
      results.cells[cell.id] = {
        kind: recording.kind,
        text: recording.text,
        table: recording.table ?? null,
        graph: recording.graph ?? null,
        envelope: recordedEnvelope(last),
        expectError: cell.expectError,
      };
      const stopped = surprise(cell, last);
      if (stopped) return { results, stopped, problems };
      for (const env of envelopes) {
        const rows = (JSON.parse(env) as { rows?: unknown[] }).rows;
        if (Array.isArray(rows) && rows.length > MAX_RESULT_ROWS) problems.push(`cell \`${cell.id}\` returns ${rows.length} rows; add a LIMIT (max ${MAX_RESULT_ROWS})`);
      }
      const expand = await expandProblem(cell.id, (code, p) => run(code, p), recording.graph ?? null);
      if (expand) problems.push(expand);
    }
    return { results, stopped: null, problems };
  } finally {
    db.free();
  }
}

// ---------------------------------------------------------------- comparing

/** `value` as JSON with every object's keys sorted, so key order never counts as drift. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

const normalize = (c: RecordedCell): RecordedCell => ({
  kind: c.kind,
  text: c.text,
  table: c.table ?? null,
  graph: c.graph ?? null,
  envelope: c.envelope ?? null,
  expectError: c.expectError ?? false,
});

/** How a cell's run differs from its recording, or null. */
export function cellDrift(id: string, recorded: RecordedCell | undefined, actual: RecordedCell): string | null {
  if (!recorded) return `cell \`${id}\` has no recorded result; run ${RECORD_COMMAND}`;
  const r = normalize(recorded);
  const a = normalize(actual);
  if (r.kind !== a.kind || r.text !== a.text) {
    return `cell \`${id}\` result differs from its recording; run ${RECORD_COMMAND} and review the diff\n--- recorded (${r.kind})\n${r.text}\n--- actual (${a.kind})\n${a.text}`;
  }
  for (const key of ['table', 'graph', 'envelope', 'expectError'] as const) {
    if (canonical(r[key]) !== canonical(a[key])) return `cell \`${id}\`'s recorded ${key} differs from a run; run ${RECORD_COMMAND} and review the diff`;
  }
  return null;
}

// ---------------------------------------------------------------- static graph forms

// Advance widths of Public Sans per 100 px (printable ASCII from the space),
// measured in Chrome from public/fonts, as scripts/diagrams/render.mjs
// measures; kerning is ignored, which errs a little wide.
const ADVANCES: Record<number, number[]> = {
  400: [24,25,43,60,66,90,71,25,30,31,39,55,24,38,23,35,61,41,60,63,63,64,62,60,65,62,23,24,55,55,55,52,83,71,67,69,69,62,59,73,77,28,39,68,58,89,75,73,64,75,68,67,59,70,67,95,69,61,64,30,35,30,47,52,22,55,60,54,60,57,40,62,58,25,26,56,30,87,58,57,60,60,39,51,39,58,50,78,56,54,48,33,26,33,57],
  600: [23,27,46,61,67,92,75,26,32,32,44,57,26,39,25,37,63,42,62,65,64,66,64,61,66,64,25,26,56,57,56,53,83,72,68,70,71,63,60,75,77,30,40,70,58,90,77,75,65,76,69,68,61,71,69,96,70,64,65,32,37,32,48,54,24,56,60,55,60,57,40,63,59,26,28,57,32,88,59,57,60,60,40,52,40,59,51,78,58,55,49,36,27,36,59],
};

/** A text's width in pixels in `font` (the schema drawing's measure). */
export function measure(text: string, font: Font): number {
  const table = ADVANCES[font.weight] ?? ADVANCES[400];
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)! - 32;
    w += c >= 0 && c < table.length ? (table[c] * font.size) / 100 : font.size * 0.6;
  }
  return w;
}

const CAPTION_MAX = 24;
const cut = (s: string) => (s.length > CAPTION_MAX ? `${s.slice(0, CAPTION_MAX - 1)}…` : s);

/**
 * A recorded graph drawn as the cookbook draws a data model (d3-force,
 * ADR-0135): each node a circle in its label's colour holding its caption
 * and labels, each relationship an arrow with its type. Light and dark.
 * `extras` (the cell's words and recorded envelope) applies the graph view
 * extras the live view starts with: `layout=`, `caption=`, `highlight=path`.
 */
export function drawResultGraph(
  graph: RecordedGraph,
  cellId: string,
  title: string,
  extras?: { words?: Record<string, string>; envelope?: unknown },
): Record<Theme, string> {
  const withExtras = extras ? drawResultGraphWith(graph, cellId, title, { words: extras.words, envelope: extras.envelope, measure }) : null;
  if (withExtras) return withExtras;
  const colors = new Map<string, string>();
  const model = {
    direction: 'LR',
    nodes: graph.nodes.map((n) => ({
      id: `n${n.id}`,
      label: cut(caption(n)),
      props: n.labels.length ? [n.labels.map((l) => `:${l}`).join('')] : [],
      color: labelColor(n.labels, colors),
    })),
    edges: graph.rels.map((r) => ({ source: `n${r.start_node}`, target: `n${r.end_node}`, type: r.type, props: '', dashed: false, arrow: true })),
  };
  const layout = layoutSchema(model, measure);
  const out = {} as Record<Theme, string>;
  for (const theme of THEMES) out[theme] = drawSchema(layout, { id: `result-${cellId}-${theme}`, theme, title });
  return out;
}

// ---------------------------------------------------------------- check

/** docs:check: every page's cells against their recordings and static forms. */
export async function checkCells(site: CellsSite, report: Report): Promise<void> {
  const pages = pagesOf(site);
  if (pages.length === 0) return;
  const wasm = await loadEngine();
  const version = engineVersion(wasm);
  if (version !== site.engine.verified) {
    report(join(ROOT, 'public/wasm/relate_bg.wasm'), null, 'error', 'cells', `public/wasm is relate ${version}; _data/engine.json says ${site.engine.verified}`);
  }
  for (const page of pages) {
    const sidecar = resultsFile(page.file);
    const line = (cell: PageCell | undefined) => (cell?.line ? cell.line + page.offset : null);
    for (const p of page.problems) report(page.file, null, 'error', 'cells', p);
    if (page.problems.length) continue;
    let recorded: Results | null;
    try {
      recorded = readResults(page.file);
    } catch (e) {
      report(sidecar, null, 'error', 'cells', (e as Error).message);
      continue;
    }
    // Language samples' entries (kind "text") belong to docs:samples (checks/samples.ts).
    const sampleIds = new Set(Object.entries(recorded?.cells ?? {}).filter(([, c]) => c.kind === 'text').map(([id]) => id));
    if (page.cells.length === 0) {
      if (sampleIds.size === 0) report(sidecar, null, 'error', 'cells', `a results file for a page with no cells; delete it`);
      continue;
    }
    if (!recorded) {
      report(page.file, line(page.cells[0]), 'error', 'cells', `the page has cells but no ${relative(ROOT, sidecar)}; run ${RECORD_COMMAND}`);
      continue;
    }
    const run = await runCells(wasm, page.cells, page.data, version);
    const byId = new Map(page.cells.map((c) => [c.id, c]));
    if (run.stopped) {
      const id = /^cell `([^`]+)`/.exec(run.stopped)?.[1];
      report(page.file, line(id ? byId.get(id) : undefined), 'error', 'cells', run.stopped);
      const skipped = page.cells.length - Object.keys(run.results.cells).length;
      if (skipped > 0) report(page.file, null, 'error', 'cells', `the ${skipped} cell(s) after it did not run`);
    }
    for (const p of run.problems) {
      const id = /^cell `([^`]+)`/.exec(p)?.[1];
      report(page.file, line(id ? byId.get(id) : undefined), 'error', 'cells', p);
    }
    for (const [id, actual] of Object.entries(run.results.cells)) {
      const drift = cellDrift(id, recorded.cells[id], actual);
      if (drift) report(page.file, line(byId.get(id)), 'error', 'cells', drift);
    }
    for (const id of Object.keys(recorded.cells)) {
      if (!byId.has(id) && !sampleIds.has(id)) report(sidecar, null, 'error', 'cells', `a recording of cell \`${id}\`, which the page does not have; run ${RECORD_COMMAND}`);
    }
    // Static graph forms: one per drawable recorded graph, fresh and inert; none left over.
    const { dir, stem } = pageDiagrams(page.file);
    const drawn = new Set<string>();
    for (const cell of page.cells) {
      const graph = recorded.cells[cell.id]?.graph;
      if (!drawsStatic(graph)) continue;
      drawn.add(cell.id);
      try {
        readResultGraph(page.file, cell.id, graph, extrasKey(cell.words, recorded.cells[cell.id]?.envelope));
      } catch (e) {
        report(page.file, line(cell), 'error', 'cells', (e as Error).message);
      }
    }
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        const id = resultGraphCell(stem, name);
        if (id !== null && !drawn.has(id)) report(join(dir, name), null, 'error', 'cells', `a static graph form of cell \`${id}\`, which has no recorded graph to draw; run ${RECORD_COMMAND}`);
      }
    }
  }
}

// ---------------------------------------------------------------- record

/**
 * --record: each page's sidecar and static graph forms rewritten from a run.
 * A page whose run goes other than its info strings say is reported and left
 * as it was. Returns how many files changed.
 */
export async function recordCells(site: CellsSite, report: Report, log: (line: string) => void): Promise<number> {
  const pages = pagesOf(site);
  if (pages.length === 0) return 0;
  const wasm = await loadEngine();
  const version = engineVersion(wasm);
  let changed = 0;
  const write = (path: string, text: string) => {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
    writeFileSync(path, text);
    changed++;
    log(`wrote ${relative(ROOT, path)}`);
  };
  for (const page of pages) {
    for (const p of page.problems) report(page.file, null, 'error', 'cells', p);
    if (page.problems.length) continue;
    const sidecar = resultsFile(page.file);
    let existing: Results | null = null;
    try {
      existing = readResults(page.file);
    } catch {
      // A malformed sidecar is rewritten from the run.
    }
    const samples = Object.entries(existing?.cells ?? {}).filter(([, c]) => c.kind === 'text');
    if (page.cells.length === 0) {
      if (samples.length) continue; // only language samples: docs:samples owns this file
      rmSync(sidecar, { force: true });
      log(`removed ${relative(ROOT, sidecar)} (the page has no cells)`);
      changed++;
      continue;
    }
    const run = await runCells(wasm, page.cells, page.data, version);
    const problems = [...(run.stopped ? [run.stopped] : []), ...run.problems];
    if (problems.length) {
      for (const p of problems) report(page.file, null, 'error', 'cells', `not recorded: ${p}`);
      continue;
    }
    // The language samples' entries (docs:samples) stay, after the cells.
    for (const [id, c] of samples) if (!(id in run.results.cells)) run.results.cells[id] = c;
    write(sidecar, `${JSON.stringify(run.results, null, 2)}\n`);
    const { dir, stem } = pageDiagrams(page.file);
    const keep = new Set<string>();
    for (const cell of page.cells) {
      const graph = run.results.cells[cell.id].graph;
      if (!drawsStatic(graph)) continue;
      const envelope = run.results.cells[cell.id].envelope;
      const svg = drawResultGraph(graph, cell.id, graphCaption(cell.title), { words: cell.words, envelope });
      mkdirSync(dir, { recursive: true });
      for (const theme of THEMES) {
        const name = resultGraphFile(stem, cell.id, theme);
        keep.add(name);
        write(join(dir, name), `${graphHashComment(graphHash(graph, extrasKey(cell.words, envelope)))}\n${svg[theme]}\n`);
      }
    }
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (resultGraphCell(stem, name) !== null && !keep.has(name)) {
          rmSync(join(dir, name));
          changed++;
          log(`removed ${relative(ROOT, join(dir, name))}`);
        }
      }
    }
  }
  log(`recorded ${pages.length} page(s) on relate ${version}`);
  return changed;
}

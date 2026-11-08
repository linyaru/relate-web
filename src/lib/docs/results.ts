// Recorded results of a page's runnable cells (```cypher run fences): a
// sidecar `<page>.results.json` beside the page, keyed by cell id, so the
// page is complete without JavaScript and the markdown twin can carry each
// result (DOCS-PLAN.md §5 "Runnable cells"). `node scripts/docs.ts --record`
// rewrites only this file and the static graph forms (checks/cells.ts); the
// page's MDX never holds results.
//
// Format 1:
//
//   {
//     "format": 1,
//     "verified": "0.16.1",              // the engine version that recorded it
//     "cells": {
//       "<cell id>": {
//         "kind": "table" | "gram" | "text", // as the cookbook's result blocks; "text" is a language sample's output (samples.ts)
//         "text": "…",                   // the recorded result as text (the twin's block)
//         "table": {columns, rows, numeric, summary} | null,   // result-view.ts TableCells
//         "graph": {nodes, rels} | null, // for the graph view
//         "envelope": {…} | null,        // the last statement's wire envelope, timings left out (the JSON view)
//         "expectError": false           // the cell is expected to fail
//       }
//     }
//   }
//
// A cell's id is its `name=<id>` from the info string (`cypher run name=count`),
// or `cell-<n>` for the n-th run cell on the page (from 1) when it has none.
// `params=<name>` runs the cell with the page's ```json data=<name> block as
// its parameters; `expect=error` marks a cell that must fail.
//
// Static graph forms (DOCS-PLAN.md §7.5): every recorded graph result with
// something to draw has a light and a dark SVG beside the page, in
// `diagrams/<page>-result-<cell id>-<theme>.svg`, laid out at record time and
// stamped with the hash of the graph they draw. The build inlines both and
// fails when one is missing or stale.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import type { Code, Heading, Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';

import { parseDataInfo, parseRunInfo, type RunInfo } from '../cookbook/cells.ts';
import { inertSvg, THEMES, type Theme } from '../cookbook/diagrams.ts';
import { WASM_DIR } from '../cookbook/run.ts';
import { canDraw, type TableCells } from '../cookbook/result-view.ts';

export interface RecordedGraph {
  nodes: { id: number; labels: string[]; properties?: Record<string, unknown> }[];
  rels: { id: number; type: string; start_node: number; end_node: number; properties?: Record<string, unknown> }[];
}

export interface RecordedCell {
  /** `text` is a verified language sample's output, written by docs:samples (samples.ts). */
  kind: 'table' | 'gram' | 'text';
  text: string;
  table?: TableCells | null;
  graph?: RecordedGraph | null;
  envelope?: unknown;
  expectError?: boolean;
  /** On a sample's entry: the client version that recorded it. */
  verified?: string;
}

export interface Results {
  format: 1;
  verified?: string;
  cells: Record<string, RecordedCell>;
}

/** The sidecar of the page at `file` (`x.mdx` → `x.results.json`). */
export const resultsFile = (file: string) => file.replace(/\.mdx$/, '.results.json');

export { parseDataInfo, parseRunInfo, type RunInfo };

/** A runnable cell as the page holds it. */
export interface PageCell extends RunInfo {
  id: string;
  code: string;
  /** Its 1-based position among the page's cells. */
  index: number;
  /** The heading it sits under, or null. */
  title: string | null;
  line: number | null;
}

export interface PageCells {
  cells: PageCell[];
  /** The page's parameters blocks by name: their JSON text. */
  data: Map<string, string>;
  problems: string[];
}

/**
 * Every runnable cell and parameters block in a page's mdast, in page order,
 * with what is wrong with them: a malformed info string, a duplicate id, a
 * `params=` naming no block, a block that is not a JSON object.
 */
export function collectCells(tree: Root): PageCells {
  const cells: PageCell[] = [];
  const data = new Map<string, string>();
  const problems: string[] = [];
  let title: string | null = null;
  const at = (node: { position?: { start: { line: number } } }) => node.position?.start.line ?? null;
  const visit = (node: Root | RootContent) => {
    if (node.type === 'heading') title = toString(node as Heading);
    if (node.type === 'code') {
      const code = node as Code;
      let run: RunInfo | null = null;
      try {
        run = parseRunInfo(code.lang, code.meta);
      } catch (e) {
        problems.push(`line ${at(code) ?? '?'}: ${(e as Error).message}`);
      }
      if (run) {
        const id = run.name ?? `cell-${cells.length + 1}`;
        if (cells.some((c) => c.id === id)) problems.push(`line ${at(code) ?? '?'}: a second cell \`${id}\``);
        cells.push({ ...run, id, code: code.value, index: cells.length + 1, title, line: at(code) });
      }
      const name = parseDataInfo(code.lang, code.meta);
      if (name !== null) {
        if (data.has(name)) problems.push(`line ${at(code) ?? '?'}: a second \`json data=${name}\` block`);
        let parsed: unknown;
        try {
          parsed = JSON.parse(code.value);
        } catch (e) {
          problems.push(`line ${at(code) ?? '?'}: \`json data=${name}\` is not JSON: ${(e as Error).message}`);
        }
        if (parsed !== undefined && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) {
          problems.push(`line ${at(code) ?? '?'}: \`json data=${name}\` is not a JSON object (parameters are named)`);
        }
        data.set(name, code.value);
      }
    }
    if ('children' in node) for (const child of (node as Parent).children) visit(child as RootContent);
  };
  visit(tree);
  for (const c of cells) {
    if (c.params !== null && !data.has(c.params)) {
      problems.push(`line ${c.line ?? '?'}: cell \`${c.id}\` takes \`params=${c.params}\`, but the page has no \`json data=${c.params}\` block`);
    }
  }
  return { cells, data, problems };
}

let wasmBytes: number | null = null;

/** The engine's size over the wire (gzipped), which a page with cells quotes before loading it. */
export function engineDownloadBytes(): number {
  wasmBytes ??= gzipSync(readFileSync(join(WASM_DIR, 'relate_bg.wasm'))).length;
  return wasmBytes;
}

/** Whether a page body holds a runnable cell (a cheap test for the page shell). */
export const hasCells = (body: string) => /^\s{0,3}(`{3,}|~{3,})\s*cypher\s+run\b/m.test(body);

/** The sidecar beside `file`, checked; null when there is none. Throws on a malformed one. */
export function readResults(file: string): Results | null {
  const path = resultsFile(file);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}`);
  }
  const r = data as Partial<Results>;
  if (r?.format !== 1 || typeof r.cells !== 'object' || r.cells === null || Array.isArray(r.cells)) {
    throw new Error(`${path} is not a format 1 results file ({"format": 1, "cells": {…}})`);
  }
  for (const [id, cell] of Object.entries(r.cells)) {
    if ((cell?.kind !== 'table' && cell?.kind !== 'gram' && cell?.kind !== 'text') || typeof cell.text !== 'string') {
      throw new Error(`${path}: cell \`${id}\` needs "kind" ("table", "gram" or "text") and "text"`);
    }
  }
  return r as Results;
}

// ---------------------------------------------------------------- static graph forms

/** Bumped when the drawing changes, so every static graph form goes stale. */
export const GRAPH_DRAWING_VERSION = 1;
/** The most nodes a static graph form draws; a larger result's static form is its text. */
export const MAX_STATIC_NODES = 80;
export const RECORD_COMMAND = 'node scripts/docs.ts --record';

/** Whether a recorded graph gets a static form. */
export const drawsStatic = (graph: RecordedGraph | null | undefined): graph is RecordedGraph =>
  canDraw(graph) && graph!.nodes.length <= MAX_STATIC_NODES;

/** The caption of a cell's static graph form: `title` is the heading the cell sits under. */
export const graphCaption = (title: string | null) =>
  title ? `The graph this cell returns, under "${title}"` : 'The graph this cell returns';

/** The file of a cell's static graph form, in the page's diagrams/ directory. */
export const resultGraphFile = (stem: string, cellId: string, theme: Theme) => `${stem}-result-${cellId}-${theme}.svg`;

/** Whether `name`, in a diagrams/ directory, is a static graph form of a page with stem `stem`; its cell id, or null. */
export function resultGraphCell(stem: string, name: string): string | null {
  const m = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-result-([A-Za-z0-9_-]+)-(light|dark)\\.svg$`).exec(name);
  return m ? m[1] : null;
}

/** The hash a static graph form is stamped with: of the graph it draws, and the drawing's version. */
export const graphHash = (graph: RecordedGraph) =>
  createHash('sha256').update(`${GRAPH_DRAWING_VERSION}\n${JSON.stringify(graph)}`).digest('hex');

export const graphHashComment = (hash: string) => `<!-- result graph sha256:${hash} -->`;

/** A page's diagrams/ directory and file stem. */
export const pageDiagrams = (file: string) => ({ dir: join(dirname(file), 'diagrams'), stem: basename(file, '.mdx') });

/**
 * The static graph form of cell `cellId` of the page at `file`, by theme,
 * checked as the page will inline it. Throws when a file is missing, was
 * drawn from another graph, or holds anything active.
 */
export function readResultGraph(file: string, cellId: string, graph: RecordedGraph): Record<Theme, string> {
  const { dir, stem } = pageDiagrams(file);
  const head = `${graphHashComment(graphHash(graph))}\n`;
  const out = {} as Record<Theme, string>;
  for (const theme of THEMES) {
    const path = join(dir, resultGraphFile(stem, cellId, theme));
    if (!existsSync(path)) throw new Error(`cell \`${cellId}\` has no ${theme} static graph form (${path}); run ${RECORD_COMMAND}`);
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith(head)) throw new Error(`cell \`${cellId}\`'s graph changed since its static form was drawn (${path}); run ${RECORD_COMMAND}`);
    out[theme] = inertSvg(text.slice(head.length), path);
  }
  return out;
}

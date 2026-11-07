// Recorded results of a page's runnable cells (```cypher run fences): a
// sidecar `<page>.results.json` beside the page, keyed by cell id, so the
// page is complete without JavaScript and the markdown twin can carry each
// result (DOCS-PLAN.md §5 "Runnable cells"). The recorder (phase 1) rewrites
// only this file; the page's MDX never holds results.
//
// Format 1:
//
//   {
//     "format": 1,
//     "verified": "0.16.1",              // the engine version that recorded it
//     "cells": {
//       "<cell id>": {
//         "kind": "table" | "gram",      // as the cookbook's result blocks
//         "text": "…",                   // the recorded result as text (the twin's block)
//         "table": {columns, rows, numeric, summary} | null,   // result-view.ts TableCells
//         "graph": {nodes, rels} | null, // for the graph view (phase 1)
//         "expectError": false           // the cell is expected to fail
//       }
//     }
//   }
//
// A cell's id is its `name=<id>` from the info string (`cypher run name=count`),
// or `cell-<n>` for the n-th run cell on the page (from 1) when it has none.

import { existsSync, readFileSync } from 'node:fs';

import type { TableCells } from '../cookbook/result-view.ts';

export interface RecordedCell {
  kind: 'table' | 'gram';
  text: string;
  table?: TableCells | null;
  graph?: { nodes: unknown[]; rels: unknown[] } | null;
  expectError?: boolean;
}

export interface Results {
  format: 1;
  verified?: string;
  cells: Record<string, RecordedCell>;
}

/** The sidecar of the page at `file` (`x.mdx` → `x.results.json`). */
export const resultsFile = (file: string) => file.replace(/\.mdx$/, '.results.json');

/** The info string of a runnable cell: `cypher run` with an optional `name=<id>`. */
export function parseRunInfo(lang: string | null | undefined, meta: string | null | undefined): { name: string | null } | null {
  if (lang !== 'cypher') return null;
  const words = (meta ?? '').trim().split(/\s+/).filter(Boolean);
  if (words[0] !== 'run') return null;
  let name: string | null = null;
  for (const w of words.slice(1)) {
    const m = /^name=([A-Za-z0-9_-]+)$/.exec(w);
    if (!m) throw new Error(`\`cypher run\` takes only \`name=<id>\` (letters, digits, - and _), not \`${w}\``);
    name = m[1];
  }
  return { name };
}

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
    if ((cell?.kind !== 'table' && cell?.kind !== 'gram') || typeof cell.text !== 'string') {
      throw new Error(`${path}: cell \`${id}\` needs "kind" ("table" or "gram") and "text"`);
    }
  }
  return r as Results;
}

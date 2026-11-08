// <Matrix />: the surfaces capability matrix, generated from
// src/content/docs/_data/surfaces.json (DOCS-PLAN.md §7.3). Rows are
// features (open modes, read-only, transactions, parameters, result
// metadata, notifications, Arrow, CDC, vector and full-text search, LOAD CSV,
// loading a store from a URL, agent mode), columns are surfaces (the CLI, the
// Rust crate, the C ABI, the language clients, the browser build, and the
// three served protocols). Each cell is yes, no, partial or unknown with a
// short note (the call or flag, or why not); each row sits at the stable id
// `#matrix-<feature>`.
//
// Props (literals): `rows={["read-only", "transactions"]}` and
// `columns={["cli", "python"]}` keep those features and surfaces, in the
// order given; none lists every one. An unknown id fails the build.
//
// The data file is read fresh on every render and validated: every feature
// has a cell for every surface, every value is one of the four, every cell
// names at least one source from the file's `sources`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ComponentProps } from '../../lib/docs/constructs.ts';
import { DOCS_DIR, publishedIds } from '../../lib/docs/content.ts';
import { tableMarkdown, type Table } from '../../lib/docs/generated/table.ts';
import { checkProps } from './exitcodes.ts';

export const SURFACES_FILE = join(DOCS_DIR, '_data/surfaces.json');
export const MATRIX_VALUES = ['yes', 'no', 'partial', 'unknown'] as const;
export type MatrixValue = (typeof MATRIX_VALUES)[number];

export interface MatrixCell {
  value: MatrixValue;
  note?: string;
  sources: string[];
}
export interface SurfacesData {
  verified: string;
  checked: string;
  sources: Record<string, string>;
  surfaces: { id: string; label: string; what: string }[];
  features: { id: string; label: string; means: string }[];
  cells: Record<string, Record<string, MatrixCell>>;
}

/** The row anchor of a feature. */
export const rowId = (feature: string) => `matrix-${feature}`;

/** Why `d` is not a well-formed surfaces file, or [] when it is. */
export function validate(d: SurfacesData): string[] {
  const problems: string[] = [];
  const ids = (xs: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (!/^[a-z][a-z0-9-]*$/.test(x.id)) problems.push(`${what} id \`${x.id}\` is not lowercase kebab-case`);
      if (seen.has(x.id)) problems.push(`${what} \`${x.id}\` is listed twice`);
      seen.add(x.id);
    }
  };
  ids(d.surfaces ?? [], 'surface');
  ids(d.features ?? [], 'feature');
  for (const f of d.features ?? []) {
    const row = d.cells?.[f.id];
    if (!row) {
      problems.push(`feature \`${f.id}\` has no cells`);
      continue;
    }
    for (const s of d.surfaces) {
      const c = row[s.id];
      const at = `cells.${f.id}.${s.id}`;
      if (!c) problems.push(`${at} is missing (write "unknown" for a cell nobody has checked)`);
      else {
        if (!(MATRIX_VALUES as readonly string[]).includes(c.value)) problems.push(`${at}: value \`${c.value}\` is not one of ${MATRIX_VALUES.join(', ')}`);
        if (!Array.isArray(c.sources) || !c.sources.length) problems.push(`${at} names no source`);
        else for (const src of c.sources) if (!(src in (d.sources ?? {}))) problems.push(`${at}: source \`${src}\` is not in \`sources\``);
        if (c.note !== undefined && /\|/.test(c.note)) problems.push(`${at}: a note may not hold "|"`);
      }
    }
    for (const s of Object.keys(row)) if (!d.surfaces.some((x) => x.id === s)) problems.push(`cells.${f.id}.${s}: no such surface`);
  }
  for (const f of Object.keys(d.cells ?? {})) if (!d.features.some((x) => x.id === f)) problems.push(`cells.${f}: no such feature`);
  return problems;
}

/** surfaces.json, read now and validated. */
export function surfacesData(): SurfacesData {
  const d = JSON.parse(readFileSync(SURFACES_FILE, 'utf8')) as SurfacesData;
  const problems = validate(d);
  if (problems.length) throw new Error(`${SURFACES_FILE}:\n  - ${problems.join('\n  - ')}`);
  return d;
}

/** The ids `props[name]` keeps, in its order, or every id; an unknown id throws. */
function pick(props: ComponentProps, name: 'rows' | 'columns', all: string[]): string[] {
  const v = props[name];
  if (v === undefined || v === null) return all;
  if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string')) throw new Error(`<Matrix>: \`${name}\` is a non-empty list of ids: ${name}={["${all[0]}"]}`);
  for (const id of v as string[]) if (!all.includes(id)) throw new Error(`<Matrix>: no ${name === 'rows' ? 'feature' : 'surface'} \`${id}\` (known: ${all.join(', ')})`);
  return v as string[];
}

/** A cell as one inline-markdown part: the value, then its note. */
export const cellText = (c: MatrixCell) => (c.note ? `${c.value}: ${c.note}` : c.value);

/** The table `<Matrix />` renders for `props`. */
export function table(props: ComponentProps = {}, d: SurfacesData = surfacesData()): Table {
  checkProps('Matrix', props, ['rows', 'columns']);
  const rows = pick(props, 'rows', d.features.map((f) => f.id));
  const cols = pick(props, 'columns', d.surfaces.map((s) => s.id));
  const surface = (id: string) => d.surfaces.find((s) => s.id === id)!;
  return {
    columns: ['Feature', ...cols.map((c) => surface(c).label)],
    rows: rows.map((id) => {
      const f = d.features.find((x) => x.id === id)!;
      // The twin's first cell: the feature, then what it means (the page shows the same two lines).
      return { id: rowId(id), cells: [[`${f.label}.`, f.means], ...cols.map((c) => [cellText(d.cells[id][c])])] };
    }),
    notes: [
      `Each cell is yes, no, partial or unknown, with the call, flag or reason. Checked on ${d.checked} against relate ${d.verified}: runs of the CLI binary, the WebAssembly build this site ships and the Python and Node.js clients, and each surface's upstream reference. The C, Java, Go and Swift clients load the same C ABI library as the Node.js client.`,
    ],
  };
}

/** The twin: the same table as GFM markdown. */
export function toMarkdown(props: ComponentProps = {}): string {
  return tableMarkdown(table(props), publishedIds());
}

/** Every anchor the matrix gives the page it is on, whatever its props. */
export const anchors = (): string[] => surfacesData().features.map((f) => rowId(f.id));

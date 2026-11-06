// How a cookbook page shows a step's result. The recording itself (kind,
// text, table cells, graph) comes from the engine's `renderResult`; this
// module only lays it out. Shared by the build (recorded results) and the
// page runtime (live ones), so it must stay browser-safe: no Node imports.

import type { LastEnvelope } from './cells.ts';

/** `s` with `&`, `<`, `>`, and `"` escaped. */
export const esc = (s: unknown) =>
  String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** A table recording's cells: Cypher literals, as the `table` block records them. */
export interface TableCells {
  columns: string[];
  rows: string[][];
  numeric: boolean[];
  summary: string;
}

/** The last statement's envelope of a run (wire JSON text per statement), parsed, or null when none ran. */
export const lastEnvelope = (envelopes: string[]): LastEnvelope =>
  envelopes.length ? (JSON.parse(envelopes.at(-1)!) as LastEnvelope) : null;

/** Whether a recording's graph has anything the graph view can draw. */
export const canDraw = (graph: { nodes: unknown[] } | null | undefined) => (graph?.nodes.length ?? 0) > 0;

/**
 * A table recording's cells as HTML: the table in a scroll box, then the row
 * count and counters. Numeric columns are right-aligned. The build writes
 * this into the page and the runtime writes it for live results, so both
 * look alike.
 */
export function tableHtml({ columns, rows, numeric, summary }: TableCells): string {
  const cls = (i: number) => (numeric[i] ? ' class="num"' : '');
  const head = columns.map((c, i) => `<th scope="col"${cls(i)}>${esc(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((v, i) => `<td${cls(i)}>${esc(v)}</td>`).join('')}</tr>`).join('');
  return (
    `<div class="table-scroll" tabindex="0"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
    `<p class="out-summary">${esc(summary)}</p>`
  );
}

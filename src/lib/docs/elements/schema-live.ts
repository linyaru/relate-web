// `:::schema-live`: the data model the page's database holds, next to the one
// the page draws (DOCS-PLAN.md §7.3, "Schema diagram, live mode"). It sits
// under a data-model figure (a ```mermaid flowchart of circles, drawn at
// build by the cookbook's schema code) and, live, runs
// `CALL db.schema.visualization()` on the page's database once its cells
// have run, then lays out and draws what the procedure reports with that
// same code (schema-layout.ts, schema-svg.ts) in the figure's colours, with
// a table of each label's indexes and constraints and the labels the two
// pictures disagree on.
//
//   :::schema-live{[cell=<id>]}
//   :::
//
// `cell` stops the cells there (default: every cell). The static form is
// the authored figure above it plus the sentence this file writes, from the
// recorded counters of the cells it runs.

import { readFileSync } from 'node:fs';

import type { ElementInput, ElementSpec } from '../elements.ts';

const ATTRIBUTES = new Set(['id', 'cell']);
const COUNTERS = ['nodes created', 'relationships created', 'indexes added', 'constraints added'] as const;

/** The cells the element runs first: up to and including `cell`, or all. */
function cellsRun(input: ElementInput) {
  const at = input.attributes.cell ? input.cells.findIndex((c) => c.id === input.attributes.cell) : input.cells.length - 1;
  return input.cells.slice(0, at + 1);
}

/** The counters the cells' recorded results report, summed ("nodes created: 5, …"). */
export function recordedCounters(input: ElementInput): Record<(typeof COUNTERS)[number], number> {
  const sum = Object.fromEntries(COUNTERS.map((c) => [c, 0])) as Record<(typeof COUNTERS)[number], number>;
  for (const cell of cellsRun(input)) {
    const rec = input.recordings[cell.id];
    if (!rec || rec.expectError) continue;
    const summary = rec.text.trim().split('\n').at(-1) ?? '';
    for (const c of COUNTERS) {
      const m = new RegExp(`\\b${c}: (\\d+)`).exec(summary);
      if (m) sum[c] += Number(m[1]);
    }
  }
  return sum;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Whether a data-model figure (a mermaid flowchart of circles) comes before the first `:::schema-live` on the page. */
function figureAbove(file: string): boolean {
  const src = readFileSync(file, 'utf8');
  const at = src.search(/^:::schema-live\b/m);
  if (at < 0) return false;
  return [...src.slice(0, at).matchAll(/^```mermaid\n([\s\S]*?)^```/gm)].some((m) => /^\s*flowchart\b/m.test(m[1]) && /\(\(/.test(m[1]));
}

export default {
  live: 'a button runs `CALL db.schema.visualization()` on the page\'s database in your browser once its cells have run, and draws the labels and relationship types it reports with the code that draws the figure, beside a table of each label\'s indexes and constraints.',
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`cell=<id>\` and \`id\`, not \`${k}\``);
    if (!input.cells.length) out.push('draws the schema the page\'s cells write, and the page has none');
    const cell = input.attributes.cell;
    if (cell && !input.cells.some((c) => c.id === cell)) out.push(`\`cell\` names \`${cell}\`, which is not a cell on the page`);
    if (!figureAbove(input.page.file)) out.push('sits under the data-model figure it is compared with: a ```mermaid flowchart whose nodes are circles, before the directive');
    return out;
  },
  staticForm(input) {
    const n = recordedCounters(input);
    const upTo = input.attributes.cell ? ` up to \`${input.attributes.cell}\`` : '';
    const wrote = [
      count(n['nodes created'], 'node', 'nodes'),
      count(n['relationships created'], 'relationship', 'relationships'),
      count(n['indexes added'], 'index', 'indexes'),
      count(n['constraints added'], 'constraint', 'constraints'),
    ].filter((w) => !w.startsWith('0 '));
    const list = wrote.length > 1 ? `${wrote.slice(0, -1).join(', ')} and ${wrote.at(-1)}` : (wrote[0] ?? 'nothing');
    return {
      text:
        `The figure above is the model as written. \`CALL db.schema.visualization()\` reports the model the page's database holds once the cells${upTo} have run: ` +
        `one node per label, one relationship per type and pair of labels, and each label's indexes and constraints. ` +
        `When the page was recorded, those cells wrote ${list}.`,
    };
  },
} satisfies ElementSpec;

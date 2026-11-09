// `:::plan{cell=<id> compare=<id> index="CREATE INDEX …"}`: the query plan
// viewer (DOCS-PLAN.md §7.3, the docs README "Interactive elements"). It is
// bound to an EXPLAIN cell; a PROFILE cell cannot be one, because its
// measured times differ on every run and its recording would drift (the
// viewer runs PROFILE live instead). `compare` names a second EXPLAIN cell of
// the same statement later on the page, after something changed (an index);
// `index` names the index statement the before/after toggle runs, which by
// default is the remedy of the plan's missing-index notification (03C91).
//
// The static form is the plan as text, built from the cells' recordings:
// the table `relate --mode table` prints for the EXPLAIN (the model in
// _plan-model.ts reproduces it, and src/lib/docs/plan.test.ts checks it
// against the binary's own output), each notification with its remedy and
// the code's anchor in the errors reference, and with `compare`, the second
// plan and what changed between them. The browser module is
// src/scripts/docs/elements/plan.ts.

import { markdownTable } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import { deltas, indexName, missingIndex, PLAN_WARNINGS, planText, splitStatement, summarize, type PlanDoc, type PlanNote } from './_plan-model.ts';

const ATTRIBUTES = new Set(['id', 'cell', 'compare', 'index']);

interface Recorded {
  plan: PlanDoc;
  notes: PlanNote[];
}

/** A cell's recorded plan and notifications, or null when the recording has none. */
function recorded(input: ElementInput, id: string): Recorded | null {
  const env = input.recordings[id]?.envelope as { plan?: PlanDoc | null; notifications?: PlanNote[]; error?: string | null } | null | undefined;
  if (!env?.plan || env.error) return null;
  return { plan: env.plan, notes: env.notifications ?? [] };
}

/** Problems with the cell an attribute names: it exists, is an EXPLAIN, and its recording (once there is one) holds a plan. */
function cellProblems(input: ElementInput, attr: string, id: string): string[] {
  const cell = input.cells.find((c) => c.id === id);
  if (!cell) return [`\`${attr}\` names \`${id}\`, which is not a cell on the page`];
  const split = splitStatement(cell.code);
  if (!split) return [`\`${attr}\` names cell \`${id}\`, which does not start with EXPLAIN`];
  if (split.mode === 'PROFILE') return [`\`${attr}\` names cell \`${id}\`, a PROFILE: its times differ on every run, so its recording drifts; bind an EXPLAIN cell (the viewer runs PROFILE in the browser)`];
  if (cell.expectError) return [`\`${attr}\` names cell \`${id}\`, which is expected to fail`];
  if (input.recordings[id] && !recorded(input, id)) return [`cell \`${id}\`'s recording holds no plan`];
  return [];
}

/** Inline code that survives backticks inside it. */
const code = (s: string) => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``);

/** A notification as a list item: the code linked to its anchor, the title, where it applies, the description and the remedy. */
function noteItem(n: PlanNote): string {
  const where = n.operator_id === null || n.operator_id === undefined ? '' : ` on operator ${n.operator_id}`;
  const remedy = n.gql_status === '03C91' ? code(n.remedy) : n.remedy;
  return `- [${code(n.gql_status)} ${n.title}](/docs/reference/errors#notif-${n.gql_status.toLowerCase()})${where}: ${n.description}. Remedy: ${remedy}`;
}

function notesBlock(label: string, notes: PlanNote[]): string {
  if (!notes.length) return `${label}: none.`;
  const inTable = notes.some((n) => PLAN_WARNINGS.has(n.gql_status)) ? ' The plan table shows `03N90`, `03C90` and `03C93` in its Warnings column instead.' : '';
  return `${label}, each with its remedy:${inTable}\n\n${notes.map(noteItem).join('\n')}`;
}

const fence = (text: string) => `\`\`\`text\n${text}\n\`\`\``;

export default {
  live: 'the plan is drawn as a tree, and PROFILE runs the statement on the page\'s database in your browser and adds each operator\'s rows, time and database hits as bars; the index button creates the index on the page\'s database, plans the statement with and without it side by side with the changes, and drops it again; a PROFILE downloads as a speedscope file.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes \`cell=<id>\`, \`compare=<id>\`, \`index="CREATE INDEX …"\` and \`id\`, not \`${k}\``);
    if (!a.cell) out.push('needs `cell=<id>`: the EXPLAIN cell whose plan it shows');
    else out.push(...cellProblems(input, 'cell', a.cell));
    if (a.compare !== undefined) {
      out.push(...cellProblems(input, 'compare', a.compare));
      const at = (id: string) => input.cells.find((c) => c.id === id)?.index ?? -1;
      if (a.cell && a.compare === a.cell) out.push('`compare` names the same cell as `cell`');
      else if (a.cell && at(a.compare) >= 0 && at(a.compare) < at(a.cell)) out.push('`compare` names a cell before `cell`; it is the plan after a change, later on the page');
    }
    if (a.index !== undefined && !indexName(a.index)) out.push('`index` is one `CREATE [RANGE|TEXT|POINT] INDEX <name> FOR … ON …` statement');
    return out;
  },
  staticForm(input) {
    const { cell, compare } = input.attributes;
    const before = recorded(input, cell);
    if (!before) return { text: '' }; // the cells check reports the missing recording; an empty form fails docs:check
    const parts = [`The plan recorded for cell ${code(cell)}, as \`relate --mode table\` prints it:`, fence(planText(before.plan, before.notes))];
    const after = compare ? recorded(input, compare) : null;
    if (compare && after) {
      parts.push(`The plan recorded for cell ${code(compare)}, later on the page:`, fence(planText(after.plan, after.notes)));
      const rows = deltas(summarize(before.plan, before.notes), summarize(after.plan, after.notes));
      parts.push(
        `What changed between ${code(cell)} and ${code(compare)}:`,
        markdownTable(['Measure', code(cell), code(compare), 'Change'], rows.map((r) => [r.measure, r.before, r.after, r.change])),
      );
      parts.push(notesBlock(`Notifications on ${code(cell)}`, before.notes), notesBlock(`Notifications on ${code(compare)}`, after.notes));
    } else {
      parts.push(notesBlock('Notifications', before.notes));
    }
    const index = input.attributes.index ?? missingIndex(before.notes);
    // Without JavaScript, and in the twin, there is no comparison to run: say where it runs, so the line never reads as an instruction to write.
    if (index) parts.push(`In a browser, the viewer's comparison runs ${code(index)} on the page's in-memory database only.`);
    return { text: parts.join('\n\n') };
  },
} satisfies ElementSpec;

// The plan viewer's model (`:::plan`, src/lib/docs/elements/plan.ts and
// src/scripts/docs/elements/plan.ts): what the build and the browser both
// read off an engine plan document (`relate.plan/v1`). Free of Node imports,
// because the browser module imports it too.
//
// Two renderings reproduce the CLI byte for byte, so the page, the twin and a
// terminal agree:
//   - `planText`: the plan table `relate --mode table` prints for an EXPLAIN
//     or a PROFILE, with its `Warnings:` line and `Notifications:` block
//     (upstream surfaces/relate-formatter/src/plan_table.rs and
//     notifications.rs at the verified version);
//   - `speedscope`: the evented profile `relate --mode speedscope` writes
//     for a PROFILE (surfaces/relate-formatter/src/speedscope.rs).
// src/lib/docs/plan.test.ts checks both against CLI recordings.

import { formatMs } from './_wording.ts';

/** One notification, as the envelope and a plan operator's `warnings` carry it. */
export interface PlanNote {
  code: string;
  gql_status: string;
  severity: string;
  category?: string;
  title: string;
  description: string;
  remedy: string;
  operator_id?: number | null;
}

/** PROFILE measures of one operator (`actual` in the plan document); the fields the viewer and the CLI layouts read. */
export interface PlanActual {
  rows?: number;
  time_ms?: number;
  total_time_ms?: number;
  db_hits?: number;
  memory_bytes?: number;
  expression_built_bytes?: number;
  hops?: number;
  neighbor_walks?: number;
  node_reads?: number;
  batched?: boolean;
  zone_skips?: number;
  frontier?: Record<string, number> | null;
  frontier_decline?: string | null;
  start?: { element: number; backward: boolean; reason: string } | null;
  [key: string]: unknown;
}

export interface PlanOp {
  operator: string;
  details: string;
  identifiers?: string[];
  estimated_rows: number | null;
  warnings?: PlanNote[];
  children: PlanOp[];
  actual: PlanActual | null;
}

export interface PlanDoc {
  schema?: string;
  profiled: boolean;
  statement: string | null;
  root: PlanOp;
}

/** The three notifications the plan table shows in its Warnings column instead of the Notifications block. */
export const PLAN_WARNINGS = new Set(['03N90', '03C90', '03C93']);

/** Operators whose statement writes: PROFILE would run the write, so the viewer offers only EXPLAIN for them. */
export const WRITE_OPERATORS = new Set([
  'Create', 'Merge', 'Delete', 'DetachDelete', 'SetProperty', 'RemoveProperty', 'Foreach', 'LoadCSV',
  'CreateIndex', 'DropIndex', 'Catalog', 'ProcedureCall', 'CallSubquery',
]);

/** Where a notification code is documented: the errors reference keeps one stable anchor per GQLSTATUS. */
export const noteHref = (gqlStatus: string) => `/docs/reference/errors/#notif-${gqlStatus.toLowerCase()}`;

// ---------------------------------------------------------------- the statement

/** A cell's statement split around its EXPLAIN or PROFILE prefix (an optional `CYPHER 5`/`CYPHER 25` first); null without one. */
export function splitStatement(code: string): { version: string; mode: 'EXPLAIN' | 'PROFILE'; body: string } | null {
  const m = /^\s*((?:CYPHER\s+\d+\s+)?)(EXPLAIN|PROFILE)\s+([\s\S]+?)\s*;?\s*$/i.exec(code);
  if (!m) return null;
  return { version: m[1], mode: m[2].toUpperCase() as 'EXPLAIN' | 'PROFILE', body: m[3] };
}

/** The same statement under the other prefix. */
export const withMode = (code: string, mode: 'EXPLAIN' | 'PROFILE'): string | null => {
  const s = splitStatement(code);
  return s ? `${s.version}${mode} ${s.body}` : null;
};

/** The index statement's name: `CREATE [RANGE|TEXT|POINT] INDEX <name> …`; null for anything else. */
export function indexName(statement: string): string | null {
  const m = /^\s*CREATE\s+(?:(?:RANGE|TEXT|POINT)\s+)?INDEX\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:IF\s+NOT\s+EXISTS\s+)?FOR\b/i.exec(statement);
  return m ? m[1] : null;
}

/** The first missing-index remedy (03C91) a plan's notifications give: the statement that creates the index. */
export function missingIndex(notes: PlanNote[]): string | null {
  const n = notes.find((x) => x.gql_status === '03C91' && indexName(x.remedy));
  return n ? n.remedy : null;
}

// ---------------------------------------------------------------- walking the tree

export interface PlacedOp {
  op: PlanOp;
  /** The operator's number in the CLI's `Id` column: pre-order from the root at 0. */
  id: number;
  depth: number;
  isRoot: boolean;
}

/** Every operator, root first, in pre-order (the CLI's row order and `Id`). */
export function preOrder(root: PlanOp): PlacedOp[] {
  const out: PlacedOp[] = [];
  const visit = (op: PlanOp, depth: number) => {
    out.push({ op, id: out.length, depth, isRoot: depth === 0 });
    for (const c of op.children ?? []) visit(c, depth + 1);
  };
  visit(root, 0);
  return out;
}

/** The rows the operator's first child produced (the CLI's `input_rows`), when that child was measured. */
const inputRows = (op: PlanOp): number | null => {
  const first = op.children?.[0];
  return first?.actual ? (first.actual.rows ?? 0) : null;
};

/** An operator that never ran because its input produced no rows (the CLI's `(never executed)`). */
export const neverExecuted = (p: PlacedOp): boolean => !p.isRoot && !!p.op.actual && (p.op.actual.rows ?? 0) === 0 && inputRows(p.op) === 0;

/** The operator's plan warnings: the notifications joined to it that the plan table shows in its Warnings column. */
const planWarnings = (op: PlanOp): PlanNote[] => (op.warnings ?? []).filter((w) => PLAN_WARNINGS.has(w.gql_status));

// ---------------------------------------------------------------- numbers as Rust prints them

/**
 * `x` with `digits` decimals as Rust's `{:.N}` prints an f64: the exact
 * binary value rounded half to even (JavaScript's toFixed rounds an exact tie
 * up, so 0.0625 would print 0.063 where the CLI prints 0.062).
 */
export function fixed(x: number, digits: number): string {
  const plain = x.toFixed(digits);
  if (!Number.isFinite(x)) return plain;
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf('.');
  const rest = exact.slice(dot + 1 + digits);
  if (!/^50*$/.test(rest)) return plain;
  // An exact tie: keep the even last digit.
  const kept = exact.slice(0, dot + 1 + digits).replace(/\.$/, '');
  const last = Number(kept.at(-1));
  if (last % 2 === 0) return (x < 0 ? '-' : '') + kept;
  return plain;
}

/** Display columns of a string, as the CLI's unicode-width measure counts them (wide East Asian and emoji 2, combining marks 0). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f) continue;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

const FORMAT_CHARS = /[­؀-؅؜۝܏࢐࢑࣢᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/u;

/** The CLI's control escape for terminal text: `\\`, `\n`, `\r`, `\t`, and `\u{HEX}` for other control and format characters. */
export function escapeControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f) || FORMAT_CHARS.test(ch)) out += `\\u{${c.toString(16).toUpperCase()}}`;
    else out += ch;
  }
  return out;
}

// ---------------------------------------------------------------- the plan table

type Column = { name: string; cell: (p: PlacedOp) => string };

const metric = (p: PlacedOp, value: (a: PlanActual) => string): string =>
  !p.op.actual ? '-' : neverExecuted(p) ? '(never executed)' : value(p.op.actual);
const readKind = (n: number | undefined) => (n ? String(n) : '');
const timeCell = (ms: number | undefined) => fixed(ms ?? 0, 3);

/** The `[...]` marks a measured operator's Details gain: how a walk started, batching, zone skips, frontier counters. */
function detailsCell(op: PlanOp): string {
  const a = op.actual;
  let cell = op.details;
  if (!a) return cell;
  const marks: string[] = [];
  if (a.start) marks.push(`start #${a.start.element}, ${a.start.backward ? 'backward' : 'forward'}, ${a.start.reason}`);
  if (a.batched) marks.push('batched');
  if ((a.zone_skips ?? 0) > 0) marks.push(`zone-skips ${a.zone_skips}`);
  const f = a.frontier;
  if (f && (f.levels ?? 0) > 0) {
    marks.push(`frontier edges=${f.edge_visits} levels=${f.levels} endpoints=${f.endpoints} cells=${f.cells}`);
    marks.push(
      `frontier-rule budget=${fixed(f.budget_fraction ?? 0, 4)} memo-hits=${f.memo_hits} memo-misses=${f.memo_misses} ` +
        `representative-proofs=${f.representative_proofs} search-proven=${f.search_proven} ` +
        `search-disproven=${f.search_disproven} declined-exhausted=${f.declined_exhausted}`,
    );
  }
  if (a.frontier_decline) marks.push(`frontier-declined ${a.frontier_decline}`);
  for (const m of marks) cell += `  [${m}]`;
  return cell;
}

/** Estimated over actual rows, `25.0x`, with ` !` when the estimate is 10 times too high or more; null without actual rows. */
function ratioCell(estimated: number, actual: number): string | null {
  if (!(actual > 0)) return null;
  return `${fixed(estimated / actual, 1)}x${Math.floor(estimated / 10) >= actual ? ' !' : ''}`;
}

/** The columns the CLI prints for this plan, in its order (each shown only when some operator needs it). */
function columns(ops: PlacedOp[]): Column[] {
  const estimate = ops.some((p) => p.op.estimated_rows !== null && p.op.estimated_rows !== undefined);
  const measured = ops.filter((p) => p.op.actual);
  const metrics = measured.length > 0;
  const kind = (k: 'node_reads' | 'hops' | 'neighbor_walks') => measured.some((p) => (p.op.actual![k] ?? 0) > 0);
  const executed = ops.some(neverExecuted);
  const warnings = ops.some((p) => planWarnings(p.op).length > 0);
  const all: (Column & { on: boolean })[] = [
    { on: true, name: 'Operator', cell: (p) => `${'| '.repeat(p.depth)}+ ${p.op.operator}` },
    { on: true, name: 'Id', cell: (p) => String(p.id) },
    { on: true, name: 'Details', cell: (p) => detailsCell(p.op) },
    { on: executed, name: 'Executed', cell: (p) => (!p.op.actual ? '-' : neverExecuted(p) ? 'x' : '✓') },
    { on: estimate, name: 'Estimated Rows', cell: (p) => (p.op.estimated_rows === null || p.op.estimated_rows === undefined ? '-' : String(p.op.estimated_rows)) },
    { on: metrics, name: 'Rows', cell: (p) => metric(p, (a) => String(a.rows ?? 0)) },
    { on: metrics, name: 'Time (ms)', cell: (p) => metric(p, (a) => timeCell(a.time_ms)) },
    { on: metrics, name: 'Total (ms)', cell: (p) => metric(p, (a) => timeCell(a.total_time_ms)) },
    { on: metrics, name: 'Db Hits', cell: (p) => metric(p, (a) => String(a.db_hits ?? 0)) },
    { on: metrics && kind('node_reads'), name: 'Nodes', cell: (p) => metric(p, (a) => readKind(a.node_reads)) },
    { on: metrics && kind('hops'), name: 'Rels', cell: (p) => metric(p, (a) => readKind(a.hops)) },
    { on: metrics && kind('neighbor_walks'), name: 'Degree', cell: (p) => metric(p, (a) => readKind(a.neighbor_walks)) },
    { on: metrics, name: 'Memory (Bytes)', cell: (p) => metric(p, (a) => String(a.memory_bytes ?? 0)) },
    { on: metrics, name: 'Expression Built (Bytes)', cell: (p) => metric(p, (a) => String(a.expression_built_bytes ?? 0)) },
    {
      on: metrics && estimate,
      name: 'Est/Actual',
      cell: (p) => (p.op.actual && p.op.estimated_rows !== null && p.op.estimated_rows !== undefined ? ratioCell(p.op.estimated_rows, p.op.actual.rows ?? 0) : null) ?? '-',
    },
    { on: warnings, name: 'Warnings', cell: (p) => planWarnings(p.op).map((w) => w.description).join(', ') || '-' },
  ];
  return all.filter((c) => c.on);
}

/** The plan table lines: `Query:`, `Plan:`, the grid, and the `Warnings:` line when an operator has a plan warning. */
export function planTableLines(plan: PlanDoc): string[] {
  const ops = preOrder(plan.root);
  const cols = columns(ops);
  const headers = cols.map((c) => escapeControl(c.name));
  const rows = ops.map((p) => cols.map((c) => escapeControl(c.cell(p))));
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i]))));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));
  const line = (cells: string[]) => `|${cells.map((c, i) => ` ${pad(c, widths[i])} `).join('|')}|`;
  const separator = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const out = [`Query: ${escapeControl((plan.statement ?? '').split(/\s+/).filter(Boolean).join(' '))}`, 'Plan:', separator];
  for (const r of [headers, ...rows]) out.push(line(r), separator);
  const warned = ops.flatMap((p) => planWarnings(p.op).map((w) => `Id ${p.id}: ${w.description}`));
  if (warned.length) out.push(escapeControl(`Warnings: ${warned.join('; ')}`));
  return out;
}

/** The `Notifications:` block of `--mode table`: every notification but the three plan warnings, one line each. */
export function notificationLines(notes: PlanNote[]): string[] {
  const shown = notes.filter((n) => !PLAN_WARNINGS.has(n.gql_status));
  if (!shown.length) return [];
  return [
    'Notifications:',
    ...shown.map((n) =>
      escapeControl(`${n.operator_id === null || n.operator_id === undefined ? '' : `Id ${n.operator_id}: `}${n.severity} ${n.gql_status} ${n.code}: ${n.description} Remedy: ${n.remedy}`),
    ),
  ];
}

/** What `relate --mode table "EXPLAIN …"` prints for one statement (the plan, then its notifications), without the final newline. */
export const planText = (plan: PlanDoc, notes: PlanNote[]): string => [...planTableLines(plan), ...notificationLines(notes)].join('\n');

// ---------------------------------------------------------------- speedscope

/** Why a profile cannot be exported: the CLI's message, word for word, so the page and the terminal refuse alike. */
export const speedscopeRefusal = (why: string) =>
  `speedscope mode requires a PROFILE statement: per-operator times are what it exports (${why})`;

const nanos = (a: PlanActual) => Math.round((a.time_ms ?? 0) * 1e6);

/**
 * The speedscope evented profile `relate --mode speedscope` writes for this
 * PROFILE plan, as the same bytes (compact JSON, keys sorted, one newline):
 * one frame per operator (`"<operator> <id>"`, pre-order), each operator's
 * interval its own time in nanoseconds, its children laid out one after
 * another inside it and scaled to fit when their times sum past it. Throws
 * the CLI's refusal for a plan without PROFILE measures.
 */
export function speedscope(plan: PlanDoc, version: string): string {
  if (!plan.root.actual) throw new Error(speedscopeRefusal('the plan tree carries no PROFILE metrics'));
  const frames: string[] = [];
  const events: string[] = [];
  const walk = (op: PlanOp, start: number, duration: number) => {
    const frame = frames.length;
    frames.push(`${op.operator} ${frames.length}`);
    events.push(`{"at":${start},"frame":${frame},"type":"O"}`);
    const times = (op.children ?? []).map((c) => {
      if (!c.actual) throw new Error(speedscopeRefusal('an operator carries no PROFILE metrics'));
      return nanos(c.actual);
    });
    const total = times.reduce((s, t) => s + t, 0);
    let cursor = start;
    op.children.forEach((child, i) => {
      const last = i === times.length - 1;
      const span =
        total <= duration ? times[i]
        : last ? Math.max(0, duration - (cursor - start))
        : Number((BigInt(times[i]) * BigInt(duration)) / BigInt(total));
      walk(child, cursor, span);
      cursor += span;
    });
    events.push(`{"at":${start + duration},"frame":${frame},"type":"C"}`);
  };
  const end = nanos(plan.root.actual);
  walk(plan.root, 0, end);
  return (
    `{"$schema":"https://www.speedscope.app/file-format-schema.json","exporter":${JSON.stringify(`relate@${version}`)},` +
    `"profiles":[{"endValue":${end},"events":[${events.join(',')}],"name":"relate PROFILE","startValue":0,"type":"evented","unit":"nanoseconds"}],` +
    `"shared":{"frames":[${frames.map((f) => `{"name":${JSON.stringify(f)}}`).join(',')}]}}\n`
  );
}

// ---------------------------------------------------------------- comparing two plans

export interface PlanSummary {
  /** Operator names, root first. */
  operators: string[];
  /** The estimate of the operator the plan starts from (the deepest first child), or null. */
  startEstimate: number | null;
  /** PROFILE only: database hits over every operator, and their own times summed (ms); null for EXPLAIN. */
  dbHits: number | null;
  timeMs: number | null;
  /** PROFILE only: the rows the root produced. */
  rows: number | null;
  notes: string[];
}

export function summarize(plan: PlanDoc, notes: PlanNote[]): PlanSummary {
  const ops = preOrder(plan.root);
  let start = plan.root;
  while (start.children?.length) start = start.children[0];
  const measured = ops.filter((p) => p.op.actual);
  return {
    operators: ops.map((p) => p.op.operator),
    startEstimate: start.estimated_rows ?? null,
    dbHits: measured.length ? measured.reduce((s, p) => s + (p.op.actual!.db_hits ?? 0), 0) : null,
    timeMs: measured.length ? measured.reduce((s, p) => s + (p.op.actual!.time_ms ?? 0), 0) : null,
    rows: plan.root.actual ? (plan.root.actual.rows ?? 0) : null,
    notes: notes.map((n) => n.gql_status),
  };
}

/** One row of the before/after comparison: a measure, both values as text, and the change as text ('-' when either side has none). */
export interface DeltaRow {
  measure: string;
  before: string;
  after: string;
  change: string;
}

const num = (n: number | null) => (n === null ? '-' : String(n));
/** The change between two counts in words: `3 fewer`, `2 more`, `same`; '-' when either side has none. */
const diff = (a: number | null, b: number | null) => {
  if (a === null || b === null) return '-';
  const d = b - a;
  if (d === 0) return 'same';
  return `${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'}`;
};
/**
 * The change between two times, printed as every element prints a time
 * (formatMs, one decimal: the browser timer's step), so the table claims no
 * more precision than the panes beside it: `0.2 ms more`, `same`.
 */
const diffMs = (a: number | null, b: number | null) => {
  if (a === null || b === null) return '-';
  const d = b - a;
  if (formatMs(Math.abs(d)) === '<0.1') return 'same';
  return `${formatMs(Math.abs(d))} ms ${d > 0 ? 'more' : 'less'}`;
};

/** The comparison table between two plans of one statement: operators, start estimate, notifications, and the PROFILE measures when both have them. */
export function deltas(before: PlanSummary, after: PlanSummary): DeltaRow[] {
  const ops = (s: PlanSummary) => s.operators.join(', ');
  const notes = (s: PlanSummary) => (s.notes.length ? s.notes.join(', ') : 'none');
  const rows: DeltaRow[] = [
    { measure: 'Operators, root first', before: ops(before), after: ops(after), change: ops(before) === ops(after) ? 'same' : 'changed' },
    { measure: 'Estimated rows where the plan starts', before: num(before.startEstimate), after: num(after.startEstimate), change: diff(before.startEstimate, after.startEstimate) },
    { measure: 'Notifications', before: notes(before), after: notes(after), change: diff(before.notes.length, after.notes.length) },
  ];
  if (before.dbHits !== null && after.dbHits !== null) {
    rows.push(
      { measure: 'Rows returned', before: num(before.rows), after: num(after.rows), change: diff(before.rows, after.rows) },
      { measure: 'Database hits, every operator', before: num(before.dbHits), after: num(after.dbHits), change: diff(before.dbHits, after.dbHits) },
      { measure: 'Time, every operator (ms)', before: formatMs(before.timeMs), after: formatMs(after.timeMs), change: diffMs(before.timeMs, after.timeMs) },
    );
  }
  return rows;
}

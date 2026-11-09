// validate_cypher (DOCS-PLAN.md §3.8): EXPLAIN a caller's statement in a
// fresh WASM engine instance, never the seeded docs instance, and answer
// with the plan and the notifications (each with its remedy) or the error
// object (code, kind, line, column, message) with the errors-reference
// entry, citing reference/cypher/differences-from-neo4j where the mistake is
// a row of its table.
//
// Pure apart from the engine it is handed (`newEngine`), so the unit tests
// run it in Node on public/wasm and the Worker runs it on the bundled glue
// (src/wasm.ts). The fence:
//
// - the statement is sent as `EXPLAIN\n<statement>`, so it is planned, never
//   run; a statement that starts with EXPLAIN or PROFILE is refused, and an
//   answer without a plan, or with a profiled one, is treated as a failure
//   (validate_failed), never returned as a result;
// - the engine's `execute` runs one statement: a second one after a
//   semicolon is a syntax error, which is what the answer reports;
// - each call gets its own WebAssembly instance and an empty in-memory
//   store, dropped afterwards; a trap discards only that instance.

import { bestMatches } from './match.ts';
import type { DialectRow, ErrorEntry, NotificationEntry } from './types.ts';

export const MAX_STATEMENT_BYTES = 8 * 1024;
export const MAX_PARAMETERS_BYTES = 8 * 1024;

/** The engine one call runs on: an empty in-memory store in its own instance. */
export interface FreshEngine {
  execute(query: string, paramsJson: string | null): string;
  free(): void;
}

export interface ValidateData {
  errors: ErrorEntry[];
  notifications: NotificationEntry[];
  dialect: DialectRow[];
  errorsUrl: string;
}

interface Envelope {
  error: string | null;
  notifications?: EngineNotification[];
  plan?: { profiled?: boolean; root?: PlanNode; schema?: string } | null;
}
interface PlanNode {
  operator: string;
  details?: string | null;
  estimated_rows?: number | null;
  children?: PlanNode[];
}
interface EngineNotification {
  gql_status: string;
  code: string;
  severity?: string;
  category?: string;
  title?: string;
  description?: string;
  remedy?: string;
  operator_id?: number;
}

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/** Leading whitespace and comments of a statement removed. */
export function stripLeading(statement: string): string {
  let s = statement;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('//')) {
      const nl = t.indexOf('\n');
      s = nl < 0 ? '' : t.slice(nl + 1);
    } else if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      s = end < 0 ? '' : t.slice(end + 2);
    } else return t;
  }
}

export type Refusal = { code: 'statement_too_large' | 'parameters_too_large' | 'empty_statement' | 'explain_prefix'; message: string };

/**
 * Why a statement or its parameters are refused before any engine runs, or
 * null. Parameters that are not an object never get here: the tool's input
 * schema rejects them (an `Input validation error` result).
 */
export function refusal(statement: string, parameters: Record<string, unknown> | undefined): Refusal | null {
  if (bytes(statement) >= MAX_STATEMENT_BYTES) return { code: 'statement_too_large', message: `The statement is ${bytes(statement)} bytes; validate_cypher takes statements under ${MAX_STATEMENT_BYTES / 1024} KiB.` };
  const head = stripLeading(statement);
  if (!head) return { code: 'empty_statement', message: 'The statement holds no Cypher, only whitespace or comments.' };
  if (/^(EXPLAIN|PROFILE)\b/i.test(head)) return { code: 'explain_prefix', message: 'The statement starts with EXPLAIN or PROFILE; validate_cypher adds EXPLAIN itself and checks the statement without that prefix.' };
  if (parameters !== undefined) {
    const n = bytes(JSON.stringify(parameters));
    if (n >= MAX_PARAMETERS_BYTES) return { code: 'parameters_too_large', message: `The parameters are ${n} bytes as JSON; validate_cypher takes parameters under ${MAX_PARAMETERS_BYTES / 1024} KiB.` };
  }
  return null;
}

/** The longest Details cell planText prints; a longer one ends in "…". */
export const MAX_DETAILS_CHARS = 200;

const cutCell = (s: string) => {
  const c = [...s];
  return c.length > MAX_DETAILS_CHARS ? `${c.slice(0, MAX_DETAILS_CHARS - 1).join('')}…` : s;
};

/**
 * The plan as an operator table, the layout of the CLI's EXPLAIN text
 * (Operator, Id, Details), with each Details cell cut to
 * MAX_DETAILS_CHARS: every row is padded to the widest cell, so one long
 * literal would otherwise widen every row of a deep plan.
 */
export function planText(root: PlanNode): string {
  const rows: [string, string, string][] = [];
  const walk = (n: PlanNode, depth: number) => {
    rows.push([`${'| '.repeat(depth)}+ ${n.operator}`, String(rows.length), cutCell(n.details ?? '')]);
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(root, 0);
  const head: [string, string, string] = ['Operator', 'Id', 'Details'];
  const w = [0, 1, 2].map((i) => Math.max(head[i].length, ...rows.map((r) => r[i].length)));
  const line = `+${w.map((x) => '-'.repeat(x + 2)).join('+')}+`;
  const fmt = (r: string[]) => `| ${r.map((c, i) => c.padEnd(w[i])).join(' | ')} |`;
  return [line, fmt(head), line, ...rows.flatMap((r) => [fmt(r), line])].join('\n');
}

/**
 * Where an error points in the caller's statement, from the engine's echo:
 * the offending line (indented two spaces, possibly a window opened with
 * "…") and a caret under it. The statement is sent after `EXPLAIN\n`, so
 * line 2 of the sent text is line 1 of the statement. 1-based; null when the
 * message carries no caret or the line cannot be placed, and null when the
 * echo fits more than one place (a line repeated, or a window whose text
 * occurs twice in its line), so a position is never a guess.
 */
export function errorPosition(message: string, statement: string): { line: number; column: number } | null {
  const lines = message.split('\n');
  const caretAt = lines.findIndex((l, i) => i > 0 && /^\s*\^\s*$/.test(l));
  if (caretAt < 1) return null;
  const echo = lines[caretAt - 1].replace(/^ {2}/, '');
  const caret = lines[caretAt].indexOf('^') - 2;
  const own = statement.split('\n');
  const windowed = echo.startsWith('…');
  const text = (windowed ? echo.slice(1) : echo).replace(/…$/, '');
  const offset = windowed ? caret - 1 : caret;
  let found: { line: number; column: number } | null = null;
  for (let i = 0; i < own.length; i++) {
    const at = windowed ? own[i].indexOf(text) : own[i].startsWith(text) ? 0 : -1;
    if (at < 0) continue;
    if (found || (windowed && own[i].lastIndexOf(text) !== at)) return null;
    found = { line: i + 1, column: at + offset + 1 };
  }
  return found;
}

/** The kind relate names an error by, from its message's prefix (`syntax error:` → syntax). */
export const kindOf = (message: string): string | null => /^(syntax|semantic|type) error:/.exec(message)?.[1] ?? null;

const dotted = (m: string) => /^(?:syntax|semantic) error: (ProcedureNotFound|UnknownFunction): (?:unknown function )?([A-Za-z_][\w.]*?)(?:\(\))?$/.exec(m);

/**
 * The Differences row a message is an instance of: the row's message
 * exactly, its `<placeholder>` pattern, or, for an unknown function or
 * procedure, the same library: the same first name segment (two for the
 * built-in `db` namespace). A generic parse error counts only when the word
 * at the error's column appears in the row's Feature or Neo4j text.
 */
export function dialectRow(rows: DialectRow[], message: string, wordAtColumn: string | null): DialectRow | null {
  const m = message.trim();
  for (const row of rows) {
    for (const raw of row.messages) {
      const r = raw.trim();
      if (r.includes('<')) {
        const re = new RegExp(`^${r.split(/<[^>]+>/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`);
        if (re.test(m)) return row;
        continue;
      }
      if (r === m) {
        if (!/^syntax error: parse error:/.test(r) || /unexpected token/.test(r)) return row;
        const w = wordAtColumn?.toLowerCase();
        if (w && w.length > 2 && `${row.feature} ${row.neo4j}`.toLowerCase().includes(w)) return row;
        continue;
      }
      const a = dotted(r);
      const b = dotted(m);
      if (a && b && a[1] === b[1]) {
        const sa = a[2].split('.');
        const sb = b[2].split('.');
        const n = sa[0] === 'db' ? 2 : 1;
        if (sa.length > n && sb.length > n && sa.slice(0, n).join('.') === sb.slice(0, n).join('.')) return row;
      }
    }
  }
  return null;
}

const dialectRef = (row: DialectRow) => ({ feature: row.feature, write_instead: row.write_instead, url: row.url });

/** Unknown label, relationship type and property key: about the empty store validate_cypher plans on, not the caller's graph. */
const EMPTY_STORE_STATUSES = new Set(['01N50', '01N51', '01N52']);

export interface ValidNotification {
  gql_status: string;
  code: string;
  severity: string | null;
  category: string | null;
  title: string | null;
  description: string | null;
  remedy: string | null;
  /** The errors reference's entry for the GQLSTATUS. */
  url: string | null;
  /** Set for the unknown-name warnings, which every statement gets on the empty store. */
  empty_store?: true;
  /** The Differences row the notification is an instance of. */
  differences?: { feature: string; write_instead: string; url: string };
}

export type ValidateResult =
  | { ok: true; plan: string; notifications: ValidNotification[] }
  | {
      ok: false;
      error: {
        code: string | null;
        kind: string | null;
        line: number | null;
        column: number | null;
        message: string;
        gql_status: string | null;
        retryable: boolean | null;
        remedy: string | null;
        /** The errors reference's entry: https://relatedb.ai/docs/reference/errors/#<id>, or the page. */
        url: string;
        entry: string | null;
      };
      differences: { feature: string; write_instead: string; url: string } | null;
    };

/** Thrown when the engine's answer is not an EXPLAIN result, or the instance trapped: the tool's validate_failed. */
export class ValidateFailed extends Error {
  readonly trapped: boolean;
  constructor(message: string, trapped: boolean) {
    super(message);
    this.trapped = trapped;
  }
}

/**
 * EXPLAIN `statement` on a fresh engine and shape the answer. Call refusal()
 * first. Throws ValidateFailed when the engine trapped (`isTrap`) or answered
 * with anything but a plan or an error; the engine is freed either way.
 */
export function validate(newEngine: () => FreshEngine, isTrap: (err: unknown) => boolean, statement: string, parameters: Record<string, unknown> | undefined, data: ValidateData): ValidateResult {
  let db: FreshEngine | null = null;
  let out: string;
  try {
    db = newEngine();
    out = db.execute(`EXPLAIN\n${statement}`, parameters ? JSON.stringify(parameters) : null);
  } catch (err) {
    const trapped = isTrap(err);
    if (!trapped) {
      try {
        db?.free();
      } catch {
        /* the instance is dropped below either way */
      }
    }
    throw new ValidateFailed(trapped ? 'the engine instance trapped' : 'the engine threw', trapped);
  }
  try {
    db.free();
  } catch {
    /* dropped with its instance */
  }
  let env: Envelope;
  try {
    env = JSON.parse(out) as Envelope;
  } catch {
    throw new ValidateFailed('the engine answered with something other than JSON', false);
  }
  if (env.error) {
    const message = env.error;
    const first = message.split('\n')[0];
    const pos = errorPosition(message, statement);
    const word = pos ? (/^[^\s(){}[\],;]+/.exec(statement.split('\n')[pos.line - 1]?.slice(pos.column - 1) ?? '')?.[0] ?? null) : null;
    // The most specific entry whose pattern the message matches, else the
    // CLI's generic entry for the message's kind (cli-validation-error-syntax, …).
    const kind = kindOf(first);
    const entry =
      bestMatches(data.errors.filter((e) => e.surface === 'engine' || e.surface === 'cli'), first)[0] ??
      (kind ? data.errors.find((e) => e.id === `cli-validation-error-${kind}`) : undefined) ??
      null;
    const row = dialectRow(data.dialect, first, word);
    return {
      ok: false,
      error: {
        code: entry?.code ?? null,
        kind: kind ?? entry?.kind ?? null,
        line: pos?.line ?? null,
        column: pos?.column ?? null,
        message,
        gql_status: entry?.gql_status ?? null,
        retryable: entry?.retryable ?? null,
        remedy: entry?.remedy ?? null,
        url: entry?.url ?? data.errorsUrl,
        entry: entry?.id ?? null,
      },
      differences: row ? dialectRef(row) : null,
    };
  }
  if (!env.plan || !env.plan.root || env.plan.profiled !== false) throw new ValidateFailed('the engine answered without an EXPLAIN plan', false);
  const notifications = (env.notifications ?? []).map((n): ValidNotification => {
    const ref = data.notifications.find((x) => x.gql_status.toUpperCase() === String(n.gql_status).toUpperCase());
    const row = n.description ? dialectRow(data.dialect, n.description, null) : null;
    return {
      gql_status: n.gql_status,
      code: n.code,
      severity: n.severity ?? null,
      category: n.category ?? null,
      title: n.title ?? null,
      description: n.description ?? null,
      remedy: n.remedy ?? null,
      url: ref?.url ?? null,
      ...(EMPTY_STORE_STATUSES.has(n.gql_status) ? { empty_store: true as const } : {}),
      ...(row ? { differences: dialectRef(row) } : {}),
    };
  });
  return { ok: true, plan: planText(env.plan.root), notifications };
}

const jsonBytes = (v: unknown) => bytes(JSON.stringify(v));

/** The plan cut at a line so that its JSON string takes at most `budget` bytes, ending with `notice`. */
function cutPlan(plan: string, budget: number, notice: string): string {
  let cut = plan;
  while (cut && jsonBytes(cut) + jsonBytes(notice) > budget) {
    cut = cut.slice(0, Math.floor(cut.length * 0.9));
    cut = cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0));
  }
  return cut ? `${cut}\n${notice}` : notice;
}

/**
 * A validate_cypher answer whose JSON (the tool result's text) fits in `max`
 * bytes. Over it, the plan is cut at a line to at most half of `max` and
 * ends with a line saying so (`plan_truncated: true`); then notifications
 * are dropped from the end (`notifications_omitted` counts them, after
 * `notifications_total`); then the plan is cut further. Returns null when
 * even that does not fit, which the tool answers as validate_failed. An
 * error answer is never cut: the engine's message is a windowed echo of one
 * line, so it is small; it too returns null if it ever is not.
 */
export function fitAnswer<T extends Record<string, unknown>>(answer: T, max: number): Record<string, unknown> | null {
  if (jsonBytes(answer) <= max) return answer;
  if (answer.ok !== true || typeof answer.plan !== 'string' || !Array.isArray(answer.notifications)) return null;
  const notice = `[Cut to fit the ${max / 1024} KiB result cap; EXPLAIN on a local relate prints the whole plan.]`;
  const all = answer.notifications as unknown[];
  let out: Record<string, unknown> = { ...answer };
  if (jsonBytes(answer.plan) > max / 2) out = { ...out, plan: cutPlan(answer.plan, Math.floor(max / 2), notice), plan_truncated: true };
  if (jsonBytes(out) > max) {
    // The largest prefix of the notifications that fits, from each one's size (the comma included).
    const base = jsonBytes({ ...out, notifications: [], notifications_total: all.length, notifications_omitted: all.length });
    let used = base;
    let keep = 0;
    while (keep < all.length && used + jsonBytes(all[keep]) + 1 <= max) used += jsonBytes(all[keep++]) + 1;
    out = { ...out, notifications: all.slice(0, keep), notifications_total: all.length, notifications_omitted: all.length - keep };
  }
  if (jsonBytes(out) > max) {
    const rest = max - (jsonBytes({ ...out, plan: '', plan_truncated: true }) - 2);
    if (rest > jsonBytes(notice)) out = { ...out, plan: cutPlan(answer.plan, rest, notice), plan_truncated: true };
  }
  return jsonBytes(out) <= max ? out : null;
}

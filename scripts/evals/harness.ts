// The docs:evals harness (DOCS-PLAN.md §3.8, "The cold-start eval"): the
// task suite's shape, the three conditions, the transcript reader and the
// graders. scripts/docs-evals.ts is the command; this module holds
// everything it does that a unit test can reach (src/lib/docs/evals.test.ts).
//
// A task (scripts/evals/tasks.json):
//   id, title, prompt     the prompt is all the agent gets, on stdin
//   conditions            which of CONDITIONS it runs under
//   store                 the path, relative to the working directory, where
//                         the agent must leave its store
//   open_ended            the prompt does not name relate; whether the agent
//                         chose it is scored (the store opens with relate)
//   files                 a directory under scripts/evals/files/ copied into
//                         the working directory first
//   setup                 Cypher statements run on `store` before the agent
//   first_command         a regex the agent's first relate command must match
//                         (by default it only has to succeed); false when the
//                         task's first command is meant to fail, so it is not
//                         scored
//   assertions            each one passes or fails:
//     kind "cypher" (default)   `cypher` (with optional `params`) run on the
//                               store with --read-only; `expect.rows` (exact
//                               rows, in order) or `expect.min` (each named
//                               column of the one row at least this number)
//     kind "file"               `path` exists and holds every line of `lines`
//     kind "transcript"         `saw_exit` (relate exited with this code, from
//                               the transcript's exit code or relate's own
//                               error object in the output),
//                               `some_relate_command` (a regex one relate
//                               command matches) or `every_relate_command`
//                               ({naming, has}: at least one relate command
//                               matches `naming`, and every one that does
//                               also matches `has`)
//   A relate command is one with relate in command position (runsRelate).
//   `{{version}}` in a param or an expected value is the grading binary's
//   version.
//
// The transcript: JSON Lines, one event per line, in any of three dialects,
// read line by line (anything else is ignored):
//   - this harness's own: {"type": "command", "command": "...",
//     "exit_code": 0, "output": "..."} (the fixtures write it; a wrapper
//     around any other agent can too)
//   - Claude Code's `--output-format stream-json`: `assistant` messages with
//     `tool_use` blocks named Bash (`input.command`), and `user` messages
//     with the matching `tool_result` (`is_error`, `content`)
//   - Codex's `exec --json`: `item.completed` events whose item has type
//     `command_execution` (`command`; `exit_code` and `aggregated_output`
//     when present). The page cited in scripts/docs-evals.ts shows only an
//     `item.started` command_execution with `id`, `type`, `command` and
//     `status` (read 2026-11-07); `exit_code` and `aggregated_output` are on
//     no vendor page read here and are unconfirmed until the first live run.
//     Without them a command's failure and output are unknown (null, ''):
//     its error round trips then count 0 and a saw_exit assertion fails, so
//     the first live Codex run checks both fields before its scores are read.
// Neither third-party reader has been run against a live transcript yet
// (no key here); the fixtures exercise the first dialect end to end.
//
// Scores per task and condition: every assertion's result, first-command
// correctness (the first relate command succeeded, and matched
// `first_command` when the task sets one), error round trips (relate
// commands that failed), whether the agent chose relate (the store opens
// read-only), the agent's exit code and its time.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const EVALS_DIR = dirname(new URL(import.meta.url).pathname);
export const ROOT = join(EVALS_DIR, '../..');
export const TASKS_FILE = join(EVALS_DIR, 'tasks.json');
export const FILES_DIR = join(EVALS_DIR, 'files');
export const FIXTURES_DIR = join(EVALS_DIR, 'fixtures');
export const SYSTEM_PROMPT_FILE = join(EVALS_DIR, 'system-prompt.md');
export const SKILL_DIR = join(ROOT, 'public/skills/relate');
export const EVALS_DATA_FILE = join(ROOT, 'src/content/docs/_data/evals.json');

/** The three conditions (DOCS-PLAN.md §3.8): nothing; the AGENTS.md snippet; the skill. */
export const CONDITIONS = ['none', 'agents-md', 'skill'] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Expect {
  rows?: Record<string, unknown>[];
  min?: Record<string, number>;
}

export interface Assertion {
  id: string;
  description: string;
  kind?: 'cypher' | 'file' | 'transcript';
  cypher?: string;
  params?: Record<string, string | number | boolean>;
  expect?: Expect;
  path?: string;
  lines?: string[];
  saw_exit?: number;
  some_relate_command?: string;
  every_relate_command?: { naming: string; has: string };
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  conditions: Condition[];
  store: string;
  open_ended?: boolean;
  files?: string;
  setup?: string[];
  first_command?: string | false;
  assertions: Assertion[];
}

const TASK_KEYS = new Set(['id', 'title', 'prompt', 'conditions', 'store', 'open_ended', 'files', 'setup', 'first_command', 'assertions']);
const ASSERTION_KEYS = new Set(['id', 'description', 'kind', 'cypher', 'params', 'expect', 'path', 'lines', 'saw_exit', 'some_relate_command', 'every_relate_command']);

const isRegex = (s: unknown) => {
  try {
    new RegExp(String(s));
    return typeof s === 'string';
  } catch {
    return false;
  }
};

/** What is wrong with a task suite (empty when it is well formed). */
export function taskProblems(raw: unknown): string[] {
  const problems: string[] = [];
  const tasks = (raw as { tasks?: unknown })?.tasks;
  if (!Array.isArray(tasks) || !tasks.length) return ['"tasks" is a non-empty list'];
  if (tasks.length < 8 || tasks.length > 10) problems.push(`the suite has ${tasks.length} tasks; DOCS-PLAN.md §3.8 asks for eight to ten`);
  const ids = new Set<string>();
  tasks.forEach((t: Partial<Task>, i) => {
    const at = `tasks[${i}] (${t.id ?? '?'})`;
    for (const k of Object.keys(t)) if (!TASK_KEYS.has(k)) problems.push(`${at}: unknown key "${k}"`);
    if (typeof t.id !== 'string' || !/^[a-z0-9-]+$/.test(t.id)) problems.push(`${at}: "id" is lowercase letters, digits and -`);
    else if (ids.has(t.id)) problems.push(`${at}: duplicate id`);
    else ids.add(t.id);
    for (const k of ['title', 'prompt', 'store'] as const) if (typeof t[k] !== 'string' || !t[k]) problems.push(`${at}: "${k}" is a non-empty string`);
    if (typeof t.store === 'string' && (t.store.startsWith('/') || t.store.split('/').includes('..'))) problems.push(`${at}: "store" is a path inside the working directory`);
    if (!Array.isArray(t.conditions) || !t.conditions.length || !t.conditions.every((c) => (CONDITIONS as readonly string[]).includes(c))) {
      problems.push(`${at}: "conditions" lists some of ${CONDITIONS.join(', ')}`);
    }
    if (t.files !== undefined && !existsSync(join(FILES_DIR, t.files))) problems.push(`${at}: no directory scripts/evals/files/${t.files}`);
    if (t.setup !== undefined && !(Array.isArray(t.setup) && t.setup.every((s) => typeof s === 'string'))) problems.push(`${at}: "setup" is a list of statements`);
    if (t.first_command !== undefined && t.first_command !== false && !isRegex(t.first_command)) problems.push(`${at}: "first_command" is a regex, or false`);
    if (!Array.isArray(t.assertions) || !t.assertions.length) {
      problems.push(`${at}: "assertions" is a non-empty list`);
      return;
    }
    const aids = new Set<string>();
    t.assertions.forEach((a, j) => {
      const aat = `${at}.assertions[${j}] (${a.id ?? '?'})`;
      for (const k of Object.keys(a)) if (!ASSERTION_KEYS.has(k)) problems.push(`${aat}: unknown key "${k}"`);
      if (typeof a.id !== 'string' || aids.has(a.id)) problems.push(`${aat}: "id" is a unique string`);
      aids.add(a.id);
      if (typeof a.description !== 'string' || !a.description) problems.push(`${aat}: "description" is a non-empty string`);
      const kind = a.kind ?? 'cypher';
      if (kind === 'cypher') {
        if (typeof a.cypher !== 'string' || !a.cypher) problems.push(`${aat}: "cypher" is a statement`);
        const e = a.expect;
        if (!e || (e.rows === undefined) === (e.min === undefined)) problems.push(`${aat}: "expect" has exactly one of "rows" and "min"`);
        else if (e.rows !== undefined && !Array.isArray(e.rows)) problems.push(`${aat}: "expect.rows" is a list of rows`);
        else if (e.min !== undefined && !Object.values(e.min).every((v) => typeof v === 'number')) problems.push(`${aat}: "expect.min" maps columns to numbers`);
      } else if (kind === 'file') {
        if (typeof a.path !== 'string' || a.path.startsWith('/') || a.path.split('/').includes('..')) problems.push(`${aat}: "path" is a path inside the working directory`);
        if (!Array.isArray(a.lines) || !a.lines.length) problems.push(`${aat}: "lines" is a non-empty list`);
      } else if (kind === 'transcript') {
        const set = [a.saw_exit !== undefined, a.some_relate_command !== undefined, a.every_relate_command !== undefined].filter(Boolean).length;
        if (set !== 1) problems.push(`${aat}: a transcript assertion has exactly one of "saw_exit", "some_relate_command", "every_relate_command"`);
        if (a.saw_exit !== undefined && !Number.isInteger(a.saw_exit)) problems.push(`${aat}: "saw_exit" is an exit code`);
        if (a.some_relate_command !== undefined && !isRegex(a.some_relate_command)) problems.push(`${aat}: "some_relate_command" is a regex`);
        if (a.every_relate_command !== undefined && !(isRegex(a.every_relate_command.naming) && isRegex(a.every_relate_command.has))) {
          problems.push(`${aat}: "every_relate_command" is {naming, has}, two regexes`);
        }
      } else problems.push(`${aat}: "kind" is cypher, file or transcript`);
    });
  });
  return problems;
}

/** The task suite, read and checked; throws listing every problem. */
export function loadTasks(file = TASKS_FILE): Task[] {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { tasks: Task[] };
  const problems = taskProblems(raw);
  if (problems.length) throw new Error(`${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return raw.tasks;
}

// ---------------------------------------------------------------------------
// The relate binary

/** A minimal environment for the grading binary: no agent-harness variables, a scratch home, DO_NOT_TRACK=1. */
export function relateEnv(home: string): Record<string, string> {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, TMPDIR: process.env.TMPDIR ?? tmpdir(), DO_NOT_TRACK: '1' };
}

/** The relate binary: $RELATE_BIN, else `relate` on PATH, else the release build in the upstream checkout ($RELATE_UPSTREAM, default ../relate), else null. */
export function findRelate(env: Record<string, string | undefined> = process.env): string | null {
  if (env.RELATE_BIN) return existsSync(env.RELATE_BIN) ? env.RELATE_BIN : null;
  const which = spawnSync('sh', ['-c', 'command -v relate'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const upstream = join(env.RELATE_UPSTREAM ?? join(ROOT, '../relate'), 'target/release/relate');
  return existsSync(upstream) ? upstream : null;
}

/** The version number the binary prints (`Relate v0.16.1` → `0.16.1`), or null. */
export function relateVersion(bin: string, home: string): string | null {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', env: relateEnv(home) });
  return /v?(\d+\.\d+\.\d+\S*)/.exec(r.stdout ?? '')?.[1] ?? null;
}

export interface QueryResult {
  ok: boolean;
  rows: Record<string, unknown>[];
  /** What came back, when it was not a result: the error object or stderr, and the exit code. */
  problem?: string;
}

/** `cypher` on `store`, read-only, every row, as the envelope's rows. */
export function runCypher(bin: string, store: string, cypher: string, params: Record<string, unknown>, home: string, write = false): QueryResult {
  const args = ['--database', store, ...(write ? [] : ['--read-only']), '--mode', 'envelope', '--max-rows', '0', '--no-agent-mode', '--timeout', '30s'];
  for (const [k, v] of Object.entries(params)) args.push('--param', `${k}=${JSON.stringify(v)}`);
  args.push(cypher);
  const r = spawnSync(bin, args, { encoding: 'utf8', env: relateEnv(home), timeout: 60_000 });
  const out = (r.stdout ?? '').trim();
  if (r.status !== 0) return { ok: false, rows: [], problem: `exit ${r.status ?? r.signal}: ${out || (r.stderr ?? '').trim() || '(no output)'}` };
  try {
    const env = JSON.parse(out) as { rows?: Record<string, unknown>[] };
    return { ok: true, rows: env.rows ?? [] };
  } catch {
    return { ok: false, rows: [], problem: `not an envelope: ${out.slice(0, 300)}` };
  }
}

// ---------------------------------------------------------------------------
// Conditions

export interface Prepared {
  /** The working directory the agent starts in. */
  workdir: string;
  /** Extra environment for the agent command (DOCS_EVALS_*). */
  env: Record<string, string>;
}

/**
 * Lay out a fresh working directory for `task` under `condition` inside
 * `runDir`: the task's files, its setup statements on the store, and the
 * condition's files, in the places the agents read them:
 *   none       nothing
 *   agents-md  AGENTS.md and CLAUDE.md, both the AGENTS.md block of
 *              src/components/docs/install.ts (it names no version, ADR-0060)
 *   skill      the published skill bundle (public/skills/relate/) under
 *              .agents/skills/relate/ and .claude/skills/relate/
 * Each one is also named in the environment, for a wrapper whose agent reads
 * them from flags instead (DOCS_EVALS_AGENTS_MD, DOCS_EVALS_SKILL_DIR).
 */
export async function prepare(task: Task, condition: Condition, runDir: string, bin: string, home: string, version: string): Promise<Prepared> {
  const workdir = join(runDir, 'work');
  mkdirSync(workdir, { recursive: true });
  if (task.files) cpSync(join(FILES_DIR, task.files), workdir, { recursive: true });
  for (const s of task.setup ?? []) {
    const r = runCypher(bin, join(workdir, task.store), s, {}, home, true);
    if (!r.ok) throw new Error(`${task.id}: a setup statement failed: ${r.problem}`);
  }
  const env: Record<string, string> = {};
  if (condition === 'agents-md') {
    const { agentsMd } = await import('../../src/components/docs/install.ts');
    const md = `${agentsMd()}\n`;
    writeFileSync(join(workdir, 'AGENTS.md'), md);
    writeFileSync(join(workdir, 'CLAUDE.md'), md);
    env.DOCS_EVALS_AGENTS_MD = join(workdir, 'AGENTS.md');
  } else if (condition === 'skill') {
    for (const d of ['.agents/skills/relate', '.claude/skills/relate']) cpSync(SKILL_DIR, join(workdir, d), { recursive: true });
    env.DOCS_EVALS_SKILL_DIR = join(workdir, '.agents/skills/relate');
  }
  return { workdir, env };
}

// ---------------------------------------------------------------------------
// Transcripts

export interface Command {
  command: string;
  /** The exit code, when the transcript gives one. */
  exit_code: number | null;
  /** Whether it failed (a non-zero exit, or a tool result marked as an error); null when unknown. */
  failed: boolean | null;
  output: string;
}

const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).join('\n') : '';

/** The shell commands a transcript records, in order, from any of the three dialects. */
export function parseTranscript(text: string): Command[] {
  const out: Command[] = [];
  const pending = new Map<string, Command>();
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let e: Record<string, any>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'command' && typeof e.command === 'string') {
      const code = Number.isInteger(e.exit_code) ? (e.exit_code as number) : null;
      out.push({ command: e.command, exit_code: code, failed: code === null ? null : code !== 0, output: typeof e.output === 'string' ? e.output : '' });
    } else if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        if (b?.type === 'tool_use' && b.name === 'Bash' && typeof b.input?.command === 'string') {
          const c: Command = { command: b.input.command, exit_code: null, failed: null, output: '' };
          out.push(c);
          if (typeof b.id === 'string') pending.set(b.id, c);
        }
      }
    } else if (e.type === 'user' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content) {
        const c = b?.type === 'tool_result' ? pending.get(b.tool_use_id) : undefined;
        if (!c) continue;
        c.failed = b.is_error === true;
        c.output = textOf(b.content);
      }
    } else if (e.type === 'item.completed' && e.item?.type === 'command_execution' && typeof e.item.command === 'string') {
      const code = Number.isInteger(e.item.exit_code) ? (e.item.exit_code as number) : null;
      out.push({ command: e.item.command, exit_code: code, failed: code === null ? null : code !== 0, output: typeof e.item.aggregated_output === 'string' ? e.item.aggregated_output : '' });
    }
  }
  return out;
}

/**
 * relate in command position: at the start of a line, after `;`, `&`, `|`,
 * `(`, `{`, `$(` or a backtick, or as the script of `bash -c`/`sh -lc`;
 * optionally after variable assignments and the words sudo, env, exec, time,
 * nohup, command, if, while, until, then, do, else or `!`; optionally by a
 * path (`/usr/local/bin/relate`, `"$HOME/.local/bin/relate"`). A word in an
 * argument is not a command: `which relate`, `echo relate`,
 * `grep -r relate notes`, `ls .claude/skills/relate`, `cd relate`.
 */
const RUNS_RELATE = new RegExp(
  String.raw`(?:^|[;&|(\n{]|\$\(|` + '`' + String.raw`|\b(?:ba|z|da)?sh\s+-[a-z]*c\s+['"]?)\s*` +
    String.raw`(?:(?:[A-Za-z_]\w*=\S*|sudo|env|exec|time|nohup|command|if|while|until|then|do|else|!)\s+)*` +
    String.raw`["']?(?:[^\s;&|()'"` + '`' + String.raw`]*\/)?relate(?=$|[\s'"` + '`' + String.raw`;)|&}])`,
  'm',
);

/** Whether a shell command runs relate (see RUNS_RELATE). */
export const runsRelate = (command: string) => RUNS_RELATE.test(command);

/** The exit codes relate reported for a command: the transcript's own, and any `"exit_code":N` in relate's error object in the output. */
export function exitCodesOf(c: Command): number[] {
  const codes = c.exit_code === null ? [] : [c.exit_code];
  for (const m of c.output.matchAll(/"exit_code"\s*:\s*(\d+)/g)) codes.push(Number(m[1]));
  return codes;
}

// ---------------------------------------------------------------------------
// Grading

export interface AssertionResult {
  id: string;
  ok: boolean;
  /** What came back, when it failed. */
  detail?: string;
}

export interface TaskScore {
  id: string;
  passed: boolean;
  assertions: AssertionResult[];
  /** The first relate command succeeded (and matched the task's `first_command`); null when the agent ran none or the task does not score it. */
  first_command_ok: boolean | null;
  /** relate commands that failed. */
  error_round_trips: number;
  /** The store opens with relate. */
  chose_relate: boolean;
  open_ended: boolean;
  agent_exit: number | null;
  seconds: number;
}

/** `{{version}}` → the version, inside strings, recursively. */
export function fill<T>(v: T, vars: Record<string, string>): T {
  if (typeof v === 'string') return v.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m) as T;
  if (Array.isArray(v)) return v.map((x) => fill(x, vars)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)])) as T;
  return v;
}

const show = (v: unknown) => JSON.stringify(v);

/** Whether `rows` meet `expect`, and what came back when they do not. */
export function checkRows(rows: Record<string, unknown>[], expect: Expect): { ok: boolean; detail?: string } {
  if (expect.rows) {
    const want = expect.rows;
    const ok = rows.length === want.length && rows.every((r, i) => sameRow(r, want[i]));
    return ok ? { ok } : { ok, detail: `expected ${show(want)}, got ${show(rows)}` };
  }
  const min = expect.min ?? {};
  const row = rows[0] ?? {};
  const short = Object.entries(min).filter(([k, n]) => !(typeof row[k] === 'number' && (row[k] as number) >= n));
  return short.length ? { ok: false, detail: `expected ${short.map(([k, n]) => `${k} >= ${n}`).join(', ')}, got ${show(rows)}` } : { ok: true };
}

/** Rows compare by key, not by key order. */
function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return show(ka) === show(kb) && ka.every((k) => show(a[k]) === show(b[k]));
}

/** One assertion on the finished working directory and transcript. */
export function grade(a: Assertion, ctx: { bin: string; store: string; workdir: string; commands: Command[]; home: string; vars: Record<string, string> }): AssertionResult {
  const kind = a.kind ?? 'cypher';
  if (kind === 'cypher') {
    if (!existsSync(ctx.store)) return { id: a.id, ok: false, detail: `no store at ${ctx.store}` };
    const r = runCypher(ctx.bin, ctx.store, a.cypher!, fill(a.params ?? {}, ctx.vars), ctx.home);
    if (!r.ok) return { id: a.id, ok: false, detail: r.problem };
    return { ...checkRows(r.rows, fill(a.expect!, ctx.vars)), id: a.id };
  }
  if (kind === 'file') {
    const p = join(ctx.workdir, a.path!);
    if (!existsSync(p)) return { id: a.id, ok: false, detail: `no file ${a.path}` };
    const have = new Set(readFileSync(p, 'utf8').split('\n').map((l) => l.trim()));
    const missing = a.lines!.filter((l) => !have.has(l));
    return missing.length ? { id: a.id, ok: false, detail: `${a.path} lacks ${show(missing)}; it holds ${show([...have].filter(Boolean))}` } : { id: a.id, ok: true };
  }
  const relate = ctx.commands.filter((c) => runsRelate(c.command));
  if (a.saw_exit !== undefined) {
    const seen = relate.flatMap(exitCodesOf);
    return seen.includes(a.saw_exit) ? { id: a.id, ok: true } : { id: a.id, ok: false, detail: `no relate command exited ${a.saw_exit}; exit codes seen: ${show(seen)}` };
  }
  if (a.some_relate_command !== undefined) {
    const re = new RegExp(a.some_relate_command);
    return relate.some((c) => re.test(c.command))
      ? { id: a.id, ok: true }
      : { id: a.id, ok: false, detail: `no relate command matches /${a.some_relate_command}/ (${relate.length} relate command(s))` };
  }
  const { naming, has } = a.every_relate_command!;
  const [n, h] = [new RegExp(naming), new RegExp(has)];
  // No relate command naming the store is a failure, not a vacuous pass: an
  // empty or unreadable transcript, a client library, or a store reached
  // through a variable leaves nothing to check.
  if (!relate.some((c) => n.test(c.command))) {
    return { id: a.id, ok: false, detail: `no relate command named /${naming}/ (${relate.length} relate command(s) in the transcript)` };
  }
  const bad = relate.filter((c) => n.test(c.command) && !h.test(c.command));
  return bad.length ? { id: a.id, ok: false, detail: `relate command(s) naming /${naming}/ without /${has}/: ${show(bad.map((c) => c.command.slice(0, 200)))}` } : { id: a.id, ok: true };
}

/** Every score of a task from its finished working directory and transcript. */
export function score(task: Task, ctx: { bin: string; workdir: string; transcript: string; home: string; vars: Record<string, string>; agentExit: number | null; seconds: number }): TaskScore {
  const commands = parseTranscript(ctx.transcript);
  const store = join(ctx.workdir, task.store);
  const g = { bin: ctx.bin, store, workdir: ctx.workdir, commands, home: ctx.home, vars: ctx.vars };
  const assertions = task.assertions.map((a) => grade(a, g));
  const relate = commands.filter((c) => runsRelate(c.command));
  const first = relate[0];
  const firstOk = !first || task.first_command === false ? null : first.failed !== true && (!task.first_command || new RegExp(task.first_command).test(first.command));
  return {
    id: task.id,
    passed: assertions.every((a) => a.ok),
    assertions,
    first_command_ok: firstOk,
    error_round_trips: relate.filter((c) => c.failed === true).length,
    chose_relate: existsSync(store) && runCypher(ctx.bin, store, 'RETURN 1 AS ok', {}, ctx.home).ok,
    open_ended: task.open_ended === true,
    agent_exit: ctx.agentExit,
    seconds: ctx.seconds,
  };
}

// ---------------------------------------------------------------------------
// The data file and the summary

export interface Run {
  run: { date: string; engine: string; harness: string; condition: Condition };
  tasks: TaskScore[];
}

export interface EvalsData {
  kind: 'documentation';
  note: string;
  runs: Run[];
}

/** What is wrong with _data/evals.json (empty when it is well formed). */
export function evalsProblems(raw: Partial<EvalsData>): string[] {
  const problems: string[] = [];
  if (raw.kind !== 'documentation') problems.push('"kind" is "documentation"');
  if (typeof raw.note !== 'string' || !raw.note) problems.push('"note" is a non-empty string');
  if (!Array.isArray(raw.runs)) return [...problems, '"runs" is a list'];
  raw.runs.forEach((r, i) => {
    const at = `runs[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.run?.date ?? '')) problems.push(`${at}.run.date is YYYY-MM-DD`);
    if (typeof r.run?.engine !== 'string' || !r.run.engine) problems.push(`${at}.run.engine is the relate version graded with`);
    if (typeof r.run?.harness !== 'string' || !r.run.harness) problems.push(`${at}.run.harness names the agent`);
    if (!(CONDITIONS as readonly string[]).includes(r.run?.condition)) problems.push(`${at}.run.condition is one of ${CONDITIONS.join(', ')}`);
    if (!Array.isArray(r.tasks)) problems.push(`${at}.tasks is a list`);
  });
  return problems;
}

/** `data` with `runs` added, replacing any earlier run of the same harness and condition. */
export function mergeRuns(data: EvalsData, runs: Run[], note: string): EvalsData {
  const key = (r: Run) => `${r.run.harness}\u0000${r.run.condition}`;
  const fresh = new Set(runs.map(key));
  return { kind: 'documentation', note, runs: [...data.runs.filter((r) => !fresh.has(key(r))), ...runs] };
}

const cell = (b: boolean | null) => (b === null ? '—' : b ? 'yes' : 'no');

/** The markdown summary: one table per run, then the totals. */
export function summary(runs: Run[]): string {
  const out: string[] = [];
  for (const r of runs) {
    out.push(`### ${r.run.harness}, condition \`${r.run.condition}\` (relate ${r.run.engine}, ${r.run.date})`, '');
    out.push('| Task | Result | Assertions | First command | Error round trips | Chose relate |', '| --- | --- | --- | --- | --- | --- |');
    for (const t of r.tasks) {
      const ok = t.assertions.filter((a) => a.ok).length;
      out.push(`| \`${t.id}\` | ${t.passed ? 'pass' : '**FAIL**'} | ${ok}/${t.assertions.length} | ${cell(t.first_command_ok)} | ${t.error_round_trips} | ${t.open_ended ? cell(t.chose_relate) : '—'} |`);
    }
    const failed = r.tasks.flatMap((t) => t.assertions.filter((a) => !a.ok).map((a) => `- \`${t.id}\` / \`${a.id}\`: ${a.detail ?? 'failed'}`));
    if (failed.length) out.push('', ...failed);
    out.push('');
  }
  const all = runs.flatMap((r) => r.tasks);
  const firsts = all.filter((t) => t.first_command_ok !== null);
  out.push(
    `Total: ${all.filter((t) => t.passed).length}/${all.length} task runs passed; first command correct in ${firsts.filter((t) => t.first_command_ok).length}/${firsts.length}; ` +
      `${all.reduce((n, t) => n + t.error_round_trips, 0)} error round trip(s).`,
  );
  return out.join('\n');
}

/** A scratch directory for one task run. */
export const scratch = (base: string, name: string) => mkdtempSync(join(base, `${name}-`));

export const removeDir = (d: string) => rmSync(d, { recursive: true, force: true });

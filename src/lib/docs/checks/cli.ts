// The CLI facts check (DOCS-PLAN.md §6 "docs:cli-check", §8 item 3d): the
// data model the recorded CLI output shares, and the half of the check that
// needs no binary. scripts/docs-cli-check.ts is the half that runs one.
//
// A recording is a `recorded` object anywhere in src/content/docs/_data/
// (engine.json, cli.json, errors.json), or a list of them:
//
//   "recorded": {
//     "command": "relate --mode envelope 'RETURN $x AS x'",
//     "setup": "relate --database ./s.rl 'CREATE (:P)'",   (optional)
//     "hold": "relate query --database ./s.rl",            (optional)
//     "stdout": "…", "stderr": "…", "exit": 6
//   }
//
// `command` is one bash command line, run with the binary on PATH as
// `relate`, in a fresh empty directory, with a fresh home directory and a
// minimal environment (REPLAY_ENV below). `setup` runs first in the same
// directory and must exit 0; its output is not compared. `hold` is started in
// the background before `command` with its stdin held open until `command`
// exits: a second process that keeps the store open (the locked-store case).
// `stdout`, `stderr` and `exit` are what `command` printed and returned, with
// the directory written `<dir>` and the home directory `<home>`. A replay
// compares them with timing values masked (`maskTimings`, ADR-0054), so a
// recording keeps the timings of the run it came from.
//
// A page fence pair tagged `verify` is replayed the same way: a ```bash verify
// fence is run, and when the next fence on the page is a ```text fence, that
// fence holds the expected output (stderr and stdout as one stream, in the
// order the commands wrote them; prose may sit between the two fences). A
// `bash verify` fence whose next fence is not `text` is a step whose output is
// not compared; it must exit 0. All the verify fences of one page run in page
// order in one directory, so a later step sees the files an earlier one wrote.
//
// Each replay of a page's verify steps is recorded in cli.json `page_steps`
// (by `docs:cli-check -- --record`, only when every step on the page passed):
// per page file (relative to src/content/docs), each step's command and the
// SHA-256 of its expected output. A step whose command or expected output is
// edited afterwards no longer matches, so docs:check fails it and the twin
// drops `verified_by: [cli]` until it is replayed. `recorded_with` in cli.json
// and errors.json names the build every recording came from (`relate <version>
// (<commit>), <source|release> build`); --record writes it, with `verified`.
//
// From the source (`cliCheck`, run by docs:check):
//   - every recording is well formed and runs `relate`
//   - an errors.json entry's `message` (with `<name>` a variable part and `…`
//     an elision) appears in its recorded output, and its `exit_code`, `code`
//     and `kind` agree with the recorded exit and error object; an exit code
//     entry agrees with its recording; every string in an entry's `messages`
//     appears in that entry's recorded output
//   - engine.json's recorded `relate --version` names the engine's version
//   - the recorded `relate agent-context` lists the commands of cli.json in
//     order, and each recorded `relate agent-context <COMMAND>` lists exactly
//     the flags cli.json has for the command (the query-run flags for `query`)
//   - no fact is still `disputed`; a `verify` meta is only on a `bash` fence
//   - `recorded_with` and `verified` in cli.json and errors.json name
//     engine.json's version
//   - every published page's `bash verify` steps equal the steps recorded for
//     it in `page_steps`, and `page_steps` names no page without them
//
// Erasable TypeScript only (Node runs it directly).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { Code, Root, RootContent } from 'mdast';

import { DOCS_DIR, splitFrontmatter } from '../content.ts';
import { parsePage } from '../parse.ts';

export const DATA_DIR = join(DOCS_DIR, '_data');
export const DATA_FILES = ['engine.json', 'cli.json', 'errors.json'] as const;

/** One recorded run of the CLI. */
export interface Recorded {
  command: string;
  setup?: string;
  hold?: string;
  stdout: string;
  stderr: string;
  exit: number;
}

/** A recording and where it lives. */
export interface Recording {
  /** The data file (absolute). */
  file: string;
  /** A readable path to it inside the file: `global_flags[format].recorded[1]`. */
  where: string;
  /** The object that holds `recorded`. */
  owner: Record<string, unknown>;
  recorded: Recorded;
}

/** A ```bash verify fence and the output it is expected to print. */
export interface VerifyStep {
  /** The page file (absolute). */
  file: string;
  /** The fence's line in the file. */
  line: number;
  command: string;
  /** The next fence's text when it is a ```text fence; otherwise null (the step must exit 0). */
  expected: string | null;
  expectedLine: number | null;
}

/** The replay environment: nothing from the caller's environment leaks in (agent-harness variables would turn agent mode on). */
export function replayEnv(bin: string, home: string, tmp: string): Record<string, string> {
  return { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: tmp, DO_NOT_TRACK: '1' };
}

/** How the recordings were made, for people reading the data files. */
export const REPLAY_NOTE =
  'Each `recorded` run: the bash command line in `command`, with the binary on PATH as `relate`, in a fresh empty directory, ' +
  'with a fresh HOME and an environment of PATH, HOME, TMPDIR and DO_NOT_TRACK=1 only; `setup` runs first, `hold` keeps a second ' +
  'process on the store while `command` runs. In the output the directory is written `<dir>` and the home directory `<home>`. ' +
  '`npm run docs:cli-check` replays every one against a binary.';

// ---------------------------------------------------------------------------
// Reading the data files

export function readData(name: string, dir = DATA_DIR): unknown {
  const file = join(dir, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every recording in a parsed data file, in document order. */
export function recordingsOf(data: unknown, file: string): Recording[] {
  const out: Recording[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${isObject(item) && typeof item.id === 'string' ? item.id : i}]`));
      return;
    }
    if (!isObject(v)) return;
    for (const [k, child] of Object.entries(v)) {
      if (k === 'recorded') {
        const list = Array.isArray(child) ? child : [child];
        list.forEach((r, i) => out.push({ file, where: `${path}${path ? '.' : ''}recorded${Array.isArray(child) ? `[${i}]` : ''}`, owner: v, recorded: r as Recorded }));
      } else {
        walk(child, `${path}${path ? '.' : ''}${k}`);
      }
    }
  };
  walk(data, '');
  return out;
}

/** Every recording in engine.json, cli.json and errors.json. */
export function allRecordings(dir = DATA_DIR): Recording[] {
  return DATA_FILES.flatMap((name) => recordingsOf(readData(name, dir), join(dir, name)));
}

/** What is wrong with a recording's shape, if anything. */
export function recordedProblems(r: unknown): string[] {
  if (!isObject(r)) return ['is not an object'];
  const problems: string[] = [];
  if (typeof r.command !== 'string' || !/(^|[\s|;&(])relate(\s|$)/.test(r.command)) problems.push('`command` is not a command line that runs `relate`');
  for (const k of ['setup', 'hold']) if (k in r && typeof r[k] !== 'string') problems.push(`\`${k}\` is not a string`);
  for (const k of ['stdout', 'stderr']) if (typeof r[k] !== 'string') problems.push(`\`${k}\` is not a string (record it with \`npm run docs:cli-check -- --record\`)`);
  if (typeof r.exit !== 'number' || !Number.isInteger(r.exit)) problems.push('`exit` is not an integer');
  const known = new Set(['command', 'setup', 'hold', 'stdout', 'stderr', 'exit']);
  for (const k of Object.keys(r)) if (!known.has(k)) problems.push(`unknown key \`${k}\``);
  return problems;
}

// ---------------------------------------------------------------------------
// Output

/** `out` with the replay's directories written as placeholders. */
export function normalizeOutput(out: string, dirs: { dir: string[]; home: string[]; tmp?: string[] }): string {
  const pairs: [string, string][] = [
    ...dirs.home.map((d): [string, string] => [d, '<home>']),
    ...(dirs.tmp ?? []).map((d): [string, string] => [d, '<tmp>']),
    ...dirs.dir.map((d): [string, string] => [d, '<dir>']),
  ];
  // Longest first, so `/private/var/x` is replaced before `/var/x`.
  pairs.sort((a, b) => b[0].length - a[0].length);
  let s = out;
  for (const [from, to] of pairs) if (from) s = s.split(from).join(to);
  return s;
}

/**
 * `out` with every timing value written `<ms>` (ADR-0054): the number after a
 * JSON key ending `_ms`, in compact or pretty JSON and in JSON quoted inside a
 * JSON string (`_ms\":0.3`). Since relate 0.1.0 every machine-readable result
 * carries per-phase timings (upstream ADR-0540), which change on every run, so
 * a replay compares recorded and replayed output through this mask and a page
 * may show the numbers of the run it was written from. `planCache` and every
 * other key are compared as printed.
 */
export function maskTimings(out: string): string {
  return out.replace(/(_ms\\?"\s*:\s*)-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g, '$1<ms>');
}

/** Whether a recorded and a replayed output agree once their timing values are masked. */
export function sameOutput(recorded: string, replayed: string): boolean {
  return recorded === replayed || maskTimings(recorded) === maskTimings(replayed);
}

/** A data-file message as a pattern: `<name>` is a variable part, `…` an elision; the rest is literal. */
export function messagePattern(message: string): RegExp {
  const parts = message.split(/(<[a-z][a-z0-9 _-]*>|…)/i);
  const src = parts
    .map((p, i) => (i % 2 === 1 ? (p === '…' ? '[\\s\\S]*?' : '[\\s\\S]+?') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(src);
}

/** The JSON error objects a recorded stdout holds (`{"error": {…}}` lines). */
export function errorObjects(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('{"error"')) continue;
    try {
      const o = JSON.parse(line) as { error?: unknown };
      if (isObject(o.error)) out.push(o.error);
    } catch {
      // not an error object
    }
  }
  return out;
}

/** The text a message may be found in: stderr, stdout, and the messages of the error objects (unescaped). */
export function searchText(r: Recorded): string {
  return [r.stderr, r.stdout, ...errorObjects(r.stdout).map((e) => String(e.message ?? ''))].join('\n');
}

/** A unified diff of two texts, line by line (an LCS diff; the outputs are short). */
export function unifiedDiff(expected: string, actual: string, labels: [string, string] = ['recorded', 'binary'], context = 3): string {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  type Op = { t: ' ' | '-' | '+'; s: string; ai: number; bi: number };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: ' ', s: a[i], ai: i++, bi: j++ });
    else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push({ t: '-', s: a[i], ai: i++, bi: j });
    else ops.push({ t: '+', s: b[j], ai: i, bi: j++ });
  }
  const changed = ops.map((o, k) => (o.t !== ' ' ? k : -1)).filter((k) => k >= 0);
  if (!changed.length) return '';
  const lines = [`--- ${labels[0]}`, `+++ ${labels[1]}`];
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - context);
    let end = Math.min(ops.length - 1, changed[k] + context);
    while (k + 1 < changed.length && changed[k + 1] - context <= end + 1) end = Math.min(ops.length - 1, changed[++k] + context);
    k++;
    const hunk = ops.slice(start, end + 1);
    const aLen = hunk.filter((o) => o.t !== '+').length;
    const bLen = hunk.filter((o) => o.t !== '-').length;
    lines.push(`@@ -${hunk[0].ai + 1},${aLen} +${hunk[0].bi + 1},${bLen} @@`);
    for (const o of hunk) lines.push(`${o.t}${o.s}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Verify fences

const isVerify = (node: Code) => /(?:^|\s)verify(?:\s|$)/.test(node.meta ?? '');

/** The fences of a page body, in order. */
function fences(tree: Root): Code[] {
  const out: Code[] = [];
  const walk = (nodes: RootContent[]) => {
    for (const n of nodes) {
      if (n.type === 'code') out.push(n);
      else if ('children' in n && Array.isArray(n.children)) walk(n.children as RootContent[]);
    }
  };
  walk(tree.children);
  return out;
}

/** The ```bash verify steps of a page, in page order. `offset` is the number of lines before the body (the frontmatter). */
export function verifySteps(body: string, file: string, offset = 0): VerifyStep[] {
  const list = fences(parsePage(body));
  const out: VerifyStep[] = [];
  list.forEach((node, i) => {
    if (node.lang !== 'bash' || !isVerify(node)) return;
    const next = list[i + 1];
    const expected = next && next.lang === 'text' && !next.meta ? next : null;
    out.push({
      file,
      line: (node.position?.start.line ?? 0) + offset,
      command: node.value,
      expected: expected ? expected.value : null,
      expectedLine: expected ? (expected.position?.start.line ?? 0) + offset : null,
    });
  });
  return out;
}

/** A page file's verify steps. */
export function pageVerifySteps(file: string): VerifyStep[] {
  const text = readFileSync(file, 'utf8');
  const { body } = splitFrontmatter(text, file);
  const offset = text.slice(0, text.length - body.length).split('\n').length - 1;
  return verifySteps(body, file, offset);
}

/** Fences that carry `verify` but are not `bash`. */
export function misplacedVerify(body: string): { lang: string | null; line: number }[] {
  return fences(parsePage(body))
    .filter((n) => isVerify(n) && n.lang !== 'bash')
    .map((n) => ({ lang: n.lang ?? null, line: n.position?.start.line ?? 0 }));
}

// ---------------------------------------------------------------------------
// Recorded page steps and the build the recordings came from

/** The data files that name the build their recordings came from (`recorded_with`, `verified`). */
export const RECORDED_WITH_FILES = ['cli.json', 'errors.json'] as const;

/** The `recorded_with` line --record writes: `relate <version> (<commit>), <source|release> build`. */
export function recordedWithLine(version: string, commit: string | null, sourceBuild: boolean): string {
  return `relate ${version}${commit ? ` (${commit})` : ''}, ${sourceBuild ? 'source' : 'release'} build`;
}

/** Whether a `recorded_with` line names relate `version`. */
export function recordedAt(recordedWith: unknown, version: string): boolean {
  return typeof recordedWith === 'string' && (recordedWith.startsWith(`relate ${version} `) || recordedWith.startsWith(`relate ${version},`));
}

/** A replayed verify step as cli.json `page_steps` holds it. */
export interface RecordedStep {
  command: string;
  /** SHA-256 (hex) of the expected ```text output, or null for a step whose output is not compared. */
  expected_sha256: string | null;
}

export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The key of a page in `page_steps`: its file, relative to src/content/docs, with `/`. */
export const pageStepsKey = (file: string) => relative(DOCS_DIR, file).split(sep).join('/');

/** A step as recorded. */
export const recordedStep = (step: VerifyStep): RecordedStep => ({ command: step.command, expected_sha256: step.expected === null ? null : sha256(step.expected) });

/**
 * How a page's verify steps differ from the recorded ones: one entry per
 * step that was not replayed as it now reads (by line), plus a count
 * mismatch. Empty when they match.
 */
export function pageStepProblems(steps: VerifyStep[], recorded: unknown): { line: number | null; message: string }[] {
  const list = Array.isArray(recorded) ? (recorded as Partial<RecordedStep>[]) : null;
  if (!list) return steps.length ? [{ line: steps[0].line, message: 'the `bash verify` steps of this page were never replayed' }] : [];
  const out: { line: number | null; message: string }[] = [];
  steps.forEach((step, i) => {
    const r = list[i];
    const want = recordedStep(step);
    if (!r) out.push({ line: step.line, message: `the \`bash verify\` step ${i + 1} was not replayed` });
    else if (r.command !== want.command) out.push({ line: step.line, message: `the \`bash verify\` step ${i + 1}'s command is not the one replayed` });
    else if (r.expected_sha256 !== want.expected_sha256) out.push({ line: step.expectedLine ?? step.line, message: `the expected output of \`bash verify\` step ${i + 1} is not the output replayed` });
  });
  if (list.length > steps.length) out.push({ line: null, message: `${list.length - steps.length} replayed step(s) are no longer on the page` });
  return out;
}

/** cli.json's `page_steps` map (empty when absent). */
export function recordedPageSteps(dir = DATA_DIR): Record<string, unknown> {
  const cli = readData('cli.json', dir);
  return isObject(cli) && isObject(cli.page_steps) ? cli.page_steps : {};
}

/**
 * Whether the page at `file` can claim `verified_by: cli` at `version`: it
 * has verify steps, they all match the steps recorded for it, and cli.json
 * was recorded with that version.
 */
export function pageCliVerified(file: string, version: string, dir = DATA_DIR): boolean {
  let cli: unknown;
  try {
    cli = readData('cli.json', dir);
  } catch {
    return false;
  }
  if (!isObject(cli) || !recordedAt(cli.recorded_with, version)) return false;
  const steps = pageVerifySteps(file);
  if (!steps.length) return false;
  const recorded = isObject(cli.page_steps) ? cli.page_steps[pageStepsKey(file)] : undefined;
  return pageStepProblems(steps, recorded).length === 0;
}

// ---------------------------------------------------------------------------
// agent-context against cli.json

/** The flag spellings a cli.json flag entry names (`--safe / --no-safe` is two; `short` adds one). */
export function flagNames(entry: Record<string, unknown>): string[] {
  const names = String(entry.flag ?? '')
    .split(/[\s,/]+/)
    .filter((t) => /^-{1,2}[a-z]/i.test(t));
  if (typeof entry.short === 'string') names.push(entry.short);
  return names;
}

/** The sections of an agent-context text: `Commands`, `Query-run flags`, `Flags` (one name per item). */
export function agentContextSections(text: string): { commands: string[]; queryRunFlags: string[]; flags: string[] | null } {
  const lines = text.split('\n');
  const commands: string[] = [];
  let queryRunFlags: string[] = [];
  let flags: string[] | null = null;
  let section = '';
  for (const line of lines) {
    if (/^\S/.test(line)) {
      section = line.startsWith('Commands') ? 'commands' : line.startsWith('Query-run flags') ? 'query' : line === 'Flags:' ? 'flags' : '';
      if (section === 'flags') flags = [];
      continue;
    }
    const t = line.trim();
    if (!t) continue;
    if (section === 'commands') commands.push(t.split(/\s+/)[0]);
    else if (section === 'query') queryRunFlags = queryRunFlags.concat(t.split(/\s+/));
    else if (section === 'flags') flags!.push(t);
  }
  return { commands, queryRunFlags, flags };
}

const setDiff = (a: Iterable<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
/** The long spellings (agent-context lists a short form for some commands only, so only a listed short is compared). */
const longOnly = (names: Iterable<string>) => [...names].filter((f) => /^--[a-z]/i.test(f));

/** Differences between the recorded agent-context texts and cli.json's commands and flags. */
export function agentContextProblems(cli: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const list = Array.isArray(cli.agent_context) ? (cli.agent_context as Record<string, unknown>[]) : [];
  const commands = Array.isArray(cli.commands) ? (cli.commands as Record<string, unknown>[]) : [];
  const globals = Array.isArray(cli.global_flags) ? (cli.global_flags as Record<string, unknown>[]) : [];
  const globalNames = new Set(globals.flatMap(flagNames).filter((f) => f !== '-h'));
  if (!list.length) return ['cli.json has no `agent_context` recordings'];
  for (const item of list) {
    const r = item.recorded as Recorded | undefined;
    if (!r || typeof r.stdout !== 'string') continue;
    const sections = agentContextSections(r.stdout);
    const forCommand = typeof item.command_id === 'string' ? item.command_id : null;
    if (!forCommand) {
      const ids = commands.map((c) => String(c.id));
      if (sections.commands.join(' ') !== ids.join(' ')) {
        problems.push(`\`relate agent-context\` lists the commands ${sections.commands.join(', ')}; cli.json has ${ids.join(', ')}`);
      }
      const listed = new Set(sections.queryRunFlags);
      for (const f of setDiff(listed, globalNames)) problems.push(`\`relate agent-context\` lists the query-run flag ${f}; cli.json's global_flags has no entry for it`);
      for (const f of setDiff(longOnly(globalNames), listed)) problems.push(`cli.json's global_flags has ${f}; \`relate agent-context\` does not list it`);
      continue;
    }
    const command = commands.find((c) => c.id === forCommand);
    if (!command) {
      problems.push(`agent_context[${String(item.id)}] is for \`${forCommand}\`, which cli.json's commands do not have`);
      continue;
    }
    const own = forCommand === 'query' ? globalNames : new Set((Array.isArray(command.flags) ? (command.flags as Record<string, unknown>[]) : []).flatMap(flagNames));
    const listed = new Set(sections.flags ?? []);
    for (const f of setDiff(listed, own)) problems.push(`\`relate agent-context ${forCommand}\` lists ${f}; cli.json has no flag entry for it under \`${forCommand}\``);
    for (const f of setDiff(longOnly(own), listed)) problems.push(`cli.json lists ${f} under \`${forCommand}\`; \`relate agent-context ${forCommand}\` does not`);
  }
  const covered = new Set(list.map((i) => i.command_id).filter((x): x is string => typeof x === 'string'));
  for (const c of commands) if (!covered.has(String(c.id))) problems.push(`cli.json has no \`relate agent-context ${String(c.id)}\` recording`);
  return problems;
}

// ---------------------------------------------------------------------------
// The source check

/** The report callback scripts/docs.ts passes: file, line, severity, rule, message. */
export type Report = (file: string, line: number | null, severity: 'error' | 'warning', rule: string, message: string) => void;

/** The part of the docs Site this check reads: the page files. */
export interface CliCheckSite {
  pages: { file: string; data: Record<string, unknown> }[];
}

/** The entries of errors.json (every surface list). */
function errorEntries(errors: Record<string, unknown>): Record<string, unknown>[] {
  return ['cli', 'engine', 'http', 'bolt', 'mcp', 'client'].flatMap((k) => (Array.isArray(errors[k]) ? (errors[k] as Record<string, unknown>[]) : []));
}

/** Every disputed fact left in a data file, by readable path. */
function disputed(data: unknown, path = ''): string[] {
  if (Array.isArray(data)) return data.flatMap((v, i) => disputed(v, `${path}[${isObject(v) && typeof v.id === 'string' ? v.id : i}]`));
  if (!isObject(data)) return [];
  const here = data.disputed === true ? [path || '(top level)'] : [];
  return here.concat(Object.entries(data).flatMap(([k, v]) => (k === 'readings' ? [] : disputed(v, `${path}${path ? '.' : ''}${k}`))));
}

/** The source half of docs:cli-check (run by docs:check). */
export function cliCheck(site: CliCheckSite, report: Report, dir = DATA_DIR): void {
  const files = Object.fromEntries(DATA_FILES.map((n) => [n, join(dir, n)])) as Record<(typeof DATA_FILES)[number], string>;
  const data: Record<string, unknown> = {};
  for (const name of DATA_FILES) {
    try {
      data[name] = readData(name, dir);
    } catch (e) {
      report(files[name], null, 'error', 'cli-data', `not JSON: ${(e as Error).message}`);
      return;
    }
  }

  // Shape, and recorded output against the facts that quote it.
  for (const name of DATA_FILES) {
    for (const rec of recordingsOf(data[name], files[name])) {
      const problems = recordedProblems(rec.recorded);
      for (const p of problems) report(rec.file, null, 'error', 'cli-recorded', `${rec.where}: ${p}`);
    }
    for (const where of disputed(data[name])) report(files[name], null, 'error', 'cli-disputed', `${where} is still disputed; settle it against the release binary (DOCS-PLAN.md §9)`);
  }

  const wellFormed = (owner: Record<string, unknown>) => {
    const list = Array.isArray(owner.recorded) ? owner.recorded : owner.recorded ? [owner.recorded] : [];
    return (list as unknown[]).filter((r) => recordedProblems(r).length === 0) as Recorded[];
  };

  const errors = isObject(data['errors.json']) ? data['errors.json'] : {};
  for (const e of errorEntries(errors)) {
    const recs = wellFormed(e);
    if (!recs.length) continue;
    const where = `${String(e.surface)}[${String(e.id)}]`;
    if (typeof e.message === 'string' && !recs.some((r) => messagePattern(e.message as string).test(searchText(r)))) {
      report(files['errors.json'], null, 'error', 'cli-message', `${where}: the message \`${e.message}\` is not in its recorded output`);
    }
    for (const r of recs) {
      if (typeof e.exit_code === 'number' && r.exit !== e.exit_code) report(files['errors.json'], null, 'error', 'cli-exit', `${where}: exit_code ${e.exit_code}, recorded exit ${r.exit}`);
      for (const obj of errorObjects(r.stdout)) {
        for (const k of ['code', 'kind', 'exit_code', 'retryable'] as const) {
          if (e[k] !== null && e[k] !== undefined && obj[k] !== e[k]) {
            report(files['errors.json'], null, 'error', 'cli-error-object', `${where}: ${k} ${JSON.stringify(e[k])}, the recorded error object says ${JSON.stringify(obj[k])}`);
          }
        }
      }
    }
  }

  const cli = isObject(data['cli.json']) ? data['cli.json'] : {};
  const withMessages = [cli, ...recordingsOf(cli, files['cli.json']).map((r) => r.owner)];
  for (const owner of new Set(withMessages)) {
    if (!Array.isArray(owner.messages)) continue;
    const recs = wellFormed(owner);
    if (!recs.length) continue;
    for (const m of owner.messages as unknown[]) {
      if (typeof m === 'string' && !recs.some((r) => messagePattern(m).test(searchText(r)))) {
        report(files['cli.json'], null, 'error', 'cli-message', `${String(owner.id ?? '(entry)')}: the message \`${m}\` is not in its recorded output`);
      }
    }
  }
  for (const x of Array.isArray(cli.exit_codes) ? (cli.exit_codes as Record<string, unknown>[]) : []) {
    for (const r of wellFormed(x)) {
      if (r.exit !== x.exit) report(files['cli.json'], null, 'error', 'cli-exit', `exit_codes[${String(x.id)}]: exit ${String(x.exit)}, recorded exit ${r.exit}`);
      for (const obj of errorObjects(r.stdout)) {
        if (obj.code !== x.code) report(files['cli.json'], null, 'error', 'cli-exit', `exit_codes[${String(x.id)}]: code ${String(x.code)}, the recorded error object says ${String(obj.code)}`);
      }
    }
  }
  for (const p of agentContextProblems(cli)) report(files['cli.json'], null, 'error', 'cli-agent-context', p);

  // engine.json: the recorded version line names the engine's version.
  const engine = isObject(data['engine.json']) ? data['engine.json'] : {};
  const versionCheck = isObject(engine.version_check) ? wellFormed(engine.version_check)[0] : undefined;
  if (!versionCheck) report(files['engine.json'], null, 'error', 'cli-engine', '`version_check.recorded` (the recorded `relate --version`) is missing');
  else if (versionCheck.stdout.split('\n')[0] !== `Relate v${String(engine.version)}`) {
    report(files['engine.json'], null, 'error', 'cli-engine', `the recorded \`relate --version\` prints "${versionCheck.stdout.split('\n')[0]}", not "Relate v${String(engine.version)}"; re-record the data files against the engine`);
  }
  if (!isObject(engine.envelope_check) || !wellFormed(engine.envelope_check)[0]) {
    report(files['engine.json'], null, 'error', 'cli-engine', '`envelope_check.recorded` (the recorded envelope of `RETURN 1 AS ok`) is missing');
  }

  // The build the recordings came from names the engine's version.
  for (const name of RECORDED_WITH_FILES) {
    const d = data[name];
    if (!isObject(d)) continue;
    if (!recordedAt(d.recorded_with, String(engine.version))) {
      report(files[name], null, 'error', 'cli-recorded-with', `recorded_with is ${JSON.stringify(d.recorded_with ?? null)}, which does not name relate ${String(engine.version)} (_data/engine.json); re-record: ${RECORD_HINT}`);
    }
    if (d.verified !== engine.version) {
      report(files[name], null, 'error', 'cli-recorded-with', `verified is ${JSON.stringify(d.verified ?? null)}, not ${String(engine.version)} (_data/engine.json); re-record: ${RECORD_HINT}`);
    }
  }

  // Pages: a `verify` meta only on bash fences; the verify steps as replayed.
  const pageSteps = isObject(cli.page_steps) ? cli.page_steps : {};
  const withSteps = new Set<string>();
  for (const page of site.pages) {
    if (page.data.status === 'planned') continue;
    const text = readFileSync(page.file, 'utf8');
    const { body } = splitFrontmatter(text, page.file);
    const offset = text.slice(0, text.length - body.length).split('\n').length - 1;
    for (const m of misplacedVerify(body)) {
      report(page.file, m.line + offset, 'error', 'cli-verify', `a \`verify\` fence in \`${m.lang ?? 'no language'}\`; only \`bash verify\` fences are replayed (docs:cli-check)`);
    }
    const steps = verifySteps(body, page.file, offset);
    const key = pageStepsKey(page.file);
    if (steps.length) withSteps.add(key);
    for (const p of pageStepProblems(steps, pageSteps[key])) {
      report(page.file, p.line, 'error', 'cli-verify-recorded', `${p.message}; replay the page's steps: ${RECORD_HINT}`);
    }
  }
  for (const key of Object.keys(pageSteps)) {
    if (!withSteps.has(key) && site.pages.length) {
      report(files['cli.json'], null, 'error', 'cli-verify-recorded', `page_steps records ${key}, which has no published \`bash verify\` steps; re-record: ${RECORD_HINT}`);
    }
  }
}

/** How to re-record the CLI facts, quoted in this check's messages. */
export const RECORD_HINT = 'RELATE_BIN=<path to relate> DO_NOT_TRACK=1 npm run docs:cli-check -- --record';

// ---------------------------------------------------------------------------
// Reading the recorded facts other modules print

/** The recorded output of an engine.json check (`version_check`, `envelope_check`), without its final newline. */
export function engineCheck(name: 'version_check' | 'envelope_check', dir = DATA_DIR): { command: string; output: string } {
  const engine = readData('engine.json', dir);
  const r = isObject(engine) && isObject(engine[name]) ? (engine[name].recorded as Recorded | undefined) : undefined;
  if (!r || typeof r.command !== 'string' || typeof r.stdout !== 'string') throw new Error(`${join(dir, 'engine.json')}: \`${name}.recorded\` is missing`);
  return { command: r.command, output: r.stdout.replace(/\n$/, '') };
}

// Verified language samples (DOCS-PLAN.md §6 "Language samples are verified
// from phase 1"): a ```python run or ```js run fence on a docs page is a
// program that runs against a local build of the relate client, and its
// standard output is recorded in the page's results sidecar, so the page and
// its twin show output that a real run produced, and drift fails a check.
//
// The authoring contract:
//
//   ```python run [name=<id>] [title="<file>"]
//   ```js run [name=<id>] [title="<file>"]
//
//   - The sample's id is `name=<id>` (letters, digits, `-`, `_`), or
//     `python-<n>` / `js-<n>` for the n-th sample of that language on the
//     page (from 1) when it has none. Ids share the sidecar with the page's
//     Cypher cells, so a name may not repeat a cell's id.
//   - Each sample is a whole program, run on its own (no state carries from
//     one sample to the next) in a fresh temporary directory that is its
//     working directory: a relative store path such as `./app.rl` lands
//     there and is deleted afterwards. `title="app.py"` names the file the
//     program is written to (the page shows the name above the block);
//     otherwise it is `sample.py`, `sample.cjs` or, when the JavaScript has
//     an `import` or `export` statement, `sample.mjs`.
//   - A sample passes when it exits 0 within the timeout and prints at least
//     one line on standard output. Standard output is the recorded result
//     (line endings normalized to \n, trailing spaces and trailing blank lines
//     removed, the temporary directory's path replaced by `.`); standard
//     error is shown only when a sample fails. Print only what is the same on
//     every run: no timings, ids or absolute paths.
//
// The recorded result is a sidecar entry in the cells' format 1
// (results.ts), keyed by the sample's id, with kind "text":
//
//   "python-1": {"kind": "text", "text": "…", "table": null, "graph": null,
//                "expectError": false, "verified": "0.16.1",
//                "source_sha256": "…"}
//
// `verified` on the entry is the client version that produced it, and
// `source_sha256` the SHA-256 of the program that produced it (sampleSource:
// language, title and code, line endings and trailing spaces normalized), so
// a sample edited after it was recorded fails docs:check and loses its
// language from the twin's `verified_by` until it is recorded again. The twin
// prints the fence as written, then a ```text block holding `text`.
//
// The runner needs the clients, which are built from the upstream checkout
// before launch (scripts/samples/setup.sh) and installed from the published
// packages after:
//
//   RELATE_PY    a Python interpreter that can `import relate` (package relate-db)
//   RELATE_NODE  a Node.js binary; NODE_PATH names the node_modules directory
//                holding @relate/relate (linked into each sample's directory,
//                so `require` and `import` both resolve), and RELATE_LIB the
//                native library when the client is not a published install
//
// Node only, never imported by browser code.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { Code, Parent, Root, RootContent } from 'mdast';

import { splitFrontmatter } from './content.ts';
import { parsePage } from './parse.ts';
import { parseRunInfo, resultsFile } from './results.ts';

export type SampleLang = 'python' | 'js';
export const SAMPLE_LANGS: readonly SampleLang[] = ['python', 'js'];

/** The client each sample language runs against, as `verified_by` names it. */
export const SAMPLE_VERIFIER: Record<SampleLang, 'python' | 'node'> = { python: 'python', js: 'node' };

/** The command that sets the clients up, quoted in every "not set up" message. */
export const SETUP_COMMAND = 'bash scripts/samples/setup.sh --upstream <path to the relate checkout>';
export const RECORD_COMMAND = 'npm run docs:samples -- --record';

export interface SampleInfo {
  lang: SampleLang;
  name: string | null;
  title: string | null;
}

/**
 * The info string of a verified sample: `python run` or `js run`, with an
 * optional `name=<id>` and `title="<file>"`. Null for any other fence; throws
 * on a malformed sample info string.
 */
export function parseSampleInfo(lang: string | null | undefined, meta: string | null | undefined): SampleInfo | null {
  if (lang !== 'python' && lang !== 'js') return null;
  const words = [...(meta ?? '').matchAll(/(\w+)=("[^"]*"|\S+)|(\S+)/g)];
  if (words[0]?.[3] !== 'run') return null;
  let name: string | null = null;
  let title: string | null = null;
  for (const w of words.slice(1)) {
    const [raw, key, value] = w;
    if (key === 'name' && /^[A-Za-z0-9_-]+$/.test(value)) name = value;
    else if (key === 'title' && /^"[A-Za-z0-9_.-]+"$/.test(value)) title = value.slice(1, -1);
    else throw new Error(`\`${lang} run\` takes only \`name=<id>\` (letters, digits, - and _) and \`title="<file>"\` (a bare file name), not \`${raw}\``);
  }
  if (title !== null) {
    const ok = lang === 'python' ? /\.py$/.test(title) : /\.(?:js|cjs|mjs)$/.test(title);
    if (!ok) throw new Error(`\`${lang} run\` title "${title}" needs the extension ${lang === 'python' ? '.py' : '.js, .cjs or .mjs'}`);
  }
  return { lang, name, title };
}

export interface Sample extends SampleInfo {
  id: string;
  code: string;
  /** The fence's line in the page (1-based, counted in the whole file). */
  line: number | null;
}

/** The file a sample is written to in its directory. */
export function sampleFileName(s: Pick<Sample, 'lang' | 'title' | 'code'>): string {
  if (s.title) return s.title;
  if (s.lang === 'python') return 'sample.py';
  return /^\s*(?:import\s*[\w{*'"]|export\s)/m.test(s.code) ? 'sample.mjs' : 'sample.cjs';
}

function codeNodes(tree: Root): Code[] {
  const out: Code[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === 'code') out.push(node);
    if ('children' in node) for (const c of (node as Parent).children) visit(c);
  };
  visit(tree);
  return out;
}

/**
 * The verified samples on a page, in page order, from its whole source
 * (frontmatter included, so line numbers match the file), with any
 * problem in their info strings or ids.
 */
export function pageSamples(source: string, where = 'page'): { samples: Sample[]; problems: string[] } {
  const { body } = splitFrontmatter(source, where);
  const offset = source.slice(0, source.length - body.length).split('\n').length - 1;
  const samples: Sample[] = [];
  const problems: string[] = [];
  const cellIds = new Set<string>();
  const seq: Record<SampleLang, number> = { python: 0, js: 0 };
  let cellSeq = 0;
  const seen = new Set<string>();
  for (const node of codeNodes(parsePage(body))) {
    const line = node.position ? node.position.start.line + offset : null;
    try {
      const run = parseRunInfo(node.lang, node.meta);
      if (run) cellIds.add(run.name ?? `cell-${++cellSeq}`);
    } catch {
      // A malformed Cypher cell is docs:check's to report.
    }
    let info: SampleInfo | null;
    try {
      info = parseSampleInfo(node.lang, node.meta);
    } catch (e) {
      problems.push(`line ${line}: ${(e as Error).message}`);
      continue;
    }
    if (!info) continue;
    const id = info.name ?? `${info.lang}-${++seq[info.lang]}`;
    if (info.name) seq[info.lang]++;
    if (seen.has(id)) problems.push(`line ${line}: sample id \`${id}\` is used twice on the page`);
    seen.add(id);
    samples.push({ ...info, id, code: node.value, line });
  }
  for (const s of samples) {
    if (cellIds.has(s.id)) problems.push(`line ${s.line}: sample id \`${s.id}\` is also a Cypher cell's id; name one of them`);
  }
  return { samples, problems };
}

/**
 * The id of the n-th sample of its language (1-based) on a page, for a
 * renderer that walks fences in order: its name, or `<lang>-<n>`.
 */
export const sampleId = (info: SampleInfo, n: number) => info.name ?? `${info.lang}-${n}`;

// ---------------------------------------------------------------------------
// The sidecar

export interface SidecarEntry {
  kind: string;
  text: string;
  table?: unknown;
  graph?: unknown;
  expectError?: boolean;
  /** On a sample's entry: the client version that recorded it. */
  verified?: string;
  /** On a sample's entry: sampleSourceHash of the program that recorded it. */
  source_sha256?: string;
  [key: string]: unknown;
}

export interface Sidecar {
  format: 1;
  verified?: string;
  cells: Record<string, SidecarEntry>;
  [key: string]: unknown;
}

/**
 * The fingerprint of a sample's program: SHA-256 (hex) of its language, its
 * title and its code (line endings as \n, trailing spaces and trailing blank
 * lines removed), one per line.
 */
export function sampleSourceHash(s: Pick<Sample, 'lang' | 'title' | 'code'>): string {
  const code = s.code
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
  return createHash('sha256').update(`${s.lang}\n${s.title ?? ''}\n${code}`, 'utf8').digest('hex');
}

/** A sample's entry: what the twin prints, in the cells' format with kind "text". */
export const sampleEntry = (text: string, verified: string, sourceSha256: string): SidecarEntry => ({
  kind: 'text',
  text,
  table: null,
  graph: null,
  expectError: false,
  verified,
  source_sha256: sourceSha256,
});

/** Whether a sample's recorded entry was made from the program as it now reads. */
export const recordedFromSource = (entry: SidecarEntry | undefined, s: Pick<Sample, 'lang' | 'title' | 'code'>) =>
  !!entry && entry.source_sha256 === sampleSourceHash(s);

/**
 * The sidecar beside the page at `file`, as written (every entry kept,
 * whatever its kind); null when there is none. Throws on a malformed one.
 */
export function readSidecar(file: string): Sidecar | null {
  const path = resultsFile(file);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}`);
  }
  const r = data as Partial<Sidecar>;
  if (r?.format !== 1 || typeof r.cells !== 'object' || r.cells === null || Array.isArray(r.cells)) {
    throw new Error(`${path} is not a format 1 results file ({"format": 1, "cells": {…}})`);
  }
  for (const [id, cell] of Object.entries(r.cells)) {
    if (typeof cell?.kind !== 'string' || typeof cell.text !== 'string') throw new Error(`${path}: entry \`${id}\` needs "kind" and "text"`);
  }
  return r as Sidecar;
}

/**
 * The sidecar with the samples' entries replaced by `recorded` (id → entry):
 * every Cypher cell's entry is kept as it was, in place; a recorded sample
 * keeps its position or is appended; a "text" entry that is no longer a
 * sample on the page is dropped. A new sidecar takes `verified` from the
 * engine.
 */
export function mergeSamples(sidecar: Sidecar | null, recorded: Map<string, SidecarEntry>, engineVersion: string): Sidecar {
  const base: Sidecar = sidecar ?? { format: 1, verified: engineVersion, cells: {} };
  const cells: Record<string, SidecarEntry> = {};
  for (const [id, entry] of Object.entries(base.cells)) {
    if (recorded.has(id)) cells[id] = recorded.get(id)!;
    else if (entry.kind !== 'text') cells[id] = entry;
  }
  for (const [id, entry] of recorded) if (!(id in cells)) cells[id] = entry;
  return { ...base, cells };
}

/** The sidecar as the recorders write it: two-space JSON and a final newline. */
export const formatSidecar = (s: Sidecar) => `${JSON.stringify(s, null, 2)}\n`;

export function writeSidecar(file: string, s: Sidecar) {
  writeFileSync(resultsFile(file), formatSidecar(s));
}

/**
 * The clients `verified_by` can name for a page, from its source and sidecar:
 * `python` when the page has a ```python run sample and every one of them has
 * an entry recorded by the client at `version` from the code as it now reads
 * (`source_sha256`), `node` likewise for ```js run.
 */
export function sampleVerifiers(source: string, sidecar: Sidecar | null, version: string): ('python' | 'node')[] {
  const { samples, problems } = pageSamples(source);
  if (problems.length) return [];
  const out: ('python' | 'node')[] = [];
  for (const lang of SAMPLE_LANGS) {
    const mine = samples.filter((s) => s.lang === lang);
    const ok =
      mine.length > 0 &&
      mine.every((s) => sidecar?.cells[s.id]?.kind === 'text' && sidecar.cells[s.id].verified === version && recordedFromSource(sidecar.cells[s.id], s));
    if (ok) out.push(SAMPLE_VERIFIER[lang]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Running

export interface ClientEnv {
  python: string | null;
  node: string | null;
  /** The first NODE_PATH entry: the node_modules directory holding @relate/relate. */
  nodeModules: string | null;
  /** Why each language cannot run, when it cannot. */
  missing: Partial<Record<SampleLang, string>>;
}

/** The clients the environment provides (RELATE_PY, RELATE_NODE, NODE_PATH). */
export function clientEnv(env: NodeJS.ProcessEnv = process.env): ClientEnv {
  const missing: Partial<Record<SampleLang, string>> = {};
  const python = env.RELATE_PY || null;
  if (!python) missing.python = 'RELATE_PY is not set';
  else if (!existsSync(python)) missing.python = `RELATE_PY (${python}) does not exist`;
  const node = env.RELATE_NODE || null;
  const nodeModules = (env.NODE_PATH ?? '').split(delimiter).find(Boolean) ?? null;
  if (!node) missing.js = 'RELATE_NODE is not set';
  else if (!existsSync(node)) missing.js = `RELATE_NODE (${node}) does not exist`;
  else if (!nodeModules) missing.js = 'NODE_PATH is not set (the node_modules directory holding @relate/relate)';
  else if (!existsSync(join(nodeModules, '@relate', 'relate', 'package.json'))) missing.js = `NODE_PATH (${nodeModules}) holds no @relate/relate`;
  return { python: missing.python ? null : python, node: missing.js ? null : node, nodeModules: missing.js ? null : nodeModules, missing };
}

/** What a run printed, normalized for the record. */
export function normalizeOutput(stdout: string, dirs: string[]): string {
  let out = stdout.replace(/\r\n?/g, '\n');
  for (const d of dirs.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(d).join('.');
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

export interface RunResult {
  ok: boolean;
  /** The normalized standard output (the record). */
  text: string;
  /** Why it failed, with standard error, when it did. */
  error: string | null;
}

const tail = (s: string, n = 20) => s.trimEnd().split('\n').slice(-n).join('\n');

/** Runs one sample in a fresh temporary directory against the clients in `env`. */
export function runSample(sample: Pick<Sample, 'lang' | 'title' | 'code'>, env: ClientEnv, opts: { timeoutMs?: number; baseEnv?: NodeJS.ProcessEnv } = {}): RunResult {
  const interpreter = sample.lang === 'python' ? env.python : env.node;
  if (!interpreter) return { ok: false, text: '', error: env.missing[sample.lang] ?? 'no client' };
  const dir = mkdtempSync(join(tmpdir(), 'relate-sample-'));
  try {
    const file = sampleFileName(sample);
    writeFileSync(join(dir, file), sample.code.endsWith('\n') ? sample.code : `${sample.code}\n`);
    const childEnv: NodeJS.ProcessEnv = { ...(opts.baseEnv ?? process.env), DO_NOT_TRACK: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' };
    if (sample.lang === 'js') {
      // ESM ignores NODE_PATH, so the client is linked where both resolvers look.
      symlinkSync(env.nodeModules!, join(dir, 'node_modules'), 'dir');
      delete childEnv.NODE_OPTIONS;
    }
    const res = spawnSync(interpreter, [file], { cwd: dir, env: childEnv, encoding: 'utf8', timeout: opts.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 });
    const dirs = [dir];
    try {
      dirs.push(realpathSync(dir));
    } catch {
      // The directory is ours; realpath only fails if it is gone.
    }
    const text = normalizeOutput(res.stdout ?? '', dirs);
    const stderr = normalizeOutput(res.stderr ?? '', dirs);
    if (res.error) {
      const timedOut = (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
      return { ok: false, text, error: timedOut ? `did not finish within ${(opts.timeoutMs ?? 60_000) / 1000} s` : `could not start ${interpreter}: ${res.error.message}` };
    }
    if (res.status !== 0) {
      return { ok: false, text, error: `exited with ${res.status ?? res.signal}${stderr ? `; standard error:\n${tail(stderr)}` : ''}` };
    }
    if (!text) return { ok: false, text, error: `printed nothing on standard output; a verified sample prints what it checked${stderr ? `; standard error:\n${tail(stderr)}` : ''}` };
    return { ok: true, text, error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The installed client's version for `lang`, or null with the reason. */
export function clientVersion(lang: SampleLang, env: ClientEnv): { version: string | null; error: string | null } {
  const code =
    lang === 'python'
      ? "import importlib.metadata as m\nprint(m.version('relate-db'))"
      : "console.log(require('@relate/relate/package.json').version)";
  const r = runSample({ lang, title: null, code }, env, { timeoutMs: 30_000 });
  return r.ok ? { version: r.text.trim(), error: null } : { version: null, error: r.error };
}

/** A short line-by-line diff of a recorded and an actual output. */
export function outputDiff(recorded: string, actual: string): string {
  const a = recorded.split('\n');
  const b = actual.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    if (out.length >= 24) {
      out.push('…');
      break;
    }
  }
  return out.join('\n');
}

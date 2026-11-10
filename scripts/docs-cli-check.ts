#!/usr/bin/env node
// docs:cli-check (DOCS-PLAN.md §6, §8 item 3d): replays the CLI facts the docs
// state against a relate binary and fails on any drift. The data model and
// the half that needs no binary are in src/lib/docs/checks/cli.ts (its header
// defines a recording and the `bash verify` fence pair).
//
//   node scripts/docs-cli-check.ts            check   (npm run docs:cli-check)
//   node scripts/docs-cli-check.ts --record   rewrite every recording's
//                                             stdout, stderr and exit in
//                                             src/content/docs/_data/ from the
//                                             binary, replay the page fences
//                                             and record them (cli.json
//                                             `page_steps`), and stamp
//                                             `recorded_with` and `verified`
//                                             in cli.json and errors.json;
//                                             review the diff
//
// The binary: $RELATE_BIN, else `relate` on PATH, else (RELATE_INSTALL=1) the
// latest release installed through public/install.sh into a temporary home.
// Without one it prints how to get one and exits 0 with a "skipped" line.
//
// What it replays, each in a fresh directory with a fresh home and a minimal
// environment (no agent-harness variables, DO_NOT_TRACK=1):
//   - every `recorded` run in engine.json, cli.json and errors.json: the
//     `relate --help` and `relate <command> --help` pages, `relate
//     agent-context` and `relate agent-context <command>`, the version line,
//     the envelope check, and every recorded message and exit code; stdout,
//     stderr and the exit code must match exactly, except that timing values
//     (the number after a JSON key ending `_ms`) are masked on both sides
//     (maskTimings, ADR-0054)
//   - every ```bash verify fence on a docs page, in page order, one directory
//     per page; when the next fence is ```text its content must equal the
//     combined output (stderr and stdout as one stream), timing values masked
//     the same way, otherwise the step must exit 0
//
// Exits 1 on any drift, printing a unified diff per difference. In --record,
// a page fence's expected output is authored text, so a page whose steps do
// not all pass is not recorded (its `page_steps` entry is dropped, which
// docs:check then reports) and the run exits 1: fix the page, then record.
// `recorded_with` is `relate <version> (<commit>), <source|release> build`:
// the version from the binary's `--version`, the commit and the build kind
// from engine.json (`commit`, `source_build`) when engine.json names the same
// version, otherwise no commit and "release build".
//
// COMMANDS_ONLY=1 skips the page fences; PAGES_ONLY=1 skips the data files.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import {
  DATA_DIR,
  DATA_FILES,
  normalizeOutput,
  pageStepsKey,
  maskTimings,
  pageVerifySteps,
  readData,
  RECORDED_WITH_FILES,
  recordedProblems,
  recordedStep,
  recordedWithLine,
  recordingsOf,
  replayEnv,
  sameOutput,
  unifiedDiff,
  type Recorded,
  type RecordedStep,
  type Recording,
  type VerifyStep,
} from '../src/lib/docs/checks/cli.ts';
import { pageFiles, ROOT } from '../src/lib/docs/content.ts';

const { values: args } = parseArgs({ options: { record: { type: 'boolean', default: false } } });

const rel = (f: string) => relative(ROOT, f);
const STEP_TIMEOUT_MS = 120_000;
/** How long a `hold` process gets to open its store before `command` runs. */
const HOLD_SETTLE_MS = 1_000;

// ---------------------------------------------------------------------------
// Finding the binary

function onPath(name: string): string | null {
  const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  const p = r.status === 0 ? r.stdout.trim() : '';
  return p && existsSync(p) ? p : null;
}

function installRelease(): string | null {
  const home = mkdtempSync(join(tmpdir(), 'relate-install-'));
  console.log(`docs:cli-check: installing the latest release through public/install.sh into ${home}`);
  const r = spawnSync('bash', [join(ROOT, 'public/install.sh')], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, DO_NOT_TRACK: '1', ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}) },
    stdio: 'inherit',
  });
  const bin = join(home, '.local/bin/relate');
  return r.status === 0 && existsSync(bin) ? bin : null;
}

function findBinary(): string | null {
  const fromEnv = process.env.RELATE_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      console.error(`docs:cli-check: RELATE_BIN=${fromEnv} does not exist`);
      process.exit(1);
    }
    return realpathSync(fromEnv);
  }
  const found = onPath('relate');
  if (found) return realpathSync(found);
  if (process.env.RELATE_INSTALL === '1') return installRelease();
  return null;
}

// ---------------------------------------------------------------------------
// Running

interface Sandbox {
  base: string;
  dir: string;
  home: string;
  tmp: string;
  env: Record<string, string>;
}

function sandbox(binary: string): Sandbox {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'relate-cli-check-')));
  const bin = join(base, 'bin');
  const dir = join(base, 'work');
  const home = join(base, 'home');
  const tmp = join(base, 'tmp');
  for (const d of [bin, dir, home, tmp]) mkdirSync(d);
  symlinkSync(binary, join(bin, 'relate'));
  return { base, dir, home, tmp, env: replayEnv(bin, home, tmp) };
}

/** Every spelling of the sandbox's directories the binary may print. */
function spellings(p: string): string[] {
  const out = new Set([p]);
  if (p.startsWith('/private/')) out.add(p.slice('/private'.length));
  return [...out];
}

const normalize = (s: Sandbox, out: string) =>
  normalizeOutput(out, { dir: spellings(s.dir), home: spellings(s.home), tmp: spellings(s.tmp) });

function bash(s: Sandbox, command: string, merge = false) {
  const r = spawnSync('bash', ['-c', merge ? `exec 2>&1\n${command}` : command], {
    cwd: s.dir,
    env: s.env,
    input: '',
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: normalize(s, r.stdout ?? ''), stderr: normalize(s, r.stderr ?? ''), exit: r.status ?? -1, error: r.error };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replay one recording; returns what the binary printed. */
async function replay(binary: string, r: Recorded): Promise<{ stdout: string; stderr: string; exit: number; problem?: string }> {
  const s = sandbox(binary);
  try {
    if (r.setup) {
      const setup = bash(s, r.setup);
      if (setup.exit !== 0) return { ...setup, problem: `setup exited ${setup.exit}: ${setup.stderr.trim()}` };
    }
    let held: ReturnType<typeof spawn> | null = null;
    let heldExit: Promise<void> | null = null;
    if (r.hold) {
      held = spawn('bash', ['-c', r.hold], { cwd: s.dir, env: s.env, stdio: ['pipe', 'ignore', 'ignore'] });
      heldExit = new Promise((resolve) => held!.on('exit', () => resolve()));
      await sleep(HOLD_SETTLE_MS);
    }
    const out = bash(s, r.command);
    if (held) {
      held.stdin?.end();
      await Promise.race([heldExit, sleep(10_000)]);
      if (held.exitCode === null) held.kill('SIGKILL');
    }
    if (out.error) return { ...out, problem: String(out.error.message) };
    return out;
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Reporting

let drift = 0;
function fail(where: string, detail: string) {
  drift++;
  console.log(`\nDRIFT ${where}\n${detail}`);
}

function compareStream(label: string, expected: string, actual: string): string | null {
  if (sameOutput(expected, actual)) return null;
  return `${label}:\n${unifiedDiff(maskTimings(expected), maskTimings(actual), [`${label} (recorded)`, `${label} (binary)`])}`;
}

// ---------------------------------------------------------------------------
// Data files

async function checkData(binary: string): Promise<number> {
  let count = 0;
  for (const name of DATA_FILES) {
    const file = join(DATA_DIR, name);
    const data = readData(name);
    if (data === null) continue;
    const recs: Recording[] = recordingsOf(data, file);
    let changed = false;
    for (const rec of recs) {
      const where = `${rel(file)} ${rec.where}: ${rec.recorded.command}`;
      if (typeof rec.recorded.command !== 'string') {
        fail(where, '  no `command` to replay');
        continue;
      }
      count++;
      const out = await replay(binary, rec.recorded);
      if (out.problem) {
        fail(where, `  ${out.problem}`);
        continue;
      }
      if (args.record) {
        // Timing values alone (ADR-0054) are not a change worth a rewrite.
        const unchanged =
          typeof rec.recorded.stdout === 'string' &&
          typeof rec.recorded.stderr === 'string' &&
          sameOutput(rec.recorded.stdout, out.stdout) &&
          sameOutput(rec.recorded.stderr, out.stderr) &&
          rec.recorded.exit === out.exit;
        if (!unchanged) {
          rec.recorded.stdout = out.stdout;
          rec.recorded.stderr = out.stderr;
          rec.recorded.exit = out.exit;
          changed = true;
          console.log(`recorded ${where}`);
        }
        continue;
      }
      const shape = recordedProblems(rec.recorded);
      if (shape.length) {
        fail(where, shape.map((p) => `  ${p}`).join('\n'));
        continue;
      }
      const diffs = [
        compareStream('stdout', rec.recorded.stdout, out.stdout),
        compareStream('stderr', rec.recorded.stderr, out.stderr),
        rec.recorded.exit === out.exit ? null : `exit: recorded ${rec.recorded.exit}, binary ${out.exit}`,
      ].filter((d): d is string => d !== null);
      if (diffs.length) fail(where, diffs.join('\n'));
    }
    if (args.record && changed) {
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      console.log(`wrote ${rel(file)}`);
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Page fences

/** Replays every page's verify steps; returns the count and, per page whose steps all passed, the steps as recorded. */
function checkPages(binary: string): { count: number; passed: Record<string, RecordedStep[]> } {
  let count = 0;
  const passed: Record<string, RecordedStep[]> = {};
  for (const page of pageFiles()) {
    if (page.data.status === 'planned') continue;
    const steps: VerifyStep[] = pageVerifySteps(page.file);
    if (!steps.length) continue;
    const before = drift;
    const s = sandbox(binary);
    try {
      for (const step of steps) {
        count++;
        const where = `${rel(step.file)}:${step.line}`;
        const out = bash(s, step.command, true);
        if (out.error) {
          fail(where, `  ${out.error.message}`);
          continue;
        }
        if (step.expected === null) {
          if (out.exit !== 0) fail(where, `  a verify step with no output fence exited ${out.exit}:\n${out.stdout}`);
          continue;
        }
        const actual = out.stdout.replace(/\n$/, '');
        if (!sameOutput(step.expected, actual)) fail(`${where} (expected output at line ${step.expectedLine})`, unifiedDiff(maskTimings(step.expected), maskTimings(actual), ['page', 'binary']));
      }
    } finally {
      rmSync(s.base, { recursive: true, force: true });
    }
    if (drift === before) passed[pageStepsKey(page.file)] = steps.map(recordedStep);
    else if (args.record) console.log(`not recorded: ${rel(page.file)} (a step drifted; the page's text fence is authored, so fix the page and record again)`);
  }
  return { count, passed };
}

/** --record: the replayed page steps and the build into cli.json, and the build into errors.json. */
function stampData(binaryVersion: string | null, pages: Record<string, RecordedStep[]> | null) {
  const engine = readData('engine.json') as { version?: string; commit?: string; source_build?: boolean } | null;
  const same = !!binaryVersion && engine?.version === binaryVersion;
  for (const name of RECORDED_WITH_FILES) {
    const file = join(DATA_DIR, name);
    const data = readData(name) as Record<string, unknown> | null;
    if (!data) continue;
    const next: Record<string, unknown> = { ...data };
    if (binaryVersion) {
      next.verified = binaryVersion;
      next.recorded_with = recordedWithLine(binaryVersion, same ? (engine?.commit ?? null) : null, same ? engine?.source_build === true : false);
    }
    if (name === 'cli.json' && pages) next.page_steps = pages;
    const text = `${JSON.stringify(next, null, 2)}\n`;
    if (text !== `${JSON.stringify(data, null, 2)}\n`) {
      writeFileSync(file, text);
      console.log(`wrote ${rel(file)} (${[binaryVersion ? `recorded_with "${String(next.recorded_with)}"` : '', pages && name === 'cli.json' ? `page_steps for ${Object.keys(pages).length} page(s)` : ''].filter(Boolean).join(', ')})`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const binary = findBinary();
  if (!binary) {
    console.log(
      [
        'docs:cli-check needs a relate binary. Any one of:',
        '  RELATE_BIN=/path/to/relate npm run docs:cli-check',
        '  put `relate` on PATH (curl -sSfL https://relatedb.ai/install.sh | bash)',
        '  RELATE_INSTALL=1 npm run docs:cli-check   (installs the latest release through public/install.sh)',
        'docs:cli-check: skipped (no relate binary)',
      ].join('\n'),
    );
    return 0;
  }
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: tmpdir(), DO_NOT_TRACK: '1' } });
  console.log(`docs:cli-check: ${binary} (${(version.stdout ?? '').split('\n')[0] || 'no version line'})`);

  const engine = readData('engine.json') as { version?: string } | null;
  if (engine?.version && !(version.stdout ?? '').startsWith(`Relate v${engine.version}\n`)) {
    console.log(`note: the docs track ${engine.version} (_data/engine.json); this binary is a different version, so expect drift`);
  }

  const recordings = process.env.PAGES_ONLY === '1' ? 0 : await checkData(binary);
  const pages = process.env.COMMANDS_ONLY === '1' ? null : checkPages(binary);
  const steps = pages?.count ?? 0;
  if (args.record) {
    const binaryVersion = /^Relate v(\d+\.\d+\.\d+\S*)\n/.exec(version.stdout ?? '')?.[1] ?? null;
    if (!binaryVersion) console.log('note: the binary printed no `Relate v<version>` line, so recorded_with and verified are left as they were');
    // PAGES_ONLY leaves the data recordings alone, so it does not restamp the build they came from.
    stampData(process.env.PAGES_ONLY === '1' ? null : binaryVersion, pages?.passed ?? null);
    console.log(`\ndocs:cli-check --record: ${recordings} recording(s) replayed, ${steps} page step(s)${drift ? `; ${drift} could not be recorded` : ''}`);
    return drift ? 1 : 0;
  }
  console.log(`\ndocs:cli-check: ${recordings} recording(s), ${steps} page step(s); ${drift ? `${drift} drift(s)` : 'no drift'}`);
  return drift ? 1 : 0;
}

process.exitCode = await main();

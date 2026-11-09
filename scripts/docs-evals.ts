#!/usr/bin/env node
// docs:evals (DOCS-PLAN.md §3.8 "Evals and metrics" and "The cold-start
// eval"; ADR-0029): runs the task suite in
// scripts/evals/tasks.json through a headless coding agent under each of the
// four conditions, grades what the agent leaves behind, prints a markdown
// summary and records the scores in src/content/docs/_data/evals.json. A
// person reviews the scores; no model grades them.
//
//   node scripts/docs-evals.ts                      live run (npm run docs:evals)
//   node scripts/docs-evals.ts --dry-run            prove the harness on a fixture agent
//   node scripts/docs-evals.ts --condition skill    one condition (repeatable, or a comma list)
//   node scripts/docs-evals.ts --tasks a,b          some tasks (also DOCS_EVALS_ONLY=a,b)
//   node scripts/docs-evals.ts --out <file>         write the scores there instead
//   node scripts/docs-evals.ts --keep               keep each run's working directory
//   node scripts/docs-evals.ts --strict             exit 1 when any assertion fails (always on in --dry-run)
//
// The agent: DOCS_EVALS_AGENT="<command>" is run with bash -c, once per task
// and condition, in a fresh working directory (its cwd, also
// DOCS_EVALS_WORKDIR), with the task's prompt on stdin. It must leave the
// task's store at the path the prompt names. Without DOCS_EVALS_AGENT the
// command prints "skipped" and exits 0: it needs an agent, a model key and
// consent to spend, and none of them exist in CI unless an operator runs
// .github/workflows/docs-evals.yml. DOCS_EVALS_HARNESS names the agent in the
// scores ("claude-code 2.x", "codex 0.x"); a live run requires it.
//
// The command also gets, in its environment:
//   DOCS_EVALS_TASK          the task id
//   DOCS_EVALS_CONDITION     none, agents-md, skill or docs-mcp
//   DOCS_EVALS_STORE         the absolute path where the store must end up
//   DOCS_EVALS_TRANSCRIPT    a file for its transcript (JSON Lines; the
//                            dialects are in scripts/evals/harness.ts). When
//                            the command leaves it empty, its stdout is read
//                            as the transcript instead
//   DOCS_EVALS_SYSTEM_PROMPT scripts/evals/system-prompt.md, which forbids
//                            prior knowledge of relate; the command passes it
//                            to its agent as a system prompt
//   DOCS_EVALS_AGENTS_MD, DOCS_EVALS_SKILL_DIR, DOCS_EVALS_MCP_URL,
//   DOCS_EVALS_MCP_CONFIG    the condition's files, also laid out in the
//                            working directory where the agents look
//                            (harness.ts `prepare`)
//   DOCS_EVALS_ROOT          this repository's root, for naming its files
//                            ("bash $DOCS_EVALS_ROOT/scripts/evals/agents/claude-code.sh")
//   PATH                     with a directory holding `relate` first
//   DO_NOT_TRACK=1
// and nothing else of this process's environment but HOME, TMPDIR, LANG,
// LC_ALL, LC_CTYPE, TERM, USER, the model keys ANTHROPIC_API_KEY and
// CODEX_API_KEY, every DOCS_EVALS_* variable, and the variables named in
// DOCS_EVALS_PASS_ENV (a comma list, for a provider credential the agent
// needs): a token the operator's shell holds for anything else
// (GITHUB_TOKEN, CLOUDFLARE_API_TOKEN, …) never reaches the agent.
// The command runs in the working directory, so a word of it of the form
// scripts/<path> that names a file of this repository is made absolute
// ("bash scripts/evals/fixtures/pass.sh"); no other word is rewritten, so
// `.` and any other relative path stay inside the working directory.
//
// Example commands (documented, never run by this repository's checks; each
// needs its own credential and spends money):
//   Claude Code: the wrapper scripts/evals/agents/claude-code.sh, from
//     https://code.claude.com/docs/en/headless (read 2026-11-07):
//     DOCS_EVALS_HARNESS="claude-code <version>" \
//     DOCS_EVALS_AGENT="bash scripts/evals/agents/claude-code.sh" \
//       node scripts/docs-evals.ts
//     (reads ANTHROPIC_API_KEY. It runs --bare, which loads no CLAUDE.md,
//     skill or MCP server by itself, under none, agents-md and docs-mcp, and
//     passes each condition by flag; under skill it runs without --bare, since
//     bare mode never lists the available skills to the model. Its header has
//     the details. Its stream-json goes to stdout, which the harness reads as
//     the transcript.)
//   Codex, from https://learn.chatgpt.com/docs/non-interactive-mode (read 2026-11-07):
//     DOCS_EVALS_HARNESS="codex <version>" \
//     DOCS_EVALS_AGENT='codex exec --json --skip-git-repo-check --sandbox workspace-write -' \
//       node scripts/docs-evals.ts
//     (reads CODEX_API_KEY. That page does not say how codex exec reads
//     AGENTS.md, a skill or an MCP server, so none of the conditions is
//     wired for it here, and its transcript fields are unconfirmed:
//     scripts/evals/harness.ts.)
//
// Grading: assertions run with the relate binary ($RELATE_BIN, else `relate`
// on PATH, else ../relate/target/release/relate beside this repository; none
// found prints "skipped" and exits 0), always --read-only, in a minimal
// environment with DO_NOT_TRACK=1. Every failed assertion prints the task,
// the assertion and what came back.
//
// --dry-run proves the harness without a model: DOCS_EVALS_AGENT must be
// exactly `bash scripts/evals/fixtures/<name>.sh` (pass.sh writes the
// expected store for every task; fail.sh leaves one relationship out of
// team-graph under `none`; write.sh writes to the store read-only-answer
// says must not change, and leaves no transcript, under `none`). It runs
// every task under every condition, never writes the data file (unless
// --out), and exits 1 on any red assertion.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  CONDITIONS,
  EVALS_DATA_FILE,
  FIXTURES_DIR,
  ROOT,
  SYSTEM_PROMPT_FILE,
  evalsProblems,
  findRelate,
  loadTasks,
  mergeRuns,
  prepare,
  relateVersion,
  removeDir,
  scratch,
  score,
  summary,
  type Condition,
  type EvalsData,
  type Run,
  type TaskScore,
} from './evals/harness.ts';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    condition: { type: 'string', multiple: true },
    tasks: { type: 'string' },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
  },
});

const dry = args['dry-run'] === true;
const say = (s: string) => process.stderr.write(`${s}\n`);
const fail = (s: string): never => {
  say(`docs:evals: ${s}`);
  process.exit(1);
};

const agentRaw = process.env.DOCS_EVALS_AGENT?.trim();
if (!agentRaw) {
  console.log('docs:evals: skipped (DOCS_EVALS_AGENT is not set: a run needs a headless agent command, its credential and consent to spend; see the header of scripts/docs-evals.ts)');
  process.exit(0);
}
// The command runs in each task's working directory, so a word of it of the
// form scripts/<path> that names a file of this repository is made absolute;
// nothing else is rewritten.
const agent = agentRaw
  .split(/(\s+)/)
  .map((w) => (/^scripts\/[\w./-]+$/.test(w) && !w.split('/').includes('..') && existsSync(join(ROOT, w)) ? join(ROOT, w) : w))
  .join('');
const fixtureRe = new RegExp(`^bash ${FIXTURES_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[a-z-]+\\.sh$`);
if (dry && !(fixtureRe.test(agent) && existsSync(agent.slice('bash '.length)))) {
  fail(`--dry-run runs exactly "bash scripts/evals/fixtures/<name>.sh", not "${agentRaw}"`);
}
const harness = dry ? `fixture ${agent.split(/\s+/).pop()!.split('/').pop()}` : process.env.DOCS_EVALS_HARNESS?.trim();
if (!harness) fail('a live run needs DOCS_EVALS_HARNESS, the agent\'s name and version for the scores ("claude-code <version>")');

// The arguments are checked before any scratch directory exists, so a bad one leaves nothing behind.
const only = (args.tasks ?? process.env.DOCS_EVALS_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
let tasks = loadTasks();
const unknown = only.filter((id) => !tasks.some((t) => t.id === id));
if (unknown.length) fail(`no task ${unknown.join(', ')} in scripts/evals/tasks.json`);
if (only.length) tasks = tasks.filter((t) => only.includes(t.id));

const asked = (args.condition ?? []).flatMap((c) => c.split(',')).map((c) => c.trim()).filter(Boolean);
const badCond = asked.filter((c) => !(CONDITIONS as readonly string[]).includes(c));
if (badCond.length) fail(`unknown condition ${badCond.join(', ')} (one of ${CONDITIONS.join(', ')})`);
const conditions = (asked.length ? asked : [...CONDITIONS]) as Condition[];

const bin = findRelate();
if (!bin) {
  console.log('docs:evals: skipped (no relate binary: set RELATE_BIN, put relate on PATH, or build ../relate/target/release/relate)');
  process.exit(0);
}

const base = process.env.DOCS_EVALS_WORK ? resolve(process.env.DOCS_EVALS_WORK) : tmpdir();
mkdirSync(base, { recursive: true });
const home = scratch(base, 'docs-evals-home');
const version = relateVersion(bin, home) ?? (removeDir(home), fail(`${bin} --version printed no version`));

const timeoutS = Number(process.env.DOCS_EVALS_TIMEOUT ?? 900);
const date = new Date().toISOString().slice(0, 10);
say(`docs:evals: ${dry ? 'dry run, ' : ''}${tasks.length} task(s) x ${conditions.length} condition(s), agent "${agent}", relate ${version} (${bin})`);

/** What of this process's environment the agent command gets (the header lists it); no other token reaches it. */
function agentEnv(): Record<string, string> {
  const pass = new Set(['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'ANTHROPIC_API_KEY', 'CODEX_API_KEY']);
  for (const k of (process.env.DOCS_EVALS_PASS_ENV ?? '').split(',')) if (k.trim()) pass.add(k.trim());
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && (pass.has(e[0]) || e[0].startsWith('DOCS_EVALS_'))));
}

const runs: Run[] = [];
let harnessErrors = 0;
for (const condition of conditions) {
  const scores: TaskScore[] = [];
  for (const task of tasks.filter((t) => t.conditions.includes(condition))) {
    const runDir = scratch(base, `docs-evals-${task.id}-${condition}`);
    try {
      const { workdir, env } = await prepare(task, condition, runDir, bin, home, version);
      const binDir = join(runDir, 'bin');
      mkdirSync(binDir);
      symlinkSync(bin, join(binDir, 'relate'));
      const transcript = join(runDir, 'transcript.jsonl');
      writeFileSync(transcript, '');
      const t0 = Date.now();
      const r = spawnSync('bash', ['-c', agent], {
        cwd: workdir,
        input: task.prompt,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        timeout: timeoutS * 1000,
        env: {
          ...agentEnv(),
          ...env,
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          DOCS_EVALS_ROOT: ROOT,
          DO_NOT_TRACK: '1',
          DOCS_EVALS_TASK: task.id,
          DOCS_EVALS_CONDITION: condition,
          DOCS_EVALS_WORKDIR: workdir,
          DOCS_EVALS_STORE: join(workdir, task.store),
          DOCS_EVALS_TRANSCRIPT: transcript,
          DOCS_EVALS_SYSTEM_PROMPT: SYSTEM_PROMPT_FILE,
        },
      });
      const seconds = Math.round((Date.now() - t0) / 100) / 10;
      if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') say(`  ${task.id} [${condition}]: the agent ran past DOCS_EVALS_TIMEOUT (${timeoutS} s)`);
      else if (r.error) throw r.error;
      const text = statSync(transcript).size > 0 ? readFileSync(transcript, 'utf8') : (r.stdout ?? '');
      writeFileSync(join(runDir, 'agent.stderr'), r.stderr ?? '');
      const s = score(task, { bin, workdir, transcript: text, home, vars: { version }, agentExit: r.status, seconds });
      // Details name the scratch directory as `.`, so the data file and the summary carry no temporary paths.
      for (const a of s.assertions) if (a.detail) a.detail = a.detail.replaceAll(`${workdir}/`, './').replaceAll(workdir, '.');
      scores.push(s);
      const red = s.assertions.filter((a) => !a.ok);
      say(`  ${s.passed ? 'pass' : 'FAIL'} ${task.id} [${condition}] ${s.assertions.length - red.length}/${s.assertions.length}, agent exit ${r.status ?? r.signal}, ${seconds} s`);
      for (const a of red) say(`       ${task.id} / ${a.id}: ${a.detail ?? 'failed'}`);
    } catch (e) {
      harnessErrors++;
      say(`  ERROR ${task.id} [${condition}]: ${(e as Error).message}`);
    } finally {
      if (args.keep) say(`       kept ${runDir}`);
      else removeDir(runDir);
    }
  }
  runs.push({ run: { date, engine: version, harness: harness!, condition }, tasks: scores });
}
removeDir(home);

console.log(summary(runs));

const out = args.out ? resolve(args.out) : dry ? null : EVALS_DATA_FILE;
if (out) {
  const prior: EvalsData = existsSync(out) ? (JSON.parse(readFileSync(out, 'utf8')) as EvalsData) : { kind: 'documentation', note: '', runs: [] };
  const problems = evalsProblems({ ...prior, note: prior.note || 'x' });
  if (problems.length) fail(`${out} is not an evals data file:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  const note = 'Scores from scripts/docs-evals.ts (DOCS-PLAN.md §3.8), one run per harness and condition; reviewed by a person before merge. A dry run never writes here.';
  writeFileSync(out, `${JSON.stringify(mergeRuns(prior, runs, note), null, 2)}\n`);
  say(`docs:evals: wrote ${relative(ROOT, out) || out}`);
}

const red = runs.some((r) => r.tasks.some((t) => !t.passed));
if (harnessErrors) fail(`${harnessErrors} task run(s) could not be graded`);
process.exit(red && (dry || args.strict) ? 1 : 0);

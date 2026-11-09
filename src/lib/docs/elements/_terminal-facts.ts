// The agent-mode terminal's facts (`:::terminal`): what the relate CLI does
// that the engine in a page cannot, digested from the recordings in
// src/content/docs/_data/cli.json and errors.json (replayed against the
// binary by docs:cli-check) into the small file the browser module loads,
// _terminal-facts.json. The full data files are 570 KB; the digest is about
// 31 KB as written and 25 KB minified in the browser module's lazy chunk,
// most of it the recorded messages the error classes are matched against.
//
//   node src/lib/docs/elements/_terminal-facts.ts --write   rewrite _terminal-facts.json
//   node src/lib/docs/elements/_terminal-facts.ts           exit 1 when it is stale
//
// docs:check reports a stale file through the element's `validate`, and
// src/lib/docs/terminal.test.ts checks it too.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TerminalFacts } from './_terminal-render.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
export const CLI_JSON = 'src/content/docs/_data/cli.json';
export const ERRORS_JSON = 'src/content/docs/_data/errors.json';
export const FACTS_JSON = 'src/lib/docs/elements/_terminal-facts.json';
export const FACTS_COMMAND = 'node src/lib/docs/elements/_terminal-facts.ts --write';

interface Recorded {
  command: string;
  stdout: string;
  stderr: string;
  exit: number;
}
interface ErrorEntry {
  id: string;
  code: string | null;
  kind: string | null;
  exit_code: number | null;
  retryable: boolean | null;
  message: string | null;
}

const list = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** A recorded message as an anchored pattern: `<placeholder>` and `…` stand for any text. */
export function messagePattern(message: string): string {
  return `^${message
    .split(/(<[^<>]+>|…)/)
    .map((part, i) => (i % 2 ? '[\\s\\S]+?' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')}$`;
}

/** The literal text of a recorded message (how specific a pattern is). */
const literal = (message: string) => message.replace(/<[^<>]+>|…/g, '').length;

/** The facts the terminal reads, from the two data files (parsed). Throws when a fact it needs is missing. */
export function digestFacts(cli: Record<string, any>, errors: Record<string, any>): TerminalFacts {
  if (cli.verified !== errors.verified) throw new Error(`cli.json verifies ${cli.verified}, errors.json ${errors.verified}`);
  const maxRows = (cli.global_flags as { id: string; messages?: string[]; recorded?: Recorded | Recorded[] }[]).find((f) => f.id === 'max-rows');
  if (!maxRows) throw new Error('cli.json has no max-rows flag');
  // The cap a harness gets: the recorded run with a harness variable and no --max-rows.
  const harnessRun = list(maxRows.recorded).find((r) => /^[A-Z_]+=1 relate /.test(r.command) && !r.command.includes('--max-rows'));
  if (!harnessRun) throw new Error('cli.json records no max-rows run under a harness variable');
  const harnessVariable = /^([A-Z_]+)=1 /.exec(harnessRun.command)![1];
  const agentCap = (JSON.parse(harnessRun.stdout.split('\n')[0]) as { rowCap?: { kept: number } }).rowCap?.kept;
  if (typeof agentCap !== 'number') throw new Error(`the recorded run \`${harnessRun.command}\` prints no rowCap`);
  // The warning's two counts become slots, so the renderer can fill them for any run.
  const warning = maxRows.messages?.[0] ?? '';
  const m = /^(.*?)(\d+)(.*?)(\d+)(.*)$/.exec(warning);
  if (!m) throw new Error(`cli.json's max-rows message has no counts: ${warning}`);
  const capWarning = `${m[1]}{kept}${m[3]}{total}${m[5]}`;
  const agentMode = cli.agent_mode as { detection_variables: string[] };
  if (!agentMode.detection_variables.includes(harnessVariable)) throw new Error(`${harnessVariable} is not one of agent_mode.detection_variables`);

  const entries = [...(errors.cli as ErrorEntry[]), ...(errors.engine as ErrorEntry[])];
  const kinds: TerminalFacts['kinds'] = {};
  for (const e of errors.cli as ErrorEntry[]) {
    if (e.code && e.kind && e.exit_code !== null && e.id === `cli-${e.code.replace(/_/g, '-')}-${e.kind}`) {
      kinds[e.kind] = { code: e.code, exit: e.exit_code, retryable: e.retryable === true, id: e.id };
    }
  }
  if (!kinds.execution || !kinds.syntax) throw new Error('errors.json has no cli-fatal-error-execution or cli-validation-error-syntax entry');
  // A query-run error: one with a class, a kind and an exit code (usage errors and command errors have no kind).
  const found: { id: string; message: string; kind: string; code: string; exit: number; retryable: boolean }[] = entries
    .filter((e) => e.message && e.code && e.kind && e.exit_code !== null && e.code !== 'timeout')
    .map((e) => ({ id: e.id, message: e.message!, kind: e.kind!, code: e.code!, exit: e.exit_code!, retryable: e.retryable === true }));
  // Every error object a recorded run printed, under the entry that holds the run: its message is
  // exact, and it settles a kind the message's prefix cannot (`semantic error: NumberOutOfRange` is
  // an argument error). An open failure is left out: it is classed as the store failing to open.
  const visit = (value: unknown, id: string | null) => {
    if (Array.isArray(value)) return value.forEach((v) => visit(v, id));
    if (!value || typeof value !== 'object') return;
    const o = value as Record<string, unknown>;
    const here = typeof o.id === 'string' ? o.id : id;
    if (typeof o.command === 'string' && typeof o.stdout === 'string' && here && !/^Failed to open/m.test(String(o.stderr ?? ''))) {
      for (const line of o.stdout.split('\n')) {
        if (!line.startsWith('{"error":')) continue;
        const e = (JSON.parse(line) as { error: { message: string; kind: string; code: string; exit_code: number; retryable: boolean } }).error;
        if (e.code === 'timeout') continue;
        found.push({ id: here, message: e.message, kind: e.kind, code: e.code, exit: e.exit_code, retryable: e.retryable });
      }
    }
    for (const v of Object.values(o)) visit(v, here);
  };
  visit(errors, null);
  visit(cli, null);
  const seen = new Set<string>();
  const messages = found
    .map((m) => ({ m, literal: literal(m.message) }))
    // Most specific first; on a tie the engine's own entry first, so a link names the error rather than its class.
    .sort((a, b) => b.literal - a.literal || Number(b.m.id.startsWith('engine-')) - Number(a.m.id.startsWith('engine-')) || (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : a.m.message < b.m.message ? -1 : 1))
    .map(({ m }) => ({ id: m.id, pattern: messagePattern(m.message), kind: m.kind, code: m.code, exit: m.exit, retryable: m.retryable }))
    .filter((m) => {
      const key = `${m.pattern} ${m.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return {
    version: cli.verified,
    recordedWith: cli.recorded_with,
    agentCap,
    harnessVariable,
    harnessVariables: agentMode.detection_variables,
    capWarning,
    exitCodes: (cli.exit_codes as { exit: number; code: string; meaning: string; reserved: boolean }[])
      .filter((x) => !x.reserved)
      .map(({ exit, code, meaning }) => ({ exit, code, meaning })),
    kinds,
    messages,
  };
}

const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** The facts as the data files say now, and as the committed file holds them. */
export function factsNow(): { want: TerminalFacts; have: TerminalFacts | null; text: string } {
  const want = digestFacts(read(CLI_JSON), read(ERRORS_JSON));
  let have: TerminalFacts | null = null;
  try {
    have = read(FACTS_JSON);
  } catch {
    // Missing or not JSON: stale.
  }
  return { want, have, text: `${JSON.stringify(want, null, 2)}\n` };
}

/** A problem when the committed facts file is not what the data files say, else null. */
export function factsProblem(): string | null {
  const { text } = factsNow();
  let current = '';
  try {
    current = readFileSync(join(ROOT, FACTS_JSON), 'utf8');
  } catch {
    // Missing.
  }
  return current === text ? null : `${FACTS_JSON} is not what ${CLI_JSON} and ${ERRORS_JSON} say now; run ${FACTS_COMMAND}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, FACTS_JSON), factsNow().text);
    console.log(`wrote ${FACTS_JSON}`);
  } else {
    const problem = factsProblem();
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
    console.log(`${FACTS_JSON} is current`);
  }
}

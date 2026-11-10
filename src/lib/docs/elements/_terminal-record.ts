// Records the agent-mode terminal's fixtures: each statement below run by
// the relate binary in the four modes the terminal draws, with and without
// a harness variable, its exact stdout, stderr and exit code. The unit test
// (src/lib/docs/terminal.test.ts) runs the same statements on the WASM build
// in public/wasm, renders the envelopes with _terminal-render.ts, and
// compares the bytes, so a renderer, engine or CLI change that moves one
// byte fails docs:test until the fixtures are recorded again and reviewed.
//
//   RELATE_BIN=<path to relate> node src/lib/docs/elements/_terminal-record.ts
//
// Each run is made as docs:cli-check makes its recordings: a fresh empty
// directory, a fresh home, and only PATH, HOME, TMPDIR and DO_NOT_TRACK=1
// (plus the harness variable) in the environment.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODES, type Mode } from './_terminal-render.ts';

export const FIXTURES_JSON = 'src/lib/docs/elements/_terminal-fixtures.json';

/** A statement the fixtures record. `writable`: run without --read-only (graph values need a write to exist). `gaps`: where the terminal is known not to match, per mode, and why. */
export interface FixtureCase {
  name: string;
  statement: string;
  writable?: boolean;
  gaps?: { mode: Mode; stream: 'stdout' | 'stderr'; why: string }[];
}

export interface FixtureRun {
  stdout: string;
  stderr: string;
  exit: number;
}

export interface Fixtures {
  format: 1;
  recordedWith: string;
  harnessVariable: string;
  cases: (FixtureCase & { runs: Record<string, FixtureRun> })[];
}

export const CASES: FixtureCase[] = [
  { name: 'one value', statement: 'RETURN 1 AS ok' },
  { name: 'three names', statement: "UNWIND ['Ada', 'Grace', 'Noor'] AS name RETURN name" },
  { name: 'two people as maps', statement: "UNWIND [{name: 'Ada', since: 2024}, {name: 'Grace', since: 2023}] AS p RETURN p.name AS person, p.since AS since, p AS row" },
  { name: 'the row cap', statement: 'UNWIND range(1, 250) AS x RETURN x' },
  { name: 'just under the cap', statement: 'UNWIND range(1, 100) AS x RETURN x' },
  { name: 'empty result', statement: 'UNWIND [] AS x RETURN x' },
  {
    name: 'scalars, lists and maps',
    statement: "UNWIND range(1, 3) AS x RETURN x, {b: x, a: [1, 'two', null, true]} AS m, null AS z, 'a|b' AS s, x % 2 = 0 AS even",
  },
  {
    name: 'floats',
    statement: 'RETURN 1.0 AS one, 1e21 AS big, 1.5e-7 AS small, 0.1 AS tenth, -0.0 AS negzero, 1e16 AS e16, [1.0, 2.5, 1e21] AS list, 0.0 / 0.0 AS nan, -1.0 / 0.0 AS neginf',
  },
  {
    name: 'strings',
    statement: "RETURN '' AS empty, ' x' AS lead, '12' AS digits, 'true' AS word, 'a,b' AS comma, 'say \"hi\"' AS quotes, 'back\\\\slash' AS backslash, 'tab\\there' AS tab, 'line\\nbreak' AS newline, 'é中文' AS wide, 'inf' AS inf, '1e5' AS exp, 'x\\u202Ey' AS bidi",
  },
  {
    // Display width in the table: CJK, a combining mark, a flag, emoji with a skin tone, U+FE0F and U+FE0E, a joiner (escaped).
    name: 'wide characters',
    statement: "RETURN 'café' AS a, '日本語' AS b, '👍🏽' AS c, '🇯🇵' AS f, '❤\uFE0F' AS g, '☝🏽' AS h, '🚀' AS i, '👩\u200D💻' AS j, 'नमस्ते' AS k, '✈\uFE0E' AS l, '1\uFE0F\u20E3' AS m",
  },
  {
    name: 'temporal values and points',
    statement: "RETURN date('2024-03-14') AS d, datetime('2024-01-02T03:04:05Z') AS dt, time('12:00') AS t, duration('P1DT2H') AS dur, point({x: 1, y: 2.5}) AS p, point({latitude: 1.5, longitude: 2}) AS g, point({x: 1, y: 2, z: 3}) AS p3",
  },
  {
    name: 'a nested date',
    statement: "RETURN [date('2024-03-14')] AS dates",
    gaps: [{ mode: 'table', stream: 'stdout', why: 'a date nested in a list travels as a string, so the table quotes it; relate prints it bare' }],
  },
  { name: 'vectors', statement: 'RETURN vector([1, 2, 3], 3, INTEGER) AS v, vector([1.5, 2], 2, FLOAT32) AS f' },
  {
    name: 'nodes, relationships and a path',
    statement: "CREATE p = (a:Person:Engineer {name: 'Ada', since: 2024})-[r:WORKS_ON {role: 'lead'}]->(b:Project {name: 'relate'}) RETURN a, r, b, p",
    writable: true,
  },
  { name: 'two statements', statement: 'RETURN 1 AS a; RETURN 2 AS b' },
  { name: 'a write with no columns', statement: "CREATE (:Person {name: 'Ada'})", writable: true },
  {
    name: 'a write that changes nothing',
    statement: 'UNWIND [] AS x CREATE (:Person {n: x})',
    gaps: (['table', 'envelope', 'jsonl', 'toon'] as const).map((mode) => ({
      mode,
      stream: 'stderr' as const,
      why: 'relate notes on stderr that a write changed nothing; the envelope does not say that a statement was a write',
    })),
  },
  { name: 'a syntax error', statement: 'MATCH (n RETURN n' },
  { name: 'a missing parameter', statement: 'MATCH (p:Person {name: $name}) RETURN p.role AS role' },
  { name: 'division by zero', statement: 'RETURN 1/0 AS x' },
  { name: 'a write on a read-only database', statement: "CREATE (:Person {name: 'Bo'})" },
  { name: 'an unknown function', statement: 'RETURN nosuch(1) AS x' },
  { name: 'an undefined variable', statement: 'MATCH (n) RETURN m' },
  { name: 'a procedure that does not exist', statement: 'CALL db.nosuch()' },
  { name: 'a latitude out of range', statement: 'RETURN point({latitude: 100, longitude: 0}) AS p' },
  { name: 'several statements, one fails', statement: 'RETURN 1 AS a; RETRN 2; RETURN 3 AS c' },
  { name: 'a failure after a capped statement', statement: 'UNWIND range(1, 120) AS x RETURN x; RETURN $missing AS m' },
];

/** The key of one run in a case's `runs`: the mode, and `+harness` when the harness variable was set. */
export const runKey = (mode: Mode, harness: boolean) => `${mode}${harness ? '+harness' : ''}`;

function record(bin: string, harnessVariable: string): Fixtures {
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0];
  const cases = CASES.map((c) => {
    const runs: Record<string, FixtureRun> = {};
    for (const mode of MODES) {
      for (const harness of [false, true]) {
        const dir = mkdtempSync(join(tmpdir(), 'relate-terminal-'));
        const home = mkdtempSync(join(tmpdir(), 'relate-terminal-home-'));
        try {
          const env: Record<string, string> = { PATH: dirname(bin) + ':/usr/bin:/bin', HOME: home, TMPDIR: tmpdir(), DO_NOT_TRACK: '1' };
          if (harness) env[harnessVariable] = '1';
          const args = [...(c.writable ? [] : ['--read-only']), '--mode', mode, c.statement];
          const r = spawnSync(bin, args, { cwd: dir, env, encoding: 'utf8' });
          runs[runKey(mode, harness)] = { stdout: r.stdout, stderr: r.stderr, exit: r.status ?? -1 };
        } finally {
          rmSync(dir, { recursive: true, force: true });
          rmSync(home, { recursive: true, force: true });
        }
      }
    }
    return { ...c, runs };
  });
  return { format: 1, recordedWith: version, harnessVariable, cases };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bin = process.env.RELATE_BIN;
  if (!bin) {
    console.error('set RELATE_BIN to the relate binary');
    process.exit(2);
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const facts = (await import('./_terminal-facts.ts')).factsNow().want;
  const fixtures = record(bin, facts.harnessVariable);
  writeFileSync(join(root, FIXTURES_JSON), `${JSON.stringify(fixtures, null, 1)}\n`);
  console.log(`wrote ${FIXTURES_JSON}: ${fixtures.cases.length} statements, ${fixtures.recordedWith}`);
}

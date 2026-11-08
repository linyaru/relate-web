// The agent-mode terminal's renderers against the relate binary
// (`:::terminal`, src/lib/docs/elements/_terminal-render.ts). Two sources of
// truth, both recorded with the binary:
//
//   - src/lib/docs/elements/_terminal-fixtures.json: statements run by the
//     binary in the four modes, with and without a harness variable
//     (`RELATE_BIN=… node src/lib/docs/elements/_terminal-record.ts`);
//   - every query run recorded in _data/cli.json and errors.json that the
//     terminal can show (a plain statement, no store, no setup).
//
// Each statement runs here on the WASM build in public/wasm (the engine the
// page runs); its envelopes go through the renderers, and the bytes must
// equal the binary's stdout and stderr, and the exit code its exit code. A
// fixture's `gaps` name the few places the terminal is known not to match;
// those must still differ, so a fix on either side shows up here too.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { ROOT } from './content.ts';
import { digestFacts, factsProblem, messagePattern } from './elements/_terminal-facts.ts';
import { CASES, runKey, type Fixtures } from './elements/_terminal-record.ts';
import {
  classifyError,
  commandLine,
  displayWidth,
  ENGINE_DIFFERENCES,
  MODES,
  parseJson,
  readEnvelope,
  recordedEnvelopeText,
  renderRun,
  sanitizeErrorText,
  shellQuote,
  splitStatements,
  type Mode,
  type TerminalFacts,
} from './elements/_terminal-render.ts';

const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const facts: TerminalFacts = read('src/lib/docs/elements/_terminal-facts.json');
const fixtures: Fixtures = read('src/lib/docs/elements/_terminal-fixtures.json');

interface Db {
  executeScript(script: string): string[];
  free(): void;
}
const wasmDir = join(ROOT, 'public/wasm');
const wasm = (await import(pathToFileURL(join(wasmDir, 'relate.js')).href)) as { initSync(o: { module: Buffer }): void; RelateDb: new (readOnly?: boolean) => Db };
wasm.initSync({ module: readFileSync(join(wasmDir, 'relate_bg.wasm')) });

/** The envelopes the page's engine returns for `statement` on a fresh database, read-only unless `writable`. */
function engine(statement: string, writable = false): string[] {
  const db = new wasm.RelateDb(!writable);
  try {
    return db.executeScript(statement);
  } finally {
    db.free();
  }
}

/** What the renderers print for a run, as the two streams' bytes. */
function render(statement: string, mode: Mode, cap: number | null, writable = false) {
  const out = renderRun({ envelopes: engine(statement, writable), statements: splitStatements(statement).length, mode, cap }, facts);
  const stream = (fd: 1 | 2) => out.lines.filter((l) => l.fd === fd).map((l) => `${l.text}\n`).join('');
  return { stdout: stream(1), stderr: stream(2), exit: out.exit };
}

test('the facts file is what cli.json and errors.json say', () => {
  assert.equal(factsProblem(), null);
  assert.deepEqual(digestFacts(read('src/content/docs/_data/cli.json'), read('src/content/docs/_data/errors.json')), facts);
});

test('the fixtures were recorded with the binary the docs verify, and hold every case', () => {
  assert.match(fixtures.recordedWith, new RegExp(`v${facts.version.replace(/\./g, '\\.')}$`));
  assert.equal(fixtures.harnessVariable, facts.harnessVariable);
  assert.deepEqual(
    fixtures.cases.map(({ name, statement }) => ({ name, statement })),
    CASES.map(({ name, statement }) => ({ name, statement })),
    'the fixtures are stale: RELATE_BIN=<relate> node src/lib/docs/elements/_terminal-record.ts',
  );
});

for (const c of fixtures.cases) {
  test(`the binary's bytes, rendered from the engine's envelopes: ${c.name}`, () => {
    for (const mode of MODES) {
      for (const harness of [false, true]) {
        const want = c.runs[runKey(mode, harness)];
        const have = render(c.statement, mode, harness ? facts.agentCap : null, c.writable);
        const at = `${c.name}, --mode ${mode}${harness ? `, ${facts.harnessVariable}=1` : ''}`;
        assert.equal(have.exit, want.exit, `${at}: exit code`);
        for (const stream of ['stdout', 'stderr'] as const) {
          const gap = CASES.find((x) => x.name === c.name)?.gaps?.find((g) => g.mode === mode && g.stream === stream);
          if (gap) assert.notEqual(have[stream], want[stream], `${at}: ${stream} now matches; drop the gap "${gap.why}" and say so on the page`);
          else assert.equal(have[stream], want[stream], `${at}: ${stream}`);
        }
      }
    }
  });
}

/** A recorded command line, split as a POSIX shell would (enough for the docs' recordings). */
function words(command: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < command.length) {
    if (command[i] === ' ') {
      i++;
      continue;
    }
    let word = '';
    while (i < command.length && command[i] !== ' ') {
      const ch = command[i];
      if (ch === "'") {
        const end = command.indexOf("'", i + 1);
        if (end < 0) return null;
        word += command.slice(i + 1, end);
        i = end + 1;
      } else if (ch === '"') {
        i++;
        while (i < command.length && command[i] !== '"') {
          if (command[i] === '\\' && '"\\$`'.includes(command[i + 1])) i++;
          word += command[i++];
        }
        i++;
      } else if (/[|&;<>()$`\\\n]/.test(ch)) return null;
      else word += command[i++];
    }
    out.push(word);
  }
  return out;
}

/**
 * A recorded run the terminal can show: `[VAR=1] relate [--read-only]
 * [--mode M | --jsonl | --toon] [--max-rows N] <statement>`, no store and no
 * setup. Returns how the terminal would run it, or null.
 */
function terminalRun(rec: Record<string, unknown>): { statement: string; mode: Mode; cap: number | null; writable: boolean } | null {
  if (rec.setup || rec.hold || typeof rec.command !== 'string') return null;
  const w = words(rec.command);
  if (!w) return null;
  let harness = false;
  while (w.length && /^[A-Z_]+=/.test(w[0])) {
    const [name, value] = w.shift()!.split('=');
    if (!facts.harnessVariables.includes(name) || !value) return null;
    harness = true;
  }
  if (w.shift() !== 'relate') return null;
  let mode: Mode | null = null;
  let cap: number | null = null;
  let writable = true;
  while (w.length > 1) {
    const flag = w.shift()!;
    if (flag === '--read-only') writable = false;
    else if (flag === '--jsonl' || flag === '--toon') mode = flag.slice(2) as Mode;
    else if (flag === '--mode' && (MODES as readonly string[]).includes(w[0])) mode = w.shift() as Mode;
    else if (flag === '--max-rows' && /^\d+$/.test(w[0])) cap = Number(w.shift()) || null;
    else return null;
  }
  // One word with no space is a command (`relate info`), not a statement.
  if (w.length !== 1 || w[0].startsWith('-') || !w[0].includes(' ')) return null;
  // Without --mode a piped run prints jsonl, or toon under a harness (agent mode).
  mode ??= harness ? 'toon' : 'jsonl';
  if (cap === null && harness && !rec.command.includes('--max-rows')) cap = facts.agentCap;
  return { statement: w[0], mode, cap, writable };
}

function recordings(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const v of value) recordings(v, out);
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.command === 'string' && typeof o.stdout === 'string' && typeof o.exit === 'number') out.push(o);
    else for (const v of Object.values(o)) recordings(v, out);
  }
  return out;
}

test('every query run recorded in cli.json and errors.json that the terminal can show, byte for byte', (t) => {
  const all = [...recordings(read('src/content/docs/_data/cli.json')), ...recordings(read('src/content/docs/_data/errors.json'))];
  const compared: string[] = [];
  const gaps: string[] = [];
  const engineGaps: string[] = [];
  const zeroEffect = (read('src/content/docs/_data/errors.json').cli as { id: string; message: string }[]).find((e) => e.id === 'cli-write-changed-nothing')!.message;
  for (const rec of all) {
    const run = terminalRun(rec);
    if (!run) continue;
    // Where the WASM build and the binary word an error differently (an engine difference, not a
    // renderer one), the bytes cannot match; the fixtures name the one known case.
    const wasmError = engine(run.statement, run.writable).map((t) => (JSON.parse(t) as { error: string | null }).error).find((e) => e) ?? null;
    const binError = /"message":"((?:[^"\\]|\\.)*)"/.exec(rec.stdout as string)?.[1];
    if (wasmError && binError !== undefined && sanitizeErrorText(wasmError) !== JSON.parse(`"${binError}"`)) {
      engineGaps.push(`${rec.command}: ${wasmError}`);
      continue;
    }
    const have = render(run.statement, run.mode, run.cap, run.writable);
    assert.equal(have.stdout, rec.stdout, `${rec.command}: stdout`);
    // The one known gap (see the fixtures): the note relate prints for a write that changed nothing.
    if (rec.stderr === `${zeroEffect}\n` && have.stderr === '') gaps.push(rec.command as string);
    else assert.equal(have.stderr, rec.stderr, `${rec.command}: stderr`);
    assert.equal(have.exit, rec.exit, `${rec.command}: exit code`);
    compared.push(rec.command as string);
  }
  // A recording format change that made every run unreadable would pass silently; it must not.
  t.diagnostic(`${compared.length} recordings compared; known gaps: ${gaps.length} zero-effect note, ${engineGaps.length} engine wording`);
  assert.ok(compared.length >= 15, `only ${compared.length} recordings compared:\n${compared.join('\n')}`);
  assert.ok(engineGaps.length <= 1, `the WASM build and the binary word more errors differently than the known one:\n${engineGaps.join('\n')}`);
  assert.ok(gaps.length <= 2, `the zero-effect note is missing from more runs than expected:\n${gaps.join('\n')}`);
});

test('each engine difference the pane names still differs as it says, and the pane says so', () => {
  for (const d of ENGINE_DIFFERENCES) {
    const c = fixtures.cases.find((x) => x.name === d.fixture);
    assert.ok(c, `no fixture case named "${d.fixture}"`);
    const wasmError = engine(c.statement).map((t) => (JSON.parse(t) as { error: string | null }).error).find((e) => e);
    assert.match(wasmError ?? '', new RegExp(d.pattern), `${d.fixture}: the engine no longer words it as the pattern says; drop it from ENGINE_DIFFERENCES and the fixture's gaps`);
    const prefix = d.binary.replace(/…$/, '');
    assert.ok(c.runs.table.stderr.startsWith(prefix), `${d.fixture}: the binary's stderr does not start with "${prefix}"`);
    assert.match(c.runs.envelope.stdout, new RegExp(`"kind":"${d.kind}"`), `${d.fixture}: the binary's kind is not ${d.kind}`);
    const out = renderRun({ envelopes: engine(c.statement), statements: 1, mode: 'table', cap: null }, facts);
    assert.ok(out.gaps.some((g) => g.includes(d.binary) && g.includes(d.kind)), `${d.fixture}: the pane does not name the difference`);
  }
});

test('a large result renders without a spread over its rows, and parsed envelopes render as text does', () => {
  const n = 200_000;
  const text = `{"columnTypes":["INTEGER"],"columns":["x"],"error":null,"notifications":[],"plan":null,"rows":[${Array.from({ length: n }, (_, i) => `{"x":${i + 1}}`).join(',')}],"stats":{}}`;
  for (const mode of MODES) {
    const out = renderRun({ envelopes: [text], statements: 1, mode, cap: null }, facts);
    assert.equal(out.exit, 0);
    assert.ok(out.lines.length >= (mode === 'envelope' ? 1 : n), `${mode}: ${out.lines.length} lines`);
  }
  const small = engine("UNWIND ['Ada', 'Grace'] AS name RETURN name");
  const viaText = renderRun({ envelopes: small, statements: 1, mode: 'table', cap: null }, facts);
  const viaParsed = renderRun({ envelopes: small.map(readEnvelope), statements: 1, mode: 'table', cap: null }, facts);
  assert.deepEqual(viaParsed, viaText);
});

test('display width follows unicode-width 0.2 for the emoji sequences relate measures as one picture', () => {
  assert.equal(displayWidth('👍🏽'), 2);
  assert.equal(displayWidth('☝🏽'), 2);
  assert.equal(displayWidth('❤\uFE0F'), 2);
  assert.equal(displayWidth('✈\uFE0E'), 1);
  assert.equal(displayWidth('🇯🇵'), 2);
  assert.equal(displayWidth('नमस्ते'), 4);
});

test('JSON is kept byte for byte, floats and escapes included', () => {
  const text = '{"a":[1.0,1e+21,-0.0,"t\\u0001\\"",{"b":null}],"c":true}';
  const j = parseJson(text);
  assert.equal(j.raw, text);
  assert.equal(j.t === 'obj' && j.entries[0][1].t === 'arr' && j.entries[0][1].items[1].raw, '1e+21');
  assert.throws(() => parseJson('{"a":1,}'));
});

test('a recorded envelope gets back the `.0` of a whole float in a FLOAT column', () => {
  const text = recordedEnvelopeText({ columnTypes: ['FLOAT', 'INTEGER'], columns: ['f', 'i'], error: null, notifications: [], plan: null, rows: [{ i: 1, f: 2 }], stats: {} });
  assert.match(text, /"rows":\[\{"f":2\.0,"i":1\}\]/);
});

test('the splitter counts statements as relate does', () => {
  assert.deepEqual(splitStatements("RETURN 1; RETURN ';' AS s; // note"), ['RETURN 1', "RETURN ';' AS s"]);
  assert.deepEqual(splitStatements('RETURN 1 /* a ; b */ ; RETURN 2;'), ['RETURN 1 /* a ; b */', 'RETURN 2']);
  assert.deepEqual(splitStatements('// only a comment'), []);
  assert.deepEqual(splitStatements('RETURN `a;b` AS x'), ['RETURN `a;b` AS x']);
});

test('an error message no recorded entry matches takes the class its prefix names', () => {
  assert.equal(classifyError('semantic error: ParameterMissing: Expected parameter(s): x', facts).matched, 'engine-parameter-missing');
  const odd = classifyError('storage error: something new', facts);
  assert.deepEqual([odd.kind, odd.code, odd.exit], ['storage', 'fatal_error', 1]);
  const bare = classifyError('Something nobody recorded', facts);
  assert.deepEqual([bare.kind, bare.code, bare.exit, bare.matched], ['execution', 'fatal_error', 1, null]);
  assert.equal(new RegExp(messagePattern('type error: <detail>')).test('type error: / by zero'), true);
});

test('the command line carries --read-only and quotes the statement for a shell', () => {
  assert.equal(commandLine("RETURN 'a' AS x", 'envelope', null), `relate --read-only --mode envelope "RETURN 'a' AS x"`);
  assert.equal(commandLine('RETURN $x AS x', 'toon', 'CLAUDECODE'), "CLAUDECODE=1 relate --read-only --mode toon 'RETURN $x AS x'");
  assert.equal(shellQuote(`RETURN 'a' + "$b"`), `'RETURN '\\''a'\\'' + "$b"'`);
});

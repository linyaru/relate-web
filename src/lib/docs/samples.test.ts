// Unit tests for the verified language samples (src/lib/docs/samples.ts):
// the info string, ids, the sidecar merge, output normalization and the
// runner. The runner tests use this Node as RELATE_NODE with a stand-in
// @relate/relate, so they need no relate build; the real clients are
// exercised by `npm run docs:samples` (scripts/samples/setup.sh).

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  clientEnv,
  formatSidecar,
  mergeSamples,
  normalizeOutput,
  outputDiff,
  pageSamples,
  parseSampleInfo,
  readSidecar,
  runSample,
  sampleEntry,
  sampleFileName,
  sampleSourceHash,
  sampleId,
  sampleVerifiers,
  writeSidecar,
  type Sidecar,
  type SidecarEntry,
} from './samples.ts';

const scratch = mkdtempSync(join(tmpdir(), 'samples-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('parseSampleInfo: python run and js run, with name and title', () => {
  assert.deepEqual(parseSampleInfo('python', 'run'), { lang: 'python', name: null, title: null });
  assert.deepEqual(parseSampleInfo('js', 'run name=first'), { lang: 'js', name: 'first', title: null });
  assert.deepEqual(parseSampleInfo('python', 'run title="app.py" name=app'), { lang: 'python', name: 'app', title: 'app.py' });
  assert.equal(parseSampleInfo('python', null), null);
  assert.equal(parseSampleInfo('python', 'title="app.py"'), null);
  assert.equal(parseSampleInfo('cypher', 'run'), null);
  assert.equal(parseSampleInfo('javascript', 'run'), null);
  assert.throws(() => parseSampleInfo('js', 'run expect=error'), /takes only `name=<id>`/);
  assert.throws(() => parseSampleInfo('js', 'run name=a.b'), /takes only/);
  assert.throws(() => parseSampleInfo('python', 'run title="app.js"'), /needs the extension \.py/);
  assert.throws(() => parseSampleInfo('js', 'run title="../x.js"'), /takes only/);
});

test('sampleFileName: the title, else sample.py, sample.cjs or sample.mjs', () => {
  assert.equal(sampleFileName({ lang: 'python', title: null, code: 'print(1)' }), 'sample.py');
  assert.equal(sampleFileName({ lang: 'python', title: 'app.py', code: '' }), 'app.py');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'const r = require("x");' }), 'sample.cjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'import { Database } from "@relate/relate";' }), 'sample.mjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'import relate from "@relate/relate";' }), 'sample.mjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: '// imports nothing\nconsole.log(1)' }), 'sample.cjs');
});

const PAGE = `---
title: T
description: d
---

Intro.

\`\`\`cypher run
RETURN 1
\`\`\`

\`\`\`python run
print("one")
\`\`\`

::::tabs
:::tab[Node]{key=node}
\`\`\`js run name=hello
console.log("hi")
\`\`\`
:::
:::tab[Python]{key=python}
\`\`\`python run
print("two")
\`\`\`
:::
::::

\`\`\`python
print("not a sample")
\`\`\`
`;

test('pageSamples: page order, ids, file line numbers, samples inside tabs', () => {
  const { samples, problems } = pageSamples(PAGE);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    samples.map((s) => [s.id, s.lang, s.line, s.code]),
    [
      ['python-1', 'python', 12, 'print("one")'],
      ['hello', 'js', 18, 'console.log("hi")'],
      ['python-2', 'python', 23, 'print("two")'],
    ],
  );
  assert.equal(sampleId({ lang: 'js', name: null, title: null }, 3), 'js-3');
  assert.equal(sampleId({ lang: 'js', name: 'x', title: null }, 3), 'x');
});

test('pageSamples: a named sample counts toward the numbering, like cells', () => {
  const { samples } = pageSamples('```python run name=a\nprint(1)\n```\n\n```python run\nprint(2)\n```\n');
  assert.deepEqual(samples.map((s) => s.id), ['a', 'python-2']);
});

test('pageSamples: duplicate ids, ids shared with a cell, bad info strings', () => {
  const dup = pageSamples('```python run name=a\nprint(1)\n```\n\n```js run name=a\nconsole.log(1)\n```\n');
  assert.match(dup.problems.join('\n'), /sample id `a` is used twice/);
  const clash = pageSamples('```cypher run name=a\nRETURN 1\n```\n\n```python run name=a\nprint(1)\n```\n');
  assert.match(clash.problems.join('\n'), /also a Cypher cell's id/);
  const clashNumbered = pageSamples('```cypher run\nRETURN 1\n```\n\n```python run name=cell-1\nprint(1)\n```\n');
  assert.match(clashNumbered.problems.join('\n'), /`cell-1` is also a Cypher cell's id/);
  const bad = pageSamples('```python run timeout=5\nprint(1)\n```\n');
  assert.equal(bad.samples.length, 0);
  assert.match(bad.problems[0], /^line 1: `python run` takes only/);
});

test('normalizeOutput: line endings, trailing space, blank edges, the temp directory', () => {
  assert.equal(normalizeOutput('a  \r\nb\t\n\n\n', []), 'a\nb');
  assert.equal(normalizeOutput('\n\nx\n', []), 'x');
  assert.equal(normalizeOutput('/tmp/relate-sample-1/app.rl\n/private/tmp/relate-sample-1/app.rl\n', ['/tmp/relate-sample-1', '/private/tmp/relate-sample-1']), './app.rl\n./app.rl');
});

const cell: SidecarEntry = { kind: 'table', text: '| x |\n1 row', table: null, graph: null, expectError: false };

test('mergeSamples: keeps cells in place, replaces and appends samples, drops stale samples', () => {
  const before: Sidecar = {
    format: 1,
    verified: '0.16.0',
    cells: {
      old: sampleEntry('gone', '0.16.0', 'h'),
      'cell-1': cell,
      'python-1': sampleEntry('one', '0.16.0', 'h'),
    },
  };
  const recorded = new Map([
    ['python-1', sampleEntry('uno', '0.16.1', 'h')],
    ['js-1', sampleEntry('hi', '0.16.1', 'h')],
  ]);
  const after = mergeSamples(before, recorded, '0.16.1');
  assert.deepEqual(Object.keys(after.cells), ['cell-1', 'python-1', 'js-1']);
  assert.equal(after.cells['cell-1'], cell);
  assert.equal(after.cells['python-1'].text, 'uno');
  assert.equal(after.verified, '0.16.0', 'the sidecar-level version belongs to the cells');
  const fresh = mergeSamples(null, recorded, '0.16.1');
  assert.deepEqual(fresh, { format: 1, verified: '0.16.1', cells: { 'python-1': recorded.get('python-1'), 'js-1': recorded.get('js-1') } });
});

test('readSidecar and writeSidecar: round trip; a sample entry has the cells format with kind text', () => {
  const page = join(scratch, 'p.mdx');
  writeFileSync(page, PAGE);
  assert.equal(readSidecar(page), null);
  const s: Sidecar = { format: 1, verified: '0.16.1', cells: { 'cell-1': cell, 'python-1': sampleEntry('one', '0.16.1', 'h') } };
  writeSidecar(page, s);
  const text = readFileSync(join(scratch, 'p.results.json'), 'utf8');
  assert.equal(text, formatSidecar(s));
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(readSidecar(page), s);
  assert.deepEqual(Object.keys(s.cells['python-1']), ['kind', 'text', 'table', 'graph', 'expectError', 'verified', 'source_sha256']);
  writeFileSync(join(scratch, 'p.results.json'), '{"format": 2, "cells": {}}');
  assert.throws(() => readSidecar(page), /not a format 1 results file/);
  writeFileSync(join(scratch, 'p.results.json'), '{"format": 1, "cells": {"a": {"kind": "text"}}}');
  assert.throws(() => readSidecar(page), /entry `a` needs "kind" and "text"/);
});

test('sampleVerifiers: a language counts when every sample of it is recorded at the version from its current code', () => {
  const { samples } = pageSamples(PAGE);
  const hash = (id: string) => sampleSourceHash(samples.find((x) => x.id === id)!);
  const all: Sidecar = {
    format: 1,
    cells: {
      'cell-1': cell,
      'python-1': sampleEntry('one', '0.16.1', hash('python-1')),
      hello: sampleEntry('hi', '0.16.1', hash('hello')),
      'python-2': sampleEntry('two', '0.16.1', hash('python-2')),
    },
  };
  assert.deepEqual(sampleVerifiers(PAGE, all, '0.16.1'), ['python', 'node']);
  assert.deepEqual(sampleVerifiers(PAGE, all, '0.17.0'), []);
  const partial: Sidecar = { ...all, cells: { ...all.cells, 'python-2': sampleEntry('two', '0.16.0', hash('python-2')) } };
  assert.deepEqual(sampleVerifiers(PAGE, partial, '0.16.1'), ['node']);
  const edited: Sidecar = { ...all, cells: { ...all.cells, 'python-2': sampleEntry('two', '0.16.1', 'recorded from other code') } };
  assert.deepEqual(sampleVerifiers(PAGE, edited, '0.16.1'), ['node'], 'a sample changed since it was recorded drops its language');
  assert.deepEqual(sampleVerifiers(PAGE, null, '0.16.1'), []);
  assert.deepEqual(sampleVerifiers('No samples.\n', all, '0.16.1'), []);
});

test('sampleSourceHash: the code, title and language; not line endings or trailing spaces', () => {
  const base = { lang: 'python' as const, title: null, code: 'print(1)\nprint(2)' };
  assert.equal(sampleSourceHash(base), sampleSourceHash({ ...base, code: 'print(1)  \r\nprint(2)\n\n' }));
  assert.notEqual(sampleSourceHash(base), sampleSourceHash({ ...base, code: 'print(1)\nprint(3)' }));
  assert.notEqual(sampleSourceHash(base), sampleSourceHash({ ...base, title: 'app.py' }));
  assert.notEqual(sampleSourceHash(base), sampleSourceHash({ ...base, lang: 'js' }));
  assert.match(sampleSourceHash(base), /^[0-9a-f]{64}$/);
});

test('outputDiff: the changed lines only', () => {
  assert.equal(outputDiff('a\nb\nc', 'a\nB\nc\nd'), '- b\n+ B\n+ d');
});

test('clientEnv: says what is missing', () => {
  const none = clientEnv({});
  assert.equal(none.python, null);
  assert.equal(none.node, null);
  assert.equal(none.missing.python, 'RELATE_PY is not set');
  assert.equal(none.missing.js, 'RELATE_NODE is not set');
  const noPath = clientEnv({ RELATE_NODE: process.execPath });
  assert.match(noPath.missing.js!, /NODE_PATH is not set/);
  const empty = clientEnv({ RELATE_NODE: process.execPath, NODE_PATH: scratch });
  assert.match(empty.missing.js!, /holds no @relate\/relate/);
});

// A stand-in client: just enough of @relate/relate's shape for the runner.
const fakeModules = join(scratch, 'node_modules');
mkdirSync(join(fakeModules, '@relate', 'relate'), { recursive: true });
writeFileSync(join(fakeModules, '@relate', 'relate', 'package.json'), JSON.stringify({ name: '@relate/relate', version: '9.9.9', main: 'index.js' }));
writeFileSync(join(fakeModules, '@relate', 'relate', 'index.js'), 'exports.Database = { open: () => ({ connect: () => ({ query: () => ({ rows: [{ name: "Ada" }] }) }) }) };\n');
const env = clientEnv({ RELATE_NODE: process.execPath, NODE_PATH: fakeModules });

test('runSample: CommonJS and ES module samples resolve the client; output is normalized', () => {
  assert.deepEqual(env.missing, { python: 'RELATE_PY is not set' });
  const cjs = runSample({ lang: 'js', title: null, code: 'const { Database } = require("@relate/relate");\nconsole.log(Database.open(":memory:").connect().query("").rows[0].name + "   ");\n' }, env);
  assert.deepEqual(cjs, { ok: true, text: 'Ada', error: null });
  const esm = runSample({ lang: 'js', title: null, code: 'import relate from "@relate/relate";\nconsole.log(typeof relate.Database.open);' }, env);
  assert.deepEqual(esm, { ok: true, text: 'function', error: null });
  const cwd = runSample({ lang: 'js', title: 'where.cjs', code: 'console.log(process.cwd() + "/app.rl"); console.log(require("path").basename(__filename)); console.log(process.env.DO_NOT_TRACK);' }, env);
  assert.deepEqual(cwd, { ok: true, text: './app.rl\nwhere.cjs\n1', error: null });
});

test('runSample: a failing, silent, slow or unconfigured sample fails with the reason', () => {
  const fails = runSample({ lang: 'js', title: null, code: 'console.log("partial"); console.error("boom"); process.exit(3);' }, env);
  assert.equal(fails.ok, false);
  assert.match(fails.error!, /^exited with 3; standard error:\nboom$/);
  const silent = runSample({ lang: 'js', title: null, code: '1 + 1;' }, env);
  assert.match(silent.error!, /printed nothing on standard output/);
  const slow = runSample({ lang: 'js', title: null, code: 'setTimeout(() => {}, 10000);' }, env, { timeoutMs: 300 });
  assert.match(slow.error!, /did not finish within 0\.3 s/);
  const noPython = runSample({ lang: 'python', title: null, code: 'print(1)' }, env);
  assert.deepEqual(noPython, { ok: false, text: '', error: 'RELATE_PY is not set' });
});

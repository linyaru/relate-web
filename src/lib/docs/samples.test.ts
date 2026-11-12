// Unit tests for the verified language samples (src/lib/docs/samples.ts):
// the info string, ids, the sidecar merge, output normalization and the
// runner. The runner tests use this Node as RELATE_NODE with a stand-in
// @relate/relate, so they need no relate build; the real clients are
// exercised by `npm run docs:samples` (scripts/samples/setup.sh).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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
  sampleUnavailable,
  sampleVerifiers,
  VERSION_PROBES,
  writeSidecar,
  type Sidecar,
  type SidecarEntry,
} from './samples.ts';
import { checkSamples } from './checks/samples.ts';
import { ROOT } from './content.ts';
import { VERIFIERS } from './model.ts';

const scratch = mkdtempSync(join(tmpdir(), 'samples-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('parseSampleInfo: python run and js run, with name and title', () => {
  assert.deepEqual(parseSampleInfo('python', 'run'), { lang: 'python', name: null, title: null, env: null });
  assert.deepEqual(parseSampleInfo('js', 'run name=first'), { lang: 'js', name: 'first', title: null, env: null });
  assert.deepEqual(parseSampleInfo('python', 'run title="app.py" name=app'), { lang: 'python', name: 'app', title: 'app.py', env: null });
  assert.equal(parseSampleInfo('python', null), null);
  assert.equal(parseSampleInfo('python', 'title="app.py"'), null);
  assert.equal(parseSampleInfo('cypher', 'run'), null);
  assert.equal(parseSampleInfo('javascript', 'run'), null);
  assert.throws(() => parseSampleInfo('js', 'run expect=error'), /takes only `name=<id>`/);
  assert.throws(() => parseSampleInfo('js', 'run name=a.b'), /takes only/);
  assert.throws(() => parseSampleInfo('python', 'run title="app.js"'), /needs the extension \.py/);
  assert.throws(() => parseSampleInfo('js', 'run title="../x.js"'), /takes only/);
});

test('parseSampleInfo: rust, java, go, swift and c run, their extensions, and env= for Python only', () => {
  assert.deepEqual(parseSampleInfo('rust', 'run'), { lang: 'rust', name: null, title: null, env: null });
  assert.deepEqual(parseSampleInfo('java', 'run title="Team.java"'), { lang: 'java', name: null, title: 'Team.java', env: null });
  assert.deepEqual(parseSampleInfo('go', 'run name=team title="main.go"'), { lang: 'go', name: 'team', title: 'main.go', env: null });
  assert.deepEqual(parseSampleInfo('swift', 'run'), { lang: 'swift', name: null, title: null, env: null });
  assert.deepEqual(parseSampleInfo('c', 'run title="team.c"'), { lang: 'c', name: null, title: 'team.c', env: null });
  assert.deepEqual(parseSampleInfo('python', 'run env=crewai'), { lang: 'python', name: null, title: null, env: 'crewai' });
  assert.throws(() => parseSampleInfo('rust', 'run title="main.py"'), /needs the extension \.rs/);
  assert.throws(() => parseSampleInfo('c', 'run title=".c"'), /needs the extension \.c/);
  assert.throws(() => parseSampleInfo('js', 'run title="x.ts"'), /needs the extension \.js, \.cjs or \.mjs/);
  assert.throws(() => parseSampleInfo('go', 'run env=crewai'), /`go run` takes only `name=<id>` \(letters, digits, - and _\) and `title="<file>"`/);
  assert.throws(() => parseSampleInfo('python', 'run env=CrewAI'), /`env=<name>` \(lowercase letters, digits and _\)/);
  assert.equal(parseSampleInfo('kotlin', 'run'), null);
  assert.equal(parseSampleInfo('cpp', 'run'), null);
});

test('sampleFileName: the title, else sample.py, sample.cjs or sample.mjs', () => {
  assert.equal(sampleFileName({ lang: 'python', title: null, code: 'print(1)' }), 'sample.py');
  assert.equal(sampleFileName({ lang: 'python', title: 'app.py', code: '' }), 'app.py');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'const r = require("x");' }), 'sample.cjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'import { Database } from "@relate/relate";' }), 'sample.mjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: 'import relate from "@relate/relate";' }), 'sample.mjs');
  assert.equal(sampleFileName({ lang: 'js', title: null, code: '// imports nothing\nconsole.log(1)' }), 'sample.cjs');
  assert.equal(sampleFileName({ lang: 'rust', title: null, code: '' }), 'main.rs');
  assert.equal(sampleFileName({ lang: 'java', title: null, code: '' }), 'Main.java');
  assert.equal(sampleFileName({ lang: 'go', title: null, code: '' }), 'main.go');
  assert.equal(sampleFileName({ lang: 'swift', title: null, code: '' }), 'main.swift');
  assert.equal(sampleFileName({ lang: 'c', title: null, code: '' }), 'sample.c');
  assert.equal(sampleFileName({ lang: 'c', title: 'team.c', code: '' }), 'team.c');
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
  assert.equal(sampleId({ lang: 'js', name: null }, 3), 'js-3');
  assert.equal(sampleId({ lang: 'js', name: 'x' }, 3), 'x');
  assert.equal(sampleId({ lang: 'swift', name: null }, 1), 'swift-1');
});

test('pageSamples: a named sample counts toward the numbering, like cells', () => {
  const { samples } = pageSamples('```python run name=a\nprint(1)\n```\n\n```python run\nprint(2)\n```\n');
  assert.deepEqual(samples.map((s) => s.id), ['a', 'python-2']);
});

test('pageSamples: each language numbers its own samples', () => {
  const { samples, problems } = pageSamples('```rust run\nfn main() {}\n```\n\n```c run\nint main(void) { return 0; }\n```\n\n```rust run\nfn main() {}\n```\n\n```python run env=crewai\nprint(1)\n```\n');
  assert.deepEqual(problems, []);
  assert.deepEqual(samples.map((s) => [s.id, s.env]), [['rust-1', null], ['c-1', null], ['rust-2', null], ['python-1', 'crewai']]);
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
  assert.notEqual(sampleSourceHash(base), sampleSourceHash({ ...base, env: 'crewai' }));
  assert.equal(sampleSourceHash(base), sampleSourceHash({ ...base, env: null }), 'no env, the hash phase 1 recorded');
  assert.equal(sampleSourceHash(base), createHash('sha256').update('python\n\nprint(1)\nprint(2)').digest('hex'));
  assert.match(sampleSourceHash(base), /^[0-9a-f]{64}$/);
});

test('outputDiff: the changed lines only', () => {
  assert.equal(outputDiff('a\nb\nc', 'a\nB\nc\nd'), '- b\n+ B\n+ d');
});

test('clientEnv: says what is missing', () => {
  const none = clientEnv({});
  assert.equal(none.python, null);
  assert.equal(none.node, null);
  assert.deepEqual(none.missing, {
    python: 'RELATE_PY is not set',
    js: 'RELATE_NODE is not set',
    rust: 'RELATE_CARGO is not set',
    java: 'RELATE_JAVA is not set',
    go: 'RELATE_GO is not set',
    swift: 'RELATE_SWIFT is not set',
    c: 'RELATE_CC is not set',
  });
  const noLib = clientEnv({ RELATE_CC: process.execPath, RELATE_C_INCLUDE: scratch });
  assert.equal(noLib.missing.c, 'RELATE_LIB is not set');
  const noHeader = clientEnv({ RELATE_CC: process.execPath, RELATE_C_INCLUDE: scratch, RELATE_LIB: process.execPath });
  assert.match(noHeader.missing.c!, /holds no relate\.h/);
  const noCp = clientEnv({ RELATE_JAVA: process.execPath, RELATE_LIB: process.execPath, RELATE_JAVA_CLASSPATH: join(scratch, 'absent.jar') });
  assert.match(noCp.missing.java!, /names .*absent\.jar, which does not exist/);
  const noProject = clientEnv({ RELATE_CARGO: process.execPath, RELATE_RUST_PROJECT: scratch });
  assert.match(noProject.missing.rust!, /holds no Cargo\.toml/);
  const pyEnvs = clientEnv({ RELATE_PY_CREWAI: process.execPath, RELATE_PY_GONE: join(scratch, 'nope') });
  assert.deepEqual(pyEnvs.pythonEnvs, { crewai: process.execPath });
  assert.equal(sampleUnavailable({ lang: 'python', env: 'crewai' }, pyEnvs), 'RELATE_PY is not set');
  const withPy = clientEnv({ RELATE_PY: process.execPath });
  assert.match(sampleUnavailable({ lang: 'python', env: 'crewai' }, withPy)!, /^RELATE_PY_CREWAI is not set or does not exist/);
  assert.equal(sampleUnavailable({ lang: 'python', env: null }, withPy), null);
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
  assert.equal(env.missing.python, 'RELATE_PY is not set');
  assert.equal(env.missing.js, undefined);
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

// The C runner against a stub library and header (any C compiler; the test is
// skipped without one): compile, link with -lrelate_ffi, rpath, run in an
// empty directory, and a build failure reported with the compiler's output.
const cc = ['cc', 'clang', 'gcc'].map((c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).stdout.trim()).find(Boolean);
test('runSample: a C sample builds against relate.h and the library, and runs in an empty directory', { skip: cc ? false : 'no C compiler' }, () => {
  const stub = join(scratch, 'cstub');
  mkdirSync(stub, { recursive: true });
  writeFileSync(join(stub, 'relate.h'), 'int relate_abi_version(void);\n');
  writeFileSync(join(stub, 'stub.c'), 'int relate_abi_version(void) { return 2; }\n');
  const lib = join(stub, process.platform === 'darwin' ? 'librelate_ffi.dylib' : 'librelate_ffi.so');
  const built = spawnSync(cc!, ['-shared', '-fPIC', join(stub, 'stub.c'), '-o', lib], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const cenv = clientEnv({ RELATE_CC: cc, RELATE_C_INCLUDE: stub, RELATE_LIB: lib });
  assert.equal(cenv.missing.c, undefined);
  const ok = runSample(
    { lang: 'c', title: 'abi.c', code: '#include <stdio.h>\n#include <dirent.h>\n#include "relate.h"\nint main(void) {\n  int n = 0; DIR *d = opendir("."); struct dirent *e;\n  while ((e = readdir(d))) if (e->d_name[0] != \'.\') n++;\n  printf("abi %d, %d files here\\n", relate_abi_version(), n);\n  return 0;\n}\n' },
    cenv,
  );
  assert.deepEqual(ok, { ok: true, text: 'abi 2, 0 files here', error: null });
  const broken = runSample({ lang: 'c', title: null, code: 'int main(void) { return }\n' }, cenv);
  assert.equal(broken.ok, false);
  assert.match(broken.error!, /^did not build: \w+ exited with 1; its output:\n[\s\S]*sample\.c/);
  const fails = runSample({ lang: 'c', title: null, code: '#include <stdio.h>\nint main(void) { fprintf(stderr, "boom\\n"); return 4; }\n' }, cenv);
  assert.match(fails.error!, /^exited with 4; standard error:\nboom$/);
});

test('VERSION_PROBES: every language has one; the compiled clients ask the engine', () => {
  for (const lang of ['python', 'js', 'rust', 'java', 'go', 'swift', 'c'] as const) assert.ok(VERSION_PROBES[lang].length > 0, lang);
  for (const lang of ['rust', 'java', 'go', 'swift', 'c'] as const) assert.match(VERSION_PROBES[lang], /CALL dbms\.components\(\) YIELD name, versions WHERE name = 'Relate'/);
});

test('checkSamples: records are checked without a client; a language that is not set up is a warning when others are', () => {
  const dir = join(scratch, 'check');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'p.mdx');
  writeFileSync(file, '---\ntitle: T\ndescription: d\n---\n\n```rust run\nfn main() { println!("hi"); }\n```\n\n```c run\nint main(void) { return 0; }\n```\n');
  const { samples } = pageSamples(readFileSync(file, 'utf8'));
  writeSidecar(file, { format: 1, cells: { 'rust-1': sampleEntry('hi', '0.16.1', sampleSourceHash(samples[0])) } });
  const site = { engine: { version: '0.16.1', verified: '0.16.1', date: '2026-11-01' }, published: new Map([['p', { id: 'p', file, data: {} }]]) };
  const got: string[] = [];
  const report = (_f: string, line: number | null, sev: string, _rule: string, msg: string) => got.push(`${sev} ${line}: ${msg}`);
  checkSamples(site, report, clientEnv({}));
  assert.deepEqual(got, [`error 10: sample \`c-1\` has no recorded output in ${relative(ROOT, join(dir, 'p.results.json'))}; set up the clients (scripts/samples/setup.sh) and run npm run docs:samples -- --record`]);
  got.length = 0;
  checkSamples(site, report, clientEnv({ RELATE_NODE: process.execPath, NODE_PATH: fakeModules }));
  assert.equal(got.length, 3);
  assert.match(got[1], /^warning 6: 1 rust sample\(s\) on 1 page\(s\) cannot be replayed in this environment \(RELATE_CARGO is not set\); docs:samples skips them and their records stand$/);
  assert.match(got[2], /^warning 10: 1 c sample\(s\) on 1 page\(s\) cannot be replayed/);
});

test('sampleVerifiers: a compiled language counts once model.ts VERIFIERS names it', () => {
  const page = '```rust run\nfn main() { println!("hi"); }\n```\n';
  const { samples } = pageSamples(page);
  const sidecar: Sidecar = { format: 1, cells: { 'rust-1': sampleEntry('hi', '0.16.1', sampleSourceHash(samples[0])) } };
  assert.deepEqual(sampleVerifiers(page, sidecar, '0.16.1'), (VERIFIERS as readonly string[]).includes('rust') ? ['rust'] : []);
});

test('setup.sh: --out inside this repository or the checkout is refused before anything is created', () => {
  // A stand-in checkout: the two files setup.sh looks for before the --out guard.
  const upstream = join(scratch, 'upstream');
  mkdirSync(join(upstream, 'surfaces', 'relate-ffi'), { recursive: true });
  writeFileSync(join(upstream, 'Cargo.toml'), '');
  const setup = join(ROOT, 'scripts', 'samples', 'setup.sh');
  const cases: [string, string, string][] = [
    // [working directory, --out, the path that must not appear]
    [ROOT, './samples-out-guard', join(ROOT, 'samples-out-guard')],
    [join(ROOT, '..'), `${relative(join(ROOT, '..'), ROOT)}/../${relative(join(ROOT, '..'), ROOT)}/samples-out-guard/x`, join(ROOT, 'samples-out-guard')],
    [scratch, 'upstream/sub/deeper', join(upstream, 'sub')],
  ];
  for (const [cwd, out, created] of cases) {
    const r = spawnSync('bash', [setup, '--upstream', upstream, '--out', out], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 1, `--out ${out} from ${cwd}: exit ${r.status}\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--out must be outside /, `--out ${out}: ${r.stderr}`);
    assert.equal(spawnSync('test', ['-e', created]).status, 1, `--out ${out} created ${created}`);
  }
});

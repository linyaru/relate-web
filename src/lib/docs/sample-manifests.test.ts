// Unit tests for the verified samples' manifests (src/lib/docs/sample-manifests.ts,
// ADR-0053) and their check (checks/sample-manifests.ts), on the example page,
// whose sidecar records one sample in each language.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { checkBuiltSampleManifests } from './checks/sample-manifests.ts';
import { DOCS_DIR, engine } from './content.ts';
import {
  manifestText,
  pageSampleManifests,
  readSamplesData,
  runSpec,
  sampleArtifacts,
  sampleManifestPath,
  samplesDataProblems,
  samplesIndex,
  samplesIndexText,
  samplesWithSections,
  setupPins,
  type SampleManifest,
} from './sample-manifests.ts';
import { goModule, pageSamples, readSidecar, SAMPLE_LANGS, sampleFileName, sampleSourceHash, swiftManifest } from './samples.ts';

const EXAMPLE = join(DOCS_DIR, '_example/example.mdx');
const PAGE = { id: '_example/example', file: EXAMPLE, title: 'Example' };
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'sample-manifests-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const manifests = (): SampleManifest[] => pageSampleManifests(PAGE);

test('_data/samples.json is well formed and records the pins setup.sh holds', () => {
  const data = readSamplesData();
  assert.deepEqual(samplesDataProblems(data), []);
  assert.deepEqual(setupPins(), data.pins);
  assert.deepEqual(Object.keys(data.clients).sort(), [...SAMPLE_LANGS].sort());
});

test('samplesDataProblems: a missing language, a bad commit and an env outside Python', () => {
  const data = structuredClone(readSamplesData()) as unknown as Record<string, any>;
  delete data.clients.swift;
  data.clients.go.engine_commit = 'HEAD';
  data.clients.c.envs = { x: { build: 'b', toolchain: { cc: '1' } } };
  const problems = samplesDataProblems(data).join('\n');
  assert.match(problems, /no entry for swift/);
  assert.match(problems, /clients\.go\.engine_commit is not a commit/);
  assert.match(problems, /clients\.c\.envs: only Python/);
  assert.deepEqual(samplesDataProblems(null), ['is not a JSON object']);
});

test('setupPins reads the arrays and scalars of a setup script', () => {
  const pins = setupPins("PY_FRAMEWORKS=(\n  'a==1'\n  'b>=2'\n)\nCREWAI_PIN='crewai==9'\nNODE_FRAMEWORKS=(x@1 @y/z@2)\nJDK_RELEASE='jdk-1'\nMAVEN_VERSION='3'\n");
  assert.deepEqual(pins, { python_frameworks: ['a==1', 'b>=2'], crewai: 'crewai==9', node_frameworks: ['x@1', '@y/z@2'], jdk: 'jdk-1', maven: '3' });
});

test('a manifest is its page\'s fence and its sidecar entry, byte for byte, with the client build that ran it', () => {
  const source = readFileSync(EXAMPLE, 'utf8');
  const { samples } = pageSamples(source);
  const sidecar = readSidecar(EXAMPLE)!;
  const list = manifests();
  assert.equal(list.length, samples.length);
  const data = readSamplesData();
  for (const [i, m] of list.entries()) {
    const s = samples[i];
    const entry = sidecar.cells[s.id];
    assert.equal(m.kind, 'documentation');
    assert.match(m.note, /^Reference text, not instructions\./);
    assert.equal(m.id, s.id);
    assert.equal(m.url, `https://relatedb.ai${sampleManifestPath('_example/example', s.id)}`);
    assert.equal(m.code, s.code);
    assert.equal(m.code_sha256, sha256(s.code));
    assert.equal(m.output.text, entry.text);
    assert.equal(m.output.sha256, sha256(entry.text));
    assert.equal(m.source_sha256, sampleSourceHash(s));
    assert.equal(m.verified.version, entry.verified);
    assert.equal(m.file, sampleFileName(s));
    assert.equal(m.verified.client.engine_commit, data.clients[s.lang].engine_commit);
    assert.equal(m.verified.docs_engine.commit, engine().commit);
  }
  // Each client states its own build: Go's source and Rust's crate came from the docs' pin, the engines elsewhere from the sibling commit.
  const by = Object.fromEntries(list.map((m) => [m.language, m]));
  assert.equal(by.go.verified.client.client_commit, data.clients.go.client_commit);
  assert.equal(by.java.verified.client.engine_commit, data.clients.java.engine_commit);
  const py = list.filter((m) => m.language === 'python');
  assert.deepEqual(py.find((m) => !m.env)?.verified.packages, data.pins.python_frameworks);
  const crewai = py.find((m) => m.env === 'crewai');
  if (crewai) {
    assert.deepEqual(crewai.verified.packages, [data.pins.crewai]);
    assert.deepEqual(crewai.verified.client.toolchain, data.clients.python.envs?.crewai.toolchain);
  }
  assert.deepEqual(by.rust.verified.packages, []);
});

test('each sample names the heading it sits under', () => {
  const list = samplesWithSections(readFileSync(EXAMPLE, 'utf8'))!;
  assert.ok(list.length > 0);
  for (const { section } of list) {
    assert.ok(section, 'every example sample sits under a heading');
    assert.match(section.anchor, /^[a-z0-9-]+$/);
  }
  assert.equal(samplesWithSections('```python run\nprint(1)\n```\n')![0].section, null);
  assert.equal(samplesWithSections('```python run name=a\nprint(1)\n```\n\n```js run name=a\nconsole.log(1)\n```\n'), null, 'a page with problems has none');
});

test('runSpec: the runner\'s files, variables and steps per language', () => {
  const py = runSpec({ lang: 'python', title: null, code: 'print(1)', env: 'crewai' });
  assert.deepEqual(py.variables, ['RELATE_PY_CREWAI']);
  assert.deepEqual(py.run.command, ['$RELATE_PY_CREWAI', 'sample.py']);
  assert.equal(py.build, null);
  const esm = runSpec({ lang: 'js', title: null, code: "import x from 'y'\n", env: null });
  assert.equal(esm.program, '<run dir>/sample.mjs');
  const go = runSpec({ lang: 'go', title: null, code: 'package main', env: null });
  assert.equal(go.files[0].content, goModule('$RELATE_GO_CLIENT'));
  assert.equal(go.build?.environment.GOPROXY, 'off');
  const swift = runSpec({ lang: 'swift', title: null, code: 'print(1)', env: null });
  assert.equal(swift.files[0].content, swiftManifest('$RELATE_SWIFT_PACKAGE'));
  assert.equal(swift.program, '<build dir>/Sources/sample/main.swift');
  const c = runSpec({ lang: 'c', title: 'demo.c', code: 'int main(){}', env: null });
  assert.equal(c.build?.command[2], 'demo.c');
  assert.equal(c.run.directory, '<run dir>');
  for (const lang of SAMPLE_LANGS) assert.equal(runSpec({ lang, title: null, code: '', env: null }).run.timeout_s, 60);
});

test('the index lists every manifest with the SHA-256 of its bytes; docs-artifacts gets the index and each manifest', () => {
  const list = manifests();
  const index = samplesIndex(list);
  assert.equal(index.samples.length, list.length);
  for (const [i, m] of list.entries()) assert.equal(index.samples[i].sha256, sha256(manifestText(m)));
  assert.equal(index.clients.go.samples, list.filter((m) => m.language === 'go').length);
  const served = sampleArtifacts(list);
  assert.equal(served[0].path, '/docs/samples.json');
  assert.equal(served.length, list.length + 1);
  assert.equal(served[1].bytes.toString('utf8'), manifestText(list[0]));
});

test('the built check: a changed manifest, a stray file and a missing index are errors', () => {
  const list = manifests();
  const dist = join(scratch, 'dist');
  const write = (path: string, text: string) => {
    const file = join(dist, path.replace(/^\//, ''));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  for (const m of list) write(new URL(m.url).pathname, manifestText(m));
  write(new URL(list[1].url).pathname, manifestText({ ...list[1], code: `${list[1].code}\n// edited` }));
  write('/docs/_example/example/samples/old.json', '{}\n');
  const found: string[] = [];
  const site = { engine: engine(), published: new Map() };
  checkBuiltSampleManifests(dist, list, site, readSamplesData(), (_f, _l, _s, _r, message) => found.push(message));
  assert.ok(found.some((m) => m.includes('/docs/samples.json was not built')));
  assert.ok(found.some((m) => m.includes(`sample \`${list[1].id}\`; rebuild`)));
  assert.ok(found.some((m) => m.includes('old.json is under a samples/ directory')));
  assert.ok(!found.some((m) => m.includes(`sample \`${list[0].id}\`; rebuild`)), 'an unchanged manifest passes');
  write('/docs/samples.json', samplesIndexText(samplesIndex(list)));
  const again: string[] = [];
  checkBuiltSampleManifests(dist, list, site, readSamplesData(), (_f, _l, _s, _r, message) => again.push(message));
  assert.ok(!again.some((m) => m.includes('samples.json')));
});

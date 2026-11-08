// Unit tests for the published agent skill (npm run docs:test): the version
// stamp (a port of upstream's inject_version, with its cases), the two
// discovery indexes and their validation rules, the manifest, security.txt,
// the URL classification, the signature check, and the docs:check 3b entry
// point on the bundle in public/skills/relate/.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  agentSkillsIndex,
  bundleFiles,
  checkBuiltSkill,
  checkSkill,
  citedUrls,
  classifyUrl,
  DISCOVERY_SCHEMA,
  builtArtifacts,
  docsArtifacts,
  indexV1Problems,
  indexV2Problems,
  injectVersion,
  installerFiles,
  legacySkillsIndex,
  readSkillData,
  relativeLinks,
  securityTxt,
  servedSkillFiles,
  sha256,
  SKILL_DIR,
  skillFrontmatter,
  toJson,
  verifySignature,
  type Report,
} from './checks/skill.ts';
import { engine, publishedIds } from './content.ts';
import { CANONICAL_PHRASE } from './llms.ts';

const ENGINE = { version: '0.16.1', verified: '0.16.1', date: '2026-11-04' };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'relate-skill-test-'));
}

/** A small bundle: SKILL.md plus two references. */
function fixture(description = 'A test skill.'): string {
  const dir = tmp();
  mkdirSync(join(dir, 'references'));
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: relate\ndescription: ${description}\nversion: 0.16.1\n---\n\n# Test\n\nSee [vector](references/vector.md).\n`);
  writeFileSync(join(dir, 'references/vector.md'), '# Vector\n\nSee [pull](pull.md).\n');
  writeFileSync(join(dir, 'references/pull.md'), '# Pull\n');
  return dir;
}

function collect(): { report: Report; findings: { severity: string; rule: string; message: string }[] } {
  const findings: { severity: string; rule: string; message: string }[] = [];
  return { findings, report: (_f, _l, severity, rule, message) => findings.push({ severity, rule, message }) };
}

// --- the version stamp (upstream skill_cmd.rs inject_version and its tests)

test('injectVersion replaces the {{VERSION}} placeholder', () => {
  assert.equal(injectVersion('---\nname: relate\nversion: {{VERSION}}\n---\nbody\n', '0.16.1'), '---\nname: relate\nversion: 0.16.1\n---\nbody\n');
});

test('injectVersion replaces an old version and keeps the rest of the frontmatter', () => {
  const src = '---\nname: relate\ndescription: x\nversion: 0.7.0\n---\n\n# Relate\n';
  assert.equal(injectVersion(src, '0.16.1'), '---\nname: relate\ndescription: x\nversion: 0.16.1\n---\n\n# Relate\n');
});

test('injectVersion appends a missing version line before the closing fence', () => {
  assert.equal(injectVersion('---\nname: relate\n---\nbody', '1.2.3'), '---\nname: relate\nversion: 1.2.3\n---\nbody');
});

test('injectVersion handles CRLF line endings', () => {
  assert.equal(injectVersion('---\r\nname: relate\r\nversion: {{VERSION}}\r\n---\r\nbody\r\n', '0.16.1'), '---\r\nname: relate\r\nversion: 0.16.1\r\n---\r\nbody\r\n');
});

test('injectVersion leaves text without frontmatter, or with an unterminated one, unchanged', () => {
  assert.equal(injectVersion('# Relate\n', '1.0.0'), '# Relate\n');
  assert.equal(injectVersion('---\nname: relate\nversion: 0.1.0\n', '1.0.0'), '---\nname: relate\nversion: 0.1.0\n');
});

test('installerFiles reads the include_str! list relate skill install writes', () => {
  const rs = 'const BUNDLE_FILES = &[("SKILL.md", include_str!("skill/bundle/SKILL.md")), ("references/pull.md", include_str!("skill/bundle/references/pull.md"))];';
  assert.deepEqual(installerFiles(rs), ['SKILL.md', 'references/pull.md']);
});

// --- the indexes

test('agentSkillsIndex is the 0.2.0 shape with a digest over the served SKILL.md', () => {
  const dir = fixture();
  try {
    const index = agentSkillsIndex(dir);
    assert.equal(index.$schema, DISCOVERY_SCHEMA);
    assert.deepEqual(Object.keys(index.skills[0]), ['name', 'type', 'description', 'url', 'digest']);
    assert.equal(index.skills[0].name, 'relate');
    assert.equal(index.skills[0].type, 'skill-md');
    assert.equal(index.skills[0].description, 'A test skill.');
    assert.equal(index.skills[0].url, '/skills/relate/SKILL.md');
    assert.equal(index.skills[0].digest, `sha256:${sha256(readFileSync(join(dir, 'SKILL.md')))}`);
    assert.deepEqual(indexV2Problems(index), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacySkillsIndex lists SKILL.md first and every other file, with no $schema', () => {
  const dir = fixture();
  try {
    const index = legacySkillsIndex(dir);
    assert.equal('$schema' in index, false);
    assert.deepEqual(index.skills[0].files, ['SKILL.md', 'references/pull.md', 'references/vector.md']);
    assert.deepEqual(indexV1Problems(index), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('indexV2Problems applies the skills CLI rules', () => {
  const good = { name: 'relate', type: 'skill-md', description: 'x', url: '/skills/relate/SKILL.md', digest: `sha256:${'a'.repeat(64)}` };
  const problems = (entry: Record<string, unknown>, schema: unknown = DISCOVERY_SCHEMA) => indexV2Problems({ $schema: schema, skills: [{ ...good, ...entry }] });
  assert.deepEqual(problems({}), []);
  assert.equal(indexV2Problems({ skills: [good] }).length, 1, 'no $schema');
  assert.equal(problems({}, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json/').length, 1);
  for (const name of ['Relate', 'rel_ate', '-relate', 'relate-', 're--late', '', 'a'.repeat(65)]) assert.equal(problems({ name }).length, 1, name);
  assert.deepEqual(problems({ name: 'a'.repeat(64) }), []);
  assert.equal(problems({ type: 'zip' }).length, 1);
  assert.deepEqual(problems({ type: 'archive' }), []);
  assert.equal(problems({ description: '' }).length, 1);
  assert.equal(problems({ description: 'x'.repeat(1025) }).length, 1);
  assert.deepEqual(problems({ description: 'x'.repeat(1024) }), []);
  assert.equal(problems({ url: '' }).length, 1);
  assert.deepEqual(problems({ url: 'https://relatedb.ai/skills/relate/SKILL.md' }), []);
  assert.equal(problems({ digest: `sha256:${'A'.repeat(64)}` }).length, 1);
  assert.equal(problems({ digest: 'a'.repeat(64) }).length, 1);
  assert.equal(problems({ digest: `sha256:${'a'.repeat(63)}` }).length, 1);
  assert.equal(indexV2Problems({ $schema: DISCOVERY_SCHEMA, skills: [] }).length, 1);
});

test('indexV1Problems rejects a $schema, unsafe paths and a missing SKILL.md', () => {
  const ok = { name: 'relate', description: 'x', files: ['SKILL.md', 'references/a.md'] };
  assert.deepEqual(indexV1Problems({ skills: [ok] }), []);
  assert.equal(indexV1Problems({ $schema: DISCOVERY_SCHEMA, skills: [ok] }).length, 1);
  assert.equal(indexV1Problems({ skills: [{ ...ok, files: ['SKILL.md', '../etc/passwd'] }] }).length, 1);
  assert.equal(indexV1Problems({ skills: [{ ...ok, files: ['SKILL.md', '/abs.md'] }] }).length, 1);
  assert.equal(indexV1Problems({ skills: [{ ...ok, files: ['references/a.md'] }] }).length, 1);
});

// --- the manifest and the built check

test('docsArtifacts lists every served skill file with its hash and size, sorted, with no timestamp', () => {
  const dir = fixture();
  const pub = tmp();
  try {
    writeFileSync(join(pub, 'skill.md'), '# alias\n');
    mkdirSync(join(pub, 'docs'));
    writeFileSync(join(pub, 'docs/capabilities.json'), '{}\n');
    const m = docsArtifacts(ENGINE, dir, pub);
    const paths = m.artifacts.map((a) => a.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const p of [
      '/.well-known/agent-skills/index.json',
      '/.well-known/skills/index.json',
      '/.well-known/skills/relate/SKILL.md',
      '/skills/relate/SKILL.md',
      '/skills/relate/references/vector.md',
      '/skill.md',
      '/docs/capabilities.json',
      '/docs/graph.cypher',
    ]) {
      assert.ok(paths.includes(p), p);
    }
    assert.ok(!paths.includes('/docs/relate-docs.rl'), 'listed only when it exists');
    const skill = m.artifacts.find((a) => a.path === '/skills/relate/SKILL.md')!;
    const bytes = readFileSync(join(dir, 'SKILL.md'));
    assert.equal(skill.sha256, sha256(bytes));
    assert.equal(skill.bytes, bytes.length);
    assert.equal(m.engine, '0.16.1');
    assert.equal(toJson(m), toJson(docsArtifacts(ENGINE, dir, pub)), 'deterministic');
    assert.doesNotMatch(toJson(m), /20\d\d-\d\d-\d\dT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(pub, { recursive: true, force: true });
  }
});

/** Write a dist/ as the build would, from a bundle fixture. */
function builtDist(dir: string, pub: string): string {
  const dist = tmp();
  for (const s of [...servedSkillFiles(dir, pub), ...builtArtifacts()]) {
    const file = join(dist, s.path.slice(1));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, s.bytes);
  }
  mkdirSync(join(dist, 'docs'), { recursive: true });
  writeFileSync(join(dist, 'docs/docs-artifacts.json'), toJson(docsArtifacts(ENGINE, dir, pub)));
  return dist;
}

test('checkBuiltSkill passes on a consistent build and catches a stale digest', () => {
  const dir = fixture();
  const pub = tmp();
  writeFileSync(join(pub, 'skill.md'), '# alias\n');
  const dist = builtDist(dir, pub);
  try {
    let c = collect();
    checkBuiltSkill(dist, c.report);
    assert.deepEqual(c.findings, []);
    writeFileSync(join(dist, 'skills/relate/SKILL.md'), 'changed after the index was built\n');
    c = collect();
    checkBuiltSkill(dist, c.report);
    const rules = c.findings.map((f) => f.rule);
    assert.ok(rules.includes('skill-index'), 'the 0.2.0 digest no longer matches');
    assert.ok(rules.includes('skill-manifest'), 'the manifest hash no longer matches');
  } finally {
    for (const d of [dir, pub, dist]) rmSync(d, { recursive: true, force: true });
  }
});

test('checkBuiltSkill checks an expired security.txt', () => {
  const dir = fixture();
  const pub = tmp();
  writeFileSync(join(pub, 'skill.md'), '# alias\n');
  const dist = builtDist(dir, pub);
  try {
    writeFileSync(join(dist, '.well-known/security.txt'), 'Contact: mailto:a@example.com\nExpires: 2020-01-01T00:00:00Z\n');
    const c = collect();
    checkBuiltSkill(dist, c.report);
    assert.deepEqual(c.findings.map((f) => f.rule), ['security-txt']);
  } finally {
    for (const d of [dir, pub, dist]) rmSync(d, { recursive: true, force: true });
  }
});

// --- security.txt

test('securityTxt is null without a contact', () => {
  assert.equal(securityTxt(new Date('2026-11-07T12:00:00Z'), null, true), null);
});

test('securityTxt has the RFC 9116 fields whose values exist', () => {
  const t = securityTxt(new Date('2026-11-07T12:00:00Z'), 'mailto:security@example.com', false)!;
  assert.equal(
    t,
    'Contact: mailto:security@example.com\nExpires: 2027-11-07T00:00:00Z\nPreferred-Languages: en\nCanonical: https://relatedb.ai/.well-known/security.txt\n',
  );
  assert.match(securityTxt(new Date('2026-11-07T12:00:00Z'), 'mailto:security@example.com', true)!, /^Policy: https:\/\/relatedb\.ai\/docs\/reference\/security\/$/m);
});

// --- URLs and links in the bundle

test('citedUrls and classifyUrl sort the bundle URLs', () => {
  const urls = citedUrls('`curl -sSfL https://relatedb.ai/install.sh | bash`\n(e.g. `https://host:7473`); see https://github.com/relatedb/relate.\n').map((u) => u.url);
  assert.deepEqual(urls, ['https://relatedb.ai/install.sh', 'https://host:7473', 'https://github.com/relatedb/relate']);
  assert.equal(classifyUrl('https://relatedb.ai/install.sh'), 'site');
  assert.equal(classifyUrl('https://github.com/relatedb/relate'), 'upstream');
  assert.equal(classifyUrl('http://host:7474'), 'example');
  assert.equal(classifyUrl('http://127.0.0.1:9/x'), 'example');
  assert.equal(classifyUrl('https://neo4j.com/docs/ontology-graph-spec/1.1.0/schema.json'), 'third-party');
});

test('relativeLinks finds bundle-relative links outside code', () => {
  const text = 'See [vector](references/vector.md) and [docs](https://relatedb.ai/docs/).\n`[x](not/a/link.md)`\n```\n[y](in/fence.md)\n```\n';
  assert.deepEqual(relativeLinks(text), [{ href: 'references/vector.md', line: 1 }]);
});

// --- signatures

test('verifySignature accepts a signature by the given key and rejects another key', { skip: spawnSync('ssh-keygen', ['-?']).error ? 'no ssh-keygen' : false }, () => {
  const dir = tmp();
  try {
    const key = join(dir, 'key');
    assert.equal(spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'test', '-f', key]).status, 0);
    const file = join(dir, 'docs-artifacts.json');
    writeFileSync(file, '{"format":1}\n');
    assert.equal(spawnSync('ssh-keygen', ['-Y', 'sign', '-f', key, '-n', 'relate-release', file]).status, 0);
    const sig = readFileSync(`${file}.sig`, 'utf8');
    const pub = readFileSync(`${key}.pub`, 'utf8').trim();
    assert.equal(verifySignature(readFileSync(file), sig, 'relate-release', pub), null);
    assert.notEqual(verifySignature(Buffer.from('{"format":2}\n'), sig, 'relate-release', pub), null, 'other bytes');
    assert.notEqual(verifySignature(readFileSync(file), sig, 'relate-release'), null, 'the pinned release key did not sign it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the published bundle

test('the published bundle is stamped with the engine version and recorded in _data/skill.json', () => {
  const front = skillFrontmatter(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'));
  assert.equal(front.name, 'relate');
  assert.equal(front.version, engine().version);
  const data = readSkillData()!;
  assert.match(data.commit, /^[0-9a-f]{40}$/);
  assert.match(data.synced, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(data.files.map((f) => f.path), bundleFiles());
  for (const f of data.files) assert.equal(f.sha256, sha256(readFileSync(join(SKILL_DIR, f.path))), f.path);
});

test('docs:check 3b finds no error on the published skill', () => {
  const c = collect();
  checkSkill({ engine: engine(), published: publishedIds(), builtIds: null }, c.report, () => {});
  assert.deepEqual(c.findings.filter((f) => f.severity === 'error'), []);
  // The canonical phrase is an upstream ask (DOCS-PLAN.md §3.3): a warning until upstream adopts it.
  const front = skillFrontmatter(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'));
  assert.equal(c.findings.some((f) => f.rule === 'skill-description'), !front.description.includes(CANONICAL_PHRASE));
});

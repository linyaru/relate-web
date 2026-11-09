// npm run skill:sync — copy upstream's agent skill bundle onto the site
// (DOCS-PLAN.md §3.3, decision 10 in §11, ADR-0013).
//
// Reads `surfaces/relate-cli/src/skill/bundle/` (SKILL.md and references/)
// from the upstream checkout (RELATE_UPSTREAM, else `../relate` beside this
// repo, or `--upstream <dir>`) and writes it to public/skills/relate/
// unchanged, except SKILL.md's frontmatter `version:` line, which gets
// src/content/docs/_data/engine.json's version, stamped the way
// `relate skill install` stamps the binary's (`inject_version`). Files no
// longer upstream are removed. Then writes src/content/docs/_data/skill.json:
// the upstream commit, the sync date and the SHA-256 of every served file.
//
// Read-only on the upstream checkout: it runs `git rev-parse`, `git ls-tree`
// and `git show` only, and refuses a bundle whose working tree differs from
// HEAD, so the recorded commit is the one the bytes came from. Run it in the
// same change that refreshes public/wasm/, then review `git diff -- public/skills`
// before committing (ADR-0013 decision 2). `npm run docs:check` verifies the
// result (src/lib/docs/checks/skill.ts).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { engine as readEngine, ROOT } from '../src/lib/docs/content.ts';
import {
  bundleFiles,
  installerFiles,
  readSkillData,
  servedBytes,
  sha256,
  SKILL_DATA_FILE,
  SKILL_DIR,
  skillFrontmatter,
  toJson,
  UPSTREAM_BUNDLE,
  UPSTREAM_INSTALLER,
  upstreamDir,
  upstreamFiles,
  type SkillData,
} from '../src/lib/docs/checks/skill.ts';

const { values: args } = parseArgs({ options: { upstream: { type: 'string' } } });
const upstream = args.upstream ?? upstreamDir();

function fail(message: string): never {
  console.error(`skill:sync: ${message}`);
  process.exit(1);
}

function git(argv: string[]): Buffer {
  const r = spawnSync('git', ['-C', upstream, ...argv], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fail(`git ${argv.join(' ')} failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

if (!existsSync(join(upstream, UPSTREAM_BUNDLE, 'SKILL.md'))) {
  fail(`no skill bundle at ${join(upstream, UPSTREAM_BUNDLE)}; set RELATE_UPSTREAM or pass --upstream <checkout>`);
}

const commit = git(['rev-parse', 'HEAD']).toString().trim();
const listed = upstreamFiles(upstream, commit);
if (!listed?.length) fail(`git ls-tree found no files under ${UPSTREAM_BUNDLE} at ${commit}`);
const bundleRoot = join(upstream, UPSTREAM_BUNDLE);

// The working tree must be HEAD's bundle, byte for byte, with nothing untracked.
const onDisk = bundleFiles(bundleRoot);
const dirty = [
  ...listed.filter((f) => !onDisk.includes(f)).map((f) => `deleted: ${f}`),
  ...onDisk.filter((f) => !listed.includes(f)).map((f) => `untracked: ${f}`),
  ...listed
    .filter((f) => onDisk.includes(f) && !git(['show', `${commit}:${UPSTREAM_BUNDLE}/${f}`]).equals(readFileSync(join(bundleRoot, f))))
    .map((f) => `modified: ${f}`),
];
if (dirty.length) fail(`the upstream bundle differs from HEAD (${commit.slice(0, 12)}); commit or discard first:\n  ${dirty.join('\n  ')}`);

const installer = installerFiles(git(['show', `${commit}:${UPSTREAM_INSTALLER}`]).toString());
const notInstalled = listed.filter((f) => !installer.includes(f));
const notInBundle = installer.filter((f) => !listed.includes(f));
if (notInstalled.length || notInBundle.length) {
  console.warn(
    `skill:sync: warning: ${UPSTREAM_INSTALLER} installs a different set from the bundle directory` +
      `${notInstalled.length ? `; not installed: ${notInstalled.join(', ')}` : ''}${notInBundle.length ? `; not in the directory: ${notInBundle.join(', ')}` : ''}`,
  );
}

const version = readEngine().version;
const before = readSkillData();
const files: SkillData['files'] = [];
rmSync(SKILL_DIR, { recursive: true, force: true });
for (const f of [...listed].sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a < b ? -1 : 1))) {
  const raw = git(['show', `${commit}:${UPSTREAM_BUNDLE}/${f}`]);
  const out = servedBytes(f, raw, version);
  const dest = join(SKILL_DIR, f);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  files.push({ path: f, sha256: sha256(out), ...(f === 'SKILL.md' ? { upstream_sha256: sha256(raw) } : {}) });
}

const front = skillFrontmatter(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'));
if (front.version !== version) fail(`SKILL.md has no frontmatter to stamp; its version reads "${front.version}"`);

// Keep the sync date when nothing changed, so a re-run is a no-op.
const unchanged = before?.commit === commit && before.version === version && JSON.stringify(before.files) === JSON.stringify(files);
const data: SkillData = {
  source: UPSTREAM_BUNDLE,
  commit,
  synced: unchanged ? before.synced : new Date().toISOString().slice(0, 10),
  version,
  files,
  ...(before?.task_skills ? { task_skills: before.task_skills } : {}),
};
writeFileSync(SKILL_DATA_FILE, toJson(data));

console.log(
  `skill:sync: ${files.length} file(s) from upstream ${commit.slice(0, 12)} into ${relative(ROOT, SKILL_DIR)}/ (version ${version})` +
    `${unchanged ? '; no change' : `; review \`git diff -- public/skills ${relative(ROOT, SKILL_DATA_FILE)}\` before committing`}`,
);

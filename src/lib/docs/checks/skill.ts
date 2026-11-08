// The agent skill as the site publishes it (DOCS-PLAN.md §3.3, §3.9, §9;
// ADR-0013 decisions 2 and 3; decision 10 in §11), and its check (§8 item 3b).
//
// The bundle is upstream's `surfaces/relate-cli/src/skill/bundle/` (SKILL.md
// and references/), copied into public/skills/relate/ by
// `npm run skill:sync` (scripts/skill-sync.ts) unchanged except SKILL.md's
// frontmatter `version:` line, which gets _data/engine.json's version the way
// `relate skill install` stamps the binary's (`inject_version` in upstream's
// skill_cmd.rs). _data/skill.json records the upstream commit, the sync date
// and the SHA-256 of every served file. Everything else the site serves about
// the skill is generated at build time from those served bytes, so a digest
// cannot drift from the file it names:
//
//   /.well-known/agent-skills/index.json   the discovery index, format 0.2.0
//                                          (one `skill-md` entry, a sha256 digest)
//   /.well-known/skills/index.json         the legacy 0.1.0 index (skills[].files[])
//   /.well-known/skills/relate/<file>      the files the legacy index names
//   /docs/docs-artifacts.json              the manifest of agent artifacts (these,
//                                          and the docs graph's seed script) with
//                                          their SHA-256 and sizes; its `.sig`
//                                          is made with the release key at launch
//   /.well-known/security.txt              RFC 9116; built only once
//                                          _data/project.json names a contact
//
// The endpoints under src/pages/ call the builders below; `checkSkill` is the
// docs:check entry point. Node only (the build and the checks), never shipped
// to the browser.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';

import { SIGNER, SIGNING_KEY } from '../../../components/docs/install.ts';
import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { DOCS_DIR, pageFiles, ROOT, splitFrontmatter, type Engine } from '../content.ts';
import { docsGraph, seedScript } from '../graph.ts';
import { docsIdOf } from '../links.ts';
import { CANONICAL_PHRASE } from '../llms.ts';

// ---------------------------------------------------------------------------
// Where things are

/** The skill's name: the bundle directory, the frontmatter `name:` and the index entry. */
export const SKILL_NAME = 'relate';
export const PUBLIC_DIR = join(ROOT, 'public');
/** The served bundle (public/skills/relate/). */
export const SKILL_DIR = join(PUBLIC_DIR, 'skills', SKILL_NAME);
/** The bundle's URL path on the site. */
export const SKILL_PATH = `/skills/${SKILL_NAME}/`;
/** The short alias (a static file in public/). */
export const ALIAS_PATH = '/skill.md';
/** What `npm run skill:sync` records. */
export const SKILL_DATA_FILE = join(DOCS_DIR, '_data/skill.json');
/** The bundle's directory in the upstream checkout. */
export const UPSTREAM_BUNDLE = 'surfaces/relate-cli/src/skill/bundle';
/** The upstream file whose `include_str!` list is what `relate skill install` writes. */
export const UPSTREAM_INSTALLER = 'surfaces/relate-cli/src/skill_cmd.rs';

/** The discovery index, format 0.2.0 (DOCS-PLAN.md §9). */
export const AGENT_SKILLS_INDEX_PATH = '/.well-known/agent-skills/index.json';
/** The legacy 0.1.0 index; its files are fetched from LEGACY_SKILL_PATH. */
export const LEGACY_INDEX_PATH = '/.well-known/skills/index.json';
export const LEGACY_SKILL_PATH = `/.well-known/skills/${SKILL_NAME}/`;
/** The `$schema` the skills CLI recognizes for 0.2.0, character for character. */
export const DISCOVERY_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

export const MANIFEST_PATH = '/docs/docs-artifacts.json';
/** The manifest's signature, made with the release key at launch (LAUNCH.md). */
export const MANIFEST_SIG_FILE = join(PUBLIC_DIR, 'docs/docs-artifacts.json.sig');
/** The SSH signature namespace the manifest is signed under (the release key's, as install.sh verifies SHA256SUMS). */
export const MANIFEST_SIG_NAMESPACE = 'relate-release';
/** Agent artifacts listed in the manifest when the build finds them under public/ (DOCS-PLAN.md §3.5, §3.8). */
export const OPTIONAL_ARTIFACTS = ['/docs/relate-docs.rl', '/docs/capabilities.json'];

export const SECURITY_TXT_PATH = '/.well-known/security.txt';
/** Holds `security.contact` (a `mailto:` or `https:` URI) once one exists; until then no security.txt is built. */
export const PROJECT_FILE = join(DOCS_DIR, '_data/project.json');
/** The page security.txt's `Policy` names (a phase 1 page). */
export const SECURITY_POLICY_PAGE = 'reference/security';

/** The upstream checkout: RELATE_UPSTREAM, else a `relate` checkout beside this repo. */
export const upstreamDir = () => process.env.RELATE_UPSTREAM ?? join(ROOT, '..', 'relate');

// ---------------------------------------------------------------------------
// Bytes

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/**
 * SKILL.md with its frontmatter `version:` line set to `version`, or the line
 * appended before the closing fence when absent; text with no frontmatter is
 * returned unchanged. A port of upstream's `inject_version`
 * (surfaces/relate-cli/src/skill_cmd.rs), LF and CRLF alike, so the served
 * SKILL.md is byte-identical to what `relate skill install` writes.
 */
export function injectVersion(contents: string, version: string): string {
  const eol = contents.startsWith('---\n') ? '\n' : contents.startsWith('---\r\n') ? '\r\n' : null;
  if (!eol) return contents;
  const body = contents.slice(3 + eol.length);
  const close = body.indexOf(`${eol}---`);
  if (close < 0) return contents;
  const inner = body.slice(0, close);
  const line = `version: ${version}`;
  let next: string;
  const start = inner.indexOf('version:');
  if (start >= 0) {
    const rest = inner.slice(start);
    const end = rest.indexOf(eol) >= 0 ? start + rest.indexOf(eol) : inner.length;
    next = `${inner.slice(0, start)}${line}${inner.slice(end)}`;
  } else {
    const trimmed = inner.replace(/[\r\n]+$/, '');
    next = trimmed ? `${trimmed}${eol}${line}` : line;
  }
  return `---${eol}${next}${body.slice(close)}`;
}

/** The served bytes of an upstream bundle file: SKILL.md stamped, the rest verbatim (upstream's `bundle_file_bytes`). */
export function servedBytes(rel: string, upstream: Buffer, version: string): Buffer {
  return rel === 'SKILL.md' ? Buffer.from(injectVersion(upstream.toString('utf8'), version), 'utf8') : upstream;
}

/** The bundle's files, relative and `/`-separated: SKILL.md first, then the rest sorted. */
export function bundleFiles(dir = SKILL_DIR): string[] {
  const out: string[] = [];
  const walk = (sub: string) => {
    const abs = sub ? join(dir, sub) : dir;
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.isFile() && e.name !== '.DS_Store') out.push(rel);
    }
  };
  walk('');
  return out.sort((a, b) => (a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
}

/** SKILL.md's frontmatter fields, as a YAML reader (and the skills CLI) sees them. */
export function skillFrontmatter(text: string): SkillFrontmatter {
  const { data } = splitFrontmatter(text, 'SKILL.md');
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  return { name: str(data.name), description: str(data.description), version: str(data.version) };
}

// ---------------------------------------------------------------------------
// The indexes

export interface IndexEntryV2 {
  name: string;
  type: 'skill-md' | 'archive';
  description: string;
  url: string;
  digest: string;
}

export interface IndexV2 {
  $schema: string;
  skills: IndexEntryV2[];
}

export interface IndexV1 {
  skills: { name: string; description: string; files: string[] }[];
}

/** JSON as the endpoints serve it. */
export const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * /.well-known/agent-skills/index.json, from the served SKILL.md: one
 * `skill-md` entry whose digest is over the bytes at its `url`. The `url` is
 * relative to the index (resolved against the index URL), so the same index
 * works on the preview host and on relatedb.ai.
 */
export function agentSkillsIndex(dir = SKILL_DIR): IndexV2 {
  const bytes = readFileSync(join(dir, 'SKILL.md'));
  const front = skillFrontmatter(bytes.toString('utf8'));
  return {
    $schema: DISCOVERY_SCHEMA,
    skills: [{ name: SKILL_NAME, type: 'skill-md', description: front.description, url: `${SKILL_PATH}SKILL.md`, digest: `sha256:${sha256(bytes)}` }],
  };
}

/** /.well-known/skills/index.json, the 0.1.0 shape: every bundle file, fetched from /.well-known/skills/relate/<file>. */
export function legacySkillsIndex(dir = SKILL_DIR): IndexV1 {
  const front = skillFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  return { skills: [{ name: SKILL_NAME, description: front.description, files: bundleFiles(dir) }] };
}

/** A skill name the discovery format accepts (the skills CLI's `isValidSkillName`). */
export const validSkillName = (name: unknown) =>
  typeof name === 'string' && name.length >= 1 && name.length <= 64 && /^[a-z0-9-]+$/.test(name) && !name.startsWith('-') && !name.endsWith('-') && !name.includes('--');

/**
 * What is wrong with a 0.2.0 index, by the rules the skills CLI applies
 * (DOCS-PLAN.md §9): `$schema` exactly the 0.2.0 URL; per entry a valid
 * `name`, `type` `skill-md` or `archive`, a non-empty `description` of at most
 * 1024 characters, a `url` that parses relative to the index, and a digest of
 * `sha256:` plus 64 lowercase hex. The CLI skips an invalid entry and rejects
 * an index with none left; here every invalid entry is a problem.
 */
export function indexV2Problems(index: unknown): string[] {
  const out: string[] = [];
  if (!index || typeof index !== 'object') return ['the index is not a JSON object'];
  const o = index as Record<string, unknown>;
  if (o.$schema !== DISCOVERY_SCHEMA) out.push(`$schema is ${JSON.stringify(o.$schema)}, not "${DISCOVERY_SCHEMA}"`);
  if (!Array.isArray(o.skills) || !o.skills.length) return [...out, '`skills` is not a non-empty array'];
  o.skills.forEach((entry, i) => {
    const at = `skills[${i}]`;
    if (!entry || typeof entry !== 'object') return void out.push(`${at} is not an object`);
    const e = entry as Record<string, unknown>;
    if (!validSkillName(e.name)) out.push(`${at}.name ${JSON.stringify(e.name)} is not 1 to 64 characters of [a-z0-9-] without a leading, trailing or doubled hyphen`);
    if (e.type !== 'skill-md' && e.type !== 'archive') out.push(`${at}.type ${JSON.stringify(e.type)} is not "skill-md" or "archive"`);
    if (typeof e.description !== 'string' || !e.description) out.push(`${at}.description is empty`);
    else if (e.description.length > 1024) out.push(`${at}.description is ${e.description.length} characters; at most 1024`);
    if (typeof e.url !== 'string' || !e.url) out.push(`${at}.url is empty`);
    else {
      try {
        new URL(e.url, `${CANONICAL_ORIGIN}${AGENT_SKILLS_INDEX_PATH}`);
      } catch {
        out.push(`${at}.url ${JSON.stringify(e.url)} does not parse`);
      }
    }
    if (typeof e.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(e.digest)) out.push(`${at}.digest ${JSON.stringify(e.digest)} is not sha256: plus 64 lowercase hex`);
  });
  return out;
}

/** What is wrong with a legacy 0.1.0 index (no `$schema`; each entry's `files` are safe relative paths and include SKILL.md). */
export function indexV1Problems(index: unknown): string[] {
  const out: string[] = [];
  if (!index || typeof index !== 'object') return ['the index is not a JSON object'];
  const o = index as Record<string, unknown>;
  if (o.$schema !== undefined) out.push('a legacy index has no $schema (one makes the skills CLI read it as another format)');
  if (!Array.isArray(o.skills) || !o.skills.length) return [...out, '`skills` is not a non-empty array'];
  o.skills.forEach((entry, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const at = `skills[${i}]`;
    if (!validSkillName(e.name)) out.push(`${at}.name ${JSON.stringify(e.name)} is not a valid skill name`);
    if (typeof e.description !== 'string' || !e.description) out.push(`${at}.description is empty`);
    if (!Array.isArray(e.files) || !e.files.length) return void out.push(`${at}.files is not a non-empty array`);
    for (const f of e.files) {
      if (typeof f !== 'string' || !f || f.startsWith('/') || f.startsWith('\\') || f.includes('..') || f.includes('\0')) out.push(`${at}.files has an unsafe path ${JSON.stringify(f)}`);
    }
    if (!e.files.some((f) => typeof f === 'string' && f.toLowerCase() === 'skill.md')) out.push(`${at}.files does not name SKILL.md`);
  });
  return out;
}

// ---------------------------------------------------------------------------
// The served set and the manifest

export interface Served {
  /** The URL path on the site. */
  path: string;
  bytes: Buffer;
}

/**
 * Every skill and discovery file the site serves, with the bytes the build
 * writes: the two indexes, the bundle under /skills/relate/ and again under
 * /.well-known/skills/relate/ (where the legacy index's files are fetched), and
 * the /skill.md alias.
 */
export function servedSkillFiles(dir = SKILL_DIR, publicDir = PUBLIC_DIR): Served[] {
  const files = bundleFiles(dir).map((rel) => ({ rel, bytes: readFileSync(join(dir, rel)) }));
  const out: Served[] = [
    { path: AGENT_SKILLS_INDEX_PATH, bytes: Buffer.from(toJson(agentSkillsIndex(dir))) },
    { path: LEGACY_INDEX_PATH, bytes: Buffer.from(toJson(legacySkillsIndex(dir))) },
    ...files.map((f) => ({ path: `${SKILL_PATH}${f.rel}`, bytes: f.bytes })),
    ...files.map((f) => ({ path: `${LEGACY_SKILL_PATH}${f.rel}`, bytes: f.bytes })),
  ];
  const alias = join(publicDir, ALIAS_PATH.slice(1));
  if (existsSync(alias)) out.push({ path: ALIAS_PATH, bytes: readFileSync(alias) });
  return out;
}

export interface Manifest {
  format: 1;
  origin: string;
  /** The relate version the skill and the docs are stamped with (_data/engine.json). */
  engine: string;
  /** The upstream commit the skill bundle was copied from (_data/skill.json). */
  skill_commit: string | null;
  artifacts: { path: string; sha256: string; bytes: number }[];
}

/** The upstream commit recorded by `npm run skill:sync`, or null before the first sync. */
export function recordedCommit(): string | null {
  const data = readSkillData();
  return data?.commit ?? null;
}

/** The graph's seed script path: the docs-graph artifact the hosted MCP's Worker replays (ADR-0015). */
export const GRAPH_SEED_PATH = '/docs/graph.cypher';

/**
 * Artifacts the build generates rather than copies from public/: the docs
 * graph's seed script, byte for byte what src/pages/docs/graph.cypher.ts
 * serves (the seed is deterministic, src/lib/docs/graph.ts).
 */
export function builtArtifacts(): Served[] {
  return [{ path: GRAPH_SEED_PATH, bytes: Buffer.from(seedScript(docsGraph())) }];
}

/**
 * /docs/docs-artifacts.json: every agent artifact with its SHA-256 and size,
 * sorted by path, with no timestamp, so the same content always gives the same
 * bytes and the release key's signature over them stays valid until the
 * content changes. It does not name its signature (`<manifest>.sig` beside
 * it, ADR-0019): a field that changed when the signature appeared would
 * change the signed bytes, and one present before would point at a 404.
 */
export function docsArtifacts(engine: Engine, dir = SKILL_DIR, publicDir = PUBLIC_DIR, built: Served[] = builtArtifacts()): Manifest {
  const served = [...servedSkillFiles(dir, publicDir), ...built];
  for (const path of OPTIONAL_ARTIFACTS) {
    const file = join(publicDir, path.slice(1));
    if (existsSync(file)) served.push({ path, bytes: readFileSync(file) });
  }
  return {
    format: 1,
    origin: CANONICAL_ORIGIN,
    engine: engine.version,
    skill_commit: recordedCommit(),
    artifacts: served
      .map((s) => ({ path: s.path, sha256: sha256(s.bytes), bytes: s.bytes.length }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

/**
 * Verify an SSH signature over `bytes` against the pinned release key with
 * `ssh-keygen -Y verify` (the command install.sh runs on SHA256SUMS). Returns
 * null when it verifies, else what went wrong.
 */
export function verifySignature(bytes: Uint8Array, signature: string, namespace = MANIFEST_SIG_NAMESPACE, key = SIGNING_KEY): string | null {
  const tmp = mkdtempSync(join(tmpdir(), 'relate-sig-'));
  try {
    writeFileSync(join(tmp, 'allowed_signers'), `${SIGNER} ${key}\n`);
    writeFileSync(join(tmp, 'file.sig'), signature);
    const r = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', join(tmp, 'allowed_signers'), '-I', SIGNER, '-n', namespace, '-s', join(tmp, 'file.sig')], { input: bytes, encoding: 'utf8' });
    if (r.error) return `ssh-keygen did not run: ${r.error.message}`;
    return r.status === 0 ? null : (r.stderr || r.stdout || `ssh-keygen exited ${r.status}`).trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// security.txt

/** The security contact from _data/project.json (`{"security": {"contact": "mailto:…"}}`), or null. */
export function securityContact(file = PROJECT_FILE): string | null {
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8')) as { security?: { contact?: unknown } };
  const c = data.security?.contact;
  return typeof c === 'string' && /^(?:mailto:|https:\/\/)\S+$/.test(c) ? c : null;
}

/** Whether a docs page is published (exists and is not `status: planned`). */
const published = (id: string) => pageFiles().some((p) => p.id === id && p.data.status !== 'planned');

/**
 * /.well-known/security.txt (RFC 9116) with only the fields whose values
 * exist: Contact (required by the RFC, so no file without it), Expires one
 * year after `now`'s date, Preferred-Languages, Canonical, and Policy once
 * reference/security is published. Null when there is no contact.
 */
export function securityTxt(now: Date, contact = securityContact(), policyPublished = published(SECURITY_POLICY_PAGE)): string | null {
  if (!contact) return null;
  const expires = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
  const lines = [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    'Preferred-Languages: en',
    `Canonical: ${CANONICAL_ORIGIN}${SECURITY_TXT_PATH}`,
  ];
  if (policyPublished) lines.push(`Policy: ${CANONICAL_ORIGIN}/docs/${SECURITY_POLICY_PAGE}/`);
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// _data/skill.json

export interface SkillData {
  /** The upstream directory the bundle comes from. */
  source: string;
  /** The upstream commit (`git rev-parse HEAD` at sync time). */
  commit: string;
  /** The day the bundle was last synced, YYYY-MM-DD. */
  synced: string;
  /** The version stamped into SKILL.md (_data/engine.json's at sync time). */
  version: string;
  /** Every served file: its SHA-256 as served, and for SKILL.md the upstream bytes' too. */
  files: { path: string; sha256: string; upstream_sha256?: string }[];
}

export function readSkillData(file = SKILL_DATA_FILE): SkillData | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as SkillData;
}

// ---------------------------------------------------------------------------
// URLs the bundle cites

export type UrlVerdict = 'site' | 'upstream' | 'example' | 'third-party';

/**
 * Hosts outside the site and upstream that the bundle names on purpose, each
 * reviewed: a third-party URL not listed here is a warning, so a refresh that
 * adds one shows up for review (ADR-0013 decision 2).
 */
export const THIRD_PARTY_URLS: { prefix: string; why: string }[] = [
  { prefix: 'https://neo4j.com/docs/ontology-graph-spec/', why: 'the exact schema URI db.ontology.set accepts (an identifier, quoted in operations.md)' },
  { prefix: 'https://demo.neo4jlabs.com', why: "the hosted Neo4j demo pull.md names as a source" },
];

/** Every http(s) URL in `text`, with its line, trailing punctuation trimmed. */
export function citedUrls(text: string): { url: string; line: number }[] {
  const out: { url: string; line: number }[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/\bhttps?:\/\/[^\s)`"'<>\]]+/g)) out.push({ url: m[0].replace(/[.,;:]+$/, ''), line: i + 1 });
  });
  return out;
}

export function classifyUrl(url: string): UrlVerdict {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'example';
  }
  if (u.hostname === 'relatedb.ai' || u.hostname === 'www.relatedb.ai') return 'site';
  if (u.hostname === 'github.com' && /^\/relatedb\//.test(u.pathname)) return 'upstream';
  // A placeholder host (`host`, `<host>`, `localhost`, an IP) is an example in prose, not a link.
  if (!u.hostname.includes('.') || /^[\d.]+$/.test(u.hostname)) return 'example';
  return 'third-party';
}

/** Relative markdown links (`[x](references/vector.md)`) in a bundle file, with their line. */
export function relativeLinks(text: string): { href: string; line: number }[] {
  const out: { href: string; line: number }[] = [];
  let inFence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) return;
    for (const m of l.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!/^[a-z][a-z0-9+.-]*:|^#|^\//i.test(m[1])) out.push({ href: m[1], line: i + 1 });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// The check (docs:check 3b)

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** The part of scripts/docs.ts's Site this check reads. */
export interface SkillCheckSite {
  engine: Engine;
  /** The published docs page ids. */
  published: { has(id: string): boolean };
  /** Non-null under `--built`: the dist/ checks run. */
  builtIds: unknown;
  /** The built site (default dist/). */
  dist?: string;
}

const SYNC = 'run `npm run skill:sync` and review the diff';

/** Read a file of the upstream checkout at `commit` without touching its working tree or index. */
function gitShow(dir: string, spec: string): Buffer | null {
  const r = spawnSync('git', ['-C', dir, 'show', spec], { maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function gitText(dir: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The bundle file list at `commit` in the upstream checkout, relative to the bundle directory. */
export function upstreamFiles(dir: string, commit: string): string[] | null {
  const out = gitText(dir, ['ls-tree', '-r', '--name-only', commit, '--', UPSTREAM_BUNDLE]);
  if (out === null) return null;
  return out.split('\n').filter(Boolean).map((p) => p.slice(UPSTREAM_BUNDLE.length + 1));
}

/** The bundle files `relate skill install` writes: the `include_str!("skill/bundle/…")` list in skill_cmd.rs. */
export function installerFiles(source: string): string[] {
  return [...source.matchAll(/include_str!\("skill\/bundle\/([^"]+)"\)/g)].map((m) => m[1]);
}

/** Whether `path` (a site path, no origin) is served by the site, from the source tree or a built dist/. */
function resolvesOnSite(path: string, site: SkillCheckSite, dist: string | null): boolean | null {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]) || '/';
  // A directory of served files counts too: a shell block's base URL (`base=https://relatedb.ai/skills/relate`).
  const served = (root: string) => {
    const file = join(root, clean);
    if (!existsSync(file)) return false;
    return statSync(file).isFile() || existsSync(join(file, 'index.html')) || (statSync(file).isDirectory() && clean !== '/');
  };
  if (dist) return served(dist);
  if (served(PUBLIC_DIR)) return true;
  const id = docsIdOf(clean);
  if (id !== null && (id === '' || site.published.has(id))) return true;
  const generated = [AGENT_SKILLS_INDEX_PATH, LEGACY_INDEX_PATH, MANIFEST_PATH, '/docs/llms.txt', '/docs/llms-full.txt', '/cookbook/', '/cookbook/llms.txt', '/playground/', '/'];
  if (generated.includes(clean) || clean.startsWith(LEGACY_SKILL_PATH)) return true;
  return null; // unknown from the source; the --built run decides
}

/**
 * docs:check 3b: the published skill is upstream's bundle at the recorded
 * commit with the engine's version stamped, its indexes and manifest agree
 * with the served bytes and validate, and every URL it cites resolves.
 * `note` prints what was skipped (default: console.log).
 */
export function checkSkill(site: SkillCheckSite, report: Report, note: (message: string) => void = (m) => console.log(`docs: skill: ${m}`)): void {
  const err = (file: string, line: number | null, rule: string, message: string) => report(file, line, 'error', rule, message);
  if (!existsSync(join(SKILL_DIR, 'SKILL.md'))) {
    err(SKILL_DIR, null, 'skill', `public/skills/${SKILL_NAME}/SKILL.md is missing; ${SYNC}`);
    return;
  }
  const files = bundleFiles();
  const bytes = new Map(files.map((f) => [f, readFileSync(join(SKILL_DIR, f))]));
  const skillMd = join(SKILL_DIR, 'SKILL.md');
  const text = bytes.get('SKILL.md')!.toString('utf8');
  const front = skillFrontmatter(text);

  // The bytes against what the sync recorded.
  const data = readSkillData();
  if (!data) err(SKILL_DATA_FILE, null, 'skill', `_data/skill.json is missing; ${SYNC}`);
  else {
    const recorded = new Map(data.files.map((f) => [f.path, f.sha256]));
    for (const [f, b] of bytes) {
      const want = recorded.get(f);
      if (!want) err(join(SKILL_DIR, f), null, 'skill-bundle', `not in _data/skill.json; the bundle is copied from upstream, never added to by hand; ${SYNC}`);
      else if (want !== sha256(b)) err(join(SKILL_DIR, f), null, 'skill-bundle', `differs from the bytes synced from upstream ${data.commit.slice(0, 12)}; the bundle is never hand-edited (ADR-0013); ${SYNC}`);
    }
    for (const f of recorded.keys()) if (!bytes.has(f)) err(join(SKILL_DIR, f), null, 'skill-bundle', `recorded in _data/skill.json but missing; ${SYNC}`);
    if (data.version !== site.engine.version) err(SKILL_DATA_FILE, null, 'skill-version', `synced with version ${data.version}; _data/engine.json says ${site.engine.version}; ${SYNC}`);
  }

  // The frontmatter.
  if (front.name !== SKILL_NAME) err(skillMd, 2, 'skill', `name is "${front.name}", not "${SKILL_NAME}"`);
  if (front.version !== site.engine.version) err(skillMd, 4, 'skill-version', `version is "${front.version}"; _data/engine.json says ${site.engine.version}; ${SYNC}`);
  if (!front.description) err(skillMd, 3, 'skill', 'the description is empty');
  else if (front.description.length > 1024) err(skillMd, 3, 'skill', `the description is ${front.description.length} characters; the discovery format allows 1024`);
  if (front.description && !front.description.includes(CANONICAL_PHRASE)) {
    report(skillMd, 3, 'warning', 'skill-description', `the description lacks the canonical phrase "${CANONICAL_PHRASE}" (DOCS-PLAN.md §3.3, §3.9); an upstream ask, since the bundle is copied unchanged`);
  }

  // Upstream at the recorded commit.
  const up = upstreamDir();
  if (data) {
    if (!existsSync(join(up, UPSTREAM_BUNDLE))) note(`no upstream checkout at ${up} (set RELATE_UPSTREAM); the bundle was not compared with upstream ${data.commit.slice(0, 12)}`);
    else {
      const listed = upstreamFiles(up, data.commit);
      if (!listed) note(`the upstream checkout at ${up} lacks commit ${data.commit.slice(0, 12)}; the bundle was not compared with upstream`);
      else {
        const want = new Set(listed);
        for (const f of listed) {
          const raw = gitShow(up, `${data.commit}:${UPSTREAM_BUNDLE}/${f}`);
          const have = bytes.get(f);
          if (!raw) continue;
          if (!have) err(join(SKILL_DIR, f), null, 'skill-upstream', `upstream ${data.commit.slice(0, 12)} has ${f}; the site does not; ${SYNC}`);
          else if (!servedBytes(f, raw, site.engine.version).equals(have)) err(join(SKILL_DIR, f), null, 'skill-upstream', `differs from upstream ${data.commit.slice(0, 12)} (with version ${site.engine.version} stamped); ${SYNC}`);
        }
        for (const f of files) if (!want.has(f)) err(join(SKILL_DIR, f), null, 'skill-upstream', `upstream ${data.commit.slice(0, 12)} has no ${f}; ${SYNC}`);
        const installer = gitShow(up, `${data.commit}:${UPSTREAM_INSTALLER}`);
        if (installer) {
          const writes = new Set(installerFiles(installer.toString('utf8')));
          const differ = [...files.filter((f) => !writes.has(f)), ...[...writes].filter((f) => !bytes.has(f))];
          if (differ.length) report(SKILL_DIR, null, 'warning', 'skill-upstream', `the site serves a different file set from the one \`relate skill install\` writes (${differ.join(', ')})`);
        }
        const recordedTree = gitText(up, ['rev-parse', `${data.commit}:${UPSTREAM_BUNDLE}`]);
        const headTree = gitText(up, ['rev-parse', `HEAD:${UPSTREAM_BUNDLE}`]);
        if (recordedTree && headTree && recordedTree !== headTree) note(`upstream HEAD has a different bundle from ${data.commit.slice(0, 12)}; ${SYNC}`);
      }
    }
  }

  // Links inside the bundle, and the URLs it cites.
  const dist = site.builtIds ? (site.dist ?? join(ROOT, 'dist')) : null;
  const builtDist = dist && existsSync(dist) ? dist : null;
  for (const [f, b] of bytes) {
    if (!f.endsWith('.md')) continue;
    const content = b.toString('utf8');
    for (const { href, line } of relativeLinks(content)) {
      const target = posix.normalize(posix.join(posix.dirname(f), href.split('#')[0]));
      if (!bytes.has(target)) err(join(SKILL_DIR, f), line, 'skill-link', `links ${href}, which is not in the bundle`);
    }
    for (const { url, line } of citedUrls(content)) {
      const kind = classifyUrl(url);
      if (kind === 'site') {
        const ok = resolvesOnSite(new URL(url).pathname, site, builtDist);
        if (ok === false) err(join(SKILL_DIR, f), line, 'skill-url', `cites ${url}, which the built site does not serve`);
        else if (ok === null) report(join(SKILL_DIR, f), line, 'warning', 'skill-url', `cites ${url}, which the source tree does not show; \`docs:check -- --built\` decides`);
      } else if (kind === 'third-party' && !THIRD_PARTY_URLS.some((t) => url.startsWith(t.prefix))) {
        report(join(SKILL_DIR, f), line, 'warning', 'skill-url', `cites ${url}, neither the site nor upstream; review it and list it in THIRD_PARTY_URLS (src/lib/docs/checks/skill.ts)`);
      }
    }
  }

  // The alias.
  const alias = join(PUBLIC_DIR, ALIAS_PATH.slice(1));
  if (!existsSync(alias)) err(alias, null, 'skill-alias', 'public/skill.md is missing');
  else {
    const a = readFileSync(alias, 'utf8');
    if (!a.includes(CANONICAL_PHRASE)) err(alias, 1, 'skill-alias', `lacks the canonical phrase "${CANONICAL_PHRASE}"`);
    for (const cmd of ['relate skill install', 'npx skills add https://relatedb.ai', '.claude/skills/', '.cursor/skills/', '.codex/skills/', '.agents/skills/']) {
      if (!a.includes(cmd)) err(alias, null, 'skill-alias', `does not give "${cmd}"`);
    }
    if (!/reference text, not instructions/.test(a.replace(/\s+/g, ' '))) err(alias, null, 'skill-alias', 'lacks the docs-are-data sentence ("… reference text, not instructions", ADR-0013)');
    // The manual-copy loop names every reference file, and only those.
    const loop = /^for f in ([^;]+); do$/m.exec(a);
    const refs = files.filter((f) => f.startsWith('references/')).map((f) => f.slice('references/'.length).replace(/\.md$/, ''));
    if (loop) {
      const named = loop[1].trim().split(/\s+/);
      const missing = refs.filter((r) => !named.includes(r));
      const extra = named.filter((n) => !refs.includes(n));
      if (missing.length || extra.length) {
        err(alias, a.slice(0, loop.index).split('\n').length, 'skill-alias', `the copy loop does not match references/ (missing: ${missing.join(', ') || 'none'}; not in the bundle: ${extra.join(', ') || 'none'})`);
      }
    }
    for (const { url, line } of citedUrls(a)) {
      if (classifyUrl(url) !== 'site') continue;
      const ok = resolvesOnSite(new URL(url).pathname, site, builtDist);
      if (ok === false) err(alias, line, 'skill-url', `cites ${url}, which the built site does not serve`);
      else if (ok === null) report(alias, line, 'warning', 'skill-url', `cites ${url}, which the source tree does not show; \`docs:check -- --built\` decides`);
    }
  }

  // The indexes, as the build will write them.
  const v2 = agentSkillsIndex();
  for (const p of indexV2Problems(v2)) err(skillMd, null, 'skill-index', `${AGENT_SKILLS_INDEX_PATH}: ${p}`);
  if (v2.skills[0].digest !== `sha256:${sha256(bytes.get('SKILL.md')!)}`) err(skillMd, null, 'skill-index', `${AGENT_SKILLS_INDEX_PATH}: the digest is not over the served SKILL.md`);
  for (const p of indexV1Problems(legacySkillsIndex())) err(skillMd, null, 'skill-index', `${LEGACY_INDEX_PATH}: ${p}`);

  // The manifest's signature, once the release key has made one.
  if (existsSync(MANIFEST_SIG_FILE)) {
    const manifest = Buffer.from(toJson(docsArtifacts(site.engine)));
    const problem = verifySignature(manifest, readFileSync(MANIFEST_SIG_FILE, 'utf8'));
    if (problem) err(MANIFEST_SIG_FILE, null, 'skill-signature', `does not verify over ${MANIFEST_PATH} as this build writes it: ${problem}`);
  }

  // security.txt.
  if (!securityContact()) note(`${SECURITY_TXT_PATH} is not built: _data/project.json names no security contact (\`{"security": {"contact": "mailto:…"}}\`)`);

  if (builtDist) checkBuiltSkill(builtDist, report);
  else if (dist) err(dist, null, 'built', 'dist/ does not exist; run `npm run build` first');
}

/** The --built half: the served indexes and manifest agree with the served bytes. */
export function checkBuiltSkill(dist: string, report: Report): void {
  const err = (file: string, rule: string, message: string) => report(file, null, 'error', rule, message);
  const at = (path: string) => join(dist, path.slice(1));
  const read = (path: string): Buffer | null => (existsSync(at(path)) ? readFileSync(at(path)) : null);

  const v2Bytes = read(AGENT_SKILLS_INDEX_PATH);
  if (!v2Bytes) err(at(AGENT_SKILLS_INDEX_PATH), 'built', `${AGENT_SKILLS_INDEX_PATH} was not built`);
  else {
    let index: unknown = null;
    try {
      index = JSON.parse(v2Bytes.toString('utf8'));
    } catch (e) {
      err(at(AGENT_SKILLS_INDEX_PATH), 'skill-index', `does not parse: ${(e as Error).message}`);
    }
    if (index) {
      for (const p of indexV2Problems(index)) err(at(AGENT_SKILLS_INDEX_PATH), 'skill-index', p);
      for (const e of (index as IndexV2).skills ?? []) {
        const path = new URL(e.url, `${CANONICAL_ORIGIN}${AGENT_SKILLS_INDEX_PATH}`).pathname;
        const target = read(path);
        if (!target) err(at(AGENT_SKILLS_INDEX_PATH), 'skill-index', `${e.name}: ${e.url} was not built`);
        else if (e.digest !== `sha256:${sha256(target)}`) err(at(AGENT_SKILLS_INDEX_PATH), 'skill-index', `${e.name}: the digest does not match the bytes at ${e.url}; the skills CLI aborts on a mismatch`);
      }
    }
  }

  const v1Bytes = read(LEGACY_INDEX_PATH);
  if (!v1Bytes) err(at(LEGACY_INDEX_PATH), 'built', `${LEGACY_INDEX_PATH} was not built`);
  else {
    const index = JSON.parse(v1Bytes.toString('utf8')) as IndexV1;
    for (const p of indexV1Problems(index)) err(at(LEGACY_INDEX_PATH), 'skill-index', p);
    for (const s of index.skills ?? []) {
      for (const f of s.files ?? []) {
        const legacy = read(`/.well-known/skills/${s.name}/${f}`);
        const canonical = read(`/skills/${s.name}/${f}`);
        if (!legacy) err(at(LEGACY_INDEX_PATH), 'skill-index', `/.well-known/skills/${s.name}/${f} was not built`);
        else if (!canonical || !legacy.equals(canonical)) err(at(LEGACY_INDEX_PATH), 'skill-index', `/.well-known/skills/${s.name}/${f} differs from /skills/${s.name}/${f}`);
      }
    }
  }

  const mBytes = read(MANIFEST_PATH);
  if (!mBytes) err(at(MANIFEST_PATH), 'built', `${MANIFEST_PATH} was not built`);
  else {
    const manifest = JSON.parse(mBytes.toString('utf8')) as Manifest;
    for (const a of manifest.artifacts ?? []) {
      const b = read(a.path);
      if (!b) err(at(MANIFEST_PATH), 'skill-manifest', `lists ${a.path}, which was not built`);
      else if (sha256(b) !== a.sha256 || b.length !== a.bytes) err(at(MANIFEST_PATH), 'skill-manifest', `${a.path}: the SHA-256 or size does not match the built file`);
    }
    const sig = read(`${MANIFEST_PATH}.sig`);
    if (sig) {
      const problem = verifySignature(mBytes, sig.toString('utf8'));
      if (problem) err(at(`${MANIFEST_PATH}.sig`), 'skill-signature', `does not verify over the built ${MANIFEST_PATH}: ${problem}`);
    }
  }

  if (!read(ALIAS_PATH)) err(at(ALIAS_PATH), 'built', `${ALIAS_PATH} was not built`);

  const sec = read(SECURITY_TXT_PATH);
  if (sec) {
    const t = sec.toString('utf8');
    if (!/^Contact: \S+$/m.test(t)) err(at(SECURITY_TXT_PATH), 'security-txt', 'has no Contact field (RFC 9116 §2.5.3)');
    const exp = /^Expires: (\S+)$/m.exec(t)?.[1];
    if (!exp) err(at(SECURITY_TXT_PATH), 'security-txt', 'has no Expires field (RFC 9116 §2.5.5)');
    else if (!(Date.parse(exp) > Date.now())) err(at(SECURITY_TXT_PATH), 'security-txt', `expired on ${exp}; rebuild`);
  }
}

// The docs content as files: every page under src/content/docs with its
// frontmatter, the glossary's short definitions, and the engine version the
// examples are verified against. Read straight from disk (no astro:content),
// so the remark plugin inside the MDX compiler, the twin renderer and Node
// checks all see the same set of pages.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

import { GENERATED_IDS, idFromPath } from './model.ts';

/** The repository root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Where the docs pages live. */
export const DOCS_DIR = join(ROOT, 'src/content/docs');
export const GLOSSARY_DIR = join(DOCS_DIR, '_glossary');
export const ENGINE_FILE = join(DOCS_DIR, '_data/engine.json');

/**
 * Whether the throwaway example page (`_example/`) is part of the build. It
 * exercises every construct for the tests; `DOCS_EXAMPLES=1 npm run build`
 * builds it at /docs/_example/example/ to look at.
 */
export const INCLUDE_EXAMPLES = process.env.DOCS_EXAMPLES === '1';

/** Directories under src/content/docs that hold no pages. */
const isPageDir = (name: string) =>
  !['diagrams', 'node_modules', '_glossary', '_data', '_capabilities'].includes(name) && (name !== '_example' || INCLUDE_EXAMPLES);

/** Glob patterns for the `docs` collection, matching `pageFiles`. */
export const DOCS_PATTERNS = ['**/*.mdx', '!**/diagrams/**', '!_glossary/**', '!_data/**', '!_capabilities/**', ...(INCLUDE_EXAMPLES ? [] : ['!_example/**'])];

/** Split `text` into its YAML frontmatter (parsed) and body. */
export function splitFrontmatter(text: string, where: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  let data: unknown;
  try {
    data = parseYaml(m[1]) ?? {};
  } catch (e) {
    throw new Error(`${where}: the frontmatter is not YAML: ${(e as Error).message}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) throw new Error(`${where}: the frontmatter is not a mapping`);
  return { data: data as Record<string, unknown>, body: text.slice(m[0].length) };
}

export interface PageFile {
  id: string;
  file: string;
  data: Record<string, unknown>;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return isPageDir(e.name) ? walk(path) : [];
      return e.isFile() && e.name.endsWith('.mdx') ? [path] : [];
    })
    .sort();
}

/** Every page file, planned ones included, with its raw frontmatter. */
export function pageFiles(): PageFile[] {
  return walk(DOCS_DIR).map((file) => {
    const rel = relative(DOCS_DIR, file).split(sep).join('/');
    return { id: idFromPath(rel), file, data: splitFrontmatter(readFileSync(file, 'utf8'), rel).data };
  });
}

/** The ids of the pages the build publishes: status other than `planned`, and the generated pages (model.ts). */
export function publishedIds(): Set<string> {
  return new Set([...pageFiles().filter((p) => p.data.status !== 'planned').map((p) => p.id), ...GENERATED_IDS]);
}

export interface GlossaryTerm {
  id: string;
  term: string;
  short: string;
}

/** The glossary's terms by id (src/content/docs/_glossary/<id>.mdx). */
export function glossary(): Map<string, GlossaryTerm> {
  const out = new Map<string, GlossaryTerm>();
  if (!existsSync(GLOSSARY_DIR)) return out;
  for (const name of readdirSync(GLOSSARY_DIR).sort()) {
    if (!name.endsWith('.mdx')) continue;
    const { data } = splitFrontmatter(readFileSync(join(GLOSSARY_DIR, name), 'utf8'), `_glossary/${name}`);
    const id = typeof data.id === 'string' ? data.id : name.replace(/\.mdx$/, '');
    out.set(id, { id, term: String(data.term ?? id), short: String(data.short ?? '') });
  }
  return out;
}

export interface Engine {
  /** The current release, without a leading `v` (`0.16.1`). */
  version: string;
  /** The relate version the examples last ran against (each twin's `verified`). */
  verified: string;
  /** Its release date, `YYYY-MM-DD`. */
  date: string;
  /** The upstream commit the recordings were made from (engine.json `commit`), when known. */
  commit?: string | null;
  /**
   * True when the recordings come from a source build of `commit` rather than
   * the published release (engine.json `source_build`; before launch, a build
   * that reports `version` but carries changes made after that release).
   */
  sourceBuild?: boolean;
}

const normalizeVersion = (v: unknown) => String(v ?? '').replace(/^v/, '');
const normalizeDate = (d: unknown) => String(d ?? '').slice(0, 10);

/**
 * The engine the docs are verified against, from src/content/docs/_data/engine.json
 * (`{"version": "0.16.1", "verified": "0.16.1", "date": "2026-11-04",
 * "commit": "ac441ec", "source_build": true, …}`; `verified` defaults to
 * `version`). Until that file exists the
 * latest release in public/releases.json stands in, with a warning.
 */
export function engine(): Engine {
  if (existsSync(ENGINE_FILE)) {
    const data = JSON.parse(readFileSync(ENGINE_FILE, 'utf8')) as Record<string, unknown>;
    const version = normalizeVersion(data.version);
    const date = normalizeDate(data.date ?? data.released ?? data.published_at);
    const verified = normalizeVersion(data.verified ?? data.version);
    for (const [k, v] of [['version', version], ['verified', verified]]) {
      if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error(`${ENGINE_FILE}: "${k}" is not a version: ${v}`);
    }
    const commit = typeof data.commit === 'string' && data.commit ? data.commit : null;
    return { version, verified, date, commit, sourceBuild: data.source_build === true };
  }
  const releases = JSON.parse(readFileSync(join(ROOT, 'public/releases.json'), 'utf8'));
  warnOnce(`docs: ${relative(ROOT, ENGINE_FILE)} is missing; using the latest release in public/releases.json`);
  const version = normalizeVersion(releases.latest?.tag);
  return { version, verified: version, date: normalizeDate(releases.latest?.published_at) };
}

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/**
 * The date a page file last changed: its last commit, or for a file with
 * uncommitted changes or none, the file's modification time.
 */
export function lastUpdated(file: string): string {
  try {
    const dirty = execFileSync('git', ['status', '--porcelain', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!dirty) {
      const date = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT, encoding: 'utf8' }).trim();
      if (date) return date;
    }
  } catch {
    // Not a git checkout: fall through to the file's time.
  }
  return statSync(file).mtime.toISOString().slice(0, 10);
}

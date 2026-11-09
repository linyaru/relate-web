// The task skills library (DOCS-PLAN.md §3.8 "Skills library"; ADR-0011,
// ADR-0013, ADR-0019 and ADR-0032): skills authored in this repo
// (ADR-0002), one folder per task family under public/skills/<name>/, beside
// the CLI's bundle in public/skills/relate/ (copied from upstream, never
// edited here). Each folder is the Agent Skills layout: SKILL.md (frontmatter
// `name`, `description`, `version`) and references/*.md.
//
// This module is the model the endpoints, the check and the record step
// share. Node only (the build, docs:check, docs:test), never shipped to the
// browser.
//
//   taskSkills()            the task skill folders, sorted by name
//   skillFiles(dir)         a skill's files, SKILL.md first
//   citations(text)         the relatedb.ai URLs a file cites, classified
//   skillFences(text)       its fenced blocks, with their info tokens
//   cypherSteps(text)       the ```cypher fences as runnable steps
//   runSkillCypher(...)     run them on the WebAssembly build, in order, on
//                           one fresh in-memory store per file
//   proseProblems(text)     the docs-are-data heuristics (ADR-0013)
//   writableOpens(code)     shell commands that open a store without --read-only
//   clientWritableOpens(…)  the same for Python and JavaScript fences
//   recordTaskSkills(...)   write `task_skills` into _data/skill.json: each
//                           skill's file hashes and, per cited recipe, the
//                           hash of its source and of its built results.json
//
// Fence conventions inside a task skill (src/content/docs/README.md "Task
// skills"): a ```cypher fence runs; `params=<name>` binds the ```json fence
// marked `data=<name>` in the same file; `notifies=<GQLSTATUS>[,…]` asserts
// the run returns those notifications, `notifies=none` that it returns none;
// `expect=error` asserts it fails. A ```bash, ```python or ```javascript
// fence that writes to a store is marked `writes`, and the prose before it
// says so; a fence in a language the read-only rule cannot read is refused.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Code, Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { DOCS_DIR, ROOT, splitFrontmatter } from './content.ts';

// ---------------------------------------------------------------------------
// Where things are

/** Every published skill folder (public/skills/). */
export const SKILLS_DIR = join(ROOT, 'public', 'skills');
/** The CLI's bundle, synced from upstream; not a task skill. */
export const CLI_SKILL_NAME = 'relate';
/** The cookbook's recipe sources. */
export const COOKBOOK_SOURCE_DIR = join(ROOT, 'src/content/cookbook');
/** Where `task_skills` is recorded (the file `npm run skill:sync` writes for the CLI bundle). */
export const TASK_SKILL_DATA_FILE = join(DOCS_DIR, '_data/skill.json');
/** The site's canonical host, as skills cite it. */
export const SITE_HOST = 'relatedb.ai';
/** The frontmatter keys a task skill may carry. */
export const FRONTMATTER_KEYS = ['name', 'description', 'version'] as const;

export interface TaskSkill {
  name: string;
  dir: string;
}

/** The task skill folders under `skillsDir` (every folder but the CLI bundle), sorted by name. */
export function taskSkills(skillsDir = SKILLS_DIR): TaskSkill[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== CLI_SKILL_NAME)
    .map((e) => ({ name: e.name, dir: join(skillsDir, e.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A skill folder's files, relative and `/`-separated: SKILL.md first, then the rest sorted. */
export function skillFiles(dir: string): string[] {
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

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

/** SKILL.md's frontmatter as parsed YAML (empty when there is none). */
export function frontmatterOf(text: string, where = 'SKILL.md'): Record<string, unknown> {
  return splitFrontmatter(text, where).data;
}

// ---------------------------------------------------------------------------
// Markdown

const parser = unified().use(remarkParse).use(remarkGfm);
export const parseMarkdown = (text: string): Root => parser.parse(text);

/** The body of a skill file: frontmatter removed, line count kept (so positions stay file lines). */
function bodyOf(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? `${'\n'.repeat(m[0].split('\n').length - 1)}${text.slice(m[0].length)}` : text;
}

export interface SkillFence {
  lang: string;
  /** The info string after the language, split on whitespace. */
  info: string[];
  code: string;
  /** The fence's opening line in the file. */
  line: number;
  /** The text of the paragraph just before the fence, or '' (for the `writes` rule). */
  before: string;
}

/** Every fenced block in a skill file, in document order. */
export function skillFences(text: string): SkillFence[] {
  const out: SkillFence[] = [];
  const walk = (node: Root | RootContent, siblings: RootContent[] = []) => {
    if (node.type === 'code') {
      const c = node as Code;
      const i = siblings.indexOf(node);
      const prev = i > 0 ? siblings[i - 1] : null;
      out.push({
        lang: c.lang ?? '',
        info: (c.meta ?? '').split(/\s+/).filter(Boolean),
        code: c.value,
        line: c.position?.start.line ?? 0,
        before: prev && prev.type === 'paragraph' ? toString(prev) : '',
      });
      return;
    }
    if ('children' in node) {
      const kids = (node as Parent).children as RootContent[];
      for (const k of kids) walk(k, kids);
    }
  };
  walk(parseMarkdown(bodyOf(text)));
  return out;
}

// ---------------------------------------------------------------------------
// Citations

export type CitationKind = 'page' | 'recipe' | 'site' | 'external';

export interface Citation {
  url: string;
  line: number;
  kind: CitationKind;
  /** The docs page id (`page`) or recipe slug (`recipe`). */
  id?: string;
  /** The site path (`page`, `recipe`, `site`). */
  path?: string;
}

/** Every http(s) URL in `text`, with its line, trailing punctuation trimmed, classified. */
export function citations(text: string): Citation[] {
  const out: Citation[] = [];
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/\bhttps?:\/\/[^\s)`"'<>\]]+/g)) {
      const url = m[0].replace(/[.,;:]+$/, '');
      out.push({ url, line: i + 1, ...classifyCitation(url) });
    }
  });
  return out;
}

/** What a URL names: a docs twin, a recipe's markdown, another path on the site, or an outside URL. */
export function classifyCitation(url: string): { kind: CitationKind; id?: string; path?: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'external' };
  }
  if (u.hostname !== SITE_HOST) return { kind: 'external' };
  const path = u.pathname;
  const page = /^\/docs\/(.+)\.md$/.exec(path);
  if (page && !page[1].endsWith('/index')) return { kind: 'page', id: page[1], path };
  const recipe = /^\/cookbook\/([a-z0-9-]+)\/index\.md$/.exec(path);
  if (recipe) return { kind: 'recipe', id: recipe[1], path };
  return { kind: 'site', path };
}

/** The recipe slugs a skill folder cites, sorted and unique. */
export function citedRecipes(dir: string): string[] {
  const slugs = new Set<string>();
  for (const f of skillFiles(dir).filter((f) => f.endsWith('.md'))) {
    for (const c of citations(readFileSync(join(dir, f), 'utf8'))) if (c.kind === 'recipe' && c.id) slugs.add(c.id);
  }
  return [...slugs].sort();
}

/** Relative markdown links (`[x](references/y.md)`) in a file, outside code, with their line. */
export function relativeLinks(text: string): { href: string; line: number }[] {
  const out: { href: string; line: number }[] = [];
  let inFence = false;
  text.split('\n').forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) inFence = !inFence;
    if (inFence) return;
    for (const m of l.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)\)/g)) {
      if (!/^[a-z][a-z0-9+.-]*:|^#/i.test(m[1])) out.push({ href: m[1], line: i + 1 });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Cypher

export interface CypherStep {
  line: number;
  code: string;
  /** The data fence whose JSON binds as parameters, or null. */
  params: string | null;
  /** Notifications the run must return (GQLSTATUS codes), `none` for none, or null for no assertion. */
  notifies: string[] | 'none' | null;
  expectError: boolean;
}

/** The ```cypher fences of a skill file as steps, its ```json data fences, and what is malformed. */
export function cypherSteps(text: string): { steps: CypherStep[]; data: Map<string, string>; problems: { line: number; message: string }[] } {
  const fences = skillFences(text);
  const data = new Map<string, string>();
  const problems: { line: number; message: string }[] = [];
  for (const f of fences.filter((x) => x.lang === 'json')) {
    for (const tok of f.info) {
      const m = /^data=([a-z0-9-]+)$/.exec(tok);
      if (!m) problems.push({ line: f.line, message: `unknown info token "${tok}" on a json fence (only data=<name>)` });
      else if (data.has(m[1])) problems.push({ line: f.line, message: `a second json fence named data=${m[1]}` });
      else {
        try {
          JSON.parse(f.code);
          data.set(m[1], f.code);
        } catch (e) {
          problems.push({ line: f.line, message: `json data=${m[1]} does not parse: ${(e as Error).message}` });
        }
      }
    }
  }
  const steps: CypherStep[] = [];
  for (const f of fences.filter((x) => x.lang === 'cypher')) {
    const step: CypherStep = { line: f.line, code: f.code, params: null, notifies: null, expectError: false };
    for (const tok of f.info) {
      let m: RegExpExecArray | null;
      if ((m = /^params=([a-z0-9-]+)$/.exec(tok))) {
        step.params = m[1];
        if (!data.has(m[1])) problems.push({ line: f.line, message: `params=${m[1]} names no \`json data=${m[1]}\` fence in this file` });
      } else if ((m = /^notifies=(none|[0-9A-Z]{5}(?:,[0-9A-Z]{5})*)$/.exec(tok))) {
        step.notifies = m[1] === 'none' ? 'none' : m[1].split(',');
      } else if (tok === 'expect=error') step.expectError = true;
      else problems.push({ line: f.line, message: `unknown info token "${tok}" on a cypher fence (params=<name>, notifies=<GQLSTATUS>[,…] or none, expect=error)` });
    }
    steps.push(step);
  }
  return { steps, data, problems };
}

/** The parts of the WebAssembly bundle (`public/wasm/relate.js`) a run needs. */
export interface Wasm {
  RelateDb: new () => { executeScript(script: string, params?: string | null): string[]; free(): void };
}

export interface CypherRun {
  /** Fences run. */
  steps: number;
  /** Statements run (a fence can hold several, `;`-separated). */
  statements: number;
  failures: { line: number; message: string }[];
}

interface Envelope {
  error?: string | null;
  notifications?: { gql_status?: string }[];
}

/**
 * Run a skill file's ```cypher fences in document order on one fresh
 * in-memory store, as the skill says they run. A fence fails when any of its
 * statements returns an error (unless it is `expect=error`, which fails when
 * none does), or when `notifies=` does not hold for its last statement. The
 * run stops at the first failure, since later fences build on earlier ones.
 */
export function runSkillCypher(wasm: Wasm, text: string): CypherRun {
  const { steps, data, problems } = cypherSteps(text);
  const run: CypherRun = { steps: 0, statements: 0, failures: problems.map((p) => ({ ...p })) };
  if (problems.length) return run;
  const db = new wasm.RelateDb();
  try {
    for (const step of steps) {
      run.steps++;
      let envelopes: Envelope[];
      try {
        envelopes = db.executeScript(step.code, step.params === null ? null : data.get(step.params)!).map((e) => JSON.parse(e) as Envelope);
      } catch (e) {
        run.failures.push({ line: step.line, message: `the engine threw: ${(e as Error).message}` });
        return run;
      }
      run.statements += envelopes.length;
      if (!envelopes.length) {
        run.failures.push({ line: step.line, message: 'the fence holds no statement' });
        return run;
      }
      const errors = envelopes.map((e) => e.error).filter((e): e is string => typeof e === 'string' && e.length > 0);
      if (step.expectError && !errors.length) {
        run.failures.push({ line: step.line, message: 'marked expect=error, but every statement succeeded' });
        return run;
      }
      if (!step.expectError && errors.length) {
        run.failures.push({ line: step.line, message: `returned an error: ${errors[0]}` });
        return run;
      }
      if (step.notifies !== null) {
        const got = (envelopes.at(-1)!.notifications ?? []).map((n) => n.gql_status ?? '?');
        if (step.notifies === 'none' && got.length) {
          run.failures.push({ line: step.line, message: `marked notifies=none, but returned ${got.join(', ')}` });
          return run;
        }
        if (step.notifies !== 'none') {
          const missing = step.notifies.filter((c) => !got.includes(c));
          if (missing.length) {
            run.failures.push({ line: step.line, message: `marked notifies=${step.notifies.join(',')}, but returned ${got.length ? got.join(', ') : 'no notification'}` });
            return run;
          }
        }
      }
    }
    return run;
  } finally {
    db.free();
  }
}

// ---------------------------------------------------------------------------
// Docs are data (ADR-0013)

/** Sentence-initial verbs that make a sentence an instruction (the docs:check imperative heuristic, scripts/docs.ts). */
export const IMPERATIVE_VERBS = new Set([
  'run', 'install', 'copy', 'use', 'read', 'open', 'add', 'pass', 'call', 'paste', 'execute', 'download',
  'remove', 'delete', 'edit', 'replace', 'configure', 'enable', 'disable', 'click', 'tell', 'ask', 'create',
  'write', 'try', 'ignore', 'disregard', 'forget',
]);

/** Text that addresses an agent as an agent (the docs:check injection patterns). */
export const INJECTION: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:previous|prior|earlier|above|system|your|all)\b[^.]{0,20}\b(?:instructions?|prompts?|rules|limits|guidelines|directions)\b/i,
  /\byou are (?:an? |now (?:an? )?)?(?:AI|assistant|language model|LLM|chatbot)\b/i,
  /\bas an AI\b/i,
];

/**
 * The docs-are-data problems in a skill file's prose (paragraphs and list
 * items outside fences, headings and tables): a sentence that opens with an
 * imperative verb, and text that addresses the agent. A skill is reference an
 * agent may act on; its frontmatter description is the only framing, and it
 * is not prose here.
 */
export function proseProblems(text: string): { line: number; rule: 'imperative' | 'injection'; text: string }[] {
  const out: { line: number; rule: 'imperative' | 'injection'; text: string }[] = [];
  const walk = (node: Root | RootContent) => {
    if (node.type === 'code' || node.type === 'heading' || node.type === 'table' || node.type === 'html') return;
    if (node.type === 'paragraph') {
      const line = node.position?.start.line ?? 0;
      const prose = toString(node).replace(/\s+/g, ' ').trim();
      for (const re of INJECTION) {
        const m = re.exec(prose);
        if (m) out.push({ line, rule: 'injection', text: m[0] });
      }
      for (const sentence of prose.split(/(?<=[.!?])\s+/)) {
        const words = sentence.replace(/^[^A-Za-z]+/, '').split(/\s+/);
        const first = words[0]?.toLowerCase().replace(/[^a-z']/g, '') ?? '';
        const imperative = IMPERATIVE_VERBS.has(first) || /^(?:do not|don't)\b/i.test(words.slice(0, 2).join(' '));
        if (imperative && words.length >= 3 && /[.!?:]["'”)]?$/.test(sentence.trim())) {
          out.push({ line, rule: 'imperative', text: sentence.length > 80 ? `${sentence.slice(0, 77)}…` : sentence });
        }
      }
      return;
    }
    if ('children' in node) for (const c of (node as Parent).children) walk(c as RootContent);
  };
  walk(parseMarkdown(bodyOf(text)));
  return out;
}

/**
 * The commands of a shell fence that open a store (`relate … --database|-d …`,
 * `relate serve …`, the binary named bare or by a path such as `./relate`)
 * without `--read-only`. Backslash continuations join first, so a flag on a
 * continuation line counts; quoted strings and a trailing `# comment` are set
 * aside before the test, so `--read-only` inside a query string or a comment
 * does not count, and neither does `relate` inside one.
 */
export function writableOpens(code: string): string[] {
  return code
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .filter((l) => {
      const bare = l.replace(/'[^']*'|"[^"]*"/g, "''").replace(/(?:^|\s)#.*$/, '');
      const opens = /(?:^|[\s;|&(/])relate\s/.test(bare) && (/\s(?:--database|-d)[\s=]/.test(bare) || /(?:^|[\s;|&(/])relate\s+serve\b/.test(bare));
      return opens && !/\s--read-only(?:=\S+)?(?:\s|$)/.test(bare);
    });
}

/** Client-language fences the read-only rule can read, by fence language. */
export const CLIENT_LANGS: Record<string, 'python' | 'javascript'> = {
  python: 'python', py: 'python',
  javascript: 'javascript', js: 'javascript', mjs: 'javascript', typescript: 'javascript', ts: 'javascript',
};

/**
 * The lines of a Python or JavaScript fence that open a store other than
 * `:memory:` without the client's read-only option (Python `connect(…)` /
 * `Connection(…)` without `read_only=True`; JavaScript `Database.open(…)`
 * without `readOnly: true`), or null for a language the rule cannot read.
 */
export function clientWritableOpens(lang: string, code: string): string[] | null {
  const kind = CLIENT_LANGS[lang];
  if (!kind) return null;
  const call = kind === 'python' ? /\b(?:connect|Connection)\s*\(/ : /\bDatabase\.open\s*\(/;
  const readOnly = kind === 'python' ? /\bread_only\s*=\s*True\b/ : /\breadOnly\s*:\s*true\b/;
  return code.split('\n').filter((l) => call.test(l) && !/["']:memory:["']/.test(l) && !readOnly.test(l));
}

// ---------------------------------------------------------------------------
// The record (_data/skill.json `task_skills`)

export interface TaskSkillRecord {
  name: string;
  /** The day the files last changed in a record run, YYYY-MM-DD: when a person last reviewed them as a diff. */
  reviewed: string;
  /** Every file of the folder with its SHA-256. */
  files: { path: string; sha256: string }[];
  /** Each recipe the skill cites: the SHA-256 of its source and of its built results.json (timings removed), null before a build. */
  recipes: { slug: string; source_sha256: string; results_sha256: string | null }[];
}

/** The `task_skills` list in `file`, or [] when absent. */
export function readTaskSkillRecords(file = TASK_SKILL_DATA_FILE): TaskSkillRecord[] {
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, 'utf8')) as { task_skills?: TaskSkillRecord[] };
  return Array.isArray(data.task_skills) ? data.task_skills : [];
}

/** The recipe source's path. */
export const recipeSource = (slug: string, dir = COOKBOOK_SOURCE_DIR) => join(dir, `${slug}.md`);

/**
 * A digest of a recipe's results.json as the build writes it, with every
 * `*_ms` timing key removed (they change from run to run) and object keys
 * sorted, so the same results always give the same digest.
 */
export function resultsDigest(bytes: Uint8Array | string): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !/_ms$/.test(k))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, strip(x)]),
      );
    }
    return v;
  };
  const text = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8');
  return sha256(JSON.stringify(strip(JSON.parse(text))));
}

/** The built results.json of a recipe under `dist`, or null. */
export function builtResults(dist: string, slug: string): Buffer | null {
  const file = join(dist, 'cookbook', slug, 'results.json');
  return existsSync(file) && statSync(file).isFile() ? readFileSync(file) : null;
}

/** What a record run would write for one skill folder (`previous` keeps `reviewed` when the files did not change). */
export function taskSkillRecord(skill: TaskSkill, previous: TaskSkillRecord | undefined, today: string, dist: string | null, cookbookDir = COOKBOOK_SOURCE_DIR): TaskSkillRecord {
  const files = skillFiles(skill.dir).map((path) => ({ path, sha256: sha256(readFileSync(join(skill.dir, path))) }));
  const recipes = citedRecipes(skill.dir).map((slug) => {
    const src = recipeSource(slug, cookbookDir);
    const built = dist ? builtResults(dist, slug) : null;
    const prior = previous?.recipes.find((r) => r.slug === slug);
    const source_sha256 = existsSync(src) ? sha256(readFileSync(src)) : '';
    // Without a build, a results digest recorded for the same source stays.
    const results_sha256 = built ? resultsDigest(built) : prior && prior.source_sha256 === source_sha256 ? prior.results_sha256 : null;
    return { slug, source_sha256, results_sha256 };
  });
  const unchanged = previous && JSON.stringify(previous.files) === JSON.stringify(files);
  return { name: skill.name, reviewed: unchanged ? previous.reviewed : today, files, recipes };
}

/**
 * Record every task skill into `file`'s `task_skills`, keeping its other keys
 * (the CLI bundle's sync record). `dist` is a built site whose
 * cookbook/<slug>/results.json files give the results digests. Returns the
 * records written.
 */
export function recordTaskSkills({ file = TASK_SKILL_DATA_FILE, skillsDir = SKILLS_DIR, dist = null as string | null, today = new Date().toISOString().slice(0, 10), cookbookDir = COOKBOOK_SOURCE_DIR } = {}): TaskSkillRecord[] {
  const data = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  const before = Array.isArray(data.task_skills) ? (data.task_skills as TaskSkillRecord[]) : [];
  const records = taskSkills(skillsDir).map((s) => taskSkillRecord(s, before.find((b) => b.name === s.name), today, dist, cookbookDir));
  writeFileSync(file, `${JSON.stringify({ ...data, task_skills: records }, null, 2)}\n`);
  return records;
}

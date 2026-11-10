// The docs graph (DOCS-PLAN.md §3.5, ADR-0007, ADR-0015): the docs collection,
// the glossary, the cookbook index and _data/cli.json as one graph, written
// out as a Cypher seed script. The seed script is the artifact (ADR-0015):
// the build serves it at /docs/graph.cypher and the same data as
// /docs/graph.json, docs:check replays it on the shipped WASM and runs the
// structural checks on it as Cypher (checks/graph.ts), and CI replays it
// through the native CLI into /docs/relate-docs.rl (scripts/docs-graph.ts).
// Each page's neighborhood is /docs/<id>.graph.md.
//
// Deterministic: the same input gives the same bytes. Every list is sorted by
// id, nothing reads the clock or git, and the twin is rendered with a fixed
// `last_updated` (its length, and so its token estimate, is the same).
//
// The model (property names follow DOCS-PLAN.md §3.5; a null property is
// left out, as Cypher stores it):
//
//   (:Page {id, url, md_url, title, description, type, section, status, since, verified, tokens})
//       every page file, planned ones included (status `planned`, no url)
//   (:Section {id, page, anchor, heading, level, position, url, text, length, embedding})
//       one per H2 and H3 of a published page (`anchor` is the HTML id), plus
//       level 1 for the text before the first of them (anchor ''); `text` is
//       the section's markdown as the twin has it, `length` its characters;
//       `embedding` is its VECTOR<FLOAT32>(384) from _data/embeddings.json
//       (below), set in the seed only, and only while its text hash matches
//   (:Example {id, page, section, position, lang, first_line, title, runnable, cell})
//       one per fenced block the twin carries, components' included; a
//       cell's recorded result and a diagram are not examples; `section` is
//       the anchor of the section it sits in, `position` its order on the page
//   (:Term {id, term, short, context, see, url})    the glossary
//   (:Surface {id})                                 model.ts SURFACES
//   (:CookbookRecipe {id, title, summary, url, md_url})
//   (:Command {id, word, synopsis, disputed})       _data/cli.json commands
//   (:Flag {id, flag, names, command, value, disputed})
//       _data/cli.json query-run flags (`command` absent) and command flags
//   (:Index {id, url, title})                       llms.txt and the landing
//   (:Capability {id, title, problem, capability, url, schema_url, verify})
//       one per _capabilities/ entry (src/lib/docs/capabilities.ts)
//   (:Problem {id, text, kind})                     a capability's problem and intents
//
//   (:Page)-[:LINKS_TO {anchor}]->(:Page|:CookbookRecipe)    body links
//   (:Page)-[:PREREQUISITE_OF]->(:Page)          the prerequisite points at the page that needs it
//   (:Page)-[:RELATED_TO {anchor}]->(:Page|:CookbookRecipe)  frontmatter `related`
//   (:Page)-[:HAS_SECTION]->(:Section)
//   (:Page)-[:HAS_EXAMPLE]->(:Example)
//   (:Page)-[:USES_TERM]->(:Term)                every :term on the page
//   (:Page)-[:APPLIES_TO]->(:Surface)            frontmatter `surfaces`
//   (:Page)-[:DOCUMENTS]->(:Command|:Flag)       named in a shell or config
//                                                block, or in inline code
//   (:Command)-[:HAS_FLAG]->(:Flag)
//   (:Index)-[:LISTS]->(:Page)
//   (:Capability)-[:SOLVES]->(:Problem)
//   (:Capability)-[:APPLIES_TO]->(:Surface)
//   (:Capability)-[:CITES {role, anchor}]->(:Page)
//   (:CookbookRecipe)-[:DEMONSTRATES]->(:Capability)
//   (:Capability)-[:VERIFIED_BY {cell}]->(:CookbookRecipe|:Page)
//   (:Page)-[:HAS_CAPABILITY]->(:Capability)
//
// A :term whose id has no glossary entry still gets a Term node (with no
// `short`), so the check can name it; the build fails on it before it ships.
//
// Indexes: the full-text index `docs` on (:Section) heading and text, the
// vector index `docs_vector` on (:Section) embedding (384 dimensions, cosine,
// filterable on `page`),
// and the full-text index `problems` on (:Problem) text.
//
// Extension points (DOCS-PLAN.md §3.5, §3.8): a label joins LABELS and a
// relationship type REL_TYPES when its data source exists (ADR-0020: never as
// an empty label). A new source is read in graphInput() into a new GraphInput
// field, and its nodes and relationships are added in buildGraph() at the
// marked place, as the capability catalog's are (capabilityGraphRows in
// src/lib/docs/capabilities.ts); finish() sorts and deduplicates them,
// seedScript() writes them, and the schema comment lists their properties,
// with no other change.
//
// Node-only (no astro:content), so the Astro endpoints and the Node checks
// build the same graph from the same files.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import GithubSlugger from 'github-slugger';
import type { Code, Heading, Link, Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { COOKBOOK_DIR, loadRecipes } from '../cookbook/load.ts';
import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { capabilityGraphRows, readCapabilities, type Capability } from './capabilities.ts';
import { glossaryHref, GLOSSARY_ID, renderConstructs, type ToMarkdown } from './constructs.ts';
import { DOCS_DIR, engine as readEngine, GLOSSARY_DIR, pageFiles, splitFrontmatter, type Engine, type PageFile } from './content.ts';
import { PRIMARY, TASKS } from './landing.ts';
import { docsIdOf } from './links.ts';
import { estimateTokens, GENERATED_IDS, pageUrl, sectionOf, SURFACES, twinUrl, typeOf } from './model.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';
import { parseRunInfo } from './results.ts';
import { renderTwin } from './twin.ts';

// ---------------------------------------------------------------------------
// The model

export const LABELS = ['Page', 'Section', 'Example', 'Term', 'Surface', 'CookbookRecipe', 'Command', 'Flag', 'Index', 'Capability', 'Problem'] as const;
export type Label = (typeof LABELS)[number];

export const REL_TYPES = [
  'LINKS_TO',
  'PREREQUISITE_OF',
  'RELATED_TO',
  'HAS_SECTION',
  'HAS_EXAMPLE',
  'USES_TERM',
  'APPLIES_TO',
  'DOCUMENTS',
  'HAS_FLAG',
  'LISTS',
  'SOLVES',
  'CITES',
  'DEMONSTRATES',
  'VERIFIED_BY',
  'HAS_CAPABILITY',
] as const;
export type RelType = (typeof REL_TYPES)[number];

export type Value = string | number | boolean | string[];
/** Properties in the order the seed writes them; null and undefined are left out. */
export type Props = Record<string, Value | null | undefined>;

export interface GraphNode {
  label: Label;
  /** The node's `id` property: unique within its label. */
  id: string;
  props: Props;
}

export interface GraphRel {
  type: RelType;
  from: { label: Label; id: string };
  to: { label: Label; id: string };
  props: Props;
}

export interface DocsGraph {
  nodes: GraphNode[];
  rels: GraphRel[];
  engine: Engine;
  /** Pages the twin renderer refused; their nodes come from the raw source instead. */
  problems: string[];
  /**
   * Section id → its vector, for the sections whose entry in
   * _data/embeddings.json matches the text they would embed now (see
   * sectionInputs); a missing or stale one is left out, and docs:check
   * reports it (checks/embeddings.ts).
   */
  vectors: Map<string, number[]>;
}

/** A node's key in graph.json: `Label:id`. */
export const nodeKey = (n: { label: Label; id: string }) => `${n.label}:${n.id}`;

// ---------------------------------------------------------------------------
// Input

export interface GraphPage {
  id: string;
  file: string;
  data: Record<string, unknown>;
  /** The MDX without its frontmatter. */
  body: string;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  short: string;
  context: string | null;
  see: string | null;
}

export interface RecipeEntry {
  slug: string;
  title: string;
  summary: string;
}

export interface CliFlag {
  id: string;
  flag: string;
  short?: string | null;
  value?: string | null;
  disputed?: boolean | null;
}

export interface CliCommand {
  id: string;
  word: string;
  synopsis?: string;
  aliases?: string[];
  actions?: string[];
  disputed?: boolean | null;
  flags?: CliFlag[];
}

export interface CliData {
  commands: CliCommand[];
  global_flags: CliFlag[];
}

export interface GraphInput {
  /** Every page file, planned ones included. */
  pages: GraphPage[];
  glossary: GlossaryEntry[];
  recipes: RecipeEntry[];
  cli: CliData;
  engine: Engine;
  components: Record<string, ToMarkdown>;
  /** _data/embeddings.json, or null when it does not exist (the seed then carries no vectors). */
  embeddings?: EmbeddingsArtifact | null;
  /** The capability catalog (src/content/docs/_capabilities/). */
  capabilities?: Capability[];
}

export const CLI_FILE = join(DOCS_DIR, '_data/cli.json');

const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** The graph's input, read from src/content/docs, the cookbook and _data/cli.json. `pages` defaults to every page file. */
export function graphInput(pages: PageFile[] = pageFiles()): GraphInput {
  const glossary: GlossaryEntry[] = [];
  if (existsSync(GLOSSARY_DIR)) {
    for (const name of readdirSync(GLOSSARY_DIR).sort()) {
      if (!name.endsWith('.mdx')) continue;
      const { data } = splitFrontmatter(readFileSync(join(GLOSSARY_DIR, name), 'utf8'), `_glossary/${name}`);
      const id = str(data.id) ?? name.replace(/\.mdx$/, '');
      glossary.push({ id, term: str(data.term) ?? id, short: str(data.short) ?? '', context: str(data.context), see: str(data.see) });
    }
  }
  const recipes = loadRecipes(COOKBOOK_DIR, { validate: false }).recipes.map((r) => ({ slug: r.slug, title: r.front.title, summary: r.front.summary }));
  const cli: CliData = existsSync(CLI_FILE) ? JSON.parse(readFileSync(CLI_FILE, 'utf8')) : { commands: [], global_flags: [] };
  return {
    pages: pages.map((p) => ({ id: p.id, file: p.file, data: p.data, body: splitFrontmatter(readFileSync(p.file, 'utf8'), p.id).body })),
    glossary,
    recipes,
    cli: { commands: cli.commands ?? [], global_flags: cli.global_flags ?? [] },
    engine: readEngine(),
    components: COMPONENT_TWINS,
    embeddings: readEmbeddings(),
    capabilities: readCapabilities(),
  };
}

// ---------------------------------------------------------------------------
// The CLI vocabulary: which words and flags name a command or flag of cli.json

/** The flag spellings a cli.json `flag` field names: `--safe / --no-safe` → both, plus the short form. */
export function flagNames(f: CliFlag): string[] {
  const names = f.flag.split(/[\s,/]+/).filter((t) => t.startsWith('-'));
  if (f.short) names.push(f.short);
  return [...new Set(names)];
}

export interface CliIndex {
  /** Command word or alias → command id. */
  words: Map<string, string>;
  /** Command id → flag spelling → flag ids. */
  commandFlags: Map<string, Map<string, string[]>>;
  /** Query-run flag spelling → flag ids. */
  globalFlags: Map<string, string[]>;
  /** Flag spelling → every command flag id with it. */
  anyCommandFlag: Map<string, string[]>;
}

export function cliIndex(cli: CliData): CliIndex {
  const add = (m: Map<string, string[]>, k: string, id: string) => m.set(k, [...new Set([...(m.get(k) ?? []), id])]);
  const words = new Map<string, string>();
  const commandFlags = new Map<string, Map<string, string[]>>();
  const anyCommandFlag = new Map<string, string[]>();
  for (const c of cli.commands) {
    for (const w of [c.word, ...(c.aliases ?? [])]) words.set(w, c.id);
    const m = new Map<string, string[]>();
    for (const f of c.flags ?? []) {
      for (const n of flagNames(f)) {
        add(m, n, f.id);
        add(anyCommandFlag, n, f.id);
      }
    }
    commandFlags.set(c.id, m);
  }
  const globalFlags = new Map<string, string[]>();
  for (const f of cli.global_flags) for (const n of flagNames(f)) add(globalFlags, n, f.id);
  return { words, commandFlags, globalFlags, anyCommandFlag };
}

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);
const CONFIG_LANGS = new Set(['json', 'jsonc', 'json5', 'toml', 'yaml', 'yml']);
/** Words that may stand before a command on its line without being the command. */
const PREFIX_WORDS = new Set(['sudo', 'exec', 'command', 'env', 'time', 'nohup', 'then', 'do', 'else', '!']);
const FLAG_TOKEN = /^--?[A-Za-z][\w-]*/;
const isRelate = (t: string) => /^(?:\S*\/)?relate$/.test(t);

/**
 * `Command:<id>` and `Flag:<id>` keys for one relate invocation (its tokens
 * after `relate`). A flag is the command's own when cli.json lists it under
 * the command, else the query-run flag of that spelling.
 */
function invocationRefs(args: string[], idx: CliIndex, out: Set<string>) {
  const command = args.length && idx.words.has(args[0]) ? idx.words.get(args[0])! : null;
  if (command) out.add(`Command:${command}`);
  for (const t of args.slice(command ? 1 : 0)) {
    if (t === '--') {
      for (const id of idx.globalFlags.get('--') ?? []) out.add(`Flag:${id}`);
      break;
    }
    const m = FLAG_TOKEN.exec(t);
    if (!m) continue;
    const ids = (command && idx.commandFlags.get(command)?.get(m[0])) || idx.globalFlags.get(m[0]) || [];
    for (const id of ids) out.add(`Flag:${id}`);
  }
}

/**
 * The relate invocations in a shell block, each as its tokens after `relate`.
 * An invocation starts a command line (after variable assignments and words
 * such as `sudo`), or follows a launcher's `--` (`claude mcp add relate --
 * relate serve …`). Quoted strings are one opaque token, so the words of a
 * statement are never read as flags; `#` comments are dropped.
 */
export function shellInvocations(code: string): string[][] {
  const out: string[][] = [];
  const text = code.replace(/\\\r?\n/g, ' ');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' Q ').replace(/(^|\s)#.*$/, '$1');
    for (const segment of line.split(/\|\|?|&&|;|\$\(|[()`]/)) {
      const tokens = segment.trim().split(/\s+/).filter(Boolean);
      const startAt = (j: number) => {
        while (j < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[j]) || PREFIX_WORDS.has(tokens[j]))) j++;
        return j;
      };
      let i = startAt(0);
      while (i < tokens.length) {
        if (isRelate(tokens[i])) {
          const args: string[] = [];
          let j = i + 1;
          while (j < tokens.length && !(tokens[j] === '--' && isRelate(tokens[j + 1] ?? ''))) args.push(tokens[j++]);
          out.push(args);
          if (j >= tokens.length) break;
          i = startAt(j + 1);
          continue;
        }
        const sep = tokens.indexOf('--', i);
        if (sep < 0) break;
        i = startAt(sep + 1);
      }
    }
  }
  return out;
}

/** The relate invocations in a host config block: a `command` of `relate` with its `args` list. */
export function configInvocations(code: string): string[][] {
  const out: string[][] = [];
  const re = /["']?command["']?\s*[:=]\s*["']?(?:[^\s"',]*\/)?relate(?![\w-])["']?[\s\S]*?["']?args["']?\s*[:=]\s*\[([^\]]*)\]/g;
  for (const m of code.matchAll(re)) out.push([...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((a) => a[1] ?? a[2]));
  return out;
}

/** The command and flag keys a fenced block names. */
export function codeRefs(lang: string, code: string, idx: CliIndex): Set<string> {
  const out = new Set<string>();
  const invocations = SHELL_LANGS.has(lang) ? shellInvocations(code) : CONFIG_LANGS.has(lang) ? configInvocations(code) : [];
  for (const args of invocations) invocationRefs(args, idx, out);
  return out;
}

/**
 * The command and flag keys an inline code span names: `relate serve …` as a
 * command line, or a bare flag (`--read-only`). A bare flag is the page's own
 * command's flag when the page is that command's reference page
 * (`reference/cli/<word>`), else the query-run flag, else every command flag
 * of that spelling.
 */
export function inlineRefs(value: string, idx: CliIndex, pageCommand: string | null): Set<string> {
  const out = new Set<string>();
  const v = value.trim();
  if (/^(?:\S*\/)?relate(?:\s|$)/.test(v)) {
    for (const args of shellInvocations(v)) invocationRefs(args, idx, out);
    return out;
  }
  // The bare end-of-options token `--` names no letters, so the pattern below misses it.
  const m = v === '--' ? ['--', '--'] : /^(--?[A-Za-z][\w-]*)(?:[= ][^\s]*)?(?:\s*\/\s*--?[A-Za-z][\w-]*)?$/.exec(v);
  if (!m) return out;
  const name = m[1];
  const ids = (pageCommand && idx.commandFlags.get(pageCommand)?.get(name)) || idx.globalFlags.get(name) || idx.anyCommandFlag.get(name) || [];
  for (const id of ids) out.add(`Flag:${id}`);
  return out;
}

// ---------------------------------------------------------------------------
// Building

const plain = unified().use(remarkParse).use(remarkGfm).freeze();
const NOT_EXAMPLES = new Set(['mermaid']);
const RESULT_LANGS = new Set(['table', 'gram']);
/** The twin's `last_updated` while counting tokens: the length of any real date. */
const FIXED_DATE = '0000-00-00';

const abs = (path: string) => `${CANONICAL_ORIGIN}${path}`;

function stripPositions(node: RootContent | Root) {
  delete (node as { position?: unknown }).position;
  if ('children' in node) for (const c of (node as Parent).children) stripPositions(c as RootContent);
}

function visit(node: RootContent | Root, fn: (n: RootContent) => void) {
  if (node.type !== 'root') fn(node as RootContent);
  if ('children' in node) for (const c of (node as Parent).children) visit(c as RootContent, fn);
}

interface Target {
  label: 'Page' | 'CookbookRecipe';
  id: string;
  anchor: string | null;
}

/** What a link or a frontmatter reference points at, among the graph's pages and recipes, or null. */
function targetOf(href: string, pages: Set<string>, recipes: Set<string>): Target | null {
  let h = href.trim();
  if (h.startsWith(CANONICAL_ORIGIN)) h = h.slice(CANONICAL_ORIGIN.length) || '/';
  if (!h.startsWith('/')) h = h.startsWith('cookbook/') ? `/${h}` : `/docs/${h}`;
  const hashAt = h.indexOf('#');
  const anchor = hashAt >= 0 ? h.slice(hashAt + 1) || null : null;
  const recipe = /^\/cookbook\/([^/#?]+?)(?:\/(?:index\.md)?)?(?:[?#].*)?$/.exec(h);
  if (recipe) return recipes.has(recipe[1]) ? { label: 'CookbookRecipe', id: recipe[1], anchor } : null;
  const id = docsIdOf(h);
  if (id === null || id === '' || !pages.has(id)) return null;
  return { label: 'Page', id, anchor };
}

/** The docs graph of `input`. */
export function buildGraph(input: GraphInput): DocsGraph {
  const nodes: GraphNode[] = [];
  const rels: GraphRel[] = [];
  const problems: string[] = [];
  const node = (label: Label, id: string, props: Props) => nodes.push({ label, id, props: { id, ...props } });
  const rel = (type: RelType, from: { label: Label; id: string }, to: { label: Label; id: string }, props: Props = {}) =>
    rels.push({ type, from: { label: from.label, id: from.id }, to: { label: to.label, id: to.id }, props });

  const { engine } = input;
  const published = input.pages.filter((p) => p.data.status !== 'planned');
  const publishedIds = new Set(published.map((p) => p.id));
  const allIds = new Set(input.pages.map((p) => p.id));
  const recipeIds = new Set(input.recipes.map((r) => r.slug));
  const glossary = new Map(input.glossary.map((g) => [g.id, g]));
  const idx = cliIndex(input.cli);
  // Links render as the served twins render them: the generated pages (glossary, changelog) are published too,
  // but they are not Page nodes, so no LINKS_TO points at them.
  const linkCtx = { pages: new Set([...publishedIds, ...GENERATED_IDS]) };

  // Surfaces, the glossary, the cookbook and the CLI.
  for (const s of SURFACES) node('Surface', s, {});
  for (const g of input.glossary) {
    node('Term', g.id, {
      term: g.term,
      short: g.short,
      context: g.context,
      see: g.see,
      url: linkCtx.pages.has(GLOSSARY_ID) ? abs(glossaryHref(g.id)) : null,
    });
  }
  for (const r of input.recipes) {
    node('CookbookRecipe', r.slug, { title: r.title, summary: r.summary, url: abs(`/cookbook/${r.slug}/`), md_url: abs(`/cookbook/${r.slug}/index.md`) });
  }
  for (const c of input.cli.commands) {
    node('Command', c.id, { word: c.word, synopsis: c.synopsis ?? null, disputed: c.disputed ? true : null });
    for (const f of c.flags ?? []) {
      node('Flag', f.id, { flag: f.flag, names: flagNames(f), command: c.id, value: f.value ?? null, disputed: f.disputed ? true : null });
      rel('HAS_FLAG', { label: 'Command', id: c.id }, { label: 'Flag', id: f.id });
    }
  }
  for (const f of input.cli.global_flags) {
    node('Flag', f.id, { flag: f.flag, names: flagNames(f), value: f.value ?? null, disputed: f.disputed ? true : null });
  }

  // The indexes.
  node('Index', 'llms.txt', { url: abs('/docs/llms.txt'), title: 'Docs index for agents' });
  node('Index', 'landing', { url: abs('/docs/'), title: 'Docs landing' });
  for (const p of published) if (sectionOf(p.id) !== null) rel('LISTS', { label: 'Index', id: 'llms.txt' }, { label: 'Page', id: p.id });
  const landing = new Set([...TASKS.flatMap((g) => g.tasks.map((t) => t.page)), ...PRIMARY.map((t) => t.page)].filter((id) => publishedIds.has(id)));
  for (const id of landing) rel('LISTS', { label: 'Index', id: 'landing' }, { label: 'Page', id });

  // Pages.
  for (const page of input.pages) {
    const { id, data } = page;
    const planned = data.status === 'planned';
    const me = { label: 'Page' as const, id };
    const props: Props = {
      url: planned ? null : abs(pageUrl(id)),
      md_url: planned ? null : abs(twinUrl(id)),
      title: str(data.title) ?? id,
      description: str(data.description),
      type: typeOf(id),
      section: sectionOf(id),
      status: str(data.status) ?? 'stable',
      since: str(data.since),
      verified: planned ? null : engine.verified,
      tokens: null,
    };
    for (const s of strList(data.surfaces)) if ((SURFACES as readonly string[]).includes(s)) rel('APPLIES_TO', me, { label: 'Surface', id: s });
    if (planned) {
      node('Page', id, props);
      continue;
    }
    for (const pre of strList(data.prerequisites)) {
      const t = targetOf(pre, allIds, recipeIds);
      if (t?.label === 'Page' && t.id !== id) rel('PREREQUISITE_OF', { label: 'Page', id: t.id }, me);
    }
    for (const r of strList(data.related)) {
      const t = targetOf(r, allIds, recipeIds);
      if (t && !(t.label === 'Page' && t.id === id)) rel('RELATED_TO', me, t, { anchor: t.anchor });
    }

    const pageData = { ...data, title: str(data.title) ?? id, description: str(data.description) ?? '' } as Parameters<typeof renderTwin>[0]['data'];
    try {
      const twin = renderTwin({ id, file: page.file, body: page.body, data: pageData, lastUpdated: FIXED_DATE }, { links: linkCtx, glossary: glossaryTerms(input.glossary), components: input.components, engine });
      props.tokens = estimateTokens(twin.markdown);
    } catch {
      // Reported below, from the same renderer.
    }
    node('Page', id, props);
    pageBody(page, props.title as string, { idx, linkCtx, input, recipeIds }, problems, node, rel);
  }

  // Terms used that the glossary lacks: a node with no `short`, for the check to name.
  const unknownTerms = new Set(rels.filter((r) => r.type === 'USES_TERM' && !glossary.has(r.to.id)).map((r) => r.to.id));
  for (const t of [...unknownTerms].sort()) node('Term', t, {});

  // Extension point: the capability catalog (src/lib/docs/capabilities.ts capabilityGraphRows).
  const cap = capabilityGraphRows(input.capabilities ?? []);
  for (const n of cap.nodes) node(n.label as Label, n.id, n.props);
  for (const r of cap.rels) rel(r.type as RelType, r.from as { label: Label; id: string }, r.to as { label: Label; id: string }, r.props);

  const g = finish(nodes, rels, engine, problems);
  g.vectors = freshVectors(g, input.embeddings ?? null);
  return g;
}

const glossaryTermsCache = new WeakMap<GlossaryEntry[], Map<string, { id: string; term: string; short: string }>>();
function glossaryTerms(entries: GlossaryEntry[]) {
  let m = glossaryTermsCache.get(entries);
  if (!m) {
    m = new Map(entries.map((g) => [g.id, { id: g.id, term: g.term, short: g.short }]));
    glossaryTermsCache.set(entries, m);
  }
  return m;
}

interface BodyContext {
  idx: CliIndex;
  linkCtx: { pages: Set<string> };
  input: GraphInput;
  recipeIds: Set<string>;
}

/** A published page's sections, examples, links, terms and CLI references. */
function pageBody(
  page: GraphPage,
  title: string,
  ctx: BodyContext,
  problems: string[],
  node: (label: Label, id: string, props: Props) => void,
  rel: (type: RelType, from: { label: Label; id: string }, to: { label: Label; id: string }, props?: Props) => void,
) {
  const { id } = page;
  const me = { label: 'Page' as const, id };
  let tree: Root;
  try {
    tree = parsePage(page.body);
  } catch (e) {
    // Not valid MDX: docs:check reports it; the page keeps its node and frontmatter edges only.
    problems.push(`${id}: ${(e as Error).message.split('\n')[0]}`);
    return;
  }

  // Heading anchors as the page's HTML has them: every source heading, slugged in order.
  const slugger = new GithubSlugger();
  const anchors = new Map<Heading, string>();
  const terms: string[] = [];
  visit(tree, (n) => {
    if (n.type === 'heading') anchors.set(n, slugger.slug(toString(n)));
    if (n.type === 'textDirective' && n.name === 'term' && n.attributes?.id) terms.push(n.attributes.id);
  });
  for (const t of new Set(terms)) rel('USES_TERM', me, { label: 'Term', id: t });

  // The twin's tree: constructs in their markdown form, components' markdown parsed in place.
  let rendered = true;
  try {
    renderConstructs(tree, 'markdown', { file: page.file, source: page.body, links: ctx.linkCtx, glossary: glossaryTerms(ctx.input.glossary), components: ctx.input.components });
  } catch (e) {
    rendered = false;
    problems.push(`${id}: ${(e as Error).message.split('\n')[0]}`);
  }
  const top: RootContent[] = [];
  for (const child of tree.children) {
    if (rendered && child.type === 'html' && !child.position) {
      const parsed = plain.parse(child.value);
      stripPositions(parsed);
      top.push(...parsed.children);
    } else top.push(child);
  }

  // Sections: split at each H2 and H3 the author wrote (a tab's heading in the twin has no position).
  interface Sec {
    anchor: string;
    heading: string;
    level: number;
    nodes: RootContent[];
  }
  const sections: Sec[] = [{ anchor: '', heading: title, level: 1, nodes: [] }];
  for (const child of top) {
    if (child.type === 'heading' && child.position && (child.depth === 2 || child.depth === 3)) {
      sections.push({ anchor: anchors.get(child) ?? '', heading: toString(child), level: child.depth, nodes: [] });
    } else sections[sections.length - 1].nodes.push(child);
  }

  const pageCommand = /^reference\/cli\/([^/]+)$/.exec(id)?.[1] ?? null;
  const pageCommandId = pageCommand && ctx.idx.words.has(pageCommand) ? ctx.idx.words.get(pageCommand)! : null;
  const documents = new Set<string>();
  let exampleSeq = 0;
  let cellSeq = 0;
  const links = new Map<string, Target>();

  let sectionSeq = 0;
  for (const sec of sections) {
    const isIntro = sec.level === 1;
    if (isIntro && !sec.nodes.length) continue;
    const secId = `${id}#${sec.anchor}`;
    let text: string;
    try {
      text = stringifyMarkdown({ type: 'root', children: sec.nodes } as Root).trim();
    } catch {
      text = sec.nodes.map((n) => toString(n)).join('\n\n').trim();
    }
    node('Section', secId, {
      page: id,
      anchor: sec.anchor,
      heading: sec.heading,
      level: sec.level,
      position: ++sectionSeq,
      url: abs(sec.anchor ? `${pageUrl(id)}#${sec.anchor}` : pageUrl(id)),
      text,
      length: text.length,
    });
    rel('HAS_SECTION', me, { label: 'Section', id: secId });

    for (const n of sec.nodes) {
      visit(n, (d) => {
        if (d.type === 'code') {
          exampleCode(d);
        } else if (d.type === 'inlineCode') {
          for (const k of inlineRefs(d.value, ctx.idx, pageCommandId)) documents.add(k);
        } else if (d.type === 'link') {
          linkTarget(d);
        }
      });
    }

    function exampleCode(d: Code) {
      const lang = d.lang ?? 'text';
      let run = null;
      try {
        run = parseRunInfo(d.lang, d.meta);
      } catch {
        // A malformed run fence: docs:check reports it.
      }
      if (run) cellSeq++;
      for (const k of codeRefs(lang, d.value, ctx.idx)) documents.add(k);
      if (NOT_EXAMPLES.has(lang) || (!d.position && RESULT_LANGS.has(lang))) return;
      const exId = `${id}#example-${++exampleSeq}`;
      node('Example', exId, {
        page: id,
        section: sec.anchor,
        position: exampleSeq,
        lang,
        first_line: d.value.split('\n').find((l) => l.trim()) ?? '',
        title: /(?:^|\s)title="([^"]*)"/.exec(d.meta ?? '')?.[1] ?? null,
        runnable: run ? true : null,
        cell: run ? (run.name ?? `cell-${cellSeq}`) : null,
      });
      rel('HAS_EXAMPLE', me, { label: 'Example', id: exId });
    }

    function linkTarget(d: Link) {
      // A :term's link (no position) is USES_TERM, not a link.
      if (!d.position && rendered && /\/docs\/reference\/glossary\/#/.test(d.url)) return;
      if (d.url.startsWith('#')) return;
      const t = targetOf(d.url, ctx.linkCtx.pages, ctx.recipeIds);
      if (!t || (t.label === 'Page' && (t.id === id || GENERATED_IDS.has(t.id)))) return;
      const key = `${t.label}:${t.id}#${t.anchor ?? ''}`;
      if (!links.has(key)) links.set(key, t);
    }
  }

  for (const t of links.values()) rel('LINKS_TO', me, { label: t.label, id: t.id }, { anchor: t.anchor });
  for (const k of documents) {
    const [label, ref] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    rel('DOCUMENTS', me, { label: label as Label, id: ref });
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const propsKey = (p: Props) => JSON.stringify(Object.entries(p).filter(([, v]) => v !== null && v !== undefined));

/** Sorted, deduplicated, with relationships to missing nodes dropped. */
function finish(nodes: GraphNode[], rels: GraphRel[], engine: Engine, problems: string[]): DocsGraph {
  const labelOrder = new Map(LABELS.map((l, i) => [l, i]));
  const typeOrder = new Map(REL_TYPES.map((t, i) => [t, i]));
  const byKey = new Map<string, GraphNode>();
  for (const n of nodes) if (!byKey.has(nodeKey(n))) byKey.set(nodeKey(n), n);
  const outNodes = [...byKey.values()].sort((a, b) => labelOrder.get(a.label)! - labelOrder.get(b.label)! || cmp(a.id, b.id));
  const seen = new Set<string>();
  const outRels: GraphRel[] = [];
  for (const r of rels) {
    if (!byKey.has(nodeKey(r.from)) || !byKey.has(nodeKey(r.to))) continue;
    const k = `${r.type}|${nodeKey(r.from)}|${nodeKey(r.to)}|${propsKey(r.props)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outRels.push(r);
  }
  outRels.sort(
    (a, b) =>
      typeOrder.get(a.type)! - typeOrder.get(b.type)! ||
      labelOrder.get(a.from.label)! - labelOrder.get(b.from.label)! ||
      labelOrder.get(a.to.label)! - labelOrder.get(b.to.label)! ||
      cmp(a.from.id, b.from.id) ||
      cmp(a.to.id, b.to.id) ||
      cmp(propsKey(a.props), propsKey(b.props)),
  );
  return { nodes: outNodes, rels: outRels, engine, problems, vectors: new Map() };
}

// ---------------------------------------------------------------------------
// Section embeddings (DOCS-PLAN.md §3.5, §3.8, §8 item 3e)
//
// src/content/docs/_data/embeddings.json is a committed artifact: one vector
// per Section, written by the authoring-only package in scripts/embeddings/
// (`npm run docs:embeddings`), never by the build or CI, which only read it.
// Each entry carries the SHA-256 of the exact text it embedded
// (sectionInputs): a section whose text changed has a stale entry, which the
// seed leaves out and docs:check reports. The vectors are float16, little
// endian, base64: about 1 KB a section.

export const EMBEDDINGS_FILE = join(DOCS_DIR, '_data/embeddings.json');
export const EMBEDDINGS_FORMAT = 1;
export const EMBEDDING_DIMENSION = 384;
export const EMBEDDING_PROPERTY = 'embedding';
export const VECTOR_INDEX = 'docs_vector';
/**
 * The Section properties `docs_vector` declares with `WITH [...]`: a vector
 * search may filter on them inside the search, before it ranks (ADR-0028).
 * `page` lets a statement search only the sections of pages a traversal
 * chose (`WHERE s.page IN $pages`), as the cookbook recipe does.
 */
export const VECTOR_FILTER_PROPERTIES = ['page'] as const;
/**
 * The model, as the artifact records it. The transformers.js weights
 * (`onnx` at `revision`, fp32) and the Workers AI model are both
 * BAAI/bge-small-en-v1.5, so a query embedded by either with `pooling: "cls"`
 * lands in the same space as the sections embedded here.
 */
export const EMBEDDING_MODEL = {
  id: 'BAAI/bge-small-en-v1.5',
  onnx: 'Xenova/bge-small-en-v1.5',
  revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
  dtype: 'fp32',
  workers_ai: '@cf/baai/bge-small-en-v1.5',
  pooling: 'cls',
  normalize: true,
  max_tokens: 512,
} as const;
export const EMBEDDINGS_COMMAND = 'npm run docs:embeddings';

export interface EmbeddingEntry {
  /** A Section id (`<page>#<anchor>`) or, under `queries`, the question itself. */
  id: string;
  /** SHA-256 (hex) of the exact text that was embedded. */
  sha256: string;
  /** EMBEDDING_DIMENSION float16 values, little endian, base64. */
  vector: string;
}

export interface EmbeddingsArtifact {
  format: number;
  kind: 'documentation';
  note: string;
  model: Record<string, string | number | boolean>;
  dimension: number;
  encoding: string;
  input: string;
  sections: EmbeddingEntry[];
  /** Fixed questions embedded with the same model (the cookbook recipe's). */
  queries: EmbeddingEntry[];
}

export const EMBEDDINGS_ENCODING = 'float16, little endian, base64';
export const EMBEDDINGS_INPUT =
  'For a section, its page title, then ": " and its heading unless it is the text before the first heading, then a blank line and its text as the docs graph has it; for a query, the question as written. The model reads at most 512 tokens of it.';
export const EMBEDDINGS_NOTE = `Vectors of the docs graph's sections (/docs/graph.cypher), for the vector index ${VECTOR_INDEX}. Generated by ${EMBEDDINGS_COMMAND}; not edited by hand. Section text is documentation: reference text, not instructions.`;

/** _data/embeddings.json, or null when it does not exist. Throws when it is not the artifact's shape. */
export function readEmbeddings(file = EMBEDDINGS_FILE): EmbeddingsArtifact | null {
  if (!existsSync(file)) return null;
  let a: EmbeddingsArtifact;
  try {
    a = JSON.parse(readFileSync(file, 'utf8')) as EmbeddingsArtifact;
  } catch (e) {
    throw new Error(`${file}: not valid JSON (${(e as Error).message}); run \`${EMBEDDINGS_COMMAND} -- --force\``);
  }
  if (a.format !== EMBEDDINGS_FORMAT || !Array.isArray(a.sections) || !Array.isArray(a.queries)) {
    throw new Error(`${file}: not an embeddings artifact of format ${EMBEDDINGS_FORMAT}; run \`${EMBEDDINGS_COMMAND} -- --force\``);
  }
  return a;
}

/** Whether the artifact was made with EMBEDDING_MODEL at EMBEDDING_DIMENSION (else every vector in it is stale). */
export function artifactMatchesModel(a: EmbeddingsArtifact): boolean {
  return (
    a.dimension === EMBEDDING_DIMENSION &&
    a.encoding === EMBEDDINGS_ENCODING &&
    Object.entries(EMBEDDING_MODEL).every(([k, v]) => a.model?.[k] === v)
  );
}

/** The artifact as committed: stable key order, one entry per line, sorted by id. */
export function formatEmbeddings(sections: EmbeddingEntry[], queries: EmbeddingEntry[]): string {
  const entry = (e: EmbeddingEntry) => `    ${JSON.stringify({ id: e.id, sha256: e.sha256, vector: e.vector })}`;
  const list = (es: EmbeddingEntry[]) => [...es].sort((a, b) => cmp(a.id, b.id)).map(entry).join(',\n');
  const head = {
    format: EMBEDDINGS_FORMAT,
    kind: 'documentation',
    note: EMBEDDINGS_NOTE,
    model: EMBEDDING_MODEL,
    dimension: EMBEDDING_DIMENSION,
    encoding: EMBEDDINGS_ENCODING,
    input: EMBEDDINGS_INPUT,
  };
  const top = JSON.stringify(head, null, 2).replace(/\n\}$/, '');
  return `${top},\n  "sections": [\n${list(sections)}\n  ],\n  "queries": [\n${list(queries)}\n  ]\n}\n`;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The float16 bit pattern nearest `x` (through float32, ties to even). */
export function toFloat16Bits(x: number): number {
  f32[0] = x;
  const bits = u32[0];
  const sign = (bits >>> 16) & 0x8000;
  const exp = (bits >>> 23) & 0xff;
  let mant = bits & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let h = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const half = 1 << (shift - 1);
    if (rem > half || (rem === half && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && h & 1)) h++;
  return sign | h;
}

/** The value of a float16 bit pattern. */
export function fromFloat16Bits(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >>> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return sign * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : sign * Infinity;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}

export function encodeVector(v: ArrayLike<number>): string {
  const buf = Buffer.alloc(v.length * 2);
  for (let i = 0; i < v.length; i++) buf.writeUInt16LE(toFloat16Bits(v[i]), i * 2);
  return buf.toString('base64');
}

export function decodeVector(s: string): number[] {
  const buf = Buffer.from(s, 'base64');
  const out: number[] = [];
  for (let i = 0; i + 1 < buf.length; i += 2) out.push(fromFloat16Bits(buf.readUInt16LE(i)));
  return out;
}

/**
 * A float16 value as the shortest decimal literal that reads back as the same
 * float16 (`-0.02689`, `0.0`), so the seed carries no more digits than the
 * artifact holds.
 */
export function float16Literal(x: number): string {
  const bits = toFloat16Bits(x);
  if ((bits & 0x7fff) === 0) return '0.0';
  for (let p = 1; p <= 8; p++) {
    const s = Number(x.toPrecision(p));
    if (toFloat16Bits(s) === bits) {
      const t = String(s);
      return /[.e]/.test(t) ? t : `${t}.0`;
    }
  }
  return String(x);
}

export const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface SectionInput {
  id: string;
  /** The text the model embeds. */
  input: string;
  sha256: string;
}

/** The text each Section is embedded from (EMBEDDINGS_INPUT), sorted by id. */
export function sectionInputs(g: Pick<DocsGraph, 'nodes'>): SectionInput[] {
  const titles = new Map(g.nodes.filter((n) => n.label === 'Page').map((n) => [n.id, String(n.props.title ?? n.id)]));
  const out: SectionInput[] = [];
  for (const n of g.nodes) {
    if (n.label !== 'Section') continue;
    const title = titles.get(String(n.props.page)) ?? String(n.props.page);
    const head = Number(n.props.level) === 1 ? title : `${title}: ${n.props.heading}`;
    const input = `${head}\n\n${n.props.text ?? ''}`;
    out.push({ id: n.id, input, sha256: sha256Hex(input) });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

/** Section id → vector, for the entries whose hash matches the section's input now. */
function freshVectors(g: DocsGraph, a: EmbeddingsArtifact | null): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!a || !artifactMatchesModel(a)) return out;
  const byId = new Map(a.sections.map((e) => [e.id, e]));
  for (const s of sectionInputs(g)) {
    const e = byId.get(s.id);
    if (!e || e.sha256 !== s.sha256) continue;
    const v = decodeVector(e.vector);
    if (v.length === EMBEDDING_DIMENSION && v.every(Number.isFinite)) out.set(s.id, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The seed script

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `v` as a Cypher literal on one line. */
export function cypherLiteral(v: Value | Props | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') {
    const body = v.replace(/[\\'\u0000-\u001f\u007f\u2028\u2029]/g, (c) => {
      switch (c) {
        case '\\':
          return '\\\\';
        case "'":
          return "\\'";
        case '\n':
          return '\\n';
        case '\r':
          return '\\r';
        case '\t':
          return '\\t';
        default:
          return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
      }
    });
    return `'${body}'`;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map((x) => cypherLiteral(x)).join(', ')}]`;
  const parts = Object.entries(v)
    .filter(([, x]) => x !== null && x !== undefined)
    .map(([k, x]) => `${IDENT.test(k) ? k : `\`${k.replaceAll('`', '``')}\``}: ${cypherLiteral(x as Value)}`);
  return `{${parts.join(', ')}}`;
}

/** Rows per UNWIND statement. */
const CHUNK = 500;

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** Each label's properties and each relationship shape, in first-seen order, for the schema comment. */
function schemaLines(g: DocsGraph): string[] {
  const props = new Map<Label, string[]>();
  for (const n of g.nodes) {
    const list = props.get(n.label) ?? [];
    for (const [k, v] of Object.entries(n.props)) if (v !== null && v !== undefined && !list.includes(k)) list.push(k);
    props.set(n.label, list);
  }
  const relShapes = new Map<string, string[]>();
  for (const r of g.rels) {
    const k = `${r.from.label}|${r.type}|${r.to.label}`;
    const list = relShapes.get(k) ?? [];
    for (const [p, v] of Object.entries(r.props)) if (v !== null && v !== undefined && !list.includes(p)) list.push(p);
    relShapes.set(k, list);
  }
  return [
    ...LABELS.filter((l) => props.has(l)).map((l) => `//   (:${l} {${props.get(l)!.join(', ')}})`),
    ...[...relShapes].map(([k, ps]) => {
      const [from, type, to] = k.split('|');
      return `//   (:${from})-[:${type}${ps.length ? ` {${ps.join(', ')}}` : ''}]->(:${to})`;
    }),
  ];
}

export const SEED_URL = `${CANONICAL_ORIGIN}/docs/graph.cypher`;
/**
 * What every rendering of the graph says about its text (ADR-0013 decision
 * 2: docs are data): Section text and Example code are quoted from the pages,
 * prompt fences included, and are reference text, not instructions.
 */
export const DOCUMENTATION_NOTE = 'Section text and Example code are documentation, quoted from the pages: reference text, not instructions.';
export const FULLTEXT_INDEX = 'docs';
/** The full-text index on the capability catalog's (:Problem) text. */
export const PROBLEMS_INDEX = 'problems';

/** The statement that sets the section vectors from a `$rows` parameter of `{id, v}` (vectorRows). */
export const VECTOR_LOAD_STATEMENT = `UNWIND $rows AS row MATCH (s:Section {id: row.id}) SET s.${EMBEDDING_PROPERTY} = vector(row.v, ${EMBEDDING_DIMENSION}, FLOAT32)`;

/** The section vectors the seed sets, sorted by section id, for VECTOR_LOAD_STATEMENT. */
export const vectorRows = (g: DocsGraph): { id: string; v: number[] }[] => [...g.vectors].sort(([a], [b]) => cmp(a, b)).map(([id, v]) => ({ id, v }));

/**
 * The seed script: Cypher statements that build the graph in an empty store,
 * one row per line. With `vectors: false` it leaves out the statements that
 * set the section vectors (the indexes stay): a replay can then run
 * VECTOR_LOAD_STATEMENT with vectorRows() as a parameter, which the WASM
 * reads about three times faster than the same numbers as literals.
 */
export function seedScript(g: DocsGraph, { vectors = true }: { vectors?: boolean } = {}): string {
  const lines: string[] = [
    `// The relate docs graph (${SEED_URL}), as Cypher statements for an empty store.`,
    `// Generated from the docs pages, the glossary, the cookbook and the CLI facts file; the pages are the source.`,
    `// ${DOCUMENTATION_NOTE}`,
    `// Verified against relate ${g.engine.verified}. ${g.nodes.length} nodes, ${g.rels.length} relationships.`,
    `// Built into a store with: relate query --database ./relate-docs.rl < graph.cypher`,
    `// Schema:`,
    ...schemaLines(g),
    `//   (:Section).${EMBEDDING_PROPERTY}: VECTOR<FLOAT32>(${EMBEDDING_DIMENSION}), ${EMBEDDING_MODEL.id} (Workers AI ${EMBEDDING_MODEL.workers_ai}, ${EMBEDDING_MODEL.pooling} pooling, normalized), on ${g.vectors.size} of ${g.nodes.filter((n) => n.label === 'Section').length} sections`,
    `//   FULLTEXT INDEX ${FULLTEXT_INDEX} on (:Section) heading and text`,
    `//   VECTOR INDEX ${VECTOR_INDEX} on (:Section) ${EMBEDDING_PROPERTY}, ${EMBEDDING_DIMENSION} dimensions, cosine, filterable on ${VECTOR_FILTER_PROPERTIES.join(', ')}`,
    `//   FULLTEXT INDEX ${PROBLEMS_INDEX} on (:Problem) text`,
    '',
  ];
  const present = LABELS.filter((l) => g.nodes.some((n) => n.label === l));
  for (const l of present) lines.push(`CREATE CONSTRAINT ${l.toLowerCase()}_id IF NOT EXISTS FOR (n:${l}) REQUIRE n.id IS UNIQUE;`);
  lines.push('');
  for (const l of present) {
    for (const rows of chunks(g.nodes.filter((n) => n.label === l))) {
      lines.push('UNWIND [', ...rows.map((n, i) => `${cypherLiteral(n.props)}${i < rows.length - 1 ? ',' : ''}`), `] AS row CREATE (n:${l}) SET n = row;`);
    }
  }
  lines.push('');
  const groups = new Map<string, GraphRel[]>();
  for (const r of g.rels) {
    const k = `${r.type}|${r.from.label}|${r.to.label}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const [k, list] of groups) {
    const [type, fromLabel, toLabel] = k.split('|');
    const withProps = list.some((r) => Object.values(r.props).some((v) => v !== null && v !== undefined));
    for (const rows of chunks(list)) {
      const row = (r: GraphRel) => cypherLiteral({ from: r.from.id, to: r.to.id }).replace(/\}$/, withProps ? `, p: ${cypherLiteral(r.props)}}` : '}');
      lines.push(
        'UNWIND [',
        ...rows.map((r, i) => `${row(r)}${i < rows.length - 1 ? ',' : ''}`),
        `] AS row MATCH (a:${fromLabel} {id: row.from}), (b:${toLabel} {id: row.to}) CREATE (a)-[${withProps ? 'r' : ''}:${type}]->(b)${withProps ? ' SET r = row.p' : ''};`,
      );
    }
  }
  // The section vectors, after the rows they belong to: one row per section, `vector()` as the length guard.
  const allRows = vectors ? vectorRows(g) : [];
  if (allRows.length) lines.push('');
  for (let i = 0; i < allRows.length; i += VECTOR_CHUNK) {
    const rows = allRows.slice(i, i + VECTOR_CHUNK);
    lines.push(
      'UNWIND [',
      ...rows.map(({ id, v }, j) => `{id: ${cypherLiteral(id)}, v: [${v.map(float16Literal).join(', ')}]}${j < rows.length - 1 ? ',' : ''}`),
      VECTOR_SEED_END,
    );
  }
  lines.push(
    '',
    `CREATE FULLTEXT INDEX ${FULLTEXT_INDEX} IF NOT EXISTS FOR (s:Section) ON EACH [s.heading, s.text];`,
    `CREATE FULLTEXT INDEX ${PROBLEMS_INDEX} IF NOT EXISTS FOR (n:Problem) ON EACH [n.text];`,
    `CREATE VECTOR INDEX ${VECTOR_INDEX} IF NOT EXISTS FOR (s:Section) ON (s.${EMBEDDING_PROPERTY}) WITH [${VECTOR_FILTER_PROPERTIES.map((p) => `s.${p}`).join(', ')}] OPTIONS {indexConfig: {\`vector.dimensions\`: ${EMBEDDING_DIMENSION}, \`vector.similarity_function\`: 'cosine'}};`,
    '',
  );
  return lines.join('\n');
}

/** Section vectors per UNWIND statement (each row is about 3 KB of literals). */
const VECTOR_CHUNK = 100;

/** The last line of each seed statement that sets section vectors. */
export const VECTOR_SEED_END = `${VECTOR_LOAD_STATEMENT.replace('UNWIND $rows AS row', '] AS row')};`;

// ---------------------------------------------------------------------------
// Hybrid search over the docs graph, and the cookbook recipe's subset

/**
 * Vector and full-text search over the sections, fused by reciprocal rank
 * (the cookbook's hybrid-recall recipe): `$vector` is the question embedded
 * with EMBEDDING_MODEL, `$query` its words, `$k` each list's length, `$limit`
 * the rows returned. A section earns 1 / (60 + rank) from each list it is in.
 */
export const HYBRID_STATEMENT = `CALL () {
  MATCH (s:Section)
  SEARCH s IN (VECTOR INDEX ${VECTOR_INDEX} FOR $vector LIMIT $k) SCORE AS score
  WITH s ORDER BY score DESC, s.id
  WITH collect(s) AS ss
  UNWIND range(0, size(ss) - 1) AS i
  RETURN ss[i] AS s, 'vector' AS list, i + 1 AS rank
  UNION ALL
  MATCH (s:Section)
  SEARCH s IN (FULLTEXT INDEX ${FULLTEXT_INDEX} FOR $query LIMIT $k) SCORE AS score
  WITH s ORDER BY score DESC, s.id
  WITH collect(s) AS ss
  UNWIND range(0, size(ss) - 1) AS i
  RETURN ss[i] AS s, 'fulltext' AS list, i + 1 AS rank
}
WITH s, sum(1.0 / (60 + rank)) AS rrf,
     min(CASE list WHEN 'vector' THEN rank END) AS vector_rank,
     min(CASE list WHEN 'fulltext' THEN rank END) AS fulltext_rank
ORDER BY rrf DESC, s.id LIMIT $limit
RETURN s.id AS id, s.page AS page, s.anchor AS anchor, s.heading AS heading, s.url AS url,
       vector_rank, fulltext_rank, rrf`;

/**
 * The cookbook recipe "Query the relate docs" loads a subset of this graph
 * from its `docs` data block, written by scripts/docs-recipe-data.ts and
 * compared with the graph by docs:check (checks/embeddings.ts). The subset
 * rule: the whole graph's structure without vectors, as far as the recipe's
 * steps read it (every published page with its LINKS_TO and PREREQUISITE_OF
 * to pages, its USES_TERM and APPLIES_TO; every term with its short
 * definition; every capability with its CITES, SOLVES and VERIFIED_BY, and
 * every problem; every recipe with its DEMONSTRATES); every section of
 * RECIPE_PAGES only, its text cut to RECIPE_TEXT_CHARS with whitespace
 * collapsed, its vector rounded to four decimals; and RECIPE_QUESTIONS with
 * their vectors from the artifact's `queries`. Left out: the other
 * sections, examples, CLI commands and flags, the Index nodes, RELATED_TO
 * and links to recipes, which no step reads.
 */
export const RECIPE_SLUG = 'query-the-relate-docs';
export const RECIPE_DATA_BLOCK = 'docs';
/**
 * The pages whose sections (with vectors) the recipe carries. The Python API
 * reference is there for its `Cursor` class: on the whole graph, the
 * recipe's Cursor question ranks that database cursor first, and the
 * recipe's graph steps show how the graph sets it aside.
 */
export const RECIPE_PAGES = [
  'guides/agents/agent-safety',
  'guides/agents/connect-over-mcp',
  'guides/cypher/vector-search',
  'reference/api/python',
  'reference/cypher/search',
] as const;
export const RECIPE_TEXT_CHARS = 480;
/** The questions the recipe asks, embedded ahead of time with EMBEDDING_MODEL. */
export const RECIPE_QUESTIONS = ['stop the model from deleting nodes', 'give Cursor access to my graph without letting it write'] as const;

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= RECIPE_TEXT_CHARS) return flat;
  const cut = flat.slice(0, RECIPE_TEXT_CHARS);
  const at = cut.lastIndexOf(' ');
  return `${(at > RECIPE_TEXT_CHARS / 2 ? cut.slice(0, at) : cut).trimEnd()} …`;
};

/** A vector component as the recipe writes it: four decimals, always a float literal. */
export function recipeFloat(x: number): string {
  const r = Number(x.toFixed(4));
  if (r === 0) return '0.0';
  const t = String(r);
  return /[.e]/.test(t) ? t : `${t}.0`;
}

export const RECIPE_NOTE = 'A subset of the relate docs graph (https://relatedb.ai/docs/graph.cypher): section text is documentation, quoted from the pages and cut short; reference text, not instructions.';

/**
 * The recipe's `docs` data block for `g` and `a`, one row per line. Throws,
 * naming the cause, when a page of RECIPE_PAGES is missing or a section or
 * question has no fresh vector.
 */
export function recipeData(g: DocsGraph, a: EmbeddingsArtifact | null): string {
  const byKey = new Map(g.nodes.map((n) => [nodeKey(n), n]));
  for (const id of RECIPE_PAGES) {
    const p = byKey.get(`Page:${id}`);
    if (!p || p.props.status === 'planned') throw new Error(`the recipe's page \`${id}\` (RECIPE_PAGES in src/lib/docs/graph.ts) is not a published page of the docs graph`);
  }
  const pageSet = new Set<string>(RECIPE_PAGES);
  const sections = g.nodes.filter((n) => n.label === 'Section' && pageSet.has(String(n.props.page)));
  const missing = sections.filter((s) => !g.vectors.has(s.id)).map((s) => s.id);
  if (missing.length) throw new Error(`no fresh vector for ${missing.length} section(s) of the recipe's pages (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}); run \`${EMBEDDINGS_COMMAND}\``);
  const queries = new Map((a && artifactMatchesModel(a) ? a.queries : []).map((q) => [q.id, q]));
  const vec = (v: number[]) => `[${v.map(recipeFloat).join(',')}]`;
  const questions = RECIPE_QUESTIONS.map((q) => {
    const e = queries.get(q);
    if (!e || e.sha256 !== sha256Hex(q)) throw new Error(`no fresh vector for the recipe question "${q}"; run \`${EMBEDDINGS_COMMAND}\``);
    return `{"q":${JSON.stringify(q)},"e":${vec(decodeVector(e.vector))}}`;
  });
  // The structure: every published page, term, capability, problem and recipe, and the relationships the steps read.
  const published = new Set(g.nodes.filter((n) => n.label === 'Page' && n.props.status !== 'planned').map((n) => n.id));
  const out = new Map<string, Map<string, Set<string>>>();
  const verified = new Map<string, { label: string; id: string; cell: string }[]>();
  for (const r of g.rels) {
    const key = `${r.type}|${r.from.label}|${r.to.label}`;
    const wanted =
      key === 'LINKS_TO|Page|Page' || key === 'PREREQUISITE_OF|Page|Page'
        ? published.has(r.from.id) && published.has(r.to.id)
        : key === 'USES_TERM|Page|Term' || key === 'APPLIES_TO|Page|Surface'
          ? published.has(r.from.id)
          : key === 'CITES|Capability|Page'
            ? published.has(r.to.id)
            : key === 'SOLVES|Capability|Problem' || key === 'DEMONSTRATES|CookbookRecipe|Capability';
    if (r.type === 'VERIFIED_BY' && r.from.label === 'Capability' && (r.to.label === 'CookbookRecipe' || published.has(r.to.id))) {
      verified.set(r.from.id, [...(verified.get(r.from.id) ?? []), { label: r.to.label, id: r.to.id, cell: String(r.props.cell ?? '') }]);
    }
    if (!wanted) continue;
    const byType = out.get(nodeKey(r.from)) ?? new Map<string, Set<string>>();
    out.set(nodeKey(r.from), byType.set(r.type, (byType.get(r.type) ?? new Set()).add(r.to.id)));
  }
  const targets = (n: GraphNode, type: RelType) => [...(out.get(nodeKey(n))?.get(type) ?? [])].sort(cmp);
  const ofLabel = (label: Label) => g.nodes.filter((n) => n.label === label && (label !== 'Page' || published.has(n.id)));
  const problems = new Map(ofLabel('Problem').map((n) => [n.id, n]));
  const rows = (xs: string[]) => xs.map((x, i) => `    ${x}${i < xs.length - 1 ? ',' : ''}`).join('\n');
  return [
    '{',
    `  "kind": "documentation",`,
    `  "note": ${JSON.stringify(RECIPE_NOTE)},`,
    `  "pages": [`,
    rows(
      ofLabel('Page').map((p) =>
        JSON.stringify({
          id: p.id,
          title: p.props.title,
          url: p.props.url,
          links_to: targets(p, 'LINKS_TO'),
          prerequisite_of: targets(p, 'PREREQUISITE_OF'),
          uses_term: targets(p, 'USES_TERM'),
          applies_to: targets(p, 'APPLIES_TO'),
        }),
      ),
    ),
    `  ],`,
    `  "terms": [`,
    rows(ofLabel('Term').map((t) => JSON.stringify({ id: t.id, term: t.props.term, short: t.props.short }))),
    `  ],`,
    `  "capabilities": [`,
    rows(
      ofLabel('Capability').map((c) =>
        JSON.stringify({
          id: c.id,
          title: c.props.title,
          url: c.props.url,
          cites: targets(c, 'CITES'),
          solves: targets(c, 'SOLVES').map((id) => ({ id, kind: problems.get(id)?.props.kind, text: problems.get(id)?.props.text })),
          verified_by: (verified.get(c.id) ?? []).sort((x, y) => cmp(`${x.label}:${x.id}`, `${y.label}:${y.id}`)),
        }),
      ),
    ),
    `  ],`,
    `  "recipes": [`,
    rows(ofLabel('CookbookRecipe').map((r) => JSON.stringify({ id: r.id, title: r.props.title, url: r.props.url, demonstrates: targets(r, 'DEMONSTRATES') }))),
    `  ],`,
    `  "sections": [`,
    rows(
      sections.map(
        (s) =>
          `{"id":${JSON.stringify(s.id)},"page":${JSON.stringify(s.props.page)},"heading":${JSON.stringify(s.props.heading)},"position":${s.props.position},"url":${JSON.stringify(s.props.url)},"text":${JSON.stringify(excerpt(String(s.props.text)))},"e":${vec(g.vectors.get(s.id)!)}}`,
      ),
    ),
    `  ],`,
    `  "questions": [`,
    rows(questions),
    `  ]`,
    '}',
  ].join('\n');
}

export const RECIPE_FILE = join(COOKBOOK_DIR, `${RECIPE_SLUG}.md`);
const RECIPE_BLOCK = new RegExp(`(^\`\`\`json data=${RECIPE_DATA_BLOCK}\\n)([\\s\\S]*?)(\\n\`\`\`$)`, 'm');

/** The recipe's `docs` data block as committed, or null when the recipe or the block is missing. */
export function recipeDataBlock(source: string): string | null {
  return RECIPE_BLOCK.exec(source)?.[2] ?? null;
}

/** The recipe's source with its `docs` block (and the size in its `<summary>`) set to `data`. */
export function withRecipeData(source: string, data: string): string {
  if (!RECIPE_BLOCK.test(source)) throw new Error(`the recipe has no \`\`\`json data=${RECIPE_DATA_BLOCK} block`);
  const kb = Math.round(Buffer.byteLength(data) / 1024);
  return source
    .replace(RECIPE_BLOCK, (_m, open: string, _old: string, close: string) => `${open}${data}${close}`)
    .replace(new RegExp(`(<summary><code>${RECIPE_DATA_BLOCK}</code> \\()\\d+ KB(\\)</summary>)`), `$1${kb} KB$2`);
}

// ---------------------------------------------------------------------------
// graph.json

const clean = (p: Props) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined));

/** /docs/graph.json: the same graph as nodes and relationships arrays. */
export function graphJson(g: DocsGraph) {
  return {
    format: 1,
    kind: 'documentation',
    note: DOCUMENTATION_NOTE,
    verified: g.engine.verified,
    seed: SEED_URL,
    embeddings: {
      label: 'Section',
      property: EMBEDDING_PROPERTY,
      index: VECTOR_INDEX,
      filters: [...VECTOR_FILTER_PROPERTIES],
      dimension: EMBEDDING_DIMENSION,
      similarity: 'cosine',
      model: EMBEDDING_MODEL.id,
      workers_ai: EMBEDDING_MODEL.workers_ai,
      pooling: EMBEDDING_MODEL.pooling,
      sections: g.vectors.size,
      note: `The vectors are in the seed script and in relate-docs.rl, not in this file.`,
    },
    nodes: g.nodes.map((n) => ({ id: nodeKey(n), labels: [n.label], properties: clean(n.props) })),
    relationships: g.rels.map((r) => ({ type: r.type, start: nodeKey(r.from), end: nodeKey(r.to), properties: clean(r.props) })),
  };
}

// ---------------------------------------------------------------------------
// /docs/<id>.graph.md

/** The published page ids the graph has (each gets a .graph.md). */
export const publishedPageIds = (g: DocsGraph) => g.nodes.filter((n) => n.label === 'Page' && n.props.status !== 'planned').map((n) => n.id);

/** A page's neighborhood as markdown: prerequisites, related, links both ways, terms, sections, examples, CLI references. */
export function pageGraphMarkdown(g: DocsGraph, id: string): string {
  const byKey = new Map(g.nodes.map((n) => [nodeKey(n), n]));
  const page = byKey.get(`Page:${id}`);
  if (!page) throw new Error(`the docs graph has no page ${id}`);
  const out = (type: RelType) => g.rels.filter((r) => r.type === type && r.from.label === 'Page' && r.from.id === id);
  const inn = (type: RelType) => g.rels.filter((r) => r.type === type && r.to.label === 'Page' && r.to.id === id);
  const p = (n: GraphNode | undefined, k: string) => (n ? n.props[k] : undefined);

  const pageLink = (target: { label: Label; id: string }, anchor?: Value | null) => {
    const n = byKey.get(nodeKey(target));
    const title = String(p(n, 'title') ?? target.id);
    const kind = target.label === 'CookbookRecipe' ? ' (cookbook)' : '';
    const md = p(n, 'md_url');
    const where = anchor ? ` § \`#${anchor}\`` : '';
    return md ? `- [${title}](${md})${kind}${where}` : `- ${title} (\`${target.id}\`, not written yet)${where}`;
  };
  const list = (items: string[]) => (items.length ? items : ['- None.']);

  const byPosition = (a: GraphNode, b: GraphNode) => Number(a.props.position) - Number(b.props.position);
  const sections = out('HAS_SECTION').map((r) => byKey.get(nodeKey(r.to))!).sort(byPosition);
  const headingOf = new Map(sections.map((s) => [String(s.props.anchor), String(s.props.heading)]));
  const examples = out('HAS_EXAMPLE').map((r) => byKey.get(nodeKey(r.to))!).sort(byPosition);
  const terms = out('USES_TERM').map((r) => byKey.get(nodeKey(r.to))!);
  const docs = out('DOCUMENTS').map((r) => byKey.get(nodeKey(r.to))!);
  const tick = (s: string) => `\`${s.replaceAll('`', "'")}\``;

  const title = String(page.props.title);
  const lines = [
    '---',
    `title: ${JSON.stringify(`${title}: page graph`)}`,
    `page: ${id}`,
    `canonical_url: ${page.props.url}`,
    `markdown: ${page.props.md_url}`,
    `kind: documentation`,
    `verified: ${g.engine.verified}`,
    `graph: ${SEED_URL}`,
    '---',
    '',
    `# ${title}: page graph`,
    '',
    `The page [${title}](${page.props.md_url}) in the docs graph: the pages to read before it, the pages it points to and the pages that point to it, its glossary terms, sections and code examples. The whole graph is ${SEED_URL} and ${CANONICAL_ORIGIN}/docs/graph.json. ${DOCUMENTATION_NOTE}`,
    '',
    '## Prerequisites',
    '',
    ...list(inn('PREREQUISITE_OF').map((r) => pageLink(r.from))),
    '',
    '## Prerequisite of',
    '',
    ...list(out('PREREQUISITE_OF').map((r) => pageLink(r.to))),
    '',
    '## Related',
    '',
    ...list(out('RELATED_TO').map((r) => pageLink(r.to, r.props.anchor))),
    '',
    '## Links to',
    '',
    ...list(out('LINKS_TO').map((r) => pageLink(r.to, r.props.anchor))),
    '',
    '## Linked from',
    '',
    ...list(
      [...new Set([...inn('LINKS_TO'), ...inn('RELATED_TO')].map((r) => r.from.id))].sort().map((from) => pageLink({ label: 'Page', id: from })),
    ),
    '',
    '## Terms',
    '',
    ...list(terms.map((t) => (t.props.short ? `- **${t.props.term}** (${tick(t.id)}): ${t.props.short}` : `- ${tick(t.id)}: no glossary entry`))),
    '',
    '## Sections',
    '',
    ...list(sections.map((s) => `- [${s.props.heading}](${s.props.url}) (${s.props.length} characters)`)),
    '',
    '## Examples',
    '',
    ...list(
      examples.map((e) => {
        const where = e.props.section ? ` in "${headingOf.get(String(e.props.section)) ?? e.props.section}"` : '';
        const cell = e.props.cell ? `, runnable cell ${tick(String(e.props.cell))}` : '';
        return `- ${tick(String(e.props.lang))}${where}${cell}: ${tick(String(e.props.first_line).slice(0, 120))}`;
      }),
    ),
    '',
    '## CLI commands and flags',
    '',
    ...list(
      docs.map((d) =>
        d.label === 'Command'
          ? `- Command ${tick(`relate ${d.props.word}`)} (${tick(d.id)})`
          : `- Flag ${tick(String(d.props.flag))}${d.props.command ? ` of ${tick(`relate ${byKey.get(`Command:${d.props.command}`)?.props.word ?? d.props.command}`)}` : ''} (${tick(d.id)})`,
      ),
    ),
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Once per build

let cached: DocsGraph | null = null;

/** The docs graph from the files on disk; `cache` keeps it for the rest of the process (the production build). */
export function docsGraph({ cache = false }: { cache?: boolean } = {}): DocsGraph {
  if (cache && cached) return cached;
  const g = buildGraph(graphInput());
  if (cache) cached = g;
  return g;
}

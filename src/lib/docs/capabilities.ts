// The capability catalog (DOCS-PLAN.md §3.8, ADR-0011, ADR-0015): one file per
// problem relate solves, src/content/docs/_capabilities/<id>.mdx, mapping the
// problem in the reader's words to the product's capability, the pages and
// recipes that cover it, a recommended data model, and the recorded cell that
// proves it, or says that no recorded run does yet. One source, three
// renderings:
//
//   - the generated section of concepts/problems-relate-solves.mdx: one H2 per
//     capability (its anchor is the capability id), the body, the data model
//     as a ```mermaid block, and a list of the problem, the capability, the
//     surfaces, the links and the verifying cell. It is written into the page
//     file between two marker comments by `node src/lib/docs/capabilities.ts
//     --write`, so the page, its twin, its anchors, its diagrams and every
//     docs:check rule see plain MDX; docs:check fails when it is stale
//   - /docs/capabilities.json (src/pages/docs/capabilities.json.ts), the same
//     entries as data with canonical URLs
//   - the docs graph's (:Capability) and (:Problem) nodes (src/lib/docs/graph.ts)
//
// Node-only (no astro:content), like content.ts, so the build, the endpoint
// and the checks read the same files.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import GithubSlugger from 'github-slugger';
import type { Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';

import { diagramDescription, diagramProblems, diagramTitle, mermaidBlocks, readRendered, THEMES, type Theme } from '../cookbook/diagrams.ts';
import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { COOKBOOK_DIR, loadRecipes } from '../cookbook/load.ts';
import { DOCS_DIR, engine as readEngine, pageFiles, ROOT, splitFrontmatter, type Engine, type PageFile } from './content.ts';
import { pageStepsKey, pageVerifySteps, recordedPageSteps, recordedStep, type RecordedStep } from './checks/cli.ts';
import { GENERATED_PAGES, pageUrl, SURFACES, type Surface } from './model.ts';
import { parsePage } from './parse.ts';
import { parseRunInfo } from './results.ts';
import { parseSampleInfo, readSidecar, sampleId, type SampleLang } from './samples.ts';
import { INJECTION } from './skill.ts';

// ---------------------------------------------------------------------------
// Where things are

export const CAPABILITIES_DIR = join(DOCS_DIR, '_capabilities');
/** The page every capability cites: its canonical URL is this page plus `#<id>`. */
export const CAPABILITIES_PAGE = 'concepts/problems-relate-solves';
export const CAPABILITIES_PAGE_FILE = join(DOCS_DIR, `${CAPABILITIES_PAGE}.mdx`);
/** The data endpoint, site-relative. */
export const CAPABILITIES_JSON_URL = '/docs/capabilities.json';
/** The command that rewrites the page's generated section. */
export const WRITE_COMMAND = 'node src/lib/docs/capabilities.ts --write';

/** The marker comments around the generated section of the page (MDX comments: neither the page nor the twin shows them). */
export const SECTION_START = `{/* capabilities:start: generated from src/content/docs/_capabilities by \`${WRITE_COMMAND}\`; edit the capability files, not this section */}`;
export const SECTION_END = '{/* capabilities:end */}';
const START_PREFIX = '{/* capabilities:start';

/** How many intents a capability lists (DOCS-PLAN.md §3.8). */
export const INTENTS_MIN = 4;
export const INTENTS_MAX = 8;
/** How many paragraphs a capability's body holds. */
export const BODY_PARAGRAPHS_MIN = 2;
export const BODY_PARAGRAPHS_MAX = 4;

/** Every frontmatter key a capability may hold (src/content.config.ts `capabilities`). */
export const CAPABILITY_KEYS = [
  'id', 'title', 'order', 'problem', 'capability', 'intents', 'surfaces', 'guides', 'recipes', 'reference', 'schema', 'verify',
] as const;

// ---------------------------------------------------------------------------
// The model

export interface Capability {
  /** Stable id: the anchor on the page, the key in capabilities.json; the GitHub slug of `title`. */
  id: string;
  /** The H2 on the page. */
  title: string;
  /** Position on the page, lower first (ties by id). */
  order: number;
  /** The problem in the reader's words. */
  problem: string;
  /** The capability in the product's words. */
  capability: string;
  /** Phrases an agent might say when it has this problem (4 to 8, unique across the catalog). */
  intents: string[];
  surfaces: Surface[];
  /** Page ids (an optional `#anchor`) of the guides that do it. */
  guides: string[];
  /** Cookbook slugs of the recipes that show it. */
  recipes: string[];
  /** Page ids (an optional `#anchor`) of the reference pages it rests on. */
  reference: string[];
  /** The recommended data model: a mermaid flowchart whose nodes are all circles, or null. */
  schema: string | null;
  /**
   * The recorded run that proves it: `<recipe slug>#<cell id>`, `<page id>#<cell
   * or sample id>`, or `<page id>#step-<n>` (the page's n-th ```bash verify
   * step); null when no recorded run exercises the capability yet.
   */
  verify: string | null;
  /** The body: two to four paragraphs of markdown. */
  body: string;
  /** The capability's file (absolute). */
  file: string;
}

export type VerifyKind = 'cookbook-cell' | 'docs-cell' | 'docs-sample' | 'cli-step';

/** The fragment that names a page's n-th ```bash verify step (docs:cli-check) rather than a cell. */
const STEP_REF = /^step-([1-9]\d*)$/;

/**
 * A capability's `verify`, split. A recipe slug never holds a `/`; a docs page
 * id always does. On a docs page, `#step-<n>` is the page's n-th ```bash
 * verify step; any other fragment is a cell or sample id.
 */
export function parseVerify(ref: string): { kind: 'cookbook' | 'docs' | 'cli'; target: string; cell: string } | null {
  const m = /^([^#\s]+)#([A-Za-z0-9_-]+)$/.exec(ref);
  if (!m) return null;
  if (!m[1].includes('/')) return { kind: 'cookbook', target: m[1], cell: m[2] };
  return { kind: STEP_REF.test(m[2]) ? 'cli' : 'docs', target: m[1], cell: m[2] };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);

/** The capability files, sorted by name. */
export function capabilityFiles(dir = CAPABILITIES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.mdx'))
    .sort()
    .map((n) => join(dir, n));
}

/** One capability file as data. Shape problems are left to `capabilityProblems`; this only parses. */
export function readCapability(file: string): Capability & { data: Record<string, unknown> } {
  const where = relative(ROOT, file).split(sep).join('/');
  const { data, body } = splitFrontmatter(readFileSync(file, 'utf8'), where);
  return {
    id: typeof data.id === 'string' ? data.id : '',
    title: typeof data.title === 'string' ? data.title : '',
    order: typeof data.order === 'number' ? data.order : 100,
    problem: typeof data.problem === 'string' ? data.problem.trim() : '',
    capability: typeof data.capability === 'string' ? data.capability.trim() : '',
    intents: strings(data.intents),
    surfaces: strings(data.surfaces) as Surface[],
    guides: strings(data.guides),
    recipes: strings(data.recipes),
    reference: strings(data.reference),
    schema: typeof data.schema === 'string' && data.schema.trim() ? data.schema.replace(/\s+$/, '') : null,
    verify: typeof data.verify === 'string' ? data.verify : null,
    body: body.trim(),
    file,
    data,
  };
}

/** Every capability, in page order (`order`, then id). */
export function readCapabilities(dir = CAPABILITIES_DIR): Capability[] {
  return capabilityFiles(dir)
    .map((f) => {
      const { data: _data, ...c } = readCapability(f);
      return c;
    })
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// What a capability may cite

/** What the catalog resolves its references against. */
export interface CatalogContext {
  /** Published docs page id → its title and file (generated pages have no file). */
  pages: Map<string, { title: string; file: string | null }>;
  /** Planned docs page ids (stubs): cited only once written. */
  planned: Set<string>;
  /** Docs page id → the anchors its source gives it (headings, cells), when known. */
  anchors?: Map<string, Set<string>>;
  /** Recipe slug → its title and cell ids. */
  recipes: Map<string, { title: string; cells: Set<string> }>;
}

/** The context from the files on disk: the docs pages, the generated pages and the cookbook. */
export function catalogContext(files: PageFile[] = pageFiles()): CatalogContext {
  const pages = new Map<string, { title: string; file: string | null }>();
  const planned = new Set<string>();
  for (const p of files) {
    if (p.id.startsWith('_example/')) continue;
    if (p.data.status === 'planned') planned.add(p.id);
    else pages.set(p.id, { title: String(p.data.title ?? p.id), file: p.file });
  }
  for (const g of GENERATED_PAGES) pages.set(g.id, { title: g.title, file: null });
  const recipes = new Map<string, { title: string; cells: Set<string> }>();
  for (const r of loadRecipes(COOKBOOK_DIR, { validate: false }).recipes) {
    recipes.set(r.slug, { title: String(r.front.title ?? r.heading ?? r.slug), cells: new Set(r.cells.map((c) => c.id)) });
  }
  return { pages, planned, recipes };
}

/** A docs page's cells and samples, from its source and its results sidecar. */
export interface PageRuns {
  /** Cypher cell ids, in page order. */
  cells: string[];
  /** Verified sample ids → the sample's language and the anchor of the heading it sits under ('' before the first heading). */
  samples: Map<string, { lang: SampleLang; anchor: string }>;
  /** The ids the sidecar records. */
  recorded: Set<string>;
  /**
   * The ```bash verify steps, in page order (checks/cli.ts verifySteps): the
   * anchor of the heading each sits under, its expected output (null for a
   * setup step) and whether it equals the step docs:cli-check last replayed
   * (cli.json `page_steps`).
   */
  steps?: { anchor: string; expected: string | null; replayed: boolean }[];
}

/** The runnable cells and verified samples of a docs page file. */
export function pageRuns(file: string): PageRuns {
  const { body } = splitFrontmatter(readFileSync(file, 'utf8'), file);
  const tree = parsePage(body);
  const cells: string[] = [];
  const samples = new Map<string, { lang: SampleLang; anchor: string }>();
  const slugger = new GithubSlugger();
  const seq = new Map<SampleLang, number>();
  let anchor = '';
  const stepAnchors: string[] = [];
  const visit = (node: RootContent) => {
    if (node.type === 'heading') anchor = slugger.slug(toString(node));
    if (node.type === 'code' && node.lang === 'bash' && /(?:^|\s)verify(?:\s|$)/.test(node.meta ?? '')) stepAnchors.push(anchor);
    if (node.type === 'code') {
      try {
        const run = parseRunInfo(node.lang, node.meta);
        if (run) cells.push(run.name ?? `cell-${cells.length + 1}`);
        const sample = run ? null : parseSampleInfo(node.lang, node.meta);
        if (sample) {
          const n = (seq.get(sample.lang) ?? 0) + 1;
          seq.set(sample.lang, n);
          samples.set(sampleId(sample, n), { lang: sample.lang, anchor });
        }
      } catch {
        // A malformed info string is the page's problem; docs:check reports it there.
      }
    }
    if ('children' in node) for (const c of (node as Parent).children) visit(c as RootContent);
  };
  for (const c of (tree as Root).children) visit(c);
  let recorded = new Set<string>();
  try {
    recorded = new Set(Object.keys(readSidecar(file)?.cells ?? {}));
  } catch {
    // An unreadable sidecar fails the page's own checks.
  }
  let steps: PageRuns['steps'] = [];
  try {
    const recordedSteps = recordedPageSteps()[pageStepsKey(file)];
    const list = Array.isArray(recordedSteps) ? (recordedSteps as Partial<RecordedStep>[]) : [];
    steps = pageVerifySteps(file).map((step, i) => {
      const want = recordedStep(step);
      const r = list[i];
      return { anchor: stepAnchors[i] ?? '', expected: step.expected, replayed: !!r && r.command === want.command && r.expected_sha256 === want.expected_sha256 };
    });
  } catch {
    // An unreadable cli.json fails the data-file checks.
  }
  return { cells, samples, recorded, steps };
}

/** A sample's client as the card names it. */
const CLIENT_NAMES: Record<string, string> = { python: 'Python', js: 'Node.js', rust: 'Rust', java: 'Java', go: 'Go', swift: 'Swift', c: 'C' };

/** The HTML anchor of a docs cell (constructs.ts: `cell-<id>`, an unnamed cell's id already is). */
export const cellAnchor = (id: string) => (id.startsWith('cell-') ? id : `cell-${id}`);

/** What a capability's `verify` names, resolved: its kind, a site-relative link and the words for the card. */
export interface ResolvedVerify {
  kind: VerifyKind;
  href: string;
  /** The page or recipe title. */
  title: string;
  cell: string;
  /** A sample's client: `Python`, `Node.js`, `Rust`, … */
  client?: string;
  /** A CLI step's number on its page and the first line of its recorded output. */
  step?: { n: number; output: string };
}

/**
 * Resolve `verify` against the cookbook and the docs: the cell must exist on
 * the recipe (its recipe.json cell ids) or be recorded in the docs page's
 * results sidecar. Returns the problem as a string when it does not resolve.
 */
export function resolveVerify(ref: string, ctx: CatalogContext, runs: (file: string) => PageRuns = pageRuns): ResolvedVerify | string {
  const v = parseVerify(ref);
  if (!v) return `verify "${ref}" is not "<recipe slug>#<cell id>", "<page id>#<cell id>" or "<page id>#step-<n>"`;
  if (v.kind === 'cookbook') {
    const recipe = ctx.recipes.get(v.target);
    if (!recipe) return `verify "${ref}": there is no recipe src/content/cookbook/${v.target}.md`;
    if (!recipe.cells.has(v.cell)) return `verify "${ref}": recipe "${v.target}" has no cell "${v.cell}" (its cells: ${[...recipe.cells].join(', ')})`;
    return { kind: 'cookbook-cell', href: `/cookbook/${v.target}/#cell-${v.cell}`, title: recipe.title, cell: v.cell };
  }
  const page = ctx.pages.get(v.target);
  if (!page) {
    return ctx.planned.has(v.target)
      ? `verify "${ref}": ${v.target} is a planned page; cite a cell on a published page`
      : `verify "${ref}": there is no published docs page ${v.target}`;
  }
  if (!page.file) return `verify "${ref}": ${v.target} is a generated page and has no cells`;
  const r = runs(page.file);
  if (v.kind === 'cli') {
    const n = Number(STEP_REF.exec(v.cell)![1]);
    const steps = r.steps ?? [];
    const step = steps[n - 1];
    if (!step) return `verify "${ref}": ${v.target} has ${steps.length} \`bash verify\` step(s), not ${n}`;
    if (step.expected === null) return `verify "${ref}": step ${n} on ${v.target} is a setup step (no \`text\` fence after it), so its output is not compared; cite a step with expected output`;
    if (!step.replayed) return `verify "${ref}": step ${n} on ${v.target} is not the step docs:cli-check last replayed (cli.json page_steps); replay it with \`npm run docs:cli-check -- --record\``;
    const output = step.expected.split('\n').find((l) => l.trim()) ?? '';
    return { kind: 'cli-step', href: `/docs/${v.target}${step.anchor ? `#${step.anchor}` : ''}`, title: page.title, cell: v.cell, step: { n, output } };
  }
  if (!r.recorded.has(v.cell)) return `verify "${ref}": ${v.target}'s results sidecar records no cell or sample "${v.cell}"`;
  if (r.cells.includes(v.cell)) return { kind: 'docs-cell', href: `/docs/${v.target}#${cellAnchor(v.cell)}`, title: page.title, cell: v.cell };
  if (r.samples.has(v.cell)) {
    const { lang, anchor } = r.samples.get(v.cell)!;
    const client = CLIENT_NAMES[lang] ?? lang;
    return { kind: 'docs-sample', href: `/docs/${v.target}${anchor ? `#${anchor}` : ''}`, title: page.title, cell: v.cell, client };
  }
  return `verify "${ref}": "${v.cell}" is recorded in ${v.target}'s sidecar but is no longer a cell or sample on the page`;
}

/** The flowchart body without its accessibility text, directives and quoted labels. */
function flowchartBody(schema: string): { body: string; classLines: string[] } {
  const lines = schema.replace(/accDescr\s*\{[\s\S]*?\}/g, '').split('\n');
  const skip = /^\s*(?:flowchart|graph|accTitle|accDescr|classDef|style|linkStyle|subgraph|end|direction|%%)\b/;
  const classLines = lines.filter((l) => /^\s*class\s/.test(l));
  const body = lines
    .filter((l) => !skip.test(l) && !/^\s*class\s/.test(l))
    .join('\n')
    .replace(/"[^"]*"/g, '""');
  return { body, classLines };
}

/** The node shapes of a mermaid flowchart other than a circle, by node id (quoted labels removed first). */
function nonCircleNodes(schema: string): string[] {
  const { body } = flowchartBody(schema);
  const out = new Set<string>();
  for (const m of body.matchAll(/\b([A-Za-z_][\w]*)\s*(\(\(|\(\[|\[\[|\[\(|\(|\[|\{\{|\{|>)/g)) {
    if (m[2] !== '((') out.add(m[1]);
  }
  return [...out];
}

/**
 * The node ids a flowchart uses (in an edge, alone on a line, or in a
 * `class` line) that it never gives a shape: mermaid draws such a node as a
 * rectangle. Text inside a shape or an edge label (`|…|`) is not an id.
 */
export function shapelessNodes(schema: string): string[] {
  const { body, classLines } = flowchartBody(schema);
  const shaped = new Set<string>();
  for (const m of body.matchAll(/\b([A-Za-z_]\w*)\s*(?:\(|\[|\{|>)/g)) shaped.add(m[1]);
  const used = new Set<string>();
  // Identifiers outside every bracket, edge label and `:::class` suffix.
  const outside = body.replace(/\|[^|\n]*\|/g, ' ').replace(/:::\w+/g, ' ');
  let depth = 0;
  let word = '';
  const flush = () => {
    if (word && depth === 0 && /^[A-Za-z_]\w*$/.test(word)) used.add(word);
    word = '';
  };
  for (const ch of outside) {
    if ('([{'.includes(ch)) {
      flush();
      depth++;
    } else if (')]}'.includes(ch)) {
      flush();
      depth = Math.max(0, depth - 1);
    } else if (/\w/.test(ch)) {
      word += ch;
    } else {
      flush();
    }
  }
  flush();
  for (const l of classLines) {
    const m = /^\s*class\s+([\w\s,]+?)\s+\w+\s*;?\s*$/.exec(l);
    if (m) for (const id of m[1].split(',')) if (id.trim()) used.add(id.trim());
  }
  return [...used].filter((id) => !shaped.has(id)).sort();
}

/** The docs:check injection patterns that match `text` (ADR-0013), as their source. */
const injectionIn = (text: string) => INJECTION.filter((re) => re.test(text)).map((re) => re.source.slice(0, 40));

/** A slug as the docs headings get it (github-slugger, as Astro and docs:check use). */
export const slugOf = (text: string) => new GithubSlugger().slug(text);

const linkPattern = /\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;

/**
 * Every problem with the catalog: frontmatter shape, ids, intents, cited
 * pages and recipes, the verify cell, the schema. Each problem names the
 * capability file it is in.
 */
export function capabilityProblems(caps: Capability[], ctx: CatalogContext, runs: (file: string) => PageRuns = pageRuns): { file: string; message: string }[] {
  const out: { file: string; message: string }[] = [];
  const intentOwner = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const c of caps) {
    const err = (message: string) => out.push({ file: c.file, message });
    const name = c.file.split(sep).pop()!.replace(/\.mdx$/, '');
    let data: Record<string, unknown> = {};
    try {
      data = readCapability(c.file).data;
    } catch (e) {
      err((e as Error).message);
      continue;
    }
    for (const k of Object.keys(data)) if (!(CAPABILITY_KEYS as readonly string[]).includes(k)) err(`unknown key \`${k}\` (known: ${CAPABILITY_KEYS.join(', ')})`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)) err(`\`id\` "${c.id}" is lowercase letters, digits and single dashes`);
    else if (c.id !== name) err(`\`id\` "${c.id}" differs from the file name ${name}.mdx`);
    if (ids.has(c.id)) err(`\`id\` "${c.id}" repeats ${ids.get(c.id)}`);
    ids.set(c.id, relative(ROOT, c.file));
    if (!c.title) err('`title` is required: the H2 on the page');
    else if (slugOf(c.title) !== c.id) err(`\`title\` "${c.title}" gives the anchor #${slugOf(c.title)}, not #${c.id}; the anchor is the id`);
    if (typeof data.order !== 'number' || !Number.isInteger(data.order)) err('`order` is an integer: the position on the page');
    for (const key of ['problem', 'capability'] as const) {
      if (!c[key]) err(`\`${key}\` is required`);
      else if (c[key].length > 200) err(`\`${key}\` is ${c[key].length} characters; keep it to one sentence of at most 200`);
      else if (/\n/.test(c[key])) err(`\`${key}\` is one line`);
      if (c[key] && injectionIn(c[key]).length) err(`\`${key}\` "${c[key]}" carries prompt-injection phrasing (ADR-0013)`);
    }
    if (c.intents.length < INTENTS_MIN || c.intents.length > INTENTS_MAX) err(`${c.intents.length} intent(s); a capability lists ${INTENTS_MIN} to ${INTENTS_MAX}`);
    for (const intent of c.intents) {
      const key = intent.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!key) err('an empty intent');
      else if (injectionIn(intent).length) err(`intent "${intent}" carries prompt-injection phrasing (ADR-0013)`);
      else if (intentOwner.has(key) && intentOwner.get(key) !== c.id) err(`intent "${intent}" is also an intent of ${intentOwner.get(key)}; intents are unique across the catalog`);
      else if (intentOwner.get(key) === c.id) err(`intent "${intent}" is listed twice`);
      intentOwner.set(key, c.id);
    }
    if (!c.surfaces.length) err('`surfaces` lists at least one surface');
    for (const s of c.surfaces) if (!(SURFACES as readonly string[]).includes(s)) err(`surface "${s}" is not one of ${SURFACES.join(', ')}`);
    if (!c.guides.length && !c.recipes.length && !c.reference.length) err('a capability cites at least one guide, recipe or reference page');
    for (const [key, list] of [['guides', c.guides], ['reference', c.reference]] as const) {
      for (const ref of list) {
        const [id, anchor] = ref.split('#');
        if (ref.startsWith('/') || ref.startsWith('cookbook/') || /^https?:/.test(ref)) {
          err(`${key}: "${ref}" is a docs page id (guides/agents/model-agent-memory), not a URL; recipes go under \`recipes\``);
        } else if (!ctx.pages.has(id)) {
          err(ctx.planned.has(id) ? `${key}: ${id} is a planned page; cite it once it is written` : `${key}: there is no published docs page ${id}`);
        } else if (anchor && ctx.anchors?.get(id) && !ctx.anchors.get(id)!.has(anchor)) {
          err(`${key}: ${id} has no heading or anchor #${anchor}`);
        }
      }
    }
    for (const slug of c.recipes) if (!ctx.recipes.has(slug)) err(`recipes: there is no recipe src/content/cookbook/${slug}.md`);
    if (!('verify' in data)) err('`verify` is required: the recorded run that proves the capability, or null when none does yet');
    else if (data.verify !== null && (typeof data.verify !== 'string' || !data.verify)) err('`verify` is a reference to a recorded run, or null');
    else if (c.verify !== null) {
      const v = resolveVerify(c.verify, ctx, runs);
      if (typeof v === 'string') err(v);
    }
    if (c.schema !== null) {
      if (!/^\s*flowchart\s+(?:LR|RL|TB|TD|BT)\b/.test(c.schema)) err('`schema` is a mermaid `flowchart` (a data model), or null');
      for (const p of diagramProblems(c.schema)) err(`schema: ${p}`);
      const shapes = nonCircleNodes(c.schema);
      if (shapes.length) err(`schema: every node of a data model is a circle, \`Id(("…"))\`; not: ${shapes.join(', ')}`);
      for (const id of shapelessNodes(c.schema)) err(`schema: node ${id} has no shape, so mermaid draws a rectangle; write ${id}(("…"))`);
      if (/^\s*```/m.test(c.schema)) err('schema: the mermaid source only, without a fence');
    } else if (data.schema !== null && data.schema !== undefined) {
      err('`schema` is a mermaid flowchart, or null when the capability has no data model');
    }
    if (!('schema' in data)) err('`schema` is required: a mermaid flowchart, or null');
    // The body: paragraphs of prose, plain markdown (it is copied into the page).
    const paragraphs = c.body.split(/\n\s*\n/).filter((p) => p.trim());
    if (paragraphs.length < BODY_PARAGRAPHS_MIN || paragraphs.length > BODY_PARAGRAPHS_MAX) {
      err(`the body has ${paragraphs.length} paragraph(s); it holds ${BODY_PARAGRAPHS_MIN} to ${BODY_PARAGRAPHS_MAX}`);
    }
    if (/^\s*(?:#|```|~~~|:::|<[A-Z]|\{)/m.test(c.body)) err('the body is paragraphs of prose: no headings, fences, directives, components or expressions');
    if (/:term\[/.test(c.body)) err('the body links no glossary terms (the page caps its Terms section); write the term out');
    for (const m of c.body.matchAll(linkPattern)) {
      const href = m[2];
      const docs = /^\/docs\/([^#?]+?)\/?(?:#([^?]*))?$/.exec(href);
      if (docs) {
        if (!ctx.pages.has(docs[1])) err(`body link ${href}: there is no published docs page ${docs[1]}`);
        else if (docs[2] && ctx.anchors?.get(docs[1]) && !ctx.anchors.get(docs[1])!.has(docs[2])) err(`body link ${href}: ${docs[1]} has no anchor #${docs[2]}`);
      }
      const recipe = /^\/cookbook\/([^/#?]+)\/?(?:#.*)?$/.exec(href);
      if (recipe && !ctx.recipes.has(recipe[1])) err(`body link ${href}: there is no recipe ${recipe[1]}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The page's generated section

const docHref = (ref: string) => {
  const [id, anchor] = ref.split('#');
  return `/docs/${id}${anchor ? `#${anchor}` : ''}`;
};
const recipeHref = (slug: string) => `/cookbook/${slug}/`;
/** A cited page's link text: its title, and the anchor as inline code when the reference names one (two anchors on one page stay apart). */
const titleOf = (ref: string, ctx: CatalogContext) => {
  const [id, anchor] = ref.split('#');
  const title = ctx.pages.get(id)?.title ?? id;
  return anchor ? `${title} (\`#${anchor}\`)` : title;
};
const mdLinkText = (s: string) => s.replace(/([[\]\\])/g, '\\$1');

/** Inline code that holds `text` whatever backticks it contains. */
const inlineCode = (text: string) => {
  const run = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(run + 1);
  return run ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
};

const VERIFY_WORDS: Record<VerifyKind, (v: ResolvedVerify) => string> = {
  'cookbook-cell': (v) => `cell \`${v.cell}\` of the recipe [${mdLinkText(v.title)}](${v.href}), replayed against its recorded result on every build`,
  'docs-cell': (v) => `cell \`${v.cell}\` on [${mdLinkText(v.title)}](${v.href}), replayed against its recorded result by the docs checks on every pull request`,
  'docs-sample': (v) => `the ${v.client} sample \`${v.cell}\` on [${mdLinkText(v.title)}](${v.href}), whose output is recorded from a run against the ${v.client} client`,
  'cli-step': (v) =>
    `the \`bash verify\` step ${v.step!.n} on [${mdLinkText(v.title)}](${v.href}), whose recorded output begins ${inlineCode(v.step!.output.slice(0, 120))}; the CLI check replays it against a relate binary`,
};

/** The list line of a capability that no recorded run verifies yet. */
export const UNVERIFIED_WORDS = 'no recorded run exercises this capability yet; the pages above are its sources';

/** One capability as the page shows it: the H2, the body, the data model, the list. */
export function capabilityMarkdown(c: Capability, ctx: CatalogContext, runs: (file: string) => PageRuns = pageRuns): string {
  const v = c.verify === null ? null : resolveVerify(c.verify, ctx, runs);
  if (typeof v === 'string') throw new Error(`${relative(ROOT, c.file)}: ${v}`);
  const links = (refs: string[], href: (r: string) => string, title: (r: string) => string) => refs.map((r) => `[${mdLinkText(title(r))}](${href(r)})`).join(', ');
  const items = [
    `**Problem:** ${c.problem}`,
    `**Capability:** ${c.capability}`,
    `**Surfaces:** ${c.surfaces.map((s) => `\`${s}\``).join(', ')}`,
    ...(c.guides.length ? [`**Guides:** ${links(c.guides, docHref, (r) => titleOf(r, ctx))}`] : []),
    ...(c.recipes.length ? [`**Recipes:** ${links(c.recipes, recipeHref, (s) => ctx.recipes.get(s)?.title ?? s)}`] : []),
    ...(c.reference.length ? [`**Reference:** ${links(c.reference, docHref, (r) => titleOf(r, ctx))}`] : []),
    `**Verified by:** ${v ? VERIFY_WORDS[v.kind](v) : UNVERIFIED_WORDS}`,
  ];
  const parts = [`## ${c.title}`, c.body];
  if (c.schema) parts.push(`\`\`\`mermaid\n${c.schema}\n\`\`\``);
  parts.push(items.map((i) => `- ${i}`).join('\n'));
  return parts.join('\n\n');
}

/** The whole generated section, markers included. */
export function capabilitiesSection(caps: Capability[], ctx: CatalogContext, runs: (file: string) => PageRuns = pageRuns): string {
  return [SECTION_START, ...caps.map((c) => capabilityMarkdown(c, ctx, runs)), SECTION_END].join('\n\n');
}

/** The page's text with its generated section replaced; throws when the markers are missing or out of order. */
export function withSection(pageText: string, section: string): string {
  const start = pageText.indexOf(START_PREFIX);
  const endAt = pageText.indexOf(SECTION_END);
  if (start < 0 || endAt < 0 || endAt < start) {
    throw new Error(`${CAPABILITIES_PAGE}.mdx has no generated section; put a line "${SECTION_START}" and a line "${SECTION_END}" where it goes`);
  }
  return pageText.slice(0, start) + section + pageText.slice(endAt + SECTION_END.length);
}

/** The generated section as the page file now holds it, markers included, or null. */
export function currentSection(pageText: string): string | null {
  const start = pageText.indexOf(START_PREFIX);
  const endAt = pageText.indexOf(SECTION_END);
  if (start < 0 || endAt < start) return null;
  return pageText.slice(start, endAt + SECTION_END.length);
}

/** Rewrite the page's generated section from the capability files; returns whether the file changed. */
export function writeSection(caps: Capability[] = readCapabilities(), ctx: CatalogContext = catalogContext(), file = CAPABILITIES_PAGE_FILE): boolean {
  const before = readFileSync(file, 'utf8');
  const after = withSection(before, capabilitiesSection(caps, ctx));
  if (after === before) return false;
  writeFileSync(file, after);
  return true;
}

// ---------------------------------------------------------------------------
// The data models as served files

/** The served URL of a capability's data model, site-relative (src/pages/docs/concepts/problems-relate-solves/[schema].svg.ts). */
export const schemaPath = (id: string, theme: Theme = 'light') => `${pageUrl(CAPABILITIES_PAGE)}schema-${id}-${theme}.svg`;

/** A capability's data model rendered for the page: both themes, read from the page's diagrams/ (npm run docs:diagrams). */
export function schemaSvg(c: Capability, file = CAPABILITIES_PAGE_FILE): Record<Theme, string> | null {
  if (!c.schema) return null;
  const { body } = splitFrontmatter(readFileSync(file, 'utf8'), file);
  const block = mermaidBlocks(body).find((d) => d.source.trimEnd() === c.schema!.trimEnd());
  if (!block) throw new Error(`${CAPABILITIES_PAGE}.mdx has no mermaid block for the data model of ${c.id}; run ${WRITE_COMMAND}`);
  const dir = join(DOCS_DIR, CAPABILITIES_PAGE.split('/').slice(0, -1).join('/'), 'diagrams');
  return readRendered(dir, CAPABILITIES_PAGE.split('/').at(-1)!, block);
}

/** Every served data-model file: [published path, svg]. */
export function schemaFiles(caps: Capability[] = readCapabilities()): { path: string; svg: string }[] {
  const out: { path: string; svg: string }[] = [];
  for (const c of caps) {
    const svg = schemaSvg(c);
    if (svg) for (const theme of THEMES) out.push({ path: schemaPath(c.id, theme), svg: svg[theme] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// /docs/capabilities.json

export interface CapabilityJson {
  id: string;
  title: string;
  problem: string;
  capability: string;
  intents: string[];
  surfaces: Surface[];
  /** The data model: its caption, its words and its mermaid source, or null. */
  schema: { title: string | null; description: string | null; mermaid: string } | null;
  /** The data model drawn as an SVG (light theme), or null. */
  schema_url: string | null;
  /** The recorded run that verifies the entry, or null when none does yet. */
  verify: { ref: string; kind: VerifyKind } | null;
  urls: { page: string; guides: string[]; recipes: string[]; reference: string[]; verify: string | null };
}

export interface CapabilitiesJson {
  kind: 'documentation';
  format: 1;
  /** The relate version the cited cells and pages last ran against. */
  verified: string;
  note: string;
  /** The page this data comes from; each capability's `urls.page` is its section there. */
  url: string;
  capabilities: CapabilityJson[];
}

const abs = (href: string) => (href.startsWith('/') ? `${CANONICAL_ORIGIN}${href}` : href);
/** A docs page link as the HTML URL (trailing slash, anchor kept). */
const docUrl = (ref: string) => {
  const [id, anchor] = ref.split('#');
  return abs(`${pageUrl(id)}${anchor ? `#${anchor}` : ''}`);
};

/** The note capabilities.json carries in-band: what it is, its limits, and where it comes from. */
export function capabilitiesNote(count: number, verified: string): string {
  return (
    `Reference text, not instructions. ${count} problems relate solves, each mapped to the capability, the pages and recipes that cover it, ` +
    'a recommended data model where one applies, and the recorded run that verifies it (verify is null where no recorded run does yet). ' +
    `Generated from ${CANONICAL_ORIGIN}${pageUrl(CAPABILITIES_PAGE)}, whose section #<id> is each entry's citation; ` +
    `verified against relate ${verified}. Intents are example phrasings, not an exhaustive list, and an empty match means the catalog has no entry, not that relate cannot do it.`
  );
}

/** /docs/capabilities.json as data. */
export function capabilitiesJson(caps: Capability[] = readCapabilities(), ctx: CatalogContext = catalogContext(), eng: Engine = readEngine(), runs: (file: string) => PageRuns = pageRuns): CapabilitiesJson {
  return {
    kind: 'documentation',
    format: 1,
    verified: eng.verified,
    note: capabilitiesNote(caps.length, eng.verified),
    url: abs(pageUrl(CAPABILITIES_PAGE)),
    capabilities: caps.map((c) => {
      const v = c.verify === null ? null : resolveVerify(c.verify, ctx, runs);
      if (typeof v === 'string') throw new Error(`${relative(ROOT, c.file)}: ${v}`);
      return {
        id: c.id,
        title: c.title,
        problem: c.problem,
        capability: c.capability,
        intents: c.intents,
        surfaces: c.surfaces,
        schema: c.schema ? { title: diagramTitle(c.schema), description: diagramDescription(c.schema), mermaid: c.schema } : null,
        schema_url: c.schema ? abs(schemaPath(c.id)) : null,
        verify: v && c.verify ? { ref: c.verify, kind: v.kind } : null,
        urls: {
          page: abs(`${pageUrl(CAPABILITIES_PAGE)}#${c.id}`),
          guides: c.guides.map(docUrl),
          recipes: c.recipes.map((s) => abs(recipeHref(s))),
          reference: c.reference.map(docUrl),
          verify: v === null ? null : v.kind === 'cookbook-cell' ? abs(v.href) : docUrl(v.href.replace(/^\/docs\//, '')),
        },
      };
    }),
  };
}

/** The bytes /docs/capabilities.json serves (and docs-artifacts.json hashes). */
export const capabilitiesJsonText = (data: CapabilitiesJson = capabilitiesJson()) => `${JSON.stringify(data, null, 2)}\n`;

// ---------------------------------------------------------------------------
// The docs graph's rows (src/lib/docs/graph.ts, ADR-0020)

/** A node or relationship in the shape of src/lib/docs/graph.ts (labels and types as strings, so this module does not depend on its unions). */
export interface CapabilityGraphNode {
  label: 'Capability' | 'Problem';
  id: string;
  props: Record<string, string | string[] | null>;
}
export interface CapabilityGraphRel {
  type: 'SOLVES' | 'APPLIES_TO' | 'CITES' | 'DEMONSTRATES' | 'VERIFIED_BY' | 'HAS_CAPABILITY';
  from: { label: string; id: string };
  to: { label: string; id: string };
  props: Record<string, string | null>;
}

/**
 * The catalog as docs-graph rows: a `Capability` per entry, a `Problem` for
 * its problem statement and one per intent, and the relationships to the
 * surfaces, pages and recipes it cites. Sorted by id, so the seed stays
 * deterministic. The page links use their own types (CITES, HAS_CAPABILITY),
 * not the page-to-page LINKS_TO and RELATED_TO or DOCUMENTS, so a page graph
 * that lists the pages linking to it, or the commands a page documents,
 * never picks up a Capability.
 *
 *   (:Capability {id, title, problem, capability, url, schema_url, verify})
 *   (:Problem {id, text, kind})                   kind: problem | intent
 *   (:Capability)-[:SOLVES]->(:Problem)
 *   (:Capability)-[:APPLIES_TO]->(:Surface)
 *   (:Capability)-[:CITES {role, anchor}]->(:Page)              role: guide | reference
 *   (:CookbookRecipe)-[:DEMONSTRATES]->(:Capability)
 *   (:Capability)-[:VERIFIED_BY {cell}]->(:CookbookRecipe|:Page)  cell: a cell or sample id, or step-<n>
 *   (:Page {id: concepts/problems-relate-solves})-[:HAS_CAPABILITY]->(:Capability)
 */
export function capabilityGraphRows(caps: Capability[] = readCapabilities()): { nodes: CapabilityGraphNode[]; rels: CapabilityGraphRel[] } {
  const nodes: CapabilityGraphNode[] = [];
  const rels: CapabilityGraphRel[] = [];
  const cap = (id: string) => ({ label: 'Capability', id });
  for (const c of [...caps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    nodes.push({
      label: 'Capability',
      id: c.id,
      props: {
        id: c.id,
        title: c.title,
        problem: c.problem,
        capability: c.capability,
        url: abs(`${pageUrl(CAPABILITIES_PAGE)}#${c.id}`),
        schema_url: c.schema ? abs(schemaPath(c.id)) : null,
        verify: c.verify,
      },
    });
    const problems = [{ id: `${c.id}#problem`, text: c.problem, kind: 'problem' }, ...c.intents.map((text, i) => ({ id: `${c.id}#intent-${i + 1}`, text, kind: 'intent' }))];
    for (const p of problems) {
      nodes.push({ label: 'Problem', id: p.id, props: p });
      rels.push({ type: 'SOLVES', from: cap(c.id), to: { label: 'Problem', id: p.id }, props: {} });
    }
    for (const s of c.surfaces) rels.push({ type: 'APPLIES_TO', from: cap(c.id), to: { label: 'Surface', id: s }, props: {} });
    for (const [role, refs] of [['guide', c.guides], ['reference', c.reference]] as const) {
      for (const ref of refs) {
        const [id, anchor] = ref.split('#');
        rels.push({ type: 'CITES', from: cap(c.id), to: { label: 'Page', id }, props: { role, anchor: anchor ?? null } });
      }
    }
    for (const slug of c.recipes) rels.push({ type: 'DEMONSTRATES', from: { label: 'CookbookRecipe', id: slug }, to: cap(c.id), props: {} });
    const v = c.verify === null ? null : parseVerify(c.verify);
    if (v) rels.push({ type: 'VERIFIED_BY', from: cap(c.id), to: { label: v.kind === 'cookbook' ? 'CookbookRecipe' : 'Page', id: v.target }, props: { cell: v.cell } });
    rels.push({ type: 'HAS_CAPABILITY', from: { label: 'Page', id: CAPABILITIES_PAGE }, to: cap(c.id), props: {} });
  }
  nodes.sort((a, b) => (a.label + a.id < b.label + b.id ? -1 : 1));
  return { nodes, rels };
}

// ---------------------------------------------------------------------------
// `node src/lib/docs/capabilities.ts --write`: rewrite the page's generated section.

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv.includes('--write')) {
    console.error(`usage: ${WRITE_COMMAND}   rewrite the generated section of src/content/docs/${CAPABILITIES_PAGE}.mdx`);
    process.exit(2);
  }
  const caps = readCapabilities();
  const ctx = catalogContext();
  const problems = capabilityProblems(caps, ctx);
  if (problems.length) {
    for (const p of problems) console.error(`${relative(ROOT, p.file)}  ${p.message}`);
    console.error(`capabilities: ${problems.length} problem(s); nothing written`);
    process.exit(1);
  }
  const changed = writeSection(caps, ctx);
  console.log(changed ? `capabilities: rewrote the generated section of ${relative(ROOT, CAPABILITIES_PAGE_FILE)} (${caps.length} capabilities)` : `capabilities: ${relative(ROOT, CAPABILITIES_PAGE_FILE)} is current`);
  if (changed) console.log('then: npm run docs:diagrams (data models), npm run docs:check');
}

#!/usr/bin/env node
// Builds the hosted docs MCP server's data from the site build (DOCS-PLAN.md
// §3.7, §3.8; ADR-0015: the seed script is the docs-graph artifact). Runs on
// Node directly (type stripping), after `npm run build` at the repository
// root:
//
//   npm run bundle            (inside workers/docs-mcp)
//
// Reads
//   dist/docs/graph.cypher               the docs graph's seed script (replayed without its vector statements)
//   dist/docs/graph.json                 the same graph: pages, sections, terms, recipes
//   dist/docs/capabilities.json          the capability catalog (discover_capabilities, relate-docs://capabilities)
//   dist/cookbook/<slug>/recipe.json     each recipe's cells (relate-docs://example/<recipe>/<cell>)
//   dist/docs/samples.json, dist/docs/<page>/samples/<id>.json   the verified samples' index and manifests (relate-docs://samples, relate-docs://sample/<page>/<id>)
//   src/content/cookbook/<slug>.md       each cell's recorded result and the recipe's summary
//   dist/docs/<id>.md                    every page's markdown twin
//   dist/docs/llms.txt                   the index
//   dist/docs/get-started/agent-quickstart.md   the onboard prompt's source
//   src/content/docs/_data/engine.json   the verified engine version
//   src/content/docs/_data/errors.json   the errors reference
//   public/releases.json                 releases and their assets
//   public/skills/<name>/**              the CLI's skill bundle and the task skills, as served
//   public/wasm/{relate.js,relate_bg.wasm,snippets/}   the engine
// and writes workers/docs-mcp/generated/ (gitignored):
//   docs.json        pages with their section offsets, refs, errors, llms.txt, skills, releases, the prompts,
//                    the capability catalog, the cookbook examples, the sample manifests, the dialect table
//   graph.cypher     the seed script without the statements that set section vectors (seedWithoutVectors)
//   vectors.txt      those vectors as the JSON parameters of VECTOR_LOAD_STATEMENT, loaded by the
//                    hybrid lane of search_docs on first use
//   wasm/            the engine's glue and binary, copied so the site's Vite build never sees them, and
//                    relate-factory.js, the same glue as a factory (a fresh instance per validate_cypher)
//
// Fails when an input is missing, or when a twin and the docs graph disagree
// about a section's text (the twin is the source of the bytes get_page
// returns; the graph is the source of the anchors search_docs returns), and
// when a one-line JSON resource (the capability catalog, the releases, an
// example cell) or a sample manifest would pass the Worker's 96 KiB text cap.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import GithubSlugger from 'github-slugger';
import { parse as parseYaml } from 'yaml';

import { parseRecipe, verifiesSummary, INLINE_DATA_BYTES } from '../../../src/lib/cookbook/recipe.ts';
import { factoryGlue, seedVectors, seedWithoutVectors } from './seed.ts';
import { frontmatterEnd, plainHeading, scanHeadings, sliceSection, TERMS_HEADING, type SectionSpan, type TwinIndex } from '../src/sections.ts';
import type { Bundle, DialectRow, ErrorEntry, ExampleCell, ExampleRecipe, PageEntry, Ref, ReleaseEntry, SampleEntry } from '../src/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');
const ROOT = resolve(process.env.RELATE_WEB_ROOT ?? join(PKG, '../..'));
const DIST = resolve(process.env.RELATE_WEB_DIST ?? join(ROOT, 'dist'));
const OUT = join(PKG, 'generated');
const ORIGIN = 'https://relatedb.ai';

const rel = (p: string) => relative(process.cwd(), p) || '.';
function fail(message: string): never {
  console.error(`bundle: ${message}`);
  return process.exit(1) as never;
}
function read(path: string): string {
  if (!existsSync(path)) fail(`${rel(path)} is missing; run \`npm run build\` at the repository root first`);
  return readFileSync(path, 'utf8');
}
const readJson = <T>(path: string): T => JSON.parse(read(path)) as T;

// ---------------------------------------------------------------------------
// Inputs

interface GraphNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}
interface GraphJson {
  kind: string;
  verified: string;
  nodes: GraphNode[];
  relationships: { type: string; start: string; end: string }[];
}

const seedServed = read(join(DIST, 'docs/graph.cypher'));

// The Worker replays the seed without its vector statements and loads the
// vectors as one parameter on the hybrid lane's first use (ADR-0028).
let seed: string;
let vectorRows: { id: string; v: number[] }[];
try {
  seed = seedWithoutVectors(seedServed);
  vectorRows = seedVectors(seedServed);
} catch (err) {
  fail(`dist/docs/graph.cypher: ${(err as Error).message}`);
}
if (/vector\(row\.v/.test(seed)) fail('the seed without vectors still sets vectors: graph.ts seedScript() changed; update VECTOR_SEED_END in scripts/seed.ts');
const graph = readJson<GraphJson>(join(DIST, 'docs/graph.json'));
const engine = readJson<Record<string, unknown>>(join(ROOT, 'src/content/docs/_data/engine.json'));
const errorsJson = readJson<Record<string, unknown>>(join(ROOT, 'src/content/docs/_data/errors.json'));
const releasesJson = readJson<{ latest: ReleaseEntry & { notes?: string }; releases: (ReleaseEntry & { notes?: string })[] }>(join(ROOT, 'public/releases.json'));
const llms = read(join(DIST, 'docs/llms.txt'));

const verified = String(engine.verified);
if (graph.verified !== verified) fail(`dist/docs/graph.json is verified against ${graph.verified}; _data/engine.json says ${verified}; rebuild the site`);

const byLabel = (label: string) => graph.nodes.filter((n) => n.labels[0] === label).map((n) => n.properties);
const graphPages = new Map(byLabel('Page').map((p) => [String(p.id), p]));
const terms = new Map(byLabel('Term').map((t) => [String(t.id), t]));
const recipes = new Map(byLabel('CookbookRecipe').map((r) => [String(r.id), r]));
const sectionsByPage = new Map<string, Record<string, unknown>[]>();
for (const s of byLabel('Section')) {
  const list = sectionsByPage.get(String(s.page)) ?? [];
  list.push(s);
  sectionsByPage.set(String(s.page), list);
}

// ---------------------------------------------------------------------------
// Twins

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const docsDir = join(DIST, 'docs');
const twinFiles = walk(docsDir).filter((p) => p.endsWith('.md') && !p.endsWith('.graph.md') && !p.endsWith('/index.md'));

const textDiffers: string[] = [];
const anchorsGuessed: string[] = [];

/** The h2 and h3 anchors of a built page's content column, in order. */
function htmlAnchors(id: string): { level: number; id: string; text: string }[] {
  const path = join(DIST, 'docs', id, 'index.html');
  if (!existsSync(path)) return [];
  const html = readFileSync(path, 'utf8');
  const start = html.indexOf('<article class="docs-main"');
  const end = html.indexOf('</article>', start);
  const article = start >= 0 ? html.slice(start, end < 0 ? undefined : end) : html;
  const out: { level: number; id: string; text: string }[] = [];
  for (const m of article.matchAll(/<h([23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const text = m[3].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    out.push({ level: Number(m[1]), id: m[2], text });
  }
  return out;
}

/** Map the graph's sections (or, for a page the graph does not hold, the twin's own headings) to offsets. */
function indexTwin(id: string, twin: string): TwinIndex {
  const fmEnd = frontmatterEnd(twin);
  const headings = scanHeadings(twin).filter((h) => h.start >= fmEnd);
  const termsHeading = [...headings].reverse().find((h) => h.level === 2 && plainHeading(h.raw) === TERMS_HEADING);
  const termsStart = termsHeading?.start ?? twin.length;
  const body = headings.filter((h) => h.start < termsStart && (h.level === 2 || h.level === 3));
  const sections: SectionSpan[] = [];
  const graphSections = (sectionsByPage.get(id) ?? []).filter((s) => Number(s.level) >= 2).sort((a, b) => Number(a.position) - Number(b.position));

  if (graphSections.length) {
    // The graph's sections are the headings the author wrote; the twin may add
    // more (a tab set becomes one ### per tab), which stay inside their section.
    let cursor = 0;
    for (const s of graphSections) {
      const text = String(s.text ?? '');
      const level = Number(s.level);
      const heading = String(s.heading);
      let h = body.slice(cursor).find((x) => x.level === level && plainHeading(x.raw) === heading);
      if (!h && text) {
        const at = twin.indexOf(text, body[cursor]?.start ?? fmEnd);
        h = at >= 0 ? [...body].reverse().find((x) => x.start < at && x.level === level) : undefined;
      }
      if (!h) fail(`${id}: section "${heading}" (#${s.anchor}) is in the docs graph but not in the twin`);
      // The graph stores some sections re-stringified (a generated table is
      // padded), so a byte difference is counted, not fatal: get_page returns
      // the twin's bytes and only takes the anchor from the graph.
      if (text && twin.slice(h.lineEnd).replace(/^\n/, '').slice(0, text.length) !== text) textDiffers.push(`${id}#${s.anchor}`);
      cursor = body.indexOf(h) + 1;
      sections.push({ anchor: String(s.anchor), heading, level, start: h.start });
    }
  } else {
    // A generated page (not a Page node yet, ADR-0020): take each heading's
    // anchor from the built HTML, in order and by level; a glossary entry's
    // anchor is its term id; anything else falls back to the slug.
    const html = htmlAnchors(id);
    const byTerm = new Map([...terms.values()].map((t) => [String(t.term).toLowerCase(), String(t.id)]));
    const slugger = new GithubSlugger();
    let cursor = 0;
    for (const h of body) {
      const heading = plainHeading(h.raw);
      const slug = slugger.slug(heading);
      const at = html.findIndex((a, k) => k >= cursor && a.level === h.level);
      let anchor: string;
      if (at >= 0 && (html[at].text === heading || html[at].id === slug)) {
        anchor = html[at].id;
        cursor = at + 1;
      } else if (id === 'reference/glossary' && byTerm.has(heading.toLowerCase())) {
        anchor = byTerm.get(heading.toLowerCase())!;
      } else {
        anchor = slug;
        anchorsGuessed.push(`${id}#${slug}`);
      }
      sections.push({ anchor, heading, level: h.level, start: h.start });
    }
  }

  const termLines: { id: string; line: string }[] = [];
  if (termsHeading) {
    const byName = new Map([...terms.values()].map((t) => [String(t.term).toLowerCase(), String(t.id)]));
    for (const line of twin.slice(termsHeading.lineEnd).split('\n')) {
      const m = /^- \*\*(.+?)\*\*:/.exec(line);
      if (!m) continue;
      const tid = byName.get(m[1].toLowerCase());
      if (!tid) fail(`${id}: the Terms entry "${m[1]}" names no glossary term`);
      termLines.push({ id: tid, line });
    }
  }
  for (let k = 1; k < sections.length; k++) {
    if (sections[k].start <= sections[k - 1].start) fail(`${id}: section #${sections[k].anchor} comes before #${sections[k - 1].anchor} in the twin but after it in the docs graph`);
  }
  return { frontmatterEnd: fmEnd, sections, termsStart, terms: termLines };
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

const pages: Record<string, PageEntry> = {};
for (const file of twinFiles) {
  const twin = readFileSync(file, 'utf8');
  const fmEnd = frontmatterEnd(twin);
  if (!fmEnd) continue;
  const fm = parseYaml(twin.slice(4, fmEnd - 5)) as Record<string, unknown>;
  const canonical = String(fm.canonical_url ?? '');
  const id = relative(docsDir, file).replace(/\.md$/, '');
  // Only a page's own twin: /docs/changelog.md repeats reference/changelog, feedback.md is not a page.
  if (canonical !== `${ORIGIN}/docs/${id}/`) continue;
  const g = graphPages.get(id);
  pages[id] = {
    id,
    title: String(fm.title),
    description: String(fm.description ?? ''),
    type: fm.type ? String(fm.type) : null,
    section: id.split('/')[0],
    status: String(fm.status ?? 'stable'),
    surfaces: asList(fm.surfaces),
    verified: String(fm.verified ?? verified),
    url: canonical,
    md_url: `${ORIGIN}/docs/${id}.md`,
    prerequisites: asList(fm.prerequisites),
    related: asList(fm.related),
    tokens: typeof g?.tokens === 'number' ? g.tokens : null,
    in_graph: Boolean(g),
    twin,
    index: indexTwin(id, twin),
  };
}
if (!pages['get-started/agent-quickstart'] || !pages['reference/errors'] || !pages['get-started/install']) fail('a phase 1 page is missing from dist/docs');
// search_docs's description says only the generated glossary, changelog and docs MCP usage pages are left
// out of the search (src/server.ts): any other page outside the docs graph would make it false.
const NOT_SEARCHED = ['reference/changelog', 'reference/glossary', 'reference/server/docs-mcp-usage'];
const outside = Object.values(pages).filter((p) => !p.in_graph).map((p) => p.id).sort();
if (JSON.stringify(outside) !== JSON.stringify(NOT_SEARCHED)) fail(`pages outside the docs graph (not searched) are ${outside.join(', ') || '(none)'}; search_docs's description in src/server.ts names ${NOT_SEARCHED.join(', ')}`);

/** Anything a page can name as a prerequisite or related page. */
const refs: Record<string, Ref> = {};
for (const [id, p] of graphPages) refs[id] = { id, title: String(p.title), url: p.url ? String(p.url) : null, md_url: p.md_url ? String(p.md_url) : null, status: String(p.status) };
for (const p of Object.values(pages)) refs[p.id] = { id: p.id, title: p.title, url: p.url, md_url: p.md_url, status: p.status };
for (const [id, r] of recipes) refs[`cookbook/${id}`] = { id: `cookbook/${id}`, title: String(r.title), url: String(r.url), md_url: String(r.md_url), status: 'stable' };

// ---------------------------------------------------------------------------
// Errors: every entry with its anchor and the pages that link to it

const ERROR_GROUPS = ['cli', 'engine', 'http', 'bolt', 'mcp', 'client'] as const;
const errorsUrl = `${ORIGIN}/docs/reference/errors/`;
const errors: ErrorEntry[] = [];
for (const group of ERROR_GROUPS) {
  for (const raw of (errorsJson[group] as Record<string, unknown>[]) ?? []) {
    const id = String(raw.id);
    const linking = Object.values(pages)
      .filter((p) => p.id !== 'reference/errors' && p.twin.includes(`/docs/reference/errors/#${id})`))
      .map((p) => p.id);
    const pick = (k: string) => (raw[k] === undefined ? null : raw[k]);
    errors.push({
      id,
      surface: String(raw.surface ?? group),
      code: pick('code') as string | null,
      kind: pick('kind') as string | null,
      gql_status: pick('gql_status') as string | null,
      neo4j_code: pick('neo4j_code') as string | null,
      exit_code: pick('exit_code') as number | null,
      jsonrpc_code: pick('jsonrpc_code') as number | null,
      http_status: pick('http_status') as number | null,
      python_class: pick('python_class') as string | null,
      retryable: pick('retryable') as boolean | null,
      message: pick('message') as string | null,
      cause: pick('cause') as string | null,
      remedy: pick('remedy') as string | null,
      note: pick('note') as string | null,
      url: `${errorsUrl}#${id}`,
      pages: ['reference/errors', ...linking],
    });
  }
}
const notifications = ((errorsJson.notifications as Record<string, unknown>[]) ?? []).map((n) => ({
  id: String(n.id),
  gql_status: String(n.gql_status),
  code: String(n.code),
  severity: n.severity ? String(n.severity) : null,
  category: n.category ? String(n.category) : null,
  title: n.title ? String(n.title) : null,
  url: `${errorsUrl}#${String(n.id)}`,
}));
const anchorMissing = errors.filter((e) => !read(join(DIST, 'docs/reference/errors/index.html')).includes(`id="${e.id}"`));
if (anchorMissing.length) fail(`reference/errors has no anchor for ${anchorMissing.map((e) => e.id).join(', ')}`);

// ---------------------------------------------------------------------------
// Skill, releases, the onboard prompt

// Every skill served under /skills/<name>/: the CLI's bundle (relate) and the
// task skills (ADR-0032), each SKILL.md plus its references, as served.
const skillsRoot = join(ROOT, 'public/skills');
const skills: Record<string, Record<string, string>> = {};
for (const name of readdirSync(skillsRoot).sort()) {
  const dir = join(skillsRoot, name);
  if (!statSync(dir).isDirectory()) continue;
  if (!existsSync(join(dir, 'SKILL.md'))) fail(`${rel(dir)}/SKILL.md is missing`);
  const files: Record<string, string> = {};
  for (const f of walk(dir)) {
    const path = relative(dir, f).replaceAll('\\', '/');
    if (path !== 'SKILL.md' && !/^references\/[\w.-]+\.md$/.test(path)) fail(`${rel(f)}: a skill holds SKILL.md and references/*.md only`);
    files[path] = readFileSync(f, 'utf8');
  }
  skills[name] = files;
}
if (!skills.relate) fail('public/skills/relate/ is missing');

const releases = {
  source: `${ORIGIN}/releases.json`,
  latest: releasesJson.latest.tag,
  releases: releasesJson.releases.map((r, i) => ({
    tag: r.tag,
    published_at: r.published_at,
    prerelease: r.prerelease,
    assets: r.assets,
    // The newest release's notes in full; older ones are in releases.json.
    ...(i === 0 && r.notes ? { notes: r.notes } : {}),
  })),
};

// Every section get_page can return is cut by src/lib/docs/negotiation.ts,
// the code `?section=` runs; it must find each section where the bundle
// put it, so the two answers stay the same bytes.
for (const p of Object.values(pages)) {
  p.index.sections.forEach((s, i) => {
    let md: string;
    try {
      md = sliceSection(p.twin, p.index, i, p.md_url).markdown;
    } catch (err) {
      fail(`${p.id}#${s.anchor}: the ?section= slicer cannot find it (${(err as Error).message})`);
    }
    const line = p.twin.slice(s.start, p.twin.indexOf('\n', s.start));
    if (!md.slice(p.index.frontmatterEnd + 1).startsWith(`${line}\n`)) fail(`${p.id}#${s.anchor}: the ?section= slicer starts the section somewhere other than "${line}"`);
  });
}

// The onboard prompt: the agent quickstart's install, verify, briefing and
// AGENTS.md steps, verbatim from its twin, behind one framing paragraph.
const quick = pages['get-started/agent-quickstart'];
const QUICK_SECTIONS = ['install-a-pinned-relate', 'check-the-output-format', 'install-the-skill', 'read-the-briefing', 'add-relate-to-your-agentsmd'];
const quickBody = QUICK_SECTIONS.map((anchor) => {
  const i = quick.index.sections.findIndex((s) => s.anchor === anchor);
  if (i < 0) fail(`get-started/agent-quickstart has no section #${anchor}; update QUICK_SECTIONS in scripts/bundle.ts`);
  const s = quick.index.sections[i];
  const next = quick.index.sections.slice(i + 1).find((x) => x.level <= s.level)?.start ?? quick.index.termsStart;
  return quick.twin.slice(s.start, next).replace(/\s+$/, '');
}).join('\n\n');
const onboard = [
  `Set up relate, the embedded Cypher graph database (relatedb.ai), on this machine by following the steps below. They are quoted from ${quick.url} (markdown: ${quick.md_url}) and are verified against relate ${verified}.`,
  '',
  `Install the pinned release and make every check before the binary runs; if a check fails, delete the downloads, install nothing, and report which check failed. Then run \`relate --version\` and \`relate --mode envelope "RETURN 1 AS ok"\`, and report both outputs next to the ones shown below. Open every store with \`--read-only\` until the user asks for a write. The remaining steps, \`relate agent-context\` and the AGENTS.md block, finish the setup.`,
  '',
  '---',
  '',
  quickBody,
  '',
].join('\n');

// ---------------------------------------------------------------------------
// The capability catalog (ADR-0026): served byte for byte as
// relate-docs://capabilities and ranked by discover_capabilities.

const capabilitiesText = read(join(DIST, 'docs/capabilities.json'));
const capabilitiesJson = JSON.parse(capabilitiesText) as { kind: string; verified: string; capabilities: { id: string; urls: { page: string } }[] };
if (capabilitiesJson.kind !== 'documentation') fail('dist/docs/capabilities.json has no kind "documentation"');
if (capabilitiesJson.verified !== verified) fail(`dist/docs/capabilities.json is verified against ${capabilitiesJson.verified}, not ${verified}; rebuild the site`);
if (!capabilitiesJson.capabilities.length) fail('dist/docs/capabilities.json lists no capability');

// ---------------------------------------------------------------------------
// The cookbook examples: relate-docs://example/<recipe>/<cell>. The cells and
// their titles from the built recipe.json, each recorded result from the
// recipe's source (the twin's result block), the verifies summary from
// src/lib/cookbook/recipe.ts. A recipe.json whose cells differ from the
// source means a stale build.

const cookbookDist = join(DIST, 'cookbook');
const cookbookSrc = join(ROOT, 'src/content/cookbook');
const examples: Record<string, ExampleRecipe> = {};
for (const slug of readdirSync(cookbookDist).sort()) {
  const jsonPath = join(cookbookDist, slug, 'recipe.json');
  if (!existsSync(jsonPath)) continue;
  const built = readJson<{ format: number; slug: string; title: string; verifies?: ExampleRecipe['verifies']; cells: { id: string; title?: string; code: string; paramsPath: string | null; setup: boolean; expectError: boolean }[] }>(jsonPath);
  if (built.format !== 1) fail(`${rel(jsonPath)} has format ${built.format}, not 1`);
  const recipe = parseRecipe(slug, read(join(cookbookSrc, `${slug}.md`)));
  const verifies = verifiesSummary(recipe);
  if (built.verifies && JSON.stringify(built.verifies) !== JSON.stringify(verifies)) fail(`${rel(jsonPath)}: its verifies summary differs from the recipe's; rebuild the site`);
  const recipeUrl = `${ORIGIN}/cookbook/${slug}/`;
  const cells: ExampleCell[] = built.cells.map((c) => {
    const src = recipe.cells.find((x) => x.id === c.id);
    if (!src || src.code !== c.code) fail(`${rel(jsonPath)}: cell ${c.id} differs from src/content/cookbook/${slug}.md; rebuild the site`);
    let parameters: unknown = null;
    let parametersBytes: number | null = null;
    if (c.paramsPath) {
      const text = read(join(cookbookDist, slug, c.paramsPath));
      parametersBytes = Buffer.byteLength(text);
      // Parameter blocks beside their step are inlined; datasets are linked.
      if (parametersBytes !== null && parametersBytes <= INLINE_DATA_BYTES) parameters = JSON.parse(text);
    }
    return {
      id: c.id,
      title: c.title ?? c.id,
      statement: c.code,
      setup: c.setup,
      expect_error: c.expectError,
      url: `${recipeUrl}#cell-${c.id}`,
      playground: `${ORIGIN}/playground/#recipe=${slug}&cell=${c.id}`,
      parameters_url: c.paramsPath ? `${recipeUrl}${c.paramsPath}` : null,
      parameters_bytes: parametersBytes,
      parameters,
      result: src.result ? { kind: src.result.kind, text: src.result.text } : null,
    };
  });
  if (recipe.cells.length !== cells.length) fail(`${rel(jsonPath)} lists ${cells.length} cells; the recipe has ${recipe.cells.length}; rebuild the site`);
  examples[slug] = { slug, title: built.title, url: recipeUrl, md_url: `${recipeUrl}index.md`, verifies, cells };
}
if (!Object.keys(examples).length) fail('dist/cookbook/ holds no recipe.json');

// ---------------------------------------------------------------------------
// The verified samples' manifests (ADR-0053): relate-docs://samples is
// /docs/samples.json byte for byte, relate-docs://sample/<page>/<id> each
// manifest it lists. A manifest whose bytes do not hash to the index's
// sha256 means a stale build.

const samplesIndexPath = join(DIST, 'docs/samples.json');
const samplesIndexText = read(samplesIndexPath);
const samplesIndex = JSON.parse(samplesIndexText) as { kind: string; verified: string; samples: { page: string; id: string; language: string; url: string; sha256: string }[] };
if (samplesIndex.kind !== 'documentation') fail('dist/docs/samples.json has no kind "documentation"');
if (samplesIndex.verified !== verified) fail(`dist/docs/samples.json is verified against ${samplesIndex.verified}, not ${verified}; rebuild the site`);
const sampleManifests: SampleEntry[] = samplesIndex.samples.map((s) => {
  const path = new URL(s.url).pathname;
  const text = read(join(DIST, path));
  if (createHash('sha256').update(text, 'utf8').digest('hex') !== s.sha256) fail(`dist${path} does not hash to the sha256 dist/docs/samples.json gives it; rebuild the site`);
  const manifest = JSON.parse(text) as { page: { title: string } };
  return { uri: `relate-docs://sample/${s.page}/${s.id}`, page: s.page, page_title: manifest.page.title, id: s.id, language: s.language, url: s.url, text };
});

// ---------------------------------------------------------------------------
// The dialect notes: the Differences table of reference/cypher/differences-from-neo4j,
// verbatim for the text-to-cypher prompt and as rows for validate_cypher's remedies.

const DIALECT_PAGE = 'reference/cypher/differences-from-neo4j';
const dialectPage = pages[DIALECT_PAGE];
if (!dialectPage) fail(`${DIALECT_PAGE} is missing from dist/docs`);
const diffIndex = dialectPage.index.sections.findIndex((x) => x.anchor === 'differences');
if (diffIndex < 0) fail(`${DIALECT_PAGE} has no section #differences`);
const diffStart = dialectPage.index.sections[diffIndex].start;
const diffEnd = dialectPage.index.sections[diffIndex + 1]?.start ?? dialectPage.index.termsStart;
const tableLines = dialectPage.twin.slice(diffStart, diffEnd).split('\n').filter((l) => l.startsWith('|'));
if (tableLines.length < 3) fail(`${DIALECT_PAGE}#differences holds no table`);
const dialectTable = tableLines.join('\n');

/** A table row's cells: split on `|` outside code spans; `\|` stays a pipe. */
function tableCells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let tick = 0;
  for (let i = 1; i < line.length; i++) {
    const ch = line[i];
    if (ch === '`') {
      let n = 0;
      while (line[i + n] === '`') n++;
      if (tick === 0) tick = n;
      else if (tick === n) tick = 0;
      cur += '`'.repeat(n);
      i += n - 1;
    } else if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|' && tick === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  return out;
}
/** Inline code spans of a markdown cell, as CommonMark strips them (one space each side for padded spans). */
function codeSpans(cell: string): string[] {
  const out: string[] = [];
  for (const m of cell.matchAll(/(`+)([\s\S]*?[^`])\1(?!`)/g)) {
    let t = m[2];
    if (t.length > 2 && t.startsWith(' ') && t.endsWith(' ')) t = t.slice(1, -1);
    out.push(t);
  }
  return out;
}
const header = tableCells(tableLines[0]);
const col = (name: string) => {
  const i = header.indexOf(name);
  if (i < 0) fail(`${DIALECT_PAGE}#differences has no "${name}" column (columns: ${header.join(', ')})`);
  return i;
};
const [cFeature, cNeo4j, cRelate, cInstead] = [col('Feature'), col('Neo4j'), col('relate'), col('Write instead')];

// Each example cell that expects an error, with the error it recorded: a row
// whose message is that error cites the cell's anchor.
const cellErrors = new Map<string, string>();
{
  const twin = dialectPage.twin;
  for (const m of twin.matchAll(/^```cypher run name=([\w-]+)[^\n]*expect=error[^\n]*\n[\s\S]*?^```\n\n```table\nerror: ([^\n]+)\n/gm)) cellErrors.set(m[2], `cell-${m[1]}`);
}
const dialectHtml = read(join(DIST, 'docs', DIALECT_PAGE, 'index.html'));
const dialectRows: DialectRow[] = tableLines.slice(2).map((line) => {
  const cells = tableCells(line);
  const spans = codeSpans(cells[cRelate]).filter((t) => /error:|deprecated|unexpected token/.test(t));
  const anchor = spans.map((t) => cellErrors.get(t)).find(Boolean) ?? null;
  if (anchor && !dialectHtml.includes(`id="${anchor}"`)) fail(`${DIALECT_PAGE} has no anchor #${anchor}`);
  return {
    feature: cells[cFeature],
    neo4j: cells[cNeo4j],
    relate: cells[cRelate],
    write_instead: cells[cInstead],
    messages: spans,
    url: `${dialectPage.url}#${anchor ?? 'differences'}`,
  };
});

// ---------------------------------------------------------------------------
// The text-to-cypher prompt (DOCS-PLAN.md §3.8): its fixed parts. The intent
// and the schema argument are filled in per request by src/server.ts.

const textToCypher = {
  source: dialectPage.url,
  md_url: dialectPage.md_url,
  table: dialectTable,
};

// ---------------------------------------------------------------------------
// Write

const bundle: Bundle = {
  format: 1,
  kind: 'documentation',
  origin: ORIGIN,
  verified,
  engine: { version: String(engine.version), verified, date: String(engine.date), commit: engine.commit ? String(engine.commit) : null, source_build: Boolean(engine.source_build) },
  graph: {
    nodes: graph.nodes.length,
    relationships: graph.relationships.length,
    seed_bytes: Buffer.byteLength(seed),
    served_seed_bytes: Buffer.byteLength(seedServed),
    vectors: vectorRows.length,
  },
  pages,
  refs,
  errors,
  notifications,
  llms,
  skills,
  releases,
  onboard: { text: onboard, source: quick.url },
  capabilities: { text: capabilitiesText, source: `${ORIGIN}/docs/capabilities.json`, page: capabilitiesJson.capabilities[0].urls.page.replace(/#.*$/, '') },
  examples,
  samples: { index: { text: samplesIndexText, source: `${ORIGIN}/docs/samples.json` }, manifests: sampleManifests },
  dialect: { page: DIALECT_PAGE, url: dialectPage.url, md_url: dialectPage.md_url, rows: dialectRows },
  textToCypher,
};

// The JSON resources are one line each, so the Worker's text cap (96 KiB,
// src/docs.ts MAX_TEXT_BYTES) has no line to cut them at and would serve
// invalid JSON: fail here instead, with room for the kind, note and version
// fields the Worker adds (JSON_ENVELOPE_BYTES).
const MAX_TEXT_BYTES = 96 * 1024;
const JSON_ENVELOPE_BYTES = 1024;
const overCap = (what: string, n: number) => {
  if (n > MAX_TEXT_BYTES) fail(`${what} is ${n} bytes as served, over the Worker's ${MAX_TEXT_BYTES / 1024} KiB text cap; a JSON resource cannot be cut at a line`);
};
overCap('relate-docs://capabilities', Buffer.byteLength(capabilitiesText));
overCap('relate-docs://releases', Buffer.byteLength(JSON.stringify(releases)) + JSON_ENVELOPE_BYTES);
// The sample manifests are served as the site serves them (two-space JSON): a cut at a line would still not be JSON.
overCap('relate-docs://samples', Buffer.byteLength(samplesIndexText));
for (const m of sampleManifests) overCap(m.uri, Buffer.byteLength(m.text));
for (const r of Object.values(examples)) {
  const recipeMeta = { slug: r.slug, title: r.title, url: r.url, md_url: r.md_url, cells: r.cells.length, position: r.cells.length, verifies: r.verifies };
  for (const c of r.cells) overCap(`relate-docs://example/${r.slug}/${c.id}`, Buffer.byteLength(JSON.stringify({ recipe: recipeMeta, cell: c })) + JSON_ENVELOPE_BYTES);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'wasm'), { recursive: true });
writeFileSync(join(OUT, 'docs.json'), JSON.stringify(bundle));
writeFileSync(join(OUT, 'graph.cypher'), seed);
writeFileSync(join(OUT, 'vectors.txt'), JSON.stringify({ rows: vectorRows }));
const wasmDir = join(ROOT, 'public/wasm');
for (const f of ['relate.js', 'relate.d.ts', 'relate_bg.wasm', 'trap.js']) cpSync(join(wasmDir, f), join(OUT, 'wasm', f));
cpSync(join(wasmDir, 'snippets'), join(OUT, 'wasm/snippets'), { recursive: true });
try {
  writeFileSync(join(OUT, 'wasm/relate-factory.js'), factoryGlue(read(join(wasmDir, 'relate.js'))));
} catch (err) {
  fail(`public/wasm/relate.js: ${(err as Error).message}`);
}

const size = (p: string) => {
  const b = readFileSync(p);
  return `${(b.length / 1024).toFixed(0)} KiB (${(gzipSync(b, { level: 9 }).length / 1024).toFixed(0)} KiB gzipped)`;
};
const skillFiles = Object.values(skills).reduce((n, f) => n + Object.keys(f).length, 0);
const exampleCells = Object.values(examples).reduce((n, r) => n + r.cells.length, 0);
console.log(`bundle: ${Object.keys(pages).length} pages, ${Object.values(pages).reduce((n, p) => n + p.index.sections.length, 0)} sections, ${errors.length} errors, ${notifications.length} notifications, ${Object.keys(skills).length} skills (${skillFiles} files), ${releases.releases.length} releases, ${capabilitiesJson.capabilities.length} capabilities, ${Object.keys(examples).length} recipes (${exampleCells} cells), ${sampleManifests.length} sample manifests, ${dialectRows.length} dialect rows (${dialectRows.filter((r) => r.messages.length).length} with a message); verified ${verified}`);
console.log(`  seed: ${Buffer.byteLength(seedServed)} bytes served, ${Buffer.byteLength(seed)} replayed without the ${vectorRows.length} section vectors`);
if (anchorsGuessed.length) console.log(`  ${anchorsGuessed.length} generated-page anchors not found in the built HTML, slugged instead: ${anchorsGuessed.slice(0, 5).join(', ')}`);
if (textDiffers.length) console.log(`  ${textDiffers.length} sections whose graph text is not byte-equal to the twin (anchors still match): ${textDiffers.slice(0, 5).join(', ')}${textDiffers.length > 5 ? ', …' : ''}`);
console.log(`  generated/docs.json        ${size(join(OUT, 'docs.json'))}`);
console.log(`  generated/graph.cypher     ${size(join(OUT, 'graph.cypher'))}`);
console.log(`  generated/vectors.txt      ${size(join(OUT, 'vectors.txt'))}`);
console.log(`  generated/wasm/relate_bg.wasm  ${size(join(OUT, 'wasm/relate_bg.wasm'))}`);
console.log(`  generated/wasm/relate.js   ${size(join(OUT, 'wasm/relate.js'))}`);

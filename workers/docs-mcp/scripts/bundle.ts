#!/usr/bin/env node
// Builds the hosted docs MCP server's data from the site build (DOCS-PLAN.md
// §3.7, §3.8; ADR-0015: the seed script is the docs-graph artifact). Runs on
// Node directly (type stripping), after `npm run build` at the repository
// root:
//
//   npm run bundle            (inside workers/docs-mcp)
//
// Reads
//   dist/docs/graph.cypher               the docs graph's seed script (replayed by the Worker)
//   dist/docs/graph.json                 the same graph: pages, sections, terms, recipes
//   dist/docs/<id>.md                    every page's markdown twin
//   dist/docs/llms.txt                   the index
//   dist/docs/get-started/agent-quickstart.md   the onboard prompt's source
//   src/content/docs/_data/engine.json   the verified engine version
//   src/content/docs/_data/errors.json   the errors reference
//   public/releases.json                 releases and their assets
//   public/skills/relate/**              the skill bundle as served
//   public/wasm/{relate.js,relate_bg.wasm,snippets/}   the engine
// and writes workers/docs-mcp/generated/ (gitignored):
//   docs.json        pages with their section offsets, refs, errors, llms.txt, skill, releases, the prompt
//   graph.cypher     the seed script, byte for byte
//   wasm/            the engine's glue and binary, copied so the site's Vite build never sees them
//
// Fails when an input is missing, or when a twin and the docs graph disagree
// about a section's text (the twin is the source of the bytes get_page
// returns; the graph is the source of the anchors search_docs returns).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import GithubSlugger from 'github-slugger';
import { parse as parseYaml } from 'yaml';

import { frontmatterEnd, plainHeading, scanHeadings, sliceSection, TERMS_HEADING, type SectionSpan, type TwinIndex } from '../src/sections.ts';
import type { Bundle, ErrorEntry, PageEntry, Ref, ReleaseEntry } from '../src/types.ts';

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

const seed = read(join(DIST, 'docs/graph.cypher'));
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
// search_docs's description says only the generated glossary and changelog are left out of the search
// (src/server.ts): any other page outside the docs graph would make it false.
const NOT_SEARCHED = ['reference/changelog', 'reference/glossary'];
const outside = Object.values(pages).filter((p) => !p.in_graph).map((p) => p.id).sort();
if (JSON.stringify(outside) !== JSON.stringify(NOT_SEARCHED)) fail(`pages outside the docs graph (not searched) are ${outside.join(', ') || '(none)'}; search_docs's description in src/server.ts names ${NOT_SEARCHED.join(', ')}`);

/** Anything a page can name as a prerequisite or related page. */
const refs: Record<string, Ref> = {};
for (const [id, p] of graphPages) refs[id] = { id, title: String(p.title), url: p.url ? String(p.url) : null, md_url: p.md_url ? String(p.md_url) : null, status: String(p.status) };
for (const p of Object.values(pages)) refs[p.id] = { id: p.id, title: p.title, url: p.url, md_url: p.md_url, status: p.status };
for (const [id, r] of recipes) refs[`cookbook/${id}`] = { id: `cookbook/${id}`, title: String(r.title), url: String(r.url), md_url: String(r.md_url), status: 'stable' };

// ---------------------------------------------------------------------------
// Errors: every entry with its anchor and the pages that link to it

const ERROR_GROUPS = ['cli', 'engine', 'http', 'bolt', 'mcp'] as const;
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

const skillDir = join(ROOT, 'public/skills/relate');
if (!existsSync(join(skillDir, 'SKILL.md'))) fail(`${rel(skillDir)}/SKILL.md is missing`);
const skill: Record<string, string> = {};
for (const f of walk(skillDir)) skill[relative(skillDir, f).replaceAll('\\', '/')] = readFileSync(f, 'utf8');

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
// Write

const bundle: Bundle = {
  format: 1,
  kind: 'documentation',
  origin: ORIGIN,
  verified,
  engine: { version: String(engine.version), verified, date: String(engine.date), commit: engine.commit ? String(engine.commit) : null, source_build: Boolean(engine.source_build) },
  graph: { nodes: graph.nodes.length, relationships: graph.relationships.length, seed_bytes: Buffer.byteLength(seed) },
  pages,
  refs,
  errors,
  notifications,
  llms,
  skill,
  releases,
  onboard: { text: onboard, source: quick.url },
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'wasm'), { recursive: true });
writeFileSync(join(OUT, 'docs.json'), JSON.stringify(bundle));
writeFileSync(join(OUT, 'graph.cypher'), seed);
const wasmDir = join(ROOT, 'public/wasm');
for (const f of ['relate.js', 'relate.d.ts', 'relate_bg.wasm', 'trap.js']) cpSync(join(wasmDir, f), join(OUT, 'wasm', f));
cpSync(join(wasmDir, 'snippets'), join(OUT, 'wasm/snippets'), { recursive: true });

const size = (p: string) => {
  const b = readFileSync(p);
  return `${(b.length / 1024).toFixed(0)} KiB (${(gzipSync(b, { level: 9 }).length / 1024).toFixed(0)} KiB gzipped)`;
};
console.log(`bundle: ${Object.keys(pages).length} pages, ${Object.values(pages).reduce((n, p) => n + p.index.sections.length, 0)} sections, ${errors.length} errors, ${notifications.length} notifications, ${Object.keys(skill).length} skill files, ${releases.releases.length} releases; verified ${verified}`);
if (anchorsGuessed.length) console.log(`  ${anchorsGuessed.length} generated-page anchors not found in the built HTML, slugged instead: ${anchorsGuessed.slice(0, 5).join(', ')}`);
if (textDiffers.length) console.log(`  ${textDiffers.length} sections whose graph text is not byte-equal to the twin (anchors still match): ${textDiffers.slice(0, 5).join(', ')}${textDiffers.length > 5 ? ', …' : ''}`);
console.log(`  generated/docs.json        ${size(join(OUT, 'docs.json'))}`);
console.log(`  generated/graph.cypher     ${size(join(OUT, 'graph.cypher'))}`);
console.log(`  generated/wasm/relate_bg.wasm  ${size(join(OUT, 'wasm/relate_bg.wasm'))}`);
console.log(`  generated/wasm/relate.js   ${size(join(OUT, 'wasm/relate.js'))}`);

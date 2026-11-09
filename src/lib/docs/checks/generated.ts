// docs:check for the generated pages and endpoints (src/lib/docs/generated/):
// the glossary, changelog and docs MCP usage pages, /docs/glossary.json, the
// changelog feed and /docs/feedback.md.
//
// From the source:
//   - no `.mdx` claims a generated page's id; each page renders, and its twin
//     carries the twin frontmatter with `verified` from _data/engine.json and
//     the canonical phrase opening its description
//   - the glossary page anchors every term of _glossary/ and its twin has a
//     heading per term
//   - _data/changelog.json is well formed, has the anchor `#since-<verified>`
//     every twin links (a warning when DOCS_CHANGELOG_PENDING names the
//     verified version: the release refresh's allowance, never set in CI),
//     lists no release newer than the engine, and each
//     item's `pages` name a page (published, planned or generated; a page not
//     written yet is a warning) with an anchor that page has
//   - feedback.md names the operator as the sender and no contact address
//     (none exists before launch; LAUNCH.md)
// From dist/ (`--built`, when the Site has built ids):
//   - each generated page has its HTML page and both twin URLs, appears in
//     /docs/llms.txt and in /sitemap.xml; the built changelog page has
//     `#since-<verified>`, the built glossary an element per term id and its
//     JSON-LD DefinedTermSet in <head>; /docs/glossary.json is built and equals
//     glossaryJsonText(); the feed, /docs/changelog.md and /docs/feedback.md
//     are built, and the feed parses with one item per release
//
// It takes the Site of scripts/docs.ts (only the fields below) and that
// script's report callback.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { ROOT, type Engine } from '../content.ts';
import { CHANGELOG_FILE, changelogData, changelogPending, sinceTargets } from '../generated/changelog.ts';
import { feedbackMarkdown, GENERATED, generatedContext, type RenderedPage } from '../generated/index.ts';
import { glossaryEntries } from '../generated/glossary.ts';
import { GLOSSARY_JSON_PATH, glossaryJsonText } from '../glossary.ts';
import { CANONICAL_PHRASE } from '../llms.ts';
import { CHANGELOG_FEED_URL, CHANGELOG_MD_URL, FEEDBACK_URL, GENERATED_IDS, pageUrl, twinUrl } from '../model.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** The fields of scripts/docs.ts's Site this check reads. */
export interface GeneratedCheckSite {
  engine: Engine;
  published: Map<string, unknown>;
  planned: Set<string>;
  /** Docs page id → the anchors its source gives it. */
  anchors: Map<string, Set<string>>;
  /** Built HTML ids per site path, with --built; null from the source alone. */
  builtIds: Map<string, Set<string>> | null;
}

const TWIN_KEYS = ['title', 'description', 'type', 'surfaces', 'status', 'verified', 'canonical_url', 'prerequisites', 'related', 'last_updated'];
const GENERATED_DIR = join(ROOT, 'src/lib/docs/generated');
const sourceOf = (id: string) => join(GENERATED_DIR, `${id.split('/').at(-1)}.ts`);
const rel = (file: string) => relative(ROOT, file).split(sep).join('/');

function twinFrontmatter(markdown: string, where: string, canonical: string, site: GeneratedCheckSite, report: Report, keys = TWIN_KEYS) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!m) {
    report(where, null, 'error', 'generated', 'the twin does not open with a YAML frontmatter block');
    return;
  }
  const front = parseYaml(m[1]) as Record<string, unknown>;
  const missing = keys.filter((k) => !(k in front));
  if (missing.length) report(where, null, 'error', 'generated', `the twin's frontmatter lacks ${missing.join(', ')}`);
  if (front.verified !== site.engine.verified) report(where, null, 'error', 'generated', `the twin's verified is ${String(front.verified)}, not ${site.engine.verified} (_data/engine.json)`);
  if (!String(front.description ?? '').startsWith(`${CANONICAL_PHRASE}: `)) report(where, null, 'error', 'generated', `the twin's description does not open with "${CANONICAL_PHRASE}"`);
  if (front.canonical_url !== canonical) report(where, null, 'error', 'generated', `canonical_url is ${String(front.canonical_url)}, not ${canonical}`);
}

/** Whether `ref` (`reference/errors#engine-unknown-function`) names a page and an anchor it has. */
function checkRef(ref: string, site: GeneratedCheckSite, rendered: Map<string, RenderedPage>, where: string, report: Report) {
  const [id, hash] = ref.split('#');
  if (GENERATED_IDS.has(id)) {
    if (hash && !rendered.get(id)?.anchors.has(hash)) report(where, null, 'error', 'generated', `"${ref}": the generated page has no anchor #${hash}`);
    return;
  }
  if (site.planned.has(id)) return;
  if (!site.published.has(id)) {
    report(where, null, 'warning', 'link-pending', `/docs/${id} names no page yet; the changelog leaves the link out until src/content/docs/${id}.mdx exists`);
    return;
  }
  const anchors = site.anchors.get(id);
  if (hash && anchors && !anchors.has(hash)) report(where, null, 'error', 'generated', `"${ref}": /docs/${id} has no heading or anchor #${hash}`);
}

export function checkGenerated(site: GeneratedCheckSite, report: Report, dist = join(ROOT, 'dist')): void {
  const ctx = generatedContext();
  const rendered = new Map<string, RenderedPage>();
  for (const g of GENERATED) {
    const where = sourceOf(g.meta.id);
    if (site.published.has(g.meta.id) || site.planned.has(g.meta.id)) {
      report(where, null, 'error', 'generated', `src/content/docs/${g.meta.id}.mdx claims the id of a generated page; remove it`);
    }
    try {
      const r = g.render(ctx);
      rendered.set(g.meta.id, r);
      twinFrontmatter(r.markdown, where, `${CANONICAL_ORIGIN}${pageUrl(g.meta.id)}`, site, report);
    } catch (e) {
      report(where, null, 'error', 'generated', `${g.meta.id} does not render: ${(e as Error).message.replace(/\n\s*/g, ' ')}`);
    }
  }

  // The glossary: every term at its anchor, with a heading in the twin.
  const glossary = rendered.get('reference/glossary');
  if (glossary) {
    for (const e of glossaryEntries()) {
      if (!glossary.anchors.has(e.id)) report(sourceOf('reference/glossary'), null, 'error', 'generated', `the glossary page has no anchor for the term ${e.id}`);
      if (!glossary.markdown.includes(`\n### ${e.term}\n`)) report(sourceOf('reference/glossary'), null, 'error', 'generated', `the glossary twin has no heading for the term ${e.id}`);
    }
  }

  // The changelog: the anchor every twin links, versions no newer than the engine, page references.
  try {
    const c = changelogData();
    if (!sinceTargets(c).has(site.engine.verified)) {
      if (changelogPending(site.engine.verified)) {
        report(CHANGELOG_FILE, null, 'warning', 'generated', `the ${site.engine.verified} entry is still to be written (DOCS_CHANGELOG_PENDING): every twin links #since-${site.engine.verified}, so write it before merging`);
      } else {
        report(CHANGELOG_FILE, null, 'error', 'generated', `no entry is, or follows, ${site.engine.verified}: every twin links #since-${site.engine.verified}`);
      }
    }
    const newer = c.releases.filter((r) => r.version.localeCompare(site.engine.version, undefined, { numeric: true }) > 0);
    for (const r of newer) report(CHANGELOG_FILE, null, 'warning', 'generated', `${r.version} is newer than the engine the docs track (${site.engine.version}, _data/engine.json)`);
    for (const r of c.releases) {
      for (const items of [r.added, r.changed, r.deprecated, r.removed, r.fixed]) {
        for (const item of items ?? []) for (const ref of item.pages ?? []) checkRef(ref, site, rendered, CHANGELOG_FILE, report);
      }
    }
  } catch (e) {
    report(CHANGELOG_FILE, null, 'error', 'generated', (e as Error).message.replace(/\n\s*/g, ' '));
  }

  // feedback.md: the operator sends a report; no address is invented before launch.
  const feedbackFile = join(GENERATED_DIR, 'feedback.ts');
  try {
    const md = feedbackMarkdown(ctx);
    twinFrontmatter(md, feedbackFile, `${CANONICAL_ORIGIN}${FEEDBACK_URL}`, site, report, TWIN_KEYS.filter((k) => k !== 'type'));
    if (!/\boperator\b/.test(md)) report(feedbackFile, null, 'error', 'generated', 'feedback.md does not say that the operator decides whether a report is sent (ADR-0013)');
    const addresses = [...md.matchAll(/mailto:[^\s)]+|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/[^\s)`]+/g)].map((m) => m[0]).filter((a) => !a.startsWith(`${CANONICAL_ORIGIN}/docs/`));
    for (const a of addresses) report(feedbackFile, null, 'error', 'generated', `feedback.md names ${a}; it names no address until one is published (LAUNCH.md)`);
  } catch (e) {
    report(feedbackFile, null, 'error', 'generated', `feedback.md does not render: ${(e as Error).message}`);
  }

  if (site.builtIds === null) return;

  // ---------- dist/ ----------
  const file = (p: string) => join(dist, p);
  const llms = existsSync(file('docs/llms.txt')) ? readFileSync(file('docs/llms.txt'), 'utf8') : null;
  const sitemap = existsSync(file('sitemap.xml')) ? readFileSync(file('sitemap.xml'), 'utf8') : null;
  if (llms === null) report(file('docs/llms.txt'), null, 'error', 'generated', 'dist/docs/llms.txt is missing');
  if (sitemap === null) report(file('sitemap.xml'), null, 'error', 'generated', 'dist/sitemap.xml is missing');
  for (const g of GENERATED) {
    const id = g.meta.id;
    const html = file(`${pageUrl(id)}index.html`);
    for (const p of [html, file(twinUrl(id)), file(`/docs/${id}/index.md`)]) {
      if (!existsSync(p)) report(p, null, 'error', 'generated', `${id}: ${rel(p)} is not built`);
    }
    if (existsSync(file(twinUrl(id)))) twinFrontmatter(readFileSync(file(twinUrl(id)), 'utf8'), file(twinUrl(id)), `${CANONICAL_ORIGIN}${pageUrl(id)}`, site, report);
    if (llms !== null && !llms.includes(`](${CANONICAL_ORIGIN}${twinUrl(id)})`)) report(file('docs/llms.txt'), null, 'error', 'generated', `${id} is not listed in /docs/llms.txt`);
    if (sitemap !== null && !sitemap.includes(`<loc>${CANONICAL_ORIGIN}${pageUrl(id)}</loc>`)) report(file('sitemap.xml'), null, 'error', 'generated', `${id} is not in /sitemap.xml`);
    const ids = existsSync(html) ? new Set([...readFileSync(html, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) : new Set<string>();
    if (id === 'reference/changelog' && existsSync(html) && !ids.has(`since-${site.engine.verified}`)) {
      report(html, null, 'error', 'generated', `the built changelog has no #since-${site.engine.verified}, which every twin links`);
    }
    if (id === 'reference/glossary' && existsSync(html)) {
      for (const e of glossaryEntries()) if (!ids.has(e.id)) report(html, null, 'error', 'generated', `the built glossary has no #${e.id}`);
      const head = /<head[^>]*>([\s\S]*?)<\/head>/.exec(readFileSync(html, 'utf8'))?.[1] ?? '';
      if (!head.includes('application/ld+json')) report(html, null, 'error', 'generated', 'the built glossary has no JSON-LD DefinedTermSet (application/ld+json) in its <head>');
    }
  }
  const glossaryJson = file(GLOSSARY_JSON_PATH);
  if (!existsSync(glossaryJson)) report(glossaryJson, null, 'error', 'generated', `${GLOSSARY_JSON_PATH} is not built`);
  else if (readFileSync(glossaryJson, 'utf8') !== glossaryJsonText(site.engine.verified)) report(glossaryJson, null, 'error', 'generated', 'dist/docs/glossary.json differs from the glossary');
  for (const p of [CHANGELOG_MD_URL, FEEDBACK_URL]) if (!existsSync(file(p))) report(file(p), null, 'error', 'generated', `${p} is not built`);
  const feed = file(CHANGELOG_FEED_URL);
  if (!existsSync(feed)) {
    report(feed, null, 'error', 'generated', `${CHANGELOG_FEED_URL} is not built`);
    return;
  }
  try {
    const data = JSON.parse(readFileSync(feed, 'utf8')) as { version?: string; items?: unknown[] };
    if (data.version !== 'https://jsonfeed.org/version/1.1') report(feed, null, 'error', 'generated', 'the feed is not a JSON Feed 1.1 document');
    const releases = changelogData().releases.length;
    if (data.items?.length !== releases) report(feed, null, 'error', 'generated', `the feed has ${data.items?.length ?? 0} item(s); the changelog has ${releases} release(s)`);
  } catch (e) {
    report(feed, null, 'error', 'generated', `the feed does not parse: ${(e as Error).message}`);
  }
}

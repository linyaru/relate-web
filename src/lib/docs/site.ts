// The docs section as the website builds it: the published pages of the
// `docs` collection, checked against their paths, with the sidebar, the
// engine version and each page's markdown twin. Computed once per build and
// shared by every docs page and endpoint; any problem fails the build.

import { join } from 'node:path';

import { getCollection, type CollectionEntry } from 'astro:content';

import { COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { engine as readEngine, glossary as readGlossary, lastUpdated, ROOT, type Engine, type GlossaryTerm } from './content.ts';
import type { IndexedPage } from './llms.ts';
import type { LinkContext } from './links.ts';
import { pageUrl, sectionOf, twinUrl, typeOf, type SectionId } from './model.ts';
import { buildNav, humanize, readingOrder, type NavGroup } from './nav.ts';
import { renderTwin, type Twin } from './twin.ts';

export type DocsEntry = CollectionEntry<'docs'>;

export interface DocsPage {
  id: string;
  entry: DocsEntry;
  /** The page's file (absolute). */
  file: string;
  section: SectionId | null;
  url: string;
  twinUrl: string;
  lastUpdated: string;
}

export interface DocsSite {
  pages: DocsPage[];
  byId: Map<string, DocsPage>;
  nav: NavGroup[];
  engine: Engine;
  glossary: Map<string, GlossaryTerm>;
  links: LinkContext;
  twin: (page: DocsPage) => Twin;
  /** Pages in reading order, with their twins, for the indexes. */
  indexed: () => IndexedPage[];
  /** The llms-full.txt files per section and group: [path, label, page ids]. */
  fullFiles: () => { path: string; label: string; ids: string[] }[];
}

let cached: Promise<DocsSite> | null = null;

/** The docs, built once per build (rebuilt on every call in dev, so edits show). */
export function docsSite(): Promise<DocsSite> {
  if (!import.meta.env.PROD) return build();
  cached ??= build();
  return cached;
}

async function build(): Promise<DocsSite> {
  const entries = await getCollection('docs', (e) => e.data.status !== 'planned');
  const problems: string[] = [];
  const pages: DocsPage[] = [];
  for (const entry of entries) {
    const { id, data } = entry;
    const where = entry.filePath ?? id;
    const section = sectionOf(id);
    if (id === '') problems.push(`${where}: the docs landing is src/pages/docs/index.astro; there is no index.mdx at the root`);
    if (!section && !id.startsWith('_example/')) {
      problems.push(`${where}: a docs page lives under one of get-started/, guides/, reference/, concepts/`);
    }
    if (data.section && data.section !== section) problems.push(`${where}: \`section: ${data.section}\` disagrees with its path (${section})`);
    if (data.type && data.type !== typeOf(id)) problems.push(`${where}: \`type: ${data.type}\` disagrees with its section (${typeOf(id)})`);
    const file = join(ROOT, entry.filePath!);
    pages.push({ id, entry, file, section, url: pageUrl(id), twinUrl: twinUrl(id), lastUpdated: lastUpdated(file) });
  }
  if (problems.length) throw new Error(`the docs have ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);

  const nav = buildNav(pages.map((p) => ({ id: p.id, title: p.entry.data.title, label: p.entry.data.label ?? p.entry.data.title, order: p.entry.data.order })));
  const order = new Map(readingOrder(nav).map((p, i) => [p.id, i]));
  pages.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || (a.id < b.id ? -1 : 1));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const engine = readEngine();
  const glossary = readGlossary();
  const links: LinkContext = { pages: new Set(byId.keys()) };

  const twins = new Map<string, Twin>();
  const twin = (page: DocsPage) => {
    let t = twins.get(page.id);
    if (!t) {
      t = renderTwin(
        { id: page.id, file: page.file, body: page.entry.body ?? '', data: { ...page.entry.data, description: page.entry.data.description ?? '' }, lastUpdated: page.lastUpdated },
        { links, glossary, components: COMPONENT_TWINS, engine },
      );
      twins.set(page.id, t);
    }
    return t;
  };
  const listed = () => pages.filter((p) => p.section !== null);
  const indexed = () =>
    listed().map((p) => ({ id: p.id, title: p.entry.data.title, description: p.entry.data.description ?? '', markdown: twin(p).markdown }));
  const fullFiles = () => {
    const out: { path: string; label: string; ids: string[] }[] = [];
    for (const section of nav) {
      const ids = listed().filter((p) => p.section === section.id).map((p) => p.id);
      out.push({ path: `/docs/${section.id}/llms-full.txt`, label: section.label, ids });
      for (const g of section.groups) {
        out.push({
          path: `/docs/${g.id}/llms-full.txt`,
          label: `${section.label}: ${g.label ?? humanize(g.id)}`,
          ids: ids.filter((id) => id === g.id || id.startsWith(`${g.id}/`)),
        });
      }
    }
    return out;
  };
  return { pages, byId, nav, engine, glossary, links, twin, indexed, fullFiles };
}

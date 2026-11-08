// The docs section as the website builds it: the published pages of the
// `docs` collection, checked against their paths, the pages generated from
// data (the glossary, the changelog: src/lib/docs/generated/), the sidebar,
// the engine version and each page's markdown twin. Computed once per build
// and shared by every docs page and endpoint; any problem fails the build.

import { join } from 'node:path';

import { getCollection, type CollectionEntry } from 'astro:content';

import { COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { engine as readEngine, glossary as readGlossary, lastUpdated, ROOT, type Engine, type GlossaryTerm } from './content.ts';
import type { IndexedPage } from './llms.ts';
import type { LinkContext } from './links.ts';
import { pageUrl, sectionOf, twinUrl, typeOf, type SectionId } from './model.ts';
import { GENERATED, generatedContext, generatedUpdated, type GeneratedPage, type RenderedPage } from './generated/index.ts';
import type { GeneratedPageMeta } from './model.ts';
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

/** A page generated from data (model.ts GENERATED_PAGES): no collection entry, its own route under src/pages/docs/. */
export interface GeneratedDocsPage {
  id: string;
  meta: GeneratedPageMeta;
  section: SectionId | null;
  url: string;
  twinUrl: string;
  lastUpdated: string;
  /** The page body, headings, twin and anchors, rendered once per build. */
  rendered: () => RenderedPage;
}

export interface DocsSite {
  /** The pages of the `docs` collection (src/pages/docs/[...slug].astro renders them). */
  pages: DocsPage[];
  /** The generated pages, published like authored ones: in the sidebar, the indexes, the sitemap and link resolution. */
  generated: GeneratedDocsPage[];
  byId: Map<string, DocsPage>;
  nav: NavGroup[];
  engine: Engine;
  glossary: Map<string, GlossaryTerm>;
  links: LinkContext;
  twin: (page: DocsPage) => Twin;
  /** Pages in reading order, with their twins, for the indexes. */
  indexed: () => IndexedPage[];
  /** The ids of `indexed`, in the same reading order, without building the twins. */
  order: () => string[];
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

  for (const g of GENERATED) {
    if (pages.some((p) => p.id === g.meta.id)) problems.push(`${g.meta.id}: the page is generated (src/lib/docs/generated/); remove its .mdx`);
  }
  if (problems.length) throw new Error(`the docs have ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);

  const genCtx = generatedContext();
  const generated: GeneratedDocsPage[] = GENERATED.map((g: GeneratedPage) => {
    let memo: RenderedPage | null = null;
    return {
      id: g.meta.id,
      meta: g.meta,
      section: sectionOf(g.meta.id),
      url: pageUrl(g.meta.id),
      twinUrl: twinUrl(g.meta.id),
      lastUpdated: generatedUpdated(g),
      rendered: () => (memo ??= g.render(genCtx)),
    };
  });

  const nav = buildNav([
    ...pages.map((p) => ({ id: p.id, title: p.entry.data.title, label: p.entry.data.label ?? p.entry.data.title, order: p.entry.data.order })),
    ...generated.map((g) => ({ id: g.id, title: g.meta.title, label: g.meta.title, order: g.meta.order })),
  ]);
  const order = new Map(readingOrder(nav).map((p, i) => [p.id, i]));
  const byOrder = (a: { id: string }, b: { id: string }) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || (a.id < b.id ? -1 : 1);
  pages.sort(byOrder);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const engine = readEngine();
  const glossary = readGlossary();
  const links: LinkContext = { pages: new Set([...byId.keys(), ...generated.map((g) => g.id)]) };

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
  // Authored and generated pages together, in reading order, for the indexes.
  const listed = (): { id: string; section: SectionId | null; indexed: () => IndexedPage }[] =>
    [
      ...pages.map((p) => ({
        id: p.id,
        section: p.section,
        indexed: () => ({ id: p.id, title: p.entry.data.title, description: p.entry.data.description ?? '', markdown: twin(p).markdown }),
      })),
      ...generated.map((g) => ({
        id: g.id,
        section: g.section,
        indexed: () => ({ id: g.id, title: g.meta.title, description: g.meta.description, markdown: g.rendered().markdown }),
      })),
    ]
      .filter((p) => p.section !== null)
      .sort(byOrder);
  const indexed = () => listed().map((p) => p.indexed());
  const pageOrder = () => listed().map((p) => p.id);
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
  return { pages, generated, byId, nav, engine, glossary, links, twin, indexed, order: pageOrder, fullFiles };
}

// What every generated docs page shares (model.ts GENERATED_PAGES): the
// context it renders from, read from disk so the build, the twin endpoints and
// Node checks render the same page; its rendered form (HTML for the page, the
// headings for "On this page", the markdown twin); and the twin's opening
// (frontmatter, title, description, version line) in the shape twin.ts gives
// an authored page.

import { stringify as toYaml } from 'yaml';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { esc } from '../../cookbook/result-view.ts';
import { engine as readEngine, lastUpdated, pageFiles, type Engine } from '../content.ts';
import { CANONICAL_PHRASE } from '../llms.ts';
import { GENERATED_PAGES, pageUrl, typeOf, type GeneratedPageMeta } from '../model.ts';
import { versionLine } from '../twin.ts';

export interface GeneratedContext {
  engine: Engine;
  /** The published page ids, generated pages included: links to any other docs page render as text. */
  pages: Set<string>;
  /** Published page id → its title, for link labels. */
  titles: Map<string, string>;
  /** Published page id → its frontmatter `since`, for the changelog's back-links. */
  since: Map<string, string>;
}

/** The context from the page files on disk (src/lib/docs/content.ts) and _data/engine.json. */
export function generatedContext(): GeneratedContext {
  const files = pageFiles().filter((p) => p.data.status !== 'planned' && !p.id.startsWith('_example/'));
  const titles = new Map<string, string>([
    ...files.map((p) => [p.id, String(p.data.title ?? p.id)] as [string, string]),
    ...GENERATED_PAGES.map((g) => [g.id, g.title] as [string, string]),
  ]);
  const since = new Map(files.filter((p) => p.data.since !== undefined).map((p) => [p.id, String(p.data.since)] as [string, string]));
  return { engine: readEngine(), pages: new Set(titles.keys()), titles, since };
}

export interface Heading {
  depth: number;
  slug: string;
  text: string;
}

export interface RenderedPage {
  /** The page body, without the title and description (the route renders those). */
  html: string;
  /** The headings "On this page" lists. */
  headings: Heading[];
  /** The markdown twin, frontmatter included. */
  markdown: string;
  /** Every id the HTML body gives an element, for link checks. */
  anchors: Set<string>;
}

export interface GeneratedPage {
  meta: GeneratedPageMeta;
  /** The files the page is generated from: its `last_updated` is the newest one's. */
  sources: () => string[];
  render: (ctx: GeneratedContext) => RenderedPage;
}

/** `YYYY-MM-DD`: when the newest of `files` last changed. */
export const newest = (files: string[]) => files.map(lastUpdated).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

/** The twin's opening: the frontmatter an authored page's twin carries, the title, the description and the version line. */
export function twinHead(meta: GeneratedPageMeta, ctx: GeneratedContext, updated: string): string {
  const front: Record<string, unknown> = {
    title: meta.title,
    description: `${CANONICAL_PHRASE}: ${meta.description}`,
    ...(typeOf(meta.id) ? { type: typeOf(meta.id) } : {}),
    surfaces: meta.surfaces,
    status: 'stable',
    verified: ctx.engine.verified,
    canonical_url: `${CANONICAL_ORIGIN}${pageUrl(meta.id)}`,
    prerequisites: [],
    related: [],
    last_updated: updated,
  };
  return [`---\n${toYaml(front, { lineWidth: 0 }).trimEnd()}\n---`, `# ${meta.title}`, meta.description, versionLine(ctx.engine.verified)].join('\n\n');
}

/** A heading for the page body, with its id. */
export const headingHtml = (h: Heading) => `<h${h.depth} id="${esc(h.slug)}">${esc(h.text)}</h${h.depth}>`;

/**
 * A page reference (`reference/cli/flags#read-only`) as a markdown link labelled
 * with the page's title, or null when the page is not published (the caller
 * leaves it out rather than print a dead reference).
 */
export function pageLink(ref: string, ctx: GeneratedContext): string | null {
  const [id, hash] = ref.split('#');
  const title = ctx.titles.get(id);
  if (!title || !ctx.pages.has(id)) return null;
  return `[${title}](/docs/${id}${hash ? `#${hash}` : ''})`;
}

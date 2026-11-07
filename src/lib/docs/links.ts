// Links on docs pages. Authors write site-relative links (`/docs/guides/x`,
// `/docs/reference/glossary#wal`, `/cookbook/<slug>/`) or external ones. A
// link renders as a link only when its target exists: a docs page that is
// planned or not written yet, or a URL that is not public yet (NOT_PUBLIC_YET),
// keeps its text only, so a page never links to a 404.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_ORIGIN, isNotYetPublic } from '../cookbook/links.ts';
import { ROOT } from './content.ts';
import { pageUrl } from './model.ts';

export { CANONICAL_ORIGIN };

/** The docs page id a site-relative href names (`/docs/a/b/`, `/docs/a/b#x`, `/docs/a/b.md` → `a/b`; `/docs/index.md` → ''), or null. */
export function docsIdOf(href: string): string | null {
  const m = /^\/docs(?:\/([^?#]*))?(?:[?#].*)?$/.exec(href);
  if (!m) return null;
  return (m[1] ?? '').replace(/(?:^|\/)(?:index\.md|index\.html)?$/, '').replace(/\.md$/, '');
}

/** The URL schemes a docs link may use; any other (`javascript:`, `data:`, …) renders as text. */
export const LINK_SCHEMES = ['http:', 'https:', 'mailto:'];
const schemeOf = (href: string) => /^([a-z][a-z0-9+.-]*:)/i.exec(href)?.[1].toLowerCase() ?? null;
/** Whether `href` names an allowed scheme (true for a link with no scheme). */
export const allowedScheme = (href: string) => {
  const s = schemeOf(href);
  return s === null || LINK_SCHEMES.includes(s);
};

const COOKBOOK_DIR = join(ROOT, 'src/content/cookbook');

/** What a page needs to know to resolve links: the published docs page ids. */
export interface LinkContext {
  pages: Set<string>;
}

/**
 * The href a link renders with on the site, or null when it should render as
 * text: an unknown or planned docs page, a cookbook recipe that does not
 * exist, or a URL that is not public yet. Docs links get a trailing slash.
 */
export function resolveHref(href: string, ctx: LinkContext): string | null {
  if (!href || href.startsWith('#')) return href;
  if (href.startsWith('//')) return null;
  if (schemeOf(href)) return allowedScheme(href) && !isNotYetPublic(href) ? href : null;
  if (!href.startsWith('/')) return href; // relative: left to the author (and docs:check)
  const id = docsIdOf(href);
  if (id !== null) {
    if (/\.(txt|json|svg|png)$/.test(id)) return href;
    if (id !== '' && !ctx.pages.has(id)) return null;
    // A link to a markdown twin stays a link to the twin (an agent asked for markdown).
    if (/\.md$/.test(href.split(/[?#]/)[0])) return href;
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : '';
    return `${pageUrl(id)}${hash}`;
  }
  const recipe = /^\/cookbook\/([^/#?]+)\/?(?:[#?].*)?$/.exec(href);
  if (recipe && !existsSync(join(COOKBOOK_DIR, `${recipe[1]}.md`))) return null;
  return href;
}

/** `href` as an absolute URL on the canonical origin, for the markdown twin. */
export const absoluteUrl = (href: string) => (href.startsWith('/') ? `${CANONICAL_ORIGIN}${href}` : href);

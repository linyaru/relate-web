// Links on the cookbook pages: how a link a recipe writes (for GitHub, relative
// to the recipe file) becomes the site's, and which URLs are not public yet.
//
// A URL that is not public yet renders as its text only. The list is empty
// since the repositories and relatedb.ai went public with relate 1.0.0; a URL
// that 404s until a release ships goes here.

import { posix } from 'node:path';

/**
 * The site's public origin, for canonical links, `og:url`, and llms.txt. Like
 * the home page's, these name relatedb.ai even on the preview host (LAUNCH.md).
 */
export const CANONICAL_ORIGIN = 'https://relatedb.ai';

/** URLs that 404 until a release ships them. */
export const NOT_PUBLIC_YET: RegExp[] = [];

export const isNotYetPublic = (url: string) => NOT_PUBLIC_YET.some((re) => re.test(url));

/**
 * The site's href for a link in a recipe, relative to the recipe page
 * (`/cookbook/<slug>/`), or null when its target is not on the site or not
 * public: the page keeps the text only. `slugs` are the recipes on the site.
 */
export function rewriteHref(href: string, slugs: Set<string>): string | null {
  if (!href || href.startsWith('#')) return href;
  if (href.startsWith('//')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return isNotYetPublic(href) ? null : href;
  const [path, hash = ''] = href.split('#');
  const suffix = hash ? `#${hash}` : '';
  const resolved = posix.normalize(posix.join('cookbook', path));
  if (resolved === 'cookbook' || resolved === 'cookbook/README.md') return `../${suffix}`;
  const m = /^cookbook\/([^/]+)\.md$/.exec(resolved);
  if (m && slugs.has(m[1])) return `../${m[1]}/${suffix}`;
  // Any other file of this repository is not part of the site.
  return null;
}

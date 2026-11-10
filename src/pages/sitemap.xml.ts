// /sitemap.xml: the home page, the cookbook and every recipe, the docs
// landing and every docs page, generated so new pages are listed without a
// hand edit, each with its last change (`lastmod`, from git: src/lib/docs/content.ts).
// URLs name relatedb.ai, as the home page's canonical link does (LAUNCH.md). The
// blog placeholder is left out until it has content.
import { join } from 'node:path';

import type { APIRoute } from 'astro';

import { CANONICAL_ORIGIN } from '../lib/cookbook/links.ts';
import { COOKBOOK_DIR } from '../lib/cookbook/load.ts';
import { cookbook } from '../lib/cookbook/site.ts';
import { lastUpdated } from '../lib/docs/content.ts';
import { docsSite } from '../lib/docs/site.ts';

export const GET: APIRoute = async () => {
  const { pages } = await cookbook();
  const docs = await docsSite();
  // The home page, the cookbook index and the docs landing change with the release.
  const release = docs.engine.date;
  const entries: { path: string; modified: string }[] = [
    { path: '/', modified: release },
    { path: '/cookbook/', modified: release },
    ...pages.map((p) => ({ path: `/cookbook/${p.recipe.slug}/`, modified: lastUpdated(join(COOKBOOK_DIR, `${p.recipe.slug}.md`)) })),
    { path: '/docs/', modified: release },
    ...docs.pages.filter((p) => p.section !== null).map((p) => ({ path: p.url, modified: p.lastUpdated })),
    ...docs.generated.map((g) => ({ path: g.url, modified: g.lastUpdated })),
    { path: '/playground/', modified: release },
  ];
  const urls = entries
    .map((e) => `  <url><loc>${CANONICAL_ORIGIN}${e.path}</loc><lastmod>${e.modified}</lastmod></url>`)
    .join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};

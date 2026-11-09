// /sitemap.xml: the home page, the cookbook and every recipe, the docs
// landing and every docs page, generated so new pages are listed without a
// hand edit. URLs name relatedb.ai, as the home page's canonical link does
// (LAUNCH.md). The blog placeholder is left out until it has content.
import type { APIRoute } from 'astro';

import { CANONICAL_ORIGIN } from '../lib/cookbook/links.ts';
import { cookbook } from '../lib/cookbook/site.ts';
import { docsSite } from '../lib/docs/site.ts';

export const GET: APIRoute = async () => {
  const { pages } = await cookbook();
  const docs = await docsSite();
  const paths = [
    '/',
    '/cookbook/',
    ...pages.map((p) => `/cookbook/${p.recipe.slug}/`),
    '/docs/',
    ...docs.pages.filter((p) => p.section !== null).map((p) => p.url),
    ...docs.generated.map((g) => g.url),
  ];
  const urls = paths.map((p) => `  <url><loc>${CANONICAL_ORIGIN}${p}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};

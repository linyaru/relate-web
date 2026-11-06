// /sitemap.xml: the home page, the cookbook index, and every recipe page,
// generated so new recipes are listed without a hand edit. URLs name
// relatedb.ai, as the home page's canonical link does (LAUNCH.md). The
// placeholder sections (/docs, /blog) are left out until they have content.
import type { APIRoute } from 'astro';

import { CANONICAL_ORIGIN } from '../lib/cookbook/links.ts';
import { cookbook } from '../lib/cookbook/site.ts';

export const GET: APIRoute = async () => {
  const { pages } = await cookbook();
  const paths = ['/', '/cookbook/', ...pages.map((p) => `/cookbook/${p.recipe.slug}/`)];
  const urls = paths.map((p) => `  <url><loc>${CANONICAL_ORIGIN}${p}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
};

// /docs/changelog.md: the changelog's twin at the short URL DOCS-PLAN.md §5
// lists, the same bytes as /docs/reference/changelog.md.
import type { APIRoute } from 'astro';

import { docsSite } from '../../lib/docs/site.ts';

export const GET: APIRoute = async () => {
  const site = await docsSite();
  return new Response(site.generated.find((g) => g.id === 'reference/changelog')!.rendered().markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};

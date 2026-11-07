// /docs/<id>.md and /docs/<id>/index.md: a page's markdown twin
// (DOCS-PLAN.md §3.1, src/lib/docs/twin.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { docsSite } from '../../lib/docs/site.ts';

export const getStaticPaths = (async () => {
  const site = await docsSite();
  return site.pages.flatMap((page) => [
    { params: { slug: page.id }, props: { id: page.id } },
    { params: { slug: `${page.id}/index` }, props: { id: page.id } },
  ]);
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ id: string }> = async ({ props }) => {
  const site = await docsSite();
  return new Response(site.twin(site.byId.get(props.id)!).markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};

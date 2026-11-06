// /cookbook/<slug>/index.md: the recipe file itself, for agents and llms.txt.
import type { APIRoute, GetStaticPaths } from 'astro';

import { cookbook, type Page } from '../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  return pages.map((page) => ({ params: { slug: page.recipe.slug }, props: { page } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: Page }> = ({ props }) =>
  new Response(props.page.recipe.source, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

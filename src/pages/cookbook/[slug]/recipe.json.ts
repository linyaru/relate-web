// /cookbook/<slug>/recipe.json: the recipe's steps for the playground's
// hand-off (`/playground/#recipe=<slug>[&cell=<id>]`, ADR-0134), format 1.
import type { APIRoute, GetStaticPaths } from 'astro';

import { recipeJson } from '../../../lib/cookbook/render.ts';
import { cookbook, type Page } from '../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  return pages.map((page) => ({ params: { slug: page.recipe.slug }, props: { page } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: Page }> = ({ props }) =>
  new Response(recipeJson(props.page.recipe), { headers: { 'Content-Type': 'application/json' } });

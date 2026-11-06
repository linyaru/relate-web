// /cookbook/<slug>/results.json: each step's recorded `{envelope, graph}` from
// the build's replay, which the page fetches when a graph or JSON view first
// needs one.
import type { APIRoute, GetStaticPaths } from 'astro';

import { cookbook, type Page } from '../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  return pages.map((page) => ({ params: { slug: page.recipe.slug }, props: { page } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: Page }> = ({ props }) => {
  const { recipe, cells } = props.page;
  const results = Object.fromEntries(
    recipe.cells.map((c) => {
      const { envelope, recording } = cells.get(c.id)!;
      return [c.id, { envelope, graph: recording.graph }];
    }),
  );
  return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
};

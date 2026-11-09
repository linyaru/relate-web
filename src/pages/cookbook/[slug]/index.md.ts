// /cookbook/<slug>/index.md: the recipe file, for agents and llms.txt, with
// each interactive element's directive replaced by its static form (the
// children, the generated text, the "Live:" line, a link to the light
// picture), as a docs page's twin gives an element (ADR-0045).
import type { APIRoute, GetStaticPaths } from 'astro';

import { recipeTwin } from '../../../lib/cookbook/elements.ts';
import { CANONICAL_ORIGIN } from '../../../lib/cookbook/links.ts';
import { cookbook, type Page } from '../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  return pages.map((page) => ({ params: { slug: page.recipe.slug }, props: { page } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ page: Page }> = ({ props }) =>
  new Response(recipeTwin(props.page.recipe, props.page.elements, CANONICAL_ORIGIN), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

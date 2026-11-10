// /cookbook/<slug>/element-<id>-<theme>.svg: an interactive element's
// picture on a recipe page (ADR-0046), recorded by `npm run cookbook:record`
// into the cookbook's diagrams/ directory and checked (fresh, inert) as the
// page inlines it. The recipe's markdown twin links the light one.
import type { APIRoute, GetStaticPaths } from 'astro';

import { THEMES } from '../../../lib/cookbook/diagrams.ts';
import { cookbook } from '../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  const out: { params: { slug: string; element: string }; props: { svg: string } }[] = [];
  for (const page of pages) {
    for (const { use, form } of page.elements.values()) {
      if (!form.svg) continue;
      for (const theme of THEMES) out.push({ params: { slug: page.recipe.slug, element: `element-${use.id}-${theme}` }, props: { svg: form.svg[theme] } });
    }
  }
  return out;
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ svg: string }> = ({ props }) =>
  new Response(`${props.svg}\n`, { headers: { 'Content-Type': 'image/svg+xml' } });

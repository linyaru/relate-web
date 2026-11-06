// /cookbook/<slug>/data/<name>.json: each `json data=<name>` block exactly as
// the recipe holds it (never re-serialized, so `1.0` stays a float). Steps
// load their parameters from here.
import type { APIRoute, GetStaticPaths } from 'astro';

import { cookbook } from '../../../../lib/cookbook/site.ts';

export const getStaticPaths = (async () => {
  const { pages } = await cookbook();
  return pages.flatMap(({ recipe }) =>
    recipe.data.map((d) => ({ params: { slug: recipe.slug, name: d.name }, props: { text: d.text } })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) =>
  new Response(`${props.text}\n`, { headers: { 'Content-Type': 'application/json' } });

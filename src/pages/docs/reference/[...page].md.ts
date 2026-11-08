// /docs/reference/<page>.md and /docs/reference/<page>/index.md: a generated
// page's markdown twin, the same bytes at both URLs (src/lib/docs/generated/;
// the twin of an authored page is ../[...slug].md.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { GENERATED_PAGES } from '../../../lib/docs/model.ts';
import { docsSite } from '../../../lib/docs/site.ts';

export const getStaticPaths = (() =>
  GENERATED_PAGES.filter((p) => p.id.startsWith('reference/')).flatMap((p) => {
    const page = p.id.slice('reference/'.length);
    return [
      { params: { page }, props: { id: p.id } },
      { params: { page: `${page}/index` }, props: { id: p.id } },
    ];
  })) satisfies GetStaticPaths;

export const GET: APIRoute<{ id: string }> = async ({ props }) => {
  const site = await docsSite();
  return new Response(site.generated.find((g) => g.id === props.id)!.rendered().markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};

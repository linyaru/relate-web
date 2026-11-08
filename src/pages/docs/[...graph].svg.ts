// /docs/<page>/result-<cell>-<theme>.svg: a runnable cell's static graph form
// (DOCS-PLAN.md §7.5), drawn by `node scripts/docs.ts --record` into the
// page's diagrams/ directory and checked (fresh, inert) as the page inlines
// it. The markdown twin links the light one (src/lib/docs/constructs.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { THEMES } from '../../lib/cookbook/diagrams.ts';
import { drawsStatic, readResultGraph, readResults } from '../../lib/docs/results.ts';
import { docsSite } from '../../lib/docs/site.ts';

export const getStaticPaths = (async () => {
  const site = await docsSite();
  const out: { params: { graph: string }; props: { svg: string } }[] = [];
  for (const page of site.pages) {
    const results = readResults(page.file);
    if (!results) continue;
    for (const [id, cell] of Object.entries(results.cells)) {
      if (!drawsStatic(cell.graph)) continue;
      const svg = readResultGraph(page.file, id, cell.graph);
      for (const theme of THEMES) out.push({ params: { graph: `${page.id}/result-${id}-${theme}` }, props: { svg: svg[theme] } });
    }
  }
  return out;
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ svg: string }> = ({ props }) =>
  new Response(`${props.svg}\n`, { headers: { 'Content-Type': 'image/svg+xml' } });

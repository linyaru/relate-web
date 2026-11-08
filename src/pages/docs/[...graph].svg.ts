// /docs/<page>/result-<cell>-<theme>.svg: a runnable cell's static graph form
// (DOCS-PLAN.md §7.5), and /docs/<page>/element-<id>-<theme>.svg: an
// interactive element's picture (src/lib/docs/elements.ts), both drawn by
// `node scripts/docs.ts --record` into the page's diagrams/ directory and
// checked (fresh, inert) as the page inlines them. The markdown twin links
// the light one (src/lib/docs/constructs.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { THEMES } from '../../lib/cookbook/diagrams.ts';
import { pageForms } from '../../lib/docs/elements.ts';
import { extrasKey } from '../../lib/docs/elements/_graph-extras-static.ts';
import { parsePage } from '../../lib/docs/parse.ts';
import { collectCells, drawsStatic, readResultGraph, readResults } from '../../lib/docs/results.ts';
import { docsSite } from '../../lib/docs/site.ts';

export const getStaticPaths = (async () => {
  const site = await docsSite();
  const out: { params: { graph: string }; props: { svg: string } }[] = [];
  for (const page of site.pages) {
    const results = readResults(page.file);
    if (!results) continue;
    // A cell's graph view words change its picture (and its stamp).
    const words = new Map(collectCells(parsePage(page.entry.body ?? '')).cells.map((c) => [c.id, c.words]));
    for (const [id, cell] of Object.entries(results.cells)) {
      if (!drawsStatic(cell.graph)) continue;
      const svg = readResultGraph(page.file, id, cell.graph, extrasKey(words.get(id), cell.envelope));
      for (const theme of THEMES) out.push({ params: { graph: `${page.id}/result-${id}-${theme}` }, props: { svg: svg[theme] } });
    }
  }
  for (const page of site.pages) {
    for (const { use, form } of pageForms(page.file, page.entry.body ?? '')) {
      if (!form.svg) continue;
      for (const theme of THEMES) out.push({ params: { graph: `${page.id}/element-${use.id}-${theme}` }, props: { svg: form.svg[theme] } });
    }
  }
  return out;
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ svg: string }> = ({ props }) =>
  new Response(`${props.svg}\n`, { headers: { 'Content-Type': 'image/svg+xml' } });

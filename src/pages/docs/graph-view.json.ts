// /docs/graph-view.json: what the live docs graph on reference/docs-graph
// draws (`:::docs-graph`, src/lib/docs/elements/_docs-graph-view.ts): the
// pages, terms, capabilities, problems, recipes, commands, flags and
// surfaces of the docs graph, with titles, links and the layout computed
// here, and the relationships between them. /docs/graph.json carries every
// section's text and every example's code (several megabytes); this is the
// part a picture of the pages needs, fetched only when the view comes near.
import type { APIRoute } from 'astro';

import { docsGraphView, viewJson } from '../../lib/docs/elements/_docs-graph-view.ts';
import { docsGraph } from '../../lib/docs/graph.ts';

export const GET: APIRoute = () =>
  new Response(viewJson(docsGraphView(docsGraph({ cache: import.meta.env.PROD }))), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

// /docs/graph.json: the docs graph as nodes and relationships arrays, the same
// data as /docs/graph.cypher (DOCS-PLAN.md §3.5; src/lib/docs/graph.ts).
import type { APIRoute } from 'astro';

import { docsGraph, graphJson } from '../../lib/docs/graph.ts';

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(graphJson(docsGraph({ cache: import.meta.env.PROD })), null, 1)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

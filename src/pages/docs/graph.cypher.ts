// /docs/graph.cypher: the docs graph as a Cypher seed script, the docs-graph
// artifact (DOCS-PLAN.md §3.5, ADR-0015; src/lib/docs/graph.ts).
import type { APIRoute } from 'astro';

import { docsGraph, seedScript } from '../../lib/docs/graph.ts';

export const GET: APIRoute = () =>
  new Response(seedScript(docsGraph({ cache: import.meta.env.PROD })), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// /docs/<id>.graph.md: a page's neighborhood in the docs graph as markdown
// (prerequisites, related, links both ways, terms, sections, examples, CLI
// references; DOCS-PLAN.md §3.5, src/lib/docs/graph.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { docsGraph, pageGraphMarkdown, publishedPageIds } from '../../lib/docs/graph.ts';

export const getStaticPaths = (() =>
  publishedPageIds(docsGraph({ cache: import.meta.env.PROD })).map((id) => ({ params: { slug: id }, props: { id } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ id: string }> = ({ props }) =>
  new Response(pageGraphMarkdown(docsGraph({ cache: import.meta.env.PROD }), props.id), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });

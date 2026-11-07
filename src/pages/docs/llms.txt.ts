// /docs/llms.txt: the facts block, then every page grouped by task (DOCS-PLAN.md §3.2).
import type { APIRoute } from 'astro';

import { llmsTxt } from '../../lib/docs/llms.ts';
import { docsSite } from '../../lib/docs/site.ts';

export const GET: APIRoute = async () => {
  const site = await docsSite();
  const sections = site.fullFiles().filter((f) => f.ids.length).map((f) => [f.path, f.label] as [string, string]);
  return new Response(llmsTxt(site.indexed(), site.engine, sections), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};

// /docs/<section>/llms-full.txt and /docs/<section>/<group>/llms-full.txt:
// one section's or group's pages, twins concatenated, so an agent can take the
// CLI reference without the Swift tutorial (DOCS-PLAN.md §3.2).
import type { APIRoute, GetStaticPaths } from 'astro';

import { llmsFull } from '../../../lib/docs/llms.ts';
import { docsSite } from '../../../lib/docs/site.ts';

export const getStaticPaths = (async () => {
  const site = await docsSite();
  return site
    .fullFiles()
    .filter((f) => f.ids.length)
    .map((f) => ({ params: { group: f.path.replace(/^\/docs\//, '').replace(/\/llms-full\.txt$/, '') }, props: { label: f.label, ids: f.ids } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ label: string; ids: string[] }> = async ({ props }) => {
  const site = await docsSite();
  const pages = site.indexed().filter((p) => props.ids.includes(p.id));
  return new Response(llmsFull(`relate docs: ${props.label}`, pages), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};

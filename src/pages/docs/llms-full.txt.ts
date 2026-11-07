// /docs/llms-full.txt: every page's markdown twin, in reading order.
import type { APIRoute } from 'astro';

import { llmsFull } from '../../lib/docs/llms.ts';
import { docsSite } from '../../lib/docs/site.ts';

export const GET: APIRoute = async () => {
  const site = await docsSite();
  return new Response(llmsFull('relate docs: every page', site.indexed()), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};

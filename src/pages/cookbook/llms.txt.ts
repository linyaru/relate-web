// /cookbook/llms.txt: the agent-readable index of the recipes.
import type { APIRoute } from 'astro';

import { CANONICAL_ORIGIN } from '../../lib/cookbook/links.ts';
import { llmsTxt } from '../../lib/cookbook/render.ts';
import { cookbook } from '../../lib/cookbook/site.ts';

export const GET: APIRoute = async () =>
  new Response(llmsTxt(await cookbook(), `${CANONICAL_ORIGIN}/cookbook/`), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

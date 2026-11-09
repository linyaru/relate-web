// /docs/index.md: the docs landing as markdown (the task index and the AGENTS.md block).
import { join } from 'node:path';

import type { APIRoute } from 'astro';

import { agentsMd } from '../../components/docs/install.ts';
import { CANONICAL_ORIGIN } from '../../lib/cookbook/links.ts';
import { lastUpdated, ROOT } from '../../lib/docs/content.ts';
import { landingTwin } from '../../lib/docs/landing.ts';
import { docsSite } from '../../lib/docs/site.ts';
import { versionLine } from '../../lib/docs/twin.ts';

export const GET: APIRoute = async () => {
  const site = await docsSite();
  const markdown = landingTwin(site.links.pages, {
    origin: CANONICAL_ORIGIN,
    verified: site.engine.verified,
    versionLine: versionLine(site.engine.verified),
    lastUpdated: lastUpdated(join(ROOT, 'src/pages/docs/index.astro')),
    agentsMd: agentsMd(site.engine.version),
    order: site.order(),
  });
  return new Response(markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};

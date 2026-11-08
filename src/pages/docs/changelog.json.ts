// /docs/changelog.json: the changelog as a JSON Feed 1.1 document, the same
// entries as /docs/reference/changelog/ with canonical URLs
// (src/lib/docs/generated/changelog.ts).
import type { APIRoute } from 'astro';

import { changelogFeed, generatedContext } from '../../lib/docs/generated/index.ts';

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(changelogFeed(generatedContext()), null, 2)}\n`, {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });

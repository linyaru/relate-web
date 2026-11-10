// /docs/<page>/data/<name>.json: each ```json data=<name> block of a docs
// page, its text exactly as the page holds it and its cells run it (never
// re-serialized, no newline added), so a twin's stub can name its size and
// SHA-256 (src/lib/docs/data-blocks.ts, ADR-0049). The twin inlines a block
// of up to 2 KiB and links a larger one here; every block is served.
import type { APIRoute, GetStaticPaths } from 'astro';

import { parsePage } from '../../lib/docs/parse.ts';
import { collectCells } from '../../lib/docs/results.ts';
import { docsSite } from '../../lib/docs/site.ts';

export const getStaticPaths = (async () => {
  const site = await docsSite();
  return site.pages.flatMap((page) =>
    [...collectCells(parsePage(page.entry.body ?? '')).data].map(([name, text]) => ({
      params: { block: `${page.id}/data/${name}` },
      props: { text },
    })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) =>
  new Response(props.text, { headers: { 'Content-Type': 'application/json' } });

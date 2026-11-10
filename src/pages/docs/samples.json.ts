// /docs/samples.json: the index of the verified language samples' manifests
// (src/lib/docs/sample-manifests.ts, ADR-0053): every manifest's URL and the
// SHA-256 of its bytes, and each language's client build once.
import type { APIRoute } from 'astro';

import { samplesIndexText } from '../../lib/docs/sample-manifests.ts';

export const GET: APIRoute = () => new Response(samplesIndexText(), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

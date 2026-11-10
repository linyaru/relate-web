// /robots.txt: disallow everything until the launch build sets PUBLIC_INDEXABLE=true
// (src/lib/seo.ts, ADR-0057), then allow everything and name the sitemap.
import type { APIRoute } from 'astro';

import { robotsTxt } from '../lib/seo.ts';

export const GET: APIRoute = () => new Response(robotsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

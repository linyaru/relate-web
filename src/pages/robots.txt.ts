// /robots.txt: allow everything and name the sitemap, or disallow everything in a build
// with PUBLIC_INDEXABLE=false (src/lib/seo.ts, ADR-0058).
import type { APIRoute } from 'astro';

import { robotsTxt } from '../lib/seo.ts';

export const GET: APIRoute = () => new Response(robotsTxt(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

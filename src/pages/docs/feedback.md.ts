// /docs/feedback.md: where a wrong or missing page is reported, what a report
// holds, and who sends it (src/lib/docs/generated/feedback.ts; ADR-0013).
import type { APIRoute } from 'astro';

import { feedbackMarkdown, generatedContext } from '../../lib/docs/generated/index.ts';

export const GET: APIRoute = () =>
  new Response(feedbackMarkdown(generatedContext()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

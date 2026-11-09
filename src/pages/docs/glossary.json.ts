// /docs/glossary.json: the glossary as data, `{id, term, short, aliases,
// context, url}` per term, wrapped with `kind: "documentation"`, its source
// page and its limits (DOCS-PLAN.md §4.11, ADR-0009; src/lib/docs/glossary.ts).
// The bytes depend only on the glossary files and the verified engine
// version, so docs-artifacts.json can list their hash.
import type { APIRoute } from 'astro';

import { engine } from '../../lib/docs/content.ts';
import { glossaryJsonText } from '../../lib/docs/glossary.ts';

export const GET: APIRoute = () =>
  new Response(glossaryJsonText(engine().verified), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

// /docs/capabilities.json: the capability catalog as data (DOCS-PLAN.md §3.8),
// the same entries as /docs/concepts/problems-relate-solves/, with canonical
// URLs, the intents an agent might phrase each problem as, and the data model
// as mermaid source and as an SVG URL. Generated from
// src/content/docs/_capabilities by src/lib/docs/capabilities.ts; the bytes
// are what /docs/docs-artifacts.json hashes.
import type { APIRoute } from 'astro';

import { capabilitiesJsonText } from '../../lib/docs/capabilities.ts';

export const GET: APIRoute = () => new Response(capabilitiesJsonText(), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

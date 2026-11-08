// /docs/docs-artifacts.json: the agent artifacts the site serves, each with its
// SHA-256 and size (ADR-0013 decision 3): the skills indexes, the skill files,
// the /skill.md alias, the docs graph's seed script (/docs/graph.cypher), and
// relate-docs.rl and capabilities.json once they exist under public/docs/. No
// timestamp, so the bytes change only with the content; the release key signs
// them at launch (docs-artifacts.json.sig beside it, LAUNCH.md; the manifest
// does not name it, so signing never changes the signed bytes) and docs:check
// verifies that signature when it exists.
import type { APIRoute } from 'astro';

import { docsArtifacts, toJson } from '../../lib/docs/checks/skill.ts';
import { engine } from '../../lib/docs/content.ts';

export const GET: APIRoute = () => new Response(toJson(docsArtifacts(engine())), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

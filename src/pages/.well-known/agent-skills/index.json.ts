// /.well-known/agent-skills/index.json: the agent skills discovery index,
// format 0.2.0 (DOCS-PLAN.md §3.3, §9). Built from the served
// public/skills/relate/SKILL.md, so its sha256 digest is over the bytes the
// site serves at the entry's url. `npx skills add https://relatedb.ai` reads it.
import type { APIRoute } from 'astro';

import { agentSkillsIndex, toJson } from '../../../lib/docs/checks/skill.ts';

export const GET: APIRoute = () => new Response(toJson(agentSkillsIndex()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

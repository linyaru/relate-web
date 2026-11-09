// /.well-known/agent-skills/index.json: the agent skills discovery index,
// format 0.2.0 (DOCS-PLAN.md §3.3, §3.8, §9). One `skill-md` entry per
// skill, the CLI bundle first and then each task skill, each built from the
// served public/skills/<name>/SKILL.md, so its sha256 digest is over the
// bytes the site serves at the entry's url. `npx skills add https://relatedb.ai`
// reads it; `--skill <name>` picks one entry.
import type { APIRoute } from 'astro';

import { agentSkillsIndex, toJson } from '../../../lib/docs/checks/skill.ts';

export const GET: APIRoute = () => new Response(toJson(agentSkillsIndex()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

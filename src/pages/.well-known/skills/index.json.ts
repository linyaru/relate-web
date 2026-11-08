// /.well-known/skills/index.json: the legacy 0.1.0 skills index (no $schema;
// skills[].files[] lists SKILL.md and every references/ file), for clients
// that predate 0.2.0. They fetch each file from /.well-known/skills/relate/<file>,
// which ./relate/[...file].ts serves from public/skills/relate/.
import type { APIRoute } from 'astro';

import { legacySkillsIndex, toJson } from '../../../lib/docs/checks/skill.ts';

export const GET: APIRoute = () => new Response(toJson(legacySkillsIndex()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

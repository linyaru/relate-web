// /.well-known/skills/relate/<file>: the skill bundle where the legacy 0.1.0
// index says its files are, byte for byte the files in public/skills/relate/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRoute, GetStaticPaths } from 'astro';

import { bundleFiles, SKILL_DIR } from '../../../../lib/docs/checks/skill.ts';

export const getStaticPaths = (() => bundleFiles().map((file) => ({ params: { file } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(readFileSync(join(SKILL_DIR, String(params.file))), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

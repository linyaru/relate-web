// /.well-known/skills/<name>/<file>: every skill where the legacy 0.1.0 index
// says its files are, byte for byte the files in public/skills/<name>/: the
// CLI bundle (`relate`, synced from upstream) and each task skill authored
// here (src/lib/docs/skill.ts). The same bytes are served at /skills/<name>/
// from public/.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { APIRoute, GetStaticPaths } from 'astro';

import { SKILL_DIR, SKILL_NAME } from '../../../../lib/docs/checks/skill.ts';
import { skillFiles, taskSkills } from '../../../../lib/docs/skill.ts';

export const getStaticPaths = (() =>
  [{ name: SKILL_NAME, dir: SKILL_DIR }, ...taskSkills()].flatMap((s) =>
    skillFiles(s.dir).map((file) => ({ params: { name: s.name, file }, props: { path: join(s.dir, file) } })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute<{ path: string }> = ({ props }) =>
  new Response(readFileSync(props.path), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

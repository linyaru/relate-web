// /.well-known/security.txt (RFC 9116, ADR-0013 decision 5). RFC 9116 requires
// a Contact field and no disclosure address exists yet (LAUNCH.md), so the
// file is built only once src/content/docs/_data/project.json has
// `{"security": {"contact": "mailto:…"}}`; until then this route yields no
// page. Expires is one year after the build date.
import type { APIRoute, GetStaticPaths } from 'astro';

import { securityTxt } from '../../lib/docs/checks/skill.ts';

export const getStaticPaths = (() => (securityTxt(new Date()) ? [{ params: { file: 'security.txt' } }] : [])) satisfies GetStaticPaths;

export const GET: APIRoute = () => new Response(securityTxt(new Date()), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

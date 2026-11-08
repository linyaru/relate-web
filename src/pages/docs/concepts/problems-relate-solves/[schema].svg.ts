// /docs/concepts/problems-relate-solves/schema-<id>-<theme>.svg: a capability's
// recommended data model, drawn by `npm run docs:diagrams` from the page's
// generated section into concepts/diagrams/ and checked (fresh, inert) as the
// page inlines it. /docs/capabilities.json names the light one as `schema_url`
// (src/lib/docs/capabilities.ts).
import type { APIRoute, GetStaticPaths } from 'astro';

import { CAPABILITIES_PAGE, schemaFiles } from '../../../../lib/docs/capabilities.ts';

const PREFIX = `/docs/${CAPABILITIES_PAGE}/`;

export const getStaticPaths = (() =>
  schemaFiles().map((f) => ({ params: { schema: f.path.slice(PREFIX.length).replace(/\.svg$/, '') }, props: { svg: f.svg } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ svg: string }> = ({ props }) =>
  new Response(`${props.svg}\n`, { headers: { 'Content-Type': 'image/svg+xml' } });

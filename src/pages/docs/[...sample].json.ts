// /docs/<page>/samples/<id>.json: one verified language sample as a manifest
// (src/lib/docs/sample-manifests.ts, ADR-0053): the program as the page shows
// it, its recorded output with a SHA-256, the client build and toolchain the
// last replay used, and how the docs' runner builds and runs it. The twin
// lists a page's manifests in its frontmatter (`samples`).
import type { APIRoute, GetStaticPaths } from 'astro';

import { allSampleManifests, manifestText } from '../../lib/docs/sample-manifests.ts';

export const getStaticPaths = (() =>
  allSampleManifests().map((m) => ({
    params: { sample: new URL(m.url).pathname.replace(/^\/docs\//, '').replace(/\.json$/, '') },
    props: { text: manifestText(m) },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) => new Response(props.text, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });

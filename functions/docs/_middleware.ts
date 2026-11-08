// Cloudflare Pages Function: content negotiation on the docs routes
// (ADR-0005, ADR-0012; DOCS-PLAN.md §3.1, §5). Mounted on /docs and
// /docs/* by its place in functions/, after functions/_middleware.ts (the
// agent-path log for the static files); no other path reaches it.
//
// - GET or HEAD on a canonical docs page URL (/docs/, /docs/<id>/) whose
//   Accept prefers text/markdown answers with the page's markdown twin, the
//   bytes of /docs/<id>.md (/docs/index.md for the landing).
// - With ?section=<anchor> as well, it answers with that heading's subtree
//   of the twin (src/lib/docs/negotiation.ts), or 404 listing the anchors.
// - Everything else (HTML requests, the .md twins themselves, llms.txt, any
//   other file) passes through to the static asset unchanged.
//
// Cloudflare's cache ignores Vary, so markdown answers are
// `Cache-Control: private` (ADR-0012 "Later references"); like the static
// files, they allow any origin and set no cookie (ADR-0013). An HTML answer
// on a URL that negotiates gets `Vary: Accept` too. Each markdown answer
// logs one line (path, kind, status, user agent; never a query string) for
// the agent-path counts DOCS-PLAN.md §5 asks for; direct fetches of a twin,
// an llms.txt or the skill are logged by functions/_middleware.ts.

import { agentPathLine, estimateTokens, isOwnTwin, prefersMarkdown, sliceSection, twinPathFor } from '../../src/lib/docs/negotiation.ts';

interface Env {
  ASSETS: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
}

interface Context {
  request: Request;
  env: Env;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

const MAX_ECHO = 80;

function log(kind: string, path: string, status: number, request: Request): void {
  console.log(JSON.stringify(agentPathLine(kind, path, status, request.headers.get('user-agent'))));
}

/** A passed-through answer on a URL that negotiates, with `Vary: Accept` added. */
async function passThrough(context: Context): Promise<Response> {
  const res = await context.next();
  const out = new Response(res.body, res);
  const vary = out.headers.get('vary');
  if (!vary || !/(^|,)\s*accept\s*(,|$)/i.test(vary)) out.headers.append('Vary', 'Accept');
  return out;
}

function markdownHeaders(body: string, canonical: string | null): Headers {
  const headers = new Headers({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Length': String(new TextEncoder().encode(body).byteLength),
    Vary: 'Accept',
    'Cache-Control': 'private',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'x-markdown-tokens': String(estimateTokens(body)),
  });
  if (canonical) headers.set('Link', `<${canonical}>; rel="canonical"`);
  return headers;
}

function respond(request: Request, status: number, body: string, headers: Headers): Response {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

async function asset(env: Env, request: Request, path: string): Promise<string | null> {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: 'GET' }));
  if (res.status !== 200) return null;
  return res.text();
}

export const onRequest = async (context: Context): Promise<Response> => {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return context.next();

  const url = new URL(request.url);
  const twinPath = twinPathFor(url.pathname);
  if (!twinPath) return context.next(); // a file (.md, llms.txt, …) or not under /docs
  if (!prefersMarkdown(request.headers.get('accept'))) return passThrough(context);

  const twin = await asset(env, request, twinPath);
  if (twin === null) return passThrough(context); // not a docs page: the asset (or the 404 page) answers

  const canonical = /^canonical_url:\s*["']?(\S+?)["']?\s*$/m.exec(twin)?.[1] ?? null;
  // Only a page's own twin: /docs/feedback/, /docs/changelog/ and /docs/<id>/index/ have a file there but are not pages.
  if (!isOwnTwin(url.pathname, canonical)) return passThrough(context);
  const section = url.searchParams.get('section');
  if (!section) {
    log('negotiated', url.pathname, 200, request);
    return respond(request, 200, twin, markdownHeaders(twin, canonical));
  }

  // The built HTML page pairs the twin's headings with the page's own ids.
  const pagePath = twinPath === '/docs/index.md' ? '/docs/' : `${twinPath.slice(0, -'.md'.length)}/`;
  const html = await asset(env, request, pagePath);
  const twinUrl = canonical ? `${new URL(canonical).origin}${twinPath}` : undefined;
  const result = sliceSection(twin, section, { html: html ?? undefined, twinUrl });
  if (result.ok) {
    log('section', url.pathname, 200, request);
    return respond(request, 200, result.markdown, markdownHeaders(result.markdown, canonical));
  }

  log('section', url.pathname, 404, request);
  const shown = section.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_ECHO);
  const body =
    `No section "${shown}" on ${canonical ?? url.pathname}.\n` +
    `Sections: ${result.anchors.length ? result.anchors.join(', ') : '(none)'}\n`;
  return respond(
    request,
    404,
    body,
    new Headers({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(new TextEncoder().encode(body).byteLength),
      Vary: 'Accept',
      'Cache-Control': 'private',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    }),
  );
};

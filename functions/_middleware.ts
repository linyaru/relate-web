// Cloudflare Pages Function: the agent-path log for the static files agents
// read (DOCS-PLAN.md §5 "Measurement from day one"; ADR-0025). One line per
// GET or HEAD of the skill (/skill.md, /skills/…, the /.well-known/ skill
// indexes), an llms.txt (/llms.txt, /docs/llms.txt, /docs/llms-full.txt), a
// docs twin (/docs/<id>.md) or a data block a twin links
// (/docs/<id>/data/<name>.json): kind, path, status, user agent; never a query
// string. The answer is the static file, unchanged.
//
// public/_routes.json limits the paths that invoke a function at all to
// /docs, /docs/*, /skill.md, /skills/*, /llms.txt and /.well-known/*; every
// other path is served without one. Under /docs, functions/docs/_middleware.ts
// runs after this one and answers the negotiated markdown.

import { agentPathKind, agentPathLine } from '../src/lib/docs/negotiation.ts';

interface Context {
  request: Request;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
}

export const onRequest = async (context: Context): Promise<Response> => {
  const { request } = context;
  const res = await context.next();
  if (request.method === 'GET' || request.method === 'HEAD') {
    const path = new URL(request.url).pathname;
    const kind = agentPathKind(path);
    if (kind) console.log(JSON.stringify(agentPathLine(kind, path, res.status, request.headers.get('user-agent'))));
  }
  return res;
};

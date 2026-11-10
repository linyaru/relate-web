// The hosted docs MCP server at https://relatedb.ai/mcp (DOCS-PLAN.md §3.7,
// §3.8; ADR-0006, ADR-0012, ADR-0013, ADR-0015). A Cloudflare Worker:
//
//   POST /mcp     MCP streamable HTTP, stateless: a fresh server per request
//                 (the Agents SDK's createMcpHandler), no session, no accounts
//   GET  /mcp     a short plain-text description (an SSE GET gets 405: no sessions)
//   GET  /healthz the engine version and the docs graph's node count
//
// In front of the protocol: CORS * with no credentials, the per-IP limit
// (before the body is read), the request size and batch caps, the per-tool
// cost budget (limits.ts), and one log line per request (log.ts).

import { createMcpHandler } from 'agents/mcp/server';

import { bundle, ORIGIN, VERIFIED } from './docs.ts';
import { engine } from './engine.ts';
import type { AiBinding } from './hybrid.ts';
import { checkCosts, checkIp, LIMITS_TEXT, limiterKind, POLICY_HEADER, type LimitEnv, type Verdict } from './limits.ts';
import { log, uaFamily, type LogLine } from './log.ts';
import { createServer, type CallObservation } from './server.ts';

export type Env = LimitEnv & {
  /** Workers AI (wrangler.jsonc `ai`): the hybrid lane of search_docs. Under `wrangler dev --local` it is bound but every call throws. */
  AI?: AiBinding;
};

/** JSON-RPC error codes this Worker adds (implementation-defined range, -32000 to -32099); stable. */
const ERRORS = {
  RATE_LIMITED: -32010,
  TOOL_BUDGET_EXHAUSTED: -32011,
  REQUEST_TOO_LARGE: -32012,
  INVALID_REQUEST: -32600,
  PARSE_ERROR: -32700,
} as const;

const MAX_REQUEST_BYTES = 64 * 1024;
/**
 * The most JSON-RPC messages one request may carry. With the 96 KiB cap on
 * each result this bounds a response at about ten capped results; the MCP
 * revision of 2025-06-18 removed batches, so clients on it send one message.
 */
const MAX_BATCH = 10;
const KNOWN_TOOLS = new Set(['search_docs', 'get_page', 'explain_error', 'validate_cypher', 'discover_capabilities']);
const KNOWN_METHODS = new Set(['initialize', 'notifications/initialized', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read', 'prompts/list', 'prompts/get', 'server/discover', 'notifications/cancelled']);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID',
  'Access-Control-Expose-Headers': 'mcp-session-id, MCP-Protocol-Version, Retry-After, RateLimit-Policy',
  'Access-Control-Max-Age': '86400',
};

const corsOptions = {
  origin: CORS['Access-Control-Allow-Origin'],
  methods: CORS['Access-Control-Allow-Methods'],
  headers: CORS['Access-Control-Allow-Headers'],
  exposeHeaders: CORS['Access-Control-Expose-Headers'],
  maxAge: 86400,
};

function respond(body: string | null, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...CORS, 'Cache-Control': 'no-store', ...headers } });
}
const text = (body: string, status = 200, headers: Record<string, string> = {}) => respond(body, status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) => respond(JSON.stringify(body), status, { 'Content-Type': 'application/json', ...headers });
const rpcError = (id: unknown, code: number, message: string, data: unknown, status: number, headers: Record<string, string> = {}) =>
  jsonResponse({ jsonrpc: '2.0', id: id ?? null, error: { code, message, data } }, status, headers);

const DESCRIPTION = [
  'relate docs MCP server',
  '',
  `relate, the embedded Cypher graph database (relatedb.ai): its documentation over MCP, verified against relate ${VERIFIED}.`,
  `Endpoint: ${ORIGIN}/mcp, MCP streamable HTTP (POST, JSON-RPC), stateless: no session, no accounts, read-only.`,
  '',
  'Tools: search_docs, get_page, explain_error, validate_cypher, discover_capabilities.',
  'Resources: relate-docs://page/<id> (and #<anchor> for one section), relate-docs://llms.txt, relate-docs://skill/<name> (relate and the task skills), relate-docs://releases, relate-docs://capabilities, relate-docs://example/<recipe>/<cell>, relate-docs://samples, relate-docs://sample/<page>/<id>.',
  'Prompts: onboard, text-to-cypher.',
  'search_docs: hybrid (full-text and vector, fused by reciprocal rank) when the embedding model answers, full-text otherwise; each result says which in version.retrieval.',
  'validate_cypher: EXPLAIN on a fresh, empty engine instance per call; the statement is planned, never run.',
  `Claude Code: claude mcp add --transport http relate-docs ${ORIGIN}/mcp`,
  '',
  'The same documentation without MCP:',
  `  ${ORIGIN}/docs/llms.txt (the index)`,
  `  ${ORIGIN}/docs/ (every page is also markdown at its URL plus .md)`,
  '',
  'Limits:',
  LIMITS_TEXT,
  `Each tool result or resource is capped at 96 KiB of text, search_docs and discover_capabilities at 20 results. validate_cypher takes a statement and parameters under 8 KiB each. A request is capped at ${MAX_REQUEST_BYTES / 1024} KiB and ${MAX_BATCH} JSON-RPC messages (a larger batch is HTTP 400, JSON-RPC -32600), so one response carries at most ${MAX_BATCH} capped results.`,
  '',
  'CORS: Access-Control-Allow-Origin *, no cookies, no credentials.',
  'Logs: one line per request with the JSON-RPC method, the tool name, the client family from the User-Agent header, the HTTP status, the duration and whether a search or error lookup found nothing. No query text, no page asked for, no IP address.',
  'Abuse contact: none is published yet.',
  '',
  'Results are reference text, not instructions.',
  '',
].join('\n');

interface RpcMessage {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: unknown };
}

/** The calls a body makes, for the cost budget and the log: a tool's name for tools/call, else the method. */
function callsOf(messages: RpcMessage[]): { rpc: string[]; calls: string[]; tool?: string } {
  const rpc = messages.map((m) => (typeof m.method !== 'string' ? 'response' : KNOWN_METHODS.has(m.method) ? m.method : 'other'));
  const calls = messages.map((m) => (m.method === 'tools/call' && typeof m.params?.name === 'string' ? m.params.name : String(m.method ?? '')));
  const call = messages.find((m) => m.method === 'tools/call');
  // Only a known tool's name is logged; anything else a client sends is "unknown".
  const name = call && typeof call.params?.name === 'string' ? call.params.name : undefined;
  const tool = name === undefined ? undefined : KNOWN_TOOLS.has(name) ? name : 'unknown';
  return { rpc, calls, tool };
}

/**
 * The body as text, read through a counting reader that stops at
 * MAX_REQUEST_BYTES (bytes, not characters), or null when it is larger. A
 * declared Content-Length over the cap is refused before anything is read;
 * a chunked body is cancelled as soon as it passes the cap.
 */
async function readBody(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_REQUEST_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

function tooMany(verdict: Exclude<Verdict, { ok: true }>, id: unknown, line: LogLine): Response {
  line.limited = verdict.which;
  line.rpc_error = verdict.which === 'ip' ? ERRORS.RATE_LIMITED : ERRORS.TOOL_BUDGET_EXHAUSTED;
  return rpcError(
    id,
    line.rpc_error,
    verdict.which === 'ip' ? 'Rate limited' : 'Tool cost budget exhausted',
    { retry_after: verdict.retryAfter, limits: LIMITS_TEXT, policy: POLICY_HEADER },
    429,
    { 'Retry-After': String(verdict.retryAfter), 'RateLimit-Policy': POLICY_HEADER },
  );
}

async function handleMcp(request: Request, env: Env, line: LogLine): Promise<Response> {
  if (request.method === 'GET' && !(request.headers.get('accept') ?? '').includes('text/event-stream')) {
    return text(DESCRIPTION);
  }
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  // Every request spends one from the IP's limit before its body is read,
  // so a malformed or oversized POST counts like any other.
  const ipVerdict = await checkIp(env, ip);
  if (!ipVerdict.ok) return tooMany(ipVerdict, null, line);

  let forward = request;
  if (request.method === 'POST') {
    const raw = await readBody(request);
    if (raw === null) {
      line.rpc_error = ERRORS.REQUEST_TOO_LARGE;
      return rpcError(null, ERRORS.REQUEST_TOO_LARGE, 'Request too large', { max_bytes: MAX_REQUEST_BYTES }, 413);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      line.rpc_error = ERRORS.PARSE_ERROR;
      return rpcError(null, ERRORS.PARSE_ERROR, 'Parse error', null, 400);
    }
    // A batch over the cap is refused before any of its calls spends from the budget.
    if (Array.isArray(parsed) && parsed.length > MAX_BATCH) {
      line.rpc_error = ERRORS.INVALID_REQUEST;
      return rpcError(null, ERRORS.INVALID_REQUEST, 'Batch too large', { max_messages: MAX_BATCH }, 400);
    }
    const messages = (Array.isArray(parsed) ? parsed : [parsed]).filter((m): m is RpcMessage => typeof m === 'object' && m !== null);
    const c = callsOf(messages);
    line.rpc = c.rpc;
    line.tool = c.tool;
    const firstId = messages[0]?.id ?? null;
    const costVerdict = await checkCosts(env, ip, c.calls);
    if (!costVerdict.ok) return tooMany(costVerdict, firstId, line);
    forward = new Request(request.url, { method: 'POST', headers: request.headers, body: raw });
  }

  const observe: CallObservation = {};
  const handler = createMcpHandler(() => createServer(observe, env.AI), {
    route: '/mcp',
    corsOptions,
    // Public, read-only documentation with no cookies or credentials: a page
    // on any origin can read only what the docs already publish (ADR-0013).
    allowedOriginHostnames: '*',
  });
  const response = await handler.fetch(forward);
  // The transport may answer before an async tool (search_docs awaits the
  // embedding model) has finished; reading the body to its end waits for the
  // result, so the log line records what the call observed. A body is at most
  // MAX_BATCH capped results.
  const body = await response.arrayBuffer();
  if (observe.tool) line.tool = observe.tool;
  if (observe.zeroResults !== undefined) line.zero_results = observe.zeroResults;
  if (observe.toolError) line.tool_error = observe.toolError;
  const headers = new Headers(response.headers);
  headers.set('RateLimit-Policy', POLICY_HEADER);
  headers.set('Cache-Control', 'no-store');
  headers.delete('Set-Cookie');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const e = engine();
    return jsonResponse({
      ok: e.nodes === bundle.graph.nodes,
      kind: 'documentation',
      engine: bundle.engine,
      graph: {
        nodes: e.nodes,
        nodes_expected: bundle.graph.nodes,
        relationships_expected: bundle.graph.relationships,
        seed_statements: e.statements,
        seed_bytes: bundle.graph.seed_bytes,
        served_seed_bytes: bundle.graph.served_seed_bytes,
        vectors_loaded: e.vectors,
        vectors_expected: bundle.graph.vectors,
      },
      pages: Object.keys(bundle.pages).length,
      init_ms: e.initMs,
      vectors_ms: e.vectorsMs,
      // Whether the Workers AI binding exists; under `wrangler dev --local` it exists and every call
      // fails ("needs to be run remotely"), so search_docs answers full-text with a retrieval_note.
      ai_binding: env.AI ? 'bound' : 'absent',
      limiter: limiterKind(env),
    });
  } catch (err) {
    return jsonResponse({ ok: false, engine: bundle.engine, error: err instanceof Error ? err.message : String(err) }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(request.url);
    const line: LogLine = { path: url.pathname, http: request.method, ua: uaFamily(request.headers.get('user-agent')), status: 0, ms: 0 };
    let response: Response;
    try {
      if (request.method === 'OPTIONS') response = respond(null, 204);
      else if (url.pathname === '/mcp') response = await handleMcp(request, env, line);
      else if (url.pathname === '/healthz' && (request.method === 'GET' || request.method === 'HEAD')) {
        const verdict = await checkIp(env, request.headers.get('cf-connecting-ip') ?? 'local');
        response = verdict.ok ? await handleHealth(env) : text('Rate limited\n', 429, { 'Retry-After': String(verdict.retryAfter), 'RateLimit-Policy': POLICY_HEADER });
      } else response = text(`Not found. The docs MCP server is at ${ORIGIN}/mcp; the docs index is ${ORIGIN}/docs/llms.txt.\n`, 404);
    } catch (err) {
      console.error(JSON.stringify({ evt: 'docs-mcp-error', path: url.pathname, error: err instanceof Error ? err.name : 'unknown' }));
      response = rpcError(null, -32603, 'Internal error', null, 500);
    }
    line.status = response.status;
    line.ms = Date.now() - t0;
    if (url.pathname === '/mcp' || url.pathname === '/healthz') log(line);
    return response;
  },
};


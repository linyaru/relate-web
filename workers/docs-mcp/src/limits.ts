// Rate limits (ADR-0013 decision 4; DOCS-PLAN.md §3.7 "Operating rules").
//
// Two limits, both published with every 429 (Retry-After and a
// RateLimit-Policy header) and in the plain-text description at GET /mcp:
//
// - per IP: every request to /mcp or /healthz counts once, before its body
//   is read (a malformed or oversized POST counts too); a burst limit.
// - per IP and tool, a cost budget: each tool call (and each resources/read)
//   spends its cost in units, so the expensive calls (a search on the
//   engine, a validate_cypher on a fresh instance) run out before the cheap
//   reads of bundled pages do. Cloud harnesses
//   share egress, so a single per-IP number is either too strict for the
//   many agents behind one address or too loose for one agent looping on
//   search; the budget bounds the engine work without lowering the burst
//   limit for page reads.
//
// Counters live in Cloudflare's rate limiting binding when the Worker has
// it (wrangler.jsonc `ratelimits`; wrangler dev simulates it locally). That
// binding counts per Cloudflare location, is eventually consistent, and
// reports no reset time, so Retry-After is the window length, an upper
// bound. Without the binding (a test harness, or an account without the
// feature) an in-isolate fixed window keeps the same numbers per isolate and
// gives an exact Retry-After.

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export const IP_LIMIT = { limit: 20, period: 10 } as const;
export const COST_BUDGET = { limit: 120, period: 60 } as const;
/** Units each call spends from its tool's budget. */
export const COSTS: Record<string, number> = {
  search_docs: 3,
  validate_cypher: 3,
  get_page: 1,
  explain_error: 1,
  discover_capabilities: 1,
  'resources/read': 1,
  'prompts/get': 1,
};

export const POLICY_HEADER = `"ip";q=${IP_LIMIT.limit};w=${IP_LIMIT.period}, "tool-cost";q=${COST_BUDGET.limit};w=${COST_BUDGET.period}`;

export const LIMITS_TEXT = [
  `Per IP address: ${IP_LIMIT.limit} requests per ${IP_LIMIT.period} seconds.`,
  `Per IP address and tool, a cost budget of ${COST_BUDGET.limit} units per ${COST_BUDGET.period} seconds: search_docs and validate_cypher cost ${COSTS.search_docs} units; get_page, explain_error, discover_capabilities, resources/read and prompts/get cost 1.`,
  'Over a limit the answer is HTTP 429 with Retry-After (seconds) and a JSON-RPC error.',
].join('\n');

export type Verdict = { ok: true } | { ok: false; which: 'ip' | 'tool-cost'; retryAfter: number };

interface Window {
  start: number;
  count: number;
}
const windows = new Map<string, Window>();

function local(key: string, limit: number, periodSec: number, cost: number): number {
  const now = Date.now();
  let w = windows.get(key);
  if (!w || now - w.start >= periodSec * 1000) {
    w = { start: now, count: 0 };
    windows.set(key, w);
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
    }
  }
  if (w.count + cost > limit) return Math.max(1, Math.ceil((w.start + periodSec * 1000 - now) / 1000));
  w.count += cost;
  return 0;
}

/**
 * Spend `cost` units from the binding, one `limit()` call each (the binding
 * counts calls, not weights). Not atomic: a call refused at its second or
 * third unit has already spent the ones before, which the page's Limits row
 * states; the in-isolate window (local()) is all-or-nothing per call.
 */
async function viaBinding(binding: RateLimitBinding, key: string, cost: number): Promise<boolean> {
  for (let i = 0; i < cost; i++) {
    if (!(await binding.limit({ key })).success) return false;
  }
  return true;
}

export interface LimitEnv {
  RL_IP?: RateLimitBinding;
  RL_COST?: RateLimitBinding;
}

/** Spend one request from the IP's burst limit. Every request to /mcp and /healthz calls this first, before its body is read. */
export async function checkIp(env: LimitEnv, ip: string): Promise<Verdict> {
  if (env.RL_IP) {
    if (!(await viaBinding(env.RL_IP, `ip:${ip}`, 1))) return { ok: false, which: 'ip', retryAfter: IP_LIMIT.period };
  } else {
    const wait = local(`ip:${ip}`, IP_LIMIT.limit, IP_LIMIT.period, 1);
    if (wait) return { ok: false, which: 'ip', retryAfter: wait };
  }
  return { ok: true };
}

/** Spend `calls`' costs from their per-IP, per-tool budgets (after the body is parsed). */
export async function checkCosts(env: LimitEnv, ip: string, calls: string[]): Promise<Verdict> {
  for (const call of calls) {
    const cost = COSTS[call] ?? 0;
    if (!cost) continue;
    if (env.RL_COST) {
      if (!(await viaBinding(env.RL_COST, `cost:${call}:${ip}`, cost))) return { ok: false, which: 'tool-cost', retryAfter: COST_BUDGET.period };
    } else {
      const wait = local(`cost:${call}:${ip}`, COST_BUDGET.limit, COST_BUDGET.period, cost);
      if (wait) return { ok: false, which: 'tool-cost', retryAfter: wait };
    }
  }
  return { ok: true };
}

/** Which limiter is in use, for /healthz and the README's claims. */
export const limiterKind = (env: LimitEnv) => (env.RL_IP && env.RL_COST ? 'cloudflare-rate-limiting-binding' : 'in-isolate-fixed-window');

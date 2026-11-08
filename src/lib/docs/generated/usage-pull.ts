// How scripts/docs-usage.ts turns the hosted docs MCP server's log lines into
// src/content/docs/_data/usage.json: the requests it sends to Cloudflare and
// the reading of the answer. Pure, so the unit tests (src/lib/docs/usage.test.ts)
// cover it without a network or an account.
//
// The API (Cloudflare API reference, read 2026-11-07):
//   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/observability/telemetry/query
//     https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
//   POST https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/observability/telemetry/keys
//     https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/keys/
// Bearer API token with the "Workers Observability Write" permission (the
// one the query method's reference names). The keys request runs first: it
// lists the fields the period's docs MCP lines carry. The query then asks for
// the `calculations` view: a `count` grouped by the log line's `tool`, `ua`
// and `status` fields, and by `zero_results` and `tool_error` when the keys
// answer lists them (a line carries those two only when a tool set them, so
// a period with no search or no tool error has no such key), filtered to
// `evt = docs-mcp` and `path = /mcp`, over a timeframe in Unix milliseconds.
// A period whose lines carry no `tool` key (no tool was called) needs no
// query: its data file lists no tool. The answer is
// `result.calculations[0].aggregates[]`, each `{value, count, groups: [{key, value}]}`.
// Only counts come back; no log line is read.
//
// Workers Logs keeps lines 3 days on Workers Free and 7 on Workers Paid
// (https://developers.cloudflare.com/workers/observability/logs/workers-logs/,
// read 2026-11-07), so a period is at most MAX_DAYS long.
//
// Not yet run against an account: the Worker logs its line as a JSON string
// (workers/docs-mcp/src/log.ts), and Cloudflare's pages say that logged
// objects have their fields extracted but not whether a JSON string does.
// keysProblems() fails closed when the keys the query groups by are missing.

import { KNOWN_TOOLS, NO_DEPLOYMENT, USAGE_ID, type ToolUsage, type UsageData } from './usage.ts';
import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { pageUrl } from '../model.ts';

export const API = 'https://api.cloudflare.com/client/v4';
export const MAX_DAYS = 7;
/** The most groups one query returns (the API's `limit` ceiling). */
export const GROUP_LIMIT = 2000;
/** The log-line fields the query always groups by (workers/docs-mcp/src/log.ts). */
export const GROUP_KEYS = ['tool', 'ua', 'status'] as const;
/** The fields it groups by when the period's lines carry them. */
export const OPTIONAL_GROUP_KEYS = ['zero_results', 'tool_error'] as const;
/** The fields every docs MCP line carries; the collection fails closed without them. */
export const REQUIRED_KEYS = ['evt', 'path', 'ua', 'status'] as const;

export const queryUrl = (account: string) => `${API}/accounts/${encodeURIComponent(account)}/workers/observability/telemetry/query`;
export const keysUrl = (account: string) => `${API}/accounts/${encodeURIComponent(account)}/workers/observability/telemetry/keys`;

const FILTERS = [
  { key: 'evt', operation: 'eq', type: 'string', value: 'docs-mcp' },
  { key: 'path', operation: 'eq', type: 'string', value: '/mcp' },
];

/** The query body: counts of the docs MCP log lines between `from` and `to` (Unix ms), grouped by GROUP_KEYS and by those of OPTIONAL_GROUP_KEYS in `keys` (keysIn). */
export function queryBody(from: number, to: number, keys: ReadonlySet<string> = new Set()): Record<string, unknown> {
  return {
    queryId: 'docs-mcp-usage',
    timeframe: { from, to },
    view: 'calculations',
    dry: true,
    ignoreSeries: true,
    parameters: {
      datasets: [],
      filterCombination: 'and',
      filters: FILTERS,
      calculations: [{ operator: 'count', alias: 'calls' }],
      groupBys: [
        { type: 'string', value: 'tool' },
        { type: 'string', value: 'ua' },
        { type: 'number', value: 'status' },
        ...(keys.has('zero_results') ? [{ type: 'boolean', value: 'zero_results' }] : []),
        ...(keys.has('tool_error') ? [{ type: 'string', value: 'tool_error' }] : []),
      ],
      limit: GROUP_LIMIT,
    },
  };
}

/** The keys body: the keys of the docs MCP log lines between `from` and `to` (Unix ms). */
export function keysBody(from: number, to: number): Record<string, unknown> {
  return { from, to, datasets: [], filters: FILTERS, limit: 1000 };
}

type KeysAnswer = { success?: boolean; errors?: { message?: string }[]; result?: { key?: string }[] };

/** The keys a keys answer lists (empty for an answer that failed). */
export function keysIn(answer: unknown): Set<string> {
  const a = answer as KeysAnswer;
  return new Set(Array.isArray(a?.result) ? a.result.map((r) => r.key).filter((k): k is string => typeof k === 'string') : []);
}

/**
 * What is wrong with a keys answer (empty when nothing is): a failed request,
 * or lines that lack a field every docs MCP line carries (REQUIRED_KEYS),
 * which means Workers Logs did not extract the line's fields. No lines yet is
 * not a problem, and neither is a missing `tool` (no tool was called in the
 * period) or a missing optional key.
 */
export function keysProblems(answer: unknown): string[] {
  const a = answer as KeysAnswer;
  if (a?.success === false || !Array.isArray(a?.result)) return [`the keys request failed: ${JSON.stringify(a?.errors ?? answer).slice(0, 500)}`];
  if (!a.result.length) return [];
  const keys = keysIn(answer);
  const missing = REQUIRED_KEYS.filter((k) => !keys.has(k));
  return missing.length ? [`the docs MCP log lines have no key ${missing.join(', ')}; the keys that came back: ${[...keys].slice(0, 40).join(', ')}`] : [];
}

interface Aggregate {
  value?: number;
  count?: number;
  groups?: { key?: string; value?: string | number | boolean }[];
}

const NOTE = 'Counts from the server\'s log line, one per request; a request counts once, under one of the tools it called.';
/** The note of a period whose lines name no tool. */
export const NO_TOOL_CALLS = 'No tool call was logged in the period, so no tool is listed.';

/**
 * usage.json from a query answer: one entry per tool, calls and their
 * clients, the 429s, the failed calls (a `tool_error`, or a status outside
 * 200-299 other than 429) and the zero-result calls. Throws on an answer it
 * cannot read, or one that hit the group limit (a count would be missing).
 */
export function usageFromAnswer(answer: unknown, period: { from: string; to: string }, collectedAt: string): UsageData {
  const a = answer as { success?: boolean; errors?: { message?: string }[]; result?: { calculations?: { aggregates?: Aggregate[] }[] } };
  if (a?.success === false || !a?.result) throw new Error(`the query failed: ${JSON.stringify(a?.errors ?? answer).slice(0, 500)}`);
  const aggregates = a.result.calculations?.[0]?.aggregates;
  if (!Array.isArray(aggregates)) throw new Error(`the answer has no result.calculations[0].aggregates: ${JSON.stringify(a.result).slice(0, 500)}`);
  if (aggregates.length >= GROUP_LIMIT) throw new Error(`the answer has ${aggregates.length} groups, the most one query returns, so some counts would be missing; collect a shorter period`);
  const tools = new Map<string, ToolUsage>();
  for (const g of aggregates) {
    const field = (k: string) => g.groups?.find((x) => x.key === k)?.value;
    const raw = field('tool');
    if (raw === undefined || raw === null || raw === '') continue;
    const tool = (KNOWN_TOOLS as readonly string[]).includes(String(raw)) ? String(raw) : 'unknown';
    const calls = Math.round(Number(g.value ?? g.count ?? 0));
    if (!Number.isFinite(calls) || calls <= 0) continue;
    const t = tools.get(tool) ?? { tool, calls: 0, limited: 0, failed: 0, zero_results: 0, clients: [] };
    t.calls += calls;
    const status = Number(field('status'));
    const toolError = field('tool_error');
    if (status === 429) t.limited += calls;
    else if ((toolError !== undefined && toolError !== null && toolError !== '') || !(status >= 200 && status < 300)) t.failed += calls;
    const zero = field('zero_results');
    if (zero === true || zero === 'true') t.zero_results += calls;
    const family = String(field('ua') ?? 'none') || 'none';
    const c = t.clients.find((x) => x.family === family);
    if (c) c.calls += calls;
    else t.clients.push({ family, calls });
    tools.set(tool, t);
  }
  const order = [...KNOWN_TOOLS, 'unknown'] as string[];
  return {
    kind: 'documentation',
    page: `${CANONICAL_ORIGIN}${pageUrl(USAGE_ID)}`,
    period,
    collected_at: collectedAt,
    tools: [...tools.values()]
      .sort((x, y) => order.indexOf(x.tool) - order.indexOf(y.tool))
      .map((t) => ({ ...t, clients: t.clients.sort((x, y) => y.calls - x.calls || (x.family < y.family ? -1 : 1)) })),
    note: NOTE,
  };
}

/** usage.json for a period whose lines carry no `tool` key: no tool was called. */
export const usageWithoutCalls = (period: { from: string; to: string }, collectedAt: string): UsageData => ({
  kind: 'documentation',
  page: `${CANONICAL_ORIGIN}${pageUrl(USAGE_ID)}`,
  period,
  collected_at: collectedAt,
  tools: [],
  note: NO_TOOL_CALLS,
});

/** The data file before any collection. */
export const emptyUsage = (): UsageData => ({
  kind: 'documentation',
  page: `${CANONICAL_ORIGIN}${pageUrl(USAGE_ID)}`,
  period: null,
  collected_at: null,
  tools: [],
  note: NO_DEPLOYMENT,
});

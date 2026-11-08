// /docs/reference/server/docs-mcp-usage/ and its twin: the hosted docs MCP
// server's calls, refusals, failures and completion rate per tool and calls
// per client family, from
// src/content/docs/_data/usage.json (DOCS-PLAN.md §3.8 "Evals and metrics",
// §10 phase 2 "the per-tool usage dashboard"). The data file is written by
// scripts/docs-usage.ts from the Worker's log line (workers/docs-mcp/src/log.ts,
// ADR-0024), never by hand; before the server is deployed it holds no period
// and no tools, and the page says so.
//
// The page states what is counted, what is never counted (the log line holds
// no query text, no page asked for, no IP address and no full user agent:
// ADR-0013), how long Cloudflare keeps the lines, and the period. Its twin is
// the same table, row for row.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { DOCS_DIR } from '../content.ts';
import { pageUrl, type GeneratedPageMeta } from '../model.ts';
import { headingHtml, newest, twinHead, type GeneratedContext, type GeneratedPage, type Heading } from './page.ts';
import { inlineHtml, NONE, tableHtml, tableMarkdown, twinLinks, type Table } from './table.ts';

export const USAGE_FILE = join(DOCS_DIR, '_data/usage.json');
export const USAGE_ID = 'reference/server/docs-mcp-usage';
/** The tools the Worker logs by name (workers/docs-mcp/src/index.ts KNOWN_TOOLS); any other name is logged as `unknown`. */
export const KNOWN_TOOLS = ['search_docs', 'get_page', 'explain_error', 'validate_cypher', 'discover_capabilities'] as const;
/** The tools whose log line carries `zero_results` (workers/docs-mcp/src/server.ts). */
const ZERO_RESULT_TOOLS = new Set(['search_docs', 'explain_error', 'discover_capabilities']);
/** The note the data file carries until a deployment exists. */
export const NO_DEPLOYMENT = 'no deployment yet';

export interface ClientCount {
  /** The client family from workers/docs-mcp/src/log.ts `uaFamily`. */
  family: string;
  calls: number;
}

export interface ToolUsage {
  /** A tool name, or `unknown`. */
  tool: string;
  /** Requests whose log line names the tool, whatever their status. */
  calls: number;
  /** Of those, the ones answered with HTTP 429 by the per-tool cost budget (a per-IP refusal names no tool). */
  limited: number;
  /** Of those, the ones whose line has a `tool_error`, or whose status is outside 200-299 and not 429. */
  failed: number;
  /** Of those, the ones that matched nothing (search_docs, explain_error, discover_capabilities). */
  zero_results: number;
  clients: ClientCount[];
}

export interface UsageData {
  kind: 'documentation';
  /** The page this data is published on. */
  page: string;
  /** The period counted, RFC 3339 times; null before any collection. */
  period: { from: string; to: string } | null;
  /** When the counts were collected (RFC 3339); null before any collection. */
  collected_at: string | null;
  tools: ToolUsage[];
  note: string;
}

const PAGE = `${CANONICAL_ORIGIN}${pageUrl(USAGE_ID)}`;
const KEYS = new Set(['kind', 'page', 'period', 'collected_at', 'tools', 'note']);
const isTime = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));
const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;

/** What is wrong with usage data `raw` (empty when it is well formed). */
export function usageProblems(raw: Partial<UsageData>): string[] {
  const problems: string[] = [];
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) problems.push(`unknown key "${k}"`);
  if (raw.kind !== 'documentation') problems.push('"kind" is "documentation"');
  if (raw.page !== PAGE) problems.push(`"page" is ${PAGE}`);
  if (typeof raw.note !== 'string' || !raw.note.trim()) problems.push('"note" is a non-empty string');
  if (!Array.isArray(raw.tools)) return [...problems, '"tools" is a list'];
  if (raw.period === null || raw.period === undefined) {
    if (raw.period === undefined) problems.push('"period" is {from, to} or null');
    if (raw.collected_at !== null) problems.push('"collected_at" is null while "period" is null');
    if (raw.tools.length) problems.push('"tools" is empty while "period" is null');
  } else {
    if (!isTime(raw.period.from) || !isTime(raw.period.to) || Date.parse(raw.period.from) >= Date.parse(raw.period.to)) {
      problems.push('"period" is {from, to}, two RFC 3339 times, from before to');
    }
    if (!isTime(raw.collected_at)) problems.push('"collected_at" is an RFC 3339 time');
  }
  const seen = new Set<string>();
  raw.tools.forEach((t, i) => {
    const at = `tools[${i}] (${t.tool ?? '?'})`;
    if (typeof t.tool !== 'string' || !([...KNOWN_TOOLS, 'unknown'] as string[]).includes(t.tool)) problems.push(`${at}: "tool" is one of ${[...KNOWN_TOOLS, 'unknown'].join(', ')}`);
    else if (seen.has(t.tool)) problems.push(`${at}: listed twice`);
    seen.add(t.tool);
    for (const k of ['calls', 'limited', 'failed', 'zero_results'] as const) if (!isCount(t[k])) problems.push(`${at}: "${k}" is a count`);
    if (isCount(t.calls) && ((isCount(t.limited) && isCount(t.failed) && t.limited + t.failed > t.calls) || (isCount(t.zero_results) && t.zero_results > t.calls))) problems.push(`${at}: a part is larger than "calls"`);
    if (!Array.isArray(t.clients) || !t.clients.every((c) => typeof c.family === 'string' && c.family && isCount(c.calls))) problems.push(`${at}: "clients" is a list of {family, calls}`);
    else if (isCount(t.calls) && t.clients.reduce((n, c) => n + c.calls, 0) !== t.calls) problems.push(`${at}: the clients' calls do not add up to "calls"`);
  });
  return problems;
}

/** _data/usage.json, read now and checked; throws listing every problem. */
export function usageData(file = USAGE_FILE): UsageData {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<UsageData>;
  const problems = usageProblems(raw);
  if (problems.length) throw new Error(`${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return raw as UsageData;
}

const DOCS_MCP = '/docs/reference/server/docs-mcp';
const n = (x: number) => x.toLocaleString('en-US');

/** The period sentence. */
function periodText(d: UsageData): string {
  if (!d.period) return `No period is recorded (${d.note}): the server is not deployed, so no call has been counted and every count in the table is empty (${NONE}).`;
  return `From ${d.period.from} to ${d.period.to}, collected ${d.collected_at}. ${d.note}`;
}

/** The calls table: the five tools always, `unknown` when it was counted. */
export function usageTable(d: UsageData): Table {
  const byTool = new Map(d.tools.map((t) => [t.tool, t]));
  const names = [...KNOWN_TOOLS, ...(byTool.has('unknown') ? ['unknown'] : [])];
  return {
    columns: ['Tool', 'Calls', 'Refused by a limit', 'Failed', 'Completion rate', 'Zero results', 'Calls by client'],
    rows: names.map((name) => {
      const t = byTool.get(name);
      const clients = t ? [...t.clients].sort((a, b) => b.calls - a.calls || (a.family < b.family ? -1 : 1)) : [];
      // get_page and validate_cypher have no zero-result count; before any collection every count is empty.
      const zero = !ZERO_RESULT_TOOLS.has(name) || !d.period ? NONE : n(t?.zero_results ?? 0);
      // No calls, no rate.
      const rate = d.period && t && t.calls > 0 ? `${((100 * (t.calls - t.limited - t.failed)) / t.calls).toFixed(1)}%` : NONE;
      return {
        id: `tool-${name.replaceAll('_', '-')}`,
        cells: [
          [`\`${name}\``],
          [d.period ? n(t?.calls ?? 0) : NONE],
          [d.period ? n(t?.limited ?? 0) : NONE],
          [d.period ? n(t?.failed ?? 0) : NONE],
          [rate],
          [zero],
          [clients.length ? clients.map((c) => `\`${c.family}\` ${n(c.calls)}`).join(', ') : NONE],
        ],
      };
    }),
    notes: [],
  };
}

/** What each column counts, as a table. */
const COUNTED: Table = {
  columns: ['Column', 'Counted from the log line'],
  rows: [
    { id: 'counted-tool', cells: [['Tool'], ['The `tool` field: `search_docs`, `get_page`, `explain_error`, `validate_cypher` or `discover_capabilities`, and `unknown` for any other name a client sends. A request counts once, under one of the tools it called, so a JSON-RPC batch of several calls counts as one.']] },
    { id: 'counted-calls', cells: [['Calls'], ['Every request to `/mcp` whose line names a tool, whatever its status. A request refused by the per-IP limit is refused before its body is read, so its line names no tool and it is not counted here.']] },
    { id: 'counted-limited', cells: [['Refused by a limit'], ['Of those, the requests answered with HTTP 429 by the per-tool cost budget.']] },
    { id: 'counted-failed', cells: [['Failed'], ['Of those, the other requests whose line has a `tool_error` (the tool answered with an error) or whose HTTP status is outside 200–299.']] },
    { id: 'counted-completion', cells: [['Completion rate'], ['The share of calls that were neither refused by a limit nor failed, to one decimal place.']] },
    { id: 'counted-zero', cells: [['Zero results'], ['Of those, the `search_docs`, `explain_error` and `discover_capabilities` calls that matched nothing. `get_page` and `validate_cypher` have no such count.']] },
    { id: 'counted-client', cells: [['Calls by client'], ['The `ua` field: the client family from a fixed list of user-agent patterns, `other` for anything else and `none` for a request with no `User-Agent` header.']] },
  ],
  notes: ['Requests that call no tool (`initialize`, `tools/list`, resource reads and prompt fetches) are not in the table.'],
};

const NEVER = [
  'The query text, or any other argument of a call.',
  'The page or heading a call asked for.',
  'Error messages.',
  'IP addresses. The rate limiter keys its counters by address and never writes it to the log.',
  'The whole `User-Agent` string; only the family is kept.',
];

const NEVER_INTRO = `The log line never holds these, so no collection can count them ([What is logged](${DOCS_MCP}#what-is-logged) lists the line's fields):`;

const RETENTION =
  'The lines are kept in Workers Logs, Cloudflare\'s log store for Workers, which holds them for 3 days on the Workers Free plan and 7 days on Workers Paid (Cloudflare\'s documentation as of 2026-11-07). ' +
  'A collection therefore covers at most the last 7 days. It asks Cloudflare\'s Workers Observability query API for counts grouped by tool, client family, status, zero-result flag and tool error code; no single log line is copied out.';

const SEE_ALSO = [
  `[The hosted docs MCP server](${DOCS_MCP}): its tools, limits, threat model and the fields of the log line`,
  '[Privacy and telemetry](/docs/reference/privacy-and-telemetry): what the CLI, the site, and its hosts record',
];

const HEADINGS: Heading[] = [
  { depth: 2, slug: 'period', text: 'Period' },
  { depth: 2, slug: 'calls-per-tool', text: 'Calls per tool' },
  { depth: 2, slug: 'what-is-counted', text: 'What is counted' },
  { depth: 2, slug: 'what-is-never-counted', text: 'What is never counted' },
  { depth: 2, slug: 'retention-and-collection', text: 'Retention and collection' },
  { depth: 2, slug: 'see-also', text: 'See also' },
];

const intro = () =>
  `Each row counts the requests to [the hosted docs MCP server](${DOCS_MCP}) that called one tool, over the period stated, from the one line the server logs per request.`;

/** The page, rendered from usage data `d` (tests pass their own). */
export function renderUsage(meta: GeneratedPageMeta, ctx: GeneratedContext, d: UsageData, updated: string) {
  const calls = usageTable(d);
  const h = (slug: string) => headingHtml(HEADINGS.find((x) => x.slug === slug)!);
  const p = (s: string) => `<p>${inlineHtml(s, ctx.pages)}</p>`;
  const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${inlineHtml(i, ctx.pages)}</li>`).join('')}</ul>`;
  const html = [
    p(intro()),
    h('period'),
    p(periodText(d)),
    h('calls-per-tool'),
    tableHtml(calls, ctx.pages, { table: 'ref-table', anchor: 'ref-anchor' }),
    h('what-is-counted'),
    tableHtml(COUNTED, ctx.pages, { table: 'ref-table', anchor: 'ref-anchor' }),
    h('what-is-never-counted'),
    p(NEVER_INTRO),
    ul(NEVER),
    h('retention-and-collection'),
    p(RETENTION),
    h('see-also'),
    ul(SEE_ALSO),
  ].join('\n');
  const md = (s: string) => twinLinks(s, ctx.pages);
  const body = [
    md(intro()),
    '## Period',
    periodText(d),
    '## Calls per tool',
    tableMarkdown(calls, ctx.pages),
    '## What is counted',
    tableMarkdown(COUNTED, ctx.pages),
    '## What is never counted',
    md(NEVER_INTRO),
    NEVER.map((x) => `- ${md(x)}`).join('\n'),
    '## Retention and collection',
    RETENTION,
    '## See also',
    SEE_ALSO.map((x) => `- ${md(x)}`).join('\n'),
  ];
  const anchors = new Set<string>([...HEADINGS.map((x) => x.slug), ...calls.rows.map((r) => r.id), ...COUNTED.rows.map((r) => r.id)]);
  return { html, headings: HEADINGS, markdown: `${[twinHead(meta, ctx, updated), ...body].join('\n\n')}\n`, anchors };
}

/** The generated page for `meta` (model.ts GENERATED_PAGES' entry for USAGE_ID). */
export const usagePage = (meta: GeneratedPageMeta): GeneratedPage => ({
  meta,
  sources: () => [USAGE_FILE],
  render: (ctx) => renderUsage(meta, ctx, usageData(), newest([USAGE_FILE])),
});

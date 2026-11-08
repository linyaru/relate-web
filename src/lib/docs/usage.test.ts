// Unit tests for the hosted docs MCP usage data (npm run docs:test): the data
// file's check, the Cloudflare requests and the reading of their answers
// (src/lib/docs/generated/usage-pull.ts), and the generated page
// /docs/reference/server/docs-mcp-usage/ (src/lib/docs/generated/usage.ts).
// No network: the answers are built here in the shape the API reference gives.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENERATED, generatedContext } from './generated/index.ts';
import { GROUP_LIMIT, NO_TOOL_CALLS, emptyUsage, keysIn, keysProblems, queryBody, queryUrl, usageFromAnswer, usageWithoutCalls } from './generated/usage-pull.ts';
import { NO_DEPLOYMENT, USAGE_ID, renderUsage, usageData, usageProblems, usageTable, type UsageData } from './generated/usage.ts';
import { GENERATED_PAGES, type GeneratedPageMeta } from './model.ts';

const ctx = generatedContext();
const META: GeneratedPageMeta = GENERATED_PAGES.find((p) => p.id === USAGE_ID) ?? {
  id: USAGE_ID,
  title: 'Hosted docs MCP usage',
  description: 'Calls, refusals, failures and completion rate per tool of the hosted docs MCP server, calls by client family, the period counted, and what is never logged.',
  order: 20,
  surfaces: ['mcp', 'agents'],
};

/** The imperative openings docs:check flags in a reference twin (as generated.test.ts), outside fences, headings and tables. */
const IMPERATIVE = /^(?:run|install|copy|use|read|open|add|pass|call|paste|execute|download|remove|delete|edit|replace|configure|enable|disable|click|tell|ask|create|write|try|ignore|disregard|forget|do not|don't)\b/i;
const imperatives = (md: string) =>
  md
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('|'))
    .map((l) => l.replace(/^[-*>]\s+/, ''))
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .filter((s) => !s.startsWith('[') && IMPERATIVE.test(s.replace(/^[^A-Za-z]+/, '')) && s.split(/\s+/).length >= 3);

const answer = (aggregates: unknown[]) => ({ success: true, errors: [], messages: [], result: { calculations: [{ calculation: 'count', alias: 'calls', aggregates, series: [] }] } });
const agg = (value: number, groups: Record<string, string | number | boolean>) => ({ value, count: value, groups: Object.entries(groups).map(([key, v]) => ({ key, value: v })) });
const PERIOD = { from: '2026-11-01T00:00:00.000Z', to: '2026-11-08T00:00:00.000Z' };

test('the committed usage data: no deployment yet, no period, no tools', () => {
  const d = usageData();
  assert.deepEqual(d, emptyUsage());
  assert.equal(d.note, NO_DEPLOYMENT);
  assert.equal(d.period, null);
});

test('usageProblems: names each problem', () => {
  assert.deepEqual(usageProblems(emptyUsage()), []);
  const p = usageProblems({ ...emptyUsage(), kind: 'x' as 'documentation', tools: [{ tool: 'search_docs', calls: 1, limited: 0, failed: 0, zero_results: 0, clients: [] }], extra: 1 } as unknown as UsageData).join('\n');
  assert.match(p, /"kind" is "documentation"/);
  assert.match(p, /"tools" is empty while "period" is null/);
  assert.match(p, /unknown key "extra"/);
  const q = usageProblems({ ...emptyUsage(), period: PERIOD, collected_at: '2026-11-08T01:00:00Z', tools: [{ tool: 'search_docs', calls: 2, limited: 1, failed: 2, zero_results: 0, clients: [{ family: 'cursor', calls: 1 }] }] }).join('\n');
  assert.match(q, /a part is larger than "calls"/);
  assert.match(q, /do not add up/);
  const r = usageProblems({ ...emptyUsage(), period: PERIOD, collected_at: '2026-11-08T01:00:00Z', tools: [{ tool: 'get_page', calls: 1, limited: 0, zero_results: 0, clients: [{ family: 'cursor', calls: 1 }] } as unknown as UsageData['tools'][number]] }).join('\n');
  assert.match(r, /"failed" is a count/);
  const none = usageWithoutCalls(PERIOD, '2026-11-08T01:00:00.000Z');
  assert.deepEqual(usageProblems(none), []);
  assert.equal(none.note, NO_TOOL_CALLS);
});

test('queryBody: the calculations view, a count grouped by the log line fields, the docs MCP lines only', () => {
  type Body = { view: string; timeframe: unknown; parameters: { calculations: unknown[]; groupBys: { value: string }[]; filters: { key: string; value: string }[]; limit: number } };
  const b = queryBody(1000, 2000) as Body;
  assert.equal(b.view, 'calculations');
  assert.deepEqual(b.timeframe, { from: 1000, to: 2000 });
  assert.deepEqual(b.parameters.calculations, [{ operator: 'count', alias: 'calls' }]);
  // zero_results and tool_error only when the period's lines carry them.
  assert.deepEqual(b.parameters.groupBys.map((g) => g.value), ['tool', 'ua', 'status']);
  const all = queryBody(1000, 2000, new Set(['tool', 'zero_results', 'tool_error'])) as Body;
  assert.deepEqual(all.parameters.groupBys.map((g) => g.value), ['tool', 'ua', 'status', 'zero_results', 'tool_error']);
  assert.deepEqual(b.parameters.filters.map((f) => [f.key, f.value]), [['evt', 'docs-mcp'], ['path', '/mcp']]);
  assert.equal(b.parameters.limit, GROUP_LIMIT);
  assert.equal(queryUrl('abc'), 'https://api.cloudflare.com/client/v4/accounts/abc/workers/observability/telemetry/query');
  assert.ok(!JSON.stringify(b).includes('query_text'));
});

test('keysProblems: fails closed when the fields are not extracted; no tool call is not a problem', () => {
  const keys = (...k: string[]) => ({ success: true, result: k.map((key) => ({ key, type: 'string', lastSeenAt: 1 })) });
  assert.deepEqual(keysProblems({ success: true, result: [] }), []);
  assert.deepEqual(keysProblems(keys('evt', 'path', 'tool', 'ua', 'status', 'ms')), []);
  // Only initialize and tools/list in the period: no `tool` key, and no problem.
  assert.deepEqual(keysProblems(keys('evt', 'path', 'ua', 'status', 'rpc')), []);
  assert.deepEqual([...keysIn(keys('evt', 'path', 'ua', 'status'))], ['evt', 'path', 'ua', 'status']);
  assert.match(keysProblems({ success: true, result: [{ key: '$metadata.message', type: 'string', lastSeenAt: 1 }] })[0], /no key evt, path, ua, status/);
  assert.match(keysProblems({ success: false, errors: [{ message: 'Authentication error' }] })[0], /Authentication error/);
});

test('usageFromAnswer: calls, 429s, failures and zero results per tool, clients per tool, unknown names folded', () => {
  const d = usageFromAnswer(
    answer([
      agg(5, { tool: 'search_docs', ua: 'claude-code', zero_results: false, status: 200 }),
      agg(2, { tool: 'search_docs', ua: 'claude-code', zero_results: true, status: 200 }),
      agg(1, { tool: 'search_docs', ua: 'cursor', status: 429 }),
      agg(1, { tool: 'search_docs', ua: 'cursor', status: 200, tool_error: 'engine_unavailable' }),
      agg(4, { tool: 'get_page', ua: 'codex', status: 200 }),
      agg(2, { tool: 'get_page', ua: 'codex', status: 500 }),
      agg(1, { tool: 'query_docs_graph', ua: 'other', status: 200 }),
      agg(9, { ua: 'claude-code', status: 200 }),
    ]),
    PERIOD,
    '2026-11-08T01:00:00.000Z',
  );
  assert.deepEqual(usageProblems(d), []);
  assert.deepEqual(d.tools, [
    { tool: 'search_docs', calls: 9, limited: 1, failed: 1, zero_results: 2, clients: [{ family: 'claude-code', calls: 7 }, { family: 'cursor', calls: 2 }] },
    { tool: 'get_page', calls: 6, limited: 0, failed: 2, zero_results: 0, clients: [{ family: 'codex', calls: 6 }] },
    { tool: 'unknown', calls: 1, limited: 0, failed: 0, zero_results: 0, clients: [{ family: 'other', calls: 1 }] },
  ]);
  assert.throws(() => usageFromAnswer({ success: false, errors: [{ message: 'nope' }] }, PERIOD, PERIOD.to), /the query failed: .*nope/);
  assert.throws(() => usageFromAnswer({ success: true, result: {} }, PERIOD, PERIOD.to), /no result\.calculations/);
  assert.throws(() => usageFromAnswer(answer(Array.from({ length: GROUP_LIMIT }, () => agg(1, { tool: 'get_page' }))), PERIOD, PERIOD.to), /group/);
});

test('the usage page: says plainly there is no data yet, what is counted and never counted; twin is the table', () => {
  const r = renderUsage(META, ctx, emptyUsage(), '2026-11-07');
  assert.match(r.markdown, /No period is recorded \(no deployment yet\)/);
  assert.match(r.markdown, /\| Tool \| Calls \| Refused by a limit \| Failed \| Completion rate \| Zero results \| Calls by client \|/);
  assert.match(r.markdown, /\| `search_docs` \| — \| — \| — \| — \| — \| — \|/);
  assert.match(r.markdown, /every count in the table is empty \(—\)/);
  assert.match(r.markdown, /refused before its body is read, so its line names no tool/);
  assert.doesNotMatch(r.markdown, /first tool it calls|per-IP limit or the per-tool/);
  assert.match(r.markdown, /## What is never counted/);
  assert.match(r.markdown, /The query text/);
  assert.match(r.markdown, /IP addresses/);
  assert.match(r.markdown, /7 days on Workers Paid/);
  assert.deepEqual(imperatives(r.markdown), []);
  for (const h of r.headings) assert.ok(r.anchors.has(h.slug) && r.html.includes(` id="${h.slug}"`), h.slug);
  assert.ok(r.anchors.has('tool-search-docs'));
  assert.match(r.markdown, /\(https:\/\/relatedb\.ai\/docs\/reference\/server\/docs-mcp\/?#what-is-logged\)/);

  const d = usageFromAnswer(
    answer([
      agg(1234, { tool: 'search_docs', ua: 'claude-code', zero_results: true, status: 200 }),
      agg(10, { tool: 'search_docs', ua: 'claude-code', status: 429 }),
      agg(6, { tool: 'search_docs', ua: 'claude-code', status: 200, tool_error: 'search_failed' }),
    ]),
    PERIOD,
    '2026-11-08T01:00:00.000Z',
  );
  const full = renderUsage(META, ctx, d, '2026-11-08');
  assert.match(full.markdown, /From 2026-11-01T00:00:00\.000Z to 2026-11-08T00:00:00\.000Z, collected 2026-11-08T01:00:00\.000Z\./);
  assert.match(full.markdown, /\| `search_docs` \| 1,250 \| 10 \| 6 \| 98\.7% \| 1,234 \| `claude-code` 1,250 \|/);
  assert.match(full.markdown, /\| `get_page` \| 0 \| 0 \| 0 \| — \| — \| — \|/);
  assert.match(full.markdown, /\| `validate_cypher` \| 0 \| 0 \| 0 \| — \| — \| — \|/);
  assert.match(full.markdown, /\| `discover_capabilities` \| 0 \| 0 \| 0 \| — \| 0 \| — \|/);
  assert.equal(usageTable(d).rows.length, 5);
});

test('the usage page is registered exactly when model.ts lists it', () => {
  const listed = GENERATED_PAGES.some((p) => p.id === USAGE_ID);
  assert.equal(GENERATED.some((g) => g.meta.id === USAGE_ID), listed);
  if (listed) assert.equal(GENERATED.findIndex((g) => g.meta.id === USAGE_ID), GENERATED_PAGES.findIndex((p) => p.id === USAGE_ID));
});

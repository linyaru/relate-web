#!/usr/bin/env node
// docs:usage (DOCS-PLAN.md §3.8 "Evals and metrics", §10 phase 2 "the
// per-tool usage dashboard"): collects the hosted docs MCP server's calls per
// tool and per client family from the Worker's log line
// (workers/docs-mcp/src/log.ts) through Cloudflare's Workers Observability
// telemetry API, and writes src/content/docs/_data/usage.json, which the
// generated page /docs/reference/server/docs-mcp-usage/ renders. Review the
// diff and commit it; nothing publishes it automatically.
//
//   node scripts/docs-usage.ts                 collect the last 7 days (npm run docs:usage)
//   node scripts/docs-usage.ts --days 3        a shorter period (1 to 7)
//   node scripts/docs-usage.ts --print-query   print the two requests it would send and exit; needs no credential
//   node scripts/docs-usage.ts --out <file>    write there instead of _data/usage.json
//
// Needs CLOUDFLARE_API_TOKEN (an API token with the "Workers Observability
// Write" permission, which the query method's reference names) and
// CLOUDFLARE_ACCOUNT_ID. Without either it prints "skipped" with the reason
// and exits 0: no account exists before launch (LAUNCH.md). The endpoints,
// the request bodies and how the answer is read are in
// src/lib/docs/generated/usage-pull.ts, with the Cloudflare pages they come
// from.
//
// Fails closed (exit 1, printing what came back): an HTTP error, an answer
// with success false, log lines that lack a field every docs MCP line
// carries (the keys request runs first; a period with no tool call has no
// `tool` key and is written with no tool listed, not refused), an answer at
// the group limit, or a result that does not pass the data file's own check
// (src/lib/docs/generated/usage.ts).

import { writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { ROOT } from '../src/lib/docs/content.ts';
import { keysBody, keysIn, keysProblems, keysUrl, MAX_DAYS, queryBody, queryUrl, usageFromAnswer, usageWithoutCalls } from '../src/lib/docs/generated/usage-pull.ts';
import { USAGE_FILE, usageProblems } from '../src/lib/docs/generated/usage.ts';

const { values: args } = parseArgs({
  options: {
    days: { type: 'string', default: String(MAX_DAYS) },
    'print-query': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const fail = (s: string): never => {
  process.stderr.write(`docs:usage: ${s}\n`);
  process.exit(1);
};

const days = Number(args.days);
if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) fail(`--days is a whole number from 1 to ${MAX_DAYS} (Workers Logs keeps lines at most ${MAX_DAYS} days)`);
const to = Date.now();
const from = to - days * 86_400_000;

if (args['print-query']) {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID;
  const url = (f: (a: string) => string) => (id ? f(id) : f('ACCOUNT').replace('ACCOUNT', '<account_id>'));
  console.log(`POST ${url(keysUrl)}\n${JSON.stringify(keysBody(from, to), null, 2)}\n`);
  // The query as sent when the keys answer lists every optional key.
  console.log(`POST ${url(queryUrl)}\n${JSON.stringify(queryBody(from, to, new Set(['zero_results', 'tool_error'])), null, 2)}`);
  process.exit(0);
}

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  const missing = [!token && 'CLOUDFLARE_API_TOKEN', !account && 'CLOUDFLARE_ACCOUNT_ID'].filter(Boolean).join(' and ');
  console.log(`docs:usage: skipped (${missing} not set: collecting needs the Cloudflare account that runs the docs MCP Worker; --print-query shows the requests)`);
  process.exit(0);
}

async function post(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) fail(`POST ${url}: HTTP ${res.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return fail(`POST ${url}: not JSON: ${text.slice(0, 500)}`);
  }
}

const keysAnswer = await post(keysUrl(account), keysBody(from, to));
const keyProblems = keysProblems(keysAnswer);
if (keyProblems.length) fail(keyProblems.join('\n'));
const keys = keysIn(keysAnswer);

const period = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
let data;
try {
  data = keys.has('tool')
    ? usageFromAnswer(await post(queryUrl(account), queryBody(from, to, keys)), period, new Date().toISOString())
    : usageWithoutCalls(period, new Date().toISOString());
} catch (e) {
  fail((e as Error).message);
}
const problems = usageProblems(data!);
if (problems.length) fail(`the collected data does not pass its check:\n${problems.map((p) => `  - ${p}`).join('\n')}`);

const out = args.out ? resolve(args.out) : USAGE_FILE;
writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
const calls = data!.tools.reduce((n, t) => n + t.calls, 0);
console.log(`docs:usage: ${calls} tool call(s) from ${period.from} to ${period.to}; wrote ${relative(ROOT, out) || out}`);

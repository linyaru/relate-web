#!/usr/bin/env node
// The cold-start spike (DOCS-PLAN.md §3.7, deferred from phase 0): how long
// a cold isolate takes to answer, measured against `wrangler dev` (workerd)
// on this machine. Runs on Node directly, after `npm run bundle`:
//
//   npm run coldstart [-- --runs 5 --port 8787]
//
// Each run starts a fresh `wrangler dev` (a fresh workerd process, so a cold
// isolate with nothing initialized) and, from the client, times:
//   a) the first tools/list
//   b) the first search_docs after it (WASM instantiation + seed replay + one search)
//   c) ten warm search_docs calls (median and max)
// then, on another fresh start, b') search_docs as the very first request.
// It also reads /healthz for the Worker's own measure of the initialization.
// Every run uses its own CF-Connecting-IP so the local rate limiter does not
// interfere (in production Cloudflare sets that header; a client cannot).

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { runs: { type: 'string', default: '5' }, port: { type: 'string', default: '8787' } } });
const RUNS = Number(args.runs);
const PORT = Number(args.port);
const URL_ = `http://127.0.0.1:${PORT}`;

async function start(): Promise<{ child: ChildProcess; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'docs-mcp-coldstart-'));
  const child = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir], {
    cwd: PKG,
    env: { ...process.env, DO_NOT_TRACK: '1', WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('wrangler dev did not start in 60 s')), 60_000);
    const onData = (b: Buffer) => {
      if (b.toString().includes('Ready on')) {
        clearTimeout(timer);
        ok();
      }
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('exit', (code) => fail(new Error(`wrangler dev exited ${code}`)));
  });
  return { child, dir };
}

async function stop(s: { child: ChildProcess; dir: string }) {
  const done = new Promise((ok) => s.child.on('exit', ok));
  s.child.kill('SIGINT');
  await Promise.race([done, new Promise((ok) => setTimeout(ok, 5000))]);
  if (s.child.exitCode === null) s.child.kill('SIGKILL');
  rmSync(s.dir, { recursive: true, force: true });
}

async function rpc(ip: string, method: string, params?: unknown): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(`${URL_}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  if (res.status !== 200 || !text.includes('"result"') || text.includes('"isError":true')) throw new Error(`${method}: HTTP ${res.status}: ${text.slice(0, 200)}`);
  return ms;
}
const search = (ip: string, query: string) => rpc(ip, 'tools/call', { name: 'search_docs', arguments: { query } });
const QUERIES = ['exit code', 'read-only open', 'vector index', 'install the skill', 'durability mode', 'parameter missing', 'backup', 'agent mode row cap', 'MERGE', 'storage locked'];

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const fmt = (n: number) => `${n.toFixed(0)} ms`;

async function main() {
  const a: number[] = [], b: number[] = [], b1: number[] = [], c: number[] = [], cMax: number[] = [], init: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    let s = await start();
    const ip = `10.77.${r}.1`;
    try {
      a.push(await rpc(ip, 'tools/list'));
      b.push(await search(ip, 'exit code'));
      const warm: number[] = [];
      for (const q of QUERIES) warm.push(await search(ip, q));
      c.push(median(warm));
      cMax.push(Math.max(...warm));
      const h = (await (await fetch(`${URL_}/healthz`, { headers: { 'CF-Connecting-IP': `10.78.${r}.1` } })).json()) as { init_ms: number };
      init.push(h.init_ms);
    } finally {
      await stop(s);
    }
    s = await start();
    try {
      b1.push(await search(`10.79.${r}.1`, 'exit code'));
    } finally {
      await stop(s);
    }
    console.log(`run ${r + 1}: a) ${fmt(a[r])}  b) ${fmt(b[r])}  c) median ${fmt(c[r])}, max ${fmt(cMax[r])}  b') ${fmt(b1[r])}  init_ms ${init[r]}`);
  }
  console.log(`\nmedian of ${RUNS} runs:`);
  console.log(`  a)  first tools/list on a cold isolate:          ${fmt(median(a))} (min ${fmt(Math.min(...a))}, max ${fmt(Math.max(...a))})`);
  console.log(`  b)  first search_docs, after tools/list:          ${fmt(median(b))} (min ${fmt(Math.min(...b))}, max ${fmt(Math.max(...b))})`);
  console.log(`  b') search_docs as the first request:             ${fmt(median(b1))} (min ${fmt(Math.min(...b1))}, max ${fmt(Math.max(...b1))})`);
  console.log(`  c)  warm search_docs, median of 10 per run:       ${fmt(median(c))} (max seen ${fmt(Math.max(...cMax))})`);
  console.log(`  engine init (WASM + seed replay) per /healthz:    ${median(init)} ms (min ${Math.min(...init)}, max ${Math.max(...init)})`);
}

main().catch((err) => {
  console.error(`coldstart: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

#!/usr/bin/env node
// Builds the docs graph's store forms from its seed script (ADR-0015: the
// seed is the artifact; the WASM cannot write a bundle, so the native CLI
// does). Runs on Node directly, like scripts/docs.ts.
//
//   node scripts/docs-graph.ts [--out <dir>]          (npm run docs:graph)
//
// Always: generates the seed (src/lib/docs/graph.ts), prints its size in
// bytes and lines, replays it on the WASM in public/wasm and prints the
// time, and, when the build has written <out>/graph.cypher, checks that the
// built seed is byte for byte the one generated here.
//
// With RELATE_BIN set to a relate binary: replays the seed through it
// (`relate query --database <tmp>/relate-docs.rl`, the script on stdin) and
// writes
//   <out>/relate-docs.rl          the store `relate --load` opens
//   <out>/relate-docs.rl.sha256   its SHA-256, as `sha256sum` prints it
//   <out>/relate-docs.json        the JSON codec's graph.json, for diffing
// then opens the .rl with `relate --load` and checks its node and
// relationship counts against the graph, and prints the SHA-256 and size of
// each file for the docs-artifacts manifest. DO_NOT_TRACK defaults to 1 for
// the child process. Without RELATE_BIN it says so and exits 0.
//
// <out> defaults to dist/docs. Exits 1 when the seed fails on either engine,
// the counts disagree, or the built seed differs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { loadWasmSync } from '../src/lib/docs/checks/graph.ts';
import { ROOT } from '../src/lib/docs/content.ts';
import { docsGraph, FULLTEXT_INDEX, seedScript } from '../src/lib/docs/graph.ts';

const { values: args } = parseArgs({ options: { out: { type: 'string', default: join(ROOT, 'dist/docs') } } });
const OUT = resolve(args.out!);
const rel = (p: string) => relative(process.cwd(), p) || '.';
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const kib = (n: number) => `${n} bytes (${(n / 1024).toFixed(1)} KiB)`;

function fail(message: string): never {
  console.error(`docs:graph: ${message}`);
  process.exit(1);
}

function main(): number {
  const graph = docsGraph();
  const seed = seedScript(graph);
  const seedBytes = Buffer.byteLength(seed);
  console.log(`seed script: ${kib(seedBytes)}, ${seed.split('\n').length - 1} lines; ${graph.nodes.length} nodes, ${graph.rels.length} relationships`);
  if (graph.problems.length) console.warn(`  pages read from the raw source (the twin renderer refused them; docs:check says why):\n${graph.problems.map((p) => `    ${p}`).join('\n')}`);

  const built = join(OUT, 'graph.cypher');
  if (existsSync(built) && readFileSync(built, 'utf8') !== seed) {
    fail(`${rel(built)} differs from the seed generated now; rebuild the site, or the build and this script read different sources`);
  }

  // The WASM replay: the cost a Worker pays on each cold isolate (ADR-0015).
  const wasm = loadWasmSync();
  const db = new wasm.RelateDb();
  try {
    const t0 = performance.now();
    const envelopes = db.executeScript(seed, null);
    const ms = performance.now() - t0;
    const failed = envelopes.map((e) => JSON.parse(e) as { error: string | null }).find((e) => e.error);
    if (failed) fail(`the seed fails on public/wasm: ${failed.error}`);
    console.log(`WASM replay (public/wasm): ${ms.toFixed(1)} ms for ${envelopes.length} statements`);
  } finally {
    db.free();
  }

  const bin = process.env.RELATE_BIN;
  if (!bin) {
    console.log('RELATE_BIN is not set: no relate binary to build relate-docs.rl with; skipped (set RELATE_BIN=<path to relate> to build it)');
    return 0;
  }
  if (!existsSync(bin)) fail(`RELATE_BIN=${bin} does not exist`);
  const env = { ...process.env, DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? '1' };
  const run = (argv: string[], input?: string) => {
    const r = spawnSync(bin, argv, { input, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.error) fail(`${bin} ${argv.join(' ')}: ${r.error.message}`);
    if (r.status !== 0) fail(`${bin} ${argv.slice(0, 3).join(' ')} … exited ${r.status}: ${(r.stderr || r.stdout).trim().split('\n').slice(-5).join(' / ')}`);
    return r.stdout;
  };

  const version = run(['--version']).split('\n')[0].trim();
  const want = `Relate v${graph.engine.version}`;
  if (version !== want) console.warn(`warning: ${bin} prints "${version}"; _data/engine.json says ${graph.engine.version}`);

  const tmp = mkdtempSync(join(tmpdir(), 'relate-docs-graph-'));
  try {
    const rl = join(tmp, 'relate-docs.rl');
    const t0 = performance.now();
    run(['query', '--database', rl], seed);
    const nativeMs = performance.now() - t0;

    // The JSON codec store: a directory whose graph.json holds the whole graph.
    const jsonStore = join(tmp, 'json');
    run(['query', '--database', jsonStore, '--snapshot-format', 'json'], seed);

    // Open it the way an agent will, and check the counts.
    const count = (cypher: string) => {
      const out = run(['--load', rl, '--mode', 'jsonl', cypher]).trim().split('\n').filter(Boolean);
      return JSON.parse(out[out.length - 1]) as Record<string, number | string>;
    };
    const nodes = Number(count('MATCH (n) RETURN count(n) AS n').n);
    const rels = Number(count('MATCH ()-[r]->() RETURN count(r) AS n').n);
    if (nodes !== graph.nodes.length || rels !== graph.rels.length) {
      fail(`relate-docs.rl holds ${nodes} nodes and ${rels} relationships; the graph has ${graph.nodes.length} and ${graph.rels.length}`);
    }
    const hit = count(`MATCH (s:Section) SEARCH s IN (FULLTEXT INDEX ${FULLTEXT_INDEX} FOR 'exit code' LIMIT 1) RETURN s.id AS id`);

    mkdirSync(OUT, { recursive: true });
    const outRl = join(OUT, 'relate-docs.rl');
    const outJson = join(OUT, 'relate-docs.json');
    copyFileSync(rl, outRl);
    copyFileSync(join(jsonStore, 'graph.json'), outJson);
    // The CLI creates its files owner-only; these are published.
    for (const f of [outRl, outJson]) chmodSync(f, 0o644);
    const rlBytes = readFileSync(outRl);
    const rlSha = sha256(rlBytes);
    writeFileSync(join(OUT, 'relate-docs.rl.sha256'), `${rlSha}  relate-docs.rl\n`);
    const jsonBytes = readFileSync(outJson);

    console.log(`native replay (${version}): ${nativeMs.toFixed(0)} ms, process start included`);
    console.log(`  ${rel(outRl)}: ${kib(statSync(outRl).size)}, sha256 ${rlSha}`);
    console.log(`  ${rel(join(OUT, 'relate-docs.rl.sha256'))}: written`);
    console.log(`  ${rel(outJson)}: ${kib(jsonBytes.length)}, sha256 ${sha256(jsonBytes)}`);
    console.log(`  checked with relate --load: ${nodes} nodes, ${rels} relationships; full-text index \`${FULLTEXT_INDEX}\` answers 'exit code' with ${hit.id ?? 'nothing'}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return 0;
}

process.exit(main());

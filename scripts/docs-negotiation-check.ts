#!/usr/bin/env node
// Checks the docs content negotiation (functions/docs/_middleware.ts, the
// Cloudflare Pages Function; ADR-0005, ADR-0012) against a built site. Runs
// on Node directly, like scripts/docs.ts.
//
//   node scripts/docs-negotiation-check.ts [--dist <dir>]   (npm run docs:negotiation-check)
//
// Starts `wrangler pages dev <dist>` (workerd, local only, no login) on a
// free port, from a scratch directory that links back to functions/, so
// wrangler's state never lands in the repo; then, for the landing page,
// get-started/install and reference/errors:
//   - Accept: text/markdown (and markdown ranked above HTML by q) returns the
//     twin byte for byte, with Content-Type text/markdown; charset=utf-8,
//     Vary: Accept, Cache-Control: private and x-markdown-tokens;
//   - HEAD returns the same headers and no body;
//   - ?section=<anchor> returns that section, byte for byte what
//     src/lib/docs/negotiation.ts slices from the twin, with the frontmatter,
//     at most five terms and the full-page trailer; other query parameters
//     change nothing;
//   - a browser's Accept, with or without ?section=, gets the HTML file byte
//     for byte, and the .md twin URL is served untouched;
// plus an unknown anchor (404, text/plain, the anchors listed), URLs that
// are not pages (a missing page, files at a twin's path that are not that
// page's twin, percent-encoded traversal) never answered with markdown, the
// skill and llms.txt files and the largest data block a twin links
// (/docs/<page>/data/<name>.json, application/json) served untouched through the agent-path log
// (functions/_middleware.ts), and a path outside /docs. Without the server
// it also checks that every heading and glossary entry id on every built
// docs page resolves as a ?section= anchor (the layout's "Related" list and
// the landing page, whose twin is a different document, are reported, not
// failed).
//
// wrangler is fetched by npx at the pinned WRANGLER version (override with
// WRANGLER_VERSION), the version workers/docs-mcp pins, so one wrangler
// serves both checks and the deploy; nothing is installed in the repo. Prints "skipped" and
// exits 0 when <dist>/docs is missing. Exits 1 on any mismatch.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { estimateTokens, sectionAnchors, sliceSection, TERMS_HEADING } from '../src/lib/docs/negotiation.ts';

const ROOT = resolve(import.meta.dirname, '..');
const WRANGLER = `wrangler@${process.env.WRANGLER_VERSION ?? '4.158.0'}`;
const COMPATIBILITY_DATE = '2026-10-01';
const READY_TIMEOUT_MS = 180_000;

const { values: args } = parseArgs({ options: { dist: { type: 'string', default: join(ROOT, 'dist') } } });
const DIST = resolve(args.dist!);

const MARKDOWN = 'text/markdown';
const RANKED = 'text/html;q=0.9, text/markdown';
const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const MD_TYPE = 'text/markdown; charset=utf-8';

/** The pages the server cases run on, and the section each one is cut to. */
const PAGES: { id: string; section: string | null }[] = [
  { id: '', section: null }, // the landing: its first anchor
  { id: 'get-started/install', section: 'verify' },
  { id: 'reference/errors', section: 'cli-errors' },
];
/** Heading ids the layout adds that the twin has no section for (its `related` is frontmatter). */
const LAYOUT_IDS = new Set(['related']);
/** Pages whose twin is a different document from the HTML (src/lib/docs/landing.ts). */
const OWN_TWIN = new Set(['']);

let failures = 0;
function ok(name: string): void {
  console.log(`  ok    ${name}`);
}
function bad(name: string, why: string): void {
  failures++;
  console.log(`  FAIL  ${name}: ${why}`);
}
function expect(name: string, problems: string[]): void {
  if (problems.length) bad(name, problems.join('; '));
  else ok(name);
}

const twinFile = (id: string) => join(DIST, 'docs', id ? `${id}.md` : 'index.md');
const htmlFile = (id: string) => join(DIST, 'docs', id, 'index.html');
const pageUrl = (id: string) => (id ? `/docs/${id}/` : '/docs/');

function sameBytes(a: Uint8Array, b: Uint8Array): string | null {
  if (a.byteLength !== b.byteLength) return `${a.byteLength} bytes, expected ${b.byteLength}`;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return `bytes differ at offset ${i}`;
  return null;
}

function headerProblems(res: Response, body: string, status = 200): string[] {
  const p: string[] = [];
  if (res.status !== status) p.push(`status ${res.status}`);
  const want: Record<string, string> = { 'content-type': MD_TYPE, vary: 'Accept', 'cache-control': 'private', 'x-markdown-tokens': String(estimateTokens(body)) };
  for (const [k, v] of Object.entries(want)) if (res.headers.get(k) !== v) p.push(`${k}: ${JSON.stringify(res.headers.get(k))}, expected ${JSON.stringify(v)}`);
  return p;
}

function freePort(): Promise<number> {
  return new Promise((done, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => done(port));
    });
  });
}

function stop(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM'); // npx, wrangler and workerd share the group
  } catch {
    child.kill('SIGTERM');
  }
}

async function startServer(port: number, scratch: string): Promise<{ child: ChildProcess; base: string; log: () => string }> {
  const cwd = join(scratch, 'cwd');
  // wrangler compiles <cwd>/functions and writes .wrangler/ in <cwd>: link functions/ into a scratch cwd.
  mkdirSync(cwd);
  symlinkSync(join(ROOT, 'functions'), join(cwd, 'functions'), 'dir');
  const argv = ['--yes', WRANGLER, 'pages', 'dev', DIST, '--ip', '127.0.0.1', '--port', String(port), '--compatibility-date', COMPATIBILITY_DATE, '--persist-to', join(scratch, 'state'), '--show-interactive-dev-session=false', '--log-level', 'warn'];
  let out = '';
  const child = spawn('npx', argv, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DO_NOT_TRACK: '1', WRANGLER_SEND_METRICS: 'false', CI: process.env.CI ?? '1' },
  });
  child.stdout!.on('data', (d) => (out += d));
  child.stderr!.on('data', (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`wrangler exited with ${child.exitCode}:\n${out}`);
    try {
      const res = await fetch(`${base}/robots.txt`);
      await res.arrayBuffer();
      return { child, base, log: () => out };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  stop(child);
  throw new Error(`wrangler did not answer within ${READY_TIMEOUT_MS / 1000}s:\n${out}`);
}

async function get(base: string, path: string, accept: string, method = 'GET'): Promise<{ res: Response; bytes: Uint8Array }> {
  const res = await fetch(`${base}${path}`, { method, headers: { accept }, redirect: 'manual' });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function serverCases(base: string): Promise<void> {
  const dec = new TextDecoder();
  for (const { id, section } of PAGES) {
    const label = id || '(landing)';
    console.log(`${label}`);
    const twinBytes = new Uint8Array(readFileSync(twinFile(id)));
    const twin = dec.decode(twinBytes);
    const html = readFileSync(htmlFile(id), 'utf8');
    const htmlBytes = new Uint8Array(readFileSync(htmlFile(id)));
    const url = pageUrl(id);

    for (const [name, accept] of [['Accept: text/markdown', MARKDOWN], [`Accept: ${RANKED}`, RANKED]] as const) {
      const { res, bytes } = await get(base, url, accept);
      const p = headerProblems(res, twin);
      const diff = sameBytes(bytes, twinBytes);
      if (diff) p.push(`body ${diff}`);
      expect(`GET ${url} with ${name} is the twin`, p);
    }

    {
      const { res, bytes } = await get(base, url, MARKDOWN, 'HEAD');
      const p = headerProblems(res, twin);
      if (bytes.byteLength) p.push(`HEAD returned ${bytes.byteLength} body bytes`);
      if (res.headers.get('content-length') !== String(twinBytes.byteLength)) p.push(`content-length ${res.headers.get('content-length')}, expected ${twinBytes.byteLength}`);
      expect(`HEAD ${url} with Accept: text/markdown`, p);
    }

    const anchor = section ?? sectionAnchors(twin, html)[0];
    const canonical = /^canonical_url:\s*(\S+)$/m.exec(twin)?.[1] ?? '';
    const twinUrl = `${new URL(canonical).origin}/docs/${id ? `${id}.md` : 'index.md'}`;
    const want = sliceSection(twin, anchor, { html, twinUrl });
    if (!want.ok) {
      bad(`?section=${anchor} on ${url}`, `the twin has no such anchor (${want.anchors.join(', ')})`);
    } else {
      for (const path of [`${url}?section=${encodeURIComponent(anchor)}`, `${url}?utm_source=x&section=${encodeURIComponent(anchor)}&expand=1`]) {
        const { res, bytes } = await get(base, path, MARKDOWN);
        const body = dec.decode(bytes);
        const p = headerProblems(res, body);
        const diff = sameBytes(bytes, new TextEncoder().encode(want.markdown));
        if (diff) p.push(`body ${diff} (against sliceSection)`);
        const front = /^---\n[\s\S]*?\n---\n/.exec(twin)?.[0] ?? '';
        if (!body.startsWith(front)) p.push('frontmatter not kept');
        if (!body.endsWith(`Full page: ${canonical} (markdown: ${twinUrl})\n`)) p.push('no full-page trailer');
        const terms = body.split(`\n## ${TERMS_HEADING}\n`)[1];
        if (terms && terms.split('\n').filter((l) => l.startsWith('- **')).length > 5) p.push('more than five terms');
        if (body.length >= twin.length) p.push('the section is not shorter than the page');
        expect(`GET ${path} with Accept: text/markdown is one section`, p);
      }
    }

    {
      const { res, bytes } = await get(base, url, BROWSER);
      const p: string[] = [];
      if (res.status !== 200) p.push(`status ${res.status}`);
      if (!res.headers.get('content-type')?.startsWith('text/html')) p.push(`content-type ${res.headers.get('content-type')}`);
      if (res.headers.has('x-markdown-tokens')) p.push('x-markdown-tokens on the HTML');
      if (!/(^|,)\s*accept\s*(,|$)/i.test(res.headers.get('vary') ?? '')) p.push(`vary ${JSON.stringify(res.headers.get('vary'))}, expected Accept`);
      const diff = sameBytes(bytes, htmlBytes);
      if (diff) p.push(`body ${diff}`);
      expect(`GET ${url} with a browser's Accept passes through to the HTML, with Vary: Accept`, p);
    }

    {
      const mdPath = id ? `/docs/${id}.md` : '/docs/index.md';
      const { res, bytes } = await get(base, mdPath, MARKDOWN);
      const p: string[] = [];
      if (res.status !== 200) p.push(`status ${res.status}`);
      if (res.headers.has('x-markdown-tokens')) p.push('the Function answered the .md URL');
      const diff = sameBytes(bytes, twinBytes);
      if (diff) p.push(`body ${diff}`);
      expect(`GET ${mdPath} is the static twin, untouched`, p);
    }
  }

  console.log('other cases');
  {
    const path = '/docs/reference/errors/?section=no-such-anchor';
    const { res, bytes } = await get(base, path, MARKDOWN);
    const body = dec.decode(bytes);
    const p: string[] = [];
    if (res.status !== 404) p.push(`status ${res.status}`);
    if (res.headers.get('content-type') !== 'text/plain; charset=utf-8') p.push(`content-type ${res.headers.get('content-type')}`);
    const anchors = sectionAnchors(readFileSync(twinFile('reference/errors'), 'utf8'), readFileSync(htmlFile('reference/errors'), 'utf8'));
    if (!body.includes(`Sections: ${anchors.join(', ')}\n`)) p.push(`body does not list the anchors: ${JSON.stringify(body)}`);
    expect(`GET ${path} with Accept: text/markdown is 404 listing the anchors`, p);
  }
  {
    const path = '/docs/reference/errors/?section=no-such-anchor';
    const { res, bytes } = await get(base, path, BROWSER);
    const p: string[] = [];
    if (res.status !== 200) p.push(`status ${res.status}`);
    const diff = sameBytes(bytes, new Uint8Array(readFileSync(htmlFile('reference/errors'))));
    if (diff) p.push(`body ${diff}`);
    expect(`GET ${path} with a browser's Accept passes through to the HTML`, p);
  }
  // Not pages: a missing page; files at a twin's path that are not that page's
  // twin (feedback.md, the changelog copy, the /index.md copy); and percent-encoded
  // traversal, which the asset server would decode into a path outside /docs.
  for (const path of ['/docs/no-such-page/', '/docs/feedback/', '/docs/changelog/', '/docs/get-started/install/index/', '/docs/%2E%2E%2Fskill/', '/docs/%2E%2E%2Fskills%2Frelate%2FSKILL/', '/docs/reference%2Ferrors/', '/docs/..%2Fx/']) {
    const { res } = await get(base, path, MARKDOWN);
    const p: string[] = [];
    if (res.status === 200 && !res.headers.get('content-type')?.startsWith('text/html')) p.push(`status 200, content-type ${res.headers.get('content-type')}`);
    if (res.headers.get('content-type')?.startsWith(MARKDOWN)) p.push('answered with markdown');
    if (res.headers.has('x-markdown-tokens')) p.push('the Function answered it');
    expect(`GET ${path} with Accept: text/markdown is not a markdown answer`, p);
  }
  {
    // The agent-path log (functions/_middleware.ts) leaves the static files untouched.
    for (const [path, file] of [['/skill.md', 'skill.md'], ['/skills/relate/SKILL.md', 'skills/relate/SKILL.md'], ['/llms.txt', 'llms.txt'], ['/docs/llms.txt', 'docs/llms.txt']] as const) {
      const { res, bytes } = await get(base, path, '*/*');
      const p: string[] = [];
      if (res.status !== 200) p.push(`status ${res.status}`);
      const diff = sameBytes(bytes, new Uint8Array(readFileSync(join(DIST, file))));
      if (diff) p.push(`body ${diff}`);
      expect(`GET ${path} is the static file, untouched`, p);
    }
  }
  {
    // A data block a twin links (ADR-0048): the static JSON file, byte for byte, whatever the Accept.
    const blocks = walkFiles(join(DIST, 'docs')).filter((f) => /\/data\/[A-Za-z0-9_-]+\.json$/.test(f));
    const file = blocks.sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (!file) expect('a docs data block is built', ['no file at /docs/<page>/data/<name>.json in dist/']);
    else {
      const path = `/${relative(DIST, file).split(sep).join('/')}`;
      for (const accept of [MARKDOWN, '*/*']) {
        const { res, bytes } = await get(base, path, accept);
        const p: string[] = [];
        if (res.status !== 200) p.push(`status ${res.status}`);
        if (!res.headers.get('content-type')?.startsWith('application/json')) p.push(`content-type ${res.headers.get('content-type')}`);
        if (res.headers.has('x-markdown-tokens')) p.push('the Function answered it');
        const diff = sameBytes(bytes, new Uint8Array(readFileSync(file)));
        if (diff) p.push(`body ${diff}`);
        expect(`GET ${path} with Accept: ${accept} is the static JSON file, untouched`, p);
      }
    }
  }
  {
    const { res, bytes } = await get(base, '/cookbook/', MARKDOWN);
    const p: string[] = [];
    if (res.status !== 200) p.push(`status ${res.status}`);
    if (res.headers.has('x-markdown-tokens')) p.push('the Function answered outside /docs');
    const diff = sameBytes(bytes, new Uint8Array(readFileSync(join(DIST, 'cookbook/index.html'))));
    if (diff) p.push(`body ${diff}`);
    expect('GET /cookbook/ with Accept: text/markdown is untouched', p);
  }
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const walkPages = (dir: string): string[] => walkFiles(dir).filter((p) => p.endsWith(`${sep}index.html`));

/**
 * Every heading id on every built docs page resolves as a ?section= anchor:
 * each H2 to H6 id, and each glossary entry's id (`<div class="glossary-entry"
 * id="…">`, an H3 in the twin). A table row's id (a CLI flag, an exit code)
 * is a fragment of its section, not a section, and is not checked.
 */
function anchorCoverage(): void {
  console.log('anchors (every built docs page, without the server)');
  const docs = join(DIST, 'docs');
  let pages = 0;
  let failed = 0;
  for (const file of walkPages(docs)) {
    const id = file.slice(docs.length + 1, -'index.html'.length).replace(/\/$/, '');
    if (!existsSync(twinFile(id))) continue; // not a docs page (no twin)
    pages++;
    const html = readFileSync(file, 'utf8');
    const twin = readFileSync(twinFile(id), 'utf8');
    const ids = [
      ...[...html.matchAll(/<h[2-6]\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/<div\b[^>]*\bclass="[^"]*\bglossary-entry\b[^"]*"[^>]*\bid="([^"]+)"/g)].map((m) => m[1]),
    ];
    const missing = ids.filter((a) => !LAYOUT_IDS.has(a) && !sliceSection(twin, a, { html }).ok);
    if (!missing.length) continue;
    if (OWN_TWIN.has(id)) console.log(`  note  ${pageUrl(id)}: its twin is its own document; HTML ids with no section: ${missing.join(', ')}`);
    else {
      failed++;
      bad(`${pageUrl(id)}`, `heading ids with no section in the twin: ${missing.join(', ')}`);
    }
  }
  if (!failed) ok(`${pages} pages: every heading and glossary entry id resolves (the layout's ${[...LAYOUT_IDS].join(', ')} aside)`);
}

async function main(): Promise<number> {
  if (!existsSync(join(DIST, 'docs'))) {
    console.log(`docs:negotiation-check: skipped (no ${join(DIST, 'docs')}; run npm run build first)`);
    return 0;
  }
  anchorCoverage();

  const scratch = mkdtempSync(join(tmpdir(), 'relate-negotiation-'));
  let child: ChildProcess | null = null;
  const cleanup = () => {
    stop(child);
    rmSync(scratch, { recursive: true, force: true });
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  try {
    const port = await freePort();
    console.log(`starting npx ${WRANGLER} pages dev on port ${port}`);
    const server = await startServer(port, scratch);
    child = server.child;
    try {
      await serverCases(server.base);
    } catch (e) {
      bad('server cases', `${(e as Error).message}\n${server.log()}`);
    }
  } catch (e) {
    bad('wrangler pages dev', (e as Error).message);
  } finally {
    cleanup();
  }
  console.log(failures ? `docs:negotiation-check: ${failures} failure(s)` : 'docs:negotiation-check: all cases pass');
  return failures ? 1 : 0;
}

process.exit(await main());

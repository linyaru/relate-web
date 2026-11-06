#!/usr/bin/env node
// Checks the cookbook's page runtime and the playground in a real browser:
// serves the built site (dist/, so run `npm run build` first) and drives
// headless Chrome.
//
// - Cookbook: every recipe page's "Run all" must finish every step live and
//   matching its recording; every graph result must draw; the controls (Run,
//   edited parameters, the JSON view, a failing edit and Revert, Reset, Stop)
//   are exercised on one recipe.
// - Playground (/playground/): the sample data loads and draws.
// - Hand-off (ADR-0134): every recipe opened whole in the playground
//   (#recipe=<slug>) replays all its steps; one step link with parameters
//   replays the steps before it and loads the step and its parameters.
// - Before any browser runs, the built files are checked: the playground is
//   built and bundles no engine of its own, each recipe's recipe.json is
//   format 1 and lists exactly its steps, and each step's playground link
//   names one of them.
//
// `npm run cookbook:check` runs the recipes in Node; this catches what only a
// browser shows: the bundled runtimes, the module workers, and the engine
// loaded from /wasm/.
//
//   node scripts/cookbook-browser.ts            (npm run cookbook:browser)
//
// Chrome comes from CHROME_PATH, else the usual install locations. Talks to
// Chrome over the DevTools protocol with Node's own WebSocket: no
// dependencies. COOKBOOK_ONLY=<slug>[,<slug>…] limits the recipes.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

import { COOKBOOK_DIR, loadRecipes, projectRoot } from '../src/lib/cookbook/load.ts';

const DIST = join(projectRoot(), 'dist');
const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
// The recipe the controls are exercised on, and the step to drive.
const CONTROLS_RECIPE = 'nearby-places';
// The step link the hand-off check opens: a step that takes parameters.
const HANDOFF_STEP = { slug: 'nearby-places', cell: 'within' };
const RUN_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fail(message: string): never {
  console.error(`cookbook-browser: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- static server

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** Serve dist/ on a free loopback port, as a static host would. */
function serve(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    let file = join(DIST, path);
    if (!file.startsWith(DIST)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    }),
  );
}

// ---------------------------------------------------------------- chrome

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: { result?: { value?: unknown }; exceptionDetails?: unknown };
}

async function launchChrome() {
  const binary = CHROMES.find((p) => p && existsSync(p));
  if (!binary) fail('no Chrome found; set CHROME_PATH');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    // A desktop-sized window: at Chrome's headless default (800x600) the
    // playground switches to its mobile layout, with the editor behind a tab.
    '--window-size=1400,900',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cookbook-chrome-'))}`,
    'about:blank',
  ];
  // CI runners restrict the user namespaces Chrome's sandbox needs.
  if (process.env.CI) args.unshift('--no-sandbox');
  const chrome = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  // Chrome prints the DevTools endpoint on stderr once it listens.
  const endpoint = await new Promise<string>((resolve, reject) => {
    let err = '';
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${err}`)), 30_000);
    chrome.stderr.on('data', (chunk: Buffer) => {
      err += chunk;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    chrome.on('exit', (code) => reject(new Error(`Chrome exited (${code}):\n${err}`)));
  });
  return { http: new URL(endpoint).origin.replace('ws:', 'http:'), kill: () => chrome.kill() };
}

/** Open `url` in a new tab; evaluate expressions there; collect console errors. */
async function openPage(http: string, url: string) {
  const target = (await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json()) as {
    id: string;
    webSocketDebuggerUrl: string;
  };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const waiting = new Map<number, (m: CdpMessage) => void>();
  const errors: string[] = [];
  let loaded = false;
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as CdpMessage;
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)!(msg);
      waiting.delete(msg.id);
    } else if (msg.method === 'Page.loadEventFired') {
      loaded = true;
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(msg.params).slice(0, 400));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      errors.push(JSON.stringify(msg.params.args).slice(0, 400));
    }
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<CdpMessage>((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  for (let i = 0; i < 200 && !loaded; i++) await sleep(50);
  if (!loaded) throw new Error(`${url} did not load`);
  return {
    errors,
    async evaluate<T>(expression: string): Promise<T> {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result?.result?.value as T;
    },
    async close() {
      ws.close();
      await fetch(`${http}/json/close/${target.id}`).then((r) => r.text());
    },
  };
}

// ---------------------------------------------------------------- scenarios
// Each runs in the page and returns `{log, failures}`.

/** Press "Run all"; every step must end live and match its recording. */
const RUN_ALL = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bar = document.getElementById('engineBar');
  if (!bar || bar.hidden) return { log: [], failures: ['the engine bar is not shown: the runtime did not start'] };
  const stop = bar.querySelector('[data-action=stop]');
  const t0 = performance.now();
  bar.querySelector('[data-action=run-all]').click();
  await wait(100);
  while (!stop.hidden && performance.now() - t0 < ${RUN_TIMEOUT_MS}) await wait(50);
  const cells = [...document.querySelectorAll('cypher-cell')];
  const failures = cells
    .filter((c) => !/matches the recording/.test(c.querySelector('.out-label').textContent) || /is-error|is-blocked/.test(c.className))
    .map((c) => 'step ' + c.dataset.step + ' (' + c.dataset.cell + '): ' + c.querySelector('.out-label').textContent);
  if (!stop.hidden) failures.push('the run did not finish in ${RUN_TIMEOUT_MS / 1000} s');
  return { log: [cells.length + ' steps in ' + Math.round(performance.now() - t0) + ' ms'], failures };
})()`;

/**
 * The graph view, on every step whose result is a graph: it draws (an NVL
 * canvas, the Graph tab selected, a legend) once scrolled near, survives a
 * trip to the JSON view, and draws the live result after "Run all".
 */
const GRAPH = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cells = [...document.querySelectorAll('cypher-cell[data-has-graph]')];
  const log = [cells.length + ' graph result(s)'], failures = [];
  const drawn = async (c) => {
    for (let i = 0; i < 100; i++) {
      if (c.querySelector('.out-graph:not([hidden]) .graph-view canvas')) return true;
      await wait(50);
    }
    return false;
  };
  const check = async (c, when) => {
    const name = 'step ' + c.dataset.step + ' (' + c.dataset.cell + ') ' + when;
    const tab = c.querySelector('[data-view=graph]');
    if (!(await drawn(c))) return failures.push(name + ': no graph drawn');
    if (tab.hidden || tab.getAttribute('aria-selected') !== 'true') failures.push(name + ': the Graph tab is not selected');
    if (!c.querySelector('.graph-legend i')) failures.push(name + ': the legend has no labels');
  };
  for (const c of cells) {
    c.scrollIntoView({ block: 'center' });
    await check(c, 'recorded');
  }
  if (cells.length) {
    const c = cells[0];
    c.querySelector('[data-view=json]').click();
    await wait(100);
    c.querySelector('[data-view=graph]').click();
    await check(c, 'after the JSON view');
    const bar = document.getElementById('engineBar');
    const stop = bar.querySelector('[data-action=stop]');
    bar.querySelector('[data-action=run-all]').click();
    await wait(100);
    for (let i = 0; i < 1200 && !stop.hidden; i++) await wait(50);
    for (const c of cells) {
      c.scrollIntoView({ block: 'center' });
      await check(c, 'live');
    }
  }
  return { log, failures };
})()`;

/** The controls, on one recipe's fourth step (which takes parameters). */
const CONTROLS = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const bar = document.getElementById('engineBar');
  const stopBtn = bar.querySelector('[data-action=stop]');
  const idle = async () => { await wait(100); for (let i = 0; i < 1200 && !stopBtn.hidden; i++) await wait(50); };
  const cells = [...document.querySelectorAll('cypher-cell')];
  const ids = cells.map((c) => c.dataset.cell);
  const cell = (id) => document.getElementById('cell-' + id);
  const label = (id) => cell(id).querySelector('.out-label').textContent;
  const log = [], failures = [];
  const expect = (name, ok, detail) => { log.push((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) failures.push(name); };
  const target = ids[3];
  const params = cell(target).querySelector('.params-editor');
  if (!params) return { log, failures: ['step 4 of this recipe takes no inline parameters; pick another'] };

  cell(target).querySelector('[data-action=run]').click();
  await idle();
  expect('Run on step 4 runs steps 1-4 first', ids.slice(0, 4).every((id) => /matches the recording/.test(label(id))), label(target));
  expect('later steps keep their recordings', label(ids[4]) === 'Recorded result', label(ids[4]));
  expect('Copy as text is offered for a table', !cell(target).querySelector('.out-copy').hidden);

  const before = cell(target).querySelector('.out-table').textContent;
  params.value = params.value.replace(/"radius":\\s*[\\d.]+/, '"radius": 100.0');
  cell(target).querySelector('[data-action=run]').click();
  await idle();
  expect('edited parameters run live, without claiming to match', /^Live/.test(label(target)) && !/matches/.test(label(target)), label(target));
  expect('edited parameters change the result', cell(target).querySelector('.out-table').textContent !== before);
  params.value = params.defaultValue;

  cell(target).querySelector('[data-view=json]').click();
  await wait(100);
  const json = cell(target).querySelector('.out-json');
  expect('the JSON view shows the envelope', !json.hidden && /"columns"/.test(json.textContent));
  cell(target).querySelector('[data-view=text]').click();

  const editBtn = cell(target).querySelector('[data-action=edit]');
  const editor = cell(target).querySelector('.cell-editor');
  editBtn.click();
  expect('Edit opens the editor', !editor.hidden && editBtn.textContent === 'Revert');
  editor.value = 'RETURN 1 +';
  cell(target).querySelector('[data-action=run]').click();
  await idle();
  expect('a failing edit shows its error', cell(target).classList.contains('is-error') && /^error:/.test(cell(target).querySelector('.out-text').textContent));
  editBtn.click();
  expect('Revert restores the query', editor.hidden && editor.value === editor.defaultValue);

  bar.querySelector('[data-action=reset]').click();
  await idle();
  expect('Reset puts back every recording', ids.every((id) => /^(Recorded result|Expected error)$/.test(label(id))));

  const first = cell(ids[0]);
  first.querySelector('[data-action=edit]').click();
  first.querySelector('.cell-editor').value = 'UNWIND range(1, 100000) AS a UNWIND range(1, 100000) AS b RETURN count(*) AS n';
  first.querySelector('[data-action=run]').click();
  await wait(150);
  const running = !stopBtn.hidden && first.classList.contains('is-running');
  stopBtn.click();
  await wait(200);
  expect('Stop is offered while a query runs', running);
  expect('Stop ends the run and discards the database', stopBtn.hidden && bar.dataset.status === 'stopped');
  expect('Stop puts back the recording', label(ids[0]) === 'Recorded result', label(ids[0]));
  first.querySelector('[data-action=edit]').click();

  bar.querySelector('[data-action=run-all]').click();
  await idle();
  expect('Run all after Stop starts a fresh engine and matches', ids.every((id) => /matches the recording/.test(label(id))));
  return { log, failures };
})()`;

/** The playground: the sample data loads, the results show, and the graph draws. */
const PLAYGROUND = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = () => [...document.querySelectorAll('button')].find((b) => /Load sample data/.test(b.textContent));
  const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  for (let i = 0; i < 600 && !enabled(button()); i++) await wait(50);
  if (!enabled(button())) return { log: [], failures: ['the engine did not get ready: ' + document.body.innerText.slice(0, 200)] };
  button().click();
  for (let i = 0; i < 600 && button(); i++) await wait(50);
  await wait(500);
  const text = document.body.innerText;
  const runs = text.match(/\\d+ records? · [\\d.]+ ms/g) || [];
  const failures = [];
  if (button()) failures.push('the welcome dialog did not close');
  if (runs.length < 2) failures.push('the sample data did not load: ' + runs.join(', '));
  if (!document.querySelector('canvas')) failures.push('no graph drawn');
  if (/Failed to load Relate WASM|crashed/.test(text)) failures.push('the engine failed to load');
  return { log: [runs.join(', ')], failures };
})()`;

/**
 * Opening a recipe (or one step) from the cookbook in the playground: the
 * dialog loads it, the expected steps replay, and for a step link its Cypher
 * and parameters are loaded. `expect` is
 * `{replayed, title, editorStart: string | null, paramsPath: string | null}`.
 */
const handoff = (expect: { replayed: number; title: string; editorStart: string | null; paramsPath: string | null }) => `(async () => {
  const expect = ${JSON.stringify(expect)};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = () => [...document.querySelectorAll('button')].find((b) => /Load the recipe/.test(b.textContent));
  const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  for (let i = 0; i < 600 && !enabled(button()); i++) await wait(50);
  if (!enabled(button())) {
    const said = (document.querySelector('[role=dialog]') || document.body).innerText.replace(/\\s+/g, ' ').slice(0, 300);
    return { log: [], failures: ['the recipe dialog did not offer to load: ' + said] };
  }
  button().click();
  for (let i = 0; i < 1200 && button(); i++) await wait(50);
  await wait(300);
  const text = document.body.innerText;
  const failures = [];
  const loaded = 'Loaded ' + expect.replayed + ' step' + (expect.replayed === 1 ? '' : 's') + ' of "' + expect.title + '".';
  if (!text.includes(loaded)) failures.push('expected "' + loaded + '"; the page says: ' + ((text.match(/Loaded [^\\n]*|Could not[^\\n]*|failed[^\\n]*/) || ['nothing'])[0]));
  const editor = document.querySelector('.cm-content')?.innerText ?? '';
  if (expect.editorStart !== null && !editor.startsWith(expect.editorStart)) failures.push('the step is not in the editor: ' + editor.slice(0, 80));
  const banner = /Queries run from the editor use the parameters from/.test(text);
  if (expect.paramsPath !== null && !(banner && text.includes(expect.paramsPath))) failures.push('no parameters banner for ' + expect.paramsPath);
  if (expect.paramsPath === null && banner) failures.push('a parameters banner, though the link takes no parameters');
  return { log: [loaded], failures };
})()`;

// ---------------------------------------------------------------- main

if (!existsSync(join(DIST, 'cookbook', 'index.html'))) fail('no dist/cookbook; run `npm run build` first');
if (!existsSync(join(DIST, 'playground', 'index.html'))) fail('no dist/playground; run `npm run build` (it builds the playground too)');
const only = process.env.COOKBOOK_ONLY?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;
const { recipes: all } = loadRecipes(COOKBOOK_DIR, { validate: false });
const recipes = all.filter((r) => !only || only.includes(r.slug));
const slugs = recipes.map((r) => r.slug);
const problems: string[] = [];

// ---------------------------------------------------------------- built files

interface RecipeJson {
  format: number;
  slug: string;
  title: string;
  cells: { id: string; code: string; paramsPath: string | null }[];
}
const published = new Map<string, RecipeJson>();

/** Every file under `dir`, recursively. */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

if (filesUnder(join(DIST, 'playground')).some((f) => f.endsWith('.wasm'))) {
  problems.push('[playground] built: dist/playground bundles a .wasm; the engine must load from /wasm/');
}
for (const r of recipes) {
  const where = `[${r.slug}] built`;
  let json: RecipeJson;
  try {
    json = JSON.parse(readFileSync(join(DIST, 'cookbook', r.slug, 'recipe.json'), 'utf8'));
  } catch (e) {
    problems.push(`${where}: recipe.json: ${(e as Error).message}`);
    continue;
  }
  published.set(r.slug, json);
  if (json.format !== 1) problems.push(`${where}: recipe.json has format ${json.format}, not 1`);
  const ids = json.cells.map((c) => c.id).join(',');
  if (ids !== r.cells.map((c) => c.id).join(',')) problems.push(`${where}: recipe.json lists steps ${ids}, not the recipe's`);
  const html = readFileSync(join(DIST, 'cookbook', r.slug, 'index.html'), 'utf8');
  const linked = [...html.matchAll(/href="\/playground\/#recipe=([^"&]+)&amp;cell=([^"]+)"/g)];
  if (linked.length !== r.cells.length) problems.push(`${where}: ${linked.length} step playground links for ${r.cells.length} steps`);
  for (const [, slug, cell] of linked) {
    if (slug !== r.slug || !r.cells.some((c) => c.id === cell)) problems.push(`${where}: a playground link names ${slug}/${cell}`);
  }
}
console.log(`${problems.length ? '✖' : '✔'} built files: the playground, and ${published.size} recipe.json and step links`);
const site = await serve();
const chrome = await launchChrome().catch((e: Error) => fail(e.message));

/** Run `scenario` on the page at `path`; `label` names it in the report. */
async function check(name: string, label: string, path: string, scenario: string) {
  const page = await openPage(chrome.http, `${site.url}${path}`);
  try {
    const { log, failures } = await page.evaluate<{ log: string[]; failures: string[] }>(scenario);
    const bad = [...failures, ...page.errors.map((e) => `console error: ${e}`)];
    console.log(`${bad.length ? '✖' : '✔'} ${label} · ${name}: ${log[0] ?? ''}`);
    if (name === 'controls') for (const line of log) console.log(`    ${line}`);
    problems.push(...bad.map((b) => `[${label}] ${name}: ${b}`));
  } finally {
    await page.close();
  }
}
const recipePage = (slug: string) => `/cookbook/${slug}/`;
const playgroundLink = (slug: string, cell: string | null = null) =>
  `/playground/#recipe=${encodeURIComponent(slug)}${cell ? `&cell=${encodeURIComponent(cell)}` : ''}`;

try {
  for (const slug of slugs) await check('run all', slug, recipePage(slug), RUN_ALL);
  for (const slug of slugs) await check('graph view', slug, recipePage(slug), GRAPH);
  if (slugs.includes(CONTROLS_RECIPE)) await check('controls', CONTROLS_RECIPE, recipePage(CONTROLS_RECIPE), CONTROLS);
  await check('sample data', 'playground', '/playground/', PLAYGROUND);
  for (const slug of slugs) {
    const json = published.get(slug);
    if (!json) continue;
    const expect = { replayed: json.cells.length, title: json.title, editorStart: null, paramsPath: null };
    await check('hand-off (whole recipe)', slug, playgroundLink(slug), handoff(expect));
  }
  const step = published.get(HANDOFF_STEP.slug);
  const index = step?.cells.findIndex((c) => c.id === HANDOFF_STEP.cell) ?? -1;
  if (step && index >= 0) {
    const cell = step.cells[index];
    const expect = { replayed: index, title: step.title, editorStart: cell.code.split('\n')[0], paramsPath: cell.paramsPath };
    await check(`hand-off (step ${cell.id})`, HANDOFF_STEP.slug, playgroundLink(HANDOFF_STEP.slug, cell.id), handoff(expect));
  }
} finally {
  chrome.kill();
  site.close();
}

if (problems.length) {
  console.error(`\n${problems.length} browser problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `cookbook-browser: ${slugs.length} recipes run in the browser and match their recordings; ` +
    'the playground loads, and every recipe opens in it',
);

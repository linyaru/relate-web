#!/usr/bin/env node
// Checks the cookbook's page runtime and the playground in a real browser:
// serves the built site (dist/, so run `npm run build` first) and drives
// headless Chrome.
//
// - Cookbook: every recipe page's "Run all" must finish every step live and
//   matching its recording; every graph result must draw; the controls (Run,
//   edited parameters, the JSON view, a failing edit and Revert, Reset, Stop)
//   are exercised on one recipe.
// - Playground (/playground/): the sample data loads and draws; a real
//   double-click on a drawn node adds its neighbours, and Reset removes them.
// - Hand-off (ADR-0134): every recipe opened whole in the playground
//   (#recipe=<slug>) replays all its steps; one step link with parameters
//   replays the steps before it and loads the step and its parameters.
// - Docs (DOCS-PLAN.md §8 item 4, one case per element type): every built
//   docs page with runnable cells loads without loading the engine, and its
//   "Run all" finishes every cell live and matching its recording, with the
//   status bar naming the engine version; a tab set switches; a graph result
//   draws and a real double-click on its node expands it from the page's
//   database; the page opens in the playground (#docs=<page>), whole and from
//   a cell that takes parameters. Pages with cells exist once a page has
//   them; `DOCS_EXAMPLES=1 npm run build` adds the example page, which has
//   every kind.
// - Glossary toggletip (DOCS-PLAN.md §4.11, ADR-0009), on the first built
//   docs page that has one: the panel is closed on load; a real click on the
//   term's button opens it, with focus left on the button; a real Escape
//   closes it, focus still on the button. No JavaScript of the site's is
//   involved: the Popover API does it.
// - Docs constructs (phase 2, on the first built page that has each): an
//   `::::agentic` set switches to the agent view, every set on the page with
//   it, and a new tab opens on the agent view (the choice is remembered); the
//   language picker switches every tab set on the page that has the chosen
//   language, under any of its key spellings, and a new tab opens on it; each
//   deeplink button's href decodes to the JSON shown beside it, and the link
//   printed as text is the href. A construct no built page has is skipped
//   with a note.
// - Interactive elements (DOCS-PLAN.md §7.5, src/lib/docs/elements.ts): every
//   case file in scripts/browser-cases/ (`<name>.ts`, default export
//   {element, cases}; scripts/browser-cases/_kit.ts documents the scenario
//   language) runs on the first built docs page that carries its element
//   (`data-element="<name>"`, or a cell whose `data-elements` names it).
//   Before its cases, each element's static form must show with scripts
//   disabled (at 1400 px, and at 390 px without sideways scrolling), and its
//   module and the engine must not load with the page while it is out of
//   reach. After them, its first case runs again at phone width (390 x 844:
//   no sideways scrolling, every host fits) and under prefers-reduced-motion
//   (no CSS animation or transition runs inside a host). An element on a
//   built page without a case file fails.
// - The script budget, measured (src/lib/docs/checks/budget.ts counts it
//   statically): every built docs page with the page runtime, and one
//   without, loads no more JavaScript before any interaction than the static
//   count says, and stays under 60 KB. Element modules and the graph view,
//   which load when they come near the viewport, are left out.
// - Before any browser runs, the built files are checked: the playground is
//   built and bundles no engine of its own, each recipe's recipe.json is
//   format 1 and lists exactly its steps, and each step's playground link
//   names one of them; each docs page's cell links name its cells.
//
// `npm run cookbook:check` runs the recipes in Node; this catches what only a
// browser shows: the bundled runtimes, the module workers, and the engine
// loaded from /wasm/.
//
//   node scripts/cookbook-browser.ts            (npm run cookbook:browser)
//   DIST=<dir> node scripts/cookbook-browser.ts  (a build other than ./dist)
//
// Chrome comes from CHROME_PATH, else the usual install locations. Talks to
// Chrome over the DevTools protocol with Node's own WebSocket: no
// dependencies. COOKBOOK_ONLY=<slug>[,<slug>…] limits the recipes;
// ELEMENT_ONLY=<element>[,…] limits the element case files (a dev loop, not CI).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { twinCells } from '../src/lib/cookbook/cells.ts';
import { COOKBOOK_DIR, loadRecipes, projectRoot } from '../src/lib/cookbook/load.ts';
import { distReader, eagerScripts, kb, PAGE_JS_BUDGET } from '../src/lib/docs/checks/budget.ts';
import type { BrowserCases, BrowserTab, Outcome } from './browser-cases/_kit.ts';

const DIST = process.env.DIST ? resolve(process.env.DIST) : join(projectRoot(), 'dist');
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
  // A throwaway profile, removed when Chrome exits (a run leaves about 100 MB behind otherwise).
  const profile = mkdtempSync(join(tmpdir(), 'cookbook-chrome-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    // WebGL in software (SwiftShader), which headless Chrome no longer turns
    // on by itself: the scale demo draws with NVL's WebGL renderer, and the
    // graph views run NVL's layout on WebGL as they do in a reader's browser.
    '--enable-unsafe-swiftshader',
    '--remote-debugging-port=0',
    // A desktop-sized window: at Chrome's headless default (800x600) the
    // playground switches to its mobile layout, with the editor behind a tab.
    '--window-size=1400,900',
    `--user-data-dir=${profile}`,
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
  const removeProfile = () => rmSync(profile, { recursive: true, force: true });
  // `fail()` exits the process without reaching the kill below: take Chrome and its profile with it.
  process.on('exit', () => {
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
    removeProfile();
  });
  /** Stop Chrome, wait for it to exit (SIGKILL after five seconds), then remove its profile. */
  const kill = () =>
    new Promise<void>((resolve) => {
      if (chrome.exitCode !== null) {
        removeProfile();
        resolve();
        return;
      }
      const hard = setTimeout(() => chrome.kill('SIGKILL'), 5_000);
      chrome.once('exit', () => {
        clearTimeout(hard);
        removeProfile();
        resolve();
      });
      chrome.kill();
    });
  return { http: new URL(endpoint).origin.replace('ws:', 'http:'), kill };
}

/** How a tab opens: `scripts: false` disables the page's scripts; `viewport` and `reducedMotion` apply before the page loads. */
interface OpenOptions {
  scripts?: boolean;
  viewport?: { width: number; height: number; mobile?: boolean };
  reducedMotion?: boolean;
}

/** Open `url` in a new tab; evaluate expressions there; collect console errors. */
async function openPage(http: string, url: string, { scripts = true, viewport, reducedMotion }: OpenOptions = {}) {
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
  /** How the top frame last navigated ('Navigation', or 'BackForwardCacheRestore'). */
  let navType: string | null = null;
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as CdpMessage;
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)!(msg);
      waiting.delete(msg.id);
    } else if (msg.method === 'Page.frameNavigated') {
      const frame = msg.params?.frame as { parentId?: string } | undefined;
      if (frame && !frame.parentId) navType = String(msg.params?.type ?? 'Navigation');
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
  const setViewport = (width: number, height: number, { mobile = false }: { mobile?: boolean } = {}) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 3 : 1, mobile }).then(() => undefined);
  const setReducedMotion = (reduced: boolean) =>
    send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] }).then(() => undefined);
  const evaluate = async <T,>(expression: string): Promise<T> => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value as T;
  };
  const go = async (to: string) => {
    loaded = false;
    await send('Page.navigate', { url: to });
    for (let i = 0; i < 200 && !loaded; i++) await sleep(50);
    if (!loaded) throw new Error(`${to} did not load`);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // Headless Chrome stops producing animation frames after a CDP key event
  // unless the page is told it has focus; NVL draws (and zooms) on frames.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (!scripts) await send('Emulation.setScriptExecutionDisabled', { value: true });
  if (viewport) await setViewport(viewport.width, viewport.height, viewport);
  if (reducedMotion !== undefined) await setReducedMotion(reducedMotion);
  await go(url);
  return {
    errors,
    viewport: setViewport,
    emulateMedia: ({ reducedMotion: reduced }: { reducedMotion: boolean }) => setReducedMotion(reduced),
    /** Navigate to `to` (relative to the page) and wait for its load event. */
    async navigate(to: string) {
      await go(new URL(to, url).href);
    },
    /** One history entry back; resolves once the page shows, saying whether it came from the back/forward cache. */
    async back() {
      const history = (await send('Page.getNavigationHistory')).result as unknown as { currentIndex: number; entries: { id: number; url: string }[] };
      const entry = history.entries[history.currentIndex - 1];
      if (!entry) throw new Error('no history entry to go back to');
      navType = null;
      loaded = false;
      await send('Page.navigateToHistoryEntry', { entryId: entry.id });
      // A restore from the back/forward cache fires no load event; the page is simply there again.
      for (let i = 0; i < 200; i++) {
        if (navType !== null && (loaded || navType === 'BackForwardCacheRestore')) break;
        await sleep(50);
      }
      const shown = await evaluate<boolean>(`location.href === ${JSON.stringify(entry.url)} && document.readyState === 'complete'`).catch(() => false);
      if (!shown) throw new Error(`going back to ${entry.url} did not finish`);
      return { restored: navType === 'BackForwardCacheRestore' };
    },
    evaluate,
    /** A real double-click (CDP input events) at viewport point x, y. */
    async doubleClick(x: number, y: number) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      for (const clickCount of [1, 2]) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
      }
    },
    /** A real click (CDP input events) at viewport point x, y. */
    async click(x: number, y: number) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    /** A real one-finger swipe (CDP touch events, touch emulation on in this tab only); the browser scrolls or not, and cancels the pointer or not, as for a finger. */
    async swipe(x0: number, y0: number, x1: number, y1: number, steps = 10) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
        await sleep(16);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** A real key press (CDP input events), such as Escape; `modifiers` is CDP's bit field (Alt 1, Ctrl 2, Meta 4, Shift 8). */
    async press(key: string, code = key, keyCode = key === 'Escape' ? 27 : 0, modifiers = 0) {
      // Enter carries its character, so it activates a focused button as a real key does.
      const text = key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
      await send('Input.dispatchKeyEvent', { type: key === 'Enter' ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, ...text });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
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
 * Double-click to expand, in two parts around a real double-click: load the
 * sample data and draw one node (alone, so it sits at the centre of the
 * graph canvas once the view fits it), returning the point to double-click;
 * then its neighbours must be added, and Reset must take them away.
 */
const EXPAND_NODE = `MATCH (p:Person {name: 'Alice'}) RETURN p`;
const EXPAND_PREPARE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = () => [...document.querySelectorAll('button')].find((b) => /Load sample data/.test(b.textContent));
  const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  for (let i = 0; i < 600 && !enabled(button()); i++) await wait(50);
  if (!enabled(button())) return { failures: ['the engine did not get ready'] };
  button().click();
  for (let i = 0; i < 600 && button(); i++) await wait(50);
  const editor = document.querySelector('textarea');
  if (!editor) return { failures: ['no query input'] };
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, ${JSON.stringify(EXPAND_NODE)});
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[aria-label=Run]').click();
  const status = () => document.querySelector('[data-graph-status]')?.innerText ?? '';
  for (let i = 0; i < 200 && !/Double-click/.test(status()); i++) await wait(50);
  if (!/Double-click/.test(status())) return { failures: ['the graph did not draw the node: ' + status()] };
  await wait(1500);
  const r = [...document.querySelectorAll('canvas')].map((c) => c.getBoundingClientRect()).find((b) => b.width > 100);
  if (!r) return { failures: ['no graph canvas'] };
  return { failures: [], x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
const EXPAND_CHECK = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const status = () => document.querySelector('[data-graph-status] > span')?.textContent ?? '';
  for (let i = 0; i < 200 && !/Added|Nothing|Could not/.test(status()); i++) await wait(50);
  const added = status();
  const failures = [];
  if (!/^Added [1-9]\\d* nodes? and \\d+ relationships?/.test(added)) failures.push('the double-click did not expand the node: ' + added);
  const reset = document.querySelector('[data-graph-status] button');
  if (!reset) failures.push('no Reset next to the expansion');
  else {
    reset.click();
    for (let i = 0; i < 40 && !/Double-click/.test(status()); i++) await wait(50);
    if (!/Double-click/.test(status())) failures.push('Reset did not take the expansion away: ' + status());
  }
  return { log: [added], failures };
})()`;

/**
 * Opening a recipe (or one step) from the cookbook in the playground: the
 * dialog loads it, the expected steps replay, and for a step link its Cypher
 * and parameters are loaded. The sample list then holds the recipe's steps
 * (`samples`, their titles) instead of the sample data's queries, and
 * `runSample`, when set, is a step title whose button must run and return
 * rows.
 */
const handoff = (expect: {
  replayed: number;
  title: string;
  editorStart: string | null;
  paramsPath: string | null;
  samples: string[];
  runSample: string | null;
  /** What the playground calls the source and its parts. */
  whole?: string;
  part?: string;
}) => `(async () => {
  const expect = ${JSON.stringify({ whole: 'recipe', part: 'step', ...expect })};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const button = () => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Load the ' + expect.whole));
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
  const loaded = 'Loaded ' + expect.replayed + ' ' + expect.part + (expect.replayed === 1 ? '' : 's') + ' of "' + expect.title + '".';
  if (!text.includes(loaded)) failures.push('expected "' + loaded + '"; the page says: ' + ((text.match(/Loaded [^\\n]*|Could not[^\\n]*|failed[^\\n]*/) || ['nothing'])[0]));
  const editor = document.querySelector('.cm-content')?.innerText ?? '';
  if (expect.editorStart !== null && !editor.startsWith(expect.editorStart)) failures.push('the step is not in the editor: ' + editor.slice(0, 80));
  const banner = /Queries run from the editor use the parameters from/.test(text);
  if (expect.paramsPath !== null && !(banner && text.includes(expect.paramsPath))) failures.push('no parameters banner for ' + expect.paramsPath);
  if (expect.paramsPath === null && banner) failures.push('a parameters banner, though the link takes no parameters');

  // The sample list is the recipe's steps, not the sample data's queries.
  const buttons = () => [...document.querySelectorAll('button')];
  const labels = new Set(buttons().map((b) => b.textContent.trim()));
  const missing = expect.samples.filter((s) => !labels.has(s));
  if (missing.length) failures.push('the sample list lacks the recipe steps ' + JSON.stringify(missing.slice(0, 3)));
  if (labels.has('Colleagues at Neo4j')) failures.push('the sample list still shows the sample data queries');
  if (!text.includes('Queries from "' + expect.title + '"')) failures.push('the sample list is not titled for the recipe');

  // A step's button runs it with its own parameters.
  if (expect.runSample !== null) {
    const results = () => (document.body.innerText.match(/\\d+ records? · [\\d.]+ ms/g) || []).length;
    const before = results();
    const sample = buttons().find((b) => b.textContent.trim() === expect.runSample);
    if (!sample) failures.push('no sample button ' + expect.runSample);
    else {
      sample.click();
      for (let i = 0; i < 200 && results() === before; i++) await wait(50);
      if (results() === before) failures.push('running the sample ' + JSON.stringify(expect.runSample) + ' returned no result');
    }
  }
  return { log: [loaded + ' ' + expect.samples.length + ' step queries'], failures };
})()`;

// ---------------------------------------------------------------- docs scenarios

/** A docs page with cells loads: the bar shows, every cell is upgraded, and the engine has not loaded. */
const DOCS_LOAD = `(async () => {
  const bar = document.getElementById('engineBar');
  const failures = [];
  for (let i = 0; i < 100 && (!bar || bar.hidden); i++) await new Promise((r) => setTimeout(r, 50));
  if (!bar || bar.hidden) failures.push('the engine bar is not shown: the runtime did not start');
  const cells = [...document.querySelectorAll('cypher-cell')];
  const upgraded = cells.filter((c) => !c.querySelector('[data-action=run]').hidden).length;
  if (upgraded !== cells.length) failures.push(upgraded + ' of ' + cells.length + ' cells offer Run');
  const loaded = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /relate_bg\\.wasm|\\/wasm\\/relate\\.js/.test(n));
  if (loaded.length) failures.push('the engine loaded with the page: ' + loaded.join(', '));
  const statics = [...document.querySelectorAll('cypher-cell .out-static')];
  if (statics.some((f) => !f.hidden)) failures.push('a static graph form still shows with the runtime up');
  return { log: [cells.length + ' cells, ' + statics.length + ' static graph form(s)'], failures };
})()`;

/** After "Run all" (RUN_ALL), the status bar names the engine version. */
const DOCS_STATUS = `(async () => {
  const bar = document.getElementById('engineBar');
  const text = bar.querySelector('.engine-text').textContent;
  const failures = [];
  if (!/^relate \\d+\\.\\d+\\.\\d+ loaded in \\d+ ms/.test(text)) failures.push('the status bar does not name the engine: ' + text);
  if (bar.dataset.engineVersion !== bar.dataset.verified && !/verified against relate/.test(text)) failures.push('the engine is not the verified version, and the bar does not say so: ' + text);
  return { log: [text], failures };
})()`;

/** A tab set switches: the second tab's panel shows, the first's hides, and the choice is selected. */
const DOCS_TABS = `(async () => {
  const set = document.querySelector('[data-tabs].is-enhanced');
  if (!set) return { log: [], failures: ['no enhanced tab set'] };
  const buttons = [...set.querySelectorAll(':scope > .tab-list > button')];
  const panels = [...set.querySelectorAll(':scope > .tab-panel')];
  if (buttons.length < 2) return { log: [], failures: ['the tab set has ' + buttons.length + ' tab(s)'] };
  const failures = [];
  if (panels.filter((p) => !p.hidden).length !== 1) failures.push('not exactly one panel shows before a choice');
  buttons[1].click();
  if (panels[1].hidden || !panels[0].hidden) failures.push('choosing the second tab did not show its panel');
  if (buttons[1].getAttribute('aria-selected') !== 'true') failures.push('the second tab is not selected');
  buttons[0].click();
  return { log: [buttons.map((b) => b.textContent).join(' / ')], failures };
})()`;

/**
 * `::::agentic`: choosing the agent view shows it in every agentic set on the
 * page and remembers it; DOCS_AGENTIC_KEPT, in a new tab, expects it still
 * chosen, then puts the person view back.
 */
const DOCS_AGENTIC = `(async () => {
  const sets = [...document.querySelectorAll('[data-agentic].is-enhanced')];
  if (!sets.length) return { log: [], failures: ['no enhanced agentic set'] };
  const failures = [];
  const shown = (set) => [...set.querySelectorAll(':scope > .tab-panel')].filter((p) => !p.hidden).map((p) => p.dataset.tabKey);
  for (const set of sets) if (shown(set).length !== 1) failures.push('an agentic set does not show exactly one view before a choice');
  const agent = sets[0].querySelector(':scope > .tab-list > button[data-tab-key="agentic-agent"]');
  if (!agent) return { log: [], failures: ['no agent tab'] };
  agent.click();
  sets.forEach((set, i) => { if (shown(set).join() !== 'agentic-agent') failures.push('set ' + (i + 1) + ' shows ' + shown(set).join() + ', not the agent view'); });
  if (agent.getAttribute('aria-selected') !== 'true') failures.push('the agent tab is not selected');
  let kept = [];
  try { kept = JSON.parse(localStorage.getItem('docs-tab') || '[]'); } catch {}
  if (kept[0] !== 'agentic-agent') failures.push('docs-tab does not start with agentic-agent: ' + JSON.stringify(kept));
  return { log: [sets.length + ' agentic set(s): ' + [...sets[0].querySelectorAll(':scope > .tab-list > button')].map((b) => b.textContent).join(' / ')], failures };
})()`;
const DOCS_AGENTIC_KEPT = `(async () => {
  const sets = [...document.querySelectorAll('[data-agentic].is-enhanced')];
  const failures = [];
  sets.forEach((set, i) => {
    const on = [...set.querySelectorAll(':scope > .tab-panel')].filter((p) => !p.hidden).map((p) => p.dataset.tabKey).join();
    if (on !== 'agentic-agent') failures.push('in a new tab, set ' + (i + 1) + ' opens on ' + on + ', not the remembered agent view');
  });
  sets[0]?.querySelector(':scope > .tab-list > button[data-tab-key="agentic-human"]')?.click();
  return { log: [sets.length + ' set(s) reopened on the agent view'], failures };
})()`;

/**
 * The language picker: each language it offers, chosen, shows that language
 * in every enhanced tab set that has one of its keys. The last one chosen is
 * the offered language with the most key spellings (Node.js: node, js, …).
 * Then a tab of another language is clicked and a tab that names no language
 * (an OS or agentic tab): the tab script rewrites docs-tab from its page-load
 * list on each click, and docs-tab must still hold every spelling of every
 * language in it. Then the picker goes back to that language. DOCS_PICKER_KEPT,
 * in a new tab, expects it still shown in every set, whatever key the set
 * uses, then clears the memory.
 */
const PICKER_LAST = `(select) => [...select.options].reduce((a, o) => (o.dataset.keys.split(' ').length > a.dataset.keys.split(' ').length ? o : a))`;
const DOCS_PICKER = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await customElements.whenDefined('lang-picker');
  const select = document.querySelector('lang-picker select');
  if (!select) return { log: [], failures: ['no picker'] };
  const failures = [];
  const log = [];
  const sets = [...document.querySelectorAll('[data-tabs].is-enhanced')];
  const options = [...select.options];
  const last = (${PICKER_LAST})(select);
  for (const o of [...options.filter((x) => x !== last), last]) {
    const keys = o.dataset.keys.split(' ');
    select.value = o.value;
    select.dispatchEvent(new Event('change'));
    await wait(20);
    let switched = 0;
    sets.forEach((set, i) => {
      const panels = [...set.querySelectorAll(':scope > .tab-panel')];
      if (!panels.some((p) => keys.includes(p.dataset.tabKey))) return;
      const on = panels.filter((p) => !p.hidden).map((p) => p.dataset.tabKey);
      if (on.length !== 1 || !keys.includes(on[0])) failures.push(o.textContent + ': set ' + (i + 1) + ' shows ' + on.join() + ', not ' + keys.join('|'));
      else switched++;
    });
    if (!switched) failures.push(o.textContent + ': no tab set has it, yet the picker offers it');
  }
  const read = () => { try { return JSON.parse(localStorage.getItem('docs-tab') || '[]'); } catch { return []; } };
  const want = last.dataset.keys.split(' ');
  let kept = read();
  if (kept.slice(0, want.length).join() !== want.join()) failures.push('docs-tab does not start with ' + want.join() + ': ' + JSON.stringify(kept));
  // Another language's tab, then a tab that names no language.
  const languageKeys = new Set(options.flatMap((o) => o.dataset.keys.split(' ')));
  const tabs = [...document.querySelectorAll('[data-tabs].is-enhanced > .tab-list > button')];
  const second = tabs.find((b) => languageKeys.has(b.dataset.tabKey) && !want.includes(b.dataset.tabKey));
  const other = tabs.find((b) => !languageKeys.has(b.dataset.tabKey));
  const clicked = [second, other].filter(Boolean);
  for (const b of clicked) { b.click(); await wait(20); }
  kept = read();
  const after = 'after clicks on ' + clicked.map((b) => b.dataset.tabKey).join(' then ');
  const lostWant = want.filter((k) => !kept.includes(k));
  if (lostWant.length) failures.push(after + ', docs-tab lost ' + lostWant.join(', ') + ': ' + JSON.stringify(kept));
  for (const o of options) {
    const ks = o.dataset.keys.split(' ');
    if (ks.some((k) => kept.includes(k)) && !ks.every((k) => kept.includes(k))) failures.push(after + ', docs-tab holds only some spellings of ' + o.textContent + ': ' + JSON.stringify(kept));
  }
  if (clicked.length) {
    const lastKey = clicked[clicked.length - 1].dataset.tabKey;
    const same = options.map((o) => o.dataset.keys.split(' ')).find((ks) => ks.includes(lastKey)) ?? [lastKey];
    if (!same.includes(kept[0])) failures.push(after + ', docs-tab does not start with the last one: ' + JSON.stringify(kept));
  }
  log.push('every spelling kept ' + after + (other ? '' : ' (no tab that names no language on this page)'));
  select.value = last.value;
  select.dispatchEvent(new Event('change'));
  await wait(20);
  kept = read();
  if (kept.slice(0, want.length).join() !== want.join()) failures.push('chosen again, docs-tab does not start with ' + want.join() + ': ' + JSON.stringify(kept));
  log.unshift(options.map((o) => o.textContent).join(' / ') + ' across ' + sets.length + ' tab set(s), ending on ' + last.textContent);
  return { log, failures };
})()`;
const DOCS_PICKER_KEPT = `(async () => {
  await customElements.whenDefined('lang-picker');
  const select = document.querySelector('lang-picker select');
  const failures = [];
  const o = (${PICKER_LAST})(select);
  const keys = o.dataset.keys.split(' ');
  if (select.value !== o.value) failures.push('in a new tab the picker shows ' + select.value + ', not ' + o.value);
  for (const set of document.querySelectorAll('[data-tabs].is-enhanced')) {
    const panels = [...set.querySelectorAll(':scope > .tab-panel')];
    if (!panels.some((p) => keys.includes(p.dataset.tabKey))) continue;
    const on = panels.find((p) => !p.hidden)?.dataset.tabKey;
    if (!keys.includes(on)) failures.push('in a new tab a set opens on ' + on + ', not ' + o.textContent);
  }
  try { localStorage.removeItem('docs-tab'); } catch {}
  return { log: [o.textContent + ' kept in a new tab'], failures };
})()`;

/** Each deeplink's href decodes to the JSON shown beside it; the link as text is the href. */
const DOCS_DEEPLINK = `(async () => {
  const boxes = [...document.querySelectorAll('[data-deeplink]')];
  if (!boxes.length) return { log: [], failures: ['no deeplink'] };
  const failures = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const box of boxes) {
    const a = box.querySelector('a[data-deeplink-href]');
    const href = a.getAttribute('href');
    const shown = JSON.parse(box.querySelector('.code-block textarea').value);
    let decoded = null, name = null;
    if (href.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?')) {
      const q = new URLSearchParams(href.slice(href.indexOf('?') + 1));
      name = q.get('name');
      decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(q.get('config')), (c) => c.charCodeAt(0))));
    } else if (href.startsWith('vscode:mcp/install?')) {
      const { name: n, ...rest } = JSON.parse(decodeURIComponent(href.slice('vscode:mcp/install?'.length)));
      name = n;
      decoded = rest;
    } else failures.push('unknown deeplink form: ' + href.slice(0, 60));
    if (decoded && !same(decoded, shown)) failures.push(box.dataset.host + ': the link carries ' + JSON.stringify(decoded) + ', the page shows ' + JSON.stringify(shown));
    if (name !== box.dataset.name) failures.push(box.dataset.host + ': the link names ' + name + ', the page ' + box.dataset.name);
    if (!JSON.stringify(shown).includes('--read-only') && !shown.url) failures.push(box.dataset.host + ': the entry is not read-only');
    if (box.querySelector('[data-deeplink-text]').textContent !== href) failures.push(box.dataset.host + ': the link as text is not the href');
  }
  return { log: [boxes.map((b) => b.dataset.host).join(', ')], failures };
})()`;

/**
 * A graph result draws, in two parts around a real double-click: scroll a
 * one-node graph result into view and wait for the view (the node sits at the
 * centre once the view fits it), returning the point; then its neighbours must
 * be added from the page's database.
 */
const DOCS_GRAPH_PREPARE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const cell = document.querySelector('cypher-cell[data-graph-nodes="1"]');
  if (!cell) return { failures: [], skip: 'no one-node graph result' };
  cell.scrollIntoView({ block: 'center' });
  for (let i = 0; i < 200 && !cell.querySelector('.out-graph:not([hidden]) .graph-view canvas'); i++) await wait(50);
  if (!cell.querySelector('.out-graph:not([hidden]) .graph-view canvas')) return { failures: ['the graph view did not draw'] };
  if (!cell.querySelector('.graph-legend i')) return { failures: ['the legend has no labels'] };
  await wait(1500);
  const r = cell.querySelector('.graph-stage').getBoundingClientRect();
  return { failures: [], cell: cell.dataset.cell, x: r.left + r.width / 2, y: r.top + r.height / 2 };
})()`;
const docsGraphCheck = (cell: string) => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const status = () => document.getElementById(${JSON.stringify(`cell-${cell}`)})?.querySelector('.graph-status')?.textContent
    ?? document.querySelector('cypher-cell[data-cell=${JSON.stringify(cell)}] .graph-status')?.textContent ?? '';
  for (let i = 0; i < 400 && !/Added|Nothing|Could not/.test(status()); i++) await wait(50);
  const said = status();
  const failures = /^Added [1-9]\\d* nodes? and \\d+ relationships?/.test(said) ? [] : ['the double-click did not expand the node: ' + said];
  return { log: [said], failures };
})()`;

// ---------------------------------------------------------------- main

if (!existsSync(join(DIST, 'cookbook', 'index.html'))) fail('no dist/cookbook; run `npm run build` first');
if (!existsSync(join(DIST, 'playground', 'index.html'))) fail('no dist/playground; run `npm run build` (it builds the playground too)');
// ---------------------------------------------------------------- glossary toggletip

/** The first toggletip on the page: scrolled into view, closed; returns the button's centre. */
const TOGGLETIP_PREPARE = `(async () => {
  const button = document.querySelector('button.term[popovertarget]');
  if (!button) return { failures: ['no toggletip button on the page'] };
  const tip = document.getElementById(button.getAttribute('popovertarget'));
  if (!tip || tip.getAttribute('popover') !== 'auto') return { failures: ['the button names no popover="auto" panel'] };
  // Wait until the button stops moving: a page with cells or tab sets above it
  // can still shift while its scripts enhance them.
  let last = '';
  for (let i = 0; i < 30; i++) {
    button.scrollIntoView({ block: 'center' });
    await new Promise((r) => setTimeout(r, 100));
    const b = button.getBoundingClientRect();
    const now = [b.left, b.top, b.width, b.height].map(Math.round).join(',');
    if (now === last) break;
    last = now;
  }
  const failures = [];
  if (tip.matches(':popover-open')) failures.push('the panel is open before any click');
  if (!tip.querySelector('a[href^="/docs/reference/glossary/#"]')) failures.push('the panel has no link to the glossary entry');
  const r = button.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, term: button.textContent, failures };
})()`;
/** Whether the first toggletip's panel is open, and whether its button has focus. */
const TOGGLETIP_STATE = `(() => {
  const button = document.querySelector('button.term[popovertarget]');
  const tip = document.getElementById(button.getAttribute('popovertarget'));
  return { open: tip.matches(':popover-open'), focused: document.activeElement === button, text: tip.textContent.trim().slice(0, 80) };
})()`;

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
  cells: { id: string; title?: string; code: string; paramsPath: string | null; setup: boolean }[];
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

/** Built docs pages with runnable cells: their page id, URL path and cell ids. */
interface DocsCellPage {
  id: string;
  path: string;
  cells: string[];
  html: string;
}
const docsPages: DocsCellPage[] = [];
const docsDir = join(DIST, 'docs');
if (existsSync(docsDir)) {
  for (const file of filesUnder(docsDir).filter((f) => f.endsWith('/index.html')).sort()) {
    const html = readFileSync(file, 'utf8');
    if (!html.includes('<cypher-cell')) continue;
    const id = file.slice(docsDir.length + 1, -'/index.html'.length);
    const cells = [...html.matchAll(/<cypher-cell [^>]*data-cell="([^"]+)"/g)].map((m) => m[1]);
    docsPages.push({ id, path: `/docs/${id}/`, cells, html });
    const where = `[docs/${id}] built`;
    const linked = [...html.matchAll(/href="\/playground\/#docs=([^"&]+)&amp;cell=([^"]+)"/g)];
    if (linked.length !== cells.length) problems.push(`${where}: ${linked.length} cell playground links for ${cells.length} cells`);
    for (const [, page, cell] of linked) {
      if (decodeURIComponent(page) !== id || !cells.includes(decodeURIComponent(cell))) problems.push(`${where}: a playground link names ${page}/${cell}`);
    }
    if (!existsSync(join(docsDir, `${id}.md`))) problems.push(`${where}: no twin at /docs/${id}.md for the playground to read`);
  }
}
console.log(`${problems.length ? '✖' : '✔'} built files: ${docsPages.length} docs page(s) with cells, and their cell links`);
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
/** The glossary toggletip: a real click opens it, a real Escape closes it, focus stays on the button (WCAG 1.4.13). */
async function checkToggletip() {
  const file = existsSync(docsDir)
    ? filesUnder(docsDir).filter((f) => f.endsWith('/index.html')).sort().find((f) => /<button type="button" class="term" popovertarget=/.test(readFileSync(f, 'utf8')))
    : undefined;
  if (!file) {
    problems.push('[docs] glossary toggletip: no built docs page has a toggletip (a `:term` in prose renders one)');
    console.log('✖ docs · glossary toggletip: no built page has one');
    return;
  }
  const path = `/docs/${file.slice(docsDir.length + 1, -'index.html'.length)}`;
  const label = path.slice(1, -1);
  const tab = await openPage(chrome.http, `${site.url}${path}`);
  const failures: string[] = [];
  try {
    const at = await tab.evaluate<{ x?: number; y?: number; term?: string; failures: string[] }>(TOGGLETIP_PREPARE);
    failures.push(...at.failures);
    if (at.x !== undefined && at.y !== undefined) {
      await tab.click(at.x, at.y);
      await sleep(150);
      const opened = await tab.evaluate<{ open: boolean; focused: boolean; text: string }>(TOGGLETIP_STATE);
      if (!opened.open) failures.push(`a click on "${at.term}" did not open its panel`);
      if (!opened.focused) failures.push('focus left the button when the panel opened');
      await tab.press('Escape');
      await sleep(150);
      const closed = await tab.evaluate<{ open: boolean; focused: boolean; text: string }>(TOGGLETIP_STATE);
      if (closed.open) failures.push('Escape did not close the panel');
      if (!closed.focused) failures.push('focus is not on the button after Escape');
      console.log(`${failures.length ? '✖' : '✔'} ${label} · glossary toggletip: "${at.term}" opens on click ("${opened.text}…") and closes on Escape`);
    } else {
      console.log(`✖ ${label} · glossary toggletip`);
    }
    failures.push(...tab.errors.map((e) => `console error: ${e}`));
  } finally {
    await tab.close();
  }
  problems.push(...failures.map((f) => `[${label}] glossary toggletip: ${f}`));
}

/** Double-click a one-node graph result on a docs page; see DOCS_GRAPH_PREPARE. */
async function checkDocsGraph(page: DocsCellPage) {
  const tab = await openPage(chrome.http, `${site.url}${page.path}`);
  const label = `docs/${page.id}`;
  try {
    const at = await tab.evaluate<{ failures: string[]; skip?: string; cell?: string; x?: number; y?: number }>(DOCS_GRAPH_PREPARE);
    if (at.skip) return console.log(`- ${label} · graph view expands: skipped (${at.skip})`);
    let result = { log: [] as string[], failures: at.failures };
    if (!at.failures.length) {
      await tab.doubleClick(at.x!, at.y!);
      result = await tab.evaluate<{ log: string[]; failures: string[] }>(docsGraphCheck(at.cell!));
    }
    const bad = [...result.failures, ...tab.errors.map((e) => `console error: ${e}`)];
    console.log(`${bad.length ? '✖' : '✔'} ${label} · graph view expands: ${result.log[0] ?? ''}`);
    problems.push(...bad.map((b) => `[${label}] graph view expands: ${b}`));
  } finally {
    await tab.close();
  }
}
/** Run all on a docs page, then the status bar; one tab, so the bar reports the run. */
async function checkDocsRun(page: DocsCellPage) {
  const tab = await openPage(chrome.http, `${site.url}${page.path}`);
  const label = `docs/${page.id}`;
  try {
    for (const [name, scenario] of [['page loads', DOCS_LOAD], ['run all', RUN_ALL], ['status bar', DOCS_STATUS]] as const) {
      const { log, failures } = await tab.evaluate<{ log: string[]; failures: string[] }>(scenario);
      console.log(`${failures.length ? '✖' : '✔'} ${label} · ${name}: ${log[0] ?? ''}`);
      problems.push(...failures.map((b) => `[${label}] ${name}: ${b}`));
    }
    problems.push(...tab.errors.map((e) => `[${label}] console error: ${e}`));
  } finally {
    await tab.close();
  }
}

/** Double-click a node in the playground's graph view; see EXPAND_PREPARE. */
async function checkExpand() {
  const page = await openPage(chrome.http, `${site.url}/playground/`);
  try {
    const at = await page.evaluate<{ failures: string[]; x?: number; y?: number }>(EXPAND_PREPARE);
    let result = { log: [] as string[], failures: at.failures };
    if (!at.failures.length) {
      await page.doubleClick(at.x!, at.y!);
      result = await page.evaluate<{ log: string[]; failures: string[] }>(EXPAND_CHECK);
    }
    const bad = [...result.failures, ...page.errors.map((e) => `console error: ${e}`)];
    console.log(`${bad.length ? '✖' : '✔'} playground · double-click to expand: ${result.log[0] ?? ''}`);
    problems.push(...bad.map((b) => `[playground] double-click to expand: ${b}`));
  } finally {
    await page.close();
  }
}
// ---------------------------------------------------------------- interactive elements

const CASES_DIR = join(projectRoot(), 'scripts/browser-cases');
let elementsRun = 0;
/** `ELEMENT_ONLY=<name>[,…]` limits the element cases to those case files (the page checks still run). */
const ELEMENT_ONLY = process.env.ELEMENT_ONLY ? process.env.ELEMENT_ONLY.split(',') : null;

/** Every case file in scripts/browser-cases/ (not `_*.ts`), loaded. */
async function caseFiles(): Promise<BrowserCases[]> {
  if (!existsSync(CASES_DIR)) return [];
  const out: BrowserCases[] = [];
  for (const f of readdirSync(CASES_DIR).filter((n) => n.endsWith('.ts') && !n.startsWith('_') && (!ELEMENT_ONLY || ELEMENT_ONLY.includes(n.slice(0, -3)))).sort()) {
    const mod = (await import(pathToFileURL(join(CASES_DIR, f)).href)) as { default?: BrowserCases } & Partial<BrowserCases>;
    const file = mod.default ?? (mod.element ? (mod as BrowserCases) : undefined);
    if (!file || typeof file.element !== 'string' || !Array.isArray(file.cases)) {
      problems.push(`[elements] scripts/browser-cases/${f}: export default {element, cases: [{name, scenario}]}`);
      continue;
    }
    if (file.element !== f.slice(0, -3)) problems.push(`[elements] scripts/browser-cases/${f} names element \`${file.element}\`; the file is named for its element`);
    out.push(file);
  }
  return out;
}

/** The element names a built page carries: directive hosts and cell-word modules. */
const elementsIn = (html: string) =>
  new Set([
    ...[...html.matchAll(/<docs-element\b[^>]*\sdata-element="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<cypher-cell\b[^>]*\sdata-elements="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
  ]);

/** The hosts of element `name` on a page, as a JavaScript expression: directive hosts, or the cells carrying it as a word. */
const hostsOf = (name: string) =>
  `[...document.querySelectorAll('docs-element[data-element=${JSON.stringify(name)}], cypher-cell[data-elements~=${JSON.stringify(name)}]')]`;

/** At phone width: the page does not scroll sideways, and every host fits the viewport. */
const elementFits = (name: string) => `(() => {
  const failures = [];
  const w = innerWidth, sw = document.documentElement.scrollWidth;
  if (sw > w + 1) failures.push('the page scrolls sideways at ' + w + ' px (scrollWidth ' + sw + ')');
  const hosts = ${hostsOf(name)};
  hosts.forEach((h, i) => {
    const r = h.getBoundingClientRect();
    if (r.left < -1 || r.right > w + 1) failures.push('host ' + (i + 1) + ' does not fit: ' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + w + ' px');
  });
  return { log: [w + ' px wide, ' + hosts.length + ' host(s) fit, no sideways scroll'], failures };
})()`;

/** Under prefers-reduced-motion: no CSS animation or transition runs, or would run, inside a host (a cell's element panes for a cell word). */
const elementStill = (name: string) => `(() => {
  const failures = [];
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) failures.push('prefers-reduced-motion: reduce is not in effect');
  const scopes = ${hostsOf(name)}.map((h) => h.localName === 'cypher-cell' ? h.querySelector('.cell-slot') : h).filter(Boolean);
  const moving = [];
  for (const scope of scopes) {
    for (const el of [scope, ...scope.querySelectorAll('*')]) {
      const cs = getComputedStyle(el);
      const t = cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) && cs.transitionProperty !== 'none';
      const a = cs.animationName !== 'none' && cs.animationDuration.split(',').some((d) => parseFloat(d) > 0);
      if (t || a) moving.push(el.localName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + (t ? ' (transition)' : ' (animation)'));
    }
  }
  const running = document.getAnimations().filter((x) => x.playState === 'running' && x.effect && x.effect.target && scopes.some((s) => s.contains(x.effect.target)));
  if (moving.length) failures.push('would animate: ' + moving.slice(0, 5).join(', '));
  if (running.length) failures.push(running.length + ' animation(s) running');
  return { log: [scopes.length + ' scope(s) still under reduced motion'], failures };
})()`;

/** With scripts disabled: the element's static form shows, and its live pane does not. */
const elementStatic = (name: string) => `(() => {
  const hosts = [...document.querySelectorAll('docs-element[data-element=${JSON.stringify(name)}]')];
  if (!hosts.length) return { log: ["a cell word: its static form is the cell's recorded result"], failures: document.querySelector('cypher-cell[data-elements~=${JSON.stringify(name)}] .out-label') ? [] : ['no cell carries it'] };
  const failures = [];
  hosts.forEach((h, i) => {
    const s = h.querySelector(':scope > .element-static');
    if (!s || s.hidden || s.getBoundingClientRect().height === 0) failures.push('element ' + (i + 1) + ': the static form does not show');
    else if (!s.textContent.trim() && !s.querySelector('svg')) failures.push('element ' + (i + 1) + ': the static form is empty');
    if (!/Live: /.test(s?.textContent ?? '')) failures.push('element ' + (i + 1) + ': the static form has no Live line');
    const l = h.querySelector(':scope > .element-live');
    if (l && !l.hidden) failures.push('element ' + (i + 1) + ': the live pane shows without JavaScript');
  });
  return { log: [hosts.length + ' host(s), static form shown'], failures };
})()`;

/** On load: an element out of reach has not loaded its module, and nothing loaded the engine. */
const elementLazy = (name: string) => `(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const host = document.querySelector('docs-element[data-element=${JSON.stringify(name)}], cypher-cell[data-elements~=${JSON.stringify(name)}]');
  const failures = [];
  const names = performance.getEntriesByType('resource').map((e) => e.name);
  if (names.some((n) => /relate_bg\\.wasm|\\/wasm\\/relate\\.js/.test(n))) failures.push('the engine loaded with the page');
  const far = host && host.getBoundingClientRect().top > innerHeight + 700;
  const chunk = names.find((n) => n.includes('/_astro/' + ${JSON.stringify(name)} + '.') && n.endsWith('.js'));
  if (far && chunk) failures.push('its module loaded with the page, out of reach: ' + chunk);
  return { log: [far ? 'out of reach on load, module not loaded' : 'within reach on load (the module may load at once)'], failures };
})()`;

/** Each element case file on the first built page with its element; an element with no case file fails. */
async function checkElements(builtDocs: string[]) {
  const files = await caseFiles();
  const byElement = new Map(files.map((f) => [f.element, f]));
  const carried = new Map<string, string>();
  for (const file of builtDocs) {
    for (const name of elementsIn(readFileSync(file, 'utf8'))) {
      if (!carried.has(name)) carried.set(name, `/docs/${file.slice(docsDir.length + 1, -'index.html'.length)}`);
    }
  }
  for (const name of carried.keys()) {
    if (!byElement.has(name) && !ELEMENT_ONLY) problems.push(`[elements] ${carried.get(name)} carries \`${name}\`, which has no case file (scripts/browser-cases/${name}.ts)`);
  }
  for (const file of files) {
    const path = carried.get(file.element);
    if (!path) {
      console.log(`- docs: no built docs page carries \`${file.element}\`; its cases are skipped (DOCS_EXAMPLES=1 npm run build adds the example page)`);
      continue;
    }
    const label = path.slice(1, -1);
    elementsRun++;
    for (const [width, open] of [[1400, { scripts: false }], [390, { scripts: false, viewport: PHONE }]] as const) {
      const off = await openPage(chrome.http, `${site.url}${path}`, open);
      try {
        const shown = await off.evaluate<Outcome>(elementStatic(file.element));
        const fits = width === 390 ? await off.evaluate<Outcome>(elementFits(file.element)) : { log: [], failures: [] };
        const failures = [...shown.failures, ...fits.failures];
        console.log(`${failures.length ? '✖' : '✔'} ${label} · ${file.element}: static form without JavaScript at ${width} px: ${shown.log[0] ?? ''}`);
        problems.push(...failures.map((f) => `[${label}] ${file.element} static form at ${width} px: ${f}`));
      } finally {
        await off.close();
      }
    }
    await check(`${file.element}: lazy`, label, path, elementLazy(file.element));
    for (const c of file.cases) await runCase(`${file.element}: ${c.name}`, label, path, c.scenario);
    const first = file.cases[0];
    if (first) {
      await runCase(`${file.element}: ${first.name} (390 px)`, label, path, first.scenario, { viewport: PHONE }, elementFits(file.element));
      await runCase(`${file.element}: ${first.name} (reduced motion)`, label, path, first.scenario, { reducedMotion: true }, elementStill(file.element));
    }
  }
}

/** A phone's viewport (CSS px), for the element checks at phone width. */
const PHONE = { width: 390, height: 844, mobile: true };

/** One element case in a fresh tab opened with `open`; `after`, an expression resolving to {log, failures}, then runs in the same tab. */
async function runCase(name: string, label: string, path: string, scenario: string | ((tab: BrowserTab) => Promise<Outcome>), open: OpenOptions = {}, after?: string) {
  const tab = await openPage(chrome.http, `${site.url}${path}`, open);
  try {
    const out = typeof scenario === 'string' ? await tab.evaluate<Outcome>(scenario) : await scenario(tab as BrowserTab);
    const then = after ? await tab.evaluate<Outcome>(after) : { log: [], failures: [] };
    const bad = [...out.failures, ...then.failures, ...tab.errors.map((e) => `console error: ${e}`)];
    console.log(`${bad.length ? '✖' : '✔'} ${label} · ${name}: ${[out.log[0], then.log[0]].filter(Boolean).join('; ')}`);
    problems.push(...bad.map((b) => `[${label}] ${name}: ${b}`));
  } finally {
    await tab.close();
  }
}

// ---------------------------------------------------------------- the script budget, measured

/**
 * What each docs page with the page runtime (and one page without) loads
 * before any interaction, against the static count of budget.ts: a page
 * that loads a script the count does not see (an `import()` run as the page
 * loads), or more than the budget, fails. What loads when it comes near the
 * viewport (element modules, the graph view, and what they import) is left
 * out, as the budget leaves out lazy chunks.
 */
async function checkLoadedScripts(builtDocs: string[]) {
  if (!builtDocs.length) return;
  const read = distReader(DIST);
  const astro = join(DIST, '_astro');
  const elementDir = join(projectRoot(), 'src/scripts/docs/elements');
  const nearChunks = new Set(['graph', ...(existsSync(elementDir) ? readdirSync(elementDir).filter((f) => f.endsWith('.ts') && !f.startsWith('_')).map((f) => f.slice(0, -3)) : [])]);
  const lazy = new Set<string>();
  for (const f of existsSync(astro) ? readdirSync(astro) : []) {
    if (!f.endsWith('.js') || !nearChunks.has(f.replace(/\.[\w-]+\.js$/, ''))) continue;
    for (const x of eagerScripts(`<script type="module" src="/_astro/${f}"></script>`, '/', read).files) lazy.add(x.path);
  }
  const withRuntime = builtDocs.filter((f) => /id="engineBar"/.test(readFileSync(f, 'utf8')));
  const without = builtDocs.find((f) => !withRuntime.includes(f));
  let largest = { page: '', bytes: 0 };
  const before = problems.length;
  for (const file of without ? [...withRuntime, without] : withRuntime) {
    const path = `/docs/${file.slice(docsDir.length + 1, -'index.html'.length)}`;
    const label = path.slice(1, -1);
    const counted = eagerScripts(readFileSync(file, 'utf8'), path, read);
    const eager = new Set(counted.files.map((f) => f.path));
    const tab = await openPage(chrome.http, `${site.url}${path}`);
    try {
      const loaded = await tab.evaluate<string[]>(`(async () => {
        await new Promise((r) => setTimeout(r, 600));
        return [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name)).filter((u) => u.origin === location.origin && u.pathname.endsWith('.js')).map((u) => u.pathname))];
      })()`);
      const counting = loaded.filter((p) => eager.has(p) || !lazy.has(p));
      const size = (p: string) => Buffer.byteLength(read(p) ?? '');
      const bytes = counted.inline + counting.reduce((n, p) => n + size(p), 0);
      const unseen = counting.filter((p) => !eager.has(p));
      if (bytes > largest.bytes) largest = { page: path, bytes };
      if (unseen.length) problems.push(`[${label}] script budget: loads ${unseen.map((p) => `${p} (${kb(size(p))})`).join(', ')} before any interaction, which the static count (budget.ts) does not see`);
      if (bytes > PAGE_JS_BUDGET) problems.push(`[${label}] script budget: loads ${kb(bytes)} of JavaScript before any interaction, over ${kb(PAGE_JS_BUDGET)}`);
      problems.push(...tab.errors.map((e) => `[${label}] script budget: console error: ${e}`));
    } finally {
      await tab.close();
    }
  }
  console.log(`${problems.length > before ? '✖' : '✔'} docs · script budget, measured on ${withRuntime.length + (without ? 1 : 0)} page(s): the largest loads ${kb(largest.bytes)} before any interaction (${largest.page})`);
}

const recipePage = (slug: string) => `/cookbook/${slug}/`;
const playgroundLink = (slug: string, cell: string | null = null) =>
  `/playground/#recipe=${encodeURIComponent(slug)}${cell ? `&cell=${encodeURIComponent(cell)}` : ''}`;

try {
  for (const slug of slugs) await check('run all', slug, recipePage(slug), RUN_ALL);
  for (const slug of slugs) await check('graph view', slug, recipePage(slug), GRAPH);
  if (slugs.includes(CONTROLS_RECIPE)) await check('controls', CONTROLS_RECIPE, recipePage(CONTROLS_RECIPE), CONTROLS);
  await check('sample data', 'playground', '/playground/', PLAYGROUND);
  await checkExpand();
  for (const slug of slugs) {
    const json = published.get(slug);
    if (!json) continue;
    const samples = json.cells.filter((c) => !c.setup).map((c) => c.title ?? c.id);
    const expect = { replayed: json.cells.length, title: json.title, editorStart: null, paramsPath: null, samples, runSample: null };
    await check('hand-off (whole recipe)', slug, playgroundLink(slug), handoff(expect));
  }
  const step = published.get(HANDOFF_STEP.slug);
  const index = step?.cells.findIndex((c) => c.id === HANDOFF_STEP.cell) ?? -1;
  if (step && index >= 0) {
    const cell = step.cells[index];
    const samples = step.cells.filter((c) => !c.setup).map((c) => c.title ?? c.id);
    const expect = {
      replayed: index,
      title: step.title,
      editorStart: cell.code.split('\n')[0],
      paramsPath: cell.paramsPath,
      samples,
      runSample: cell.title ?? cell.id,
    };
    await check(`hand-off (step ${cell.id})`, HANDOFF_STEP.slug, playgroundLink(HANDOFF_STEP.slug, cell.id), handoff(expect));
  }

  // Docs: one case per element type (DOCS-PLAN.md §8 item 4).
  if (docsPages.length === 0) console.log('- docs: no built docs page has cells yet; the docs cell cases are skipped (DOCS_EXAMPLES=1 npm run build adds the example page)');
  for (const page of docsPages) await checkDocsRun(page);
  const tabbed = existsSync(docsDir)
    ? filesUnder(docsDir).filter((f) => f.endsWith('/index.html')).sort().find((f) => /<div class="tabs\b[^"]*"[^>]*\sdata-tabs[\s>]/.test(readFileSync(f, 'utf8')))
    : undefined;
  if (tabbed) {
    const path = `/docs/${tabbed.slice(docsDir.length + 1, -'index.html'.length)}`;
    await check('a tab set switches', path.slice(1, -1), path, DOCS_TABS);
  }
  // Phase 2 constructs, each on the first built page that has it.
  const builtDocs = existsSync(docsDir) ? filesUnder(docsDir).filter((f) => f.endsWith('/index.html')).sort() : [];
  const withConstruct = (marker: string) => {
    const f = builtDocs.find((file) => readFileSync(file, 'utf8').includes(marker));
    return f ? `/docs/${f.slice(docsDir.length + 1, -'index.html'.length)}` : null;
  };
  const constructCases: [string, string, string[]][] = [
    ['an agentic set switches and is remembered', 'data-agentic', [DOCS_AGENTIC, DOCS_AGENTIC_KEPT]],
    ['the language picker switches every tab set and is remembered', '<lang-picker', [DOCS_PICKER, DOCS_PICKER_KEPT]],
    ['each deeplink decodes to the JSON it shows', 'data-deeplink-href', [DOCS_DEEPLINK]],
  ];
  for (const [name, marker, scenarios] of constructCases) {
    const path = withConstruct(marker);
    if (!path) {
      console.log(`- docs: no built docs page has ${marker}; "${name}" is skipped (DOCS_EXAMPLES=1 npm run build adds the example page)`);
      continue;
    }
    for (const [i, scenario] of scenarios.entries()) await check(i ? `${name} (a new tab)` : name, path.slice(1, -1), path, scenario);
  }
  await checkElements(builtDocs);
  await checkLoadedScripts(builtDocs);
  const graphPage = docsPages.find((p) => /data-graph-nodes="1"/.test(p.html));
  if (graphPage) await checkDocsGraph(graphPage);
  else if (docsPages.length) console.log('- docs: no docs page has a one-node graph result; the expansion case is skipped');
  await checkToggletip();
  for (const page of docsPages) {
    const twin = readFileSync(join(docsDir, `${page.id}.md`), 'utf8');
    const { title, cells } = twinCells(twin);
    const docsLink = (cell: string | null = null) =>
      `/playground/#docs=${encodeURIComponent(page.id)}${cell ? `&cell=${encodeURIComponent(cell)}` : ''}`;
    const samples = [...new Set(cells.map((c) => c.title ?? c.id))];
    const nouns = { whole: 'page', part: 'cell' };
    const label = `docs/${page.id}`;
    await check('hand-off (whole page)', label, docsLink(), handoff({ replayed: cells.length, title: title ?? page.id, editorStart: null, paramsPath: null, samples, runSample: null, ...nouns }));
    const index = cells.findIndex((c) => c.params !== null);
    if (index >= 0) {
      const cell = cells[index];
      const expect = { replayed: index, title: title ?? page.id, editorStart: cell.code.split('\n')[0], paramsPath: cell.params, samples, runSample: null, ...nouns };
      await check(`hand-off (cell ${cell.id})`, label, docsLink(cell.id), handoff(expect));
    }
  }
} finally {
  await chrome.kill();
  site.close();
}

if (problems.length) {
  console.error(`\n${problems.length} browser problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `cookbook-browser: ${slugs.length} recipes run in the browser and match their recordings; ` +
    'the playground loads and expands a node, and every recipe opens in it; ' +
    `${docsPages.length} docs page(s) with cells run, match and open in the playground; ` +
    `${elementsRun} interactive element(s) pass their cases`,
);

// What an interactive element's cookbook:browser case file
// (scripts/browser-cases/<name>.ts) is made of. scripts/cookbook-browser.ts
// finds every case file in this directory, opens the first built docs page
// that carries the element, and runs the file's cases in order, each in a
// fresh tab. Before them it checks, for every element, that the static form
// shows with scripts disabled (at 1400 px and at 390 px, where nothing may
// scroll the page sideways) and that neither the element's module nor the
// engine loaded with the page. After them it runs the file's first case
// twice more: at phone width (390 x 844, a mobile viewport), then checks
// that the page does not scroll sideways and every host fits; and under
// prefers-reduced-motion: reduce, then checks that no CSS animation or
// transition runs inside a host. A case that needs either on its own sets
// it with `tab.viewport` or `tab.emulateMedia`.
//
// A scenario is either
//   - a string: one JavaScript expression evaluated in the page, awaited,
//     that resolves to {log: string[], failures: string[]} (`scenario(body)`
//     wraps a function body with the helpers below in scope), or
//   - a function given the tab (`BrowserTab`: evaluate, click, doubleClick,
//     press, swipe, all real CDP input), for a case that needs real input events,
//     resolving to the same {log, failures}.
// `log[0]` is printed beside the case's name; every failure, and every
// console error the page logged, fails the run.

export interface Outcome {
  log: string[];
  failures: string[];
}

/** A tab in headless Chrome, as cookbook-browser.ts's openPage gives it. */
export interface BrowserTab {
  evaluate<T>(expression: string): Promise<T>;
  click(x: number, y: number): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  /** `modifiers` is CDP's bit field: Alt 1, Ctrl 2, Meta 4, Shift 8. */
  press(key: string, code?: string, keyCode?: number, modifiers?: number): Promise<void>;
  /** Resize the viewport (CSS px); `mobile` emulates a phone (meta viewport, overlay scrollbars). The page reflows in place. */
  viewport(width: number, height: number, options?: { mobile?: boolean }): Promise<void>;
  /** Emulate `prefers-reduced-motion: reduce` (true) or no preference (false); media queries and `matchMedia` listeners see it at once. */
  emulateMedia(options: { reducedMotion: boolean }): Promise<void>;
  /** Navigate the tab to `url` (same origin as the page, or absolute) and wait until it has loaded. */
  navigate(url: string): Promise<void>;
  /** Go back one history entry and wait until the page shows; resolves whether the browser restored it from its back/forward cache. */
  back(): Promise<{ restored: boolean }>;
  /**
   * A real one-finger swipe from (x0, y0) to (x1, y1) in `steps` moves (CDP
   * Input.dispatchTouchEvent, with touch emulation on): the browser decides
   * whether the page scrolls and fires pointercancel as it would for a
   * finger, which synthetic PointerEvents never do. A swipe to the same
   * point is a tap.
   */
  swipe(x0: number, y0: number, x1: number, y1: number, steps?: number): Promise<void>;
  errors: string[];
}

export interface BrowserCase {
  name: string;
  scenario: string | ((tab: BrowserTab) => Promise<Outcome>);
}

/** A case file's default export. `element` is the directive name, or a cell word's module name. */
export interface BrowserCases {
  element: string;
  cases: BrowserCase[];
}

/**
 * Helpers in scope for `scenario(body)`:
 *   wait(ms); until(test, ms = 10000) polls test() until truthy (returns its value);
 *   idle() waits for the engine bar's run to finish;
 *   host(name) the first <docs-element> of that name;
 *   live(name) scrolls it to the centre and waits until its module called showLive() (returns the host, or null);
 *   expect(log, failures, name, ok, detail?) records one check;
 *   engineLoaded() whether the engine has started: the WASM files, or the
 *     cell runtime's module worker that fetches them (the worker's own
 *     fetches never reach the page's resource timing);
 *   recordedOf(id) a cell's recorded {envelope, graph}: a docs cell carries it
 *     in data-recorded, a recipe step's comes from results.json beside the page.
 */
export const PRELUDE = `
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms = 10000) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = test(); if (v) return v; await wait(50); } return test(); };
const idle = async () => { const stop = document.querySelector('#engineBar [data-action=stop]'); await wait(100); await until(() => !stop || stop.hidden, 180000); };
const host = (name) => document.querySelector('docs-element[data-element="' + name + '"]');
const live = async (name) => { const h = host(name); if (!h) return null; h.scrollIntoView({ block: 'center' }); return (await until(() => h.dataset.state === 'live', 15000)) ? h : null; };
const expect = (log, failures, name, ok, detail) => { log.push((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : '')); if (!ok) failures.push(name + (detail ? ': ' + detail : '')); };
const engineLoaded = () => performance.getEntriesByType('resource').some((e) => /relate_bg\\.wasm|\\/wasm\\/relate\\.js|\\/_astro\\/worker-[\\w-]+\\.js/.test(e.name));
const recordedOf = async (id) => {
  const c = document.querySelector('cypher-cell[data-cell="' + id + '"]');
  if (c && c.dataset.recorded) return JSON.parse(c.dataset.recorded);
  const all = await (await fetch(new URL('results.json', location.origin + location.pathname.replace(/\\/?$/, '/')))).json();
  return all[id];
};
`;

/** A scenario from a function body that returns {log, failures}, with PRELUDE's helpers in scope. */
export const scenario = (body: string) => `(async () => {${PRELUDE}\n${body}\n})()`;

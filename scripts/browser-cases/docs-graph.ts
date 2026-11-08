// cookbook:browser cases for `:::docs-graph`, the docs graph, live
// (src/lib/docs/elements/docs-graph.ts): nothing of the view loads with the
// page; it draws every published page from /docs/graph-view.json without the
// engine; a search enlarges the matching nodes and dims the rest on the
// canvas (read back from NVL); the Glossary terms toggle adds the Term nodes;
// a real click on a node opens its page; the toolbar answers real keys; under
// reduced motion nothing on the canvas moves and Fit jumps; a theme switch
// repaints the dimmed nodes; and an NVL that cannot draw leaves the static
// form in place.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** The view's data, fetched as the page does (the browser cache answers). */
const VIEW = `const view = await (await fetch('/docs/graph-view.json')).json();`;

/** Bring the element live and wait until NVL has drawn its canvas. `h.docsGraph` reads NVL's state. */
const UP = `
  const h = await live('docs-graph');
  if (!h) return { log: [], failures: ['the element did not go live (state ' + (host('docs-graph') || {}).dataset?.state + ')'] };
  const root = h.querySelector('.docs-graph');
  await until(() => root && root.dataset.drawnNodes && h.querySelector('.dg-stage canvas') && h.docsGraph, 15000);
  if (!h.docsGraph) return { log: [], failures: ['the view did not draw'] };
  // The site scrolls smoothly (base.css), so live()'s scroll is still running: put the stage in view at once and let the page settle.
  h.querySelector('.dg-stage').scrollIntoView({ block: 'center', behavior: 'instant' });
  for (let y = -1, i = 0; y !== scrollY && i < 40; i++) { y = scrollY; await wait(100); }
`;

/** Where each drawn page node is on screen, and the one farthest from its neighbours inside the stage, clear of the toolbar and of anything drawn over the canvas (a sticky header). */
const ISOLATED = `
  const stage = h.querySelector('.dg-stage').getBoundingClientRect();
  const tools = h.querySelector('.dg-tools').getBoundingClientRect();
  const pts = view.nodes.filter((n) => n.label === 'Page' && n.href).map((n) => ({ n, p: h.docsGraph.point(n.key) })).filter(({ p }) => p);
  const inside = pts.filter(({ p }) => p.y > 20 && p.y < innerHeight - 20 && p.x > stage.left + 20 && p.x < stage.right - 20 && p.y > stage.top + 20 && p.y < stage.bottom - 20 && !(p.x > tools.left - 10 && p.y < tools.bottom + 10) && h.querySelector('.dg-stage').contains(document.elementFromPoint(p.x, p.y)));
  let best = null, gap = -1;
  for (const a of inside) {
    const near = Math.min(...pts.filter((b) => b !== a).map((b) => Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y)));
    if (near > gap) { gap = near; best = a; }
  }
`;

/** The element's full-screen button, from outside a scenario. */
const FULL = `document.querySelector('docs-element[data-element="docs-graph"] .dg-tool[aria-pressed]')`;

/** A function case's first step: the outcome to return at once when the element never came up. */
const early = (x: object): Outcome | null => ('failures' in x ? (x as Outcome) : 'failure' in x ? { log: [], failures: [String((x as { failure: unknown }).failure)] } : null);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Press the most isolated page node in view with a real click; it opens that node's page. */
async function clickThrough(tab: BrowserTab): Promise<Outcome> {
  const target = await tab.evaluate<{ x: number; y: number; href: string; title: string } | { failure: string } | Outcome>(
    scenario(`
      ${UP}
      ${VIEW}
      await wait(300);
      ${ISOLATED}
      if (!best) return { failure: 'no page node inside the view' };
      return { x: best.p.x, y: best.p.y, href: best.n.href, title: best.n.title };
    `),
  );
  const stop = early(target);
  if (stop) return stop;
  const t = target as { x: number; y: number; href: string; title: string };
  await tab.click(t.x, t.y);
  let path = '';
  for (let i = 0; i < 100; i++) {
    try {
      path = await tab.evaluate<string>('location.pathname + location.hash');
      if (path === t.href && (await tab.evaluate<string>('document.readyState')) === 'complete') break;
    } catch {
      // The page is between documents.
    }
    await sleep(100);
  }
  const ok = path === t.href;
  return { log: [`clicked "${t.title}" at ${Math.round(t.x)},${Math.round(t.y)}: now at ${path}`], failures: ok ? [] : [`the click did not open ${t.href} (at ${path})`] };
}

export default {
  element: 'docs-graph',
  cases: [
    {
      name: 'draws every published page from graph-view.json, nothing loaded with the page, no engine',
      scenario: scenario(`
        const log = [], failures = [];
        await wait(600);
        const before = performance.getEntriesByType('resource').map((e) => e.name);
        expect(log, failures, 'neither the view data nor its modules load with the page', !before.some((n) => /\\/docs\\/graph-view\\.json|\\/_astro\\/(docs-graph|graph)\\.[\\w-]+\\.js/.test(n)), before.filter((n) => /graph/.test(n)).join(' '));
        ${UP}
        ${VIEW}
        const pages = view.nodes.filter((n) => n.label === 'Page').length;
        const drawn = Number(root.dataset.drawnNodes);
        const nvl = h.docsGraph.state();
        const canvas = h.querySelector('.dg-stage canvas');
        expect(log, failures, 'the view draws one node per published page', drawn === pages && pages === view.sections.reduce((t, s) => t + s.pages, 0) && pages > 100, drawn + ' of ' + pages);
        expect(log, failures, 'NVL holds exactly the drawn nodes and relationships', Object.keys(nvl.nodes).length === drawn && Object.keys(nvl.rels).length === Number(root.dataset.drawnRels) && drawn > 0, Object.keys(nvl.nodes).length + ' nodes, ' + Object.keys(nvl.rels).length + ' relationships');
        expect(log, failures, 'relationships are drawn', Number(root.dataset.drawnRels) > 0, root.dataset.drawnRels);
        const pageNodes = view.nodes.filter((n) => n.label === 'Page');
        const [pa, pb] = [pageNodes[0], pageNodes[pageNodes.length - 1]];
        const [sa, sb] = [h.docsGraph.point(pa.key), h.docsGraph.point(pb.key)];
        const dx = (pa.x - pb.x) * nvl.scale, dy = (pa.y - pb.y) * nvl.scale; // scale: CSS pixels per layout unit
        expect(log, failures, 'NVL draws the pages where the build put them', sa && sb && Math.abs(sa.x - sb.x - dx) < 1.5 && Math.abs(sa.y - sb.y - dy) < 1.5, sa && sb ? Math.round(sa.x - sb.x) + ',' + Math.round(sa.y - sb.y) + ' vs ' + Math.round(dx) + ',' + Math.round(dy) : 'not drawn');
        expect(log, failures, 'the canvas has a size', canvas.clientWidth > 200 && canvas.clientHeight > 200, canvas.clientWidth + 'x' + canvas.clientHeight);
        expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
        const said = h.querySelector('.dg-said').textContent;
        expect(log, failures, 'the status line counts what is drawn and the whole graph', /^Drawing [\\d,]+ nodes and [\\d,]+ relationships of the docs graph's [\\d,]+ and [\\d,]+\\.$/.test(said), said);
        const totalNodes = Object.values(view.counts.nodes).reduce((t, n) => t + n, 0);
        expect(log, failures, 'the counts table sums to the whole graph', h.querySelector('.dg-counts summary').textContent.includes(totalNodes.toLocaleString('en-US') + ' nodes'), h.querySelector('.dg-counts summary').textContent);
        expect(log, failures, 'every section has a key with its page count', view.sections.every((s) => h.querySelector('.dg-key').textContent.includes(s.label + ' ' + s.pages)));
        expect(log, failures, 'the engine is not loaded', !engineLoaded());
        expect(log, failures, 'graph.json (several MB) is not fetched', !performance.getEntriesByType('resource').some((e) => /\\/docs\\/graph\\.json/.test(e.name)));
        const tools = [...h.querySelectorAll('.dg-tool')];
        expect(log, failures, 'every tool has an accessible name', tools.length === 4 && tools.every((b) => b.getAttribute('aria-label')));
        expect(log, failures, 'the stage fits the viewport', h.querySelector('.dg-stage').getBoundingClientRect().right <= innerWidth + 1);
        return { log: [drawn + ' pages, ' + root.dataset.drawnRels + ' relationships drawn; ' + log.filter((l) => l.startsWith('FAIL')).length + ' failed'], failures };
      `),
    },
    {
      name: 'a search enlarges the matching nodes and dims the rest on the canvas',
      scenario: scenario(`
        const log = [], failures = [];
        ${UP}
        ${VIEW}
        const input = h.querySelector('.dg-search input');
        const pageKeys = view.nodes.filter((n) => n.label === 'Page').map((n) => n.key);
        const base = h.docsGraph.state();
        input.value = 'mcp';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => root.dataset.matches !== '0', 5000);
        const hits = view.nodes.filter((n) => n.label === 'Page' && n.title.toLowerCase().includes('mcp')).map((n) => n.key);
        const found = Number(root.dataset.matches);
        const said = h.querySelector('.dg-said').textContent;
        const listed = h.querySelectorAll('.dg-matches li a').length;
        const s = h.docsGraph.state();
        const miss = pageKeys.filter((k) => !hits.includes(k));
        expect(log, failures, 'the matches are the pages whose title holds the words', found === hits.length && found >= 1, found + ' vs ' + hits.length);
        expect(log, failures, 'NVL draws every match larger, in its own colour', hits.every((k) => s.nodes[k].size > base.nodes[k].size && s.nodes[k].color === base.nodes[k].color), hits.map((k) => s.nodes[k].size + '/' + base.nodes[k].size).slice(0, 3).join(' '));
        expect(log, failures, 'NVL paints every other node in the dimmed colour', miss.every((k) => s.nodes[k].color === s.dimmed && s.nodes[k].size === base.nodes[k].size), s.dimmed + ', e.g. ' + s.nodes[miss[0]].color);
        expect(log, failures, 'a relationship between two non-matches is dimmed', Object.values(s.rels).some((r) => r.color === s.dimmed));
        expect(log, failures, 'the status line says how many', said.startsWith(found + ' drawn node') && said.includes('“mcp”'), said);
        expect(log, failures, 'the matches are listed as links', listed === Math.min(found, 8), listed + ' links');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await until(() => root.dataset.matches === '0', 5000);
        const back = h.docsGraph.state();
        expect(log, failures, 'Escape clears the search', input.value === '' && root.dataset.matches === '0' && h.querySelector('.dg-matches').hidden);
        expect(log, failures, 'and NVL draws every node as before', pageKeys.every((k) => back.nodes[k].color === base.nodes[k].color && back.nodes[k].size === base.nodes[k].size));
        return { log: [found + ' nodes match "mcp"; ' + said], failures };
      `),
    },
    {
      name: 'the Glossary terms toggle adds the Term nodes',
      scenario: scenario(`
        const log = [], failures = [];
        ${UP}
        ${VIEW}
        const before = Number(root.dataset.drawnNodes);
        const terms = view.nodes.filter((n) => n.label === 'Term');
        const box = h.querySelector('.dg-kinds input[value="Term"]');
        box.click();
        await until(() => Number(root.dataset.drawnNodes) > before, 5000);
        const after = Number(root.dataset.drawnNodes);
        const s = h.docsGraph.state();
        expect(log, failures, 'every Term node is added', after - before === terms.length && terms.length > 0, before + ' + ' + terms.length + ' = ' + after);
        expect(log, failures, 'NVL draws them', terms.every((t) => s.nodes[t.key]));
        expect(log, failures, 'a term is on screen', !!h.docsGraph.point(terms[0].key));
        box.click();
        await until(() => Number(root.dataset.drawnNodes) === before, 5000);
        expect(log, failures, 'turning it off takes them away', Number(root.dataset.drawnNodes) === before && h.docsGraph.point(terms[0].key) === null && !h.docsGraph.state().nodes[terms[0].key]);
        return { log: [before + ' -> ' + after + ' nodes with the terms'], failures };
      `),
    },
    {
      name: 'a real click on a node opens its page',
      scenario: async (tab: BrowserTab): Promise<Outcome> => clickThrough(tab),
    },
    {
      name: 'at phone width, a real click lands on its node (a device pixel ratio of 3)',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.viewport(390, 844, { mobile: true });
        return clickThrough(tab);
      },
    },
    {
      name: 'the toolbar answers real keys; Escape in the search leaves full screen on',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const before = await tab.evaluate<{ scale: number } | Outcome>(
          scenario(`
            ${UP}
            const zoom = h.querySelector('.dg-tool[aria-label="Zoom in"]');
            window.__dgPresses = 0;
            zoom.addEventListener('click', () => window.__dgPresses++);
            zoom.focus();
            return { scale: h.docsGraph.state().scale };
          `),
        );
        const stop = early(before);
        if (stop) return stop;
        const b = before as { scale: number };
        const failures: string[] = [];
        // Space activates a focused button on its key-up, as for a reader at a keyboard.
        await tab.press(' ', 'Space', 32);
        // NVL applies a zoom on its next animation frame. Headless Chrome stops
        // producing frames after a CDP key event unless the tab emulates focus
        // (a request on openPage); without frames the scale cannot be read, and
        // the zoom itself is checked by a click in the reduced-motion case.
        const after = await tab.evaluate<{ presses: number; focused: boolean; frames: boolean; scale: number }>(`(async () => {
          const h = document.querySelector('docs-element[data-element="docs-graph"]');
          const frames = await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), new Promise((r) => setTimeout(() => r(false), 500))]);
          return { presses: window.__dgPresses, focused: document.activeElement === h.querySelector('.dg-tool[aria-label="Zoom in"]'), frames, scale: h.docsGraph.state().scale };
        })()`);
        if (after.presses !== 1) failures.push(`Space on Zoom in pressed it ${after.presses} times, not once`);
        if (!after.focused) failures.push('the Zoom in button lost focus');
        if (after.frames && !(after.scale > b.scale * 1.2)) failures.push(`Space on Zoom in did not zoom (scale ${b.scale.toFixed(3)} -> ${after.scale.toFixed(3)})`);
        const zoomed = after.frames ? `scale ${b.scale.toFixed(2)} -> ${after.scale.toFixed(2)}` : 'pressed (no frames after a CDP key: scale not read)';
        await tab.evaluate(`${FULL}.focus()`);
        await tab.press(' ', 'Space', 32);
        await sleep(500);
        const full = await tab.evaluate<string>(`${FULL}.getAttribute('aria-pressed')`);
        if (full !== 'true') failures.push(`Space on Full screen left aria-pressed at ${full}`);
        // In full screen: the first Escape in a search box with text clears it, and full screen stays.
        await tab.evaluate(`(() => { const i = document.querySelector('docs-element[data-element="docs-graph"] .dg-search input'); i.focus(); i.value = 'mcp'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(300);
        await tab.press('Escape', 'Escape', 27);
        await sleep(500);
        const mid = await tab.evaluate<{ pressed: string; value: string }>(
          `({ pressed: ${FULL}.getAttribute('aria-pressed'), value: document.querySelector('docs-element[data-element="docs-graph"] .dg-search input').value })`,
        );
        if (mid.value !== '') failures.push(`Escape left "${mid.value}" in the search box`);
        if (mid.pressed !== 'true') failures.push('the Escape that cleared the search also left full screen');
        await tab.press('Escape', 'Escape', 27);
        await sleep(600);
        const back = await tab.evaluate<string>(`${FULL}.getAttribute('aria-pressed')`);
        if (back !== 'false') failures.push(`a second Escape left full screen on (aria-pressed ${back})`);
        return { log: [`Space on Zoom in: ${zoomed}; full screen ${full}; Escape in the search: cleared, full screen ${mid.pressed}; Escape again: ${back}`], failures };
      },
    },
    {
      name: 'under reduced motion nothing on the canvas moves and Fit jumps',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.emulateMedia({ reducedMotion: true });
        const out = await tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${UP}
            ${VIEW}
            const keys = view.nodes.filter((n) => n.label === 'Page').slice(0, 20).map((n) => n.key);
            const at = () => keys.map((k) => h.docsGraph.point(k)).map((p) => p ? Math.round(p.x) + ',' + Math.round(p.y) : '-').join(' ');
            const first = at();
            await wait(600);
            expect(log, failures, 'the layout holds still after it draws', at() === first);
            h.querySelector('.dg-tool[aria-label="Zoom in"]').click();
            h.querySelector('.dg-tool[aria-label="Zoom in"]').click();
            await wait(100);
            const zoomed = h.docsGraph.state().scale;
            h.querySelector('.dg-tool[aria-label="Fit the graph to the view"]').click();
            // Sample NVL's camera on the frames after Fit: a jump has its final scale on the first.
            const scales = [];
            for (let i = 0; i < 12; i++) { await new Promise((r) => requestAnimationFrame(r)); scales.push(h.docsGraph.state().scale); }
            const fitted = at();
            await wait(600);
            expect(log, failures, 'Fit changes the scale', Math.abs(scales[0] - zoomed) > 0.01, zoomed.toFixed(3) + ' -> ' + scales[0].toFixed(3));
            expect(log, failures, 'Fit jumps: the scale holds from the first frame', scales.every((s) => Math.abs(s - scales[0]) < 1e-6), scales.map((s) => s.toFixed(3)).join(' '));
            expect(log, failures, 'and nothing moves after it', at() === fitted && fitted !== '');
            return { log: [log.filter((l) => l.startsWith('ok')).length + ' of 4 still'], failures };
          `),
        );
        await tab.emulateMedia({ reducedMotion: false });
        return out;
      },
    },
    {
      name: 'a theme switch repaints the dimmed nodes and the lines',
      scenario: scenario(`
        const log = [], failures = [];
        ${UP}
        ${VIEW}
        const input = h.querySelector('.dg-search input');
        input.value = 'mcp';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => root.dataset.matches !== '0', 5000);
        const miss = view.nodes.find((n) => n.label === 'Page' && !n.title.toLowerCase().includes('mcp')).key;
        const day = h.docsGraph.state();
        const was = document.documentElement.dataset.theme;
        const other = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase() === '#002b43' ? 'light' : 'dark';
        document.documentElement.dataset.theme = other;
        await wait(200);
        const night = h.docsGraph.state();
        const css = getComputedStyle(document.documentElement).getPropertyValue('--bg-inset').trim().toLowerCase();
        expect(log, failures, 'the dimmed colour follows the theme', night.dimmed.toLowerCase() === css && night.dimmed !== day.dimmed, day.dimmed + ' -> ' + night.dimmed);
        expect(log, failures, 'a dimmed node is repainted', night.nodes[miss].color === night.dimmed, night.nodes[miss].color);
        expect(log, failures, 'the lines are repainted', Object.values(night.rels).some((r, i) => r.color !== Object.values(day.rels)[i].color));
        if (was === undefined) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = was;
        return { log: ['dimmed ' + day.dimmed + ' -> ' + night.dimmed + ' (' + other + ')'], failures };
      `),
    },
    {
      name: 'an NVL that cannot draw leaves the static form in place',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        // No 2D canvas: NVL's canvas renderer cannot start, as on a browser without one.
        const out = await tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            HTMLCanvasElement.prototype.getContext = () => null;
            const h = host('docs-graph');
            h.scrollIntoView({ block: 'center' });
            await until(() => h.dataset.state === 'failed' || h.dataset.state === 'live', 15000);
            const s = h.querySelector(':scope > .element-static');
            const l = h.querySelector(':scope > .element-live');
            expect(log, failures, 'the loader marks it failed', h.dataset.state === 'failed', h.dataset.state);
            expect(log, failures, 'the static form shows', !s.hidden && s.getBoundingClientRect().height > 0 && !!s.querySelector('svg, img, table'));
            expect(log, failures, 'the live pane stays hidden and empty', l.hidden && !l.childElementCount);
            return { log: ['state ' + h.dataset.state + ', static form shown'], failures };
          `),
        );
        // The loader logs the failure as a console error; that one is expected here, any other is not.
        const expected = tab.errors.findIndex((e) => /network view|getContext|canvas|Cannot read|null/i.test(e));
        if (expected < 0) out.failures.push('the failure was not logged');
        else tab.errors.splice(expected, 1);
        return out;
      },
    },
  ],
} satisfies BrowserCases;

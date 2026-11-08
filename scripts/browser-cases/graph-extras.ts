// cookbook:browser cases for the graph view extras (DOCS-PLAN.md §7.3,
// ADR-0036): the cell words `layout=`, `caption=` and `highlight=path`
// (src/scripts/docs/elements/graph-extras.ts) and the features every graph
// view has (src/scripts/cookbook/graph.ts). They run on the first built page
// whose cells carry the words (reference/cypher/patterns); two navigate to a
// cookbook recipe, whose steps carry no words and whose graph has neighbours
// left to expand. Each reads the view's own state (`.graph-view`'s
// `graphView.state()`, from NVL) and the page's text, never a number the
// case typed in: the highlighted count is checked against the paths the
// engine returned.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** Helpers for these cases, in scope with the kit's (`scenario` bodies). */
const VIEW = `
  const cellOf = (id) => document.querySelector('cypher-cell[data-cell="' + id + '"]');
  // The cell's graph view once drawn and settled (layout done), scrolled to the centre.
  const viewOf = async (id, ms = 20000) => {
    const c = cellOf(id);
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const v = await until(() => c.querySelector('.out-graph:not([hidden]) .graph-view')?.graphView, ms);
    if (!v) return null;
    await until(() => !v.state().moving && c.querySelector('.graph-host').style.visibility !== 'hidden', ms);
    await wait(300);
    return v;
  };
  // The paths of a cell's recorded or live result, from its JSON view's envelope: the PATH columns' values.
  const recordedPaths = (id) => {
    const env = JSON.parse(cellOf(id).dataset.recorded).envelope;
    const cols = env.columns.filter((c, i) => env.columnTypes[i] === 'PATH');
    return env.rows.flatMap((r) => cols.map((c) => r[c]));
  };
  const moved = (a, b) => Object.keys(a).filter((k) => b[k] && Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y) > 2).length;
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
  // A view settled: no layout running, and the canvas shown.
  const settled = async (v, ms = 20000) => { await wait(200); await until(() => !v.state().moving && !v.state().hidden, ms); await wait(500); };
  // A cookbook step's graph view: the step's Graph tab pressed (a recipe page shows the table first).
  const stepView = async (id, ms = 30000) => {
    const c = cellOf(id);
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const tab = await until(() => { const b = c.querySelector('[data-view=graph]'); return b && !b.hidden ? b : null; }, ms);
    if (!tab) return null;
    tab.click();
    return viewOf(id, ms);
  };
  // Synthetic pointer input at a viewport point, delivered to whatever is on top there (as a real tap would be).
  const fire = (type, x, y, init = {}) => {
    const target = document.elementFromPoint(x, y);
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, ...init }));
    return target;
  };
`;

const view = (body: string) => scenario(`${VIEW}\n${body}`);

/** The screen point of node `key` (an NVL id) in cell `id`'s view, scrolled into view: for a real click. */
const nodePoint = (id: string, key: string) =>
  view(`
    const c = cellOf(${JSON.stringify(id)});
    const v = await viewOf(${JSON.stringify(id)});
    // The canvas itself in the middle of the viewport: the cell's code can push it below the fold.
    c.querySelector('.graph-stage').scrollIntoView({ block: 'center' });
    await wait(300);
    const p = v.state().screen[${JSON.stringify(key)}];
    return { log: [], failures: p ? [] : ['no screen point for ${key}'], x: p?.x, y: p?.y };
  `);

export default {
  element: 'graph-extras',
  cases: [
    {
      // The first case brings the element fully live: the runner repeats it at 390 px and under reduced motion.
      name: 'the words set the views: a path highlighted, a hierarchy in layers',
      scenario: view(`
        const log = [], failures = [];
        const v = await viewOf('named-path');
        expect(log, failures, 'the named-path view draws', !!v);
        if (!v) return { log, failures };
        const s = v.state();
        const [path] = recordedPaths('named-path');
        const nodes = path.filter((x) => x.kind === 'node').length, rels = path.length - nodes;
        expect(log, failures, 'the path is highlighted (highlight=path)', s.highlight && s.paths === 1, JSON.stringify({ highlight: s.highlight, paths: s.paths }));
        expect(log, failures, 'every element of the path is drawn on top', s.highlighted.nodes === nodes && s.highlighted.rels === rels, s.highlighted.nodes + '/' + nodes + ' nodes, ' + s.highlighted.rels + '/' + rels + ' relationships');
        const graph = JSON.parse(cellOf('named-path').dataset.recorded).graph;
        const off = graph.nodes.length - nodes + graph.rels.length - rels;
        expect(log, failures, 'the rest is dimmed', s.dimmed === off, s.dimmed + ' dimmed of ' + off);
        const key = cellOf('named-path').querySelector('.graph-path-key')?.textContent ?? '';
        expect(log, failures, 'the legend names the path in order', /^Path \\(2 hops\\): Ada → Grace → opencypher-tck$/.test(key), key);
        const btn = cellOf('named-path').querySelector('.graph-highlight');
        expect(log, failures, 'the Highlight path button shows, pressed', btn && !btn.hidden && btn.getAttribute('aria-pressed') === 'true');
        const note = cellOf('named-path').querySelector('.cell-slot-pane[data-slot="graph-extras"] .graph-extras-note')?.textContent ?? '';
        expect(log, failures, 'the cell says in words what is highlighted', /drawn on top: 3 nodes and 2 relationships/.test(note), note);
        const t = await viewOf('dependency-tree');
        expect(log, failures, 'the dependency-tree view draws', !!t);
        if (!t) return { log, failures };
        const ts = t.state();
        expect(log, failures, 'layout=hierarchical starts it in layers', ts.layout === 'hierarchical' && cellOf('dependency-tree').querySelector('.graph-layout select').value === 'hierarchical', ts.layout);
        // app, then cli and engine, then parser and storage, then lexer: four rows, each node of a row at one height.
        const caps = ts.captions, ys = {};
        for (const [k, p] of Object.entries(ts.positions)) ys[caps[k]] = p.y;
        const rows = [...new Set(Object.values(ys).map((y) => Math.round(y)))].sort((a, b) => a - b);
        const below = (a, b) => ys[a] < ys[b] - 1;
        expect(log, failures, 'each package is drawn below the packages that depend on it', below('app', 'cli') && below('app', 'engine') && below('cli', 'parser') && below('engine', 'parser') && below('parser', 'lexer') && below('engine', 'storage'), JSON.stringify(ys));
        expect(log, failures, 'four layers', rows.length === 4, rows.length + ' distinct heights');
        expect(log, failures, 'no engine needed to draw a recording', !engineLoaded());
        return { log: [s.highlighted.nodes + ' nodes and ' + s.highlighted.rels + ' relationships highlighted, ' + s.dimmed + ' dimmed; the tree in ' + rows.length + ' layers; ' + log.filter((l) => l.startsWith('FAIL')).length + ' failed'], failures };
      `),
    },
    {
      name: 'a run highlights the path the engine returns, and the toggle works from the keyboard',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const run = await tab.evaluate<Outcome & { hops?: number }>(
          view(`
            const log = [], failures = [];
            const c = cellOf('shortest-path');
            const before = await viewOf('shortest-path');
            if (!before) return { log, failures: ['the shortest-path view did not draw'] };
            c.querySelector('[data-action=run]').click();
            await idle();
            const v = await until(() => { const x = c.querySelector('.graph-view')?.graphView; return x && x !== before ? x : null; }, 60000);
            if (!v) return { log, failures: ['the run drew no new view'] };
            await until(() => !v.state().moving, 20000);
            const s = v.state();
            // The run's own answer: hops, from the table the run wrote (the JSON view shows the same envelope).
            const text = c.querySelector('.out-text').textContent;
            const hops = Number((/hops: (\\d+)/.exec(text) || [])[1]);
            expect(log, failures, 'the run returned a path', hops > 0, text.slice(0, 60));
            expect(log, failures, 'the live view highlights hops + 1 nodes and hops relationships', s.highlight && s.highlighted.nodes === hops + 1 && s.highlighted.rels === hops, JSON.stringify(s.highlighted) + ' for ' + hops + ' hops');
            expect(log, failures, 'the cell is live', /Live/.test(c.querySelector('.out-label').textContent), c.querySelector('.out-label').textContent);
            c.querySelector('.graph-highlight').focus();
            return { log, failures, hops };
          `),
        );
        if (run.failures.length) return run;
        await tab.press(' ', 'Space', 32);
        const off = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('shortest-path');
            const v = c.querySelector('.graph-view').graphView;
            const btn = c.querySelector('.graph-highlight');
            await until(() => btn.getAttribute('aria-pressed') === 'false', 3000);
            const s = v.state();
            expect(log, failures, 'Space on the focused button turns the highlight off', btn.getAttribute('aria-pressed') === 'false' && !s.highlight, btn.getAttribute('aria-pressed'));
            expect(log, failures, 'nothing is highlighted or dimmed then', s.highlighted.nodes === 0 && s.highlighted.rels === 0 && s.dimmed === 0, JSON.stringify(s.highlighted) + ' dimmed ' + s.dimmed);
            expect(log, failures, 'focus stays on the button', document.activeElement === btn);
            return { log, failures };
          `),
        );
        return { log: [`live run: ${run.hops} hops highlighted, then off from the keyboard`], failures: off.failures };
      },
    },
    {
      name: 'the layout switch moves the nodes, a pinned node keeps its place, and Pin works from the keyboard',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const at = await tab.evaluate<Outcome & { x?: number; y?: number }>(nodePoint('named-path', 'n0'));
        if (at.failures.length) return at;
        // A real click on Ada holds her in the inspector; Enter on its focused Pin button pins her.
        await tab.click(at.x!, at.y!);
        const ready = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('named-path');
            const pinBtn = await until(() => [...c.querySelectorAll('.graph-inspector-actions [data-action=pin]')].find((b) => b.textContent === 'Pin'), 3000);
            expect(log, failures, 'a click holds the node, with a Pin button', !!pinBtn);
            pinBtn?.focus();
            return { log, failures };
          `),
        );
        if (ready.failures.length) return ready;
        await tab.press('Enter', 'Enter', 13);
        const out = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('named-path');
            const v = c.querySelector('.graph-view').graphView;
            await until(() => v.state().pinned.includes('n0'), 3000);
            const s0 = v.state();
            expect(log, failures, 'Enter on Pin pins it, in NVL too, with the pin drawn', s0.pinned.includes('n0') && s0.nvlPinned.includes('n0') && s0.pinIcons.includes('n0'), JSON.stringify({ pinned: s0.pinned, nvl: s0.nvlPinned, icons: s0.pinIcons }));
            const focused = document.activeElement;
            expect(log, failures, 'focus stays on the rebuilt button, now Unpin', focused && focused.matches('.graph-inspector-actions [data-action=pin]') && focused.textContent === 'Unpin', focused ? focused.tagName + ' ' + focused.textContent : 'none');
            const before = v.state().positions;
            const select = c.querySelector('.graph-layout select');
            select.value = 'circular';
            select.dispatchEvent(new Event('change'));
            await settled(v, 15000);
            const after = v.state().positions;
            const others = Object.keys(before).filter((k) => k !== 'n0');
            const shifted = moved(Object.fromEntries(others.map((k) => [k, before[k]])), after);
            expect(log, failures, 'the circular layout moves the other nodes', v.state().layout === 'circular' && shifted >= others.length - 1, shifted + ' of ' + others.length + ' moved');
            const d = dist(after.n0, before.n0);
            expect(log, failures, 'the pinned node keeps its place', d < 2, Math.round(d) + ' px');
            select.value = 'hierarchical';
            select.dispatchEvent(new Event('change'));
            await settled(v, 15000);
            const third = v.state().positions;
            const d2 = dist(third.n0, before.n0);
            expect(log, failures, 'and through a second change', d2 < 2 && moved(after, third) > 0, Math.round(d2) + ' px');
            c.querySelector('.graph-controls [data-action=unpin-all]').click();
            const s1 = v.state();
            expect(log, failures, 'Unpin all lets it go, in NVL too, and takes the pin off', s1.pinned.length === 0 && s1.nvlPinned.length === 0 && s1.pinIcons.length === 0, JSON.stringify({ pinned: s1.pinned, nvl: s1.nvlPinned, icons: s1.pinIcons }));
            return { log: [shifted + ' of ' + others.length + ' nodes moved; the pinned node stayed within ' + Math.round(Math.max(d, d2)) + ' px'].concat(log), failures };
          `),
        );
        return { log: [out.log[0] ?? ''], failures: out.failures };
      },
    },
    {
      name: 'the caption picker lists the properties drawn and changes the captions',
      scenario: view(`
        const log = [], failures = [];
        const v = await viewOf('named-path');
        if (!v) return { log, failures: ['the named-path view did not draw'] };
        const c = cellOf('named-path');
        const graph = JSON.parse(c.dataset.recorded).graph;
        const select = c.querySelector('.graph-caption select');
        const listed = [...select.options].map((o) => o.value).filter(Boolean);
        const keys = [...new Set(graph.nodes.flatMap((n) => Object.keys(n.properties || {})))].sort();
        expect(log, failures, 'the menu lists every node property drawn', JSON.stringify(listed) === JSON.stringify(keys), listed.join(', '));
        const before = v.state().captions;
        const want = Object.fromEntries(graph.nodes.map((n) => ['n' + n.id, n.properties.role ?? n.properties.name]));
        const wrong = (caps) => Object.keys(want).filter((k) => caps[k] !== want[k]);
        // The \`caption=role\` word, as the cell-word module hands it over: it applies while the reader has chosen nothing.
        v.configure({ caption: 'role' });
        const worded = v.state();
        expect(log, failures, 'the caption word captions each node with its role, or its name when it has none', worded.caption === 'role' && select.value === 'role' && wrong(worded.captions).length === 0, wrong(worded.captions).map((k) => k + '=' + worded.captions[k]).join(', '));
        v.configure({ caption: null });
        expect(log, failures, 'and a word for the default caption goes back', JSON.stringify(v.state().captions) === JSON.stringify(before));
        select.value = 'role';
        select.dispatchEvent(new Event('change'));
        const after = v.state().captions;
        const bad = wrong(after);
        expect(log, failures, 'the menu: each node shows its role, or its name when it has none', bad.length === 0, bad.map((k) => k + '=' + after[k]).join(', '));
        expect(log, failures, 'the captions changed', Object.keys(before).some((k) => before[k] !== after[k]));
        v.configure({ caption: 'name' });
        expect(log, failures, "a word does not override the reader's choice", v.state().caption === 'role', String(v.state().caption));
        select.value = '';
        select.dispatchEvent(new Event('change'));
        expect(log, failures, 'Default goes back', JSON.stringify(v.state().captions) === JSON.stringify(before));
        return { log: [Object.values(after).join(', ')], failures };
      `),
    },
    {
      name: 'the legend lists every relationship type drawn, each in one colour',
      scenario: view(`
        const log = [], failures = [];
        const ids = ['named-path', 'dependency-tree'];
        const colours = {};
        for (const id of ids) {
          const v = await viewOf(id);
          if (!v) { failures.push(id + ' did not draw'); continue; }
          const c = cellOf(id);
          const graph = JSON.parse(c.dataset.recorded).graph;
          const want = [...new Set(graph.rels.map((r) => r.type))].sort();
          const items = [...c.querySelectorAll('.graph-legend-types [data-type]')];
          const shown = items.map((i) => i.dataset.type);
          expect(log, failures, id + ': one legend entry per type drawn', JSON.stringify(shown) === JSON.stringify(want) && JSON.stringify(v.state().relTypes) === JSON.stringify(want), shown.join(', '));
          for (const i of items) {
            const colour = getComputedStyle(i.querySelector('i')).backgroundColor;
            expect(log, failures, id + ': :' + i.dataset.type + ' has a colour, the same on every view', !colours[i.dataset.type] || colours[i.dataset.type] === colour, colour);
            colours[i.dataset.type] = colour;
            expect(log, failures, id + ': the entry names the type in text', i.textContent === ':' + i.dataset.type, i.textContent);
          }
        }
        return { log: [Object.entries(colours).map(([t, c]) => ':' + t + ' ' + c).join(', ')], failures };
      `),
    },
    {
      name: 'under reduced motion the view shows each layout settled, and nothing moves',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.emulateMedia({ reducedMotion: true });
        return tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const v = await viewOf('named-path');
            if (!v) return { log, failures: ['the view did not draw'] };
            const canvasHost = cellOf('named-path').querySelector('.graph-host');
            const a = v.state().positions;
            await wait(600);
            const b = v.state().positions;
            expect(log, failures, 'shown once settled: nothing moves after', moved(a, b) === 0, moved(a, b) + ' moved');
            const select = cellOf('named-path').querySelector('.graph-layout select');
            select.value = 'circular';
            select.dispatchEvent(new Event('change'));
            const hidden = canvasHost.style.visibility === 'hidden';
            await until(() => canvasHost.style.visibility !== 'hidden', 8000);
            const c1 = v.state().positions;
            await wait(600);
            const c2 = v.state().positions;
            expect(log, failures, 'a layout change runs out of sight', hidden);
            expect(log, failures, 'and shows still', moved(c1, c2) === 0 && moved(b, c1) > 0, moved(b, c1) + ' moved by the switch, ' + moved(c1, c2) + ' after');
            return { log: ['positions still after showing; the switch ran hidden'], failures };
          `),
        );
      },
    },
    {
      name: 'full screen covers the viewport as a dialog, keeps Tab inside, and Escape leaves it',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const on = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const v = await viewOf('dependency-tree');
            if (!v) return { log, failures: ['the view did not draw'] };
            const c = cellOf('dependency-tree');
            const root = c.querySelector('.graph-view');
            const btn = [...c.querySelectorAll('.graph-tool')].find((b) => /full screen/i.test(b.getAttribute('aria-label')));
            btn.click();
            const r = root.getBoundingClientRect();
            expect(log, failures, 'the view covers the viewport', v.state().full && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight, Math.round(r.width) + 'x' + Math.round(r.height));
            const top = document.elementFromPoint(innerWidth / 2, 10);
            expect(log, failures, 'and is on top of the page (its header too)', !!top && root.contains(top), top ? top.tagName + '.' + top.className : 'nothing');
            expect(log, failures, 'it is a modal dialog with a name', root.getAttribute('role') === 'dialog' && root.getAttribute('aria-modal') === 'true' && !!root.getAttribute('aria-label'));
            expect(log, failures, 'the button says how to leave, and has focus', btn.getAttribute('aria-pressed') === 'true' && btn.getAttribute('aria-label') === 'Leave full screen' && document.activeElement === btn);
            return { log, failures };
          `),
        );
        if (on.failures.length) return on;
        const visited: string[] = [];
        for (let i = 0; i < 12; i++) {
          await tab.press('Tab', 'Tab', 9);
          visited.push(
            await tab.evaluate<string>(
              `(() => { const a = document.activeElement; const inside = !!a && !!a.closest('cypher-cell[data-cell="dependency-tree"] .graph-view.is-full'); return (inside ? 'in ' : 'OUT ') + (a ? (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().slice(0, 24) : 'none'); })()`,
            ),
          );
        }
        await tab.press('Escape');
        const off = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const root = cellOf('dependency-tree').querySelector('.graph-view');
            const v = root.graphView;
            expect(log, failures, 'Escape leaves full screen', !v.state().full && !document.documentElement.classList.contains('graph-full-open'));
            expect(log, failures, 'the page is no longer inert, the view no longer a dialog', !document.querySelector('[inert]') && !root.hasAttribute('role'), document.querySelector('[inert]')?.tagName ?? '');
            return { log, failures };
          `),
        );
        const out = visited.filter((v) => v.startsWith('OUT'));
        const failures = [...off.failures];
        if (out.length) failures.push(`Tab left the full-screen view: ${visited.join(' | ')}`);
        return { log: [`full screen on; Tab stayed inside over ${visited.length} presses (${[...new Set(visited)].length} stops); Escape off`], failures };
      },
    },
    {
      name: 'a cookbook step without words: its paths get the Highlight paths button, from the envelope the runtime passes',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/cookbook/dependency-blast-radius/');
        return tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const v = await stepView('chains');
            if (!v) return { log, failures: ['the chains step drew no graph view'] };
            const c = cellOf('chains');
            // The recorded envelope, as the page serves it: one PATH value per row.
            const results = await (await fetch('results.json')).json();
            const env = results.chains.envelope;
            const col = env.columns[env.columnTypes.indexOf('PATH')];
            const seen = new Set(), nodes = new Set(), rels = new Set();
            for (const row of env.rows) {
              const p = row[col];
              seen.add(JSON.stringify(p.map((x) => x.id)));
              p.forEach((x, i) => (i % 2 ? rels : nodes).add(x.id));
            }
            const btn = c.querySelector('[data-action=highlight]');
            const s0 = v.state();
            expect(log, failures, 'the step carries no words', !c.dataset.words);
            expect(log, failures, 'the view holds every path of the result', s0.paths === seen.size, s0.paths + ' of ' + seen.size);
            expect(log, failures, 'the Highlight paths button shows, off', btn && !btn.hidden && btn.textContent === 'Highlight paths' && btn.getAttribute('aria-pressed') === 'false', btn ? btn.textContent + ' ' + btn.getAttribute('aria-pressed') : 'no button');
            btn.click();
            const s1 = v.state();
            expect(log, failures, 'pressed, it draws every node and relationship of the paths on top', s1.highlight && s1.highlighted.nodes === nodes.size && s1.highlighted.rels === rels.size, JSON.stringify(s1.highlighted) + ' for ' + nodes.size + ' nodes, ' + rels.size + ' relationships');
            const key = c.querySelector('.graph-path-key')?.textContent ?? '';
            expect(log, failures, 'the legend counts them', key.startsWith(seen.size + ' paths: '), key);
            return { log: [seen.size + ' paths; ' + s1.highlighted.nodes + ' nodes and ' + s1.highlighted.rels + ' relationships highlighted'], failures };
          `),
        );
      },
    },
    {
      name: 'a pinned node keeps its place through an expansion and its Reset, and through the run an expansion starts',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/cookbook/dependency-blast-radius/');
        // On the recording: expanding runs the step first, which draws a new view; the pin must carry over.
        const setup = await tab.evaluate<Outcome & { at?: { x: number; y: number }; x?: number; y?: number }>(
          view(`
            const log = [], failures = [];
            const v = await stepView('chains');
            if (!v) return { log, failures: ['the chains step drew no graph view'] };
            const c = cellOf('chains');
            v.pin([0]);
            const select = c.querySelector('.graph-layout select');
            select.value = 'hierarchical';
            select.dispatchEvent(new Event('change'));
            await settled(v);
            const s = v.state();
            expect(log, failures, 'n0 is pinned', s.pinned.includes('n0') && s.nvlPinned.includes('n0'));
            c.querySelector('.graph-stage').scrollIntoView({ block: 'center' });
            await wait(300);
            const p = v.state().screen.n5;
            if (!p) failures.push('no screen point for n5');
            return { log, failures, at: s.positions.n0, x: p?.x, y: p?.y };
          `),
        );
        if (setup.failures.length) return setup;
        // A real click on n5 holds it; the inspector's Expand adds its neighbours (none of them are drawn).
        await tab.click(setup.x!, setup.y!);
        const at = JSON.stringify(setup.at);
        const out = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('chains');
            const first = c.querySelector('.graph-view').graphView;
            const exp = await until(() => c.querySelector('.graph-inspector-actions [data-action=expand]'), 3000);
            if (!exp) return { log, failures: ['the click held no node with an Expand button'] };
            exp.click();
            const status = () => c.querySelector('.graph-status')?.textContent ?? '';
            await until(() => /^Added|Could not|Nothing/.test(status()), 90000);
            const v = c.querySelector('.graph-view').graphView;
            await settled(v);
            const s = v.state();
            const pinnedAt = ${at};
            expect(log, failures, 'the expansion added nodes', /^Added [1-9]/.test(status()), status());
            expect(log, failures, 'the run drew a new view, and the pin carried over to it, drawn', v !== first && s.pinned.includes('n0') && s.nvlPinned.includes('n0') && s.pinIcons.includes('n0'), JSON.stringify({ newView: v !== first, pinned: s.pinned, icons: s.pinIcons }));
            const d1 = dist(s.positions.n0, pinnedAt);
            expect(log, failures, 'under the hierarchical layout the pinned node keeps its place through the expansion', s.layout === 'hierarchical' && d1 < 2, s.layout + ', ' + Math.round(d1) + ' px');
            const added = status();
            const reset = [...c.querySelectorAll('.graph-tool')].find((b) => /result again/.test(b.getAttribute('aria-label')));
            reset.click();
            await settled(v);
            const d2 = dist(v.state().positions.n0, pinnedAt);
            expect(log, failures, 'and through its Reset', d2 < 2 && v.state().pinned.includes('n0'), Math.round(d2) + ' px');
            return { log: [added + ' The pinned node moved ' + Math.round(Math.max(d1, d2)) + ' px through it and its Reset.'].concat(log), failures };
          `),
        );
        return { log: [out.log[0] ?? ''], failures: out.failures };
      },
    },
    {
      name: 'under reduced motion an expansion lays out out of sight: once the canvas shows nothing moves, and the pin holds',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.emulateMedia({ reducedMotion: true });
        await tab.navigate('/cookbook/dependency-blast-radius/');
        const setup = await tab.evaluate<Outcome & { x?: number; y?: number }>(
          view(`
            const log = [], failures = [];
            let v = await stepView('chains');
            if (!v) return { log, failures: ['the chains step drew no graph view'] };
            const c = cellOf('chains');
            // Live first, so the expansion grows this view rather than a new one.
            const before = v;
            c.querySelector('[data-action=run]').click();
            v = await until(() => { const x = c.querySelector('.graph-view')?.graphView; return x && x !== before ? x : null; }, 90000);
            if (!v) return { log, failures: ['the run drew no new view'] };
            await settled(v);
            v.pin([0]);
            const select = c.querySelector('.graph-layout select');
            select.value = 'circular';
            select.dispatchEvent(new Event('change'));
            await settled(v);
            window.__pinnedAt = v.state().positions.n0;
            c.querySelector('.graph-stage').scrollIntoView({ block: 'center' });
            await wait(300);
            const p = v.state().screen.n5;
            return { log, failures: p ? [] : ['no screen point for n5'], x: p?.x, y: p?.y };
          `),
        );
        if (setup.failures.length) return setup;
        await tab.click(setup.x!, setup.y!);
        return tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('chains');
            const v = c.querySelector('.graph-view').graphView;
            const exp = await until(() => c.querySelector('.graph-inspector-actions [data-action=expand]'), 3000);
            if (!exp) return { log, failures: ['the click held no node with an Expand button'] };
            exp.click();
            // Sample while it lays out: whenever the canvas shows, nothing may be moving on it.
            const seen = [];
            const t0 = performance.now();
            while (performance.now() - t0 < 6000) {
              const s = v.state();
              seen.push({ shown: !s.hidden, moving: s.moving, n0: s.positions.n0, at: s.positions });
              await wait(50);
            }
            const status = c.querySelector('.graph-status')?.textContent ?? '';
            const shownMoving = seen.filter((x) => x.shown && x.moving).length;
            const hid = seen.some((x) => !x.shown);
            const shown = seen.filter((x) => x.shown);
            const last = shown.at(-1);
            const firstShownAfter = seen.findIndex((x, i) => i > 0 && x.shown && !seen[i - 1].shown);
            const settledFrame = firstShownAfter >= 0 ? seen[firstShownAfter] : null;
            expect(log, failures, 'the expansion added nodes', /^Added [1-9]/.test(status), status);
            expect(log, failures, 'the canvas hid while the layout ran', hid);
            expect(log, failures, 'nothing moved while the canvas showed', shownMoving === 0, shownMoving + ' samples shown while moving');
            expect(log, failures, 'nothing moved after it showed again', !!settledFrame && !!last && moved(settledFrame.at, last.at) === 0, settledFrame && last ? moved(settledFrame.at, last.at) + ' moved' : 'it never showed again');
            const d = dist(last?.n0, window.__pinnedAt);
            expect(log, failures, 'the pinned node kept its place', d < 2, Math.round(d) + ' px');
            return { log: [status + ' Laid out hidden; still once shown; the pinned node moved ' + Math.round(d) + ' px.'], failures };
          `),
        );
      },
    },
    {
      name: 'a drag pins only the node dragged (path nodes and a held node are selected) through a layout change, and a double-tap on a touch screen pins one',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const drag = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const v = await viewOf('named-path');
            if (!v) return { log, failures: ['the view did not draw'] };
            const c = cellOf('named-path');
            c.querySelector('.graph-stage').scrollIntoView({ block: 'center' });
            await wait(300);
            // Pointer input through NVL's own handlers (its drag listens for mouse events on the canvas, up on the body).
            const dragNode = async (key, dx, dy) => {
              const from = v.state().screen[key];
              const to = { x: from.x + dx, y: from.y + dy };
              fire('mousedown', from.x, from.y, { buttons: 1 });
              for (let i = 1; i <= 8; i++) { fire('mousemove', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, { buttons: 1 }); await wait(16); }
              document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to.x, clientY: to.y, button: 0 }));
              await wait(300);
            };
            const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
            // The nodes other than \`key\` that moved between two states (a circular layout, once settled, moves none of its own accord).
            const othersMoved = (before, after, key) => Object.keys(before).filter((k) => k !== key && dist(before[k], after[k]) >= 2);
            const setLayout = async (name) => {
              const select = c.querySelector('.graph-layout select');
              select.value = name;
              select.dispatchEvent(new Event('change'));
              await settled(v, 15000);
            };

            // The highlight is on (the cell's highlight=path): the path's nodes are selected, n1 among them.
            await setLayout('circular');
            const s0 = v.state();
            expect(log, failures, 'with the highlight on, n1 and other path nodes are selected', s0.highlight && s0.selected.includes('n1') && s0.selected.length > 1, JSON.stringify(s0.selected));
            await dragNode('n1', 60, 40);
            const s = v.state();
            expect(log, failures, 'dragging a path node pins exactly that node, in NVL too, with the pin drawn', same(s.pinned, ['n1']) && same(s.nvlPinned, ['n1']) && same(s.pinIcons, ['n1']), JSON.stringify({ pinned: s.pinned, nvl: s.nvlPinned, icons: s.pinIcons }));
            const carried = othersMoved(s0.positions, s.positions, 'n1');
            expect(log, failures, 'it moved, and the other path nodes stayed where they were', dist(s0.positions.n1, s.positions.n1) > 10 && carried.length === 0, 'moved: ' + JSON.stringify(carried));
            const at = s.positions.n1;
            await setLayout('hierarchical');
            const d = dist(v.state().positions.n1, at);
            expect(log, failures, 'it keeps the place it was dragged to through a layout change', d < 2, Math.round(d) + ' px');

            // A held node is selected too: hold a node off the path (the path still selected), then drag another path node.
            // n1 stays pinned: unpinned, NVL's circular layout would place it again on the next drag.
            await setLayout('circular');
            const sc = v.state().screen;
            const heldKey = Object.keys(sc).find((k) => !v.state().selected.includes(k)) ?? '';
            const p = sc[heldKey];
            fire('mousedown', p.x, p.y, { buttons: 1, detail: 1 });
            fire('mouseup', p.x, p.y, { detail: 1 });
            fire('click', p.x, p.y, { detail: 1 });
            await until(() => c.querySelector('.graph-inspector.is-pinned:not([hidden])'), 3000);
            await wait(300);
            const h0 = v.state();
            expect(log, failures, 'a click holds a node off the path, selected beside the path', h0.selected.includes(heldKey) && h0.selected.length > 2, JSON.stringify({ held: heldKey, selected: h0.selected }));
            // The drag starts on a path node the held inspector does not cover.
            const free = h0.selected.filter((k) => k !== heldKey && k !== 'n1').find((k) => !document.elementFromPoint(sc[k].x, sc[k].y)?.closest('.graph-inspector'));
            if (!free) failures.push('no path node free of the inspector to drag');
            else {
              await dragNode(free, -50, 40);
              const h = v.state();
              expect(log, failures, 'dragging it pins that node beside n1, not the held node or the rest of the path', same(h.pinned, ['n1', free]) && same(h.nvlPinned, ['n1', free]), JSON.stringify({ dragged: free, held: heldKey, pinned: h.pinned, nvl: h.nvlPinned }));
              const moved2 = othersMoved(h0.positions, h.positions, free);
              expect(log, failures, 'and the held node and the rest of the path stayed where they were', dist(h0.positions[free], h.positions[free]) > 10 && moved2.length === 0, 'moved: ' + JSON.stringify(moved2));
            }
            c.querySelector('.graph-inspector-close')?.click();
            return { log: ['dragged n1 on the path: pinned ' + JSON.stringify(s.pinned) + ', moved ' + Math.round(d) + ' px through a layout change; dragged ' + free + ' beside held ' + heldKey + ': pinned ' + JSON.stringify(v.state().pinned)], failures };
          `),
        );
        // At phone width, a touch screen: a double-tap anywhere on the stage pins (the inspector waits until no second tap comes).
        await tab.viewport(390, 844, { mobile: true });
        const touch = await tab.evaluate<Outcome>(
          view(`
            const log = [], failures = [];
            const c = cellOf('named-path');
            const v = c.querySelector('.graph-view').graphView;
            c.querySelector('.graph-controls [data-action=unpin-all]').click();
            c.querySelector('.graph-stage').scrollIntoView({ block: 'center' });
            await settled(v, 15000);
            const sc = v.state().screen;
            // The node nearest the top of the stage, where an inspector opened on the first tap would lie.
            const key = Object.keys(sc).sort((a, b) => sc[a].y - sc[b].y)[0];
            const p = sc[key];
            const tap = (detail) => {
              fire('pointerdown', p.x, p.y, { pointerType: 'touch', isPrimary: true });
              fire('mousedown', p.x, p.y, { buttons: 1, detail });
              fire('pointerup', p.x, p.y, { pointerType: 'touch', isPrimary: true });
              fire('mouseup', p.x, p.y, { detail });
              return fire('click', p.x, p.y, { detail });
            };
            tap(1);
            await wait(80);
            const second = tap(2);
            fire('dblclick', p.x, p.y, { detail: 2 });
            await wait(500);
            const s = v.state();
            expect(log, failures, 'the second tap lands on the canvas, not on an inspector', !second.closest('.graph-inspector'), second.tagName + '.' + second.className);
            expect(log, failures, 'a double-tap pins the node', s.pinned.includes(key) && s.nvlPinned.includes(key), key + ': ' + JSON.stringify(s.pinned));
            expect(log, failures, 'and opens no inspector over the stage', c.querySelector('.graph-inspector.is-pinned:not([hidden])') === null);
            return { log: ['double-tap pinned ' + key + ' at 390 px'], failures };
          `),
        );
        return { log: [`${drag.log[0] ?? ''}; ${touch.log[0] ?? ''}`], failures: [...drag.failures, ...touch.failures] };
      },
    },
  ],
} satisfies BrowserCases;

// cookbook:browser cases for `:::vector-explorer`
// (src/lib/docs/elements/vector-explorer.ts). The runner opens the first
// built page carrying it, which is full-text-and-hybrid-search (the hybrid
// view); the scatter cases go to vector-search themselves, and the last case
// to the search reference, whose hybrid view weights its lists. Numbers come from
// the engine, and the cases check them two ways that do not go through the
// element: the ranking cell's own Run (its live table), and the similarity
// computed here from the page's own data block and question vector. Nothing
// is checked against numbers typed here.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

const SCATTER_PAGE = '/docs/guides/cypher/vector-search/';
const HYBRID_PAGE = '/docs/guides/cypher/full-text-and-hybrid-search/';
const WEIGHTED_PAGE = '/docs/reference/cypher/search/';

/** Go to `path` unless the tab's page already carries the view (`hybrid`: a host with `lists`). */
async function onView(tab: BrowserTab, hybrid: boolean, path: string) {
  const here = await tab.evaluate<boolean>(
    `[...document.querySelectorAll('docs-element[data-element="vector-explorer"]')].some((h) => 'lists' in JSON.parse(h.dataset.attrs || '{}') === ${hybrid})`,
  );
  if (!here) await tab.navigate(path);
}

/** In the page: the scatter host live, its pieces, and a way to move k. */
const SCATTER = `
  // Whether the engine started: the page fetches the engine's worker script, and the bar records the version it reports.
  // (The kit's engineLoaded() looks for the wasm files, which the worker fetches on its own timeline, so the page never sees them.)
  const engineUp = () => !!document.getElementById('engineBar')?.dataset.engineVersion || performance.getEntriesByType('resource').some((e) => /\\/_astro\\/worker-[\\w-]+\\.js/.test(e.name));
  const h = [...document.querySelectorAll('docs-element[data-element="vector-explorer"]')].find((x) => !('lists' in JSON.parse(x.dataset.attrs || '{}')));
  if (!h) return { log: [], failures: ['no scatter on the page'] };
  h.scrollIntoView({ block: 'center' });
  if (!(await until(() => h.dataset.state === 'live', 15000))) return { log: [], failures: ['the scatter did not go live: ' + h.dataset.state] };
  const L = h.querySelector('.element-live');
  const status = L.querySelector('.vx-status');
  const range = L.querySelector('.vx-range');
  const rings = () => L.querySelectorAll('.vx-ring').length;
  const greyed = () => L.querySelectorAll('.vx-pt.vx-out').length;
  const listed = () => [...L.querySelectorAll('.vx-list li')].map((li) => li.dataset.id);
  const scores = () => [...L.querySelectorAll('.vx-list li')].map((li) => Number(li.dataset.score));
  const ringed = () => [...L.querySelectorAll('.vx-ring')].map((r) => r.dataset.for);
  const attrs = JSON.parse(h.dataset.attrs);
  const cellEl = (id) => document.querySelector('cypher-cell[data-cell="' + id + '"]');
  const paramsOf = (id) => JSON.parse(cellEl(id).querySelector('.params-editor').value);
  // The page's own vectors: the data block, which a loading cell takes as its parameters, and the question.
  const question = paramsOf(attrs.cell);
  const qv = Object.values(question).find((v) => Array.isArray(v) && v.length > 2);
  const loader = [...document.querySelectorAll('cypher-cell .params-editor')].map((t) => { try { return JSON.parse(t.value); } catch { return null; } })
    .map((p) => p && Object.values(p).find((v) => Array.isArray(v) && v[0] && Array.isArray(v[0].e))).find(Boolean) || [];
  const dotp = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  // relate's rebounded scores (the guide's "Read the score" table): cosine (1 + cos) / 2, euclidean 1 / (1 + d^2).
  const cosScore = (e) => (1 + dotp(e, qv) / Math.sqrt(dotp(e, e) * dotp(qv, qv))) / 2;
  const eucScore = (e) => 1 / (1 + e.reduce((s, x, i) => s + (x - qv[i]) ** 2, 0));
  /** Whether ids are a top k by score among the notes keep() admits: no note left out scores higher than one taken. */
  const isTopK = (ids, k, score, keep = () => true) => {
    const pool = loader.filter(keep).map((n) => [n.id, score(n.e)]);
    const taken = pool.filter(([id]) => ids.includes(id)).map(([, s]) => s);
    const left = pool.filter(([id]) => !ids.includes(id)).map(([, s]) => s);
    return ids.length === Math.min(k, pool.length) && taken.length === ids.length && Math.min(...taken) >= Math.max(-Infinity, ...left) - 1e-6;
  };
  /** The ranking cell's own Run with k: the ids its live table lists. */
  const cellRun = async (id, k) => {
    const c = cellEl(id);
    const ed = c.querySelector('.params-editor');
    ed.value = JSON.stringify({ ...JSON.parse(ed.value), k });
    // Blank the label first: a cell that already ran says Live before this run starts.
    c.querySelector('.out-label').textContent = '';
    c.querySelector('[data-action=run]').click();
    await until(() => c.classList.contains('is-live') && !c.classList.contains('is-running') && /Live/.test(c.querySelector('.out-label').textContent), 60000);
    const head = [...c.querySelectorAll('.out-table thead th')].map((th) => th.textContent.trim());
    const at = head.indexOf('id');
    return [...c.querySelectorAll('.out-table tbody tr')].map((tr) => tr.children[at]?.textContent.trim().replace(/^"|"$/g, ''));
  };
  let said = status.textContent;
  const settled = async () => { await until(() => status.textContent !== said && !/Running|Loading/.test(status.textContent), 120000); said = status.textContent; return said; };
  const setK = async (k) => { range.value = String(k); range.dispatchEvent(new Event('input', { bubbles: true })); return settled(); };
`;

export default {
  element: 'vector-explorer',
  cases: [
    {
      // First, so the runner repeats it at 390 px and under reduced motion: it brings the first page's view fully live.
      name: 'the hybrid lists fuse into one, and the engine agrees as k moves',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        // Whichever page the runner opened, this case runs on the hybrid view (it is the one repeated at 390 px and under reduced motion).
        await onView(tab, true, HYBRID_PAGE);
        return tab.evaluate<Outcome>(scenario(`
        const log = [], failures = [];
  // Whether the engine started: the page fetches the engine's worker script, and the bar records the version it reports.
  // (The kit's engineLoaded() looks for the wasm files, which the worker fetches on its own timeline, so the page never sees them.)
  const engineUp = () => !!document.getElementById('engineBar')?.dataset.engineVersion || performance.getEntriesByType('resource').some((e) => /\\/_astro\\/worker-[\\w-]+\\.js/.test(e.name));
        const h = [...document.querySelectorAll('docs-element[data-element="vector-explorer"]')].find((x) => 'lists' in JSON.parse(x.dataset.attrs || '{}'));
        if (!h) return { log: [], failures: ['no hybrid view on ' + location.pathname] };
        h.scrollIntoView({ block: 'center' });
        expect(log, failures, 'the hybrid view goes live', await until(() => h.dataset.state === 'live', 15000), h.dataset.state);
        const L = h.querySelector('.element-live');
        // Queried each time: a run replaces the list columns.
        const lists = () => [...L.querySelectorAll('.vx-list-col')];
        expect(log, failures, 'two ranked lists show', lists().length === 2, lists().length + ' lists');
        const fusedRows = () => [...L.querySelectorAll('.vx-fused tbody tr')];
        expect(log, failures, 'the recorded fusion shows before any run', fusedRows().length > 0 && !engineUp());
        const status = L.querySelector('.vx-status');
        const range = L.querySelector('.vx-range');
        range.value = '5';
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => /^From this tab's run.* lists with k = 5/.test(status.textContent) || /failed|Could not/.test(status.textContent), 120000);
        expect(log, failures, 'moving k runs the lists on the engine', engineUp() && /^From this tab's run on relate [\\d.]+/.test(status.textContent), status.textContent);
        expect(log, failures, 'the slider stops at the max the page sets', range.max === (JSON.parse(h.dataset.attrs).max || '10'), 'max ' + range.max);
        const cols = lists();
        const items = cols.map((c) => c.querySelectorAll('li:not(.vx-none)').length);
        expect(log, failures, 'no list holds more than k ids', items.every((n) => n <= 5) && items[0] > 0, items.join(' + '));
        const ids = new Set(cols.flatMap((c) => [...c.querySelectorAll('li code')].map((x) => x.textContent)));
        const rows = fusedRows();
        expect(log, failures, 'the lists fuse into one list of every id they hold', rows.length === ids.size, rows.length + ' fused, ' + ids.size + ' ids');
        const engine = rows.map((r) => r.lastElementChild.textContent).filter(Boolean);
        expect(log, failures, "every score of the engine's fused statement equals the arithmetic", engine.length > 0 && engine.every((t) => /\\(same\\)/.test(t)), engine.join(' | '));
        const first = rows[0]?.querySelector('code')?.textContent;
        return { log: [items.join('+') + ' ranked, ' + rows.length + ' fused, first ' + first + '; ' + engine.length + ' engine scores agree'], failures };
      `));
      },
    },
    {
      name: 'the scatter renders N points and rings the recorded top k',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await onView(tab, false, SCATTER_PAGE);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${SCATTER}
            const n = h.querySelectorAll('.element-static g.points circle[data-id]').length / 2;
            const dots = L.querySelectorAll('.vx-pt').length;
            expect(log, failures, 'one point per vector of the data block', n > 2 && dots === n, dots + ' drawn, ' + n + ' in the static picture');
            expect(log, failures, 'the question shows', !!L.querySelector('.vx-query'));
            const recorded = JSON.parse(document.querySelector('cypher-cell[data-cell="' + JSON.parse(h.dataset.attrs).cell + '"]').dataset.recorded).envelope.rows.map((r) => r.id);
            expect(log, failures, 'the rings are the recorded top k', rings() === recorded.length && ringed().sort().join() === [...recorded].sort().join(), ringed().join(','));
            expect(log, failures, 'the engine has not started', !engineUp());
            return { log: [dots + ' points, ' + rings() + ' ringed: ' + recorded.join(',')], failures };
          `),
        );
      },
    },
    {
      name: 'moving k changes how many points the engine returns',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await onView(tab, false, SCATTER_PAGE);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${SCATTER}
            const seen = [];
            expect(log, failures, 'the page holds the vectors and the question', loader.length > 2 && !!qv, loader.length + ' notes');
            for (const k of [8, 2, 10]) {
              const text = await setK(k);
              seen.push(k + ':' + rings());
              expect(log, failures, 'k = ' + k + ' rings ' + k + ' points from the engine', engineUp() && rings() === k && listed().length === k && /^From this tab's run on relate [\\d.]+/.test(text), rings() + ' ringed; ' + text);
              expect(log, failures, 'the ringed points are the ids listed (k = ' + k + ')', ringed().sort().join() === listed().slice().sort().join());
              expect(log, failures, 'they are a true top ' + k + ' by cosine over the vectors on the page', isTopK(listed(), k, cosScore), listed().join(','));
              const s = scores();
              expect(log, failures, 'each listed score is the cosine score of that note (k = ' + k + ')', listed().every((id, i) => Math.abs(cosScore(loader.find((n) => n.id === id).e) - s[i]) < 1.5e-4), s.join(','));
            }
            // The ranking cell's own Run, outside the element, lists the same ids in the same order.
            const own = await cellRun(attrs.cell, 10);
            expect(log, failures, "the cell's own Run with k = 10 lists the ids the view rings, in order", own.join() === listed().join(), own.join(','));
            return { log: [seen.join(' ') + '; ' + said], failures };
          `),
        );
      },
    },
    {
      name: 'the pre-filter greys the points it removes, and the top k stays k',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await onView(tab, false, SCATTER_PAGE);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${SCATTER}
            const box = L.querySelector('.vx-filter input');
            if (!box) return { log, failures: ['no pre-filter toggle'] };
            box.click();
            await settled();
            const g = greyed(), total = L.querySelectorAll('.vx-pt').length;
            expect(log, failures, 'some points grey out, not all', g > 0 && g < total, g + ' of ' + total);
            expect(log, failures, 'still k ringed, none of them greyed', rings() === Number(range.value) && ringed().every((id) => !L.querySelector('.vx-pt[data-id="' + id + '"]').classList.contains('vx-out')), rings() + ' ringed');
            expect(log, failures, 'the table says filtered out', L.querySelectorAll('.vx-out-row').length === g);
            // The survivors are the notes the filter's parameter admits, read from the page's data block.
            const field = Object.keys(question).find((p) => p !== 'k' && typeof question[p] === 'string' && loader.some((n) => n[p] === question[p]));
            const keep = (n) => n[field] === question[field];
            expect(log, failures, 'the greyed points are the notes the filter removes', !!field && [...L.querySelectorAll('.vx-pt')].every((c) => c.classList.contains('vx-out') === !keep(loader.find((n) => n.id === c.dataset.id))), field + ' = ' + question[field]);
            expect(log, failures, 'the ringed points are a true top k among the survivors', isTopK(listed(), Number(range.value), cosScore, keep), listed().join(','));
            box.click();
            await settled();
            expect(log, failures, 'turning it off un-greys every point', greyed() === 0);
            const euclid = L.querySelector('.vx-metric input[value=euclidean]');
            const cosine = ringed().sort().join();
            euclid.click();
            await settled();
            expect(log, failures, 'the euclidean statement runs, and the filter is off for it', /euclidean/.test(said) && box.disabled, said);
            const s = scores();
            expect(log, failures, 'each listed score is 1 / (1 + d^2) for that note, not its cosine score', s.length > 0 && listed().every((id, i) => { const e = loader.find((n) => n.id === id).e; return Math.abs(eucScore(e) - s[i]) < 1.5e-4 && Math.abs(cosScore(e) - s[i]) > 1e-3; }), s.join(','));
            expect(log, failures, 'they are a true top k by euclidean similarity', isTopK(listed(), Number(range.value), eucScore), listed().join(','));
            return { log: [g + ' of ' + total + ' greyed by the filter; euclidean top ' + rings() + (ringed().sort().join() === cosine ? ' (same as cosine)' : ' (differs from cosine)')], failures };
          `),
        );
      },
    },
    {
      name: 'the keyboard moves k, and the view fits a phone without motion',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await onView(tab, false, SCATTER_PAGE);
        await tab.viewport(390, 844, { mobile: true });
        await tab.emulateMedia({ reducedMotion: true });
        const up = await tab.evaluate<Outcome>(
          scenario(`
            ${SCATTER}
            range.focus();
            window.__vx = { said };
            return { log: [], failures: document.activeElement === range ? [] : ['the k slider does not take focus'] };
          `),
        );
        if (up.failures.length) return up;
        await tab.press('ArrowRight', 'ArrowRight', 39);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${SCATTER}
            said = window.__vx.said;
            await settled();
            expect(log, failures, 'ArrowRight on the slider runs k + 1', rings() === Number(range.value) && /^From this tab's run/.test(said), range.value + ': ' + said);
            const sw = document.documentElement.scrollWidth;
            expect(log, failures, 'no sideways scroll at ' + innerWidth + ' px', sw <= innerWidth + 1, 'scrollWidth ' + sw);
            const plot = L.querySelector('.vx-plot').getBoundingClientRect();
            expect(log, failures, 'the scatter fills the width and fits', plot.width > 250 && plot.right <= innerWidth + 1, Math.round(plot.width) + ' px');
            const c = L.querySelector('.vx-controls');
            expect(log, failures, 'the controls stack', getComputedStyle(c).flexDirection === 'column');
            const moving = [...L.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return parseFloat(cs.transitionDuration) > 0 || cs.animationName !== 'none'; });
            expect(log, failures, 'nothing animates under reduced motion', moving.length === 0, moving.length + ' moving');
            return { log: ['k ' + range.value + ' by keyboard at ' + innerWidth + ' px; plot ' + Math.round(plot.width) + ' px'], failures };
          `),
        );
      },
    },
    {
      name: 'Reset brings the scatter back to the recording',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await onView(tab, false, SCATTER_PAGE);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${SCATTER}
            const recorded = ringed().sort().join();
            const k0 = range.value;
            await setK(9);
            const euclid = L.querySelector('.vx-metric input[value=euclidean]');
            const box = L.querySelector('.vx-filter input');
            euclid.click();
            await settled();
            expect(log, failures, 'euclidean is on before Reset', euclid.checked && box.disabled, said);
            const bar = document.getElementById('engineBar');
            bar.querySelector('[data-action=reset]').click();
            await until(() => /^Recorded on relate [\\d.]+ when the page was built\\. The top/.test(status.textContent), 15000);
            said = status.textContent;
            expect(log, failures, 'after Reset the rings are the recording again', ringed().sort().join() === recorded && range.value === k0, ringed().join(',') + ', k ' + range.value);
            const cosine = L.querySelector('.vx-metric input[value=cosine]');
            expect(log, failures, 'after Reset the ranking is cosine again and the pre-filter can be used', cosine.checked && !euclid.checked && !box.disabled && !box.checked);
            await setK(3);
            expect(log, failures, 'the next move runs the cosine search', /by the index/.test(said) && !/euclidean/.test(said), said);
            return { log: ['9 by euclidean, then ' + rings() + ' recorded after Reset, then cosine k = 3'], failures };
          `),
        );
      },
    },
    {
      // The search reference's view weights its lists (weights=, constant=): the engine's fused statement must agree with the weighted arithmetic too.
      name: "the weighted hybrid view agrees with the engine's weighted fusion",
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const here = await tab.evaluate<string>('location.pathname');
        if (here !== WEIGHTED_PAGE) await tab.navigate(WEIGHTED_PAGE);
        return tab.evaluate<Outcome>(scenario(`
        const log = [], failures = [];
        const h = [...document.querySelectorAll('docs-element[data-element="vector-explorer"]')].find((x) => JSON.parse(x.dataset.attrs || '{}').weights);
        if (!h) return { log: [], failures: ['no weighted hybrid view on ' + location.pathname] };
        h.scrollIntoView({ block: 'center' });
        expect(log, failures, 'the weighted view goes live', await until(() => h.dataset.state === 'live', 15000), h.dataset.state);
        const L = h.querySelector('.element-live');
        const attrs = JSON.parse(h.dataset.attrs);
        expect(log, failures, 'the caption says the shares are weighted', /times its weight/.test(L.querySelector('.vx-fused caption')?.textContent || ''));
        const status = L.querySelector('.vx-status');
        const range = L.querySelector('.vx-range');
        expect(log, failures, 'the slider stops at the max the page sets', range.max === attrs.max, 'max ' + range.max);
        const fusedRows = () => [...L.querySelectorAll('.vx-fused tbody tr')];
        const recorded = fusedRows().map((r) => r.lastElementChild.textContent).filter(Boolean);
        expect(log, failures, 'the recorded fused statement agrees with the weighted arithmetic', recorded.length > 0 && recorded.every((t) => /\\(same\\)/.test(t)), recorded.join(' | '));
        const k = Number(range.value) > 1 ? Number(range.value) - 1 : 2;
        range.value = String(k);
        range.dispatchEvent(new Event('input', { bubbles: true }));
        await until(() => new RegExp("^From this tab's run.* lists with k = " + k).test(status.textContent) || /failed|Could not/.test(status.textContent), 120000);
        expect(log, failures, 'moving k runs the lists on the engine', /^From this tab's run on relate [\\d.]+/.test(status.textContent), status.textContent);
        const engine = fusedRows().map((r) => r.lastElementChild.textContent).filter(Boolean);
        expect(log, failures, "every score of the engine's weighted fusion equals the arithmetic", engine.length === Math.min(k, fusedRows().length) && engine.every((t) => /\\(same\\)/.test(t)), engine.join(' | '));
        return { log: ['k ' + k + ': ' + engine.length + ' weighted engine scores agree'], failures };
      `));
      },
    },
  ],
} satisfies BrowserCases;

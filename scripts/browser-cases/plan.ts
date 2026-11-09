// cookbook:browser cases for `:::plan`, the query plan viewer
// (src/lib/docs/elements/plan.ts, src/scripts/docs/elements/plan.ts). They
// run on the first built page carrying one, and need its plan to be an
// EXPLAIN with a missing-index notification (03C91), as every page that
// carries the viewer has today: the recorded plan renders as a tree without
// the engine; PROFILE adds bars whose numbers come from the engine; the index
// toggle creates the index on the page's database, the plan changes, and
// pressing it again drops the index; the speedscope link holds the evented
// profile `relate --mode speedscope` writes; the text view equals the static
// form's text; and the controls work from the keyboard.
//
// The numbers a PROFILE pane draws are compared with the engine's own reply
// to the same run: WATCH wraps the page's Worker before the engine starts and
// keeps every envelope the worker sends back, so the oracle is the wire, not
// the viewer's own state.

import { formatMs, TIMER_STEP_MS } from '../../src/lib/docs/elements/_wording.ts';
import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/**
 * Keep every engine reply of this tab in window.__engineReplies (each a list
 * of parsed envelopes), and compare a drawn pane with an engine plan. Must run
 * before the engine starts: the wrap applies to the worker created next.
 */
const WATCH = `
  if (!window.__engineReplies) {
    if (engineLoaded()) return { log: [], failures: ['the engine started before the case could watch its replies'] };
    window.__engineReplies = [];
    const W = window.Worker;
    window.Worker = class extends W {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (e) => { if (e.data && Array.isArray(e.data.envelopes)) window.__engineReplies.push(e.data.envelopes.map((t) => JSON.parse(t))); });
      }
    };
  }
  /** The PROFILE plans the engine returned since reply number from, in order. */
  const profiled = (from = 0) => window.__engineReplies.slice(from).flatMap((r) => r.filter((e) => e.plan && e.plan.profiled).map((e) => e.plan));
  const TIMER_STEP_MS = ${TIMER_STEP_MS};
  const formatMs = ${formatMs.toString()};
  const preorder = (root) => { const out = []; const visit = (op) => { out.push(op); for (const c of op.children || []) visit(c); }; visit(root); return out; };
  /** Every way a drawn pane differs from the engine's plan: operator order, and each operator's Rows, Time and Database hits. */
  const differences = (pane, plan) => {
    const drawn = [...pane.querySelectorAll('.plan-op')];
    const ops = preorder(plan.root);
    const out = [];
    if (drawn.length !== ops.length) out.push(drawn.length + ' operators drawn, ' + ops.length + ' in the plan');
    ops.forEach((op, i) => {
      const d = drawn[i];
      if (!d) return;
      const name = d.querySelector('.plan-op-name').textContent;
      if (name !== op.operator) out.push('operator ' + i + ': drew ' + name + ', engine ' + op.operator);
      if (!op.actual) return;
      if (d.querySelector(':scope > .plan-op-never')) { if ((op.actual.rows ?? 0) !== 0) out.push(name + ' drawn as never executed with ' + op.actual.rows + ' rows'); return; }
      const m = Object.fromEntries([...d.querySelectorAll(':scope > .plan-metrics .plan-metric')].map((x) => [x.querySelector('dt').textContent, x.querySelector('.plan-num').textContent]));
      const want = { Rows: String(op.actual.rows ?? 0), Time: formatMs(op.actual.time_ms) + ' ms', 'Database hits': String(op.actual.db_hits ?? 0) };
      for (const k of Object.keys(want)) if (m[k] !== want[k]) out.push(name + ' ' + k + ': drew ' + m[k] + ', engine ' + want[k]);
    });
    return out;
  };
  const measures = (pane) => [...pane.querySelectorAll('.plan-op')].map((d) => d.querySelector('.plan-op-name').textContent + ' ' + [...d.querySelectorAll(':scope > .plan-metrics .plan-num')].map((n) => n.textContent).join('/')).join(', ');
`;

/** Helpers for the scenarios below, on top of the kit's. */
const HELPERS = `
  const h = await live('plan');
  if (!h) return { log: [], failures: ['the plan viewer did not go live'] };
  const L = h.querySelector('.element-live');
  const btn = (text) => [...L.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
  const panes = () => [...L.querySelectorAll('.plan-pane')];
  const ops = (pane) => [...pane.querySelectorAll('.plan-op-name')].map((n) => n.textContent);
  const status = () => L.querySelector('.plan-status').textContent;
  const settle = async (before) => { await until(() => status() !== before && !/Running/.test(status()), 60000); await idle(); };
  const press = async (b) => { const before = status(); b.click(); await settle(before); };
`;

/** The full live state: the recorded tree, then PROFILE, then the comparison with the index (the runner repeats this case at 390 px and under reduced motion). */
const FULLY_LIVE = scenario(`
  const log = [], failures = [];
  ${HELPERS}
  const recorded = ops(panes()[0]);
  expect(log, failures, 'the recorded plan renders as a tree', recorded.length >= 2 && recorded[0] === 'ProduceResults', recorded.join(' > '));
  expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
  await press(btn('PROFILE'));
  const bars = L.querySelectorAll('.plan-pane .plan-bar').length;
  expect(log, failures, 'PROFILE draws a bar per measure', bars >= 3, bars + ' bars; ' + status());
  await press(btn('Compare with the index'));
  const two = panes();
  expect(log, failures, 'the comparison shows two plans', two.length === 2, status());
  expect(log, failures, 'it lists what changed', !!L.querySelector('.plan-changes table'));
  return { log: [recorded.join(' > ') + '; ' + bars + ' bars; ' + two.map((p) => ops(p).join(' > ')).join(' | ')], failures };
`);

export default {
  element: 'plan',
  cases: [
    { name: 'the recorded plan, PROFILE and the index comparison', scenario: FULLY_LIVE },
    {
      name: 'renders the recorded plan without loading the engine, notifications linked',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        expect(log, failures, 'the engine is not loaded', !engineLoaded());
        const link = L.querySelector('.plan-notes a[href*="#notif-"]');
        expect(log, failures, 'each notification links its code to the errors reference', !!link && /\\/docs\\/reference\\/errors\\/#notif-03c91$/.test(link.getAttribute('href')), link && link.getAttribute('href'));
        expect(log, failures, 'the remedy is the statement that creates the index', /Remedy: CREATE INDEX \\S+ FOR/.test(L.querySelector('.plan-notes li').textContent));
        expect(log, failures, 'the source line says the plan is recorded', /recorded/.test(L.querySelector('.plan-pane-source').textContent));
        return { log: [ops(panes()[0]).join(' > ') + '; ' + link?.getAttribute('href')], failures };
      `),
    },
    {
      name: 'PROFILE bars carry the engine numbers of this tab run',
      scenario: scenario(`
        const log = [], failures = [];
        ${WATCH}
        ${HELPERS}
        const from = window.__engineReplies.length;
        await press(btn('PROFILE'));
        const pane = panes()[0];
        expect(log, failures, 'the engine ran', engineLoaded());
        const plans = profiled(from);
        expect(log, failures, 'the engine returned one PROFILE plan for the press', plans.length === 1, plans.length + ' plans');
        const off = plans.length ? differences(pane, plans.at(-1)) : ['no plan'];
        expect(log, failures, "each operator's Rows, Time and Database hits are the engine's for this run", off.length === 0, off.join('; '));
        expect(log, failures, 'the source line names this tab run', /^PROFILE, from this tab's run on relate \\d+\\.\\d+\\.\\d+, (?:<0\\.1|\\d+(?:\\.\\d)?) ms in the engine$/.test(pane.querySelector('.plan-pane-source').textContent), pane.querySelector('.plan-pane-source').textContent);
        const nums = [...pane.querySelectorAll('.plan-metric')].map((m) => [m.querySelector('dt').textContent, m.querySelector('.plan-num').textContent]);
        const bad = nums.filter(([k, v]) => (k === 'Time' ? !/^(?:<0\\.1|\\d+(?:\\.\\d)?) ms$/.test(v) : !/^\\d+$/.test(v)));
        expect(log, failures, 'every measure is a number', nums.length >= 6 && bad.length === 0, JSON.stringify(bad));
        const rows = nums.find(([k]) => k === 'Rows');
        expect(log, failures, 'the root returned the one row the statement returns', rows && rows[1] === '1', JSON.stringify(rows));
        const widths = [...pane.querySelectorAll('.plan-bar')].map((b) => parseFloat(b.style.width));
        expect(log, failures, 'the widest bar of each measure spans its track', widths.filter((w) => w === 100).length >= 1, widths.join(','));
        return { log: [measures(pane) + ' (the engine: ' + (plans.length ? preorder(plans.at(-1).root).map((o) => o.operator + ' ' + [o.actual?.rows, formatMs(o.actual?.time_ms), o.actual?.db_hits].join('/')).join(', ') : 'none') + ')'], failures };
      `),
    },
    {
      name: 'the index toggle creates the index, the plan changes, and it drops again',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        const startOp = ops(panes()[0]).at(-1);
        await press(btn('Compare with the index'));
        const [without, withIdx] = panes();
        expect(log, failures, 'two plans side by side', !!withIdx, status());
        const after = withIdx ? ops(withIdx).at(-1) : null;
        expect(log, failures, 'without the index, the plan starts as recorded', without && ops(without).at(-1) === startOp, without && ops(without).join(' > '));
        expect(log, failures, 'with the index, the plan starts from a NodeIndexSeek', after === 'NodeIndexSeek', after);
        expect(log, failures, 'the status names the index on the page database', /With \\S+ on the page's database/.test(status()), status());
        const toggle = btn('Drop the index');
        expect(log, failures, 'the toggle is pressed', toggle && toggle.getAttribute('aria-pressed') === 'true');
        await press(toggle);
        expect(log, failures, 'pressed again, the index is dropped and one plan shows', panes().length === 1 && /Dropped/.test(status()), status());
        expect(log, failures, 'and the plan starts as before', ops(panes()[0]).at(-1) === startOp, ops(panes()[0]).join(' > '));
        return { log: [startOp + ' -> ' + after + ' -> ' + ops(panes()[0]).at(-1)], failures };
      `),
    },
    {
      name: 'the speedscope link holds the evented profile relate --mode speedscope writes',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        expect(log, failures, 'no link before a PROFILE', !L.querySelector('.plan-export'));
        await press(btn('PROFILE'));
        const a = L.querySelector('.plan-export');
        expect(log, failures, 'a PROFILE gets a download link', !!a && /\\.speedscope\\.json$/.test(a.download), a && a.download);
        if (!a) return { log, failures };
        const text = await (await fetch(a.href)).text();
        const doc = JSON.parse(text);
        const frames = doc.shared.frames.map((f) => f.name);
        const names = ops(panes()[0]).map((n, i) => n + ' ' + i);
        expect(log, failures, 'the file is one line of JSON with a newline, keys in the CLI order', /^\\{"\\$schema":"https:\\/\\/www\\.speedscope\\.app\\/file-format-schema\\.json","exporter":"relate@[0-9.]+","profiles":\\[\\{"endValue":\\d+,"events":/.test(text) && text.endsWith('}}\\n') && !text.slice(0, -1).includes('\\n'), text.slice(0, 120));
        expect(log, failures, 'one frame per operator, pre-order', JSON.stringify(frames) === JSON.stringify(names), frames.join(', '));
        const ev = doc.profiles[0].events;
        let depth = 0, ok = true, last = 0;
        for (const e of ev) { depth += e.type === 'O' ? 1 : -1; ok = ok && depth >= 0 && e.at >= last; last = e.at; }
        // endValue may be 0: a page that is not cross-origin isolated gets a coarse timer, and a two-operator plan can finish inside one tick.
        expect(log, failures, 'events balanced and in order', ok && depth === 0 && ev.length === frames.length * 2 && doc.profiles[0].endValue >= 0 && doc.profiles[0].endValue === ev.at(-1).at);
        const note = L.querySelector('.plan-export-note');
        expect(log, failures, 'a zero-length file says why under its link, and only then', doc.profiles[0].endValue === 0 ? !!note && /0 ns/.test(note.textContent) && /0\\.1 ms/.test(note.textContent) : !note, note ? note.textContent : 'no note');
        return { log: [a.download + ': ' + frames.join(', ') + ', ' + doc.profiles[0].endValue + ' ns'], failures };
      `),
    },
    {
      name: 'the text view is the static form',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        const staticText = h.querySelector('.element-static pre code, .element-static pre').textContent.trim();
        btn('Plan as text').click();
        const pre = L.querySelector('.plan-text');
        expect(log, failures, 'the text view shows', !!pre);
        expect(log, failures, 'it equals the static form', pre && pre.textContent.trim() === staticText, pre && pre.textContent.slice(0, 80));
        return { log: [staticText.split('\\n')[0]], failures };
      `),
    },
    {
      name: 'on a page that compares two plans, PROFILE measures both and leaves the database as it was',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/docs/guides/cypher/tune-a-query/');
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${WATCH}
            ${HELPERS}
            expect(log, failures, 'the viewer compares two recorded plans', panes().length === 2, panes().length + ' panes');
            const recordedTitles = panes().map((p) => p.querySelector('.plan-pane-title').textContent);
            expect(log, failures, 'the recorded panes are titled by the comparison, not by cell ids', recordedTitles[0] === 'Without the index' && /^With \\S+$/.test(recordedTitles[1]), recordedTitles.join(' | '));
            const info = L.querySelector('.plan-op-warn');
            const probe = document.createElement('span');
            probe.style.color = 'var(--danger)';
            L.append(probe);
            const danger = getComputedStyle(probe).color;
            probe.remove();
            expect(log, failures, 'an INFORMATION note on an operator is not drawn in the error colour', !!info && /^Information /.test(info.textContent) && info.classList.contains('is-information') && getComputedStyle(info).color !== danger, info && info.textContent + ' ' + getComputedStyle(info).color + ' vs ' + danger);
            const scroller = L.querySelector('.plan-changes-scroll');
            expect(log, failures, 'the comparison table sits in its own scroll box', !!scroller && scroller.querySelector('table') !== null);
            expect(log, failures, 'the panes take no page-section margin (their grid spaces them)', panes().every((p) => getComputedStyle(p).marginTop === '0px'), panes().map((p) => getComputedStyle(p).marginTop).join(','));
            const from = window.__engineReplies.length;
            await press(btn('PROFILE'));
            const two = panes();
            expect(log, failures, 'PROFILE gives two panes', two.length === 2, status());
            const plans = profiled(from);
            expect(log, failures, 'the engine returned two PROFILE plans, without and with the index', plans.length === 2, plans.length + ' plans');
            const off = plans.length === 2 && two.length === 2 ? [...differences(two[0], plans[0]).map((d) => 'without: ' + d), ...differences(two[1], plans[1]).map((d) => 'with: ' + d)] : ['no pair'];
            expect(log, failures, "both panes draw the engine's Rows, Time and Database hits of their own run", off.length === 0, off.join('; '));
            const titles = two.map((p) => p.querySelector('.plan-pane-title, h4, h3')?.textContent ?? '');
            expect(log, failures, 'titled without and with the index', /^Without the index$/.test(titles[0]) && /^With \\S+$/.test(titles[1]), titles.join(' | '));
            expect(log, failures, 'both panes carry measured bars', two.every((p) => p.querySelectorAll('.plan-bar').length >= 3));
            const starts = two.map((p) => ops(p).at(-1));
            expect(log, failures, 'Expand without the index, NodeIndexSeek with it', starts[0] !== 'NodeIndexSeek' && starts[1] === 'NodeIndexSeek', starts.join(' -> '));
            expect(log, failures, 'the status says the database is as it was', /as it was|is again/.test(status()), status());
            const toggle = btn('Compare with the index');
            expect(log, failures, 'the index toggle is not pressed (no index left behind)', !!toggle && toggle.getAttribute('aria-pressed') !== 'true', toggle ? toggle.textContent : 'no toggle');
            return { log: [starts.join(' -> ') + '; ' + two.map(measures).join(' | ')], failures };
          `),
        );
      },
    },
    {
      name: 'a cell run during a comparison keeps it: true titles, the toggle still pressed, and a clash with a cell explained',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/docs/guides/cypher/tune-a-query/');
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HELPERS}
            const cellEl = (id) => document.querySelector('cypher-cell[data-cell="' + id + '"]');
            const runCell = async (id) => { const c = cellEl(id); c.scrollIntoView({ block: 'center' }); c.querySelector('[data-action=run]').click(); await wait(100); await idle(); return c; };
            await press(btn('Compare with the index'));
            expect(log, failures, 'the comparison holds the index', !!btn('Drop the index'), status());
            const before = status();
            await runCell('explain-before');
            await until(() => status() !== before, 5000);
            const titles = panes().map((p) => p.querySelector('.plan-pane-title').textContent);
            const sources = panes().map((p) => p.querySelector('.plan-pane-source').textContent);
            expect(log, failures, "the cell's plan, made with the index, is titled with it; the other pane still shows the plan without", titles[0] === 'Without the index' && /^With \\S+$/.test(titles[1]) && /this tab's run/.test(sources[1]) && ops(panes()[1]).at(-1) === 'NodeIndexSeek' && ops(panes()[0]).at(-1) !== 'NodeIndexSeek', titles.join(' | ') + ' / ' + panes().map((p) => ops(p).join('>')).join(' | '));
            const toggle = btn('Drop the index');
            expect(log, failures, 'the toggle still reads Drop the index, pressed', !!toggle && toggle.getAttribute('aria-pressed') === 'true', toggle ? toggle.textContent : [...L.querySelectorAll('button')].map((b) => b.textContent).join(','));
            expect(log, failures, 'the status says the comparison still holds the index', /still holds \\S+/.test(status()), status());
            await runCell('create-index');
            await until(() => /could not create/.test(status()), 5000);
            expect(log, failures, "the cell's failed CREATE INDEX is explained by the viewer", /could not create \\S+: the viewer's comparison created it/.test(status()), status());
            if (toggle) await press(toggle);
            expect(log, failures, 'Drop removes the index the viewer created', /Dropped/.test(status()) && !!btn('Compare with the index'), status());
            const c = await runCell('create-index');
            expect(log, failures, 'and the cell then creates it', c.classList.contains('is-live') && !c.classList.contains('is-error'), c.querySelector('.cell-output') && c.querySelector('.cell-output').textContent.slice(0, 120));
            return { log: [titles.join(' | ') + '; ' + status().slice(0, 80)], failures };
          `),
        );
      },
    },
    {
      name: 'Drop leaves an index a cell created',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.navigate('/docs/guides/cypher/tune-a-query/');
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HELPERS}
            const cellEl = (id) => document.querySelector('cypher-cell[data-cell="' + id + '"]');
            const runCell = async (id) => { const c = cellEl(id); c.scrollIntoView({ block: 'center' }); c.querySelector('[data-action=run]').click(); await wait(100); await idle(); return c; };
            const made = await runCell('create-index');
            expect(log, failures, 'the cell created the index', made.classList.contains('is-live'));
            h.scrollIntoView({ block: 'center' });
            await press(btn('Compare with the index'));
            expect(log, failures, 'the comparison says a cell created the index', /a cell created it/.test(status()), status());
            await press(btn('Drop the index'));
            expect(log, failures, 'Drop ends the comparison and says the index stays', /stays on the page's database, because a cell on the page created it/.test(status()) && !!btn('Compare with the index'), status());
            expect(log, failures, 'the plan shown is planned with the index', panes().length === 1 && ops(panes()[0]).at(-1) === 'NodeIndexSeek' && /^With /.test(panes()[0].querySelector('.plan-pane-title').textContent), panes().map((p) => p.querySelector('.plan-pane-title').textContent + ': ' + ops(p).join('>')).join(' | '));
            await runCell('explain-after');
            await until(() => /of cell explain-after/.test(status()), 5000);
            // The cell's plan takes the viewer's "With" slot, drawn from this tab's run.
            const withPane = panes().find((p) => /^With /.test(p.querySelector('.plan-pane-title').textContent) && /this tab's run/.test(p.querySelector('.plan-pane-source').textContent));
            expect(log, failures, 'the index is still on the page database (explain-after seeks through it)', !!withPane && ops(withPane).at(-1) === 'NodeIndexSeek', status() + ' / ' + panes().map((p) => p.querySelector('.plan-pane-title').textContent + ': ' + ops(p).join('>')).join(' | '));
            return { log: [status().slice(0, 110)], failures };
          `),
        );
      },
    },
    {
      name: 'the controls work from the keyboard',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const ready = await tab.evaluate<Outcome>(
          scenario(`${HELPERS} btn('EXPLAIN').focus(); return { log: [], failures: document.activeElement === btn('EXPLAIN') ? [] : ['EXPLAIN did not take focus'] };`),
        );
        if (ready.failures.length) return ready;
        await tab.press('Tab', 'Tab', 9);
        await tab.press('Enter', 'Enter', 13);
        return tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HELPERS}
            const focused = document.activeElement;
            expect(log, failures, 'Tab moves to PROFILE', focused === btn('PROFILE'), focused && focused.textContent);
            await until(() => btn('PROFILE').getAttribute('aria-pressed') === 'true' && L.querySelectorAll('.plan-bar').length > 0, 60000);
            await idle();
            expect(log, failures, 'Enter runs PROFILE', L.querySelectorAll('.plan-bar').length > 0, status());
            expect(log, failures, 'after the run, focus is still on PROFILE (not dropped to the page)', document.activeElement === btn('PROFILE'), document.activeElement && (document.activeElement.textContent || document.activeElement.tagName));
            const style = getComputedStyle(btn('PROFILE'));
            btn('PROFILE').focus();
            expect(log, failures, 'focus is visible', getComputedStyle(btn('PROFILE')).outlineStyle !== 'none' || style.boxShadow !== 'none');
            return { log: [status()], failures };
          `),
        );
      },
    },
  ],
} satisfies BrowserCases;

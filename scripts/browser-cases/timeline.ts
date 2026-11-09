// cookbook:browser cases for `:::timeline` (src/lib/docs/elements/timeline.ts,
// src/scripts/docs/elements/timeline.ts). The oracle is the page's own
// recordings: the live drawing starts with as many marks as the drawn step's
// recorded rows; the slider, set to a time the page's as-of step was recorded
// with, must light exactly the rows that step's recording names for that time
// (for a list parameter, the recording's row of that list item, in order;
// for a single time, every row); an edit to the drawn step redraws it from
// the run. The engine loads only when asked. The keyboard moves along a lane
// and between lanes, and each mark has an accessible name.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** Page-side helpers: the element's state, and what the page's recordings say. */
const HELPERS = `
  const pane = (h) => h.querySelector('.tl');
  // The live pane's marks only: the static form's two pictures draw marks too.
  const marks = (h) => [...pane(h).querySelectorAll('.tl-mark')];
  const lit = (h, cls) => new Set(marks(h).filter((g) => g.classList.contains(cls)).map((g) => g.dataset.key));
  const text = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const named = (rows, col) => { const out = new Set(); for (const r of rows) for (const x of [].concat(r[col])) if (x !== null && x !== undefined) out.add(text(x)); return out; };
  const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const show = (s) => '[' + [...s].join(', ') + ']';
  const attrs = (h) => JSON.parse(h.dataset.attrs || '{}');
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
  const settled = (h) => !pane(h).dataset.running && !pane(h).dataset.pending;
`;

export default {
  element: 'timeline',
  cases: [
    {
      name: 'the live drawing starts from the recording: a mark per recorded row, named marks, a description, no engine',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('timeline');
        expect(log, failures, 'the element goes live', !!h);
        if (!h) return { log, failures };
        const a = attrs(h);
        const rec = await recordedOf(a.cell);
        const rows = (rec.envelope.rows || []).filter((r) => r[a.start] !== null && r[a.start] !== undefined);
        expect(log, failures, 'one mark per recorded row with a start', marks(h).length === rows.length, marks(h).length + ' marks, ' + rows.length + ' rows');
        expect(log, failures, 'the drawing says it is the recording', pane(h).dataset.source === 'recorded');
        const status = h.querySelector('.tl-status').textContent;
        expect(log, failures, 'the status line opens with the shared wording', /^Recorded on relate \\d+\\.\\d+\\.\\d+ when the page was built\\./.test(status), status);
        expect(log, failures, 'every mark has an accessible name', marks(h).every((g) => (g.getAttribute('aria-label') || '').length > 0));
        expect(log, failures, 'exactly one mark takes Tab', marks(h).filter((g) => g.getAttribute('tabindex') === '0').length === 1);
        const svg = h.querySelector('.tl-svg');
        const desc = document.getElementById(svg.getAttribute('aria-describedby') || '');
        expect(log, failures, 'the drawing is described in words', !!desc && desc.textContent.length > 40, desc ? desc.textContent.slice(0, 80) : 'none');
        expect(log, failures, 'the engine is not loaded before a run', !engineLoaded());
        const frame = h.querySelector('.tl-frame');
        expect(log, failures, 'a narrow frame scrolls the drawing inside it, not the page', frame.scrollWidth <= frame.clientWidth + 1 || getComputedStyle(frame).overflowX === 'auto');
        return { log: [marks(h).length + ' marks in ' + pane(h).querySelectorAll('.tl-lane').length + ' lanes'], failures };
      `),
    },
    {
      name: 'the slider runs the as-of step and lights the rows its recording names for that time; Reset puts the recording back',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('timeline');
        if (!h) return { log, failures: ['the element did not go live'] };
        const a = attrs(h);
        const slider = h.querySelector('.tl-slider');
        if (!a.asof || !slider) return { log: ['no as-of step on this placement: nothing to slide'], failures };
        const editor = document.querySelector('cypher-cell[data-cell="' + a.asof + '"] .params-editor');
        const value = JSON.parse(editor.defaultValue)[a.param];
        const times = Array.isArray(value) ? value.slice(0, 2) : [value];
        const rec = (await recordedOf(a.asof)).envelope.rows;
        const drawnRows = (await recordedOf(a.cell)).envelope.rows.length;
        for (let i = 0; i < times.length; i++) {
          const T = Date.parse(times[i]);
          const p = pane(h);
          slider.value = String(Math.round((T - Number(p.dataset.first)) / Number(p.dataset.unit)));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(300);
          await until(() => settled(h) && /^From this tab's run/.test(h.querySelector('.tl-status').textContent) && p.dataset.t === iso(T), 180000);
          await idle();
          const status = h.querySelector('.tl-status').textContent;
          expect(log, failures, times[i] + ': the status line opens with the shared wording', /^From this tab's run of the \\S+ and \\S+ (?:steps|cells) on relate \\d+\\.\\d+\\.\\d+, [\\d.<]+ ms in the engine\\./.test(status), status);
          expect(log, failures, times[i] + ': the slider is at that time', p.dataset.t === iso(T), p.dataset.t);
          expect(log, failures, times[i] + ': the drawing is the live run, every recorded row drawn', p.dataset.source === 'live' && marks(h).length === drawnRows, marks(h).length + ' marks');
          const want = Array.isArray(value) ? [rec[i]] : rec;
          const got = lit(h, 'is-on');
          const exp = named(want, a.match);
          expect(log, failures, times[i] + ': lit on ' + a.match + ' as recorded', same(got, exp), show(got) + ' / recorded ' + show(exp));
          if (a['match-record']) {
            const gotR = lit(h, 'is-ron');
            const expR = named(want, a['match-record']);
            expect(log, failures, times[i] + ': lit on ' + a['match-record'] + ' as recorded', same(gotR, expR), show(gotR) + ' / recorded ' + show(expR));
          }
        }
        document.querySelector('#engineBar [data-action=reset]').click();
        await until(() => pane(h).dataset.source === 'recorded' && /^Recorded on/.test(h.querySelector('.tl-status').textContent), 20000);
        expect(log, failures, 'Reset puts the recording back, nothing lit', pane(h).dataset.source === 'recorded' && lit(h, 'is-on').size === 0 && lit(h, 'is-off').size === 0);
        return { log: [times.length + ' time(s) matched the recording of ' + a.asof], failures };
      `),
    },
    {
      name: 'an edit to the drawn step, run from the step, redraws the timeline from that run',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('timeline');
        if (!h) return { log, failures: ['the element did not go live'] };
        const a = attrs(h);
        const c = document.querySelector('cypher-cell[data-cell="' + a.cell + '"]');
        c.querySelector('[data-action=edit]').click();
        const ed = c.querySelector('.cell-editor');
        ed.value = ed.defaultValue.trim() + '\\nLIMIT 2';
        ed.dispatchEvent(new Event('input', { bubbles: true }));
        c.querySelector('[data-action=run]').click();
        await idle();
        await until(() => pane(h).dataset.source === 'live', 20000);
        expect(log, failures, 'the drawing follows the edited step: two marks', marks(h).length === 2, marks(h).length + ' marks');
        const status = h.querySelector('.tl-status').textContent;
        expect(log, failures, 'the status line says it is this tab\\'s run', /^From this tab's run/.test(status), status);
        return { log: [marks(h).length + ' marks after LIMIT 2'], failures };
      `),
    },
    {
      name: 'the keyboard moves along a lane and between lanes, and reads each mark out',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const up = await tab.evaluate<Outcome>(scenario(`const h = await live('timeline'); return { log: [], failures: h ? [] : ['the element did not go live'] };`));
        if (up.failures.length) return up;
        const state = `(() => {
          const h = document.querySelector('docs-element[data-element="timeline"]');
          const g = document.activeElement && document.activeElement.closest && document.activeElement.closest('.tl-mark');
          return { i: g ? Number(g.dataset.i) : null, lane: g ? g.getAttribute('aria-label') : null, detail: h.querySelector('.tl-detail').textContent, lanes: h.querySelector('.tl').querySelectorAll('.tl-lane').length };
        })()`;
        // Start on the first mark of a lane with more than one, so ArrowRight has somewhere to go; else on the mark that takes Tab.
        const roomy = await tab.evaluate<boolean>(`(() => {
          const all = [...document.querySelectorAll('docs-element[data-element="timeline"] .tl .tl-mark')];
          const g = all.find((m) => all.filter((x) => x.dataset.lane === m.dataset.lane).length > 1) || all.find((m) => m.getAttribute('tabindex') === '0');
          g.scrollIntoView({ block: 'center', behavior: 'instant' });
          g.focus();
          return all.filter((x) => x.dataset.lane === g.dataset.lane).length > 1;
        })()`);
        const s0 = await tab.evaluate<{ i: number | null; lane: string | null; detail: string; lanes: number }>(state);
        await tab.press('ArrowRight', 'ArrowRight', 39);
        const s1 = await tab.evaluate<{ i: number | null; lane: string | null; detail: string; lanes: number }>(state);
        await tab.press('ArrowDown', 'ArrowDown', 40);
        const s2 = await tab.evaluate<{ i: number | null; lane: string | null; detail: string; lanes: number }>(state);
        const failures: string[] = [];
        if (s0.i === null) failures.push('the first mark does not take focus');
        if (s0.detail !== s0.lane) failures.push(`focus does not read the mark out (${s0.detail} / ${s0.lane})`);
        // A lane of one mark has nowhere to go to the right: then ArrowRight keeps the focus.
        if (s1.i === null) failures.push('ArrowRight lost the focus');
        if (roomy && s1.i === s0.i) failures.push('ArrowRight did not move along the lane');
        if (s1.detail !== s1.lane) failures.push('ArrowRight: the detail line does not read the new mark');
        if (s0.lanes > 1 && (s2.i === null || s2.i === s1.i)) failures.push(`ArrowDown did not move to the next lane (${s1.i} -> ${s2.i})`);
        return { log: [`focus ${s0.i} -> ${s1.i} -> ${s2.i}`], failures };
      },
    },
  ],
} satisfies BrowserCases;

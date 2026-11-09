// cookbook:browser cases for the phase timing bar (the `timing` cell word and
// the engine bar's "Show timing", src/scripts/docs/elements/timing.ts). They
// run on the first built page with a `timing` cell: before a run the pane
// says the recording keeps no timings; after a run it draws three
// non-negative numbers that add up to about the elapsed time, labelled as
// this tab's run; Reset brings the note back; and the engine bar's toggle
// times a cell without the word, and hides the pane again when pressed off.
//
// The drawn numbers are compared with the engine's envelope exactly: the
// cell's JSON view shows its last live envelope, timings included, and each
// drawn phase must be that envelope's own field (a sum within a tolerance
// cannot tell execute from elapsed on a sub-millisecond statement).

import { formatMs, TIMER_STEP_MS } from '../../src/lib/docs/elements/_wording.ts';
import { scenario, type BrowserCases } from './_kit.ts';

const HELPERS = `
  const cell = document.querySelector('cypher-cell[data-elements~="timing"]');
  if (!cell) return { log: [], failures: ['no cell carries timing'] };
  cell.scrollIntoView({ block: 'center' });
  const pane = (c) => c.querySelector('.cell-slot-pane[data-slot="timing"]');
  await until(() => pane(cell) && pane(cell).textContent.trim(), 15000);
  const runCell = async (c) => { c.querySelector('[data-action=run]').click(); await idle(); };
  /** Each drawn statement's numbers, and whether they hold together. */
  const rows = (c) => [...(pane(c)?.querySelectorAll('.timing-row') ?? [])].map((r) => {
    const n = { parse: +r.dataset.parse, plan: +r.dataset.plan, execute: +r.dataset.execute, elapsed: +r.dataset.elapsed };
    n.ok = [n.parse, n.plan, n.execute, n.elapsed].every((v) => Number.isFinite(v) && v >= 0);
    n.text = r.querySelector('.timing-text').textContent;
    n.items = [...r.querySelectorAll('.timing-item')].map((i) => i.textContent);
    return n;
  });
  const TIMER_STEP_MS = ${TIMER_STEP_MS};
  const formatMs = ${formatMs.toString()};
  /** The cell's last live envelope, from its JSON view (session.ts shows it whole, timings included), then back to the result. */
  const envelopeOf = async (c) => {
    const tab = (v) => c.querySelector('[data-view=' + v + ']');
    tab('json').click();
    const text = await until(() => { const t = c.querySelector('.out-json').textContent.trim(); return t.startsWith('{') ? t : null; }, 5000);
    tab('text').click();
    return text ? JSON.parse(text) : null;
  };
  /** How the last drawn row differs from the envelope: each phase exactly its own field, and each text item that number. */
  const against = (row, env) => {
    if (!row || !env) return ['nothing to compare'];
    const out = [];
    const fields = { parse: 'parse_ms', plan: 'plan_ms', execute: 'execute_ms', elapsed: 'elapsed_ms' };
    for (const [k, f] of Object.entries(fields)) if (row[k] !== env[f]) out.push(k + ' drew ' + row[k] + ', envelope ' + f + ' ' + env[f]);
    const want = ['Parse ' + formatMs(env.parse_ms) + ' ms', 'Plan ' + formatMs(env.plan_ms) + ' ms', 'Execute ' + formatMs(env.execute_ms) + ' ms', formatMs(env.elapsed_ms) + ' ms elapsed'];
    if (JSON.stringify(row.items) !== JSON.stringify(want)) out.push('text ' + JSON.stringify(row.items) + ', want ' + JSON.stringify(want));
    return out;
  };
`;

export default {
  element: 'timing',
  cases: [
    {
      name: 'a run draws parse, plan and execute from the envelope',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        await runCell(cell);
        await until(() => rows(cell).length, 15000);
        const drawn = rows(cell);
        expect(log, failures, 'a bar appears under the result', drawn.length >= 1);
        expect(log, failures, 'four non-negative numbers', drawn.length && drawn.every((r) => r.ok), JSON.stringify(drawn[0]));
        const env = await envelopeOf(cell);
        const off = against(drawn.at(-1), env);
        expect(log, failures, "each phase is the envelope's own field, and each text item prints it", off.length === 0, off.join('; '));
        expect(log, failures, 'the numbers show as text', drawn.length && /Parse (?:<0\\.1|\\d+(?:\\.\\d)?) ms.*Plan (?:<0\\.1|\\d+(?:\\.\\d)?) ms.*Execute (?:<0\\.1|\\d+(?:\\.\\d)?) ms/.test(drawn[0].text), drawn[0] && drawn[0].text);
        expect(log, failures, "it is labelled as this tab's run, with the timer's step", /^Timing\\. From this tab's run on relate [\\d.]+\\. .*rounded to 0\\.1 ms/.test(pane(cell).querySelector('.timing-head').textContent), pane(cell).querySelector('.timing-head').textContent);
        expect(log, failures, 'it sits inside the result live region, which is not switched off for it', !!pane(cell).closest('[aria-live]') && pane(cell).closest('[aria-live]').getAttribute('aria-live') !== 'off', pane(cell).closest('[aria-live]') && pane(cell).closest('[aria-live]').getAttribute('aria-live'));
        expect(log, failures, 'each number is read once (no hidden sentence repeating the bar)', !pane(cell).querySelector('.visually-hidden'));
        return { log: [drawn.map((r) => r.text).join(' | ')], failures };
      `),
    },
    {
      name: 'a recorded result says it keeps no timings, and so does Reset',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        expect(log, failures, 'before a run the pane names the recording', /recorded result, which keeps no timings/.test(pane(cell).textContent), pane(cell).textContent);
        expect(log, failures, 'and draws no bar', !pane(cell).querySelector('.timing-bar'));
        await runCell(cell);
        await until(() => rows(cell).length, 15000);
        const bar = document.getElementById('engineBar');
        bar.querySelector('[data-action=reset]').click();
        await until(() => bar.dataset.status === 'emptied', 10000);
        await until(() => /recorded result/.test(pane(cell).textContent), 5000);
        expect(log, failures, 'after Reset the note is back', /recorded result, which keeps no timings/.test(pane(cell).textContent) && !pane(cell).querySelector('.timing-bar'), pane(cell).textContent);
        return { log: [pane(cell).textContent.slice(0, 70)], failures };
      `),
    },
    {
      name: 'Show timing on the engine bar times a cell without the word',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        const toggle = document.querySelector('#engineBar [data-bar-element="timing"]');
        expect(log, failures, 'the engine bar shows the toggle', toggle && !toggle.hidden);
        if (!toggle || toggle.hidden) return { log, failures };
        const other = [...document.querySelectorAll('cypher-cell')].find((c) => !(c.dataset.elements || '').includes('timing') && !c.hasAttribute('data-expect-error'));
        toggle.click();
        await until(() => toggle.getAttribute('aria-pressed') === 'true' && pane(other) && pane(other).textContent.trim(), 15000);
        expect(log, failures, 'pressed, a cell without the word gets the note', /keeps no timings/.test(pane(other).textContent), pane(other) && pane(other).textContent);
        const noted = [...document.querySelectorAll('.cell-slot-pane[data-slot="timing"]')].filter((p) => !p.hidden && p.querySelector('.timing-note'));
        expect(log, failures, 'the notes the toggle writes are kept out of the live regions (one status line announces the toggle)', noted.length >= 1 && noted.every((p) => p.getAttribute('aria-live') === 'off'), noted.length + ' notes; ' + noted.map((p) => p.getAttribute('aria-live')).join(','));
        await runCell(other);
        await until(() => rows(other).length, 15000);
        const drawn = rows(other);
        expect(log, failures, 'its run draws the bar', drawn.length >= 1 && drawn.every((r) => r.ok), JSON.stringify(drawn[0]));
        const off = against(drawn.at(-1), await envelopeOf(other));
        expect(log, failures, "its last statement's phases are the envelope's own fields", off.length === 0, off.join('; '));
        toggle.click();
        await until(() => toggle.getAttribute('aria-pressed') === 'false', 5000);
        await wait(100);
        expect(log, failures, 'pressed off, the pane hides', pane(other).hidden && !pane(other).textContent);
        return { log: [(drawn[0] && drawn[0].text) || ''], failures };
      `),
    },
    {
      name: 'a run that finishes before the module mounts is still timed',
      scenario: scenario(`
        const log = [], failures = [];
        const pane = (c) => c.querySelector('.cell-slot-pane[data-slot="timing"]');
        const cell = document.querySelector('cypher-cell[data-elements~="timing"]');
        if (!cell) return { log: [], failures: ['no cell carries timing'] };
        window.scrollTo(0, 0);
        await wait(300);
        const before = pane(cell);
        const far = cell.getBoundingClientRect().top > innerHeight + 700;
        // Run without scrolling to the cell, so its module mounts (on intersection) only after the run.
        cell.querySelector('[data-action=run]').click();
        await until(() => cell.classList.contains('is-live') || cell.classList.contains('is-error'), 90000);
        expect(log, failures, 'the run finished', cell.classList.contains('is-live'));
        cell.scrollIntoView({ block: 'center' });
        await until(() => pane(cell) && pane(cell).querySelector('.timing-row'), 15000);
        const text = pane(cell) ? pane(cell).textContent : '';
        expect(log, failures, 'the pane draws that run, not a note that it ran before the bar', !!pane(cell) && !!pane(cell).querySelector('.timing-row') && !/ran before/.test(text), text.slice(0, 120));
        return { log: [(far && !before ? 'mounted after the run' : 'the cell was within reach at load') + '; ' + text.slice(0, 80)], failures };
      `),
    },
  ],
} satisfies BrowserCases;

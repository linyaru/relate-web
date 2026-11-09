// cookbook:browser cases for `:::agent-trace` (src/lib/docs/elements/agent-trace.ts,
// src/scripts/docs/elements/agent-trace.ts). The oracle is the page's static
// form: each step, sent live, must return what it returned when the page was
// recorded (the same rows, the same counters, or the same tool error), and a
// step that repeats a cell must match that cell's recording. The engine loads
// only when the trace is played. After the trace, the page's own cells must
// run cleanly (a trace that wrote empties the database when it ends; one that
// only read leaves it as the cells built it), and a trace started
// after the cells ran must empty the database first instead of failing on a
// constraint. The keyboard reaches Step and Enter sends a step.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/**
 * Page-side helpers: what a step's result says, reduced to what both the
 * recording and a live run spell the same way (the rows of its table, the
 * counters, or that it was a tool error), and every step's summary.
 */
const HELPERS = `
  // Typographic quotes, should the page's markdown make them, read as the plain ones a live table shows.
  const plain = (t) => t.replace(/[\\u201c\\u201d]/g, '"').replace(/[\\u2018\\u2019]/g, "'").trim();
  const summary = (el) => {
    const table = el.querySelector('table');
    if (table) return 'rows ' + JSON.stringify([...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => plain(td.textContent))));
    const text = el.textContent.replace(/\\s+/g, ' ');
    const counters = /Counters: ([^;.]*)/.exec(text);
    if (counters) return 'counters ' + counters[1].trim();
    if (/Tool error/.test(text)) return 'tool error';
    if (/schema map is empty/.test(text)) return 'empty schema';
    return 'other ' + text.trim().slice(0, 80);
  };
  const items = (h) => [...h.querySelectorAll('.trace-item')];
  const results = (h) => items(h).map((li) => summary(li.querySelector('.trace-result')));
  // Whether a write_cypher step answered with a result: only then does the trace empty the database when it ends.
  const wroteSomething = (h) => items(h).some((li) => li.dataset.state === 'done' && [...li.querySelectorAll('summary')].some((x) => /^Request, step \\d+: write_cypher$/.test(x.textContent)));
  const finished = (h) => items(h).every((li) => li.dataset.state === 'done' || li.dataset.state === 'error') || /could not run/.test(h.querySelector('.trace-status').textContent);
  // Whether the engine started: the bar records the version the worker reports, and the page fetches the worker's script.
  // (engineLoaded() looks for the wasm files, which the worker fetches on its own timeline, so the page never sees them.)
  const engineUp = () => !!(document.getElementById('engineBar') || { dataset: {} }).dataset.engineVersion || performance.getEntriesByType('resource').some((e) => e.name.includes('/_astro/worker-'));
  const cellsMatch = () => {
    const cells = [...document.querySelectorAll('cypher-cell')].filter((c) => !c.hasAttribute('data-expect-error'));
    const bad = cells.filter((c) => !/matches the recording/.test(c.querySelector('.out-label').textContent) || /is-error|is-blocked/.test(c.className));
    return { total: cells.length, bad: bad.map((c) => c.dataset.cell + ': ' + c.querySelector('.out-label').textContent.trim().slice(0, 80)) };
  };
`;

export default {
  element: 'agent-trace',
  cases: [
    {
      name: 'Play all sends every step, each returning what it returned when the page was recorded',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('agent-trace');
        expect(log, failures, 'the element goes live', !!h);
        if (!h) return { log, failures };
        const recorded = results(h);
        expect(log, failures, 'every step shows its recording before it is sent', items(h).length > 0 && items(h).every((li) => li.querySelector('.trace-recorded-label')), items(h).length + ' steps');
        expect(log, failures, 'the engine is not loaded before Play all', !engineLoaded() && !engineUp());
        h.querySelector('.trace-play-btn').click();
        await until(() => finished(h), 180000);
        await idle();
        const live_ = results(h);
        const bad = live_.map((s, i) => (s === recorded[i] ? null : 'step ' + (i + 1) + ': ' + s + ' / recorded ' + recorded[i])).filter(Boolean);
        expect(log, failures, 'the engine started on Play all', engineUp());
        expect(log, failures, 'every step answered', items(h).every((li) => li.dataset.state === 'done' || li.dataset.state === 'error'), items(h).map((li) => li.dataset.state).join(','));
        expect(log, failures, 'every step returned what it returned when recorded', bad.length === 0, bad.join(' | '));
        const names = [...h.querySelectorAll('.trace-steps summary')].map((x) => x.textContent);
        expect(log, failures, 'every disclosure names its step and tool, none twice', names.length >= items(h).length && new Set(names).size === names.length && names.every((n) => /^(?:Request|Reply), step \\d+: \\w+$/.test(n)), names.join(' | '));
        const blocks = [...h.querySelectorAll('.trace-steps pre[tabindex]')];
        expect(log, failures, 'every scrollable block has a name', blocks.length > 0 && blocks.every((b) => (b.getAttribute('aria-label') || '').length > 0), blocks.length + ' blocks');
        expect(log, failures, 'the status line opens with the shared wording', /^From this tab's run on relate \\d+\\.\\d+\\.\\d+/.test(h.querySelector('.trace-status').textContent), h.querySelector('.trace-status').textContent);
        const matches = [...h.querySelectorAll('.trace-match')];
        expect(log, failures, 'a step that repeats a cell matches its recording', matches.every((m) => m.dataset.match === 'true'), matches.map((m) => m.textContent).join(' | '));
        if (wroteSomething(h)) {
          await until(() => /has ended/.test(h.querySelector('.trace-warn').textContent), 20000);
          expect(log, failures, 'the trace empties the database it wrote when it ends', /has ended/.test(h.querySelector('.trace-warn').textContent), h.querySelector('.trace-warn').textContent);
        } else {
          expect(log, failures, 'a trace that wrote nothing leaves the database as the cells built it, with no warning', h.querySelector('.trace-warn').hidden, h.querySelector('.trace-warn').textContent);
        }
        return { log: [items(h).length + ' steps as recorded; ' + matches.length + ' cell match(es)'], failures };
      `),
    },
    {
      name: 'after the cells ran, Step empties the database first; after the trace, the cells run cleanly',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('agent-trace');
        if (!h) return { log, failures: ['the element did not go live'] };
        const recorded = results(h);
        const bar = document.getElementById('engineBar');
        bar.querySelector('[data-action=run-all]').click();
        await idle();
        const before = cellsMatch();
        expect(log, failures, 'Run all: every cell matches its recording', before.bad.length === 0, before.bad.join(' | '));
        const n = items(h).length;
        for (let i = 0; i < n; i++) {
          h.querySelector('.trace-step-btn').click();
          await until(() => ['done', 'error'].includes(items(h)[i].dataset.state) || /could not run/.test(h.querySelector('.trace-status').textContent), 120000);
          const got = summary(items(h)[i].querySelector('.trace-result'));
          expect(log, failures, 'step ' + (i + 1) + ' returns what it returned when recorded', got === recorded[i], got + ' / recorded ' + recorded[i]);
          if (got !== recorded[i]) break;
        }
        if (wroteSomething(h)) await until(() => /has ended/.test(h.querySelector('.trace-warn').textContent), 20000);
        await idle();
        bar.querySelector('[data-action=run-all]').click();
        await idle();
        const after = cellsMatch();
        expect(log, failures, 'after the trace, Run all: every cell matches its recording (no constraint error)', after.total > 0 && after.bad.length === 0, after.bad.join(' | '));
        h.querySelector('.trace-restart-btn').click();
        expect(log, failures, 'Restart puts every step back on its recording', items(h).every((li) => li.dataset.state === 'pending' && li.querySelector('.trace-recorded-label')));
        return { log: [n + ' steps after Run all; ' + after.total + ' cells matched after the trace'], failures };
      `),
    },
    {
      name: 'the keyboard reaches Step, and Enter sends one step',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const up = await tab.evaluate<Outcome>(scenario(`const h = await live('agent-trace'); return { log: [], failures: h ? [] : ['the element did not go live'] };`));
        if (up.failures.length) return up;
        const focused = await tab.evaluate<boolean>(`(() => {
          const b = document.querySelector('docs-element[data-element="agent-trace"] .trace-step-btn');
          b.scrollIntoView({ block: 'center', behavior: 'instant' });
          b.focus();
          return document.activeElement === b;
        })()`);
        await tab.press('Enter', 'Enter', 13);
        const after = await tab.evaluate<Outcome & { states: string[] }>(
          scenario(`
            const h = document.querySelector('docs-element[data-element="agent-trace"]');
            const items = [...h.querySelectorAll('.trace-item')];
            await until(() => ['done', 'error'].includes(items[0].dataset.state) || /could not run/.test(h.querySelector('.trace-status').textContent), 120000);
            await wait(300);
            return { log: [], failures: [], states: items.map((li) => li.dataset.state) };
          `),
        );
        const failures: string[] = [];
        if (!focused) failures.push('Step does not take focus');
        if (!['done', 'error'].includes(after.states[0])) failures.push(`Enter did not send step 1 (${after.states.join(',')})`);
        if (after.states.slice(1).some((s) => s !== 'pending')) failures.push(`one Enter sent more than one step (${after.states.join(',')})`);
        return { log: [`after Enter: ${after.states.join(', ')}`], failures };
      },
    },
  ],
} satisfies BrowserCases;

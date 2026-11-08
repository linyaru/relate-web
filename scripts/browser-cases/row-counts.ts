// cookbook:browser cases for `:::row-counts`, the framework's example element
// (src/lib/docs/elements/row-counts.ts): it renders once scrolled near, a cell
// run fills its live column, and its two buttons reach the page's database
// and a read-only one. Two cases prove the framework rather than the
// element: an element's run and a cell run never overlap (the exclusive
// lock), and the element still works after the reader goes to another page
// and comes back through the history (the back/forward cache).

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/** The live counts after Run all, against the recordings, in the page (helpers from scenario()). */
const RUN_ALL_MATCHES = `
  const h = host('row-counts');
  h.scrollIntoView({ block: 'center' });
  await until(() => h.dataset.state === 'live', 15000);
  document.querySelector('#engineBar [data-action=run-all]').click();
  await idle();
  const rows = [...h.querySelectorAll('.element-live tbody tr')];
  const bad = rows.filter((r) => r.querySelector('.live').textContent !== r.children[1].textContent);
  const log = [], failures = [];
  expect(log, failures, 'the element is live', h.dataset.state === 'live', h.dataset.state);
  expect(log, failures, 'every live count equals its recording', rows.length > 0 && bad.length === 0, bad.map((r) => r.querySelector('code').textContent + '=' + r.querySelector('.live').textContent).join(', '));
  return { log: [rows.map((r) => r.querySelector('code').textContent + '=' + r.querySelector('.live').textContent).join(' ')], failures };
`;

export default {
  element: 'row-counts',
  cases: [
    {
      name: 'renders when scrolled near, without loading the engine',
      scenario: scenario(`
        const log = [], failures = [];
        const h = await live('row-counts');
        expect(log, failures, 'the element goes live', !!h);
        if (!h) return { log, failures };
        const rows = h.querySelectorAll('.element-live tbody tr').length;
        expect(log, failures, 'one row per chosen cell', rows === JSON.parse(h.dataset.attrs).cells.split(',').length, rows + ' rows');
        expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
        expect(log, failures, 'the engine is not loaded', !engineLoaded());
        return { log: [rows + ' rows; ' + log.filter((l) => l.startsWith('FAIL')).length + ' failed'], failures };
      `),
    },
    {
      name: 'Run all fills the live column with the recorded counts',
      scenario: scenario(`
        const log = [], failures = [];
        const h = await live('row-counts');
        if (!h) return { log, failures: ['the element did not go live'] };
        document.querySelector('#engineBar [data-action=run-all]').click();
        await idle();
        const rows = [...h.querySelectorAll('.element-live tbody tr')];
        const bad = rows.filter((r) => r.querySelector('.live').textContent !== r.children[1].textContent);
        expect(log, failures, 'every live count equals its recording', bad.length === 0, bad.map((r) => r.querySelector('code').textContent).join(', '));
        expect(log, failures, 'every row has a time', rows.every((r) => /ms/.test(r.querySelector('.time').textContent)));
        return { log: [rows.map((r) => r.querySelector('code').textContent + '=' + r.querySelector('.live').textContent).join(' ')], failures };
      `),
    },
    {
      name: 'page.run and page.runReadOnly answer from the engine',
      scenario: scenario(`
        const log = [], failures = [];
        const h = await live('row-counts');
        if (!h) return { log, failures: ['the element did not go live'] };
        const [count, write] = h.querySelectorAll('.element-live .actions button');
        const said = h.querySelector('.element-live .said');
        count.click();
        await until(() => /nodes in the page|failed|Could not/.test(said.textContent), 60000);
        const counted = said.textContent;
        expect(log, failures, 'Count nodes runs the cells first, then counts', /^From this tab's run on relate [\\d.]+, (?:<0\\.1|\\d+(?:\\.\\d)?) ms in the engine\\. \\d+ nodes in the page's database\\.$/.test(counted) && !/ 0 nodes/.test(counted), counted);
        write.click();
        await until(() => /Refused|went through|Could not/.test(said.textContent) && said.textContent !== counted, 30000);
        expect(log, failures, 'a write on a read-only database is refused', /Refused: .*WriteOnReadOnlyAccessDatabase/.test(said.textContent), said.textContent);
        return { log: [counted + ' / ' + said.textContent.slice(0, 80)], failures };
      `),
    },
    {
      name: 'an element run and a cell run never overlap',
      scenario: scenario(`
        const log = [], failures = [];
        const h = await live('row-counts');
        if (!h) return { log, failures: ['the element did not go live'] };
        const [count] = h.querySelectorAll('.element-live .actions button');
        const said = h.querySelector('.element-live .said');
        const bar = document.getElementById('engineBar');
        const runAll = bar.querySelector('[data-action=run-all]');
        const done = (before) => until(() => said.textContent !== before && /nodes in the page|failed|Could not/.test(said.textContent), 60000);
        const nodes = () => Number((/ (\\d+) nodes in the page/.exec(said.textContent) || [])[1]);
        const cells = [...document.querySelectorAll('cypher-cell')].filter((c) => !c.hasAttribute('data-expect-error'));
        const matching = () => cells.filter((c) => /matches the recording/.test(c.querySelector('.out-label').textContent)).length;
        // The element's run (which runs every cell first) and Run all, pressed in one tick: one holds the lock, the other waits or is refused, and every cell runs once.
        count.click();
        runAll.click();
        await done('');
        await idle();
        const together = nodes();
        expect(log, failures, 'every cell matches its recording', matching() === cells.length, matching() + ' of ' + cells.length);
        // Run all first, then the element's run, in one tick: the element waits for Run all.
        bar.querySelector('[data-action=reset]').click();
        await until(() => bar.dataset.status === 'emptied', 10000);
        runAll.click();
        const first = said.textContent;
        count.click();
        await done(first);
        await idle();
        const behind = nodes();
        // The same count alone, on a fresh database: what each cell running once makes.
        bar.querySelector('[data-action=reset]').click();
        await until(() => bar.dataset.status === 'emptied', 10000);
        const second = said.textContent;
        count.click();
        await done(second);
        const alone = nodes();
        expect(log, failures, 'the count alone is a number above 0', alone > 0, said.textContent);
        expect(log, failures, 'pressed with Run all, the count is the same (no cell ran twice)', together === alone, together + ' vs ' + alone);
        expect(log, failures, 'pressed after Run all, the count is the same', behind === alone, behind + ' vs ' + alone);
        return { log: ['with Run all ' + together + ', behind Run all ' + behind + ', alone ' + alone + ' nodes'], failures };
      `),
    },
    {
      name: 'works after going to another page and back',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const up = await tab.evaluate<Outcome>(scenario(`const h = await live('row-counts'); return { log: [], failures: h ? [] : ['the element did not go live'] };`));
        if (up.failures.length) return up;
        await tab.navigate('/docs/');
        const { restored } = await tab.back();
        const after = await tab.evaluate<Outcome>(scenario(RUN_ALL_MATCHES));
        const how = restored ? 'restored from the back/forward cache' : 'loaded again (the browser did not keep it in its back/forward cache)';
        return { log: [`${how}: ${after.log[0] ?? ''}`], failures: after.failures };
      },
    },
  ],
} satisfies BrowserCases;

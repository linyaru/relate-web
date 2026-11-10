// cookbook:browser cases for `:::scale-demo`, the scale demo
// (src/lib/docs/elements/scale-demo.ts): it goes live without starting any
// engine and offers the size for the screen; Build runs the three cells at
// a hundred thousand nodes on a second engine, leaves the page's engine
// unstarted and its cells on their recordings, and draws nothing; the
// count and the walk run again from another node; Free, the engine bar's
// Reset and Stop each close the second engine and put the recordings back.

import { scenario, type BrowserCases } from './_kit.ts';

/** Bring the element live: `h` the host, `root` the pane, and its parts. */
const UP = `
  const h = await live('scale-demo');
  if (!h) return { log: [], failures: ['the element did not go live (state ' + (host('scale-demo') || {}).dataset?.state + ')'] };
  const root = h.querySelector('.scale-demo');
  const q = (s) => root.querySelector(s);
  const said = q('.sd-said');
  const cell = (role) => { const tr = root.querySelector('tr[data-role="' + role + '"]'); return { recorded: tr.querySelector('.sd-recorded').textContent, live: tr.querySelector('.sd-live').textContent, time: tr.querySelector('.sd-time').textContent }; };
  const bar = document.getElementById('engineBar');
`;

/** Build at `size` and wait until the run is over. */
const build = (size: number) => `
  q('.sd-size select').value = '${size}';
  q('.sd-build').click();
  await wait(50);
  await until(() => root.dataset.state !== 'running', 180000);
`;

/** "From this tab's run of …, 12.3 ms in the engine." */
const LIVE_LINE = String.raw`/^From this tab's run of .+ on relate \d+\.\d+\.\d+, (?:<0\.1|\d+(?:\.\d)?) ms in the engine\.$/`;

export default {
  element: 'scale-demo',
  cases: [
    {
      name: 'goes live without an engine, offering the size for the screen',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const wide = innerWidth >= 720;
        expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
        expect(log, failures, 'no engine has started', !engineLoaded() && !bar.dataset.status, bar.dataset.status);
        expect(log, failures, 'one row per cell, each with its recording', ['build', 'count', 'walk'].every((r) => /: \\d/.test(cell(r).recorded)), ['build', 'count', 'walk'].map((r) => cell(r).recorded).join(' / '));
        expect(log, failures, 'the status names the recording', /^Recorded on relate [\\d.]+ when the page was built\\. The table shows the cells' recordings, with n = 1,000\\.$/.test(said.textContent), said.textContent);
        const size = q('.sd-size select').value;
        expect(log, failures, (wide ? 'a wide screen' : 'a narrow screen') + ' is offered ' + (wide ? 'the largest size' : 'the middle size'), size === (wide ? '100000' : '10000'), size);
        expect(log, failures, 'the memory note is there before anything runs', /memory/.test(q('.sd-note').textContent));
        expect(log, failures, 'Free and the rerun wait for a build', q('.sd-free').disabled && q('.sd-rerun').disabled);
        return { log: [innerWidth + ' px, offered ' + size + '; ' + log.filter((l) => l.startsWith('FAIL')).length + ' failed'], failures };
      `),
    },
    {
      name: 'Build runs the cells at 100,000 nodes on a second engine and draws nothing',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        ${build(100000)}
        const b = cell('build'), c = cell('count'), w = cell('walk');
        expect(log, failures, 'the build made 99,999 relationships', b.live === 'relationships: 99,999', b.live + ' / ' + said.textContent);
        expect(log, failures, 'the count reads 100,000 nodes and 99,999 relationships', c.live === 'nodes: 100,000, relationships: 99,999', c.live);
        expect(log, failures, 'the walk from node 1 reaches its descendants', /^descendants: [\\d,]+$/.test(w.live) && w.live !== w.recorded, w.live);
        expect(log, failures, 'each cell has an engine time', [b, c, w].every((x) => /^(?:<0\\.1|\\d+(?:\\.\\d)?) ms$/.test(x.time)), [b, c, w].map((x) => x.time).join(', '));
        expect(log, failures, 'the status is the live line', ${LIVE_LINE}.test(said.textContent) && /n = 100,000/.test(said.textContent), said.textContent);
        expect(log, failures, 'the memory line names this tab', /^The second engine's memory in this tab: [\\d,]+ MB\\./.test(q('.sd-memory').textContent), q('.sd-memory').textContent);
        expect(log, failures, 'nothing is drawn: no canvas in the pane', !root.querySelector('canvas'));
        expect(log, failures, "the page's engine never started", !bar.dataset.status, bar.dataset.status);
        expect(log, failures, "the page's cells keep their recordings", [...document.querySelectorAll('cypher-cell')].every((x) => !x.classList.contains('is-live')));
        return { log: [b.time + ' build, ' + c.time + ' count, ' + w.time + ' walk; ' + q('.sd-memory').textContent.split('.')[0]], failures };
      `),
    },
    {
      name: 'the count and the walk run again from another node',
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        ${build(1000)}
        const first = cell('walk').live;
        q('.sd-start input').value = '3';
        q('.sd-rerun').click();
        await wait(50);
        await until(() => root.dataset.state !== 'running', 60000);
        const again = cell('walk').live;
        expect(log, failures, 'the walk from node 3 reaches fewer nodes than from node 1', /^descendants: \\d+$/.test(again) && Number(again.split(': ')[1]) < Number(first.split(': ')[1].replace(/,/g, '')), first + ' then ' + again);
        expect(log, failures, 'the status is the live line for the two cells', ${LIVE_LINE}.test(said.textContent) && /from node 3/.test(said.textContent), said.textContent);
        expect(log, failures, 'the count is unchanged', cell('count').live === 'nodes: 1,000, relationships: 999', cell('count').live);
        return { log: [first + ' -> ' + again], failures };
      `),
    },
    {
      name: "Free, the engine bar's Reset and Stop each close the second engine",
      scenario: scenario(`
        ${UP}
        const log = [], failures = [];
        const back = () => ['build', 'count', 'walk'].every((r) => cell(r).live === '-' && cell(r).time === '-') && !q('.sd-memory').textContent && q('.sd-free').disabled;
        ${build(1000)}
        expect(log, failures, 'built', cell('count').live === 'nodes: 1,000, relationships: 999', cell('count').live);
        q('.sd-free').click();
        expect(log, failures, 'Free puts the recordings back', back() && /^The second engine is closed/.test(said.textContent), said.textContent);
        ${build(1000)}
        bar.querySelector('[data-action=reset]').click();
        await until(() => back(), 10000);
        expect(log, failures, "the engine bar's Reset closes it too", back() && /The page was reset/.test(said.textContent), said.textContent);
        q('.sd-size select').value = '100000';
        q('.sd-build').click();
        await until(() => /^Building/.test(said.textContent), 30000);
        q('.sd-stop').click();
        await wait(300);
        expect(log, failures, 'Stop during a build closes it', back() && root.dataset.state === 'idle' && /^Stopped/.test(said.textContent), said.textContent);
        ${build(1000)}
        expect(log, failures, 'a build after Stop works', cell('count').live === 'nodes: 1,000, relationships: 999', cell('count').live + ' / ' + said.textContent);
        return { log: [log.filter((l) => l.startsWith('ok')).length + ' of ' + log.length + ' checks'], failures };
      `),
    },
  ],
} satisfies BrowserCases;

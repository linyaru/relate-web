// cookbook:browser cases for `:::storage-animator`, the storage animator
// (src/lib/docs/elements/storage-animator.ts): it goes live without the
// engine and says where its facts come from; a commit steps through the
// write path; a checkpoint and a crash replay what the WAL holds; the
// durability view's mode switch and crash slider move the loss window, the
// slider under real arrow keys; the `.rl` view keeps the space a checkpoint
// frees; the controls answer real keys; and under reduced motion each step
// waits for Next. The first built page with the element is
// concepts/storage-and-durability, which shows all three views.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

/**
 * Helpers in the page: `up()` brings the element live and returns its host;
 * `panel(view)` shows a view and returns its panel; `act(p, name)` presses an
 * action and then Next until the steps are done, so it works with motion and
 * under reduced motion alike.
 */
const HELPERS = `
  const up = async () => {
    const h = await live('storage-animator');
    if (!h) throw new Error('the element did not go live (state ' + (host('storage-animator') || {}).dataset?.state + ')');
    return h;
  };
  const panel = (h, view) => {
    const b = h.querySelector('.sa-scene[data-scene="' + view + '"]');
    if (b) b.click();
    return h.querySelector('.sa-panel[data-view="' + view + '"]');
  };
  const act = async (p, name) => {
    p.querySelector('.sa-' + name).click();
    for (let i = 0; i < 12 && p.dataset.busy === 'true'; i++) {
      p.querySelector('.sa-next').click();
      await wait(30);
    }
    return p.querySelector('.sa-say').textContent;
  };
`;

const run = (body: string) => scenario(`${HELPERS}\ntry {\n${body}\n} catch (e) { return { log: [], failures: [String(e && e.message || e)] }; }`);

export default {
  element: 'storage-animator',
  cases: [
    {
      name: 'goes live without the engine, and a commit steps through the write path',
      scenario: run(`
        const log = [], failures = [];
        const h = await up();
        const status = h.querySelector('.sa-status').textContent;
        expect(log, failures, 'the status line opens with the recorded wording', /^Recorded on relate [\\d.]+ when the page was built\\. /.test(status), status);
        expect(log, failures, 'the status line says no engine runs', /no engine runs/.test(status));
        expect(log, failures, 'one view switch per view', h.querySelectorAll('.sa-scene').length === 3);
        const p = panel(h, 'write-path');
        expect(log, failures, 'the write path shows first', p && !p.hidden);
        expect(log, failures, 'a drawing is on the stage', !!p.querySelector('.sa-stage svg [data-part="wal"]'));
        const said = await act(p, 'commit');
        expect(log, failures, 'the commit ran six steps and ended acknowledged', /^Commit, step 6 of 6: The commit is acknowledged/.test(said), said);
        expect(log, failures, 'the store took LSN 2 into the WAL and the graph', p.dataset.lsn === '2' && p.dataset.graphLsn === '2' && p.dataset.checkpointLsn === '1', JSON.stringify(p.dataset));
        expect(log, failures, 'the record sits in the open segment', [...p.querySelectorAll('.sa-stage .chip')].some((c) => c.textContent === '2'));
        expect(log, failures, 'the engine is not loaded', !engineLoaded());
        expect(log, failures, 'the engine bar stays out of sight', document.getElementById('engineBar')?.hidden !== false);
        return { log: [said.slice(0, 90)], failures };
      `),
    },
    {
      name: 'a checkpoint and a crash replay what the WAL holds',
      scenario: run(`
        const log = [], failures = [];
        const h = await up();
        const p = panel(h, 'write-path');
        await act(p, 'commit');
        await act(p, 'commit');
        const cp = await act(p, 'checkpoint');
        expect(log, failures, 'the checkpoint ends on Recycle', /^Checkpoint, step 5 of 5: Recycle/.test(cp), cp);
        expect(log, failures, 'the snapshot holds LSN 3 and the WAL one new segment', p.dataset.checkpointLsn === '3' && p.dataset.segments === '3', JSON.stringify(p.dataset));
        const again = p.querySelector('.sa-checkpoint');
        expect(log, failures, 'a second checkpoint has nothing to do', again.getAttribute('aria-disabled') === 'true');
        await act(p, 'commit');
        p.querySelector('.sa-crash').click();
        const crashed = p.dataset.graphLsn;
        let replayed = '';
        for (let i = 0; i < 6 && p.dataset.busy === 'true'; i++) {
          const say = p.querySelector('.sa-say').textContent;
          if (/replays/.test(say)) replayed = say;
          p.querySelector('.sa-next').click();
          await wait(30);
        }
        if (/replays/.test(p.querySelector('.sa-say').textContent)) replayed = p.querySelector('.sa-say').textContent;
        expect(log, failures, 'the crash takes the graph', crashed === 'none', crashed);
        expect(log, failures, 'the open replays the one record past the snapshot', /replays the WAL records with an LSN above 3, in LSN order: 1 record/.test(replayed), replayed);
        expect(log, failures, 'every acknowledged commit is back', p.dataset.graphLsn === '4', p.dataset.graphLsn);
        p.querySelector('.sa-reset').click();
        expect(log, failures, 'Reset goes back to the store as it opened', p.dataset.lsn === '1' && p.dataset.graphLsn === '1');
        return { log: ['checkpoint LSN ' + 3 + ', replayed to LSN ' + 4], failures };
      `),
    },
    {
      name: 'the mode switch and the crash slider move the loss window',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const first = await tab.evaluate<Outcome>(
          run(`
            const log = [], failures = [];
            const h = await up();
            const p = panel(h, 'durability');
            expect(log, failures, 'the durability view shows', p && !p.hidden);
            const lost = () => p.dataset.lost;
            expect(log, failures, 'full loses nothing', p.dataset.mode === 'full' && lost() === '0', p.dataset.mode + ' ' + lost());
            const pick = (m) => { const r = p.querySelector('input[value="' + m + '"]'); r.click(); };
            pick('everysecond');
            expect(log, failures, 'everysecond loses the two writes after the 4 s sync', lost() === '2' && /last background sync was at 4 s/.test(p.querySelector('.sa-say').textContent), lost());
            expect(log, failures, 'the window is drawn', !!p.querySelector('.sa-stage .win'));
            pick('snapshot');
            expect(log, failures, 'snapshot loses every acknowledged write', lost() === p.dataset.acked && lost() === '8', lost() + ' of ' + p.dataset.acked);
            p.querySelector('input[type=range]').focus();
            return { log, failures };
          `),
        );
        if (first.failures.length) return first;
        for (let i = 0; i < 6; i++) await tab.press('ArrowLeft', 'ArrowLeft', 37);
        const after = await tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            const p = host('storage-animator').querySelector('.sa-panel[data-view="durability"]');
            expect(log, failures, 'six presses of the left arrow move the crash to 4 s', p.dataset.crash === '4', p.dataset.crash);
            expect(log, failures, 'the output says so', p.querySelector('output').textContent === '4 s');
            expect(log, failures, 'snapshot now loses the six writes before it', p.dataset.lost === '6', p.dataset.lost);
            return { log: ['crash at ' + p.dataset.crash + ' s, snapshot loses ' + p.dataset.lost], failures };
          `),
        );
        return { log: [...after.log, ...first.log.filter((l) => l.startsWith('FAIL'))], failures: after.failures };
      },
    },
    {
      name: 'the .rl view keeps the space a checkpoint frees',
      scenario: run(`
        const log = [], failures = [];
        const h = await up();
        const p = panel(h, 'rl-file');
        expect(log, failures, 'the .rl view shows', p && !p.hidden);
        const file = () => p.querySelector('.sa-stage .file');
        const tall = () => Number(file().getAttribute('height'));
        const before = tall();
        expect(log, failures, 'the superblock names its version marker', /MDBCLB01, version 1/.test(p.querySelector('[data-part="superblock"]').textContent));
        await act(p, 'commit');
        const said = await act(p, 'checkpoint');
        expect(log, failures, 'the checkpoint recycles inside the file', /does not shrink/.test(said), said);
        expect(log, failures, 'the file keeps space to reuse', !!p.querySelector('.sa-stage [data-part="free"]'));
        expect(log, failures, 'the file grew and did not shrink back', tall() > before, before + ' -> ' + tall());
        const high = tall();
        await act(p, 'commit');
        await act(p, 'checkpoint');
        expect(log, failures, 'a second checkpoint reuses that space', tall() === high, high + ' -> ' + tall());
        return { log: ['file outline ' + before + ' -> ' + high], failures };
      `),
    },
    {
      name: 'the controls answer real keys',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const ready = await tab.evaluate<Outcome>(
          run(`
            const h = await up();
            const p = panel(h, 'write-path');
            const box = h.querySelector('.sa-stepbox');
            if (box.checked) box.click();
            box.focus();
            return { log: [], failures: [] };
          `),
        );
        if (ready.failures.length) return ready;
        await tab.press(' ', 'Space', 32);
        await tab.evaluate(`document.querySelector('docs-element[data-element="storage-animator"] .sa-panel[data-view="write-path"] .sa-commit').focus()`);
        await tab.press('Enter', 'Enter', 13);
        const started = await tab.evaluate<{ busy: string; focus: string; say: string; box: boolean }>(
          `(() => { const h = document.querySelector('docs-element[data-element="storage-animator"]'); const p = h.querySelector('.sa-panel[data-view="write-path"]'); return { busy: p.dataset.busy, focus: document.activeElement?.className || '', say: p.querySelector('.sa-say').textContent, box: h.querySelector('.sa-stepbox').checked }; })()`,
        );
        const failures: string[] = [];
        if (!started.box) failures.push('Space did not tick Step by step');
        if (started.busy !== 'true' || !/step 1 of 6/.test(started.say)) failures.push(`Enter on Commit did not start the commit (${started.say})`);
        if (!/sa-next/.test(started.focus)) failures.push(`focus did not move to Next step (${started.focus})`);
        for (let i = 0; i < 5; i++) await tab.press('Enter', 'Enter', 13);
        const done = await tab.evaluate<{ busy: string; say: string }>(
          `(() => { const p = document.querySelector('docs-element[data-element="storage-animator"] .sa-panel[data-view="write-path"]'); return { busy: p.dataset.busy, say: p.querySelector('.sa-say').textContent }; })()`,
        );
        if (done.busy !== 'false' || !/step 6 of 6/.test(done.say)) failures.push(`five presses of Enter on Next did not finish the commit (${done.say})`);
        return { log: [`Space ticks Step by step, Enter commits, Enter steps: ${done.say.slice(0, 60)}`], failures };
      },
    },
    {
      name: 'under reduced motion each step waits for Next',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        await tab.emulateMedia({ reducedMotion: true });
        const out = await tab.evaluate<Outcome>(
          run(`
            const log = [], failures = [];
            const h = await up();
            const p = panel(h, 'write-path');
            // The module may have mounted before the preference changed; the media query's change event comes with the next frame.
            expect(log, failures, 'Step by step is on', !!(await until(() => h.querySelector('.sa-stepbox').checked, 3000)));
            p.querySelector('.sa-commit').click();
            await wait(2500);
            const held = p.querySelector('.sa-say').textContent;
            expect(log, failures, 'the commit holds at step 1', p.dataset.busy === 'true' && /step 1 of 6/.test(held), held);
            p.querySelector('.sa-next').click();
            expect(log, failures, 'Next moves to step 2', /step 2 of 6/.test(p.querySelector('.sa-say').textContent));
            const moving = document.getAnimations().filter((a) => a.playState === 'running' && h.contains(a.effect && a.effect.target));
            expect(log, failures, 'nothing animates', moving.length === 0, moving.length + ' running');
            return { log: [held.slice(0, 80)], failures };
          `),
        );
        await tab.emulateMedia({ reducedMotion: false });
        return out;
      },
    },
  ],
} satisfies BrowserCases;

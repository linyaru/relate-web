// cookbook:browser cases for `:::terminal`, the agent-mode terminal
// (src/lib/docs/elements/terminal.ts, src/scripts/docs/elements/terminal.ts).
// They run on the first built page carrying one. The terminal shows the
// cell's recording without the engine; Run makes the engine's bytes equal
// the static form's in every mode, each command carrying --read-only; a
// failure exits 6 with its stderr lines and its errors-reference link, an
// error object in the JSON modes and none in the table, and the status line
// (the live region) names the exit code; a write is refused by the read-only
// database; an argument error carries the binary's wording; the harness
// toggle cuts 250 rows to the recorded cap with the warning on stderr; a
// result of 200,000 rows draws the pane's first lines and says how many it
// left out, the counts staying exact; and the tabs, the statement and
// Ctrl+Enter work from the keyboard, where choosing a preset does not run it.
// Modes are switched with whichever control a reader can see: the tabs, or
// the select that replaces them where the pane is narrow (at 390 px, and
// beside the MCP tryout on concepts/agent-native); a switch with neither
// shown fails, and in the 390 px rerun the first case also switches the
// select once with a real arrow key.

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

const MODES = ['table', 'envelope', 'jsonl', 'toon'];

/** In-page helpers: the terminal's parts, the static form's text per mode, and a run that waits for its status. */
const HELPERS = `
  const h = await live('terminal');
  if (!h) return { log: [], failures: ['the terminal did not go live'] };
  const L = h.querySelector('.element-live');
  const screen = L.querySelector('.term-screen');
  const status = () => L.querySelector('.term-status').textContent;
  const exitLine = () => L.querySelector('.term-exit').textContent;
  /** relate's lines (stdout, stderr), never the command line or the pane's own notes. */
  const lines = (fd) => [...screen.querySelectorAll('.term-line' + (fd === undefined ? ':not(.term-command):not(.term-note)' : '[data-fd="' + fd + '"]') + ' .term-text')].map((n) => n.textContent);
  const notes = () => [...screen.querySelectorAll('.term-note .term-text')].map((n) => n.textContent);
  const out = () => lines().join('\\n');
  const command = () => screen.querySelector('.term-command .term-text')?.textContent ?? '';
  const tab = (m) => L.querySelector('.term-tab[data-mode="' + m + '"]');
  const modeSelect = L.querySelector('select[id$="-mode"]');
  /** Whether a reader can see the control: rendered, not hidden, and with a box (an ancestor's display:none leaves none). */
  const shows = (n) => { if (!n) return false; const cs = getComputedStyle(n), r = n.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  /** The mode switches that did not show their mode, and the controls used. */
  const modeMiss = [], via = new Set();
  /** Switches through the control a reader has: the tab when it shows, else the select when it shows; with neither, the switch fails. */
  const setMode = (m) => {
    if (shows(tab(m))) { tab(m).click(); via.add('tabs'); }
    else if (shows(modeSelect)) { modeSelect.value = m; modeSelect.dispatchEvent(new Event('change', { bubbles: true })); via.add('select'); }
    else { modeMiss.push(m + ': no visible mode control (neither the tabs nor the select show)'); return; }
    if (!command().includes('--mode ' + m + ' ')) modeMiss.push(m + ': ' + command().slice(0, 50));
  };
  const input = L.querySelector('textarea');
  const runB = L.querySelector('.term-run');
  const preset = L.querySelector('select[id$="-preset"]');
  const harness = L.querySelector('.term-harness input');
  const setHarness = (on) => { if (harness.checked !== on) { harness.checked = on; harness.dispatchEvent(new Event('change', { bubbles: true })); } };
  /** Run, and wait for this run's result (data-runs counts the runs the pane drew) or its failure. */
  const run = async (ms = 90000) => {
    const n = Number(screen.dataset.runs || 0);
    runB.click();
    await until(() => Number(screen.dataset.runs || 0) > n || /^Could not run/.test(status()), ms);
  };
  const choose = (label) => { const o = [...preset.options].find((x) => x.textContent.startsWith(label)); preset.value = o.value; preset.dispatchEvent(new Event('change', { bubbles: true })); };
  const type = (statement) => { input.value = statement; input.dispatchEvent(new Event('input', { bubbles: true })); };
  /** The static form, per mode: the command and the output text blocks after each "--mode <m> prints" line. */
  const recorded = () => {
    const m = {};
    let cur = null, n = 0;
    for (const c of h.querySelector('.element-static').children) {
      const code = c.tagName === 'P' ? c.querySelector('code') : null;
      if (code && /^--mode /.test(code.textContent)) { cur = code.textContent.slice(7); n = 0; m[cur] = { command: '', output: '' }; continue; }
      if (cur && c.classList.contains('code-block')) { const t = c.querySelector('pre').textContent; if (n === 0) m[cur].command = t; else if (n === 1) m[cur].output = t; n++; }
      else if (c.tagName === 'P') cur = null;
    }
    return m;
  };
  /** Timing values written \`<ms>\`, as the static form writes them and the CLI check masks them (ADR-0054): a live run times differently. */
  const maskMs = (t) => t.replace(/(_ms\\\\?"\\s*:\\s*)-?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?/g, '$1<ms>');
  const modesShown = () => expect(log, failures, 'each mode switch (' + [...via].join(', ') + ') shows its --mode', modeMiss.length === 0, modeMiss.join('; '));
`;

/** Brings it fully live: the recording in every mode, then Run, and the live bytes against the static form (repeated at 390 px and under reduced motion). */
const FIRST = scenario(`
  const log = [], failures = [];
  ${HELPERS}
  const modes = ${JSON.stringify(MODES)};
  const rec = recorded();
  expect(log, failures, 'the static form has all four modes', modes.every((m) => rec[m] && rec[m].command), Object.keys(rec).join(','));
  expect(log, failures, 'the static form hides', h.querySelector('.element-static').hidden);
  expect(log, failures, 'it shows the recording without the engine', /^Recorded on relate/.test(status()) && !engineLoaded(), status().slice(0, 60));
  expect(log, failures, 'before a run the exit line counts recorded rows, not rows from the engine', !/from the engine/.test(exitLine()) && (/ recorded, [\\d,]+ printed/.test(exitLine()) || !/ printed/.test(exitLine())), exitLine());
  expect(log, failures, 'the status line names the outcome', /Exit \\d+, \\w+/.test(status()), status());
  const shownBefore = modes.filter((m) => { setMode(m); return out() === rec[m].output && command() === rec[m].command; });
  expect(log, failures, 'before a run, every mode shows the static form', shownBefore.length === 4, 'matching: ' + shownBefore.join(','));
  await run();
  expect(log, failures, 'Run runs on the engine', engineLoaded() && /^From this tab's run on relate/.test(status()), status().slice(0, 100));
  expect(log, failures, 'after a run the rows come from the engine', !/ printed/.test(exitLine()) || /from the engine, [\\d,]+ printed/.test(exitLine()), exitLine());
  const bad = [];
  for (const m of modes) {
    setMode(m);
    if (maskMs(out()) !== maskMs(rec[m].output)) bad.push(m + ' output');
    if (command() !== rec[m].command) bad.push(m + ' command');
    if (!/ --read-only /.test(' ' + command() + ' ')) bad.push(m + ' has no --read-only');
  }
  expect(log, failures, 'the live bytes equal the recorded ones in every mode, timing values aside, each command read-only', bad.length === 0, bad.join('; '));
  modesShown();
  const attrs = JSON.parse(h.dataset.attrs);
  expect(log, failures, 'the harness variable shows when harness=on', (attrs.harness === 'on') === /^CLAUDECODE=1 /.test(command()), command().slice(0, 40));
  expect(log, failures, 'the exit code is labelled with the binary version', /^exit \\d+ .*as relate \\d+\\.\\d+\\.\\d+ returns it/.test(exitLine()), exitLine().slice(0, 80));
  expect(log, failures, 'the output panel has one name', screen.getAttribute('aria-label') === 'Output of --mode toon' && !screen.hasAttribute('aria-labelledby'), screen.getAttribute('aria-label'));
  return { log: [lines().length + ' lines in ' + (attrs.mode || 'envelope') + ' via ' + [...via].join('+') + '; ' + exitLine().split(' · ')[0]], failures };
`);

export default {
  element: 'terminal',
  cases: [
    {
      name: 'the recording, then the engine, byte for byte in all four modes',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const first = await tab.evaluate<Outcome>(FIRST);
        // At phone width (the 390 px rerun), where the select stands in for the tabs, one switch made with a real key
        // on the focused select: the control has to work for a reader, not only take a value from a script. Only
        // there: on a desktop-width macOS Chrome an arrow key on a closed select opens its menu instead of moving.
        const phone = await tab.evaluate<boolean>('innerWidth <= 600');
        if (!phone) return first;
        const sel = await tab.evaluate<{ shown: boolean; focused: boolean; from: string; to: string; key: string }>(
          `(() => {
            const L = document.querySelector('docs-element[data-element="terminal"] .element-live');
            const s = L.querySelector('select[id$="-mode"]');
            const r = s.getBoundingClientRect();
            const shown = getComputedStyle(s).display !== 'none' && r.width > 0 && r.height > 0;
            const modes = [...s.options].map((o) => o.value);
            const i = modes.indexOf(s.value);
            const down = i < modes.length - 1;
            if (shown) s.focus();
            return { shown, focused: document.activeElement === s, from: s.value, to: modes[down ? i + 1 : i - 1], key: down ? 'ArrowDown' : 'ArrowUp' };
          })()`,
        );
        if (!sel.shown) return { log: first.log, failures: [...first.failures, 'at phone width the mode select does not show'] };
        const failures = [...first.failures];
        if (!sel.focused) failures.push('the mode select did not take focus');
        await tab.press(sel.key, sel.key, sel.key === 'ArrowDown' ? 40 : 38);
        const shown = await tab.evaluate<{ value: string; command: string }>(
          `(() => { const L = document.querySelector('docs-element[data-element="terminal"] .element-live'); return { value: L.querySelector('select[id$="-mode"]').value, command: L.querySelector('.term-command .term-text').textContent }; })()`,
        );
        const ok = shown.value === sel.to && shown.command.includes(` --mode ${sel.to} `);
        if (!ok) failures.push(`${sel.key} on the focused mode select: ${sel.from} -> ${shown.value}, command ${shown.command.slice(0, 50)}`);
        return { log: [`${first.log[0]}; ${sel.key} on the focused select: ${sel.from} -> ${shown.value}`, ...first.log.slice(1)], failures };
      },
    },
    {
      name: 'a failure exits 6 with its stderr, link and a status that names it; a write is refused; an argument error carries the binary\'s wording',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        setHarness(false);
        choose('A missing parameter');
        await run();
        setMode('envelope');
        expect(log, failures, 'a missing parameter exits 6', /^exit 6 /.test(exitLine()), exitLine().slice(0, 60));
        expect(log, failures, 'the live region names the exit code and the class', /Exit 6, validation_error \\(kind semantic\\): 1 line on stderr, 1 on stdout\\./.test(status()), status());
        expect(log, failures, 'its message goes to stderr', lines(2).length >= 1, lines(2)[0]);
        const link = L.querySelector('.term-exit a');
        expect(log, failures, 'the exit line links the error', !!link && /^\\/docs\\/reference\\/errors\\/#engine-parameter-missing$/.test(link.getAttribute('href')), link && link.getAttribute('href'));
        expect(log, failures, 'envelope prints an error object on stdout', lines(1).some((t) => /"error":\\{/.test(t)), lines(1)[0]);
        setMode('jsonl');
        expect(log, failures, 'so does jsonl', lines(1).some((t) => /"error":\\{/.test(t)));
        setMode('table');
        expect(log, failures, 'table prints none', lines(1).every((t) => !/"error"/.test(t)) && lines(2).length >= 1);
        expect(log, failures, 'the live region follows the mode', /: 1 line on stderr, 0 on stdout\\./.test(status()), status());
        choose('A write, refused read-only');
        await run();
        expect(log, failures, 'a write is refused by the read-only database', /WriteOnReadOnlyAccessDatabase/.test(out()) && /^exit 6 /.test(exitLine()), lines(2)[0]);
        choose('Several statements, one fails');
        await run();
        setMode('table');
        expect(log, failures, 'three statements stop at the second, and say so', lines(2).includes('statement 2 of 3 failed; 1 completed and committed; 1 not run') && lines(1).includes('| 1 |'), lines(2).join(' / '));
        type('RETURN point({latitude: 100, longitude: 0}) AS p');
        await run();
        // Since relate 0.1.2 the engine in the page words this refusal as the binary does, so nothing is labelled.
        expect(log, failures, 'an out-of-range latitude exits 6 with kind argument and the binary\\'s wording, unlabelled', /^exit 6 · validation_error \\(kind argument/.test(exitLine()) && !/words this error differently/.test(exitLine()) && lines(2).some((t) => /^semantic error: InvalidArgumentValue: point\\(\\) latitude/.test(t)), exitLine());
        modesShown();
        return { log: [lines(2).at(-1)], failures };
      `),
    },
    {
      name: 'the harness toggle cuts 250 rows to the recorded cap, with the warning on stderr',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        setHarness(false);
        choose('250 rows');
        await run();
        setMode('jsonl');
        expect(log, failures, 'without the harness, all 250 rows print, then the timing line', screen.dataset.printed === '250' && lines(1).length === 251 && /^\\{"planCache":/.test(lines(1).at(-1)), screen.dataset.printed + ' printed, ' + lines(1).length + ' lines');
        setHarness(true);
        const kept = lines(1).filter((t) => /^\\{"x":/.test(t)).length;
        expect(log, failures, 'with it, 100 print, then the rowCap line, then the timing line', screen.dataset.printed === '100' && kept === 100 && lines(1).at(-2) === '{"rowCap":{"kept":100,"total":250}}' && /^\\{"planCache":/.test(lines(1).at(-1)), kept + ' rows; last two ' + lines(1).slice(-2).join(' | '));
        expect(log, failures, 'the warning is on stderr', lines(2).some((t) => /^warning: result truncated to 100 rows \\(the statement returned 250\\)/.test(t)), lines(2)[0]);
        expect(log, failures, 'the command carries the harness variable', /^CLAUDECODE=1 relate --read-only --mode jsonl /.test(command()), command().slice(0, 60));
        expect(log, failures, 'the exit code stays 0', /^exit 0 /.test(exitLine()), exitLine().slice(0, 40));
        modesShown();
        return { log: ['printed ' + screen.dataset.printed + ' of 250; ' + lines(2)[0]], failures };
      `),
    },
    {
      name: '200,000 rows: the pane draws its first lines, says how many it left out, and keeps the counts exact',
      scenario: scenario(`
        const log = [], failures = [];
        ${HELPERS}
        setHarness(false);
        setMode('jsonl');
        type('UNWIND range(1, 200000) AS x RETURN x');
        const t0 = performance.now();
        await run(120000);
        const ms = Math.round(performance.now() - t0);
        expect(log, failures, 'the run draws', /^From this tab's run/.test(status()) && screen.dataset.runs !== undefined, status().slice(0, 120));
        expect(log, failures, 'jsonl: 500 lines drawn of 200,001 (the rows and the timing line), the count exact', screen.dataset.lines === '200001' && screen.dataset.drawn === '500' && lines(1).length === 500 && lines(1)[499] === '{"x":500}', screen.dataset.lines + ' / ' + screen.dataset.drawn);
        expect(log, failures, 'the pane says what it left out, as its own line', notes().length === 1 && notes()[0] === 'the pane stops here; relate prints 199,501 more lines' && screen.querySelector('.term-note .term-fd').textContent === 'pane', notes().join(' | '));
        expect(log, failures, 'the exit line keeps the true counts', /200,000 rows from the engine, 200,000 printed/.test(exitLine()), exitLine());
        expect(log, failures, 'the status names the outcome in full', /Exit 0, success: 0 lines on stderr, 200,001 on stdout\\./.test(status()), status());
        const t1 = performance.now();
        setMode('table');
        const tableMs = Math.round(performance.now() - t1);
        expect(log, failures, 'table: the grid is cut too, with its true line count', screen.dataset.lines === '200004' && lines(1).length === 500 && notes()[0] === 'the pane stops here; relate prints 199,504 more lines', screen.dataset.lines + ' ' + notes().join(' | '));
        expect(log, failures, 'table: the column is as wide as relate makes it for 200000', lines(1)[0] === '+--------+', lines(1)[0]);
        setMode('envelope');
        expect(log, failures, 'envelope: its one line is cut at 20,000 characters, and the pane says so', lines(1).length === 1 && lines(1)[0].length === 20000 && /^the pane cuts the line above here; relate prints [\\d,]+ more characters of it$/.test(notes()[0] || ''), (notes()[0] || '') + ' ' + lines(1)[0].length);
        setMode('toon');
        expect(log, failures, 'toon: the header names all 200,000 rows', lines(1)[0] === 'rows[200000]{x}:' && notes().length === 1, lines(1)[0]);
        setHarness(true);
        expect(log, failures, 'with the harness, 100 rows print and nothing is cut by the pane', screen.dataset.printed === '100' && notes().length === 0, screen.dataset.printed + ' ' + notes().join(' | '));
        setHarness(false);
        modesShown();
        return { log: ['200,000 rows: run and draw ' + ms + ' ms, table switch ' + tableMs + ' ms'], failures };
      `),
    },
    {
      name: 'the keyboard: arrow keys move between the tabs, Ctrl+Enter runs, a preset only fills the statement',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const log: string[] = [];
        const failures: string[] = [];
        // Where the terminal has the full column, so the mode tabs show (beside the MCP tryout it is half as wide and offers a select).
        const narrow = await tab.evaluate<boolean>(`(() => { const t = document.querySelector('docs-element[data-element="terminal"] .term-tabs'); return !t || getComputedStyle(t).display === 'none'; })()`);
        if (narrow) await tab.navigate('/docs/get-started/agent-quickstart/');
        const ready = await tab.evaluate<Outcome>(
          scenario(`${HELPERS} const sel = L.querySelector('.term-tab[aria-selected="true"]'); sel.focus(); return { log: [], failures: document.activeElement === sel ? [] : ['the selected tab did not take focus'] };`),
        );
        if (ready.failures.length) return ready;
        // The ring and what it sits on: drawn outside the tab (never on the selected tab's accent fill), at least 3:1
        // against the neighbouring tab and the element's ground (WCAG 1.4.11), in whichever theme the page is in.
        const where = () =>
          tab.evaluate<{ mode: string; focused: boolean; ring: string; contrast: number }>(
            `(() => {
              const s = document.querySelector('docs-element[data-element="terminal"] .term-tab[aria-selected="true"]');
              const cs = getComputedStyle(s);
              const rgb = (c) => (c.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
              const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
              const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
              const ground = getComputedStyle(s.closest('docs-element')).backgroundColor;
              const neighbour = getComputedStyle(s.parentElement.querySelector('.term-tab:not([aria-selected="true"])')).backgroundColor;
              const outside = parseFloat(cs.outlineOffset) >= 0;
              return { mode: s.dataset.mode, focused: document.activeElement === s, ring: cs.outlineStyle + ' ' + cs.outlineWidth + ' offset ' + cs.outlineOffset, contrast: outside ? Math.min(ratio(cs.outlineColor, ground), ratio(cs.outlineColor, neighbour)) : 0 };
            })()`,
          );
        const start = await where();
        await tab.press('ArrowRight', 'ArrowRight', 39);
        const right = await where();
        const order = MODES;
        const next = order[(order.indexOf(start.mode) + 1) % order.length];
        if (right.mode !== next || !right.focused) failures.push(`ArrowRight: ${start.mode} -> ${right.mode} (focused ${right.focused})`);
        if (!/^solid [1-9]/.test(right.ring)) failures.push(`the focused tab shows no ring: ${right.ring}`);
        if (right.contrast < 3) failures.push(`the focus ring is ${right.contrast.toFixed(2)}:1 against what it sits on (or drawn inside the tab): ${right.ring}`);
        // The same ring in the other theme (the site's data-theme switch), then back.
        const theme = await tab.evaluate<string>(`(() => { const r = document.documentElement; const was = r.dataset.theme || ''; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; return was; })()`);
        const other = await where();
        await tab.evaluate(`(() => { const r = document.documentElement; if (${JSON.stringify(theme)}) r.dataset.theme = ${JSON.stringify(theme)}; else delete r.dataset.theme; })()`);
        if (other.contrast < 3) failures.push(`in the other theme the focus ring is ${other.contrast.toFixed(2)}:1: ${other.ring}`);
        if (!other.focused) failures.push('switching the theme moved focus off the tab');
        await tab.press('End', 'End', 35);
        const end = await where();
        if (end.mode !== 'toon' || !end.focused) failures.push(`End: ${end.mode}`);
        await tab.press('Home', 'Home', 36);
        const home = await where();
        if (home.mode !== 'table' || !home.focused) failures.push(`Home: ${home.mode}`);
        log.push(`${start.mode} -> ${right.mode} -> ${end.mode} -> ${home.mode}, ring ${right.ring}, ${right.contrast.toFixed(1)}:1 (other theme ${other.contrast.toFixed(1)}:1)`);
        await tab.evaluate(scenario(`${HELPERS} type('RETURN 41 + 1 AS answer'); input.focus(); return { log: [], failures: [] };`));
        await tab.press('Enter', 'Enter', 13, 2);
        const after = await tab.evaluate<Outcome>(
          scenario(`
            const log = [], failures = [];
            ${HELPERS}
            await until(() => /^From this tab's run/.test(status()), 60000);
            expect(log, failures, 'Ctrl+Enter runs the edited statement', /^From this tab's run/.test(status()) && lines(1).some((t) => /\\b42\\b/.test(t)), out().slice(0, 60));
            expect(log, failures, 'the preset list says the statement is the reader\\'s', preset.value === 'edited', preset.value);
            const shown = command();
            choose('A syntax error');
            await wait(400);
            expect(log, failures, 'choosing a preset fills the statement', input.value === 'MATCH (n RETURN n', input.value);
            expect(log, failures, 'and does not run it', command() === shown && Number(screen.dataset.runs) === 1, status());
            // Where the tabs show, a click on each switches the view of the same run.
            for (const m of ${JSON.stringify(MODES)}) setMode(m);
            expect(log, failures, 'a click on each tab switches the mode', via.has('tabs') && !via.has('select') && L.querySelector('.term-tab[aria-selected="true"]').dataset.mode === 'toon', [...via].join(','));
            modesShown();
            return { log: [out().split('\\n').slice(0, 4).join(' / ')], failures };
          `),
        );
        return { log: [...log, ...after.log], failures: [...failures, ...after.failures] };
      },
    },
  ],
} satisfies BrowserCases;

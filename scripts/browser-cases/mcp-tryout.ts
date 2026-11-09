// cookbook:browser cases for `:::mcp-tryout` (src/lib/docs/elements/mcp-tryout.ts,
// src/scripts/docs/elements/mcp-tryout.ts). The oracle is the page's own static
// form: every call, pressed in order, answers with exactly the reply the
// static form recorded (timings masked), which proves the live replies come
// from the engine through the same mapping. Then real input: a real click on
// "Serve read-only" changes the tool list and turns write_cypher into the
// server's recorded tool error beside the engine's own refusal; Enter on a
// focused button sends an edited call (a float parameter that must stay a
// float, a write the gate refuses, a second statement the page does not send,
// parameters that are not an object).

import { scenario, type BrowserCases, type BrowserTab, type Outcome } from './_kit.ts';

const HOST = 'docs-element[data-element="mcp-tryout"]';

/** Page-side helpers: the timings mask, a code block's text, a reply's tool text. */
const HELPERS = `
  const bs = String.fromCharCode(92);
  const mask = (t) => t.replace(new RegExp('(_ms' + bs + bs + '?":)-?[0-9][0-9.e+-]*', 'g'), '$1<ms>');
  const blockText = (b) => ((b.querySelector('textarea') && b.querySelector('textarea').value) || (b.querySelector('code') && b.querySelector('code').textContent) || '').trim();
  const toolText = (reply) => { try { return JSON.parse(reply).result.content[0].text; } catch { return null; } };
  // Whether the engine started: the bar records the version the worker reports, and the page fetches the worker's script.
  // (engineLoaded() looks for the wasm files, which the worker fetches on its own timeline, so the page never sees them.)
  const engineUp = () => !!(document.getElementById('engineBar') || { dataset: {} }).dataset.engineVersion || performance.getEntriesByType('resource').some((e) => e.name.includes('/_astro/worker-'));
`;

/** Bring the element live and return { ok }, in the page. */
const LIVE = scenario(`const h = await live('mcp-tryout'); return { log: [], failures: h ? [] : ['the element did not go live'] };`);

/** The viewport centre of the first element matching `selector` inside the host, after scrolling it into view. */
async function centre(tab: BrowserTab, selector: string): Promise<{ x: number; y: number } | null> {
  return tab.evaluate(`(async () => {
    const el = document.querySelector(${JSON.stringify(`${HOST} ${selector}`)});
    if (!el) return null;
    // Instantly: the site scrolls smoothly, and a point measured mid-scroll misses.
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
}

/** Wait until the section's reply is a live one; resolve what it shows. */
const settled = (section: string) =>
  scenario(`${HELPERS}
    const s = document.querySelector(${JSON.stringify(`${HOST} ${section}`)});
    const out = s.querySelector('.mcp-out');
    await until(() => out.dataset.reply === 'live' || /Could not/.test(s.querySelector('.mcp-said').textContent), 60000);
    const reply = (out.querySelector('pre[data-kind=reply] code') || {}).textContent || '';
    const request = (out.querySelector('pre[data-kind=request] code') || {}).textContent || '';
    const engine = (out.querySelector('.mcp-engine-ro') || {}).textContent || '';
    return { log: [], failures: [], reply, request, text: toolText(reply), source: out.dataset.source || '', said: s.querySelector('.mcp-said').textContent, engine };
  `);

interface Sent extends Outcome {
  reply: string;
  request: string;
  text: string | null;
  source: string;
  said: string;
  engine: string;
}

export default {
  element: 'mcp-tryout',
  cases: [
    {
      name: 'every call answers with its recorded reply, and the engine loads on the first press',
      scenario: scenario(`${HELPERS}
        const log = [], failures = [];
        const h = await live('mcp-tryout');
        expect(log, failures, 'the element goes live', !!h);
        if (!h) return { log, failures };
        // The recorded replies, by id: the JSON blocks before the recorded read-only run (a shell command, not JSON).
        const recorded = new Map();
        for (const b of h.querySelectorAll('.element-static .code-block')) {
          let msg;
          try { msg = JSON.parse(blockText(b)); } catch { break; }
          if (msg.result !== undefined) recorded.set(msg.id, blockText(b));
        }
        const sections = [...h.querySelectorAll('.element-live .mcp-call')];
        expect(log, failures, 'one block per recorded call', sections.length > 0 && sections.length === recorded.size, sections.length + ' blocks, ' + recorded.size + ' recorded replies');
        expect(log, failures, 'each block shows its recorded reply before a press', sections.every((s) => s.querySelector('.mcp-out').dataset.reply === 'recorded' && s.querySelector('pre[data-kind=reply]')));
        expect(log, failures, 'the engine is not loaded before a press', !engineLoaded() && !engineUp());
        // The recording is a writable server's answers; a page may start the tryout read-only (readonly=on).
        const ro = h.querySelector('.element-live .mcp-ro');
        if (ro.getAttribute('aria-pressed') === 'true') ro.click();
        expect(log, failures, 'Serve read-only is off for the recorded calls', ro.getAttribute('aria-pressed') === 'false');
        let id = 0;
        const bad = [];
        for (const s of sections) {
          id++;
          const out = s.querySelector('.mcp-out');
          s.querySelector('.mcp-send').click();
          await until(() => out.dataset.reply === 'live' || /Could not/.test(s.querySelector('.mcp-said').textContent), 60000);
          const reply = (out.querySelector('pre[data-kind=reply] code') || {}).textContent || '';
          if (mask(reply) !== recorded.get(id)) bad.push(s.dataset.tool + ' #' + id + ': ' + mask(reply).slice(0, 160));
          if (!out.querySelector('table, .mcp-error, p')) bad.push(s.dataset.tool + ' #' + id + ': nothing decoded');
        }
        expect(log, failures, 'the engine started on the first press', engineUp());
        expect(log, failures, 'every live reply equals its recording, timings masked', bad.length === 0, bad.join(' | '));
        const timed = sections.filter((s) => /ms in the engine/.test(s.querySelector('.mcp-said').textContent)).length;
        const worded = sections.filter((s) => /^From this tab's run on relate \\d+\\.\\d+\\.\\d+/.test(s.querySelector('.mcp-said').textContent)).length;
        expect(log, failures, 'each live status line opens with the shared wording, version named', worded > 0 && worded === sections.filter((s) => s.querySelector('.mcp-out').dataset.source === 'engine').length, worded + ' worded');
        return { log: [(sections.length - bad.length) + ' of ' + sections.length + ' calls answered as recorded; ' + timed + ' with this run\\'s timings'], failures };
      `),
    },
    {
      name: 'a real click on Serve read-only drops write_cypher and answers it with the recorded tool error',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const log: string[] = [];
        const failures: string[] = [];
        const check = (name: string, ok: boolean, detail = '') => {
          log.push(`${ok ? 'ok   ' : 'FAIL '}${name}${detail ? ` (${detail})` : ''}`);
          if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
        };
        const up = await tab.evaluate<Outcome>(LIVE);
        if (up.failures.length) return up;
        const state = () => tab.evaluate<{ pressed: string; listed: string }>(`(() => { const h = document.querySelector(${JSON.stringify(HOST)}); return { pressed: h.querySelector('.mcp-ro').getAttribute('aria-pressed'), listed: h.querySelector('.mcp-listed').textContent }; })()`);
        const clickAt = async (selector: string) => {
          // A send's reply is awaited by its marker: clear it first, so the previous live reply does not count.
          await tab.evaluate(`(() => { const s = document.querySelector(${JSON.stringify(`${HOST} .mcp-call[data-tool=write_cypher]`)}); if (s) s.querySelector('.mcp-out').dataset.reply = 'pending'; })()`);
          const at = await centre(tab, selector);
          if (!at) return false;
          await tab.click(at.x, at.y);
          return true;
        };
        // Serve read-only on (the page may start with it on: readonly=on).
        if ((await state()).pressed !== 'true') await clickAt('.mcp-ro');
        let s = await state();
        check('a real click turns Serve read-only on', s.pressed === 'true', s.pressed);
        check('tools/list names read_cypher and get_schema only', /read_cypher/.test(s.listed) && /get_schema/.test(s.listed) && !/write_cypher/.test(s.listed), s.listed);
        await clickAt('.mcp-call[data-tool=write_cypher] .mcp-send');
        const ro = await tab.evaluate<Sent>(settled('.mcp-call[data-tool=write_cypher]'));
        check('write_cypher answers with the recorded tool error', ro.text === "unknown tool 'write_cypher'" && ro.source === 'recorded', `${ro.source}: ${ro.text}`);
        check('the status says the text is the recorded one, with the version', /^Recorded on relate \d+\.\d+\.\d+ when the page was built\./.test(ro.said), ro.said.slice(0, 120));
        check(
          'beside it, the engine refuses the write on a read-only database (42N18), or says it changed nothing',
          /WriteOnReadOnlyAccessDatabase/.test(ro.engine) ? /42N18/.test(ro.engine) : /wrote nothing/.test(ro.engine),
          ro.engine.slice(0, 160),
        );
        // Off again: write_cypher is listed and writes.
        await clickAt('.mcp-ro');
        s = await state();
        check('a second real click turns it off', s.pressed === 'false' && /write_cypher/.test(s.listed), `${s.pressed}: ${s.listed}`);
        await clickAt('.mcp-call[data-tool=write_cypher] .mcp-send');
        const rw = await tab.evaluate<Sent>(settled('.mcp-call[data-tool=write_cypher]'));
        check('write_cypher writes, with counters from the engine', rw.source === 'engine' && /"isError":false/.test(rw.reply) && /"stats":/.test(rw.text ?? ''), `${rw.source}: ${rw.reply.slice(0, 120)}`);
        return { log: [`read-only: ${ro.text}; writable: ${rw.source}`, ...log], failures };
      },
    },
    {
      name: 'Enter on a focused button sends an edited call: a float stays a float, a write is refused, a second statement is not sent',
      scenario: async (tab: BrowserTab): Promise<Outcome> => {
        const log: string[] = [];
        const failures: string[] = [];
        const check = (name: string, ok: boolean, detail = '') => {
          log.push(`${ok ? 'ok   ' : 'FAIL '}${name}${detail ? ` (${detail})` : ''}`);
          if (!ok) failures.push(detail ? `${name}: ${detail}` : name);
        };
        const up = await tab.evaluate<Outcome>(LIVE);
        if (up.failures.length) return up;
        const READ = '.mcp-call[data-tool=read_cypher]';
        const send = async (statement: string, params: string): Promise<Sent & { focused: boolean }> => {
          const focused = await tab.evaluate<boolean>(`(() => {
            const s = document.querySelector(${JSON.stringify(`${HOST} ${READ}`)});
            const [st, pa] = s.querySelectorAll('textarea');
            st.value = ${JSON.stringify(statement)};
            pa.value = ${JSON.stringify(params)};
            s.querySelector('.mcp-out').dataset.reply = 'pending';
            const b = s.querySelector('.mcp-send');
            b.scrollIntoView({ block: 'center', behavior: 'instant' });
            b.focus();
            return document.activeElement === b;
          })()`);
          await tab.press('Enter', 'Enter', 13);
          return { ...(await tab.evaluate<Sent>(settled(READ))), focused };
        };
        const float = await send('RETURN $x AS x, valueType($x) AS t', '{"x": 1.0}');
        check('the send button takes focus', float.focused);
        let row: { x?: unknown; t?: unknown } = {};
        try {
          row = (JSON.parse(float.text ?? '{}') as { rows?: { x?: unknown; t?: unknown }[] }).rows?.[0] ?? {};
        } catch {
          /* checked below */
        }
        check('the request carries the parameters as typed', float.request.includes('"parameters":{"x":1.0}'), float.request.slice(0, 160));
        check('the engine gets a float: valueType is FLOAT and the reply keeps 1.0', String(row.t ?? '').startsWith('FLOAT') && (float.text ?? '').includes('"x":1.0'), `${String(row.t)}; ${(float.text ?? '').slice(0, 80)}`);
        const write = await send('CREATE (:Probe)', '');
        check('a write sent to read_cypher is refused by the gate with the server\'s text', write.source === 'classified' && write.text === 'Only MATCH queries are allowed for read-query', `${write.source}: ${write.text}`);
        const two = await send('RETURN 1 AS a; RETURN 2 AS b', '');
        check('a second statement is not sent', two.source === 'not-sent' && two.reply === '' && /^Not sent/.test(two.said), `${two.source}: ${two.said.slice(0, 80)}`);
        const list = await send('RETURN 1 AS a', '[1]');
        check('parameters that are not an object get the server\'s invalid-params text, and nothing runs', list.source === 'refused' && list.text === 'invalid params: "parameters" must be an object', `${list.source}: ${list.text}`);
        return { log: [`float ${String(row.t)}; write ${write.source}; two statements ${two.source}; list ${list.source}`, ...log], failures };
      },
    },
  ],
} satisfies BrowserCases;

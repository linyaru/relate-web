// `:::agent-trace` in the browser (the build side, and how the trace is kept
// to calls the page already makes, are in src/lib/docs/elements/agent-trace.ts).
// The steps come from the static form's requests, each shown with its
// recorded result until it is sent; Step sends the next one and Play all the
// rest, each through the shared protocol on the page's database
// (src/lib/docs/elements/_mcp-tryout-protocol.ts), the first one after the
// cells up to `from` have run. The trace writes, so it must start on that
// database and nothing more: when a later cell, or the trace itself, has
// written since, the first step empties the database first. When the last
// step has answered, the database is emptied again, so the page's own cells
// (which would write the same ids) run cleanly; the trace's results stay on
// screen. A step that repeats a cell's statement and data says whether its
// rows match the cell's recording.

import type { ElementContext, PageApi } from '../element-api.ts';
import { callTool, normalise, sortedJson, type Call, type Outcome, type RunScript } from '../../../lib/docs/elements/_mcp-tryout-protocol.ts';
import { liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import { cloned, decoded, h, jsonBlock, split, staticCalls } from './_mcp-tryout-view.ts';
import own from './agent-trace.css?inline';
import shared from './mcp-tryout.css?inline';

interface Step {
  call: Call;
  note: string;
  li: HTMLElement;
  result: HTMLElement;
  state: HTMLElement;
  request: HTMLElement;
  recorded: () => HTMLElement[];
}

/**
 * Empty the page's database: PageApi.reset when the page has it (requested
 * of the framework), else the engine bar's own Reset. Resolves once the
 * database is gone.
 */
async function emptyDatabase(page: PageApi): Promise<void> {
  const api = page as PageApi & { reset?: () => Promise<void> };
  if (typeof api.reset === 'function') return api.reset();
  const button = page.status.bar.querySelector<HTMLButtonElement>('[data-action=reset]');
  if (!button) throw new Error('the page has no Reset');
  while (page.busy()) await new Promise((r) => setTimeout(r, 50));
  await new Promise<void>((resolve, reject) => {
    const off = page.onReset(() => {
      off();
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error('the database did not reset'));
    }, 15000);
    button.click();
  });
}

/** A cell's parameters as a value, or undefined when the text the reader edited is not JSON. */
function cellParams(text: string | null): unknown {
  if (text === null || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function mount(ctx: ElementContext) {
  const { page, live, attrs } = ctx;
  ctx.adoptStyles(shared + own);
  const from = attrs.from;
  const fromCell = page.cell(from);
  if (!fromCell) throw new Error(`agent-trace: the page has no cell \`${from}\``);
  const found = staticCalls(ctx.staticForm);
  if (!found.length) throw new Error('agent-trace: no steps in the static form');

  const root = h('div', { class: 'agent-trace' });
  const stepBtn = h('button', { type: 'button', class: 'btn trace-step-btn', 'aria-label': 'Step: send the next call' }, 'Step');
  const playBtn = h('button', { type: 'button', class: 'btn trace-play-btn', 'aria-label': 'Play all: send every remaining call' }, 'Play all');
  const restartBtn = h('button', { type: 'button', class: 'btn trace-restart-btn', 'aria-label': 'Restart: back to step 1' }, 'Restart');
  const status = h('p', { class: 'trace-status', role: 'status' });
  const warn = h('p', { class: 'trace-warn', hidden: '' });
  root.append(h('div', { class: 'trace-bar' }, stepBtn, playBtn, restartBtn), status);
  const list = h('ol', { class: 'trace-steps' });
  root.append(list, warn);

  const steps: Step[] = found.map((f, i) => {
    const call = f.call;
    // The intro paragraph is "Step 1 of 4: `tool`. <note>"; keep the note.
    const note = (f.intro?.textContent ?? '').replace(/^Step \d+ of \d+: \S+?\.\s*/, '').trim();
    const state = h('span', { class: 'trace-state', text: 'not sent' });
    const result = h('div', { class: 'trace-result' });
    const code = h('code', { text: f.request });
    // Each disclosure and block names its step, so a list of them read out of context still says which is which.
    const name = `step ${i + 1}: ${call.tool}`;
    const req = h('details', { class: 'mcp-text' }, h('summary', { text: `Request, ${name}` }), h('pre', { class: 'mcp-json', tabindex: '0', 'aria-label': `Request, ${name}` }, code));
    const li = h(
      'li',
      { class: 'trace-item', 'data-state': 'pending' },
      h('p', { class: 'trace-head' }, h('span', { class: 'trace-n', text: `${i + 1}` }), ' ', h('code', { text: call.tool }), ' ', state),
      h('p', { class: 'trace-note', text: note }),
      req,
      result,
    );
    list.append(li);
    const recorded = () => [h('p', { class: 'trace-recorded-label', text: recordedLine(versions(page).recorded).replace(/\.$/, ':') }), ...(cloned(f.after) as HTMLElement[])];
    return { call, note, li, result, state, request: code, recorded };
  });

  let next = 0;
  let wrote = false;
  let running = false;
  let resetting = false;
  let stopAll = false;

  const say = (text: string) => (status.textContent = text);
  const buttons = () => {
    stepBtn.disabled = running || next >= steps.length;
    playBtn.disabled = running || next >= steps.length;
    restartBtn.disabled = running || next === 0;
  };
  /** Every step back on its recording. */
  const clear = () => {
    next = 0;
    found.forEach((f, i) => {
      const s = steps[i];
      s.li.dataset.state = 'pending';
      s.state.textContent = 'not sent';
      s.request.textContent = f.request;
      s.result.replaceChildren(...s.recorded());
    });
    say(`${recordedLine(versions(page).recorded)} ${steps.length} steps, none sent yet; each shows its recorded result.`);
    buttons();
  };

  /** Empty the database without clearing the trace's own results (its onReset listener skips its own resets). */
  const quietlyEmpty = async () => {
    resetting = true;
    try {
      await emptyDatabase(page);
    } finally {
      resetting = false;
    }
    wrote = false;
  };

  /** Whether the database holds more than the cells up to `from` wrote: a later cell ran, or the trace wrote. */
  const dirty = () => wrote || page.cells().some((c) => c.index > fromCell.index && (c.state() === 'live' || c.state() === 'error' || c.state() === 'running'));

  /** The cell a step repeats (statement and data), if any. */
  const repeated = (call: Call) =>
    page.cells().find((c) => {
      if (normalise(c.code()) !== normalise(String(call.arguments.statement ?? ''))) return false;
      const params = cellParams(c.params());
      return params !== undefined && sortedJson(params) === sortedJson(call.arguments.parameters ?? {});
    }) ?? null;

  const show = async (s: Step, out: Outcome, n: number) => {
    s.request.textContent = out.request;
    const parts: HTMLElement[] = [decoded(s.call, out)];
    const name = `step ${n}: ${s.call.tool}`;
    if (out.reply) parts.push(h('details', { class: 'mcp-text' }, h('summary', { text: `Reply, ${name}` }), jsonBlock(`Reply (what the server answers), ${name}`, out.reply, 'reply')));
    const cell = out.envelope && !out.isError ? repeated(s.call) : null;
    if (cell) {
      const recorded = ((await cell.recorded()).envelope as { rows?: unknown[] } | null)?.rows ?? null;
      const ok = sortedJson(recorded) === sortedJson((out.envelope as { rows: unknown[] }).rows);
      parts.push(h('p', { class: 'trace-match', 'data-match': String(ok), text: ok ? `The rows match cell ${cell.id}'s recording.` : `The rows differ from cell ${cell.id}'s recording.` }));
    }
    s.result.replaceChildren(...parts);
    s.li.dataset.state = out.isError ? 'error' : 'done';
    s.state.textContent = out.isError ? 'tool error' : 'sent';
    const env = out.envelope as { elapsed_ms?: number } | null;
    const t = env ? ` (${split(out.envelope)})` : '';
    say(`${liveLine({ version: versions(page).live, ms: env?.elapsed_ms })} Step ${n} of ${steps.length}: ${s.call.tool} answered${out.isError ? ' with a tool error' : ''}${t}.`);
  };

  const step = async (): Promise<boolean> => {
    if (running || next >= steps.length) return false;
    running = true;
    buttons();
    const s = steps[next];
    const n = next + 1;
    s.li.dataset.state = 'running';
    s.state.textContent = 'sending';
    let out: Outcome;
    try {
      if (next === 0 && dirty()) {
        say(`Emptying the page's database: the trace starts on what the cells up to ${from} write.`);
        await quietlyEmpty();
        warn.hidden = true;
      }
      let first = next === 0;
      const run: RunScript = async (code, params) => {
        const r = await page.run(code, params, { upTo: first ? from : null });
        first = false;
        return r.text;
      };
      out = await callTool(run, s.call, n, { readOnly: false });
    } catch (err) {
      s.li.dataset.state = 'error';
      s.state.textContent = 'not sent';
      say(`Step ${n} could not run: ${(err as Error).message}`);
      running = false;
      buttons();
      return false;
    }
    // The call ran: from here on the step counts as sent, whatever showing it costs.
    next++;
    if (s.call.tool === 'write_cypher' && !out.isError) {
      wrote = true;
      warn.hidden = false;
      warn.textContent = 'The page\'s database now holds what the trace wrote; the trace empties it again after its last step, and Reset on the engine bar empties it at any time.';
    }
    try {
      await show(s, out, n);
    } catch (err) {
      s.li.dataset.state = out.isError ? 'error' : 'done';
      s.state.textContent = 'sent';
      say(`Step ${n} answered, and showing it failed: ${(err as Error).message}`);
    }
    if (next >= steps.length && wrote) {
      try {
        await quietlyEmpty();
        warn.hidden = false;
        warn.textContent = 'The trace has ended and the page\'s database is empty again, so the page\'s cells run on what they write; the results above are the trace\'s.';
      } catch (err) {
        warn.hidden = false;
        warn.textContent = `The page's database still holds what the trace wrote (${(err as Error).message}); Reset on the engine bar empties it before the cells run again.`;
      }
    }
    running = false;
    buttons();
    return true;
  };

  const playAll = async () => {
    stopAll = false;
    while (next < steps.length && !stopAll) if (!(await step())) break;
  };
  const restart = () => {
    stopAll = true;
    clear();
  };
  const actions: [HTMLButtonElement, () => unknown][] = [
    [stepBtn, () => void step()],
    [playBtn, () => void playAll()],
    [restartBtn, restart],
  ];
  for (const [button, act] of actions) {
    button.addEventListener('click', act);
    // Enter on the focused button acts once: the default (a click from the key press) is cancelled.
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      if (!button.disabled) act();
    });
  }
  // Reset, Stop or a crash took the database: the trace's results describe one that is gone.
  const offReset = page.onReset(() => {
    if (resetting) return;
    stopAll = true;
    wrote = false;
    warn.hidden = true;
    clear();
  });

  clear();
  live.replaceChildren(root);
  ctx.showLive();
  return () => offReset();
}

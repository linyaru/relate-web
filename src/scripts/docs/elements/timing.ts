// The phase timing bar: the `timing` cell word (`mount`, on that cell) and
// the engine bar's "Show timing" toggle (`barToggle`, on every cell of the
// page). After a run it draws the parse, plan and execute milliseconds of each
// statement's envelope as a stacked bar in the cell's `timing` pane, with the
// numbers as text, labelled as this tab's run. A recorded result keeps no
// timings (they are stripped so a recording never drifts), so a cell that
// shows its recording says that instead of drawing anything. The model is
// src/lib/docs/elements/_timing-model.ts.

import type { BarContext, CellHandle, ElementContext, ElementRun, PageApi } from '../element-api.ts';
import { formatMs, phases, segments, type Phases } from '../../../lib/docs/elements/_timing-model.ts';
import { liveLine, TIMER_NOTE, versions } from '../../../lib/docs/elements/_wording.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would be hoisted into every docs page).
import styles from './timing.css?inline';

/** Statements drawn per run; a longer script says how many more it ran. */
const MAX_ROWS = 8;
const PHASE_NAMES = { parse: 'Parse', plan: 'Plan', execute: 'Execute' } as const;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });

/**
 * A note in the pane, kept out of the result's live region: the toggle writes
 * one into every cell at once, and the engine bar's status line already says
 * the toggle changed once. A drawn bar is announced with its result again.
 */
function note(pane: HTMLElement, text: string) {
  pane.hidden = false;
  pane.setAttribute('aria-live', 'off');
  pane.replaceChildren(el('p', 'timing-note', text));
}

/**
 * Fill the pane for what the cell shows now: the run on screen, timed from
 * its envelopes (a module that mounts after the reader ran the cell still
 * has them on the handle), or a note for a recording, which keeps no timings.
 */
function show(pane: HTMLElement, cell: CellHandle, page: PageApi) {
  const run = cell.lastRun();
  if (run) {
    draw(pane, run, page);
    return;
  }
  note(
    pane,
    cell.state() === 'error'
      ? 'Timing: this run returned no envelope, so there is nothing to time. Run the cell again to time it in this tab.'
      : 'Timing: this is the recorded result, which keeps no timings. Run the cell to time its parse, plan and execute phases in this tab.',
  );
}

/** Draw a run's timings into `pane`: one stacked bar per statement, on one scale, with the numbers as text. */
function draw(pane: HTMLElement, run: ElementRun, page: PageApi) {
  const timed = run.envelopes.map((e, i) => ({ i, p: phases(e) })).filter((x): x is { i: number; p: Phases } => x.p !== null);
  if (!timed.length) {
    note(pane, 'Timing: the engine returned no timings for this run.');
    return;
  }
  pane.hidden = false;
  pane.removeAttribute('aria-live');
  const scale = Math.max(...timed.map(({ p }) => p.parse + p.plan + p.execute));
  const box = el('div', 'timing');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', "Phase timing of this tab's run");
  box.append(el('p', 'timing-head', `Timing. ${liveLine({ version: versions(page).live })} ${TIMER_NOTE}`));
  const multi = run.envelopes.length > 1;
  for (const { i, p } of timed.slice(0, MAX_ROWS)) {
    const row = el('div', 'timing-row');
    Object.assign(row.dataset, { parse: String(p.parse), plan: String(p.plan), execute: String(p.execute), elapsed: String(p.elapsed) });
    if (multi) row.append(el('p', 'timing-label', `Statement ${i + 1}`));
    const bar = el('div', 'timing-bar');
    bar.setAttribute('aria-hidden', 'true');
    for (const s of segments(p, scale)) {
      if (!s.percent) continue;
      const seg = el('span', `timing-seg timing-${s.phase}`);
      seg.style.width = `${s.percent}%`;
      seg.title = `${PHASE_NAMES[s.phase]} ${formatMs(s.ms)} ms`;
      bar.append(seg);
    }
    const text = el('p', 'timing-text');
    for (const phase of ['parse', 'plan', 'execute'] as const) {
      const item = el('span', 'timing-item');
      item.append(el('span', `timing-key timing-${phase}`), `${PHASE_NAMES[phase]} ${formatMs(p[phase])} ms`);
      text.append(item);
    }
    // The visible text is the whole reading (the bar is aria-hidden), so nothing repeats it for a screen reader.
    text.append(el('span', 'timing-item timing-elapsed', `${formatMs(p.elapsed)} ms elapsed`));
    row.append(bar, text);
    box.append(row);
  }
  if (timed.length > MAX_ROWS) box.append(el('p', 'timing-note', `and ${timed.length - MAX_ROWS} more statements.`));
  pane.replaceChildren(box);
}

/** A cell carrying the `timing` word: its pane times every run of it. */
export async function mount(ctx: ElementContext) {
  const { cell, page, live } = ctx;
  if (!cell) throw new Error('timing is a cell word: put `timing` on a ```cypher run fence');
  ctx.adoptStyles(styles);
  show(live, cell, page);
  const offResult = page.onResult((r) => {
    if (r.cell.id === cell.id) draw(live, r, page);
  });
  const offReset = page.onReset(() => show(live, cell, page));
  return () => {
    offResult();
    offReset();
  };
}

// The engine bar's toggle: every cell without the word gets the same pane while it is on.
let toggled: { off: () => void } | null = null;

export function barToggle(on: boolean, ctx: BarContext) {
  const { page } = ctx;
  toggled?.off();
  toggled = null;
  // The word's own cells time themselves already.
  const cells = page.cells().filter((c) => !('timing' in c.words));
  if (!on) {
    for (const c of cells) {
      const pane = c.slot('timing');
      pane.replaceChildren();
      pane.hidden = true;
    }
    page.status.say('Timing is off.');
    return;
  }
  ctx.adoptStyles(styles);
  for (const c of cells) show(c.slot('timing'), c, page);
  const offResult = page.onResult((r) => {
    if (!('timing' in r.cell.words)) draw(r.cell.slot('timing'), r, page);
  });
  const offReset = page.onReset(() => {
    for (const c of cells) show(c.slot('timing'), c, page);
  });
  const off = () => {
    offResult();
    offReset();
  };
  ctx.signal.addEventListener('abort', off, { once: true });
  toggled = { off };
  page.status.say('Timing is on: each cell you run shows its parse, plan and execute milliseconds under its result.');
}

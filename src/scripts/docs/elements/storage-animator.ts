// `:::storage-animator` in the browser (the build side and the facts are in
// src/lib/docs/elements/storage-animator.ts and _storage-animator-model.ts).
// Each view is a panel: the write path and the `.rl` file step a small store
// through Commit, Checkpoint and Crash, one documented step at a time; the
// durability view draws what a crash can lose under the chosen mode, with
// the crash moved by a slider. Every frame is drawn by the model's code, the
// same that drew the static form, in the page's colour variables.
//
// No engine runs. With motion, an action's steps advance on their own, a
// beat each, and the part a step names fades in; under
// prefers-reduced-motion (or with "Step by step" ticked) each step waits for
// Next, and nothing moves. The status line says where the facts come from;
// a separate live region reads each step out.

import type { ElementContext } from '../element-api.ts';
import { recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import {
  applyStep,
  DEFAULT_MODE,
  drawDurability,
  drawRlFile,
  drawWritePath,
  initialStore,
  loss,
  lossSentence,
  MODES,
  refusal,
  SCENE_TITLES,
  SCENES,
  secs,
  stepsFor,
  svgStyle,
  TIMELINE,
  type Action,
  type Drawing,
  type Mode,
  type Palette,
  type Scene,
  type Step,
} from '../../../lib/docs/elements/_storage-animator-model.ts';
import styles from './storage-animator.css?inline';

/** The drawing's colours as the page's variables, so a theme switch repaints without a redraw. */
const tint = (token: string) => `color-mix(in srgb, var(${token}) 16%, var(--bg-alt))`;
const PALETTE: Palette = {
  surface: 'var(--bg-alt)',
  node: 'var(--bg)',
  secondary: 'var(--bg-inset)',
  fg: 'var(--fg)',
  fgMuted: 'var(--fg-muted)',
  line: 'var(--fg-faint)',
  rule: 'var(--border-strong)',
  accent: 'var(--accent)',
  accentFill: tint('--accent'),
  good: 'var(--success)',
  goodFill: tint('--success'),
  bad: 'var(--danger)',
  badFill: tint('--danger'),
  font: 'var(--font-sans)',
  mono: 'var(--font-mono)',
};

/** How long a step stays before the next, with motion: long enough to read its sentence. */
const DWELL_MS = 1600;

const ACTION_NAMES: Record<Action, string> = { commit: 'Commit', checkpoint: 'Checkpoint', crash: 'Crash and reopen' };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids);
  return el;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A drawing as the inline SVG the stage shows, its style scoped to `id`. */
function svgMarkup(id: string, title: string, d: Drawing): string {
  return (
    `<svg id="${id}" class="sa-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.width} ${d.height}" style="max-width:${d.width}px" role="img" aria-labelledby="${id}-t ${id}-d">` +
    `<title id="${id}-t">${esc(title)}</title><desc id="${id}-d">${esc(d.desc)}</desc><style>${svgStyle(id, PALETTE)}</style>${d.body}</svg>`
  );
}

/** A button that stays focusable while unavailable (aria-disabled), so a keyboard user keeps their place. */
function button(label: string, cls: string, aria?: string): HTMLButtonElement {
  const b = h('button', { type: 'button', class: `btn ${cls}`, text: label });
  if (aria) b.setAttribute('aria-label', aria);
  return b;
}
const setAvailable = (b: HTMLButtonElement, ok: boolean) => (ok ? b.removeAttribute('aria-disabled') : b.setAttribute('aria-disabled', 'true'));
const available = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') !== 'true';

interface Panel {
  el: HTMLElement;
  /** Redraw at the stage's width (a resize, or the panel coming into view). */
  redraw(): void;
  /** Re-read the pace ("Step by step" or reduced motion changed): stop the clock, and restart it when steps remain and the steps run on their own. */
  pace(): void;
  stop(): void;
}

export function mount(ctx: ElementContext) {
  const { page, live, attrs, id } = ctx;
  ctx.adoptStyles(styles);
  const scenes: Scene[] = attrs.scenes
    ? attrs.scenes
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is Scene => (SCENES as readonly string[]).includes(s))
    : [...SCENES];
  if (!scenes.length) throw new Error('storage-animator: no view to show');

  const root = h('div', { class: 'storage-animator' });
  const status = h('p', {
    class: 'sa-status',
    role: 'status',
    text: `${recordedLine(versions(page).recorded)} The steps and numbers are relate's documented storage behaviour, drawn in this tab; no engine runs.`,
  });

  // "Step by step": on by default under reduced motion, and it follows the
  // preference until the reader sets it.
  const stepBox = h('input', { type: 'checkbox', class: 'sa-stepbox' });
  stepBox.checked = page.reducedMotion;
  let stepChosen = false;
  stepBox.addEventListener('change', () => {
    stepChosen = true;
    for (const p of panels) p.pace();
  }, { signal: ctx.signal });
  const offMotion = page.onReducedMotion((reduced) => {
    if (!stepChosen) stepBox.checked = reduced;
    for (const p of panels) p.pace();
  });
  const stepLabel = h('label', { class: 'sa-step' }, stepBox, 'Step by step');
  const stepMode = () => stepBox.checked;

  const width = (stage: HTMLElement) => Math.max(300, stage.clientWidth - 12);

  /** The write path or the `.rl` file: a store stepped through Commit, Checkpoint and (on the write path) Crash. */
  function storePanel(view: 'write-path' | 'rl-file'): Panel {
    const el = h('section', { class: 'sa-panel', 'data-view': view, 'aria-label': SCENE_TITLES[view] });
    const actions: Action[] = view === 'write-path' ? ['commit', 'checkpoint', 'crash'] : ['commit', 'checkpoint'];
    const buttons = new Map<Action, HTMLButtonElement>();
    for (const a of actions) buttons.set(a, button(ACTION_NAMES[a], `sa-${a}`, a === 'commit' ? 'Commit a write' : undefined));
    const next = button('Next step', 'sa-next');
    const reset = button('Reset', 'sa-reset', 'Reset: back to the store as it opened');
    const bar = h('div', { class: 'sa-bar' }, ...buttons.values(), next, reset);
    const stage = h('div', { class: 'sa-stage', 'data-view': view });
    const say = h('p', { class: 'sa-say', 'aria-live': 'polite' });
    el.append(bar, stage, say);

    let store = initialStore();
    let queue: Step[] = [];
    let total = 0;
    let label = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const svgId = `${id}-${view}-svg`;

    const draw = () => {
      const d = view === 'write-path' ? drawWritePath(store) : drawRlFile(store, width(stage));
      stage.innerHTML = svgMarkup(svgId, SCENE_TITLES[view], d);
      el.dataset.lsn = String(store.lsn);
      el.dataset.checkpointLsn = String(store.checkpointLsn);
      el.dataset.graphLsn = store.graphLsn === null ? 'none' : String(store.graphLsn);
      el.dataset.segments = store.segments.map((g) => g.id).join(',');
    };
    const sync = () => {
      const busy = queue.length > 0;
      el.dataset.busy = busy ? 'true' : 'false';
      for (const [a, b] of buttons) setAvailable(b, !busy && !refusal(store, a));
      setAvailable(next, busy);
    };
    const advance = () => {
      clearTimeout(timer);
      const step = queue.shift();
      if (!step) return;
      store = applyStep(store, step);
      say.textContent = `${label}, step ${total - queue.length} of ${total}: ${step.say}`;
      draw();
      sync();
      if (queue.length && !stepMode()) timer = setTimeout(advance, DWELL_MS);
    };
    const start = (a: Action) => {
      if (queue.length) return;
      const why = refusal(store, a);
      if (why) {
        say.textContent = why;
        return;
      }
      queue = stepsFor(store, a, view);
      total = queue.length;
      label = ACTION_NAMES[a];
      advance();
      if (stepMode() && queue.length) next.focus();
    };
    for (const [a, b] of buttons) b.addEventListener('click', () => available(b) && start(a), { signal: ctx.signal });
    next.addEventListener('click', () => available(next) && advance(), { signal: ctx.signal });
    reset.addEventListener('click', () => {
      clearTimeout(timer);
      queue = [];
      store = initialStore();
      say.textContent = `Back to the store as it opened: the snapshot at checkpoint LSN ${store.checkpointLsn}, and an empty open segment.`;
      draw();
      sync();
    }, { signal: ctx.signal });

    say.textContent =
      view === 'write-path'
        ? `A store just opened, under full: the snapshot holds checkpoint LSN ${store.checkpointLsn}, the open WAL segment is empty, and the graph is loaded. Press Commit to follow one write.`
        : `team.rl just opened: its snapshot holds checkpoint LSN ${store.checkpointLsn} and its open WAL segment is empty. Press Commit, then Checkpoint, to see where each part goes inside the file.`;
    draw();
    sync();
    return {
      el,
      redraw: () => view === 'rl-file' && draw(),
      pace: () => {
        clearTimeout(timer);
        if (queue.length && !stepMode()) timer = setTimeout(advance, DWELL_MS);
      },
      stop: () => clearTimeout(timer),
    };
  }

  /** The durability view: a mode switch and a crash slider over one timeline. */
  function durabilityPanel(): Panel {
    const el = h('section', { class: 'sa-panel', 'data-view': 'durability', 'aria-label': SCENE_TITLES.durability });
    const modes = h('fieldset', { class: 'sa-modes' }, h('legend', { text: 'Durability mode' }));
    const name = `${id}-mode`;
    let mode: Mode = DEFAULT_MODE;
    for (const m of MODES) {
      const input = h('input', { type: 'radio', name, value: m });
      input.checked = m === mode;
      input.addEventListener('change', () => {
        if (input.checked) {
          mode = m;
          update();
        }
      }, { signal: ctx.signal });
      modes.append(h('label', {}, input, h('code', { text: m }), m === DEFAULT_MODE ? ' (default)' : ''));
    }
    const sliderId = `${id}-crash`;
    const slider = h('input', { type: 'range', id: sliderId, min: String(TIMELINE.minCrash), max: String(TIMELINE.seconds), step: '0.1', value: String(TIMELINE.crash) });
    const out = h('output', { for: sliderId });
    const crashRow = h('div', { class: 'sa-crash-row' }, h('label', { for: sliderId, text: 'Crash at' }), slider, out);
    const stage = h('div', { class: 'sa-stage', 'data-view': 'durability' });
    const say = h('p', { class: 'sa-say', 'aria-live': 'polite' });
    el.append(modes, crashRow, stage, say);

    const svgId = `${id}-durability-svg`;
    const crash = () => Number(slider.value);
    function update() {
      const t = crash();
      const l = loss(mode, t);
      out.textContent = secs(t);
      slider.setAttribute('aria-valuetext', `${secs(t)} after the last completed checkpoint`);
      stage.innerHTML = svgMarkup(svgId, SCENE_TITLES.durability, drawDurability([mode], t, width(stage), mode));
      say.textContent = lossSentence(l);
      el.dataset.mode = mode;
      el.dataset.crash = String(t);
      el.dataset.acked = String(l.acked.length);
      el.dataset.lost = String(l.lost.length);
    }
    slider.addEventListener('input', update, { signal: ctx.signal });
    update();
    return { el, redraw: update, pace: () => {}, stop: () => {} };
  }

  const panels: Panel[] = scenes.map((s) => (s === 'durability' ? durabilityPanel() : storePanel(s)));

  // The view switch, when there is more than one view.
  let shown = 0;
  const switchButtons: HTMLButtonElement[] = [];
  if (panels.length > 1) {
    const group = h('div', { class: 'sa-scenes', role: 'group', 'aria-label': 'View' });
    scenes.forEach((s, i) => {
      const panelId = `${id}-panel-${s}`;
      panels[i].el.id = panelId;
      const b = button(SCENE_TITLES[s], 'sa-scene');
      b.dataset.scene = s;
      b.setAttribute('aria-controls', panelId);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => show(i), { signal: ctx.signal });
      switchButtons.push(b);
      group.append(b);
    });
    root.append(group);
  }
  function show(i: number) {
    shown = i;
    panels.forEach((p, j) => (p.el.hidden = j !== i));
    switchButtons.forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    panels[i].redraw();
  }
  root.append(status, stepLabel, ...panels.map((p) => p.el));
  // "Step by step" matters only where there are steps.
  stepLabel.hidden = !scenes.some((s) => s !== 'durability');
  live.replaceChildren(root);
  show(0);
  ctx.showLive();

  // The durability and .rl drawings follow the column's width.
  let frame = 0;
  let lastWidth = 0;
  const observer = new ResizeObserver(() => {
    const w = Math.round(root.clientWidth);
    if (w === lastWidth) return;
    lastWidth = w;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => panels[shown].redraw());
  });
  observer.observe(root);

  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    offMotion();
    for (const p of panels) p.stop();
  };
}

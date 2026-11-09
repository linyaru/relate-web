// `:::timeline`, the timeline view (the build side and its static form:
// src/lib/docs/elements/timeline.ts; ADR-0051). Live: the drawn step's rows on
// a time axis, read again from every run of the step (the reader's own Run,
// with whatever they typed, or the element's Run the step), so an edit to
// the step or its parameters redraws it. Where the page names an as-of step,
// a slider sets a time T, and each move runs the drawn step and then the
// as-of step on the page's database with T as its parameter; the rows the
// as-of step returns for T light up, on the first axis and, for bi-temporal
// rows, on the record axis. Every highlight is the engine's answer, never
// computed here.
//
// The engine loads on the first Run or slider move, not on scroll: until
// then the drawing is the recording, labelled as recorded. Keyboard: Tab
// reaches the slider, Run the step and the marks (one tab stop); the arrow
// keys move along a lane (left, right) and between lanes (up, down), Home
// and End go to a lane's ends, and each mark is read out with its values.
// At phone width the drawing keeps a legible size and scrolls sideways inside
// its frame.

import type { CellHandle, ElementContext, ElementRun, Envelope } from '../element-api.ts';
import { engineMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import {
  asOfParams,
  authoredTime,
  columnsOf,
  compactTable,
  describe,
  drawTimeline,
  isoTime,
  markText,
  namedKeys,
  rowProblems,
  sliderStops,
  timelineModel,
  type Model,
  type Noun,
} from '../../../lib/docs/elements/_timeline-model.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would be hoisted into every docs page).
import styles from './timeline.css?inline';

/** The narrowest the drawing gets; a narrower frame scrolls sideways. */
const MIN_WIDTH = 560;
/** A held arrow key or a drag runs once it settles for this long. */
const SETTLE_MS = 160;

type Rows = Record<string, unknown>[];

const html = <K extends keyof HTMLElementTagNameMap>(name: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(name);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

const typesOf = (env: { columns?: string[]; columnTypes?: string[] }): Record<string, string> =>
  Object.fromEntries((env.columns ?? []).map((c, i) => [c, env.columnTypes?.[i] ?? '']));

/** A cell's parameters as the page wrote them (its data block), whatever the reader has typed since. */
const authoredParams = (cell: CellHandle) => cell.element.querySelector<HTMLTextAreaElement>('.params-editor')?.defaultValue ?? cell.params();

const listing = (keys: Set<string>) => (keys.size ? [...keys].join(', ') : 'none');

export async function mount(ctx: ElementContext) {
  const { page, attrs, live } = ctx;
  const drawnOrNull = page.cell(attrs.cell);
  if (!drawnOrNull) throw new Error(`timeline: the page has no cell ${attrs.cell}`); // the static form stays
  const drawn: CellHandle = drawnOrNull;
  const asof = attrs.asof ? page.cell(attrs.asof) : null;
  if (attrs.asof && !asof) throw new Error(`timeline: the page has no cell ${attrs.asof}`);
  const cols = columnsOf(attrs);
  // What the page calls the statement: a recipe's step, a docs page's cell.
  const noun: Noun = location.pathname.startsWith('/cookbook/') ? 'step' : 'cell';
  ctx.adoptStyles(styles);

  const rec = ((await drawn.recorded()).envelope ?? {}) as { rows?: Rows; columns?: string[]; columnTypes?: string[] };
  const recorded = { rows: rec.rows ?? [], types: typesOf(rec) };
  const authored = asof ? authoredTime(authoredParams(asof), attrs.param) : { t: null, list: false };
  const extra = authored.t === null ? [] : [authored.t];

  // ------------------------------------------------------------ state
  let rows: Rows = recorded.rows;
  let types = recorded.types;
  let model: Model = timelineModel(rows, cols, types, extra);
  let stops = sliderStops(model.min, model.max, authored.t ?? model.min);
  let t: number | null = authored.t;
  let matched: Set<string> | null = null;
  let matchedRecord: Set<string> | null = null;
  let focus = 0;
  /** Bumped by a Reset: a run that started before it lands on nothing. */
  let generation = 0;

  // ------------------------------------------------------------ the pane
  const root = html('div', 'tl');
  const bar = html('div', 'tl-bar');
  const runBtn = html('button', 'btn tl-run', `Run the ${noun}`);
  runBtn.type = 'button';
  runBtn.setAttribute('aria-label', `Run the ${noun}: draw the ${attrs.cell} ${noun}'s rows from this tab's run${asof ? ` and run the ${attrs.asof} ${noun} at the slider's time` : ''}`);
  bar.append(runBtn);
  let slider: HTMLInputElement | null = null;
  let timeOut: HTMLOutputElement | null = null;
  if (asof && authored.t !== null) {
    const id = `${ctx.id}-time`;
    const label = html('label', 'tl-slider-label');
    label.htmlFor = id;
    label.append('Time for the ');
    label.append(html('code', '', attrs.asof));
    label.append(` ${noun}’s `);
    label.append(html('code', '', attrs.param));
    slider = html('input', 'tl-slider');
    slider.type = 'range';
    slider.id = id;
    slider.min = '0';
    slider.step = '1';
    timeOut = html('output', 'tl-time');
    timeOut.htmlFor.add(id);
    bar.append(label, slider, timeOut);
  }
  const frame = html('div', 'tl-frame');
  frame.setAttribute('role', 'group');
  frame.setAttribute('aria-label', `Timeline of the ${attrs.cell} ${noun}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tl-svg');
  svg.setAttribute('role', 'group');
  const descId = `${ctx.id}-desc`;
  svg.setAttribute('aria-describedby', descId);
  frame.append(svg);
  const desc = html('p', 'tl-sr');
  desc.id = descId;
  const detail = html('p', 'tl-detail');
  detail.setAttribute('aria-live', 'polite');
  const status = html('p', 'tl-status');
  status.setAttribute('role', 'status');
  const rowsBox = html('details', 'tl-rows');
  const rowsSummary = html('summary', '', 'Rows as a table');
  const rowsTable = html('div', 'tl-table');
  rowsBox.append(rowsSummary, rowsTable);
  root.append(bar, frame, desc, detail, status, rowsBox);
  live.replaceChildren(root);

  // ------------------------------------------------------------ drawing
  function setSlider() {
    if (!slider || !timeOut) return;
    // The slider's grid, for the case file: stop i is first + i * unit (epoch ms).
    root.dataset.first = String(stops.first);
    root.dataset.unit = String(stops.unit);
    slider.max = String(stops.count - 1);
    const i = t === null ? 0 : Math.round((t - stops.first) / stops.unit);
    slider.value = String(Math.min(stops.count - 1, Math.max(0, i)));
    const shown = isoTime(t ?? stops.first);
    slider.setAttribute('aria-valuetext', shown);
    timeOut.value = shown;
  }

  function drawTable() {
    const table = compactTable(model);
    const el = html('table');
    const head = el.createTHead().insertRow();
    for (const c of table.columns) head.append(html('th', '', c));
    const body = el.createTBody();
    for (const r of table.rows) {
      const tr = body.insertRow();
      for (const v of r) tr.append(html('td', '', v));
    }
    rowsTable.replaceChildren(el);
  }

  function draw() {
    const hadFocus = svg.contains(document.activeElement);
    const width = Math.max(MIN_WIDTH, Math.floor(frame.clientWidth) || MIN_WIDTH);
    focus = Math.min(focus, Math.max(0, model.marks.length - 1));
    const { body, height } = drawTimeline(model, { width, t: slider ? t : null, matched, matchedRecord, interactive: true, focus });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-label', `Timeline of the ${attrs.cell} ${noun}: Tab to the marks, then the arrow keys`);
    svg.innerHTML = body;
    desc.textContent = describe(model, attrs.cell, noun);
    root.dataset.marks = String(model.marks.length);
    root.dataset.source = rows === recorded.rows ? 'recorded' : 'live';
    if (t !== null) root.dataset.t = isoTime(t);
    if (hadFocus) markEl(focus)?.focus({ preventScroll: false });
  }

  /** A narrow frame scrolls sideways: keep the slider's time line in sight as it moves. */
  function keepInView() {
    const x = Number(svg.querySelector('.tl-now')?.getAttribute('x1'));
    if (!Number.isFinite(x) || frame.scrollWidth <= frame.clientWidth) return;
    const margin = 48;
    if (x < frame.scrollLeft + margin) frame.scrollLeft = Math.max(0, x - margin);
    else if (x > frame.scrollLeft + frame.clientWidth - margin) frame.scrollLeft = x - frame.clientWidth + margin;
  }

  const markEl = (i: number) => svg.querySelector<SVGGElement>(`.tl-mark[data-i="${i}"]`);

  function useRows(next: Rows, nextTypes: Record<string, string>) {
    rows = next;
    types = nextTypes;
    model = timelineModel(rows, cols, types, extra);
    stops = sliderStops(model.min, model.max, authored.t ?? model.min);
    setSlider();
    drawTable();
    draw();
  }

  function showRecorded() {
    matched = null;
    matchedRecord = null;
    t = authored.t;
    useRows(recorded.rows, recorded.types);
    detail.textContent = '';
    status.textContent =
      `${recordedLine(versions(page).recorded)} ${model.marks.length === 1 ? '1 row' : `${model.marks.length} rows`} of the ${attrs.cell} ${noun}. ` +
      (asof ? `Moving the time runs the ${attrs.asof} ${noun} in this tab.` : `Running the ${noun} draws it from this tab.`);
  }

  // ------------------------------------------------------------ the engine
  /** The cells to run first: everything before the later of the drawn step and the as-of step. */
  function upTo(): string | null {
    const later = Math.max(drawn.index, asof?.index ?? 0);
    return page.cells()[later - 2]?.id ?? null;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  /** Whether the reader has asked for the as-of step: a later run of the drawn step asks it again. */
  let probed = false;

  async function refresh() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    root.dataset.running = 'true';
    const gen = generation;
    const at = t;
    try {
      if (!page.engine()) status.textContent = `Starting the engine, then running the cells this ${noun} needs…`;
      const one: ElementRun = await page.run(drawn.code(), drawn.params(), { upTo: upTo() });
      if (gen !== generation) return;
      const env = one.envelopes.at(-1) as Envelope | undefined;
      if (!env || env.error) {
        status.textContent = `The ${attrs.cell} ${noun} failed: ${env?.error ?? one.error ?? 'no result'}. The drawing keeps its last rows.`;
        return;
      }
      const problems = rowProblems(env.rows, env.columns, cols);
      if (problems.length) {
        status.textContent = `${liveLine({ version: versions(page).live, ms: engineMs(one.envelopes), of: `the ${attrs.cell} ${noun}` })} It cannot be drawn: ${problems[0]}.`;
        return;
      }
      useRows(env.rows, typesOf(env));
      let ms = engineMs(one.envelopes) ?? 0;
      let said = `${model.marks.length === 1 ? '1 row' : `${model.marks.length} rows`} drawn.`;
      if (asof && at !== null) {
        probed = true;
        const params = asOfParams(asof.params(), drawn.params(), attrs.param, at, authored.list);
        if (params === null) {
          status.textContent = `The ${attrs.asof} ${noun}'s parameters are not a JSON object, so the time cannot be set in them.`;
          return;
        }
        const two = await page.run(asof.code(), params, { upTo: null });
        if (gen !== generation) return;
        const res = two.envelopes.at(-1) as Envelope | undefined;
        ms += engineMs(two.envelopes) ?? 0;
        if (!res || res.error) {
          matched = null;
          matchedRecord = null;
          draw();
          status.textContent = `The ${attrs.asof} ${noun} failed at ${isoTime(at)}: ${res?.error ?? two.error ?? 'no result'}.`;
          return;
        }
        matched = namedKeys(res.rows, attrs.match);
        matchedRecord = attrs['match-record'] ? namedKeys(res.rows, attrs['match-record']) : null;
        draw();
        said =
          `At ${isoTime(at)} the ${attrs.asof} ${noun} names, in ${attrs.match}: ${listing(matched)}` +
          (matchedRecord ? `; in ${attrs['match-record']}: ${listing(matchedRecord)}` : '') +
          '.';
      }
      const of = asof && at !== null ? `the ${attrs.cell} and ${attrs.asof} ${noun}s` : `the ${attrs.cell} ${noun}`;
      status.textContent = `${liveLine({ version: versions(page).live, ms, of })} ${said}`;
    } catch (err) {
      if (gen === generation) status.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      running = false;
      delete root.dataset.running;
      if (again) {
        again = false;
        void refresh();
      } else if (timer === null) delete root.dataset.pending;
    }
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, SETTLE_MS);
  }

  // ------------------------------------------------------------ input
  runBtn.addEventListener('click', () => void refresh(), { signal: ctx.signal });

  slider?.addEventListener(
    'input',
    () => {
      t = stops.first + Number(slider!.value) * stops.unit;
      setSlider();
      // The lit rows belong to the last time asked; until the new answer lands they show as pending.
      root.dataset.pending = 'true';
      draw();
      keepInView();
      schedule();
    },
    { signal: ctx.signal },
  );

  /** The mark the arrow keys move to from mark `i`. */
  function step(i: number, key: string): number | null {
    const m = model.marks[i];
    if (!m) return null;
    const lane = model.lanes[m.lane].marks;
    const at = lane.indexOf(i);
    if (key === 'ArrowRight') return lane[at + 1] ?? null;
    if (key === 'ArrowLeft') return lane[at - 1] ?? null;
    if (key === 'Home') return lane[0];
    if (key === 'End') return lane.at(-1)!;
    const next = model.lanes[m.lane + (key === 'ArrowDown' ? 1 : -1)];
    if (!next) return null;
    // The mark in the next lane nearest in time.
    return next.marks.reduce((best, j) => (Math.abs(model.marks[j].start - m.start) < Math.abs(model.marks[best].start - m.start) ? j : best), next.marks[0]);
  }

  svg.addEventListener(
    'keydown',
    (e) => {
      const g = (e.target as Element).closest?.('.tl-mark') as SVGGElement | null;
      if (!g || !['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = step(Number(g.dataset.i), e.key);
      if (next === null) return;
      g.setAttribute('tabindex', '-1');
      focus = next;
      const el = markEl(next);
      el?.setAttribute('tabindex', '0');
      el?.focus();
    },
    { signal: ctx.signal },
  );
  const tell = (e: Event) => {
    const g = (e.target as Element).closest?.('.tl-mark') as SVGGElement | null;
    if (!g) return;
    const m = model.marks[Number(g.dataset.i)];
    if (m) detail.textContent = markText(model, m);
    if (e.type === 'focusin') focus = Number(g.dataset.i);
  };
  svg.addEventListener('focusin', tell, { signal: ctx.signal });
  svg.addEventListener('pointerover', tell, { signal: ctx.signal });

  let lastWidth = 0;
  const resize = new ResizeObserver(() => {
    if (frame.clientWidth && frame.clientWidth !== lastWidth) {
      lastWidth = frame.clientWidth;
      draw();
    }
  });
  resize.observe(frame);

  // ------------------------------------------------------------ the page
  const offResult = page.onResult((r) => {
    if (r.cell.id !== attrs.cell || r.error) return;
    const env = r.envelopes.at(-1);
    if (!env || rowProblems(env.rows, env.columns, cols).length) return;
    matched = null;
    matchedRecord = null;
    useRows(env.rows, typesOf(env));
    if (asof && probed && !running) schedule();
    else status.textContent = `${liveLine({ version: versions(page).live, ms: engineMs(r.envelopes), of: `the ${attrs.cell} ${noun}` })} ${model.marks.length === 1 ? '1 row' : `${model.marks.length} rows`} drawn.`;
  });
  const offReset = page.onReset(() => {
    generation++;
    probed = false;
    delete root.dataset.pending;
    showRecorded();
  });

  // The reader ran the step before the element mounted: draw that run.
  showRecorded();
  const last = drawn.lastRun()?.envelopes.at(-1);
  if (last && !last.error && !rowProblems(last.rows, last.columns, cols).length) useRows(last.rows, typesOf(last));
  ctx.showLive();
  // At phone width the drawing scrolls: open it where the slider's time is.
  draw();
  keepInView();
  return () => {
    offResult();
    offReset();
    resize.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

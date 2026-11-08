// `:::geo-explorer`, the geospatial explorer (the build side and its static
// form: src/lib/docs/elements/geo-explorer.ts). Live: the page's places on a
// plane with a search circle and a search box the reader drags (or moves with
// the arrow keys and resizes with + and -). Each move runs the page's own
// radius or box cell again on the page's store, with the shape as its
// parameters, `PROFILE` in front so the plan reports the scan's database
// hits; the places the engine returns light up with their names and fill the
// table. A button runs the page's CREATE POINT INDEX cell, or drops the
// index, and the timing rows keep the last search's parse, plan and execute
// times and the scan's hits with the index off and with it on: every number
// is from the run that produced it.
//
// The engine loads on the first move or press, not on scroll: until then the
// plane shows the recorded result, labelled as recorded. The plane's
// geometry is the build's (_geo-explorer-plane.ts), so the live plane starts
// as the first frame the static form drew.

import type { CellHandle, ElementContext, ElementRun, Envelope, PlanOperator } from '../element-api.ts';
import { liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import { phases, segments, sentence, type Phases } from '../../../lib/docs/elements/_timing-model.ts';
import {
  boxFrom,
  cellText,
  circleFrom,
  clampBox,
  clampCircle,
  listing,
  makePlane,
  matchedNames,
  metersToPx,
  offPlaneText,
  placesFromRows,
  pointIndex,
  round10,
  toLatLon,
  toPx,
  type Box,
  type Circle,
  type Place,
  type Plane,
} from '../../../lib/docs/elements/_geo-explorer-plane.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would be hoisted into every docs page).
import styles from './geo-explorer.css?inline';

const SVG = 'http://www.w3.org/2000/svg';
/** At most one search per this many ms while a shape moves; the last position always runs. */
const THROTTLE_MS = 90;

type Mode = 'radius' | 'box';

interface Timing {
  /** The envelope's parse, plan and execute times, drawn as the timing element draws them (_timing-model.ts). */
  p: Phases;
  hits: number | null;
  scan: string;
  rows: number;
  what: string;
}

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.append(el);
  return el;
};
const html = <K extends keyof HTMLElementTagNameMap>(name: K, className = '', text = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(name);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
};

/** The leaves of a plan (the operators that read the store) and their database hits. */
function scanOf(root: PlanOperator | undefined): { hits: number | null; scan: string } {
  if (!root) return { hits: null, scan: '' };
  const leaves: PlanOperator[] = [];
  const walk = (op: PlanOperator) => (op.children?.length ? op.children.forEach(walk) : leaves.push(op));
  walk(root);
  const hits = leaves.reduce<number | null>((sum, op) => (typeof op.actual?.db_hits === 'number' ? (sum ?? 0) + op.actual.db_hits : sum), null);
  return { hits, scan: leaves.map((op) => op.operator).join(', ') };
}

/** A statement without a leading EXPLAIN or PROFILE, so the explorer's own PROFILE is the only one. */
const bare = (code: string) => code.trim().replace(/^(?:EXPLAIN|PROFILE)\s+/i, '');

/** The authored parameters of a cell (its data block as written), or what it would send now. */
function authoredParams(el: HTMLElement, fallback: string | null): Record<string, unknown> | null {
  const text = el.querySelector<HTMLTextAreaElement>('.params-editor')?.defaultValue ?? fallback;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}


export async function mount(ctx: ElementContext) {
  const { page, attrs, live } = ctx;
  const pointsOrNull = page.cell(attrs.points);
  const radiusOrNull = page.cell(attrs.radius);
  if (!pointsOrNull || !radiusOrNull) throw new Error('geo-explorer: the points or radius cell is missing'); // the static form stays
  const pointsCell: CellHandle = pointsOrNull;
  const radiusCell: CellHandle = radiusOrNull;
  const boxCell = attrs.box ? page.cell(attrs.box) : null;
  const indexCell = attrs.index ? page.cell(attrs.index) : null;
  const circle0 = circleFrom(authoredParams(radiusCell.element, radiusCell.params()));
  if (!circle0) throw new Error('geo-explorer: the radius cell has no {lat, lon, radius} parameters');
  const box0 = boxCell ? boxFrom(authoredParams(boxCell.element, boxCell.params())) : null;
  const index = indexCell ? pointIndex(indexCell.code()) : null;
  const indexCreate = index && indexCell ? indexCell.code().trim() : '';
  const extent = attrs.extent ? Number(attrs.extent) : undefined;
  ctx.adoptStyles(styles);

  const recordedRows = async (cell: CellHandle) => ((await cell.recorded()).envelope as { rows?: Record<string, unknown>[]; columns?: string[]; columnTypes?: string[] } | null) ?? null;
  const recordedPlaces = placesFromRows((await recordedRows(pointsCell))?.rows ?? []);
  const recorded = {
    radius: await recordedRows(radiusCell),
    box: boxCell ? await recordedRows(boxCell) : null,
  };

  // ------------------------------------------------------------ state
  let places: Place[] = recordedPlaces;
  let plane: Plane = makePlane(places, circle0, box0, extent);
  let mode: Mode = 'radius';
  let circle: Circle = clampCircle(plane, circle0);
  let box: Box | null = box0 ? clampBox(plane, box0) : null;
  let source: 'recorded' | 'live' = 'recorded';
  let columns: string[] = recorded.radius?.columns ?? [];
  /** The engine's type per column (FLOAT keeps its .0 in the table). */
  let columnTypes: string[] = recorded.radius?.columnTypes ?? [];
  let rows: Record<string, unknown>[] = recorded.radius?.rows ?? [];
  let matched = matchedNames(rows);
  /** Whether the page's store has the point index: null until asked (cells may have created or dropped it). */
  let indexOn: boolean | null = index && page.engine() ? null : false;
  const timings: Record<'off' | 'on', Timing | null> = { off: null, on: null };
  let statement = { code: radiusCell.code().trim(), params: JSON.stringify(circle0) };
  let indexStatement: string | null = null;
  let generation = 0; // bumped by Reset and by a mode switch: a search started before it is not drawn

  // ------------------------------------------------------------ the DOM
  const root = html('div', 'geo-explorer');
  const toolbar = html('div', 'geo-toolbar');
  const modes = html('div', 'geo-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Search shape');
  const modeButton = (m: Mode, label: string, aria: string) => {
    const b = html('button', 'btn', label);
    b.type = 'button';
    b.dataset.mode = m;
    b.setAttribute('aria-label', aria);
    modes.append(b);
    return b;
  };
  const radiusButton = modeButton('radius', 'Radius', `Radius: search with the ${attrs.radius} cell`);
  const boxButton = box ? modeButton('box', 'Box', `Box: search with the ${attrs.box} cell`) : null;
  const indexButton = html('button', 'btn geo-index');
  indexButton.type = 'button';
  indexButton.hidden = !index;
  toolbar.append(modes, indexButton);

  const main = html('div', 'geo-main');
  const figure = html('figure', 'geo-figure');
  const plot = svg('svg', { class: 'geo-plane', role: 'group', 'aria-roledescription': 'plane' });
  const caption = html('figcaption', 'geo-hint', 'Drag the shape or its handle; or focus it, then arrow keys move it and + and − resize it.');
  const offNote = html('p', 'geo-off');
  figure.append(plot, caption, offNote);
  const results = html('div', 'geo-results');
  const table = html('table', 'geo-table');
  results.append(table);
  main.append(figure, results);

  const status = html('p', 'geo-status');
  status.setAttribute('role', 'status');
  const statementBox = html('div', 'geo-code');
  const statementLabel = html('p', 'geo-label');
  const statementPre = html('pre');
  const statementCode = html('code');
  statementPre.append(statementCode);
  const paramsLine = html('p', 'geo-params');
  statementBox.append(statementLabel, statementPre, paramsLine);
  const indexBox = html('div', 'geo-code');
  indexBox.hidden = true;
  const indexPre = html('pre');
  const indexCode = html('code');
  indexPre.append(indexCode);
  indexBox.append(html('p', 'geo-label', 'Index statement, as it ran'), indexPre);
  const timingTable = html('table', 'geo-timing');
  root.append(toolbar, main, status, statementBox, indexBox, timingTable);
  live.replaceChildren(root);

  // ------------------------------------------------------------ drawing
  const layer = {
    base: svg('g', {}, plot),
    shape: svg('g', { class: 'geo-shape', tabindex: 0, role: 'group', 'aria-roledescription': 'search shape' }, plot),
    points: svg('g', { class: 'geo-points' }, plot),
  };
  /** User units per CSS px: labels and handles keep their size on a narrow screen. */
  let k = 1;

  function draw() {
    const W = plane.width;
    const H = plane.height;
    plot.setAttribute('viewBox', `0 0 ${W} ${H}`);
    k = Math.min(2.2, Math.max(1, W / (plot.clientWidth || W)));
    plot.style.setProperty('--k', String(k));
    layer.base.replaceChildren();
    svg('rect', { class: 'geo-ground', x: 0.5, y: 0.5, width: W - 1, height: H - 1, rx: 6 }, layer.base);
    // The shape.
    layer.shape.replaceChildren();
    if (mode === 'radius') {
      const [cx, cy] = toPx(plane, circle.lat, circle.lon);
      const r = metersToPx(plane, circle.radius);
      svg('circle', { class: 'geo-area', cx, cy, r }, layer.shape);
      svg('path', { class: 'geo-center', d: `M${cx - 6 * k} ${cy}h${12 * k}M${cx} ${cy - 6 * k}v${12 * k}` }, layer.shape);
      svg('circle', { class: 'geo-handle-hit', cx: cx + r, cy, r: 14 * k, 'data-handle': '1' }, layer.shape);
      svg('circle', { class: 'geo-handle', cx: cx + r, cy, r: 6 * k, 'data-handle': '1' }, layer.shape);
      layer.shape.setAttribute('aria-label', `Search circle: center latitude ${circle.lat}, longitude ${circle.lon}, radius ${circle.radius} m. Arrow keys move it; plus and minus resize it.`);
    } else if (box) {
      const [x1, y1] = toPx(plane, box.north, box.west);
      const [x2, y2] = toPx(plane, box.south, box.east);
      svg('rect', { class: 'geo-area', x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, layer.shape);
      svg('circle', { class: 'geo-handle-hit', cx: x2, cy: y1, r: 14 * k, 'data-handle': '1' }, layer.shape);
      svg('circle', { class: 'geo-handle', cx: x2, cy: y1, r: 6 * k, 'data-handle': '1' }, layer.shape);
      layer.shape.setAttribute('aria-label', `Search box: latitude ${box.south} to ${box.north}, longitude ${box.west} to ${box.east}. Arrow keys move it; plus and minus resize it.`);
    }
    // The places: lit (filled, bold name) when the last search returned them.
    layer.points.replaceChildren();
    for (const p of plane.onPlane) {
      const [x, y] = toPx(plane, p.lat, p.lon);
      const on = matched.has(p.name);
      const g = svg('g', { class: on ? 'geo-place is-hit' : 'geo-place', 'data-name': p.name }, layer.points);
      svg('title', {}, g).textContent = `${p.name}${p.kind ? ` (${p.kind})` : ''}: latitude ${p.lat}, longitude ${p.lon}${on ? ', returned by the search' : ''}`;
      svg('circle', { cx: x, cy: y, r: (on ? 7 : 5.5) * k }, g);
      const right = x < W - 150 * k;
      const t = svg('text', { x: x + (right ? 11 : -11) * k, y, dy: '0.35em', 'text-anchor': right ? 'start' : 'end' }, g);
      t.textContent = p.name;
    }
    plot.setAttribute('aria-label', `${plane.onPlane.length} places on a plane; the search returned ${matched.size}: ${listing([...matched]) || 'none'}.`);
    const off = offPlaneText(plane);
    offNote.textContent = off ? `Not drawn, beyond the plane: ${off}.` : '';
    offNote.hidden = !off;
    offNote.dataset.count = String(plane.offPlane.length);
  }

  function drawTable() {
    table.replaceChildren();
    const cap = table.createCaption();
    cap.textContent = `${source === 'live' ? 'Returned by the search in this tab' : 'Recorded result'}: ${rows.length === 1 ? '1 place' : `${rows.length} places`}`;
    const head = table.createTHead().insertRow();
    for (const c of columns) {
      const th = html('th', '', c);
      th.scope = 'col';
      head.append(th);
    }
    const body = table.createTBody();
    for (const r of rows) {
      const tr = body.insertRow();
      for (const [i, c] of columns.entries()) {
        const td = tr.insertCell();
        td.textContent = cellText(r[c], columnTypes[i]);
        if (typeof r[c] === 'number') td.className = 'num';
      }
    }
  }

  function drawStatement() {
    statementLabel.textContent = source === 'live' ? 'Statement, as it ran in this tab' : `Statement of the ${mode === 'radius' ? attrs.radius : attrs.box} cell, with its recorded parameters`;
    statementCode.textContent = statement.code;
    paramsLine.textContent = `Parameters: ${statement.params}`;
    indexBox.hidden = indexStatement === null;
    indexCode.textContent = indexStatement ?? '';
  }

  function drawIndexButton() {
    const label = indexOn === null ? 'Point index: checking' : indexOn ? 'Point index: on' : 'Point index: off';
    indexButton.textContent = label;
    indexButton.setAttribute('aria-pressed', String(indexOn === true));
    indexButton.setAttribute('aria-label', `${label}. Press to ${indexOn ? 'drop' : 'create'} the index ${index?.name ?? ''} and search again.`);
  }

  function drawTimings() {
    timingTable.replaceChildren();
    timingTable.createCaption().textContent = 'Last search with the point index off and on, timed by the engine in this tab';
    const head = timingTable.createTHead().insertRow();
    for (const c of ['Point index', 'Time', 'Scan database hits']) {
      const th = html('th', '', c);
      th.scope = 'col';
      head.append(th);
    }
    const body = timingTable.createTBody();
    // One scale for both rows, so the two searches compare.
    const scale = Math.max(0, ...[timings.off, timings.on].map((t) => (t ? t.p.parse + t.p.plan + t.p.execute : 0)));
    for (const key of ['off', 'on'] as const) {
      const t = timings[key];
      const tr = body.insertRow();
      tr.dataset.index = key;
      const th = html('th', '', key === 'off' ? 'Off' : 'On');
      th.scope = 'row';
      tr.append(th);
      const time = tr.insertCell();
      const hits = tr.insertCell();
      hits.className = 'num';
      if (!t) {
        time.textContent = 'no search yet';
        hits.textContent = '-';
        continue;
      }
      const bar = html('span', 'geo-bar');
      bar.setAttribute('aria-hidden', 'true');
      for (const s of segments(t.p, scale)) {
        const seg = html('span', `geo-seg ${s.phase}`);
        seg.style.width = `${s.percent}%`;
        bar.append(seg);
      }
      const nums = html('span', 'geo-nums', `${sentence(t.p)} (${t.what}, ${t.rows === 1 ? '1 row' : `${t.rows} rows`})`);
      time.append(bar, nums);
      hits.textContent = t.hits === null ? '-' : `${t.hits}`;
      if (t.scan) hits.title = t.scan;
    }
  }

  const describe = () =>
    mode === 'radius'
      ? `within ${circle.radius} m of latitude ${circle.lat}, longitude ${circle.lon}`
      : `in the box from latitude ${box!.south} to ${box!.north}, longitude ${box!.west} to ${box!.east}`;

  function drawAll() {
    draw();
    drawTable();
    drawStatement();
    drawIndexButton();
    drawTimings();
    radiusButton.setAttribute('aria-pressed', String(mode === 'radius'));
    boxButton?.setAttribute('aria-pressed', String(mode === 'box'));
  }

  function showRecorded() {
    const rec = mode === 'radius' ? recorded.radius : recorded.box;
    source = 'recorded';
    columns = rec?.columns ?? [];
    columnTypes = rec?.columnTypes ?? [];
    rows = rec?.rows ?? [];
    matched = matchedNames(rows);
    const cell = mode === 'radius' ? radiusCell : boxCell!;
    statement = { code: cell.code().trim(), params: JSON.stringify(mode === 'radius' ? circle0 : box0) };
    latest = null;
    status.textContent = `${recordedLine(versions(page).recorded)} ${rows.length === 1 ? '1 place' : `${rows.length} places`} ${describe()}. Moving the shape runs the search in this tab.`;
    drawAll();
  }

  // ------------------------------------------------------------ the engine
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let dirty = false;
  /**
   * The last search's sentence, not yet announced. The role=status line
   * hears only the search that runs once the shape has stopped (flush), so a
   * drag or a held arrow key makes one announcement, not one per throttled
   * search; the plane and the table show every search as it lands.
   */
  let latest: string | null = null;
  /** The index button's run is in flight: further presses wait (the button stays focusable, see toggleIndex). */
  let toggling = false;

  /** Ask the store whether the index exists (no cells run). */
  async function checkIndex() {
    if (!index) return;
    const run = await page.run('SHOW INDEXES YIELD name WHERE name = $name RETURN name', JSON.stringify({ name: index.name }), { upTo: null });
    indexOn = !run.error && (run.envelopes.at(-1)?.rows.length ?? 0) > 0;
    drawIndexButton();
  }

  async function search() {
    const gen = generation;
    const cell = mode === 'radius' ? radiusCell : boxCell!;
    const code = `PROFILE ${bare(cell.code())}`;
    // What the search is about, taken with its parameters: the shape may move on while it runs.
    const params = JSON.stringify(mode === 'radius' ? circle : box);
    const what = mode === 'radius' ? `radius ${circle.radius} m` : 'box';
    const said = describe();
    if (!page.engine()) status.textContent = 'Starting the engine, then running the cells this search needs…';
    let run: ElementRun;
    let idx: boolean | null;
    try {
      if (indexOn === null) await checkIndex();
      if (gen !== generation) return;
      // The index state the search runs under; a press that lands later does not refile its row.
      idx = indexOn;
      run = await page.run(code, params, { upTo: attrs.points });
    } catch (err) {
      if (gen === generation) latest = `Could not run the search: ${(err as Error).message}`;
      return;
    }
    if (gen !== generation) return;
    const env = run.envelopes.at(-1) as Envelope | undefined;
    source = 'live';
    statement = { code, params };
    if (!env || env.error) {
      columns = [];
      columnTypes = [];
      rows = [];
      matched = new Set();
      latest = `The search failed: ${env?.error ?? run.error ?? 'no result'}`;
      drawAll();
      return;
    }
    columns = env.columns;
    columnTypes = env.columnTypes ?? [];
    rows = env.rows;
    matched = matchedNames(rows);
    const { hits, scan } = scanOf(env.plan?.root);
    const p = phases(env);
    if (idx !== null && p) timings[idx ? 'on' : 'off'] = { p, hits, scan, rows: rows.length, what };
    latest =
      `${liveLine({ version: versions(page).live, ms: env.elapsed_ms })} ${rows.length === 1 ? '1 place' : `${rows.length} places`} ${said}; ` +
      `${hits === null ? '' : `${hits} database hits in the scan, `}point index ${idx ? 'on' : 'off'}.`;
    drawAll();
  }

  async function flush() {
    timer = null;
    if (running || !dirty) return;
    dirty = false;
    running = true;
    try {
      await search();
    } finally {
      running = false;
      if (dirty) schedule();
      // The shape has stopped and nothing is pending: announce this search.
      else if (timer === null && !drag && latest !== null) {
        status.textContent = latest;
        latest = null;
      }
    }
  }

  /** Search the shape where it is now: at most once per THROTTLE_MS while it moves, and always once after it stops. */
  function schedule() {
    dirty = true;
    if (!running && timer === null) timer = setTimeout(flush, THROTTLE_MS);
  }

  async function toggleIndex() {
    if (!index || toggling) return;
    // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
    toggling = true;
    indexButton.setAttribute('aria-disabled', 'true');
    // A Reset while this runs empties the store and puts the recording back: nothing below may write over it.
    const gen = generation;
    try {
      if (!page.engine()) {
        status.textContent = 'Starting the engine…';
        await page.engineReady();
      }
      if (gen !== generation) return;
      if (indexOn === null) await checkIndex();
      if (gen !== generation) return;
      const create = !indexOn;
      const code = create ? indexCreate : `DROP INDEX ${index.name} IF EXISTS`;
      indexStatement = code;
      drawStatement();
      const run = await page.run(code, null, { upTo: attrs.points });
      if (gen !== generation) return;
      if (run.error) {
        status.textContent = `The index statement failed: ${run.error}`;
        await checkIndex();
        return;
      }
      indexOn = create;
      drawIndexButton();
      dirty = true;
      if (!running) {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        await flush();
      }
    } catch (err) {
      if (gen === generation) status.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      toggling = false;
      indexButton.removeAttribute('aria-disabled');
    }
  }

  // ------------------------------------------------------------ input
  const at = (e: PointerEvent): [number, number] => {
    const m = plot.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  /** The pointer drag in progress; `moved` once the shape has changed, so a cancelled touch that moved nothing runs nothing. */
  let drag: null | { kind: 'move' | 'resize'; dx: number; dy: number; id: number; moved: boolean } = null;

  function centerPx(): [number, number] {
    if (mode === 'radius') return toPx(plane, circle.lat, circle.lon);
    const [x1, y1] = toPx(plane, box!.north, box!.west);
    const [x2, y2] = toPx(plane, box!.south, box!.east);
    return [(x1 + x2) / 2, (y1 + y2) / 2];
  }

  function moveTo(x: number, y: number) {
    if (mode === 'radius') {
      const [lat, lon] = toLatLon(plane, x, y);
      circle = clampCircle(plane, { ...circle, lat, lon });
    } else if (box) {
      const [x1, y1] = toPx(plane, box.north, box.west);
      const [x2, y2] = toPx(plane, box.south, box.east);
      const w = x2 - x1;
      const h = y2 - y1;
      const left = Math.min(plane.width - w, Math.max(0, x - w / 2));
      const top = Math.min(plane.height - h, Math.max(0, y - h / 2));
      const [north, west] = toLatLon(plane, left, top);
      const [south, east] = toLatLon(plane, left + w, top + h);
      box = clampBox(plane, { south, west, north, east });
    }
  }

  function resizeTo(x: number, y: number) {
    if (mode === 'radius') {
      const [cx, cy] = toPx(plane, circle.lat, circle.lon);
      circle = clampCircle(plane, { ...circle, radius: Math.hypot(x - cx, y - cy) / plane.scale });
    } else if (box) {
      // The south-west corner stays; the north-east corner follows the pointer.
      const [x1, y2] = toPx(plane, box.south, box.west);
      const [north, east] = toLatLon(plane, Math.max(x, x1 + 1), Math.min(y, y2 - 1));
      box = clampBox(plane, { ...box, north, east });
    }
  }

  function scaleBy(f: number) {
    if (mode === 'radius') circle = clampCircle(plane, { ...circle, radius: round10(circle.radius * f) });
    else if (box) {
      const midLat = (box.south + box.north) / 2;
      const midLon = (box.west + box.east) / 2;
      const hLat = ((box.north - box.south) / 2) * f;
      const hLon = ((box.east - box.west) / 2) * f;
      box = clampBox(plane, { south: midLat - hLat, west: midLon - hLon, north: midLat + hLat, east: midLon + hLon });
    }
  }

  const moved = () => {
    draw();
    schedule();
  };

  // A finger on the shape or its handle drags it; anywhere else on the plane
  // it scrolls the page, so a reader scrolling past never moves the shape or
  // starts the engine. Chrome applies touch-action only on the <svg> root,
  // not on the shapes inside it (CSS touch-action: none on .geo-area does
  // nothing there), so the shape claims its touches by cancelling
  // touchstart; the listener has to be non-passive for that. It claims one
  // finger only, so two fingers that land together pinch-zoom the page; a
  // second finger after the first ends the drag (dropTouchDrag), though
  // Chrome makes no pinch of a sequence whose touchstart was cancelled
  // (ADR-0040).
  plot.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1) dropTouchDrag();
      else if ((e.target as Element).closest?.('.geo-area, [data-handle]')) e.preventDefault();
    },
    { passive: false, signal: ctx.signal },
  );
  /** A second finger landed: the drag ends where the shape is, searching only if it moved. */
  function dropTouchDrag() {
    const was = drag;
    drag = null;
    if (was?.moved) schedule();
  }
  plot.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return;
      // Pointer events reach the page before touchstart: a second finger ends a touch drag here too.
      if (e.pointerType === 'touch' && drag && drag.id !== e.pointerId) return dropTouchDrag();
      const target = e.target as Element;
      const [x, y] = at(e);
      if (target.closest('[data-handle]')) drag = { kind: 'resize', dx: 0, dy: 0, id: e.pointerId, moved: false };
      else if (target.closest('.geo-area')) {
        const [cx, cy] = centerPx();
        drag = { kind: 'move', dx: x - cx, dy: y - cy, id: e.pointerId, moved: false };
      } else {
        // A finger on the open plane: the page scrolls (see touchstart above).
        if (e.pointerType === 'touch') return;
        // A mouse or pen on the open plane: the shape jumps there, and the drag goes on from it.
        moveTo(x, y);
        drag = { kind: 'move', dx: 0, dy: 0, id: e.pointerId, moved: true };
        moved();
      }
      e.preventDefault();
      layer.shape.focus({ preventScroll: true });
      try {
        plot.setPointerCapture(e.pointerId);
      } catch {
        // A synthetic or already-released pointer cannot be captured; moves still reach the plane.
      }
    },
    { signal: ctx.signal },
  );
  plot.addEventListener(
    'pointermove',
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const [x, y] = at(e);
      if (drag.kind === 'move') moveTo(x - drag.dx, y - drag.dy);
      else resizeTo(x, y);
      drag.moved = true;
      moved();
    },
    { signal: ctx.signal },
  );
  // The search after the shape stops; a press that moved nothing (a tap, or a touch the browser cancelled) runs none.
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const was = drag;
    drag = null;
    if (was.moved) schedule();
  };
  plot.addEventListener('pointerup', end, { signal: ctx.signal });
  plot.addEventListener('pointercancel', end, { signal: ctx.signal });
  layer.shape.addEventListener(
    'keydown',
    (e) => {
      const step = plane.width / 32;
      const [cx, cy] = centerPx();
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) moveTo(cx + moves[e.key][0], cy + moves[e.key][1]);
      else if (e.key === '+' || e.key === '=') scaleBy(1.15);
      else if (e.key === '-' || e.key === '_') scaleBy(1 / 1.15);
      else return;
      e.preventDefault();
      moved();
    },
    { signal: ctx.signal },
  );
  const setMode = (m: Mode) => {
    if (m === mode) return;
    mode = m;
    generation++;
    if (source === 'live') {
      matched = new Set();
      draw();
      dirty = true;
      if (!running && timer === null) void flush();
    } else showRecorded();
    radiusButton.setAttribute('aria-pressed', String(mode === 'radius'));
    boxButton?.setAttribute('aria-pressed', String(mode === 'box'));
  };
  radiusButton.addEventListener('click', () => setMode('radius'), { signal: ctx.signal });
  boxButton?.addEventListener('click', () => setMode('box'), { signal: ctx.signal });
  indexButton.addEventListener('click', () => void toggleIndex(), { signal: ctx.signal });

  // Labels and handles keep their size when the plane is drawn narrow.
  let lastWidth = 0;
  const resize = new ResizeObserver(() => {
    if (plot.clientWidth && plot.clientWidth !== lastWidth) {
      lastWidth = plot.clientWidth;
      draw();
    }
  });
  resize.observe(plot);

  // ------------------------------------------------------------ the page
  const offResult = page.onResult((r) => {
    if (r.cell.id === attrs.points && !r.error) {
      const live = placesFromRows(r.envelopes.at(-1)?.rows ?? []);
      if (live.length) {
        places = live;
        plane = makePlane(places, circle0, box0, extent);
        draw();
      }
    }
    // A cell that creates or drops an index changes what the button says: ask the store.
    if (index && /\bINDEX\b/i.test(r.cell.code())) {
      indexOn = null;
      drawIndexButton();
      void checkIndex().catch(() => {});
    }
  });
  const offReset = page.onReset(() => {
    generation++;
    indexOn = false;
    timings.off = null;
    timings.on = null;
    indexStatement = null;
    places = recordedPlaces;
    plane = makePlane(places, circle0, box0, extent);
    circle = clampCircle(plane, circle0);
    box = box0 ? clampBox(plane, box0) : null;
    showRecorded();
  });

  showRecorded();
  ctx.showLive();
  // Cells ran before the element mounted: the store may hold the index already.
  if (indexOn === null) void checkIndex().catch(() => {});
  return () => {
    offResult();
    offReset();
    resize.disconnect();
    if (timer !== null) clearTimeout(timer);
  };
}

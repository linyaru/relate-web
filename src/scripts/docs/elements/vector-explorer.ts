// `:::vector-explorer` in the browser (the build side, and what each view
// shows, are in src/lib/docs/elements/vector-explorer.ts). Both views start
// on the recording and run nothing until the reader moves a control: the
// first move starts the engine, runs the cells the search needs, then the
// page's own statement with the chosen k. The engine ranks; this module only
// marks what it returned.
//
// The scatter reads its coordinates back from the static picture's data
// attributes (the projection is computed once, at record time), so a live
// view and the static form always place a point in the same spot.

import { fuse, shareFormula, type Fused } from '../../../lib/docs/elements/_vector-explorer-math.ts';
import { liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import type { CellHandle, ElementContext, ElementRun, PageApi } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain CSS import would be hoisted into every docs page).
import styles from './vector-explorer.css?inline';

const MAX_K = 10;
const SVG = 'http://www.w3.org/2000/svg';

type Row = Record<string, unknown>;
type RecordedEnvelope = { columns?: string[]; rows?: Row[]; error?: string | null } | null;

export async function mount(ctx: ElementContext) {
  ctx.adoptStyles(styles);
  return 'lists' in ctx.attrs ? mountHybrid(ctx) : mountScatter(ctx);
}

// ---------------------------------------------------------------- shared

// Props are untyped on purpose: a mapped Partial over every tag's element type is a union too complex for tsc.
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
};
const svgEl = (tag: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
/** A statement's own time in this run, from its envelope; a run's `ms` also covers the cells it ran first. */
const took = (r: ElementRun) => r.envelopes.at(-1)?.elapsed_ms ?? 0;
const show = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : JSON.stringify(v));

/** The cell just before `id` in page order (what must run before the element's statement), or null. */
function before(page: PageApi, id: string): string | null {
  const cells = page.cells();
  const i = cells.findIndex((c) => c.id === id);
  return i > 0 ? cells[i - 1].id : null;
}

/** The cell's parameters as the reader has them now, with `k` set. */
function paramsWithK(cell: CellHandle, k: number): string {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(cell.params() ?? '{}');
  } catch {
    throw new Error(`the parameters of cell ${cell.id} are not valid JSON`);
  }
  return JSON.stringify({ ...params, k });
}

/** One k slider, labelled, with its value beside it. */
function kSlider(id: string, k: number, max: number, what: string) {
  const input = el('input', { type: 'range', min: '1', max: String(max), value: String(k), id: `${id}-k`, className: 'vx-range' });
  input.setAttribute('aria-label', `k: how many ${what} each search returns`);
  const out = el('output', { className: 'vx-kval', textContent: String(k) });
  out.setAttribute('for', input.id);
  const label = el('label', { className: 'vx-k', htmlFor: input.id }, 'k ');
  const wrap = el('div', { className: 'vx-field' }, label, input, out);
  input.addEventListener('input', () => (out.textContent = input.value));
  return { wrap, input, out };
}

/**
 * Runs that follow the controls: one at a time, and after a run the latest
 * settings run once more if they changed meanwhile (a slider drag is many
 * inputs; the engine sees the last).
 */
function runner(task: () => Promise<void>, onError: (err: Error) => void) {
  let running = false;
  let again = false;
  let timer = 0;
  const go = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await task();
      } while (again);
    } catch (err) {
      onError(err as Error);
    } finally {
      running = false;
    }
  };
  return { schedule: () => (clearTimeout(timer), (timer = window.setTimeout(go, 120))), cancel: () => clearTimeout(timer) };
}

// ---------------------------------------------------------------- the scatter

interface Pt {
  id: string;
  group: string;
  x: number;
  y: number;
  fill: string;
  stroke: string;
  text: string;
}

/** The points and the question, read from the static picture's data attributes. */
function readPicture(form: HTMLElement | null) {
  const svg = form?.querySelector('g.points')?.closest('svg');
  if (!svg) throw new Error('the static picture holds no points');
  const points: Pt[] = [...svg.querySelectorAll<SVGCircleElement>('g.points circle[data-id]')].map((c) => ({
    id: c.dataset.id!,
    group: c.dataset.group ?? '',
    x: Number(c.dataset.x),
    y: Number(c.dataset.y),
    fill: c.getAttribute('fill') ?? '',
    stroke: c.getAttribute('stroke') ?? '',
    text: (c.querySelector('title')?.textContent ?? '').replace(/^[^:]*: /, ''),
  }));
  const q = svg.querySelector<SVGGElement>('[data-query]');
  const axes = [...svg.querySelectorAll('.axis-label')].map((t) => t.textContent ?? '');
  return { points, query: q ? { x: Number(q.dataset.x), y: Number(q.dataset.y), field: q.dataset.query ?? '' } : null, axes, dims: svg.querySelector<SVGGElement>('g.points')?.dataset.dims ?? '' };
}

/** The WHERE inside a SEARCH's parentheses, and the parameters it reads, for the filter's label. */
function filterClause(code: string): string {
  const m = /SEARCH[\s\S]*?\(([\s\S]*?)\)\s*(?:SCORE|$)/i.exec(code);
  const w = m && /\bWHERE\s+([\s\S]*?)\s+LIMIT\b/i.exec(m[1]);
  return w ? w[1].replace(/\s+/g, ' ').trim() : 'the filter inside the search';
}

async function mountScatter(ctx: ElementContext) {
  const { page, attrs, live } = ctx;
  const key = attrs.key || 'id';
  const cell = page.cell(attrs.cell);
  if (!cell) throw new Error(`no cell ${attrs.cell}`);
  const filterCell = attrs.filter ? page.cell(attrs.filter) : null;
  const euclidCell = attrs.euclidean ? page.cell(attrs.euclidean) : null;
  const { points, query, axes, dims } = readPicture(ctx.staticForm);
  const byId = new Map(points.map((p) => [p.id, p]));
  const recorded = ((await cell.recorded()).envelope ?? null) as RecordedEnvelope;
  const recordedIds = (recorded?.rows ?? []).map((r) => String(r[key]));
  let k0 = recordedIds.length || 5;
  try {
    k0 = Number(JSON.parse(cell.params() ?? '{}').k) || k0;
  } catch {
    // The recorded count stands.
  }
  const maxK = Math.min(MAX_K, points.length);

  // Controls.
  const slider = kSlider(ctx.id, Math.min(k0, maxK), maxK, 'points');
  const controls = el('div', { className: 'vx-controls' }, slider.wrap);
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Search controls');
  let metric: 'cosine' | 'euclidean' = 'cosine';
  const radios: HTMLInputElement[] = [];
  if (euclidCell) {
    const set = el('fieldset', { className: 'vx-field vx-metric' }, el('legend', { textContent: 'Rank by' }));
    for (const [value, text] of [['cosine', 'the index (cosine)'], ['euclidean', 'vector.similarity.euclidean']] as const) {
      const r = el('input', { type: 'radio', name: `${ctx.id}-metric`, value, checked: value === 'cosine' });
      radios.push(r);
      set.append(el('label', {}, r, ` ${text}`));
    }
    controls.append(set);
  }
  let filterBox: HTMLInputElement | null = null;
  if (filterCell) {
    filterBox = el('input', { type: 'checkbox' });
    const clause = filterClause(filterCell.code());
    const label = el('label', { className: 'vx-field vx-filter' }, filterBox, ' Pre-filter ', el('code', { textContent: `WHERE ${clause}` }));
    controls.append(label);
  }

  // The picture, drawn from the projection's coordinates with the same equal scale as the static one.
  const W = 640;
  const pad = 22;
  const xs = [...points.map((p) => p.x), ...(query ? [query.x] : [])];
  const ys = [...points.map((p) => p.y), ...(query ? [query.y] : [])];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * pad) / (x1 - x0 || 1), 400 / (y1 - y0 || 1));
  const H = Math.ceil((y1 - y0) * scale + 2 * pad + 14);
  const sx = (x: number) => pad + (x - x0) * scale + (W - 2 * pad - (x1 - x0) * scale) / 2;
  const sy = (y: number) => H - pad - (y - y0) * scale;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'vx-plot', role: 'img' });
  const svgTitle = svgEl('title', {});
  svg.append(svgTitle);
  const [ox, oy] = [sx(0), sy(0)];
  svg.append(
    svgEl('line', { class: 'vx-axis', x1: pad, y1: oy, x2: W - pad, y2: oy }),
    svgEl('line', { class: 'vx-axis', x1: ox, y1: pad - 8, x2: ox, y2: H - pad + 8 }),
  );
  if (axes[0]) svg.append(Object.assign(svgEl('text', { class: 'vx-axis-label', x: W - pad, y: oy - 6, 'text-anchor': 'end' }), { textContent: axes[0] }));
  if (axes[1]) svg.append(Object.assign(svgEl('text', { class: 'vx-axis-label', x: ox + 6, y: pad - 8, dy: '0.7em' }), { textContent: axes[1] }));
  const dots = new Map<string, SVGCircleElement>();
  const gPts = svgEl('g', {});
  for (const p of points) {
    const c = svgEl('circle', { class: 'vx-pt', cx: sx(p.x), cy: sy(p.y), r: 5, fill: p.fill, stroke: p.stroke, 'data-id': p.id }) as SVGCircleElement;
    const t = svgEl('title', {});
    t.textContent = `${p.id}${p.group ? ` (${p.group})` : ''}: ${p.text}`;
    c.append(t);
    dots.set(p.id, c);
    gPts.append(c);
  }
  const gRings = svgEl('g', {});
  svg.append(gPts, gRings);
  if (query) {
    const [qx, qy] = [sx(query.x), sy(query.y)];
    const g = svgEl('g', { class: 'vx-query' });
    g.append(svgEl('circle', { cx: qx, cy: qy, r: 7 }), svgEl('path', { d: `M${qx - 11} ${qy}H${qx + 11}M${qx} ${qy - 11}V${qy + 11}` }));
    const label = svgEl('text', { class: 'vx-query-label', x: qx + 13, y: qy + 16 });
    label.textContent = 'question';
    g.append(label);
    svg.append(g);
  }

  const status = el('p', { className: 'vx-status' });
  status.setAttribute('role', 'status');
  const inspect = el('p', { className: 'vx-inspect' });
  inspect.setAttribute('aria-live', 'polite');
  const list = el('ol', { className: 'vx-list' });
  list.setAttribute('aria-label', 'The engine\'s top k');
  const allBody = el('tbody');
  const all = el(
    'details',
    { className: 'vx-all' },
    el('summary', { textContent: `All ${points.length} points` }),
    el('div', { className: 'vx-scroll' }, el('table', {}, el('thead', { innerHTML: '<tr><th scope="col">id</th><th scope="col">Group</th><th scope="col">Rank</th><th scope="col">Text</th></tr>' }), allBody)),
  );
  const root = el('div', { className: 'vx' }, controls, el('div', { className: 'vx-figure' }, svg), status, list, inspect, all);
  live.replaceChildren(root);

  // Clicking a point says what it is; the "All N points" table holds the same for the keyboard.
  svg.addEventListener('click', (e) => {
    const id = (e.target as Element).closest?.('circle[data-id]')?.getAttribute('data-id');
    const p = id ? byId.get(id) : null;
    if (p) inspect.textContent = `${p.id}${p.group ? ` (${p.group})` : ''}: ${p.text}`;
  });

  let survivors: Set<string> | null = null;
  let survivorsFor = '';

  /** Ring the ranked ids, grey what the filter removed, and fill the list and the table. */
  function paint(ids: string[], scores: Map<string, unknown>, texts: Map<string, unknown>, filtered: Set<string> | null) {
    const rank = new Map(ids.map((id, i) => [id, i + 1]));
    gRings.replaceChildren();
    for (const [id, c] of dots) {
      const out = filtered !== null && !filtered.has(id);
      c.classList.toggle('vx-out', out);
      const n = rank.get(id);
      if (n) {
        const cx = Number(c.getAttribute('cx'));
        const cy = Number(c.getAttribute('cy'));
        gRings.append(svgEl('circle', { class: 'vx-ring', cx, cy, r: 9, 'data-rank': n, 'data-for': id }));
        const t = svgEl('text', { class: 'vx-rank', x: cx + 10, y: cy - 9 });
        t.textContent = String(n);
        gRings.append(t);
      }
    }
    list.replaceChildren(
      ...ids.map((id) => {
        const p = byId.get(id);
        const score = scores.get(id);
        const text = show(texts.get(id)) || p?.text || '';
        const li = el('li', {}, el('code', { textContent: id }), p?.group ? ` (${p.group})` : '', score === undefined ? '' : ` ${show(score)}`, text ? `: ${text}` : '', p ? '' : ' (not in the picture)');
        // The engine's id and score as data, so a check can compare them without parsing the sentence.
        li.dataset.id = id;
        if (score !== undefined) li.dataset.score = show(score);
        return li;
      }),
    );
    allBody.replaceChildren(
      ...points.map((p) => {
        const out = filtered !== null && !filtered.has(p.id);
        const tr = el('tr', { className: out ? 'vx-out-row' : '' });
        tr.append(el('td', {}, el('code', { textContent: p.id })), el('td', { textContent: p.group }), el('td', { textContent: rank.has(p.id) ? String(rank.get(p.id)) : out ? 'filtered out' : '' }), el('td', { textContent: p.text }));
        return tr;
      }),
    );
    const groups = filtered ? ` ${points.length - filtered.size} of ${points.length} points are greyed: the pre-filter removes them before the ranking.` : '';
    svgTitle.textContent = `${points.length} points${dims ? ` (${dims} dimensions)` : ''} on two principal components; ringed: ${ids.join(', ') || 'none'}.${groups}`;
    svg.setAttribute('aria-label', svgTitle.textContent);
  }

  const recordedScores = new Map((recorded?.rows ?? []).map((r) => [String(r[key]), r.score]));
  const recordedTexts = new Map((recorded?.rows ?? []).map((r) => [String(r[key]), r.text]));
  const showRecorded = () => {
    paint(recordedIds, recordedScores, recordedTexts, null);
    status.textContent = `${recordedLine(versions(page).recorded)} The top ${recordedIds.length}. Moving k, the ranking or the pre-filter runs the search in this tab.`;
  };
  showRecorded();

  const upTo = before(page, attrs.cell);
  const idsOf = (r: ElementRun) => (r.envelopes.at(-1)?.rows ?? []).map((row) => String(row[key]));
  const run = runner(
    async () => {
      const k = Number(slider.input.value);
      const filterOn = !!filterBox?.checked && metric === 'cosine';
      const target = metric === 'euclidean' ? euclidCell! : filterOn ? filterCell! : cell;
      status.textContent = page.engine() ? 'Running…' : 'Loading the engine and running the cells the search needs…';
      const r = await page.run(target.code(), paramsWithK(target, k), { upTo });
      if (r.error) {
        status.textContent = `The search failed: ${r.error}`;
        return;
      }
      let filtered: Set<string> | null = null;
      if (filterOn) {
        // Which points survive the pre-filter: the same search asked for every point; the engine returns only those the filter keeps.
        const params = paramsWithK(filterCell!, points.length);
        if (!survivors || survivorsFor !== filterCell!.code() + params) {
          const all = await page.run(filterCell!.code(), params, { upTo });
          survivors = all.error ? null : new Set(idsOf(all));
          survivorsFor = filterCell!.code() + params;
        }
        filtered = survivors;
      }
      const rows = r.envelopes.at(-1)?.rows ?? [];
      const ids = idsOf(r);
      paint(ids, new Map(rows.map((row) => [String(row[key]), row.score])), new Map(rows.map((row) => [String(row[key]), row.text])), filtered);
      const how = metric === 'euclidean' ? 'by vector.similarity.euclidean' : `by the index${filterOn ? ', pre-filtered' : ''}`;
      const missing = ids.filter((id) => !byId.has(id));
      status.textContent =
        `${liveLine({ version: versions(page).live, ms: took(r) })} Top ${ids.length} ${how}, with k = ${k}.` +
        (filtered ? ` ${points.length - filtered.size} points are greyed: the filter removed them before ranking.` : '') +
        (missing.length ? ` Not in the picture: ${missing.join(', ')}.` : '');
    },
    (err) => (status.textContent = `Could not run: ${err.message}`),
  );
  slider.input.addEventListener('input', run.schedule);
  filterBox?.addEventListener('change', run.schedule);
  for (const r of radios) {
    r.addEventListener('change', () => {
      metric = r.value as typeof metric;
      if (filterBox) {
        filterBox.disabled = metric === 'euclidean';
        filterBox.title = filterBox.disabled ? 'The pre-filter is part of SEARCH; the euclidean statement has none' : '';
      }
      run.schedule();
    });
  }
  const offReset = page.onReset(() => {
    run.cancel();
    survivors = null;
    slider.input.value = String(Math.min(k0, maxK));
    slider.out.textContent = slider.input.value;
    // Back to what the recording shows: the index's cosine ranking, no pre-filter.
    metric = 'cosine';
    if (radios[0]) radios[0].checked = true;
    if (filterBox) {
      filterBox.checked = false;
      filterBox.disabled = false;
      filterBox.title = '';
    }
    showRecorded();
  });
  ctx.showLive();
  return () => {
    run.cancel();
    offReset();
  };
}

// ---------------------------------------------------------------- the hybrid view

async function mountHybrid(ctx: ElementContext) {
  const { page, attrs, live } = ctx;
  const cells = attrs.lists.split(',').map((s) => s.trim()).filter(Boolean).map((id) => page.cell(id));
  if (cells.some((c) => !c)) throw new Error(`lists names a cell the page does not have: ${attrs.lists}`);
  const lists = cells as CellHandle[];
  const fuseCell = attrs.fuse ? page.cell(attrs.fuse) : null;
  const constant = attrs.constant ? Number(attrs.constant) : 60;
  const weights = (attrs.weights ?? '').split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
  let k0 = 3;
  try {
    k0 = Number(JSON.parse(lists[0].params() ?? '{}').k) || k0;
  } catch {
    // The default stands.
  }
  // `max` (validated at build) is how many ids the page's lists can return; past it every k gives the same lists.
  const maxK = Math.min(MAX_K, Number(attrs.max) || MAX_K);
  const slider = kSlider(ctx.id, Math.min(k0, maxK), maxK, 'results');
  const controls = el('div', { className: 'vx-controls' }, slider.wrap);
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Hybrid search controls');
  const columns = el('div', { className: 'vx-lists' });
  const fusedBody = el('tbody');
  const fusedHead = el('thead');
  const fusedTable = el('table', { className: 'vx-fused' }, el('caption', { textContent: `Fused by reciprocal rank: each list gives 1 / (${constant} + rank)${weights.length ? ' times its weight' : ''}` }), fusedHead, fusedBody);
  const status = el('p', { className: 'vx-status' });
  status.setAttribute('role', 'status');
  live.replaceChildren(el('div', { className: 'vx vx-hybrid' }, controls, columns, el('div', { className: 'vx-scroll' }, fusedTable), status));

  type Ranked = { cell: string; rows: Row[] };
  const scoreCol = (rows: Row[]) => Object.keys(rows[0] ?? {}).find((c) => c !== 'id' && typeof rows[0][c] === 'number');
  function paint(ranked: Ranked[], engine: Row[] | null, k: number) {
    columns.replaceChildren(
      ...ranked.map((l) => {
        const col = scoreCol(l.rows);
        const ol = el('ol', {}, ...l.rows.map((r) => el('li', {}, el('code', { textContent: String(r.id) }), col ? ` ${show(r[col])}` : '')));
        if (!l.rows.length) ol.append(el('li', { className: 'vx-none', textContent: 'no rows' }));
        return el('section', { className: 'vx-list-col' }, el('h4', {}, el('code', { textContent: l.cell })), ol);
      }),
    );
    const fused: Fused[] = fuse(ranked.map((l, i) => ({ name: l.cell, ids: l.rows.map((r) => String(r.id)), weight: weights[i] ?? 1 })), constant);
    const engineCol = engine ? Object.keys(engine[0] ?? {}).find((c) => /rrf|score|fused/i.test(c)) : undefined;
    const engineScore = new Map((engine ?? []).map((r) => [String(r.id), engineCol ? r[engineCol] : undefined]));
    fusedHead.innerHTML = '';
    const hr = el('tr');
    for (const h of ['id', ...ranked.map((l) => `rank in ${l.cell}`), 'arithmetic', 'fused score', ...(engine ? [`${attrs.fuse} (engine)`] : [])]) hr.append(el('th', { scope: 'col', textContent: h }));
    fusedHead.append(hr);
    let agree = 0;
    fusedBody.replaceChildren(
      ...fused.map((f, i) => {
        const tr = el('tr', { className: i < k ? 'vx-kept' : '' });
        tr.append(el('td', {}, el('code', { textContent: f.id })));
        for (const l of ranked) tr.append(el('td', { textContent: String(f.shares.find((s) => s.list === l.cell)?.rank ?? '') }));
        tr.append(el('td', {}, el('code', { textContent: shareFormula(f, constant) })), el('td', { textContent: f.score.toFixed(4) }));
        if (engine) {
          const v = engineScore.get(f.id);
          // The page's fused statement rounds to four decimals.
          const same = v !== undefined && Math.abs(Number(v) - f.score) < 5e-5;
          if (same) agree++;
          tr.append(el('td', { textContent: v === undefined ? (i < k ? 'missing' : '') : `${show(v)}${same ? ' (same)' : ' (differs)'}` }));
        }
        return tr;
      }),
    );
    return { fused, agree };
  }

  const recordedRows = async (c: CellHandle) => ((((await c.recorded()).envelope ?? null) as RecordedEnvelope)?.rows ?? []);
  const showRecorded = async () => {
    const ranked = await Promise.all(lists.map(async (c) => ({ cell: c.id, rows: await recordedRows(c) })));
    paint(ranked, fuseCell ? await recordedRows(fuseCell) : null, k0);
    status.textContent = `${recordedLine(versions(page).recorded)} The lists with k = ${k0}. Moving k runs ${lists.length} searches${fuseCell ? ' and the fused statement' : ''} in this tab.`;
  };
  await showRecorded();

  const first = lists.map((c) => c.index).reduce((a, b) => Math.min(a, b));
  const upTo = before(page, lists.find((c) => c.index === first)!.id);
  const run = runner(
    async () => {
      const k = Number(slider.input.value);
      status.textContent = page.engine() ? 'Running…' : 'Loading the engine and running the cells the searches need…';
      const ranked: Ranked[] = [];
      let total = 0;
      let longest = 0;
      for (const c of lists) {
        const r = await page.run(c.code(), paramsWithK(c, k), { upTo });
        if (r.error) {
          status.textContent = `${c.id} failed: ${r.error}`;
          return;
        }
        total += took(r);
        ranked.push({ cell: c.id, rows: r.envelopes.at(-1)?.rows ?? [] });
        longest = Math.max(longest, ranked.at(-1)!.rows.length);
      }
      let engine: Row[] | null = null;
      if (fuseCell) {
        const r = await page.run(fuseCell.code(), paramsWithK(fuseCell, k), { upTo });
        total += took(r);
        engine = r.error ? null : (r.envelopes.at(-1)?.rows ?? []);
      }
      const { fused, agree } = paint(ranked, engine, k);
      status.textContent =
        `${liveLine({ version: versions(page).live, ms: total })} ${lists.length} lists with k = ${k}, ${fuseCell ? lists.length + 1 : lists.length} statements. ${fused.length} ids fused, the first ${Math.min(k, fused.length)} kept.` +
        (longest < k ? ` No list holds ${k} ids: the searches find ${longest} at most.` : '') +
        (engine ? ` The fused statement returns ${engine.length} rows; ${agree} of its scores match the arithmetic.` : '');
    },
    (err) => (status.textContent = `Could not run: ${err.message}`),
  );
  slider.input.addEventListener('input', run.schedule);
  const offReset = page.onReset(() => {
    run.cancel();
    slider.input.value = String(Math.min(k0, maxK));
    slider.out.textContent = slider.input.value;
    void showRecorded();
  });
  ctx.showLive();
  return () => {
    run.cancel();
    offReset();
  };
}

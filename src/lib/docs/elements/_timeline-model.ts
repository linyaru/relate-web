// The timeline's model and drawing (`:::timeline`, ADR-0052): shared by the
// build side (src/lib/docs/elements/timeline.ts, which draws the static form
// from a step's recorded rows) and the browser module
// (src/scripts/docs/elements/timeline.ts, which draws the same picture from a
// live run). Free of Node and DOM imports.
//
// Every column comes from an attribute, never from a guess: `start` (the time
// a row happens or starts), `end` (where it ends; null is an open end),
// `record-start` and `record-end` (the second, record-time pair of a
// bi-temporal row), `lane` (rows that share its value share a lane; without
// it every row is its own lane) and `label` (what names a row). Temporal
// values are the engine's strings, printed as it returns them; they are
// parsed only to place a mark on the axis. Tick labels are generated, in UTC.

import { esc } from '../../cookbook/result-view.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The columns a placement names, read from the directive's attributes. */
export interface TimelineColumns {
  start: string;
  end?: string;
  recordStart?: string;
  recordEnd?: string;
  lane?: string;
  label?: string;
  /** The column whose values an as-of step's result names (default: `label`). */
  key?: string;
}

export const columnsOf = (a: Record<string, string>): TimelineColumns => ({
  start: a.start ?? '',
  end: a.end || undefined,
  recordStart: a['record-start'] || undefined,
  recordEnd: a['record-end'] || undefined,
  lane: a.lane || undefined,
  label: a.label || undefined,
  key: a.key || a.label || undefined,
});

/** The columns a placement reads from its step's rows, in the order the table prints them. */
export const namedColumns = (c: TimelineColumns): string[] =>
  [c.lane, c.label, c.start, c.end, c.recordStart, c.recordEnd, c.key].filter((v, i, all): v is string => !!v && all.indexOf(v) === i);

// ---------------------------------------------------------------- values

const TIME = /^(-?\d{4,})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?(?:\[[^\]]*\])?)?$/;

/**
 * A temporal value the engine returned (a DATE, a DATETIME or a LOCAL
 * DATETIME, as an ISO string) as epoch milliseconds, or null when it is not
 * one. A value without an offset is read as UTC.
 */
export function parseTime(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = TIME.exec(v.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', zone] = m;
  const date = new Date(0);
  date.setUTCFullYear(Number(y), Number(mo) - 1, Number(d));
  date.setUTCHours(Number(h), Number(mi), Number(s), Math.floor(Number(`0.${frac || '0'}`) * 1000));
  let ms = date.getTime();
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    ms -= sign * (Number(digits.slice(0, 2)) * HOUR + Number(digits.slice(2, 4) || '0') * MINUTE);
  }
  return Number.isFinite(ms) ? ms : null;
}

/** A value as the timeline prints it: the engine's string as returned, `null`, or JSON for a list or map. */
export function valueText(v: unknown, type?: string): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  if (type === 'FLOAT' && typeof v === 'number' && Number.isInteger(v)) return v.toFixed(1);
  return String(v);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** A time the slider sets, as the parameter it passes: `YYYY-MM-DDTHH:MM:SSZ` (milliseconds only when it has some). */
export function isoTime(ms: number): string {
  const d = new Date(ms);
  const base = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${base}${d.getUTCMilliseconds() ? `.${pad(d.getUTCMilliseconds(), 3)}` : ''}Z`;
}

// ---------------------------------------------------------------- the model

export interface Span {
  start: number;
  startText: string;
  /** null: open (no end yet). */
  end: number | null;
  endText: string;
}

export interface Mark {
  /** The row's index in the step's result. */
  row: number;
  lane: number;
  label: string;
  key: string;
  /** The first axis: a point (end undefined, no `end` column) or an interval. */
  start: number;
  startText: string;
  end: number | null | undefined;
  endText: string | null;
  /** The second, record-time axis of a bi-temporal row, or null. */
  record: Span | null;
}

export interface Lane {
  name: string;
  marks: number[];
}

export interface Model {
  cols: TimelineColumns;
  marks: Mark[];
  lanes: Lane[];
  /** Whether rows are intervals (an `end` column) and whether they carry a record-time pair. */
  intervals: boolean;
  bitemporal: boolean;
  /** The axis, padded; `first`/`last` are the earliest and latest values the rows hold, as the engine printed them. */
  min: number;
  max: number;
  first: string;
  last: string;
  /** Rows not drawn because their `start` is null. */
  skipped: number;
}

type Row = Record<string, unknown>;

/** Problems with a step's rows for these columns: a missing column, or a value in a time column that is not a temporal value. */
export function rowProblems(rows: Row[], columns: string[], cols: TimelineColumns): string[] {
  const out: string[] = [];
  for (const c of namedColumns(cols)) if (!columns.includes(c)) out.push(`the step returns no \`${c}\` column (it returns ${columns.map((x) => `\`${x}\``).join(', ') || 'no columns'})`);
  if (out.length) return out;
  for (const c of [cols.start, cols.end, cols.recordStart, cols.recordEnd]) {
    if (!c) continue;
    const bad = rows.find((r) => r[c] !== null && r[c] !== undefined && parseTime(r[c]) === null);
    if (bad) out.push(`the \`${c}\` column holds ${valueText(bad[c])}, which is not a date or datetime`);
  }
  if (!out.length && !rows.some((r) => parseTime(r[cols.start]) !== null)) out.push(`no row has a \`${cols.start}\` to draw`);
  return out;
}

/** The model of a step's rows, for a placement's columns; `extra` are times the axis must hold too (the slider's start). */
export function timelineModel(rows: Row[], cols: TimelineColumns, columnTypes: Record<string, string> = {}, extra: number[] = []): Model {
  const text = (r: Row, c: string) => valueText(r[c], columnTypes[c]);
  const intervals = !!cols.end;
  const bitemporal = !!(cols.recordStart && cols.recordEnd);
  const lanes: Lane[] = [];
  const marks: Mark[] = [];
  let skipped = 0;
  const times: { t: number; text: string }[] = [];
  const note = (v: unknown) => {
    const t = parseTime(v);
    if (t !== null) times.push({ t, text: valueText(v) });
    return t;
  };
  rows.forEach((r, row) => {
    const start = note(r[cols.start]);
    if (start === null) {
      skipped++;
      return;
    }
    const laneName = cols.lane ? text(r, cols.lane) : cols.label ? text(r, cols.label) : text(r, cols.start);
    let lane = cols.lane ? lanes.findIndex((l) => l.name === laneName) : -1;
    if (lane < 0) {
      lanes.push({ name: laneName, marks: [] });
      lane = lanes.length - 1;
    }
    const end = intervals ? note(r[cols.end!]) : undefined;
    let record: Span | null = null;
    if (bitemporal) {
      const rs = note(r[cols.recordStart!]);
      if (rs !== null) record = { start: rs, startText: text(r, cols.recordStart!), end: note(r[cols.recordEnd!]), endText: text(r, cols.recordEnd!) };
    }
    const label = cols.label ? text(r, cols.label) : text(r, cols.start);
    lanes[lane].marks.push(marks.length);
    marks.push({
      row,
      lane,
      label,
      key: cols.key ? text(r, cols.key) : label,
      start,
      startText: text(r, cols.start),
      end,
      endText: intervals ? text(r, cols.end!) : null,
      record,
    });
  });
  for (const l of lanes) l.marks.sort((a, b) => marks[a].start - marks[b].start || a - b);
  times.sort((a, b) => a.t - b.t);
  const lo = Math.min(...times.map((x) => x.t), ...extra);
  const hi = Math.max(...times.map((x) => x.t), ...extra);
  const span = hi - lo || HOUR;
  const open = marks.some((m) => m.end === null || m.record?.end === null);
  return {
    cols,
    marks,
    lanes,
    intervals,
    bitemporal,
    min: lo - span * 0.04,
    max: hi + span * (open ? 0.1 : 0.04),
    first: times[0]?.text ?? '',
    last: times.at(-1)?.text ?? '',
    skipped,
  };
}

// ---------------------------------------------------------------- words

/** What a page calls a runnable statement: a recipe's step, a docs page's cell. */
export type Noun = 'step' | 'cell';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const code = (s: string) => `\`${s}\``;

/** One mark in words, with the engine's values as returned (a mark's accessible name, and a line in the drawing's description). */
export function markText(model: Model, m: Mark): string {
  const c = model.cols;
  const who = c.lane ? `${model.lanes[m.lane].name}, ${c.label ? `${c.label} ${m.label}` : 'row'}` : m.label;
  const first = model.intervals ? `${c.start} ${m.startText}, ${c.end} ${m.endText}` : `${c.start} ${m.startText}`;
  const second = m.record ? `; ${c.recordStart} ${m.record.startText}, ${c.recordEnd} ${m.record.endText}` : '';
  return `${who}: ${first}${second}`;
}

/** What the drawing shows, in words: its screen-reader description. `step` names the cell drawn; `noun` is what the page calls it (a recipe's `step`, a docs page's `cell`). */
export function describe(model: Model, step: string, noun: Noun = 'step'): string {
  const c = model.cols;
  const head = `${plural(model.marks.length, 'row')} of the ${step} ${noun} on a time axis from ${model.first} to ${model.last}`;
  if (c.lane) {
    const lanes = model.lanes.map((l) => `${l.name} ${l.marks.length}`).join(', ');
    return `${head}, in ${plural(model.lanes.length, 'lane')} by ${c.lane}: ${lanes}.${model.skipped ? ` ${plural(model.skipped, 'row')} without ${c.start} not drawn.` : ''}`;
  }
  const axes = model.bitemporal
    ? `, each with its valid time (${c.start} to ${c.end}) above its record time (${c.recordStart} to ${c.recordEnd}); null is an open end`
    : model.intervals
      ? `, each from ${c.start} to ${c.end}; null is an open end`
      : '';
  const shown = model.marks.slice(0, 12).map((m) => markText(model, m));
  const more = model.marks.length > 12 ? `; and ${model.marks.length - 12} more` : '';
  return `${head}${axes}. ${shown.join('. ')}${more}.${model.skipped ? ` ${plural(model.skipped, 'row')} without ${c.start} not drawn.` : ''}`;
}

/** The compact table of the rows: one row per lane (its rows' labels in time order), or one per row with its times. */
export function compactTable(model: Model): { columns: string[]; rows: string[][] } {
  const c = model.cols;
  if (c.lane) {
    const name = c.label ?? c.start;
    return {
      columns: [c.lane, 'rows', name, `earliest ${c.start}`, `latest ${c.end ?? c.start}`],
      rows: model.lanes.map((l) => {
        const ms = l.marks.map((i) => model.marks[i]);
        const latest = ms.reduce((a, b) => ((b.end ?? b.start) > (a.end ?? a.start) ? b : a));
        return [l.name, String(ms.length), ms.map((m) => m.label).join(', '), ms[0].startText, (model.intervals ? latest.endText : latest.startText) ?? ''];
      }),
    };
  }
  const columns = [c.label ?? c.start, ...(c.label ? [c.start] : []), ...(c.end ? [c.end] : []), ...(model.bitemporal ? [c.recordStart!, c.recordEnd!] : [])];
  return {
    columns,
    rows: model.marks.map((m) => [
      m.label,
      ...(c.label ? [m.startText] : []),
      ...(c.end ? [m.endText ?? 'null'] : []),
      ...(model.bitemporal ? [m.record?.startText ?? 'null', m.record?.endText ?? 'null'] : []),
    ]),
  };
}

/** The static form's opening sentence, in markdown. */
export function staticIntro(model: Model, step: string, noun: Noun = 'step'): string {
  const c = model.cols;
  const rows = plural(model.marks.length, 'row');
  const skipped = model.skipped ? ` ${plural(model.skipped, 'row')} without \`${c.start}\` ${model.skipped === 1 ? 'is' : 'are'} not drawn.` : '';
  if (c.lane) return `The ${code(step)} ${noun}'s recorded rows on a time axis: ${rows} in ${plural(model.lanes.length, 'lane')} by ${code(c.lane)}, from ${model.first} to ${model.last}.${skipped}`;
  if (model.bitemporal) {
    return `The ${code(step)} ${noun}'s recorded rows, ${rows}, each on its valid time (${code(c.start)} to ${code(c.end!)}) and its record time (${code(c.recordStart!)} to ${code(c.recordEnd!)}); \`null\` is an open end.${skipped}`;
  }
  if (model.intervals) return `The ${code(step)} ${noun}'s recorded rows, ${rows}, each from ${code(c.start)} to ${code(c.end!)}; \`null\` is an open end.${skipped}`;
  return `The ${code(step)} ${noun}'s recorded rows on a time axis: ${rows}, from ${model.first} to ${model.last}.${skipped}`;
}

// ---------------------------------------------------------------- the as-of step

/** The values of `column` over a result's rows, lists flattened, as the timeline prints them: the keys of the rows it names. */
export function namedKeys(rows: Row[], column: string): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const v = r[column];
    for (const x of Array.isArray(v) ? v : [v]) if (x !== null && x !== undefined) out.add(valueText(x));
  }
  return out;
}

/** The as-of parameter a data block holds: its time (a string, or a list's first string) and whether it is a list. */
export function authoredTime(params: string | null | undefined, param: string): { t: number | null; list: boolean } {
  try {
    const v = (JSON.parse(params ?? '') as Record<string, unknown>)[param];
    const first = Array.isArray(v) ? v[0] : v;
    return { t: parseTime(first), list: Array.isArray(v) };
  } catch {
    return { t: null, list: false };
  }
}

/**
 * The parameters the slider runs the as-of step with: its own (as the reader
 * may have edited them), the keys it shares with the drawn step taking the
 * drawn step's values (so it asks about what is drawn), and `param` set to
 * the time `t` (inside a list when the step takes a list). Null when the
 * as-of step's parameters are not a JSON object.
 */
export function asOfParams(own: string | null, drawn: string | null, param: string, t: number, list: boolean): string | null {
  let base: Record<string, unknown>;
  try {
    base = JSON.parse(own ?? '') as Record<string, unknown>;
    if (!base || typeof base !== 'object' || Array.isArray(base)) return null;
  } catch {
    return null;
  }
  try {
    const d = JSON.parse(drawn ?? '') as Record<string, unknown>;
    if (d && typeof d === 'object' && !Array.isArray(d)) for (const k of Object.keys(d)) if (k in base && k !== param) base[k] = d[k];
  } catch {
    // the drawn step takes no parameters: nothing to share
  }
  base[param] = list ? [isoTime(t)] : isoTime(t);
  return JSON.stringify(base);
}

const SLIDER_UNITS = [SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

/** The slider's stops over the axis: one every `unit`, anchored on the authored time so it is always a stop. */
export function sliderStops(min: number, max: number, anchor: number): { unit: number; first: number; count: number } {
  const unit = SLIDER_UNITS.find((u) => (max - min) / u <= 80) ?? 7 * DAY;
  const first = anchor - Math.floor((anchor - min) / unit) * unit;
  return { unit, first, count: Math.max(1, Math.floor((max - first) / unit) + 1) };
}

// ---------------------------------------------------------------- the axis

const TICK_UNITS = [SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 28 * DAY, 91 * DAY, 364 * DAY];

export interface Tick {
  t: number;
  text: string;
  /** The date under a time-of-day label, where the date changes (and on the first tick). */
  date: string | null;
}

const dayText = (d: Date) => `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** About `target` ticks between min and max, in UTC: dates for a day or more, else times of day with the date where it changes. */
export function ticks(min: number, max: number, target: number): Tick[] {
  const unit = TICK_UNITS.find((u) => (max - min) / u <= target) ?? TICK_UNITS.at(-1)!;
  const out: Tick[] = [];
  let lastDay = '';
  for (let t = Math.ceil(min / unit) * unit; t <= max; t += unit) {
    const d = new Date(t);
    if (unit >= DAY) {
      out.push({ t, text: dayText(d), date: null });
      continue;
    }
    const day = dayText(d);
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${unit < MINUTE ? `:${pad(d.getUTCSeconds())}` : ''}`;
    out.push({ t, text: time, date: day !== lastDay ? day : null });
    lastDay = day;
  }
  return out;
}

// ---------------------------------------------------------------- the drawing

export interface DrawOptions {
  width: number;
  /** The time the slider is at, drawn as a line, or null. */
  t?: number | null;
  /** Keys of the rows the as-of step names on the first axis, and on the record axis; null draws every row plain. */
  matched?: Set<string> | null;
  matchedRecord?: Set<string> | null;
  /** Marks get a tabindex and an accessible name (the live drawing). `focus` is the mark that takes Tab. */
  interactive?: boolean;
  focus?: number;
}

export const LABEL_CHAR_PX = 6.6;

/** The drawing's SVG body (classes, no colours: the static form styles them from the tokens, the page from its CSS), its height and its lane label column. */
export function drawTimeline(model: Model, o: DrawOptions): { body: string; height: number; left: number; right: number } {
  const W = o.width;
  const longest = Math.max(...model.lanes.map((l) => l.name.length), 4);
  const labelW = Math.min(200, Math.max(56, Math.round(longest * LABEL_CHAR_PX + 12)));
  const maxChars = Math.floor((labelW - 12) / LABEL_CHAR_PX);
  const left = labelW + 10;
  const right = W - 18;
  const legend = model.bitemporal ? 22 : 0;
  const tRow = o.t !== undefined && o.t !== null ? 20 : 4;
  const top = legend + tRow;
  const laneH = model.bitemporal ? 38 : 26;
  const axisY = top + model.lanes.length * laneH;
  const height = axisY + 40;
  const x = (t: number) => left + ((t - model.min) / (model.max - model.min || 1)) * (right - left);
  const f = (n: number) => n.toFixed(1);
  const parts: string[] = [];

  if (model.bitemporal) {
    parts.push(
      `<rect class="tl-valid" x="${left}" y="5" width="18" height="9" rx="2"/><text class="tl-note" x="${left + 24}" y="10" dy="0.35em">valid time: ${esc(model.cols.start)} to ${esc(model.cols.end!)}</text>`,
    );
    const lx = left + 34 + Math.round((14 + model.cols.start.length + model.cols.end!.length) * 6.2);
    parts.push(
      `<rect class="tl-record" x="${lx}" y="5" width="18" height="9" rx="2"/><text class="tl-note" x="${lx + 24}" y="10" dy="0.35em">record time: ${esc(model.cols.recordStart!)} to ${esc(model.cols.recordEnd!)}</text>`,
    );
  }

  // Lanes: a band every other lane, the lane's name at the left.
  model.lanes.forEach((l, i) => {
    const y = top + i * laneH;
    if (i % 2 === 0) parts.push(`<rect class="tl-band" x="0" y="${y}" width="${W}" height="${laneH}"/>`);
    const name = l.name.length > maxChars ? `${l.name.slice(0, maxChars - 1)}…` : l.name;
    parts.push(`<text class="tl-lane" x="${labelW}" y="${y + laneH / 2}" dy="0.35em"><title>${esc(l.name)}</title>${esc(name)}</text>`);
  });

  // The grid and the axis.
  const tk = ticks(model.min, model.max, Math.max(2, Math.floor((right - left) / 110)));
  for (const t of tk) {
    const tx = f(x(t.t));
    parts.push(`<line class="tl-grid" x1="${tx}" y1="${top}" x2="${tx}" y2="${axisY + 4}"/>`);
    parts.push(`<text class="tl-tick" x="${tx}" y="${axisY + 16}">${esc(t.text)}</text>`);
    if (t.date) parts.push(`<text class="tl-tick tl-date" x="${tx}" y="${axisY + 30}">${esc(t.date)}</text>`);
  }
  parts.push(`<line class="tl-axis" x1="${left}" y1="${axisY}" x2="${right}" y2="${axisY}"/>`);
  parts.push(`<text class="tl-note" x="${labelW}" y="${axisY + 16}" text-anchor="end">UTC</text>`);

  // The marks.
  const cls = (set: Set<string> | null | undefined, key: string, on: string, off: string) => (set ? (set.has(key) ? ` ${on}` : ` ${off}`) : '');
  const bar = (klass: string, x1: number, x2: number | null, y: number, h: number) => {
    if (x2 !== null && x2 - x1 < 2) {
      // An empty interval (end = start): a diamond on its start.
      return `<path class="${klass} tl-empty" d="M${f(x1)} ${f(y - 1.5)}l${f(h / 2 + 1.5)} ${f(h / 2 + 1.5)}l${f(-(h / 2 + 1.5))} ${f(h / 2 + 1.5)}l${f(-(h / 2 + 1.5))} ${f(-(h / 2 + 1.5))}z"/>`;
    }
    const end = x2 ?? right;
    const open = x2 === null ? `<path class="${klass} tl-open" d="M${f(end)} ${f(y - 2)}l6 ${f(h / 2 + 2)}l-6 ${f(h / 2 + 2)}z"/>` : '';
    return `<rect class="${klass}" x="${f(x1)}" y="${f(y)}" width="${f(Math.max(2, end - x1))}" height="${h}" rx="2"/>${open}`;
  };
  model.marks.forEach((m, i) => {
    const y = top + m.lane * laneH;
    const on = cls(o.matched, m.key, 'is-on', 'is-off');
    const ron = m.record ? cls(o.matchedRecord, m.key, 'is-ron', 'is-roff') : '';
    const attrs = o.interactive
      ? ` data-i="${i}" data-lane="${m.lane}" data-key="${esc(m.key)}" tabindex="${i === (o.focus ?? 0) ? 0 : -1}" role="img" aria-label="${esc(markText(model, m))}"`
      : '';
    let shape: string;
    if (!model.intervals) {
      shape = `<circle class="tl-point" cx="${f(x(m.start))}" cy="${f(y + laneH / 2)}" r="4.5"/>`;
    } else if (model.bitemporal) {
      shape =
        bar('tl-valid', x(m.start), m.end === null ? null : x(m.end!), y + 7, 10) +
        (m.record ? bar('tl-record', x(m.record.start), m.record.end === null ? null : x(m.record.end), y + 22, 10) : '');
    } else {
      shape = bar('tl-valid', x(m.start), m.end === null ? null : x(m.end!), y + laneH / 2 - 5, 10);
    }
    parts.push(`<g class="tl-mark${on}${ron}"${attrs}>${o.interactive ? '' : `<title>${esc(markText(model, m))}</title>`}${shape}</g>`);
  });

  // The slider's time.
  if (o.t !== undefined && o.t !== null) {
    const tx = x(o.t);
    const anchor = tx > right - 90 ? 'end' : tx < left + 90 ? 'start' : 'middle';
    parts.push(`<line class="tl-now" x1="${f(tx)}" y1="${top - 4}" x2="${f(tx)}" y2="${axisY}"/>`);
    parts.push(`<text class="tl-now-label" x="${f(tx)}" y="${legend + 10}" dy="0.35em" text-anchor="${anchor}">${esc(isoTime(o.t))}</text>`);
  }
  return { body: parts.join(''), height, left, right };
}

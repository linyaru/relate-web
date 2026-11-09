// `:::timeline{cell=… start=… [end=…] [record-start=… record-end=…] [lane=…] [label=…] [asof=… param=… match=… [match-record=…] [key=…]]}`:
// the timeline view (DOCS-PLAN.md §7.3, ADR-0051). It draws a step's rows on
// a time axis: point events in lanes (a trajectory's steps by kind), or
// intervals with an open end where the end is null (a fact's valid time), and
// for bi-temporal rows a second, record-time bar under each. Every column is
// named by an attribute, never guessed:
//   cell          the step drawn (its recorded rows are the static form; a live run of it redraws)
//   start         the time each row happens or starts (a DATE or DATETIME column)
//   end           where each row ends; null is an open end (optional: without it rows are points)
//   record-start, record-end   the record-time pair of a bi-temporal row (optional, both or neither, with `end`)
//   lane          rows sharing its value share a lane (optional: without it each row is a lane)
//   label         what names a row (required without `lane`)
//   asof          a step the page already runs that asks what holds at a time (optional); its
//     param       parameter the slider sets to its time (a string, or a list of them),
//     match       the result column naming the rows it returns for that time on the first axis,
//     match-record  the one naming the rows on the record axis (optional, bi-temporal), and
//     key         the drawn step's column those names are (default: `label`)
//
// Static form: a sentence and a compact table of the recorded rows (one row
// per lane, or per row with its times, printed as the engine returned them),
// then the drawing, light and dark. The model and the drawing are shared
// with the browser module (_timeline-model.ts).

import { bothThemes, markdownTable, mix, siteTokens, svgFrame } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import {
  authoredTime,
  columnsOf,
  compactTable,
  describe,
  drawTimeline,
  rowProblems,
  staticIntro,
  timelineModel,
  type Noun,
} from './_timeline-model.ts';

const ATTRIBUTES = new Set(['id', 'cell', 'start', 'end', 'record-start', 'record-end', 'lane', 'label', 'key', 'asof', 'param', 'match', 'match-record']);
const ASOF_ONLY = ['param', 'match', 'match-record', 'key'];

interface Envelope {
  columns?: string[];
  columnTypes?: string[];
  rows?: Record<string, unknown>[];
  error?: string | null;
}

const envelopeOf = (input: ElementInput, id: string | undefined): Envelope | null => (id ? ((input.recordings[id]?.envelope as Envelope | null | undefined) ?? null) : null);
const cellOf = (input: ElementInput, id: string | undefined) => (id ? input.cells.find((c) => c.id === id) : undefined);
const typesOf = (env: Envelope): Record<string, string> => Object.fromEntries((env.columns ?? []).map((c, i) => [c, env.columnTypes?.[i] ?? '']));

/** The as-of step's authored time, which the axis holds and the slider starts at. */
function asOfStart(input: ElementInput): number[] {
  const a = input.attributes;
  const block = a.asof ? cellOf(input, a.asof)?.params : null;
  const t = block && a.param ? authoredTime(input.dataBlocks[block], a.param).t : null;
  return t === null ? [] : [t];
}

/** What the page calls the statement it draws: a recipe's step (ADR-0045), a docs page's cell. */
const nounOf = (input: ElementInput): Noun => (input.page.id.startsWith('cookbook/') ? 'step' : 'cell');

/** The drawing's width in the static form (its viewBox; it scales down with the column). */
const WIDTH = 720;

export default {
  // The as-of slider is optional, so the sentence names it as the page may have it.
  live: 'the drawing reads its rows again from each run of the statement it draws on the page\'s database in your browser, so an edit to the statement or its parameters redraws it; Tab reaches the marks and the arrow keys move along a lane and between lanes, each mark read out with its values; where the page names an as-of statement, a time slider runs that statement again with the time as its parameter and lights up the rows it returns.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes ${[...ATTRIBUTES].filter((x) => x !== 'id').map((x) => `\`${x}\``).join(', ')} and \`id\`, not \`${k}\``);
    if (!a.cell) out.push('needs `cell=<step id>`, the step whose rows it draws');
    else if (!cellOf(input, a.cell)) out.push(`\`cell\` names \`${a.cell}\`, which is not a cell on the page`);
    if (!a.start) out.push('needs `start=<column>`, the time each row happens or starts');
    if (!!a['record-start'] !== !!a['record-end']) out.push('`record-start` and `record-end` come together: the record-time pair');
    if (a['record-start'] && !a.end) out.push('a record-time pair draws under an interval: give `end` too');
    if (!a.label && !a.lane) out.push('needs `label=<column>` (what names a row), or `lane=<column>`');
    if (!a.asof) for (const k of ASOF_ONLY) if (a[k]) out.push(`\`${k}\` belongs to an as-of step: give \`asof=<step id>\` too`);
    if (a.asof) {
      if (!a.param) out.push('`asof` needs `param=<name>`, the parameter the slider sets to its time');
      if (!a.match) out.push('`asof` needs `match=<column>`, the result column naming the rows it returns');
      if (a['match-record'] && !a['record-start']) out.push('`match-record` lights the record axis: give `record-start` and `record-end` too');
      if (!cellOf(input, a.asof)) out.push(`\`asof\` names \`${a.asof}\`, which is not a cell on the page`);
    }
    if (out.length) return out;

    const env = envelopeOf(input, a.cell);
    if (!env || env.error) return [`the \`${a.cell}\` cell's recording is ${env?.error ? `an error (${env.error})` : 'missing'} (record the page)`];
    const cols = columnsOf(a);
    out.push(...rowProblems(env.rows ?? [], env.columns ?? [], cols).map((p) => p.replace('the step', `the \`${a.cell}\` step`)));

    if (a.asof) {
      const asof = cellOf(input, a.asof)!;
      const block = asof.params ? input.dataBlocks[asof.params] : undefined;
      if (!block) out.push(`the \`${a.asof}\` step takes its parameters from no data block; the slider sets \`${a.param}\` in one`);
      else if (authoredTime(block, a.param).t === null) out.push(`the \`${a.asof}\` step's data block has no \`${a.param}\` holding a date or datetime (or a list starting with one)`);
      if (!new RegExp(`\\$${a.param.replace(/[^\w]/g, '')}\\b`).test(asof.code)) out.push(`the \`${a.asof}\` step does not use \`$${a.param}\``);
      const res = envelopeOf(input, a.asof);
      if (!res || res.error) out.push(`the \`${a.asof}\` step's recording is ${res?.error ? 'an error' : 'missing'} (record the page)`);
      else for (const k of ['match', 'match-record']) if (a[k] && !res.columns?.includes(a[k])) out.push(`the \`${a.asof}\` step returns no \`${a[k]}\` column`);
    }
    return out;
  },
  staticForm(input) {
    const a = input.attributes;
    const env = envelopeOf(input, a.cell)!;
    const model = timelineModel(env.rows ?? [], columnsOf(a), typesOf(env), asOfStart(input));
    const noun = nounOf(input);
    const table = compactTable(model);
    const text = [staticIntro(model, a.cell, noun), markdownTable(table.columns, table.rows)].join('\n\n');
    const caption = model.bitemporal
      ? `The ${a.cell} ${noun}'s rows on both time axes, as recorded`
      : `The ${a.cell} ${noun}'s rows on a time axis, as recorded`;
    const tokens = siteTokens();
    const pictures = bothThemes((theme, c) => {
      const id = `${input.id}-${theme}`;
      const { body, height } = drawTimeline(model, { width: WIDTH });
      const record = tokens[theme]['--discovery'];
      const style =
        `#${id} .tl-band{fill:${c.node};fill-opacity:0.55}` +
        `#${id} .tl-lane{text-anchor:end;font-size:12px;fill:${c.fg}}` +
        `#${id} .tl-tick{text-anchor:middle;font-size:11px;fill:${c.fgMuted}}` +
        `#${id} .tl-note{font-size:11px;fill:${c.fgMuted}}` +
        `#${id} .tl-grid{stroke:${c.rule};stroke-width:1}` +
        `#${id} .tl-axis{stroke:${c.line};stroke-width:1}` +
        `#${id} .tl-point{fill:${c.flow.accent.stroke};stroke:${c.fg};stroke-width:1}` +
        `#${id} .tl-valid{fill:${c.flow.accent.fill};stroke:${c.flow.accent.stroke};stroke-width:1.5}` +
        `#${id} .tl-record{fill:${mix(record, c.surface, 0.22)};stroke:${record};stroke-width:1.5}` +
        `#${id} .tl-open{stroke:none}#${id} .tl-valid.tl-open{fill:${c.flow.accent.stroke}}#${id} .tl-record.tl-open{fill:${record}}` +
        `#${id} .tl-empty{fill:${c.surface};stroke-width:2}`;
      return svgFrame({ id, width: WIDTH, height, title: caption, desc: describe(model, a.cell, noun), style, body });
    });
    return { text, caption, ...pictures };
  },
} satisfies ElementSpec;

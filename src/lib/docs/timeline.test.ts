// Tests for `:::timeline`'s build side (src/lib/docs/elements/timeline.ts) and
// the model both it and the browser module draw from
// (src/lib/docs/elements/_timeline-model.ts): parsing the engine's temporal
// strings, the model's lanes and open ends, the compact table printing values
// as returned, the as-of parameters, the slider's grid and the axis, and what
// validate refuses, on the model-agent-memory guide's own cells and
// recordings.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import timeline from './elements/timeline.ts';
import type { ElementInput } from './elements.ts';
import type { PageCell, RecordedCell } from './results.ts';
import {
  asOfParams,
  authoredTime,
  columnsOf,
  compactTable,
  describe,
  drawTimeline,
  isoTime,
  namedKeys,
  parseTime,
  rowProblems,
  sliderStops,
  ticks,
  timelineModel,
  DAY,
} from './elements/_timeline-model.ts';

const PAGE = new URL('../../content/docs/guides/agents/model-agent-memory.mdx', import.meta.url);
const RESULTS = new URL('../../content/docs/guides/agents/model-agent-memory.results.json', import.meta.url);

const ATTRS = {
  cell: 'slot-facts', label: 'fact', start: 'validFrom', end: 'validTo', 'record-start': 'recordedAt', 'record-end': 'closedAt',
  asof: 'asof', param: 'on', match: 'trueOn', 'match-record': 'believedOn',
};

/** The guide's cells, data blocks and recordings, as the element registry hands them over. */
function pageInput(attributes: Record<string, string> = ATTRS): ElementInput {
  const src = readFileSync(PAGE, 'utf8');
  const cells: PageCell[] = [];
  for (const m of src.matchAll(/```cypher run([^\n]*)\n([\s\S]*?)\n```/g)) {
    const name = /\bname=([\w-]+)/.exec(m[1])?.[1] ?? null;
    if (!name) continue;
    cells.push({ id: name, name, code: m[2], params: /\bparams=([\w-]+)/.exec(m[1])?.[1] ?? null, expectError: false, index: cells.length + 1, title: null, line: null });
  }
  const dataBlocks: Record<string, string> = {};
  for (const m of src.matchAll(/```json data=([\w-]+)\n([\s\S]*?)\n```/g)) dataBlocks[m[1]] = m[2];
  const recordings = (JSON.parse(readFileSync(RESULTS, 'utf8')) as { cells: Record<string, RecordedCell> }).cells;
  return { name: 'timeline', id: 'timeline-1', attributes, children: '', page: { id: 'guides/agents/model-agent-memory', file: PAGE.pathname }, cells, dataBlocks, recordings };
}

const rowsOf = (input: ElementInput, id: string) => (input.recordings[id].envelope as { rows: Record<string, unknown>[] }).rows;

test('parseTime reads the engine\'s temporal strings, and nothing else', () => {
  assert.equal(parseTime('2024-01-07T00:00:00Z'), Date.UTC(2024, 0, 7));
  assert.equal(parseTime('2024-01-07T00:10:58.53Z'), Date.UTC(2024, 0, 7, 0, 10, 58, 530));
  assert.equal(parseTime('2024-01-07T00:41:14.04Z'), Date.UTC(2024, 0, 7, 0, 41, 14, 40));
  assert.equal(parseTime('2024-01-07T02:00:00+02:00'), Date.UTC(2024, 0, 7));
  assert.equal(parseTime('2024-01-07T00:00:00-0130'), Date.UTC(2024, 0, 7, 1, 30));
  assert.equal(parseTime('2024-01-07T00:00Z'), Date.UTC(2024, 0, 7));
  assert.equal(parseTime('2024-01-05'), Date.UTC(2024, 0, 5));
  assert.equal(parseTime('2024-01-05T09:00:00'), Date.UTC(2024, 0, 5, 9), 'a LOCAL DATETIME reads as UTC');
  assert.equal(parseTime('0024-01-05'), new Date('0024-01-05T00:00:00Z').getTime(), 'a year below 100 is that year');
  for (const v of [null, 1704585600000, 'yesterday', '2024-1-5', '', ['2024-01-05']]) assert.equal(parseTime(v), null, JSON.stringify(v));
});

test('isoTime prints the slider\'s parameter, with milliseconds only when it has some', () => {
  assert.equal(isoTime(Date.UTC(2026, 2, 15)), '2026-03-15T00:00:00Z');
  assert.equal(isoTime(Date.UTC(2024, 0, 7, 0, 38, 0, 391)), '2024-01-07T00:38:00.391Z');
  assert.equal(parseTime(isoTime(1704588074040)), 1704588074040);
});

test('the guide\'s placement validates, and its static form prints the recorded values as the engine returned them', async () => {
  const input = pageInput();
  assert.deepEqual(timeline.validate!(input), []);
  const form = await timeline.staticForm(input);
  assert.match(form.text, /^The `slot-facts` cell's recorded rows, 2 rows, each on its valid time/);
  assert.match(form.text, /\| Grace reviews each relate release\. \| 2026-01-05T00:00:00Z \| 2026-03-10T00:00:00Z \| 2026-03-02T10:00:00Z \| 2026-03-20T09:00:00Z \|/);
  assert.match(form.text, /\| Ada reviews each relate release\. \| 2026-03-10T00:00:00Z \| null \| 2026-03-20T09:00:00Z \| null \|/);
  assert.ok(form.svgLight && form.svgDark && form.caption, 'a picture in both themes, with a caption');
  assert.doesNotMatch(form.svgLight!.replace(/<style>[\s\S]*?<\/style>/, ''), /#[0-9A-Fa-f]{6}\b/, 'colours only in the style, from the tokens');
  assert.match(form.svgLight!, /<desc[^>]*>2 rows of the slot-facts cell on a time axis from 2026-01-05T00:00:00Z to 2026-03-20T09:00:00Z/);
});

test('the model: one lane per row without `lane`, open ends, and the axis holding the authored time', () => {
  const input = pageInput();
  const cols = columnsOf(input.attributes);
  const t = authoredTime(input.dataBlocks.asof, 'on');
  assert.deepEqual(t, { t: Date.UTC(2026, 2, 15), list: false });
  const model = timelineModel(rowsOf(input, 'slot-facts'), cols, {}, [t.t!]);
  assert.equal(model.lanes.length, 2);
  assert.ok(model.bitemporal && model.intervals);
  const [grace, ada] = model.marks;
  assert.equal(grace.end, Date.UTC(2026, 2, 10));
  assert.equal(ada.end, null, 'a null validTo is an open end');
  assert.equal(ada.record?.end, null);
  assert.equal(ada.key, 'Ada reviews each relate release.', 'the key defaults to the label');
  assert.ok(model.min < Date.UTC(2026, 0, 5) && model.max > Date.UTC(2026, 2, 20));
  assert.equal(model.first, '2026-01-05T00:00:00Z');
  assert.equal(model.last, '2026-03-20T09:00:00Z');
  const text = describe(model, 'slot-facts', 'cell');
  assert.match(text, /Ada reviews each relate release\.: validFrom 2026-03-10T00:00:00Z, validTo null; recordedAt 2026-03-20T09:00:00Z, closedAt null/);
});

test('lanes: rows sharing a value share a lane, and the compact table has a row per lane', () => {
  const rows = [
    { seq: 0, kind: 'system', at: '2024-01-07T00:00:00Z' },
    { seq: 1, kind: 'plan', at: '2024-01-07T00:01:14.647Z' },
    { seq: 2, kind: 'tool_call', at: '2024-01-07T00:02:32.928Z' },
    { seq: 4, kind: 'plan', at: '2024-01-07T00:04:48.677Z' },
    { seq: 9, kind: 'plan', at: null },
  ];
  const model = timelineModel(rows, columnsOf({ start: 'at', lane: 'kind', label: 'seq' }));
  assert.deepEqual(model.lanes.map((l) => l.name), ['system', 'plan', 'tool_call']);
  assert.equal(model.skipped, 1, 'a row without a start is not drawn');
  assert.ok(!model.intervals);
  const table = compactTable(model);
  assert.deepEqual(table.columns, ['kind', 'rows', 'seq', 'earliest at', 'latest at']);
  assert.deepEqual(table.rows[1], ['plan', '2', '1, 4', '2024-01-07T00:01:14.647Z', '2024-01-07T00:04:48.677Z']);
  const { body } = drawTimeline(model, { width: 600, interactive: true, focus: 1 });
  assert.equal([...body.matchAll(/class="tl-mark"/g)].length, 4);
  assert.equal([...body.matchAll(/tabindex="0"/g)].length, 1, 'one mark takes Tab');
  assert.match(body, /aria-label="plan, seq 4: at 2024-01-07T00:04:48\.677Z"/);
});

test('lit rows: the as-of result\'s values, lists flattened, mark rows by their key', () => {
  const input = pageInput();
  const model = timelineModel(rowsOf(input, 'slot-facts'), columnsOf(input.attributes));
  const asof = rowsOf(input, 'asof');
  const holds = namedKeys(asof, 'trueOn');
  const believed = namedKeys(asof, 'believedOn');
  assert.deepEqual([...holds], ['Ada reviews each relate release.']);
  assert.deepEqual([...believed], ['Grace reviews each relate release.']);
  const { body } = drawTimeline(model, { width: 600, t: Date.UTC(2026, 2, 15), matched: holds, matchedRecord: believed });
  assert.match(body, /class="tl-mark is-off is-ron"/, 'Grace: not true on 15 March, but believed');
  assert.match(body, /class="tl-mark is-on is-roff"/, 'Ada: true on 15 March, not yet believed');
  assert.match(body, /class="tl-now-label"[^>]*>2026-03-15T00:00:00Z</);
  assert.deepEqual([...namedKeys([{ seq: 37 }, { seq: 38 }], 'seq')], ['37', '38']);
});

test('asOfParams: the step\'s own parameters, shared keys from the drawn step, and the time (in a list when it takes one)', () => {
  const t = Date.UTC(2024, 0, 20);
  assert.equal(
    asOfParams('{"entity": "orders", "dates": ["2024-01-05T00:00:00Z", "2024-01-20T00:00:00Z"]}', '{"entity": "search"}', 'dates', t, true),
    '{"entity":"search","dates":["2024-01-20T00:00:00Z"]}',
  );
  assert.equal(asOfParams('{"sid": "s1", "since": "2024-01-07T00:38:00Z"}', '{"sid": "s2", "n": 3}', 'since', t, false), '{"sid":"s2","since":"2024-01-20T00:00:00Z"}', 'a key only the drawn step has is not added');
  assert.equal(asOfParams('{"on": "x"}', null, 'on', t, false), '{"on":"2024-01-20T00:00:00Z"}');
  assert.equal(asOfParams('[1]', null, 'on', t, false), null);
  assert.equal(asOfParams(null, null, 'on', t, false), null);
});

test('the slider\'s grid is anchored on the authored time; the axis ticks print UTC', () => {
  const anchor = Date.UTC(2024, 0, 7, 0, 38);
  const s = sliderStops(Date.UTC(2024, 0, 6, 23, 58, 20), Date.UTC(2024, 0, 7, 0, 43), anchor);
  assert.equal(s.unit, 60_000);
  assert.equal((anchor - s.first) % s.unit, 0, 'the authored time is a stop');
  assert.ok(s.first >= Date.UTC(2024, 0, 6, 23, 58, 20) && s.first + (s.count - 1) * s.unit <= Date.UTC(2024, 0, 7, 0, 43));
  assert.equal(sliderStops(Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 15), Date.UTC(2024, 0, 5)).unit, DAY);
  const tk = ticks(Date.UTC(2024, 0, 6, 23, 58), Date.UTC(2024, 0, 7, 0, 43), 5);
  assert.deepEqual(tk.map((t) => t.text), ['00:00', '00:10', '00:20', '00:30', '00:40']);
  assert.equal(tk[0].date, '2024-01-07');
  assert.equal(tk[1].date, null);
  assert.ok(ticks(Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 15), 5).every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.text) && t.date === null));
});

test('validate refuses what the timeline cannot draw', () => {
  const v = (a: Record<string, string>) => timeline.validate!(pageInput(a));
  assert.ok(v({ ...ATTRS, colour: 'red' }).some((p) => /not `colour`/.test(p)));
  assert.ok(v({ start: 'validFrom', label: 'fact' }).some((p) => /needs `cell=/.test(p)));
  assert.ok(v({ cell: 'nope', start: 'validFrom', label: 'fact' }).some((p) => /not a cell on the page/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'validFrom' }).some((p) => /needs `label=/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'validFrom', label: 'fact', 'record-start': 'recordedAt' }).some((p) => /come together/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'validFrom', label: 'fact', 'record-start': 'recordedAt', 'record-end': 'closedAt' }).some((p) => /give `end` too/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'validFrom', label: 'fact', match: 'trueOn' }).some((p) => /belongs to an as-of step/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'when', label: 'fact' }).some((p) => /returns no `when` column/.test(p)));
  assert.ok(v({ cell: 'slot-facts', start: 'fact', label: 'fact' }).some((p) => /is not a date or datetime/.test(p)));
  assert.ok(v({ ...ATTRS, param: 'slot' }).some((p) => /no `slot` holding a date/.test(p)));
  assert.ok(v({ ...ATTRS, match: 'nope' }).some((p) => /returns no `nope` column/.test(p)));
  assert.ok(v({ ...ATTRS, asof: 'slot-facts' }).some((p) => /does not use `\$on`|no `on` holding/.test(p)));
  assert.deepEqual(rowProblems([{ a: '2024-01-01' }], ['a'], columnsOf({ start: 'a', label: 'b' })), ['the step returns no `b` column (it returns `a`)']);
});

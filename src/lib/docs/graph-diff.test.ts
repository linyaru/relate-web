// Tests for `:::graph-diff`'s model (src/lib/docs/elements/_graph-diff-model.ts):
// reading graph states from result rows, matching by a key property rather
// than element ids, classifying nodes, relationships and property changes,
// the table of changes, and the layout both the picture and the live view use.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changeRows,
  countsOf,
  diffGraphs,
  graphFromRows,
  layoutDiff,
  markedCaption,
  markedType,
  STATUS_STYLE,
  summaryText,
  type GraphState,
} from './elements/_graph-diff-model.ts';

const node = (id: number, labels: string[], properties: Record<string, unknown>) => ({ id, kind: 'node', labels, properties });
const rel = (id: number, type: string, start: number, end: number, properties: Record<string, unknown> = {}) => ({ id, kind: 'relationship', type, start_node: start, end_node: end, properties });

test('graphFromRows finds nodes and relationships anywhere in the rows, each once', () => {
  const org = node(53, ['Organization'], { id: 'org-11', name: 'Nimbus Labs' });
  const city = node(7, ['City'], { id: 'sf', name: 'San Francisco' });
  const rows = [
    { o: org, r: rel(284, 'IN_CITY', 53, 7), x: city },
    { o: org, r: null, x: node(9, ['City'], { id: 'boston', name: 'Boston' }) },
    { list: [city, { nested: org }], path: { nodes: [org], relationships: [rel(284, 'IN_CITY', 53, 7)] } },
  ];
  const g = graphFromRows(rows);
  assert.deepEqual(g.nodes.map((n) => n.id).sort((a, b) => a - b), [7, 9, 53]);
  assert.deepEqual(g.rels.map((r) => r.id), [284]);
  assert.deepEqual(graphFromRows(null), { nodes: [], rels: [] });
});

test('identity is the key property, not the element id', () => {
  // The same graph with every element id different, as a second store would number it.
  const a: GraphState = graphFromRows([{ o: node(1, ['Org'], { id: 'o', name: 'O' }), r: rel(10, 'IN', 1, 2), c: node(2, ['City'], { id: 'c', name: 'C' }) }]);
  const b: GraphState = graphFromRows([{ o: node(51, ['Org'], { id: 'o', name: 'O' }), r: rel(910, 'IN', 51, 52), c: node(52, ['City'], { id: 'c', name: 'C' }) }]);
  const diff = diffGraphs(a, b, 'id');
  assert.deepEqual(countsOf(diff.nodes), { removed: 0, added: 0, changed: 0, unchanged: 2 });
  assert.deepEqual(countsOf(diff.rels), { removed: 0, added: 0, changed: 0, unchanged: 1 });
  assert.deepEqual(changeRows(diff), []);
  assert.deepEqual(diff.problems, []);
});

test('a migration: a renamed type, a property added and removed, lost links, a new node', () => {
  const before = graphFromRows([
    { n: node(1, ['Org'], { id: 'o1', name: 'Nimbus', summary: 'old' }) },
    { n: node(2, ['Person'], { id: 'p1', name: 'Kavya' }) },
    { n: node(3, ['City'], { id: 'c1', name: 'Austin' }) },
    { n: node(4, ['City'], { id: 'c2', name: 'Berlin' }) },
    { r: rel(10, 'HAS_CEO', 1, 2) },
    { r: rel(11, 'IN_CITY', 1, 3) },
    { r: rel(12, 'IN_CITY', 1, 4) },
    { n: node(5, ['City'], { id: 'gone', name: 'Gone' }) },
  ]);
  const after = graphFromRows([
    { n: node(1, ['Org'], { id: 'o1', name: 'Nimbus', industry: 'Software' }) },
    { n: node(2, ['Person'], { id: 'p1', name: 'Kavya' }) },
    { n: node(3, ['City'], { id: 'c1', name: 'Austin' }) },
    { n: node(4, ['City', 'Capital'], { id: 'c2', name: 'Berlin' }) },
    { n: node(6, ['City'], { id: 'new', name: 'New' }) },
    { r: rel(20, 'LED_BY', 1, 2) },
    { r: rel(11, 'IN_CITY', 1, 3, { since: 2020 }) },
  ]);
  const diff = diffGraphs(before, after, 'id');
  const status = (id: string) => diff.nodes.find((n) => n.id === JSON.stringify(id))?.status;
  assert.equal(status('o1'), 'changed');
  assert.equal(status('p1'), 'unchanged');
  assert.equal(status('c2'), 'changed');
  assert.equal(status('gone'), 'removed');
  assert.equal(status('new'), 'added');
  const o1 = diff.nodes.find((n) => n.id === '"o1"')!;
  assert.deepEqual(o1.changes.map((c) => c.text), ['industry added: "Software"', 'summary removed (was "old")']);
  assert.deepEqual(diff.nodes.find((n) => n.id === '"c2"')!.changes.map((c) => c.text), ['labels: :City → :City:Capital']);
  // A renamed type is a removal and an addition; a property on a kept relationship is a change.
  const rs = Object.fromEntries(diff.rels.map((r) => [r.type + ':' + r.to, r.status]));
  assert.deepEqual(rs, { 'HAS_CEO:"p1"': 'removed', 'LED_BY:"p1"': 'added', 'IN_CITY:"c1"': 'changed', 'IN_CITY:"c2"': 'removed' });
  assert.equal(summaryText(diff), 'Nodes: 1 removed, 1 added, 2 changed, 2 unchanged. Relationships: 2 removed, 1 added, 1 changed.');
  const rows = changeRows(diff);
  // Nodes first, then relationships; within each, removed, added, changed.
  assert.deepEqual(rows.map((r) => `${r.kind} ${r.status}`), [
    'node removed', 'node added', 'node changed', 'node changed',
    'relationship removed', 'relationship removed', 'relationship added', 'relationship changed',
  ]);
  assert.equal(rows.find((r) => r.status === 'added' && r.kind === 'relationship')!.element, 'Nimbus -[:LED_BY]-> Kavya');
  assert.equal(rows.find((r) => r.id === '"o1"')!.element, 'Nimbus (:Org, id "o1")');
  assert.equal(rows.find((r) => r.kind === 'relationship' && r.status === 'changed')!.what, 'since added: 2020');
});

test('marks tell the statuses apart without colour', () => {
  const symbols = Object.values(STATUS_STYLE).map((s) => s.symbol);
  assert.equal(new Set(symbols).size, 4);
  assert.equal(new Set(Object.values(STATUS_STYLE).map((s) => s.word)).size, 4);
  assert.equal(new Set(Object.values(STATUS_STYLE).map((s) => s.line)).size, 4);
  assert.equal(markedCaption({ status: 'removed', caption: 'Paris' }), '− Paris');
  assert.equal(markedCaption({ status: 'unchanged', caption: 'Paris' }), 'Paris');
  assert.equal(markedType({ status: 'added', type: 'LED_BY' }), '+ LED_BY');
});

test('nodes the key cannot match, and relationships to them, are reported, not guessed', () => {
  const before = graphFromRows([{ a: node(1, ['A'], { id: 1 }), b: node(2, ['B'], { name: 'no key' }), r: rel(5, 'T', 1, 2) }]);
  const after = graphFromRows([{ a: node(1, ['A'], { id: 1 }), c: node(3, ['A'], { id: 1 }) }]);
  const diff = diffGraphs(before, after, 'id');
  assert.equal(diff.problems.length, 3);
  assert.match(diff.problems[0], /a :B node in the before result has no `id` property/);
  assert.match(diff.problems[1], /:T relationship in the before result has an end node/);
  assert.match(diff.problems[2], /two nodes in the after result have `id` 1/);
  assert.equal(diff.rels.length, 0);
});

test('parallel relationships of one type are told apart by their properties', () => {
  const two = (ids: number[]) =>
    graphFromRows([{ a: node(1, ['A'], { id: 'a' }), b: node(2, ['B'], { id: 'b' }), r: [rel(ids[0], 'T', 1, 2, { w: 1 }), rel(ids[1], 'T', 1, 2, { w: 2 })] }]);
  const diff = diffGraphs(two([5, 6]), two([60, 50]), 'id');
  assert.deepEqual(countsOf(diff.rels), { removed: 0, added: 0, changed: 0, unchanged: 2 });
});

test('the layout is the same on every run, a star on one ring, separate parts side by side', () => {
  const rows = [{ o: node(1, ['Org'], { id: 'o' }) }];
  for (let i = 0; i < 12; i++) rows.push({ o: node(100 + i, ['City'], { id: `c${i}` }), r: rel(200 + i, 'IN', 1, 100 + i) } as never);
  rows.push({ o: node(50, ['Lone'], { id: 'lone' }) });
  const g = graphFromRows(rows);
  const diff = diffGraphs(g, g, 'id');
  const one = layoutDiff(diff);
  const two = layoutDiff(diff);
  assert.deepEqual([...one], [...two]);
  const hub = one.get('"o"')!;
  const radii = [...Array(12).keys()].map((i) => Math.hypot(one.get(`"c${i}"`)!.x - hub.x, one.get(`"c${i}"`)!.y - hub.y));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 0.5, `ring radii ${radii.join(', ')}`);
  // The lone node is a second part, to the right of the first.
  assert.ok(one.get('"lone"')!.x > Math.max(...[...Array(12).keys()].map((i) => one.get(`"c${i}"`)!.x)));
  assert.ok([...one.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

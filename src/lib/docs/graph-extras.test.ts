// Unit tests for the graph view extras (ADR-0036): the shared model in
// src/lib/cookbook/graph-extras-model.ts (paths, defaults, captions, relationship
// colours) and the static pictures in
// src/lib/docs/elements/_graph-extras-static.ts, against the recorded
// results of reference/cypher/patterns.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { inertSvg } from '../cookbook/diagrams.ts';
import {
  LIGHT_GROUND,
  asPath,
  captionBy,
  contrast,
  mixToward,
  pathsOf,
  propertyKeys,
  relColor,
  relPalette,
  relTypes,
  viewDefaults,
} from '../cookbook/graph-extras-model.ts';
import { siteTokens } from '../cookbook/tokens.ts';
import { measure } from './checks/cells.ts';
import { ROOT } from './content.ts';
import { drawResultGraphWith, extrasKey, layoutCircular, layoutHierarchical, staticExtras } from './elements/_graph-extras-static.ts';
import type { RecordedCell, RecordedGraph } from './results.ts';

const PATTERNS = join(ROOT, 'src/content/docs/reference/cypher/patterns.results.json');
const recorded = (id: string) => (JSON.parse(readFileSync(PATTERNS, 'utf8')) as { cells: Record<string, RecordedCell> }).cells[id];

const n = (id: number, props: Record<string, unknown> = {}) => ({ kind: 'node', id, labels: ['P'], properties: props });
const r = (id: number, s: number, e: number, type = 'K') => ({ kind: 'relationship', id, start_node: s, end_node: e, type, properties: {} });

test('asPath: alternating nodes and joining relationships, node first and last', () => {
  assert.deepEqual(asPath([n(0), r(5, 0, 1), n(1), r(6, 2, 1), n(2)]), { nodes: [0, 1, 2], rels: [5, 6] });
  assert.equal(asPath([n(0), r(5, 0, 9), n(1)]), null, 'a relationship that does not join its neighbours');
  assert.equal(asPath([n(0), n(1)]), null);
  assert.equal(asPath([n(0)]), null, 'a lone node is a path only in a PATH column');
  assert.deepEqual(asPath([n(0)], true), { nodes: [0], rels: [] });
  assert.equal(asPath([1, 2, 3]), null);
});

test('pathsOf: PATH columns only when there are any, else every path in the rows', () => {
  const p = [n(0), r(5, 0, 1), n(1)];
  const q = [n(1), r(6, 1, 2), n(2)];
  const typed = pathsOf({ columns: ['p', 'g'], columnTypes: ['PATH', 'LIST'], rows: [{ p, g: [q] }] });
  assert.deepEqual([...typed.nodes], [0, 1]);
  assert.deepEqual([...typed.rels], [5]);
  const untyped = pathsOf({ columns: ['ps'], columnTypes: ['LIST'], rows: [{ ps: [p, q] }, { ps: [p] }] });
  assert.equal(untyped.paths.length, 2, 'a path seen twice counts once');
  assert.deepEqual([...untyped.rels].sort(), [5, 6]);
  assert.equal(pathsOf(null).paths.length, 0);
  assert.equal(pathsOf({ columns: ['x'], columnTypes: ['INTEGER'], rows: [{ x: 1 }] }).paths.length, 0);
});

test('pathsOf on the recorded named-path and shortest-path cells: the path, not the people beside it', () => {
  for (const id of ['named-path', 'shortest-path']) {
    const set = pathsOf(recorded(id).envelope);
    assert.equal(set.paths.length, 1, id);
    assert.equal(set.nodes.size, 3, id);
    assert.equal(set.rels.size, 2, id);
    assert.ok(recorded(id).graph!.rels.length > set.rels.size, `${id}: the result draws more than the path`);
  }
});

test('viewDefaults: the words a view takes, and nothing else', () => {
  assert.deepEqual(viewDefaults(undefined), { layout: 'force', caption: null, highlight: false });
  assert.deepEqual(viewDefaults({ layout: 'hierarchical', caption: 'role', highlight: 'path', timing: '' }), { layout: 'hierarchical', caption: 'role', highlight: true });
  assert.deepEqual(viewDefaults({ layout: 'spiral', caption: '1x' }), { layout: 'force', caption: null, highlight: false });
});

test('captionBy, propertyKeys, relTypes', () => {
  const ada = { id: 0, labels: ['Person'], properties: { name: 'Ada', role: 'engineer' } };
  const relate = { id: 1, labels: ['Project'], properties: { name: 'relate', language: 'Rust' } };
  assert.equal(captionBy(ada, null), 'Ada');
  assert.equal(captionBy(ada, 'role'), 'engineer');
  assert.equal(captionBy(relate, 'role'), 'relate', 'a node without the property keeps its default caption');
  assert.deepEqual(propertyKeys([ada, relate]), ['language', 'name', 'role']);
  assert.deepEqual(
    relTypes([
      { id: 0, type: 'B', start_node: 0, end_node: 1 },
      { id: 1, type: 'A', start_node: 0, end_node: 1 },
      { id: 2, type: 'B', start_node: 1, end_node: 0 },
    ]),
    ['A', 'B'],
  );
});

test('relationship colours: one per type everywhere, 3:1 against each theme\'s page and the pane the canvas sits on', () => {
  assert.equal(relColor('WORKS_ON', 'light'), relColor('WORKS_ON', 'light'));
  assert.equal(relPalette('light').indexOf(relColor('KNOWS', 'light')), relPalette('dark').indexOf(relColor('KNOWS', 'dark')), 'the same hue in both themes');
  const tokens = siteTokens();
  assert.equal(tokens.light['--bg'].toUpperCase(), LIGHT_GROUND, 'LIGHT_GROUND is the Day page colour');
  // The canvas sits on the output pane (--bg-alt), and in full screen on --bg-alt too.
  for (const theme of ['light', 'dark'] as const) {
    for (const ground of [tokens[theme]['--bg'], tokens[theme]['--bg-alt']]) {
      for (const c of relPalette(theme)) assert.ok(contrast(c, ground) >= 3, `${theme}: ${c} on ${ground} is ${contrast(c, ground).toFixed(2)}:1`);
    }
  }
});

test('mixToward: a dimmed colour keeps its hue and loses strength', () => {
  assert.equal(mixToward('#FF0000', '#FFFFFF', 1), '#FF0000');
  assert.equal(mixToward('#FF0000', '#FFFFFF', 0), '#FFFFFF');
  assert.equal(mixToward('#FF0000', '#000000', 0.5), '#800000');
  assert.equal(mixToward('rgb(1, 2, 3)', '#FFFFFF', 0.5), 'rgb(1, 2, 3)', 'a colour it cannot read comes back as it is');
});

test('extrasKey: empty for a plain picture, so its stamp stays the graph alone', () => {
  assert.equal(extrasKey(undefined, recorded('named-path').envelope), '');
  assert.equal(extrasKey({ timing: '' }, null), '');
  assert.equal(extrasKey({ highlight: 'path' }, { columns: ['x'], columnTypes: ['INTEGER'], rows: [{ x: 1 }] }), '', 'highlight=path on a result with no path');
  const key = extrasKey({ highlight: 'path' }, recorded('named-path').envelope);
  assert.notEqual(key, '');
  assert.notEqual(key, extrasKey({ highlight: 'path', layout: 'circular' }, recorded('named-path').envelope));
  const plain = { nodes: [{ id: 0, labels: [] as string[] }], rels: [] };
  assert.equal(drawResultGraphWith(plain, 'x', 't', { words: {}, envelope: null, measure }), null);
});

test('the caption word: the picture writes the chosen property, and its stamp changes', () => {
  const cell = recorded('named-path');
  const words = { caption: 'role' };
  const svg = drawResultGraphWith(cell.graph!, 'named-path', 'The graph', { words, envelope: cell.envelope, measure })!;
  const roles = cell.graph!.nodes.map((g) => g.properties?.role).filter((v): v is string => typeof v === 'string');
  assert.ok(roles.length > 0, 'the recorded people carry a role');
  for (const role of new Set(roles)) assert.match(svg.light, new RegExp(`>${role}<`), `the picture writes ${role}`);
  assert.doesNotMatch(svg.light, />Ada</, 'Ada is captioned with her role, not her name');
  assert.notEqual(extrasKey(words, cell.envelope), '', 'the caption joins the stamp');
  assert.notEqual(extrasKey(words, cell.envelope), extrasKey({ caption: 'name' }, cell.envelope));
});

test('the highlighted picture: the path on top, the rest faded, inert, light and dark', () => {
  const cell = recorded('named-path');
  const svg = drawResultGraphWith(cell.graph!, 'named-path', 'The graph', { words: { highlight: 'path' }, envelope: cell.envelope, measure })!;
  for (const theme of ['light', 'dark'] as const) {
    inertSvg(svg[theme], theme);
    assert.equal((svg[theme].match(/class="rel on"/g) ?? []).length, 2, `${theme}: two path relationships`);
    assert.equal((svg[theme].match(/class="node on"/g) ?? []).length, 3, `${theme}: three path nodes`);
    assert.equal((svg[theme].match(/class="node off"/g) ?? []).length, cell.graph!.nodes.length - 3, `${theme}: the other nodes faded`);
    assert.match(svg[theme], /Highlighted path: Ada, Grace, opencypher-tck/);
  }
  assert.notEqual(svg.light, svg.dark);
});

test('the hierarchical picture: each package below the packages that depend on it, four layers', () => {
  const cell = recorded('dependency-tree');
  const x = staticExtras({ layout: 'hierarchical' }, cell.envelope);
  assert.equal(x.layout, 'hierarchical');
  assert.equal(x.paths.paths.length, 0, 'no highlight without highlight=path');
  const graph = cell.graph as RecordedGraph;
  const model = {
    direction: 'LR',
    nodes: graph.nodes.map((g) => ({ id: `n${g.id}`, label: String(g.properties?.name), props: [':Package'], color: '#FFDF81' })),
    edges: graph.rels.map((g) => ({ source: `n${g.start_node}`, target: `n${g.end_node}`, type: g.type, props: '', dashed: false, arrow: true, rel: g.id })),
  };
  const layout = layoutHierarchical(model, measure);
  const y = Object.fromEntries(layout.nodes.map((g) => [g.label, g.y]));
  for (const [a, b] of [
    ['app', 'cli'],
    ['app', 'engine'],
    ['cli', 'parser'],
    ['engine', 'parser'],
    ['engine', 'storage'],
    ['parser', 'lexer'],
  ]) {
    assert.ok(y[a] < y[b], `${a} above ${b}`);
  }
  assert.equal(new Set(Object.values(y).map(Math.round)).size, 4);
  const circle = layoutCircular(model, measure);
  const radii = circle.nodes.map((g) => Math.round(Math.hypot(g.x, g.y)));
  assert.equal(new Set(radii).size, 1, 'every node on one circle');
  const svg = drawResultGraphWith(graph, 'dependency-tree', 'The graph', { words: { layout: 'hierarchical' }, envelope: cell.envelope, measure })!;
  inertSvg(svg.light, 'light');
  assert.doesNotMatch(svg.light, / on"| off"/, 'no highlight classes without highlight=path');
});

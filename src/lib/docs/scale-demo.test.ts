// Tests for `:::scale-demo`'s model (src/lib/docs/elements/_scale-demo-model.ts):
// the sizes a directive offers, which one comes first, and the radial tree
// the browser module draws from the relationships the engine reads back.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SIZES, firstSize, radialTree, sizesOf } from './elements/_scale-demo-model.ts';

/** The relationships the build cell makes for `n` nodes: node i (from 1) is the child of node (i - 1) / 2. */
function heap(n: number) {
  const child: number[] = [];
  const parent: number[] = [];
  for (let i = 1; i < n; i++) {
    child.push(i);
    parent.push(Math.floor((i - 1) / 2));
  }
  return { child, parent };
}

const at = (layout: ReturnType<typeof radialTree>, id: number) => layout.nodes.find((n) => n.id === String(id))!;
const r = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

test('sizesOf reads the sizes a directive offers, and firstSize picks by screen width', () => {
  assert.deepEqual(sizesOf(undefined), DEFAULT_SIZES);
  assert.deepEqual(sizesOf('500, 5000'), [500, 5000]);
  for (const bad of ['', 'a,b', '1.5', '0', '-1', '1,,2']) assert.equal(sizesOf(bad), null, bad);
  assert.equal(firstSize([1000, 10000, 100000], true), 100000);
  assert.equal(firstSize([1000, 10000, 100000], false), 10000);
  assert.equal(firstSize([1000, 10000], false), 1000);
  assert.equal(firstSize([5000], false), 5000);
});

test('a heap tree puts the root at the centre and each depth on its own ring, farther out', () => {
  const { child, parent } = heap(1000);
  const layout = radialTree(child, parent, 10);
  assert.equal(layout.nodes.length, 1000);
  assert.equal(layout.rels.length, 999);
  assert.equal(layout.roots, 1);
  assert.equal(layout.depth, 9);
  assert.equal(r(at(layout, 0)), 0);
  // Nodes 1 and 2 share ring 1; 3 to 6 ring 2, farther out.
  assert.ok(Math.abs(r(at(layout, 1)) - r(at(layout, 2))) < 1e-9);
  assert.ok(r(at(layout, 3)) > r(at(layout, 1)));
  // A ring's radius is the square root of the nodes out to it: ring 1 holds 3 nodes in all.
  assert.ok(Math.abs(r(at(layout, 1)) - 10 * Math.sqrt(3)) < 1e-9);
  // Every relationship joins two drawn nodes, from child to parent.
  const ids = new Set(layout.nodes.map((n) => n.id));
  assert.ok(layout.rels.every((rel) => ids.has(rel.from) && ids.has(rel.to)));
  assert.deepEqual(layout.rels[0], { id: 'r0', from: '1', to: '0' });
  assert.ok(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('a child sits inside its parent\'s wedge, so no two subtrees overlap', () => {
  const { child, parent } = heap(63);
  const layout = radialTree(child, parent, 10);
  const angle = (id: number) => (Math.atan2(at(layout, id).y, at(layout, id).x) + 2 * Math.PI) % (2 * Math.PI);
  // Node 1's subtree takes the first half of the circle, node 2's the second.
  for (const id of [3, 4, 7, 8, 9, 10]) assert.ok(angle(id) < Math.PI, `node ${id} at ${angle(id)}`);
  for (const id of [5, 6, 11, 12, 13, 14]) assert.ok(angle(id) > Math.PI, `node ${id} at ${angle(id)}`);
});

test('a forest, a second parent and a cycle still lay out, with every relationship drawn', () => {
  // Two trees (0 <- 1, 2 <- 3), a second parent for 1 (2), and a cycle 4 <-> 5.
  const layout = radialTree([1, 3, 1, 4, 5], [0, 2, 2, 5, 4], 10);
  assert.equal(layout.nodes.length, 6);
  assert.equal(layout.rels.length, 5);
  assert.equal(layout.roots, 3);
  assert.ok(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  // With several roots, none sits at the centre: they share the first ring.
  assert.ok(r(at(layout, 0)) > 0);
});

test('a hundred thousand nodes lay out', () => {
  const { child, parent } = heap(100000);
  const layout = radialTree(child, parent, 10);
  assert.equal(layout.nodes.length, 100000);
  assert.equal(layout.depth, 16);
  // The disc is evenly dense: its outer radius is the spacing times the square root of the node count.
  const outer = Math.max(...layout.nodes.map(r));
  assert.ok(Math.abs(outer - 10 * Math.sqrt(100000)) < 1e-6, String(outer));
});

test('a limit keeps the whole rings from the root out that fit, placed as in the whole tree', () => {
  const { child, parent } = heap(100000);
  const whole = radialTree(child, parent, 10);
  const cut = radialTree(child, parent, 10, 65536);
  // Rings 0 to 15 of a heap hold 2^16 - 1 nodes; ring 16 would pass the limit.
  assert.equal(cut.nodes.length, 65535);
  assert.equal(cut.rels.length, 65534);
  assert.equal(cut.drawnDepth, 15);
  assert.equal(cut.depth, 16);
  assert.equal(cut.total, 100000);
  assert.equal(cut.totalRels, 99999);
  assert.deepEqual(at(cut, 12345), at(whole, 12345));
  const drawn = new Set(cut.nodes.map((n) => n.id));
  assert.ok(cut.rels.every((rel) => drawn.has(rel.from) && drawn.has(rel.to)));
  // Under the limit, everything is drawn.
  assert.equal(whole.nodes.length, 100000);
  assert.equal(whole.drawnDepth, 16);
});

test('relationship lists of different lengths are refused', () => {
  assert.throws(() => radialTree([1, 2], [0]), /2 children and 1 parents/);
});

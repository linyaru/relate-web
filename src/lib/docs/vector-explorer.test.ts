// Tests for the arithmetic of `:::vector-explorer`
// (src/lib/docs/elements/_vector-explorer-math.ts): the two-component PCA the
// scatter's first frame is drawn from, and the reciprocal rank fusion the
// hybrid view shows beside the engine's fused statement.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { fuse, pca2, pointsOf, project, queryField, shareFormula } from './elements/_vector-explorer-math.ts';

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const close = (a: number, b: number, eps: number, what: string) => assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} vs ${b}`);

/** The 40 notes the vector search guide ranks (the hybrid recall recipe's), as the page holds them. */
function notes() {
  const src = readFileSync(new URL('../../content/docs/guides/cypher/vector-search.mdx', import.meta.url), 'utf8');
  const block = /```json data=notes\n([\s\S]*?)\n```/.exec(src);
  assert.ok(block, 'the vector search guide has a `json data=notes` block');
  return pointsOf(JSON.parse(block[1]), { key: 'id', text: 'text', group: 'topics', vector: null });
}

/**
 * The eigenvalues of a symmetric matrix by cyclic Jacobi rotations: a method
 * unrelated to power iteration, so it checks pca2 rather than repeating it.
 */
function jacobiEigenvalues(input: number[][]): number[] {
  const a = input.map((r) => r.slice());
  const n = a.length;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return a.map((r, i) => r[i]).sort((x, y) => y - x);
}

test('pca2 finds the axes of a 3-D set with known variances', () => {
  // Centred, uncorrelated: variance 18/5 along x, 8/5 along y, 2/5 along z.
  const v = [[3, 0, 0], [-3, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 1], [0, 0, -1]];
  const p = pca2(v);
  close(p.variances[0], 18 / 5, 1e-9, 'first variance');
  close(p.variances[1], 8 / 5, 1e-9, 'second variance');
  close(p.total, 28 / 5, 1e-9, 'total variance');
  close(Math.abs(dot(p.components[0], [1, 0, 0])), 1, 1e-9, 'first component along x');
  close(Math.abs(dot(p.components[1], [0, 1, 0])), 1, 1e-9, 'second component along y');
  // The sign is fixed: the largest coordinate is positive.
  assert.ok(p.components[0][0] > 0 && p.components[1][1] > 0);
  const [px, py] = project([3, 0, 0], p);
  close(px, 3, 1e-9, "x on the first component");
  close(py, 0, 1e-9, "x on the second component");
});

test('pca2 finds rotated axes, orthogonal and of length 1', () => {
  // The same set turned 45 degrees in the x-y plane, then shifted: the mean comes out, the axes turn.
  const r = Math.SQRT1_2;
  const base = [[3, 0, 0], [-3, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 1], [0, 0, -1]];
  const v = base.map(([x, y, z]) => [r * x - r * y + 5, r * x + r * y - 2, z + 1]);
  const p = pca2(v);
  close(Math.abs(dot(p.components[0], [r, r, 0])), 1, 1e-9, 'first component along (1, 1, 0)');
  close(Math.abs(dot(p.components[1], [-r, r, 0])), 1, 1e-9, 'second component along (-1, 1, 0)');
  close(dot(p.components[0], p.components[1]), 0, 1e-9, 'orthogonal');
  close(dot(p.components[0], p.components[0]), 1, 1e-12, 'unit length');
  assert.deepEqual(p.mean.map((x) => Math.round(x * 1e9) / 1e9), [5, -2, 1]);
});

test('pca2 refuses fewer than two vectors and vectors of different lengths', () => {
  assert.throws(() => pca2([[1, 2]]), /two or more vectors/);
  assert.throws(() => pca2([[1, 2], [1, 2, 3]]), /same length/);
});

test('on the 40 notes, pca2 converges, is deterministic, and matches an independent eigen solve', () => {
  const { points } = notes();
  assert.equal(points.length, 40);
  assert.equal(points[0].vector.length, 384);
  const vectors = points.map((p) => p.vector);
  const a = pca2(vectors);
  const b = pca2(vectors);
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'two runs give the same bytes');
  assert.ok(a.iterations[0] < 2000 && a.iterations[1] < 2000, `iterations below the cap: ${a.iterations.join(', ')}`);
  assert.ok(a.variances[0] >= a.variances[1] && a.variances[0] + a.variances[1] <= a.total, 'variances ordered and within the total');
  close(dot(a.components[0], a.components[1]), 0, 1e-9, 'the two components are orthogonal');
  // The covariance's top eigenvalues equal those of the centred Gram matrix (40 x 40) divided by n - 1.
  const rows = vectors.map((v) => v.map((x, i) => x - a.mean[i]));
  const gram = rows.map((r) => rows.map((s) => dot(r, s) / (rows.length - 1)));
  const [l1, l2] = jacobiEigenvalues(gram);
  close(a.variances[0], l1, 1e-9, 'first variance against Jacobi');
  close(a.variances[1], l2, 1e-9, 'second variance against Jacobi');
});

test('pointsOf reads a data block and says what is wrong with a bad one', () => {
  const block = { notes: [{ id: 'a', text: 'A', topics: ['x', 'y'], e: [1, 0] }, { id: 'b', text: 'B', topics: ['y'], e: [0, 1] }] };
  const got = pointsOf(block, { key: 'id', text: 'text', group: 'topics', vector: null });
  assert.equal(got.list, 'notes');
  assert.equal(got.vectorField, 'e');
  assert.deepEqual(got.points.map((p) => [p.id, p.group]), [['a', 'x'], ['b', 'y']]);
  assert.throws(() => pointsOf({ notes: [{ id: 'a', e: [1, 0] }, { id: 'a', e: [0, 1] }] }, { key: 'id', text: 'text', group: null, vector: null }), /two points/);
  assert.throws(() => pointsOf({ notes: [{ id: 'a', e: [1, 0] }, { id: 'b', e: [0, 1, 2] }] }, { key: 'id', text: 'text', group: null, vector: null }), /not a list of 2 numbers/);
  assert.throws(() => pointsOf([], { key: 'id', text: 'text', group: null, vector: null }), /not a JSON object/);
  assert.equal(queryField({ q: 'x', k: 5, v: [1, 0] }, 2), 'v');
  assert.equal(queryField({ v: [1, 0, 0] }, 2), null);
});

test('fuse adds 1 / (60 + rank) from each list, best first, ties by id', () => {
  // The hybrid search guide's recorded lists for "wal tests" with k = 3.
  const fused = fuse([
    { name: 'vector-list', ids: ['n6', 'n3', 'n2'] },
    { name: 'fulltext-list', ids: ['n6', 'n1'] },
  ]);
  assert.deepEqual(fused.map((f) => [f.id, Math.round(f.score * 1e4) / 1e4]), [['n6', 0.0328], ['n1', 0.0161], ['n3', 0.0161], ['n2', 0.0159]]);
  assert.equal(shareFormula(fused[0]), '1/(60+1) + 1/(60+1)');
  assert.equal(shareFormula(fused[1]), '1/(60+2)');
});

test('fuse weights each list and takes another constant', () => {
  const fused = fuse([{ name: 'a', ids: ['x', 'y'], weight: 0.7 }, { name: 'b', ids: ['y'], weight: 0.3 }], 10);
  close(fused[0].score, 0.7 / 12 + 0.3 / 11, 1e-15, 'y');
  assert.equal(fused[0].id, 'y');
  close(fused[1].score, 0.7 / 11, 1e-15, 'x');
  assert.equal(shareFormula(fused[0], 10), '0.7/(10+2) + 0.3/(10+1)');
});

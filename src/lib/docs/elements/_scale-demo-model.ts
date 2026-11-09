// The model behind `:::scale-demo`, shared by its build side
// (src/lib/docs/elements/scale-demo.ts), its browser module
// (src/scripts/docs/elements/scale-demo.ts) and the unit tests
// (src/lib/docs/scale-demo.test.ts); free of Node and DOM imports. It holds
// the sizes a directive may offer, which one the reader is offered first,
// and where each node of the tree is drawn.
//
// The drawing is a radial tree laid out from the relationships the engine
// hands back, before anything is drawn, so the WebGL view never runs a
// layout and nothing moves.
//
// Each relationship points from a child to its parent. Roots (nodes with no
// parent) sit at the centre; each node gets a wedge of the circle in
// proportion to the leaves under it, and the nodes of one depth sit on one
// ring. A ring's radius grows with the square root of the number of nodes
// out to that depth, so every node gets about the same area and the disc is
// evenly dense whether the tree has a thousand nodes or a hundred thousand.
// A second parent, or a cycle, does not stop the layout: the relationship
// is still drawn, and a node no root reaches becomes a root of its own.

/** The sizes the reader picks from, when the directive names none. */
export const DEFAULT_SIZES = [1000, 10000, 100000];
/** The largest size a directive may offer. */
export const MAX_SIZE = 200000;
/** The narrowest column, in CSS pixels, offered the largest size first; a narrower one (a phone) is offered the middle size. */
export const WIDE_PX = 720;

/** The sizes a directive offers (`sizes="1000,10000"`), in its order; null when it is not a list of whole numbers. */
export function sizesOf(attr: string | undefined): number[] | null {
  if (attr === undefined) return DEFAULT_SIZES;
  const list = attr.split(',').map((s) => s.trim());
  if (!list.length || list.some((s) => !/^[1-9]\d*$/.test(s))) return null;
  return list.map(Number);
}

/** The size offered first: the largest on a wide screen, the middle one (rounded down) on a narrow one. */
export const firstSize = (sizes: readonly number[], wide: boolean) => (wide ? sizes.at(-1)! : sizes[Math.floor((sizes.length - 1) / 2)]);

/** A node: its id (the engine's, as text) and position in layout units. */
export interface TreeNode {
  id: string;
  x: number;
  y: number;
}

/** A relationship to draw, from child to parent. */
export interface TreeRel {
  id: string;
  from: string;
  to: string;
}

export interface TreeLayout {
  /** The nodes to draw: every node on the rings that fit under the limit. */
  nodes: TreeNode[];
  /** The relationships between the nodes drawn. */
  rels: TreeRel[];
  /** Nodes with no parent (and nodes no root reaches). */
  roots: number;
  /** The deepest ring of the whole tree (0 for a lone root). */
  depth: number;
  /** Every node and relationship the lists name, drawn or not. */
  total: number;
  totalRels: number;
  /** The deepest ring drawn (-1 when not even the roots fit). */
  drawnDepth: number;
}

/**
 * Lay out the forest that the relationships `child[k] -> parent[k]` make
 * (engine ids; the two lists are as long as each other). `spacing` is the
 * distance, in layout units, that gives each node its share of the disc.
 * Every node is placed as if all were drawn; `limit` keeps the whole rings,
 * from the centre out, that hold at most that many nodes (a renderer's
 * ceiling), so a cut tree is the inner part of the whole one.
 */
export function radialTree(child: readonly number[], parent: readonly number[], spacing = 10, limit = Infinity): TreeLayout {
  if (child.length !== parent.length) throw new Error(`radialTree: ${child.length} children and ${parent.length} parents`);
  // Engine ids to dense indexes, in order of first appearance.
  const index = new Map<number, number>();
  const ids: number[] = [];
  const at = (id: number) => {
    let i = index.get(id);
    if (i === undefined) {
      i = ids.length;
      index.set(id, i);
      ids.push(id);
    }
    return i;
  };
  const pairs = child.map((c, k) => [at(c), at(parent[k])] as const);
  const n = ids.length;
  // Each node's first parent is its place in the tree; a later one is only drawn.
  const up = new Int32Array(n).fill(-1);
  for (const [c, p] of pairs) if (up[c] === -1 && c !== p) up[c] = p;
  // Children of each node, in the order the relationships came (compressed rows).
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) if (up[i] >= 0) start[up[i] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const kids = new Int32Array(start[n]);
  const fill = start.slice(0, n);
  for (let i = 0; i < n; i++) if (up[i] >= 0) kids[fill[up[i]]++] = i;

  // Breadth first from the roots, then from any node a cycle kept out of reach.
  const order = new Int32Array(n);
  const depth = new Int32Array(n).fill(-1);
  const isRoot = new Uint8Array(n);
  let head = 0;
  let tail = 0;
  const walk = (root: number) => {
    isRoot[root] = 1;
    depth[root] = 0;
    order[tail++] = root;
    while (head < tail) {
      const v = order[head++];
      for (let k = start[v]; k < start[v + 1]; k++) {
        const c = kids[k];
        if (depth[c] !== -1) continue;
        depth[c] = depth[v] + 1;
        order[tail++] = c;
      }
    }
  };
  for (let i = 0; i < n; i++) if (up[i] === -1) walk(i);
  for (let i = 0; i < n; i++) if (depth[i] === -1) walk(i);
  let roots = 0;
  for (let i = 0; i < n; i++) roots += isRoot[i];

  // The leaves under each node. A node's children are its kids that are not
  // roots; they come after it in breadth-first order, so walking the order
  // backwards sums them before it is reached, and a node with none counts 1.
  const leaves = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    const v = order[k];
    if (leaves[v] === 0) leaves[v] = 1;
    if (!isRoot[v]) leaves[up[v]] += leaves[v];
  }

  // Each ring's radius: the square root of the nodes out to that depth.
  let maxDepth = 0;
  for (let i = 0; i < n; i++) if (depth[i] > maxDepth) maxDepth = depth[i];
  const perDepth = new Float64Array(maxDepth + 1);
  for (let i = 0; i < n; i++) perDepth[depth[i]]++;
  const radius = new Float64Array(maxDepth + 1);
  let upTo = 0;
  for (let d = 0; d <= maxDepth; d++) {
    upTo += perDepth[d];
    radius[d] = d === 0 && roots === 1 ? 0 : spacing * Math.sqrt(upTo);
  }

  // Wedges: the roots share the circle by their leaves, and each node shares its wedge among its children the same way.
  const from = new Float64Array(n);
  const span = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) if (isRoot[i]) total += leaves[i];
  let angle = 0;
  for (let k = 0; k < n; k++) {
    const v = order[k];
    if (!isRoot[v]) continue;
    from[v] = angle;
    span[v] = (2 * Math.PI * leaves[v]) / total;
    angle += span[v];
  }
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const v = order[k];
    const mid = from[v] + span[v] / 2;
    x[v] = radius[depth[v]] * Math.cos(mid);
    y[v] = radius[depth[v]] * Math.sin(mid);
    let a = from[v];
    for (let j = start[v]; j < start[v + 1]; j++) {
      const c = kids[j];
      if (isRoot[c]) continue;
      from[c] = a;
      span[c] = (span[v] * leaves[c]) / leaves[v];
      a += span[c];
    }
  }

  // The rings that fit under `limit`, whole: the deepest ring whose nodes, with every ring inside it, number at most `limit`.
  let drawnDepth = -1;
  for (let d = 0, sum = 0; d <= maxDepth; d++) {
    sum += perDepth[d];
    if (sum > limit) break;
    drawnDepth = d;
  }
  const nodes: TreeNode[] = [];
  for (let i = 0; i < n; i++) if (depth[i] <= drawnDepth) nodes.push({ id: String(ids[i]), x: x[i], y: y[i] });
  const rels: TreeRel[] = [];
  pairs.forEach(([c, p], k) => {
    if (depth[c] <= drawnDepth && depth[p] <= drawnDepth) rels.push({ id: `r${k}`, from: String(ids[c]), to: String(ids[p]) });
  });
  return { nodes, rels, roots, depth: maxDepth, total: n, totalRels: pairs.length, drawnDepth };
}

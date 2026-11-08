// The arithmetic of `:::vector-explorer` (vector-explorer.ts), shared by the
// build (the first frame, recorded) and the browser module (the live view):
// the points a data block holds, a two-component PCA by power iteration, and
// reciprocal rank fusion. No Node imports, so the browser chunk can carry it.
//
// The projection is computed once, at record time, and shipped in the static
// picture; the browser never re-projects. PCA rather than t-SNE or UMAP: it
// is linear, deterministic with a fixed start, and cheap enough to test, and
// its two axes have a meaning a caption can state (the share of variance).

/** One point of the explorer: a node the page's data block describes. */
export interface Point {
  /** The value of the key field (the id the search statement returns). */
  id: string;
  text: string;
  /** The value of the group field (its first element when it is a list), or ''. */
  group: string;
  vector: number[];
}

/** Which fields of a data block's objects the explorer reads. */
export interface PointFields {
  key: string;
  text: string;
  group: string | null;
  vector: string | null;
}

const isVector = (v: unknown): v is number[] => Array.isArray(v) && v.length > 1 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * The points in a data block (its parsed JSON object): the first array of
 * objects whose items carry a vector (`fields.vector`, or the first field
 * holding a list of numbers). Throws, saying why, when there is none or an
 * item lacks a field.
 */
export function pointsOf(block: unknown, fields: PointFields): { list: string; vectorField: string; points: Point[] } {
  if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('the data block is not a JSON object');
  for (const [list, value] of Object.entries(block as Record<string, unknown>)) {
    if (!Array.isArray(value) || !value.length || !value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) continue;
    const first = value[0] as Record<string, unknown>;
    const vectorField = fields.vector ?? Object.keys(first).find((k) => isVector(first[k]));
    if (!vectorField || !isVector(first[vectorField])) continue;
    const dims = (first[vectorField] as number[]).length;
    const points = value.map((raw, i) => {
      const o = raw as Record<string, unknown>;
      const vector = o[vectorField];
      if (!isVector(vector) || vector.length !== dims) throw new Error(`\`${list}[${i}].${vectorField}\` is not a list of ${dims} numbers`);
      const id = o[fields.key];
      if (typeof id !== 'string' && typeof id !== 'number') throw new Error(`\`${list}[${i}]\` has no \`${fields.key}\``);
      const g = fields.group ? o[fields.group] : '';
      const group = Array.isArray(g) ? String(g[0] ?? '') : g === undefined || g === null ? '' : String(g);
      return { id: String(id), text: typeof o[fields.text] === 'string' ? (o[fields.text] as string) : '', group, vector };
    });
    const seen = new Set<string>();
    for (const p of points) {
      if (seen.has(p.id)) throw new Error(`two points in \`${list}\` have the ${fields.key} \`${p.id}\``);
      seen.add(p.id);
    }
    return { list, vectorField, points };
  }
  throw new Error(`the data block holds no list of objects with a vector${fields.vector ? ` in \`${fields.vector}\`` : ''}`);
}

/** The first field of a parameters object that holds a vector of `dims` numbers, or null. */
export function queryField(params: Record<string, unknown>, dims: number, named: string | null = null): string | null {
  if (named) return isVector(params[named]) && (params[named] as number[]).length === dims ? named : null;
  return Object.keys(params).find((k) => isVector(params[k]) && (params[k] as number[]).length === dims) ?? null;
}

// ---------------------------------------------------------------- PCA

/** A two-component principal component analysis of a set of vectors. */
export interface Pca {
  mean: number[];
  /** Unit vectors, the first along the most variance. */
  components: [number[], number[]];
  /** The variance along each component. */
  variances: [number, number];
  /** The total variance (the trace of the covariance): each component's share is variances[i] / total. */
  total: number;
  /** Power iterations each component took. */
  iterations: [number, number];
}

const dot = (a: readonly number[], b: readonly number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const norm = (a: readonly number[]) => Math.sqrt(dot(a, a));

/**
 * The top eigenvector of the covariance of `rows` (centred), with every
 * direction in `against` projected out: (Xᵀ X v) without forming Xᵀ X.
 * Starts from a fixed vector, so the result is deterministic; the sign is
 * fixed so the largest coordinate is positive.
 */
function topComponent(rows: number[][], against: number[][], maxIterations: number, tolerance: number): { v: number[]; lambda: number; iterations: number } {
  const d = rows[0].length;
  const deflate = (v: number[]) => {
    for (const u of against) {
      const s = dot(v, u);
      for (let i = 0; i < d; i++) v[i] -= s * u[i];
    }
    return v;
  };
  // A fixed start with no symmetry the data could be orthogonal to by accident.
  let v = deflate(Array.from({ length: d }, (_, i) => 1 + ((i * 7919) % 101) / 101));
  let n = norm(v);
  v = v.map((x) => x / n);
  let lambda = 0;
  let it = 0;
  for (; it < maxIterations; it++) {
    const w = new Array<number>(d).fill(0);
    for (const r of rows) {
      const s = dot(r, v);
      for (let i = 0; i < d; i++) w[i] += s * r[i];
    }
    deflate(w);
    n = norm(w);
    if (n === 0) return { v, lambda: 0, iterations: it + 1 };
    for (let i = 0; i < d; i++) w[i] /= n;
    const change = Math.sqrt(w.reduce((s, x, i) => s + (x - v[i]) ** 2, 0));
    v = w;
    lambda = n / Math.max(1, rows.length - 1);
    if (change < tolerance) {
      it++;
      break;
    }
  }
  let big = 0;
  for (let i = 1; i < d; i++) if (Math.abs(v[i]) > Math.abs(v[big])) big = i;
  if (v[big] < 0) v = v.map((x) => -x);
  return { v, lambda, iterations: it };
}

/** The first two principal components of `vectors` (two or more, of one length), by power iteration with deflation. Deterministic. */
export function pca2(vectors: readonly (readonly number[])[], { maxIterations = 2000, tolerance = 1e-12 } = {}): Pca {
  if (vectors.length < 2) throw new Error('a projection needs two or more vectors');
  const d = vectors[0].length;
  if (d < 2 || vectors.some((v) => v.length !== d)) throw new Error('every vector needs the same length, two or more');
  const mean = new Array<number>(d).fill(0);
  for (const v of vectors) for (let i = 0; i < d; i++) mean[i] += v[i] / vectors.length;
  const rows = vectors.map((v) => v.map((x, i) => x - mean[i]));
  const total = rows.reduce((s, r) => s + dot(r, r), 0) / Math.max(1, rows.length - 1);
  const first = topComponent(rows, [], maxIterations, tolerance);
  const second = topComponent(rows, [first.v], maxIterations, tolerance);
  return { mean, components: [first.v, second.v], variances: [first.lambda, second.lambda], total, iterations: [first.iterations, second.iterations] };
}

/** A vector's coordinates on the two components. */
export function project(vector: readonly number[], pca: Pca): [number, number] {
  const c = vector.map((x, i) => x - pca.mean[i]);
  return [dot(c, pca.components[0]), dot(c, pca.components[1])];
}

// ---------------------------------------------------------------- reciprocal rank fusion

/** A ranked list of ids, best first, as one search returned them. */
export interface RankedList {
  name: string;
  ids: string[];
  weight?: number;
}

/** One id's fused score and the share each list gave it. */
export interface Fused {
  id: string;
  score: number;
  shares: { list: string; rank: number; weight: number; share: number }[];
}

/**
 * Reciprocal rank fusion: each list gives an id `weight / (constant + rank)`
 * with rank counted from 1, and the shares add up. Best first; equal scores
 * by id, as the page's fused statements order them.
 */
export function fuse(lists: readonly RankedList[], constant = 60): Fused[] {
  const out = new Map<string, Fused>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    list.ids.forEach((id, i) => {
      const f = out.get(id) ?? { id, score: 0, shares: [] };
      const share = weight / (constant + i + 1);
      f.shares.push({ list: list.name, rank: i + 1, weight, share });
      f.score += share;
      out.set(id, f);
    });
  }
  return [...out.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** "1/(60+1) + 1/(60+3)": the arithmetic of one fused score, as the page shows it. */
export function shareFormula(f: Fused, constant = 60): string {
  return f.shares.map((s) => `${s.weight === 1 ? '1' : String(s.weight)}/(${constant}+${s.rank})`).join(' + ');
}

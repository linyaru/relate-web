// The hybrid lane of search_docs (ADR-0028; DOCS-PLAN.md §3.8): the query
// embedded on Workers AI with the model the sections were embedded with, a
// vector search and the full-text search over the seeded docs graph, fused
// by reciprocal rank with k = 60, the constant of the cookbook's
// hybrid-recall recipe. Pure apart from the AI binding it is handed, so the
// unit tests run it in Node.

/** The Workers AI model and pooling (src/lib/docs/graph.ts EMBEDDING_MODEL: BAAI/bge-small-en-v1.5, cls, normalized). */
export const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
export const EMBEDDING_POOLING = 'cls';
export const EMBEDDING_DIMENSION = 384;
/** The reciprocal rank fusion constant: a section earns 1 / (RRF_K + rank) from each list it is in. */
export const RRF_K = 60;
/**
 * How many of each lane's best candidates are fused (or the caller's limit,
 * when larger). Measured on the two questions with committed vectors
 * (src/hybrid.test.ts): at 10 the section each question is about ranks
 * first; at 20 and deeper, sections that are middling in both lanes crowd
 * out a section that is near the top of one.
 */
export const HYBRID_DEPTH = 10;

/** The part of the Workers AI binding the lane uses. */
export interface AiBinding {
  run(model: string, input: { text: string[]; pooling?: string }): Promise<unknown>;
}

/**
 * The query's vector, normalized (the sections' vectors are), or a thrown
 * error naming what came back. Workers AI answers `{shape, data, pooling}`
 * with one row of `data` per input text.
 */
export async function embedQuery(ai: AiBinding, text: string): Promise<number[]> {
  const out = (await ai.run(EMBEDDING_MODEL, { text: [text], pooling: EMBEDDING_POOLING })) as { data?: unknown; pooling?: unknown };
  const v = Array.isArray(out?.data) ? (out.data[0] as unknown) : null;
  if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSION || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new Error(`the embedding model returned no ${EMBEDDING_DIMENSION}-value vector`);
  }
  if (out.pooling !== undefined && out.pooling !== EMBEDDING_POOLING) throw new Error(`the embedding model used ${String(out.pooling)} pooling, not ${EMBEDDING_POOLING}`);
  const norm = Math.hypot(...(v as number[]));
  return norm > 0 ? (v as number[]).map((x) => x / norm) : (v as number[]);
}

/**
 * Reciprocal rank fusion of ranked id lists: each id earns 1 / (k + rank)
 * from every list it is in (rank 1-based), the shares add up, ties break by
 * id. The same arithmetic as src/lib/docs/graph.ts HYBRID_STATEMENT.
 */
export function fuse(lists: Record<string, string[]>, k = RRF_K): { id: string; rrf: number; ranks: Record<string, number> }[] {
  const by = new Map<string, { id: string; rrf: number; ranks: Record<string, number> }>();
  for (const [name, ids] of Object.entries(lists)) {
    ids.forEach((id, i) => {
      const e = by.get(id) ?? { id, rrf: 0, ranks: {} };
      if (e.ranks[name] !== undefined) return;
      e.ranks[name] = i + 1;
      e.rrf += 1 / (k + i + 1);
      by.set(id, e);
    });
  }
  return [...by.values()].sort((a, b) => b.rrf - a.rrf || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The hybrid lane's rows: the vector lane's candidates (nearest first) and
 * the full-text lane's (in search_docs's re-rank order) fused, cut to
 * `limit`, each with its fusion score and its rank in each lane.
 */
export function hybridRows<R extends { id: string }>(near: R[], fulltext: R[], limit: number): { r: R; score: number; ranks: { vector: number | null; fulltext: number | null } }[] {
  const byId = new Map<string, R>([...near.map((r) => [r.id, r] as const), ...fulltext.map((r) => [r.id, r] as const)]);
  return fuse({ vector: near.map((r) => r.id), fulltext: fulltext.map((r) => r.id) })
    .slice(0, limit)
    .map((f) => ({ r: byId.get(f.id)!, score: f.rrf, ranks: { vector: f.ranks.vector ?? null, fulltext: f.ranks.fulltext ?? null } }));
}

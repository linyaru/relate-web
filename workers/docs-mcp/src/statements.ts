// The constant statements the Worker runs on the docs instance (ADR-0023:
// no tool accepts Cypher for it; the caller's words and the query's vector
// are bound as parameters, never spliced in). Pure strings, so the unit
// tests run them in Node on public/wasm.

/**
 * search_docs as one canned statement over the `docs` full-text index
 * (src/lib/docs/graph.ts FULLTEXT_INDEX: Section heading and text). The
 * index ranks `$k` candidate sections (CANDIDATES, filter or not); the page
 * filters apply after it, and src/docs.ts re-ranks the candidates and cuts
 * them to the caller's limit. The full-text score counts query-term
 * occurrences, so on its own it favors long sections over the one a heading
 * names; the re-rank needs each section's `length`.
 */
export const SEARCH_STATEMENT = `MATCH (s:Section) SEARCH s IN (FULLTEXT INDEX docs FOR $q LIMIT $k) SCORE AS score
MATCH (p:Page {id: s.page})
WHERE ($section IS NULL OR p.section = $section)
  AND ($surface IS NULL OR EXISTS { MATCH (p)-[:APPLIES_TO]->(:Surface {id: $surface}) })
RETURN s.id AS id, s.page AS page, s.anchor AS anchor, s.heading AS heading, s.url AS url, s.length AS length, score,
       p.title AS title, p.md_url AS md_url, p.section AS section
ORDER BY score DESC, id
LIMIT $k`;

/** How many sections the index ranks for every search, before the filters and the re-rank. */
export const CANDIDATES = 200;

/** The statement that sets the section vectors from `$rows` (src/lib/docs/graph.ts VECTOR_LOAD_STATEMENT). */
export const VECTOR_LOAD_STATEMENT = 'UNWIND $rows AS row MATCH (s:Section {id: row.id}) SET s.embedding = vector(row.v, 384, FLOAT32) RETURN count(s) AS n';

/**
 * The vector lane: the `docs_vector` index's nearest sections to `$vector`
 * (cosine), the same page filters as SEARCH_STATEMENT after the index, in
 * score order.
 */
export const VECTOR_STATEMENT = `MATCH (s:Section) SEARCH s IN (VECTOR INDEX docs_vector FOR $vector LIMIT $k) SCORE AS score
MATCH (p:Page {id: s.page})
WHERE ($section IS NULL OR p.section = $section)
  AND ($surface IS NULL OR EXISTS { MATCH (p)-[:APPLIES_TO]->(:Surface {id: $surface}) })
RETURN s.id AS id, s.page AS page, s.anchor AS anchor, s.heading AS heading, s.url AS url, s.length AS length, score,
       p.title AS title, p.md_url AS md_url, p.section AS section
ORDER BY score DESC, id
LIMIT $k`;

export interface SearchRow {
  id: string;
  page: string;
  anchor: string;
  heading: string;
  url: string;
  text?: string;
  length?: number | null;
  score: number;
  title: string;
  md_url: string;
  section: string;
}

// search_docs's full-text ranking (ADR-0023): the query's words as the
// index sees them, and the re-rank of the index's candidates. Pure, so the
// unit tests run the Worker's whole hybrid pipeline in Node.

export const tokens = (q: string) => q.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** Words left out of the query the index sees: they occur in almost every section, so they only reward long ones. */
export const STOPWORDS = new Set(
  'a an and are as at be by for from how in into is it its of on one or that the their this to what when where which with you your'.split(' '),
);

/** The query's words as the index sees them: lowercased, stopwords dropped (all of them kept when nothing else is left). */
export function queryWords(q: string): string[] {
  const all = tokens(q);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

/**
 * The rank of a candidate section: ten times the share of the query's words
 * that are words of its heading (recall), times one plus the share of the
 * heading's own words, stopwords dropped, that are query words (precision);
 * plus the engine's full-text score divided by log2(2 + the section's length
 * in characters). A section whose heading names the query ranks first, and
 * the heading that is the query ("Exit codes") before one that names it
 * among other words ("Errors and exit codes"); among the rest, a dense short
 * section beats a long one that mentions the words in passing.
 */
export function rankScore(words: string[], heading: string, score: number, length: number | null | undefined): number {
  const own = tokens(heading);
  const ownSet = new Set(own);
  const hits = words.filter((w) => ownSet.has(w)).length;
  const recall = hits / Math.max(words.length, 1);
  const query = new Set(words);
  const named = [...new Set(own.filter((t) => !STOPWORDS.has(t)))];
  const precision = named.filter((t) => query.has(t)).length / Math.max(named.length, 1);
  return 10 * recall * (1 + precision) + Number(score) / Math.log2(2 + (length ?? 1000));
}

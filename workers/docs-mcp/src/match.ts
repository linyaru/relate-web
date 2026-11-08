// Matching an error message as relate printed it against the message
// patterns of the errors reference (`<name>` a variable part, `…` an
// elision). Pure, so explain_error (src/docs.ts) and validate_cypher
// (src/validate.ts) rank the same way, and the unit tests run it in Node.

import type { ErrorEntry } from './types.ts';

/** A message pattern as a regular expression (unanchored, case-insensitive). */
export function patternRegex(pattern: string): RegExp {
  const parts = pattern.split(/(<[^>]+>|…)/);
  const src = parts.map((p, i) => (i % 2 ? '.*?' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(src, 'i');
}

/**
 * How well a reported message matches an entry: a whole-pattern match beats
 * a match on the pattern's fixed opening, and within each, the pattern with
 * more fixed text (the more specific one) ranks first. 0 is no match.
 */
export function messageScore(e: Pick<ErrorEntry, 'message'>, message: string): number {
  if (!e.message) return 0;
  const fixed = e.message.split(/<[^>]+>|…/).join('').length;
  if (patternRegex(e.message).test(message)) return 10_000 + fixed;
  const head = e.message.split(/<[^>]+>|…/)[0].trim();
  return head.length >= 12 && message.toLowerCase().includes(head.toLowerCase()) ? head.length : 0;
}

/** The entries a message matches, best first. */
export function bestMatches<T extends Pick<ErrorEntry, 'message'>>(entries: T[], message: string): T[] {
  return entries
    .map((e) => ({ e, s: messageScore(e, message) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

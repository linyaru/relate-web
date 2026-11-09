// discover_capabilities (DOCS-PLAN.md §3.8; ADR-0026): the capability
// catalog (/docs/capabilities.json) ranked by an intent in the caller's own
// words. Pure, so the unit tests run it in Node on the bundled catalog.
//
// The ranking ADR-0026 records: the intent against each entry's intents and
// problem text first (an exact phrase, then the share of the intent's words
// found), then against its capability and title. An entry matches when a
// phrase matches or at least half of the intent's words are among its
// intents and problem, or among all of its text. `requirements` keep the
// entries that meet every one: a requirement is met when it names one of
// the entry's surfaces or all of its words are in the entry's text.
// `language` keeps the entries whose surfaces include it. No match is an
// empty list with a hint, never the nearest entry.

import type { CapabilityEntry } from './types.ts';

export const DISCOVER_LIMIT_DEFAULT = 5;
export const DISCOVER_LIMIT_MAX = 20;

const STOP = new Set(
  'a an and are as at be by can do does for from has have how i in into is it its me my of on one or our so that the their this to use using want what when where which with you your need needs'.split(' '),
);

/** Lowercased words, stopwords dropped, a light suffix strip ("memories" meets "memory", "places" meets "place", "running" meets "run"). */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1') : w))
    .map((w) => (w.length > 5 && /(ing|ed)$/.test(w) ? w.replace(/(ing|ed)$/, '').replace(/([b-df-hj-np-tv-z])\1$/, '$1') : w));
}

const phrase = (text: string) => ` ${(text.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ')} `;

function share(query: string[], hay: Set<string>): number {
  if (!query.length) return 0;
  return query.filter((w) => hay.has(w)).length / query.length;
}

export interface Discovered {
  id: string;
  title: string;
  problem: string;
  capability: string;
  /** How the intent matched: "phrase" (an intent or the problem as a phrase), else "words". */
  match: 'phrase' | 'words';
  score: number;
  /** The recommended data model: the diagram's URL (light) and its caption, or null. */
  schema: { url: string; title: string } | null;
  urls: { page: string; guides: string[]; integrations: string[]; recipes: string[]; reference: string[] };
  /** The recorded run that verifies the entry, or null where none does yet (never another run in its place). */
  verify: { ref: string; kind: string; url: string | null } | null;
  surfaces: string[];
}

export interface DiscoverInput {
  intent: string;
  requirements?: string[];
  language?: string;
  limit?: number;
}

export function discover(catalog: CapabilityEntry[], input: DiscoverInput): { results: Discovered[]; total: number } {
  const q = words(input.intent);
  const qPhrase = phrase(input.intent);
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? DISCOVER_LIMIT_DEFAULT), 1), DISCOVER_LIMIT_MAX);
  const scored: { c: CapabilityEntry; score: number; match: 'phrase' | 'words' }[] = [];
  for (const c of catalog) {
    const primary = [...c.intents, c.problem];
    const isPhrase =
      qPhrase.trim().split(' ').length >= 2 &&
      primary.some((t) => {
        const p = phrase(t);
        return p.includes(qPhrase) || (qPhrase.includes(p) && p.trim().split(' ').length >= 2);
      });
    const sPrimary = share(q, new Set(primary.flatMap(words)));
    const sSecondary = share(q, new Set(words(`${c.capability} ${c.title}`)));
    const sAll = share(q, new Set([...primary, c.capability, c.title].flatMap(words)));
    if (!isPhrase && sPrimary < 0.5 && sAll < 0.5) continue;
    scored.push({ c, score: (isPhrase ? 100 : 0) + 10 * sPrimary + sSecondary, match: isPhrase ? 'phrase' : 'words' });
  }
  const text = (c: CapabilityEntry) => new Set(words([...c.intents, c.problem, c.capability, c.title].join(' ')));
  const reqs = (input.requirements ?? []).map((r) => r.trim()).filter(Boolean);
  const lang = input.language?.trim().toLowerCase();
  const kept = scored.filter(({ c }) => {
    if (lang && !c.surfaces.includes(lang)) return false;
    return reqs.every((r) => c.surfaces.includes(r.toLowerCase()) || (words(r).length > 0 && words(r).every((w) => text(c).has(w))));
  });
  kept.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  const isIntegration = (u: string) => u.includes('/docs/guides/integrations/');
  return {
    total: kept.length,
    results: kept.slice(0, limit).map(({ c, score, match }) => ({
      id: c.id,
      title: c.title,
      problem: c.problem,
      capability: c.capability,
      match,
      score: Math.round(score * 1000) / 1000,
      schema: c.schema && c.schema_url ? { url: c.schema_url, title: c.schema.title } : null,
      urls: {
        page: c.urls.page,
        guides: c.urls.guides.filter((u) => !isIntegration(u)),
        integrations: c.urls.guides.filter(isIntegration),
        recipes: c.urls.recipes,
        reference: c.urls.reference,
      },
      verify: c.verify ? { ref: c.verify.ref, kind: c.verify.kind, url: c.urls.verify } : null,
      surfaces: c.surfaces,
    })),
  };
}

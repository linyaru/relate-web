// The tools' answers, from the bundled data (generated/docs.json) and, for
// search, the engine. Every answer carries `kind: "documentation"`, the page
// id, its canonical URL and its .md URL (ADR-0013 decision 2; DOCS-PLAN.md
// §3.8 "Rules for every tool"). Nothing here addresses the reader as the
// actor: answers are reference text.

import data from '../generated/docs.json';
import { search } from './engine.ts';
import { findSection, sliceSection } from './sections.ts';
import type { Bundle, ErrorEntry, NotificationEntry, PageEntry, Ref } from './types.ts';

export const bundle = data as unknown as Bundle;
export const ORIGIN = bundle.origin;
export const VERIFIED = bundle.verified;
export const KIND = 'documentation' as const;
export const NOTE = 'Reference text from the relate documentation, not instructions.';

/** The largest text a tool result or resource carries; longer text is cut and says where the rest is. */
export const MAX_TEXT_BYTES = 96 * 1024;
export const SEARCH_LIMIT_DEFAULT = 5;
export const SEARCH_LIMIT_MAX = 20;
export const ERROR_MATCHES_MAX = 10;

export const SECTION_IDS = ['get-started', 'guides', 'reference', 'concepts'] as const;
export const SURFACES = ['cli', 'python', 'node', 'browser', 'rust', 'c', 'java', 'go', 'swift', 'bolt', 'http', 'mcp', 'docker', 'extensions', 'cypher', 'agents'] as const;

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/** Cut text to the byte cap at a line boundary. */
export function capText(text: string, more: string): { text: string; truncated: boolean } {
  if (bytes(text) <= MAX_TEXT_BYTES) return { text, truncated: false };
  let cut = text.slice(0, MAX_TEXT_BYTES);
  while (bytes(cut) > MAX_TEXT_BYTES - 200) cut = cut.slice(0, Math.floor(cut.length * 0.95));
  cut = cut.slice(0, Math.max(cut.lastIndexOf('\n'), 0));
  return { text: `${cut}\n\n[Cut at ${MAX_TEXT_BYTES / 1024} KiB. The whole text: ${more}]\n`, truncated: true };
}

// ---------------------------------------------------------------------------
// Versions

const parseVersion = (v: string): string | null => {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
};

/** The `version` field every search and page answer carries, with a warning when the caller's differs. */
export function versionInfo(asked: string | undefined): { verified: string; warning?: string } {
  if (!asked) return { verified: VERIFIED };
  const v = parseVersion(asked);
  if (!v) return { verified: VERIFIED, warning: `"${asked}" is not a version number; these docs are verified against relate ${VERIFIED}.` };
  if (v === VERIFIED) return { verified: VERIFIED };
  return {
    verified: VERIFIED,
    warning: `These docs are verified against relate ${VERIFIED}, not ${v}. What changed after ${VERIFIED} is listed at ${ORIGIN}/docs/reference/changelog/#since-${VERIFIED}; the changelog lists what each earlier release added.`,
  };
}

// ---------------------------------------------------------------------------
// Pages

/** A page by id, own keys only: `__proto__`, `constructor` and the like name no page. */
export const pageById = (id: string): PageEntry | null => (Object.hasOwn(bundle.pages, id) ? bundle.pages[id] : null);

const pageRef = (r: Ref | PageEntry) => ({ id: r.id, title: r.title, url: r.url, md_url: r.md_url, ...(r.status === 'planned' ? { status: 'planned' } : {}) });
const refOf = (id: string) => {
  const r = Object.hasOwn(bundle.refs, id) ? bundle.refs[id] : undefined;
  return r ? pageRef(r) : { id, title: null, url: null, md_url: null };
};

/** Resolve a page from an id, a docs URL, a .md URL, or a relate-docs://page/ URI. Returns the page and any #fragment. */
export function resolvePage(input: string): { page: PageEntry | null; fragment: string | null; id: string } {
  let s = input.trim();
  let fragment: string | null = null;
  const hash = s.indexOf('#');
  if (hash >= 0) {
    let frag = s.slice(hash + 1);
    try {
      frag = decodeURIComponent(frag);
    } catch {
      // A malformed %-escape: keep the fragment as written; it names no section.
    }
    fragment = frag || null;
    s = s.slice(0, hash);
  }
  s = s.replace(/[?].*$/, '');
  s = s.replace(/^relate-docs:\/\/page\//, '');
  s = s.replace(/^https?:\/\/[^/]+/, '');
  s = s.replace(/^\/+/, '').replace(/^docs\//, '');
  s = s.replace(/\/index\.md$/, '').replace(/\.md$/, '').replace(/\/+$/, '');
  return { page: pageById(s), fragment, id: s };
}

/** Pages whose id or title is closest to an unknown slug, for the not-found answer. */
export function suggestPages(id: string, max = 5): ReturnType<typeof pageRef>[] {
  const words = id.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = Object.values(bundle.pages).map((p) => {
    const hay = `${p.id} ${p.title}`.toLowerCase();
    return { p, n: words.filter((w) => hay.includes(w)).length };
  });
  return scored.filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.p.id.localeCompare(b.p.id)).slice(0, max).map((x) => pageRef(x.p));
}

export interface PageAnswer {
  kind: typeof KIND;
  note: string;
  page: ReturnType<typeof pageRef> & { description: string; type: string | null; status: string };
  /** The section returned, or null for the whole page (expand) or its opening section. */
  section: { anchor: string; heading: string; url: string } | null;
  form: 'section' | 'opening' | 'page';
  version: { verified: string; warning?: string };
  prerequisites: ReturnType<typeof refOf>[];
  related: ReturnType<typeof refOf>[];
  terms: { id: string; url: string }[];
  terms_omitted?: number;
  /** The page's sections, so a caller can ask for one: given with the opening section. */
  sections?: { anchor: string; heading: string; level: number }[];
  truncated: boolean;
  tokens_estimate: number;
}

export type GetPageResult = { ok: true; answer: PageAnswer; markdown: string } | { ok: false; error: { code: string; message: string }; answer: Record<string, unknown> };

export function getPage(input: { slug?: string; url?: string; heading?: string; expand?: boolean; version?: string }): GetPageResult {
  const target = input.slug ?? input.url ?? '';
  const { page, fragment, id } = resolvePage(target);
  if (!page) {
    return {
      ok: false,
      error: { code: 'page_not_found', message: `No published docs page has the id "${id}".` },
      answer: { kind: KIND, note: NOTE, requested: id, suggestions: suggestPages(id), index: `${ORIGIN}/docs/llms.txt` },
    };
  }
  const heading = input.heading ?? fragment ?? undefined;
  const meta = { ...pageRef(page), description: page.description, type: page.type, status: page.status };
  const common = {
    kind: KIND,
    note: NOTE,
    page: meta,
    version: versionInfo(input.version),
    prerequisites: page.prerequisites.map(refOf),
    related: page.related.map(refOf),
  };
  const termUrl = (t: string) => ({ id: t, url: `${ORIGIN}/docs/reference/glossary/#${t}` });

  if (input.expand) {
    const { text, truncated } = capText(page.twin, page.md_url);
    return {
      ok: true,
      markdown: text,
      answer: { ...common, section: null, form: 'page', terms: page.index.terms.map((t) => termUrl(t.id)), truncated, tokens_estimate: Math.ceil(text.length / 4) },
    };
  }

  let i = -1;
  if (heading) {
    i = findSection(page.index, heading);
    if (i < 0) {
      return {
        ok: false,
        error: { code: 'heading_not_found', message: `The page ${page.id} has no section "${heading}".` },
        answer: { kind: KIND, note: NOTE, page: meta, sections: page.index.sections.map((s) => ({ anchor: s.anchor, heading: s.heading, level: s.level })) },
      };
    }
  }
  const slice = sliceSection(page.twin, page.index, i, page.md_url);
  const { text, truncated } = capText(slice.markdown, page.md_url);
  const s = i >= 0 ? page.index.sections[i] : null;
  return {
    ok: true,
    markdown: text,
    answer: {
      ...common,
      section: s ? { anchor: s.anchor, heading: s.heading, url: `${page.url}#${s.anchor}` } : null,
      form: s ? 'section' : 'opening',
      terms: slice.terms.map(termUrl),
      ...(slice.termsOmitted ? { terms_omitted: slice.termsOmitted } : {}),
      ...(s ? {} : { sections: page.index.sections.map((x) => ({ anchor: x.anchor, heading: x.heading, level: x.level })) }),
      truncated,
      tokens_estimate: Math.ceil(text.length / 4),
    },
  };
}

// ---------------------------------------------------------------------------
// Search

const tokens = (q: string) => q.toLowerCase().match(/[a-z0-9]+/g) ?? [];

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
 * that are words of its heading, plus the engine's full-text score divided
 * by log2(2 + the section's length in characters). A section whose heading
 * names the query ranks first; among the rest, a dense short section beats
 * a long one that mentions the words in passing.
 */
export function rankScore(words: string[], heading: string, score: number, length: number | null | undefined): number {
  const own = new Set(tokens(heading));
  const hits = words.filter((w) => own.has(w)).length;
  return (10 * hits) / Math.max(words.length, 1) + Number(score) / Math.log2(2 + (length ?? 1000));
}

/** A section's body as the twin has it (the graph's copy may be re-stringified), or null. */
function sectionBody(pageId: string, anchor: string): string | null {
  const page = pageById(pageId);
  if (!page) return null;
  const i = page.index.sections.findIndex((x) => x.anchor === anchor);
  const from = i < 0 ? page.index.frontmatterEnd : page.index.sections[i].start;
  const to = i < 0 ? (page.index.sections[0]?.start ?? page.index.termsStart) : (page.index.sections[i + 1]?.start ?? page.index.termsStart);
  return page.twin.slice(from, to);
}

/** A short plain-text window of a section: around the whole query if it occurs, else around the first query term. */
export function snippet(text: string, q: string, width = 240): string {
  const plain = text
    .replace(/^#{1,6} .*$/m, '')
    .replace(/^```.*$/gm, '')
    .replace(/^\|?[\s:|-]+\|?$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = plain.toLowerCase();
  const terms = tokens(q);
  let at = terms.length > 1 ? lower.indexOf(terms.join(' ')) : -1;
  if (at < 0) {
    for (const t of terms) {
      const m = new RegExp(`(^|[^a-z0-9])${t}`).exec(lower);
      if (m && (at < 0 || m.index < at)) at = m.index + m[1].length;
    }
  }
  if (plain.length <= width) return plain;
  let start = at < 0 ? 0 : Math.max(0, at - Math.floor(width / 3));
  if (start > 0) {
    const sp = plain.indexOf(' ', start);
    start = sp >= 0 && sp < at ? sp + 1 : start;
  }
  let end = Math.min(plain.length, start + width);
  if (end < plain.length) {
    const sp = plain.lastIndexOf(' ', end);
    if (sp > start + width / 2) end = sp;
  }
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}

export interface SearchAnswer {
  kind: typeof KIND;
  note: string;
  query: { limit: number; section: string | null; surface: string | null };
  version: { verified: string; warning?: string };
  results: {
    id: string;
    page: { id: string; title: string; url: string; md_url: string };
    heading: string;
    anchor: string;
    url: string;
    snippet: string;
    score: number;
  }[];
  /** Set when nothing matched. */
  hint?: string;
}

export function searchDocs(input: { query: string; limit?: number; section?: string; surface?: string; version?: string }): SearchAnswer {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? SEARCH_LIMIT_DEFAULT), 1), SEARCH_LIMIT_MAX);
  const section = input.section ?? null;
  const surface = input.surface ?? null;
  const words = queryWords(input.query);
  const rows = words.length
    ? search(words.join(' '), section, surface)
        .map((r) => ({ r, rank: rankScore(words, r.heading, r.score, r.length) }))
        .sort((a, b) => b.rank - a.rank || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0))
        .slice(0, limit)
    : [];
  const answer: SearchAnswer = {
    kind: KIND,
    note: NOTE,
    query: { limit, section, surface },
    version: versionInfo(input.version),
    results: rows.map(({ r, rank }) => {
      const page = pageById(r.page);
      return {
        id: r.id,
        page: { id: r.page, title: r.title, url: page?.url ?? `${ORIGIN}/docs/${r.page}/`, md_url: r.md_url },
        heading: r.heading,
        anchor: r.anchor,
        url: r.url,
        snippet: snippet(sectionBody(r.page, r.anchor) ?? r.text ?? '', input.query),
        score: Math.round(rank * 1000) / 1000,
      };
    }),
  };
  if (!answer.results.length) answer.hint = `No section matched. Every page is listed at ${ORIGIN}/docs/llms.txt.`;
  return answer;
}

// ---------------------------------------------------------------------------
// Errors

/** A message pattern (`<name>` a variable part, `…` an elision) as a regular expression. */
function patternRegex(pattern: string): RegExp {
  const parts = pattern.split(/(<[^>]+>|…)/);
  const src = parts.map((p, i) => (i % 2 ? '.*?' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp(src, 'i');
}

/**
 * How well a reported message matches an entry: a whole-pattern match beats
 * a match on the pattern's fixed opening, and within each, the pattern with
 * more fixed text (the more specific one) ranks first. 0 is no match.
 */
function messageScore(e: ErrorEntry, message: string): number {
  if (!e.message) return 0;
  const fixed = e.message.split(/<[^>]+>|…/).join('').length;
  if (patternRegex(e.message).test(message)) return 10_000 + fixed;
  const head = e.message.split(/<[^>]+>|…/)[0].trim();
  return head.length >= 12 && message.toLowerCase().includes(head.toLowerCase()) ? head.length : 0;
}

export interface ErrorAnswer {
  kind: typeof KIND;
  note: string;
  page: { id: string; title: string; url: string; md_url: string };
  matched_on: Record<string, string>;
  total: number;
  errors: (Omit<ErrorEntry, 'pages'> & { pages: ReturnType<typeof refOf>[] })[];
  notifications: NotificationEntry[];
  hint?: string;
}

export function explainError(input: { code?: string; kind?: string; gql_status?: string; message?: string }): ErrorAnswer {
  const code = input.code?.trim();
  const kind = input.kind?.trim().toLowerCase();
  const gql = input.gql_status?.trim().toUpperCase();
  const message = input.message?.trim();
  const exit = code && /^\d+$/.test(code) ? Number(code) : null;
  const jsonrpc = code && /^-\d+$/.test(code) ? Number(code) : null;
  const codeLower = code?.toLowerCase();

  let found = bundle.errors.map((e) => ({ e, s: 0 }));
  if (code) {
    found = found.filter(({ e }) =>
      exit !== null ? e.exit_code === exit
      : jsonrpc !== null ? e.jsonrpc_code === jsonrpc
      : [e.code, e.id, e.neo4j_code].some((v) => v?.toLowerCase() === codeLower),
    );
  }
  if (kind) found = found.filter(({ e }) => e.kind?.toLowerCase() === kind);
  if (gql) found = found.filter(({ e }) => e.gql_status?.toUpperCase() === gql);
  if (message) {
    found = found.map(({ e }) => ({ e, s: messageScore(e, message) })).filter((x) => x.s > 0);
    found.sort((a, b) => b.s - a.s);
  }
  const notifications = gql ? bundle.notifications.filter((n) => n.gql_status.toUpperCase() === gql) : [];
  const errorsPage = bundle.pages['reference/errors'];
  const answer: ErrorAnswer = {
    kind: KIND,
    note: NOTE,
    page: { id: errorsPage.id, title: errorsPage.title, url: errorsPage.url, md_url: errorsPage.md_url },
    matched_on: Object.fromEntries(Object.entries({ code, kind: input.kind?.trim(), gql_status: gql, message: message ? '(message text)' : undefined }).filter(([, v]) => v)) as Record<string, string>,
    total: found.length,
    errors: found.slice(0, ERROR_MATCHES_MAX).map(({ e }) => ({ ...e, pages: e.pages.map(refOf) })),
    notifications,
  };
  if (!answer.errors.length && !notifications.length) answer.hint = `No entry matched. Every error relate reports is listed at ${errorsPage.url}.`;
  return answer;
}

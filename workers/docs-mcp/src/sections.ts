// Section slicing for a docs markdown twin (DOCS-PLAN.md §3.1: "the section
// is the unit"). Pure, so the bundle script (Node, at build time) and the
// Worker (workerd, per request) run the same code. A section's bytes come
// from src/lib/docs/negotiation.ts, the module the Pages function answering
// `?section=` uses, so the two answers are the same bytes.
//
// A twin is `---\n<frontmatter>\n---\n` followed by the page's markdown. A
// section is an H2 or H3 the author wrote (the docs graph's `Section`
// nodes, ADR-0020); the bundle maps each one to byte offsets in the twin
// once, and a request only slices.

import { slug } from 'github-slugger';

import { sliceSection as sliceTwinSection, type HtmlHeading } from '../../../src/lib/docs/negotiation.ts';

/** One heading line of a twin, outside fenced code. */
export interface TwinHeading {
  level: number;
  /** The heading's text as written, without the leading hashes. */
  raw: string;
  /** Offset of the `#` that starts the line. */
  start: number;
  /** Offset just past the line's newline. */
  lineEnd: number;
}

/** A section's place in its twin. */
export interface SectionSpan {
  /** The HTML anchor (`#<anchor>` on the page). */
  anchor: string;
  /** The heading as plain text. */
  heading: string;
  /** 2 or 3. */
  level: number;
  /** Offset of the heading line. */
  start: number;
}

/** What the Worker keeps per twin to slice it. */
export interface TwinIndex {
  /** Offset just past the closing `---\n` of the frontmatter (0 when there is none). */
  frontmatterEnd: number;
  /** Sections in page order. */
  sections: SectionSpan[];
  /** Offset of `## Terms used on this page`, or the twin's length. */
  termsStart: number;
  /** The Terms section's entries, `- **term**: definition`, with the glossary id each one defines. */
  terms: { id: string; line: string }[];
}

export const TERMS_HEADING = 'Terms used on this page';
export const TERMS_CAP = 5;

/** Every ATX heading line outside fenced code blocks. */
export function scanHeadings(md: string): TwinHeading[] {
  const out: TwinHeading[] = [];
  let fence: { char: string; len: number } | null = null;
  let pos = 0;
  while (pos < md.length) {
    const nl = md.indexOf('\n', pos);
    const lineEnd = nl < 0 ? md.length : nl + 1;
    const line = md.slice(pos, nl < 0 ? md.length : nl);
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && line.trim() === f[1]) fence = null;
    } else if (f) {
      fence = { char: f[1][0], len: f[1].length };
    } else {
      const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (h) out.push({ level: h[1].length, raw: h[2], start: pos, lineEnd });
    }
    pos = lineEnd;
  }
  return out;
}

/** A heading's markdown as plain text: code spans, links and emphasis unwrapped. */
export function plainHeading(raw: string): string {
  return raw
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .trim();
}

/** Offset just past the frontmatter block, or 0. */
export function frontmatterEnd(twin: string): number {
  if (!twin.startsWith('---\n')) return 0;
  const close = twin.indexOf('\n---\n', 4);
  return close < 0 ? 0 : close + 5;
}

/** Where a section's subtree ends: the next section at the same or a higher level, or the Terms section. */
export function subtreeEnd(index: TwinIndex, i: number): number {
  const level = index.sections[i].level;
  for (let j = i + 1; j < index.sections.length; j++) {
    if (index.sections[j].level <= level) return index.sections[j].start;
  }
  return index.termsStart;
}

/**
 * Find a section by its anchor, `#anchor`, its heading text (case-insensitive),
 * or the github-slugger slug of its heading, which `?section=` also accepts
 * (the glossary's `write-write conflict` has the id `conflict` and the slug
 * `write-write-conflict`).
 */
export function findSection(index: TwinIndex, heading: string): number {
  const want = heading.trim().replace(/^#/, '');
  let i = index.sections.findIndex((s) => s.anchor === want);
  if (i >= 0) return i;
  const lower = want.toLowerCase();
  i = index.sections.findIndex((s) => s.anchor.toLowerCase() === lower);
  if (i >= 0) return i;
  i = index.sections.findIndex((s) => s.heading.toLowerCase() === lower);
  if (i >= 0) return i;
  return index.sections.findIndex((s) => slug(s.heading) === lower);
}

/** The glossary ids a slice of markdown links to (`/docs/reference/glossary/#<id>`). */
export function linkedTerms(md: string): Set<string> {
  const ids = new Set<string>();
  for (const m of md.matchAll(/\/docs\/reference\/glossary\/#([a-z0-9-]+)/g)) ids.add(m[1]);
  return ids;
}

export interface SectionSlice {
  /** The markdown returned: frontmatter, the section's subtree, its Terms (at most five) and, for a section, the full-page line. */
  markdown: string;
  /** The terms kept, by glossary id. */
  terms: string[];
  /** How many of the section's terms were left out by the cap. */
  termsOmitted: number;
}

/** The page's heading ids as `sliceTwinSection` pairs them with the twin's headings. */
const headingIds = (index: TwinIndex): HtmlHeading[] => index.sections.map((x) => ({ level: x.level, id: x.anchor, text: x.heading }));

/**
 * One section of a twin. `i` is a section index, or -1 for the opening
 * section.
 *
 * A section is cut by `sliceSection` in src/lib/docs/negotiation.ts, the
 * code the docs' `?section=` answer runs (functions/docs/_middleware.ts),
 * so both return the same bytes: the frontmatter, the heading's subtree
 * (to the next heading of the same or a higher level), the page's Terms
 * entries the subtree uses (a glossary link or the term as a word), at
 * most five, and a `Full page: <url> (markdown: <md url>)` line. `mdUrl`
 * is the page's .md URL, which that line names.
 *
 * The opening section (the H1, the description and the text before the
 * first H2 or H3) has no `?section=` form: it is the frontmatter, those
 * bytes of the twin, and the Terms entries they link.
 */
export function sliceSection(twin: string, index: TwinIndex, i: number, mdUrl?: string): SectionSlice {
  if (i >= 0) {
    const anchor = index.sections[i].anchor;
    const r = sliceTwinSection(twin, anchor, { html: headingIds(index), twinUrl: mdUrl });
    if (!r.ok) throw new Error(`the twin has no section #${anchor}`);
    const idOf = new Map(index.terms.map((t) => [t.line, t.id]));
    return { markdown: r.markdown, terms: r.terms.map((line) => idOf.get(line) ?? line), termsOmitted: r.termsOmitted };
  }
  const fm = twin.slice(0, index.frontmatterEnd);
  const body = twin.slice(index.frontmatterEnd, index.sections[0]?.start ?? index.termsStart).replace(/\s+$/, '');
  const linked = linkedTerms(body);
  const used = index.terms.filter((t) => linked.has(t.id));
  const kept = used.slice(0, TERMS_CAP);
  let markdown = `${fm}${body}\n`;
  if (kept.length) markdown += `\n## ${TERMS_HEADING}\n\n${kept.map((t) => t.line).join('\n')}\n`;
  return { markdown, terms: kept.map((t) => t.id), termsOmitted: used.length - kept.length };
}

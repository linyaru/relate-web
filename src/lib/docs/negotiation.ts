// Content negotiation for the docs (ADR-0005, ADR-0012; DOCS-PLAN.md §3.1, §5).
// The Cloudflare Pages Function in functions/docs/_middleware.ts uses this to
// answer `Accept: text/markdown` on a canonical docs URL with the page's
// markdown twin, and `?section=<anchor>` with one heading's subtree of it.
//
// Shared with a Worker runtime: no Node imports, erasable TypeScript only.

import GithubSlugger from 'github-slugger';

/** At most this many entries of a page's Terms section ride along with one section. */
export const SECTION_TERMS_CAP = 5;

/** The heading the twin closes with (src/lib/docs/twin.ts). */
export const TERMS_HEADING = 'Terms used on this page';

// ---------------------------------------------------------------------------
// Accept

interface AcceptEntry {
  type: string;
  q: number;
  order: number;
}

function parseAccept(header: string): AcceptEntry[] {
  const out: AcceptEntry[] = [];
  header.split(',').forEach((part, order) => {
    const [range, ...params] = part.split(';').map((s) => s.trim());
    if (!range) return;
    let q = 1;
    for (const p of params) {
      const m = /^q\s*=\s*([0-9.]+)$/i.exec(p);
      if (m) q = Math.min(1, Math.max(0, Number(m[1]) || 0));
    }
    out.push({ type: range.toLowerCase(), q, order });
  });
  return out;
}

/**
 * True when the Accept header prefers markdown to HTML: `text/markdown` is
 * named explicitly with q > 0, and its q is higher than the q that applies
 * to `text/html` (from `text/html`, else `text/*`, else `*\/*`), or equal
 * to it and listed first. Wildcards never select markdown, so a browser's
 * `text/html,…,*\/*;q=0.8` keeps the HTML; `text/markdown, text/html` (a
 * harness listing markdown first) gets markdown.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const entries = parseAccept(accept);
  const md = entries.find((e) => e.type === 'text/markdown');
  if (!md || md.q <= 0) return false;
  const html = entries.find((e) => e.type === 'text/html') ?? entries.find((e) => e.type === 'text/*') ?? entries.find((e) => e.type === '*/*');
  if (!html) return true;
  if (md.q !== html.q) return md.q > html.q;
  return md.order < html.order;
}

// ---------------------------------------------------------------------------
// URLs

/**
 * The twin's path for a canonical docs page path, or null when the path is
 * not one: `/docs` and `/docs/` map to `/docs/index.md`, `/docs/<id>/` (or
 * without the slash) to `/docs/<id>.md`. A path whose last segment has a
 * dot (`.md`, `.json`, `.txt`, `index.html`, …) is a file, not a page.
 * The caller still checks the twin's canonical URL (`isOwnTwin`).
 */
export function twinPathFor(pathname: string): string | null {
  if (!/^\/docs(\/|$)/.test(pathname)) return null;
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '/docs') return '/docs/index.md';
  const id = trimmed.slice('/docs/'.length);
  // A page id is lowercase words joined by `-` and `/`. Anything else (a
  // dot, `_`, `%`, a backslash, an empty segment) is not a page; in
  // particular a percent-encoded `../` (`%2E%2E%2F`), which the asset
  // server would decode after this check, never names a twin.
  if (!PAGE_ID.test(id)) return null;
  return `/docs/${id}.md`;
}

/** The shape of a docs page id (src/content/docs/README.md: lowercase, hyphenated path segments). */
export const PAGE_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

/**
 * True when a twin is the twin of the page at `pathname`: its frontmatter's
 * canonical URL has that path (with the trailing slash). `/docs/feedback/`
 * (feedback.md is not a page), `/docs/changelog/` (a copy of
 * reference/changelog) and `/docs/<id>/index/` (the twin's `/index.md`
 * copy) have a file at the twin's path but are not pages.
 */
export function isOwnTwin(pathname: string, canonicalUrl: string | null): boolean {
  if (!canonicalUrl) return false;
  let canonicalPath: string;
  try {
    canonicalPath = new URL(canonicalUrl).pathname;
  } catch {
    return false;
  }
  const want = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return canonicalPath === want;
}

// ---------------------------------------------------------------------------
// The agent-path log (DOCS-PLAN.md §5 "Measurement from day one")

/**
 * What a static path an agent reads is, for the log line, or null: the
 * skill (`/skill.md`, `/skills/…`, the `/.well-known/` skill indexes), an
 * `llms.txt` (the root's or the docs'), a docs twin (`/docs/….md`), or a
 * data block a twin links (`/docs/<page>/data/<name>.json`).
 * Negotiated markdown answers are logged by functions/docs/_middleware.ts.
 */
export function agentPathKind(pathname: string): 'skill' | 'llms' | 'twin' | 'data' | null {
  if (/^\/(skill\.md|skills\/.+|\.well-known\/(agent-skills|skills)\/.+)$/.test(pathname)) return 'skill';
  if (/^\/(docs\/)?llms(-full)?\.txt$/.test(pathname)) return 'llms';
  if (/^\/docs\/.+\.md$/.test(pathname)) return 'twin';
  // A data block a twin links instead of carrying (src/lib/docs/data-blocks.ts, ADR-0049).
  if (/^\/docs\/.+\/data\/[A-Za-z0-9_-]+\.json$/.test(pathname)) return 'data';
  return null;
}

/** One agent-path log line: the kind, the path (no query string), the status and the user agent, each capped. */
export function agentPathLine(kind: string, path: string, status: number, userAgent: string | null): { event: 'docs-agent-path'; kind: string; path: string; status: number; ua: string } {
  return { event: 'docs-agent-path', kind, path: path.slice(0, 200), status, ua: (userAgent ?? '').slice(0, 200) };
}

// ---------------------------------------------------------------------------
// Tokens

/**
 * The `x-markdown-tokens` value: an estimate, not a tokenizer count. It is
 * one token per four characters (UTF-16 code units), rounded up, the usual
 * rule of thumb for English prose and code under current LLM tokenizers.
 */
export function estimateTokens(markdown: string): number {
  return Math.ceil(markdown.length / 4);
}

// ---------------------------------------------------------------------------
// Sections

export interface TwinHeading {
  /** Index of the heading's line in `lines`. */
  line: number;
  level: number;
  text: string;
  /** github-slugger over the plain text, counted in twin order; '' for the H1. */
  slug: string;
  /**
   * The id the page's HTML gives this heading when the HTML was supplied and
   * a heading pairs with it, else the slug; '' for the H1.
   */
  anchor: string;
}

export interface HtmlHeading {
  level: number;
  id: string;
  text: string;
}

export interface ParsedTwin {
  /** The frontmatter block, `---` lines included, or '' when there is none. */
  frontmatter: string;
  /** The body's lines (after the frontmatter). */
  lines: string[];
  headings: TwinHeading[];
  canonicalUrl: string | null;
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** A heading's inline markdown as the plain text the HTML slugger saw. */
export function headingPlainText(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`+([^`]*?)`+/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, '\u00a0')
    .replace(/&amp;/g, '&');
}

/**
 * The headings of a built HTML page that carry an id, in document order:
 * every H2 to H6, and every glossary entry (`<div class="glossary-entry"
 * id="…"><dt>term</dt>`, src/components/docs/), which the twin writes as an
 * H3 and whose id is the term's id (`#conflict` for `write-write conflict`),
 * not the slug of its text.
 */
export function htmlHeadings(html: string): HtmlHeading[] {
  const out: HtmlHeading[] = [];
  const re = /<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>|<div\b([^>]*\bclass\s*=\s*"[^"]*\bglossary-entry\b[^"]*"[^>]*)>\s*<dt\b[^>]*>([\s\S]*?)<\/dt>/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[1] ? m[2] : m[4];
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(attrs) ?? /\bid\s*=\s*'([^']*)'/i.exec(attrs);
    if (!id || !id[1]) continue;
    const inner = m[1] ? m[3] : m[5];
    out.push({ level: m[1] ? Number(m[1]) : 3, id: decodeEntities(id[1]), text: decodeEntities(inner.replace(/<[^>]+>/g, '')).trim() });
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Splits a twin into its frontmatter and body lines and lists its ATX
 * headings outside fenced code. The H1 (the twin's generated title line)
 * takes no anchor and is not counted by the slugger; every other heading is
 * slugged in order, which is how the page's HTML ids are made for authored
 * headings. The twin also carries headings the HTML does not (one per tab,
 * the Terms section) and generated pages choose their own ids (the
 * changelog's `#0.16.1`, the glossary's `#letter-a`), so when the page's
 * HTML is given its heading ids are paired with the twin's headings by text,
 * in order, and a paired heading's anchor is the HTML id.
 */
export function parseTwin(twin: string, html?: string | HtmlHeading[]): ParsedTwin {
  let frontmatter = '';
  let body = twin;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(twin);
  if (fm) {
    frontmatter = fm[0].replace(/\r?\n$/, '');
    body = twin.slice(fm[0].length);
  }
  const canonical = /^canonical_url:\s*["']?(\S+?)["']?\s*$/m.exec(frontmatter);
  const lines = body.split('\n');
  const headings: TwinHeading[] = [];
  const slugger = new GithubSlugger();
  let fence: { char: string; len: number } | null = null;
  lines.forEach((line, i) => {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      return;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { char: open[1][0], len: open[1].length };
      return;
    }
    const h = ATX.exec(line);
    if (!h) return;
    const level = h[1].length;
    const text = (h[2] ?? '').trim();
    const slug = level === 1 ? '' : slugger.slug(headingPlainText(text));
    headings.push({ line: i, level, text, slug, anchor: slug });
  });
  if (html) {
    const fromHtml = typeof html === 'string' ? htmlHeadings(html) : html;
    let next = 0;
    for (const h of headings) {
      if (h.level === 1) continue;
      const text = norm(headingPlainText(h.text));
      const at = fromHtml.findIndex((o, j) => j >= next && norm(o.text) === text);
      if (at < 0) continue;
      h.anchor = fromHtml[at].id;
      next = at + 1;
    }
  }
  return { frontmatter, lines, headings, canonicalUrl: canonical ? canonical[1] : null };
}

/** The anchors `?section=` accepts on a twin, in page order. */
export function sectionAnchors(twin: string | ParsedTwin, html?: string | HtmlHeading[]): string[] {
  const parsed = typeof twin === 'string' ? parseTwin(twin, html) : twin;
  return parsed.headings.filter((h) => h.anchor).map((h) => h.anchor);
}

/** The heading's subtree: its line through the line before the next heading of equal or higher level. */
function subtree(parsed: ParsedTwin, index: number): string[] {
  const h = parsed.headings[index];
  const next = parsed.headings.slice(index + 1).find((o) => o.level <= h.level);
  return parsed.lines.slice(h.line, next ? next.line : parsed.lines.length);
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The Terms entries that go with one section, capped at
 * SECTION_TERMS_CAP: the entries of the page's Terms section whose term the
 * section uses (a link to its glossary anchor, or the term as a word, case
 * ignored), in the page's order. A term the section never uses is left out.
 */
export function sectionTerms(entries: string[], sectionText: string): string[] {
  return usedTerms(entries, sectionText).slice(0, SECTION_TERMS_CAP);
}

/** Every entry of a page's Terms section that a section uses, uncapped, in the page's order. */
export function usedTerms(entries: string[], sectionText: string): string[] {
  return entries.filter((entry) => {
    const m = /^- \*\*(.+?)\*\*:/.exec(entry);
    if (!m) return false;
    const term = m[1];
    const anchor = new GithubSlugger().slug(term);
    if (sectionText.includes(`/docs/reference/glossary/#${anchor})`)) return true;
    return new RegExp(`(^|[^\\p{L}\\p{N}_-])${escapeRegExp(term)}($|[^\\p{L}\\p{N}_-])`, 'iu').test(sectionText);
  });
}

export type SectionResult =
  | {
      ok: true;
      markdown: string;
      /** The anchor the section answered to (the HTML id when paired, else the slug). */
      anchor: string;
      /** The Terms entries kept (at most SECTION_TERMS_CAP), as their `- **term**: …` lines. */
      terms: string[];
      /** How many entries the section uses beyond the cap. */
      termsOmitted: number;
    }
  | { ok: false; anchors: string[] };

/**
 * One section of a twin, for `?section=<anchor>`: the frontmatter block, the
 * heading's subtree, the page's Terms section cut to the terms the section
 * uses (at most five), and a trailer line naming the full page's canonical
 * URL. The anchor is the page's HTML heading id (pass `opts.html`, the
 * built page, so generated pages' ids pair up) or a twin heading's slug. An
 * unknown anchor returns the anchors the page has. The hosted docs MCP
 * server's `get_page` (workers/docs-mcp) answers a heading with this same
 * function, passing the page's heading ids from its bundle as `html`, so
 * `?section=` and `get_page` return the same bytes.
 */
export function sliceSection(
  twin: string,
  anchor: string,
  opts: { html?: string | HtmlHeading[]; fullPageUrl?: string; twinUrl?: string } = {},
): SectionResult {
  const parsed = parseTwin(twin, opts.html);
  let index = parsed.headings.findIndex((h) => h.anchor && h.anchor === anchor);
  // A heading's slug is accepted too (a tab's `### Python` has no HTML id).
  if (index < 0) index = parsed.headings.findIndex((h) => h.slug && h.slug === anchor);
  if (index < 0) return { ok: false, anchors: sectionAnchors(parsed) };

  const body = trimBlank(subtree(parsed, index));
  const parts: string[] = [];
  if (parsed.frontmatter) parts.push(parsed.frontmatter);
  parts.push(body.join('\n'));

  const termsIndex = parsed.headings.findIndex((h) => h.level === 2 && h.text === TERMS_HEADING);
  let kept: string[] = [];
  let used = 0;
  if (termsIndex >= 0 && termsIndex !== index) {
    const entries = subtree(parsed, termsIndex).slice(1).filter((l) => l.startsWith('- '));
    const all = usedTerms(entries, body.slice(1).join('\n'));
    used = all.length;
    kept = all.slice(0, SECTION_TERMS_CAP);
    if (kept.length) parts.push(`## ${TERMS_HEADING}`, kept.join('\n'));
  }

  const full = opts.fullPageUrl ?? parsed.canonicalUrl;
  if (full) parts.push(`Full page: ${full}${opts.twinUrl ? ` (markdown: ${opts.twinUrl})` : ''}`);
  const h = parsed.headings[index];
  return { ok: true, markdown: `${parts.join('\n\n')}\n`, anchor: h.anchor || h.slug, terms: kept, termsOmitted: used - kept.length };
}

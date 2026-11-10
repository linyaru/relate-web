// /docs/reference/changelog/, its twin (also at /docs/changelog.md) and the
// JSON feed at /docs/changelog.json, all from src/content/docs/_data/changelog.json:
// release notes authored here (ADR-0002; upstream's CHANGELOG.md and release
// notes are reading material), one entry per release, newest first.
//
// Anchors: `#<version>` on each release's heading; `#since-<version>` on the
// release that followed <version> (where reading starts for a reader on
// <version>), and for the newest release, on the line that says nothing later
// is listed yet. Every twin links `#since-<verified>` (twin.ts), so the data
// must carry the verified engine version as an entry or as an entry's
// `previous`; rendering throws otherwise. A page whose `since` names a
// release is listed under it.
//
// The one exception is the release refresh (scripts/release-refresh.sh): it
// bumps engine.json but never writes release notes, so it sets
// DOCS_CHANGELOG_PENDING=<version>, which lets that one version render
// without its entry (no `#since-<version>` anchor yet) and turns docs:check's
// error into a warning. CI never sets it, so the merge stays gated.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { esc } from '../../cookbook/result-view.ts';
import { DOCS_DIR } from '../content.ts';
import { CANONICAL_PHRASE } from '../llms.ts';
import { CHANGELOG_FEED_URL, GENERATED_PAGES, pageUrl, twinUrl } from '../model.ts';
import { headingHtml, newest, pageLink, twinHead, type GeneratedContext, type GeneratedPage, type Heading } from './page.ts';
import { inlineHtml, twinLinks } from './table.ts';

export const CHANGELOG_FILE = join(DOCS_DIR, '_data/changelog.json');
export const CHANGELOG_ID = 'reference/changelog';

/** The sections of a release, in the order Keep a Changelog gives them. */
export const SECTIONS = [
  ['added', 'Added'],
  ['changed', 'Changed'],
  ['deprecated', 'Deprecated'],
  ['removed', 'Removed'],
  ['fixed', 'Fixed'],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];

export interface ChangeItem {
  /** One sentence of inline markdown, ending with a period. */
  text: string;
  /** It breaks existing use: a program or statement that worked before can fail. */
  breaking?: boolean;
  /** Page ids, with an optional `#anchor`, that document the change. */
  pages?: string[];
}

export interface Release extends Partial<Record<SectionKey, ChangeItem[]>> {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** RFC 3339, when the publication time is known (the feed's `date_published`). */
  published_at?: string;
  /** The release before it, for the `#since-<previous>` anchor. */
  previous?: string;
  /** One or two sentences of inline markdown. */
  summary?: string;
}

export interface Changelog {
  /** The deprecation policy, as paragraphs of inline markdown. */
  policy: string[];
  releases: Release[];
}

const VERSION = /^\d+\.\d+\.\d+$/;
const KEYS = new Set(['version', 'date', 'published_at', 'previous', 'summary', ...SECTIONS.map(([k]) => k)]);

const cmp = (a: string, b: string) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/**
 * Whether release `a` came out after `b`. By publication, not by number:
 * relate restarted its version line at 0.1.0 after cypherlite's 0.16.1, so
 * 0.1.0 is the newer of the two. The date decides, then `published_at` when
 * both have one, then the version number within one line of releases.
 */
const newerThan = (a: Release, b: Release) => {
  if (a.version === b.version) return false;
  if (a.date !== b.date) return a.date > b.date;
  if (a.published_at && b.published_at && a.published_at !== b.published_at) return Date.parse(a.published_at) > Date.parse(b.published_at);
  return cmp(a.version, b.version) > 0;
};

/** What is wrong with changelog data `raw` (empty when it is well formed). */
export function changelogProblems(raw: Partial<Changelog>): string[] {
  const problems: string[] = [];
  if (!Array.isArray(raw.policy) || !raw.policy.length) problems.push('"policy" is a non-empty list of paragraphs');
  if (!Array.isArray(raw.releases) || !raw.releases.length) problems.push('"releases" is a non-empty list');
  const releases = Array.isArray(raw.releases) ? raw.releases : [];
  const seen = new Set<string>();
  releases.forEach((r, i) => {
    const at = `releases[${i}] (${r.version ?? '?'})`;
    for (const k of Object.keys(r)) if (!KEYS.has(k)) problems.push(`${at}: unknown key "${k}"`);
    if (!VERSION.test(r.version ?? '')) problems.push(`${at}: "version" is MAJOR.MINOR.PATCH`);
    if (r.previous !== undefined && !VERSION.test(r.previous)) problems.push(`${at}: "previous" is MAJOR.MINOR.PATCH`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '')) problems.push(`${at}: "date" is YYYY-MM-DD`);
    if (r.published_at !== undefined && !(String(r.published_at).startsWith(r.date) && !Number.isNaN(Date.parse(r.published_at)))) {
      problems.push(`${at}: "published_at" is an RFC 3339 time on "date"`);
    }
    if (i > 0 && VERSION.test(r.version ?? '') && VERSION.test(releases[i - 1].version ?? '') && !newerThan(releases[i - 1], r)) {
      problems.push(`${at}: releases are newest first, each version once`);
    }
    if (seen.has(r.version)) problems.push(`${at}: releases are newest first, each version once`);
    seen.add(r.version);
    if (!SECTIONS.some(([k]) => r[k]?.length)) problems.push(`${at}: lists no change`);
    for (const [k] of SECTIONS) {
      if (r[k] !== undefined && !Array.isArray(r[k])) {
        problems.push(`${at}.${k}: a list of items`);
        continue;
      }
      for (const [j, item] of (r[k] ?? []).entries()) {
        if (typeof item.text !== 'string' || !/[.]$/.test(item.text.trim())) problems.push(`${at}.${k}[${j}]: "text" is a sentence ending with a period`);
        for (const key of Object.keys(item)) if (!['text', 'breaking', 'pages'].includes(key)) problems.push(`${at}.${k}[${j}]: unknown key "${key}"`);
        if (item.pages !== undefined && !(Array.isArray(item.pages) && item.pages.every((p) => typeof p === 'string' && !p.startsWith('/')))) {
          problems.push(`${at}.${k}[${j}]: "pages" lists page ids (reference/errors#<id>)`);
        }
      }
    }
  });
  return problems;
}

/** _data/changelog.json, read now and checked; throws listing every problem. */
export function changelogData(): Changelog {
  const raw = JSON.parse(readFileSync(CHANGELOG_FILE, 'utf8')) as Partial<Changelog>;
  const problems = changelogProblems(raw);
  if (problems.length) throw new Error(`${CHANGELOG_FILE}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return raw as Changelog;
}

/** The release each `#since-<version>` anchor sits on: version → the release that followed it, or null for the newest. */
export function sinceTargets(c: Changelog): Map<string, string | null> {
  const out = new Map<string, string | null>([[c.releases[0].version, null]]);
  c.releases.forEach((r, i) => {
    const prev = r.previous ?? c.releases[i + 1]?.version;
    if (prev && !out.has(prev)) out.set(prev, r.version);
  });
  return out;
}

const sinceId = (v: string) => `since-${v}`;
const sectionId = (v: string, k: string) => `${v}-${k}`;

/** Pages whose `since` names release `version` (`0.17` names `0.17.0`). */
function introducedIn(version: string, ctx: GeneratedContext): string[] {
  return [...ctx.since]
    .filter(([, s]) => s === version || (s.split('.').length === 2 && `${s}.0` === version))
    .map(([id]) => id)
    .sort();
}

/** An item as inline markdown: the breaking marker, the sentence, and links to the published pages it names. */
function itemMarkdown(item: ChangeItem, ctx: GeneratedContext): string {
  const links = (item.pages ?? []).map((p) => pageLink(p, ctx)).filter((l): l is string => l !== null);
  return `${item.breaking ? '**Breaking.** ' : ''}${item.text.trim()}${links.length ? ` See ${links.join(', ')}.` : ''}`;
}

/** What a release says, in order: date line, summary, sections, back-links, as markdown blocks. */
function releaseBlocks(r: Release, c: Changelog, ctx: GeneratedContext): { kind: 'p' | 'h3' | 'ul'; key?: string; text: string | string[] }[] {
  const prev = r.previous ?? c.releases[c.releases.indexOf(r) + 1]?.version;
  const out: { kind: 'p' | 'h3' | 'ul'; key?: string; text: string | string[] }[] = [
    { kind: 'p', text: `Released ${r.date}.${prev ? ` Changes since ${prev}.` : ''}` },
  ];
  if (r.summary) out.push({ kind: 'p', text: r.summary.trim() });
  for (const [k, label] of SECTIONS) {
    const items = r[k] ?? [];
    if (!items.length) continue;
    out.push({ kind: 'h3', key: k, text: label }, { kind: 'ul', text: items.map((it) => itemMarkdown(it, ctx)) });
  }
  const pages = introducedIn(r.version, ctx).map((id) => pageLink(id, ctx)).filter((l): l is string => l !== null);
  if (pages.length) out.push({ kind: 'p', text: `Documented on: ${pages.join(', ')}.` });
  return out;
}

/** A release's twin section (also the feed item's `content_text`). */
function releaseMarkdown(r: Release, c: Changelog, ctx: GeneratedContext, level = 2): string {
  const parts = [`${'#'.repeat(level)} ${r.version}`];
  for (const b of releaseBlocks(r, c, ctx)) {
    if (b.kind === 'h3') parts.push(`${'#'.repeat(level + 1)} ${b.text as string}`);
    else if (b.kind === 'ul') parts.push((b.text as string[]).map((t) => `- ${twinLinks(t, ctx.pages)}`).join('\n'));
    else parts.push(twinLinks(b.text as string, ctx.pages));
  }
  return parts.join('\n\n');
}

/** Whether the release refresh marked `version`'s changelog entry as still to be written (DOCS_CHANGELOG_PENDING). */
export const changelogPending = (version: string, env: Record<string, string | undefined> = process.env) => !!version && env.DOCS_CHANGELOG_PENDING === version;

function assertSinceVerified(c: Changelog, ctx: GeneratedContext) {
  if (!sinceTargets(c).has(ctx.engine.verified) && !changelogPending(ctx.engine.verified)) {
    throw new Error(
      `${CHANGELOG_FILE}: no entry is, or follows, ${ctx.engine.verified}, the verified engine version (_data/engine.json); ` +
        `every twin links /docs/${CHANGELOG_ID}/#since-${ctx.engine.verified}, so add the release`,
    );
  }
}

const intro = () =>
  `Releases are newest first. Each is at the anchor \`#<version>\`, and \`#since-<version>\` marks where the changes after that version begin. ` +
  `The same entries are a JSON feed at [${CHANGELOG_FEED_URL}](${CHANGELOG_FEED_URL}).`;

function render(ctx: GeneratedContext) {
  const meta = GENERATED_PAGES.find((p) => p.id === CHANGELOG_ID)!;
  const c = changelogData();
  assertSinceVerified(c, ctx);
  const since = sinceTargets(c);
  const latest = c.releases[0].version;
  const noneLater = `No release after ${latest} is listed yet.`;
  const sinceOn = (v: string) => [...since].filter(([, target]) => target === v).map(([from]) => sinceId(from));

  const headings: Heading[] = [
    ...c.releases.map((r) => ({ depth: 2, slug: r.version, text: r.version })),
    { depth: 2, slug: 'deprecation-policy', text: 'Deprecation policy' },
  ];
  const anchors = new Set<string>(headings.map((h) => h.slug));
  since.forEach((_, from) => anchors.add(sinceId(from)));

  const html: string[] = [`<p>${inlineHtml(intro(), ctx.pages)}</p>`, `<p class="changelog-latest" id="${esc(sinceId(latest))}">${esc(noneLater)}</p>`];
  for (const r of c.releases) {
    // Extra `since-` anchors (more than one version followed by this release) sit on empty spans before the section.
    const [first, ...more] = sinceOn(r.version);
    html.push(more.map((id) => `<span id="${esc(id)}"></span>`).join(''));
    html.push(`<section class="changelog-release"${first ? ` id="${esc(first)}"` : ''}>`);
    html.push(headingHtml({ depth: 2, slug: r.version, text: r.version }));
    for (const b of releaseBlocks(r, c, ctx)) {
      if (b.kind === 'h3') {
        const id = sectionId(r.version, b.key!);
        anchors.add(id);
        html.push(headingHtml({ depth: 3, slug: id, text: b.text as string }));
      } else if (b.kind === 'ul') html.push(`<ul>${(b.text as string[]).map((t) => `<li>${inlineHtml(t, ctx.pages)}</li>`).join('')}</ul>`);
      else html.push(`<p>${inlineHtml(b.text as string, ctx.pages)}</p>`);
    }
    html.push('</section>');
  }
  html.push(headingHtml({ depth: 2, slug: 'deprecation-policy', text: 'Deprecation policy' }), ...c.policy.map((p) => `<p>${inlineHtml(p, ctx.pages)}</p>`));

  const body = [
    twinLinks(intro(), ctx.pages),
    noneLater,
    ...c.releases.map((r) => releaseMarkdown(r, c, ctx)),
    '## Deprecation policy',
    ...c.policy.map((p) => twinLinks(p, ctx.pages)),
  ];
  const markdown = `${[twinHead(meta, ctx, newest([CHANGELOG_FILE])), ...body].join('\n\n')}\n`;
  return { html: html.filter(Boolean).join('\n'), headings, markdown, anchors };
}

export const changelogPage: GeneratedPage = {
  meta: GENERATED_PAGES.find((p) => p.id === CHANGELOG_ID)!,
  sources: () => [CHANGELOG_FILE],
  render,
};

/** A link's target on the canonical origin: page ids become their page URL. */
const canonicalPage = (ref: string) => {
  const [id, hash] = ref.split('#');
  return `${CANONICAL_ORIGIN}${pageUrl(id)}${hash ? `#${hash}` : ''}`;
};

/**
 * /docs/changelog.json: the same entries as a JSON Feed 1.1 document
 * (https://www.jsonfeed.org/version/1.1/), one item per release with its
 * twin section as `content_text`; the structured entry, with canonical URLs,
 * is the item's `_relate` extension.
 */
export function changelogFeed(ctx: GeneratedContext): Record<string, unknown> {
  const c = changelogData();
  assertSinceVerified(c, ctx);
  const page = `${CANONICAL_ORIGIN}${pageUrl(CHANGELOG_ID)}`;
  const since = sinceTargets(c);
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'relate changelog',
    home_page_url: page,
    feed_url: `${CANONICAL_ORIGIN}${CHANGELOG_FEED_URL}`,
    description: `${CANONICAL_PHRASE}: what each release added, changed, deprecated, removed and fixed, newest first.`,
    language: 'en-US',
    _relate: {
      verified: ctx.engine.verified,
      markdown_url: `${CANONICAL_ORIGIN}${twinUrl(CHANGELOG_ID)}`,
      deprecation_policy: c.policy,
    },
    items: c.releases.map((r, i) => {
      const prev = r.previous ?? c.releases[i + 1]?.version ?? null;
      const sections = Object.fromEntries(
        SECTIONS.filter(([k]) => r[k]?.length).map(([k]) => [
          k,
          r[k]!.map((it) => ({
            text: it.text,
            breaking: it.breaking === true,
            pages: (it.pages ?? []).filter((p) => ctx.pages.has(p.split('#')[0])).map((p) => ({ id: p, url: canonicalPage(p) })),
          })),
        ]),
      );
      return {
        id: `${page}#${r.version}`,
        url: `${page}#${r.version}`,
        title: `relate ${r.version}`,
        ...(r.published_at ? { date_published: r.published_at } : {}),
        content_text: releaseMarkdown(r, c, ctx, 2),
        _relate: {
          version: r.version,
          date: r.date,
          previous: prev,
          ...(prev && since.get(prev) === r.version ? { since_url: `${page}#since-${prev}` } : {}),
          ...(r.summary ? { summary: r.summary } : {}),
          ...sections,
        },
      };
    }),
  };
}

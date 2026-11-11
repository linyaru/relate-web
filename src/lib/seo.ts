// Head metadata and structured data shared by every page (ADR-0058): the one
// switch that makes the site indexable, absolute URLs on the canonical origin,
// and the JSON-LD builders. Pure and free of Node imports beyond `process.env`,
// so the layouts, the sitemap and the checks all read the same answers.

import { CANONICAL_ORIGIN } from './cookbook/links.ts';

export const SITE_NAME = 'relate';
export const SITE_TAGLINE = 'The embedded graph database for AI agents.';
/** The default social card (1200×630, `public/og/default.png`). */
export const OG_IMAGE = '/og/default.png';
export const OG_IMAGE_ALT = 'The relate logomark above the word Relate, white on blue.';
export const GITHUB_URL = 'https://github.com/relatedb/relate';

/**
 * Whether the build is for search engines. On by default (the site is open to
 * indexing); a build with `PUBLIC_INDEXABLE=false`, such as a preview, says
 * `noindex, nofollow` on every page and `/robots.txt` disallows everything.
 */
export function indexable(): boolean {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return (env?.PUBLIC_INDEXABLE ?? process.env.PUBLIC_INDEXABLE) !== 'false';
}

/** A site path or URL as an absolute URL on the canonical origin. */
export const absolute = (path: string) => new URL(path, CANONICAL_ORIGIN).href;

/** A path with exactly one trailing slash, query and hash dropped (the canonical form of a page). */
export const canonicalPath = (pathname: string) => pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');

export type JsonLd = Record<string, unknown>;

const ORG_ID = `${CANONICAL_ORIGIN}/#organization`;
const SITE_ID = `${CANONICAL_ORIGIN}/#website`;
const APP_ID = `${CANONICAL_ORIGIN}/#software`;

/** The home page's graph: the project, the site and the software. */
export function homeGraph(engine: { version: string; date: string }, description: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORG_ID,
        name: SITE_NAME,
        alternateName: 'relatedb',
        url: `${CANONICAL_ORIGIN}/`,
        logo: absolute('/icon-512.png'),
        sameAs: [GITHUB_URL],
      },
      {
        '@type': 'WebSite',
        '@id': SITE_ID,
        url: `${CANONICAL_ORIGIN}/`,
        name: SITE_NAME,
        description: SITE_TAGLINE,
        inLanguage: 'en',
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': APP_ID,
        name: SITE_NAME,
        alternateName: 'relatedb',
        description,
        url: `${CANONICAL_ORIGIN}/`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows',
        softwareVersion: engine.version,
        dateModified: engine.date,
        // Free and open source; `offers` is what Google's software-app result asks for.
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        sameAs: [GITHUB_URL],
        publisher: { '@id': ORG_ID },
      },
    ],
  };
}

export interface ArticleInput {
  title: string;
  description: string;
  /** The page's path on the site. */
  path: string;
  /** `YYYY-MM-DD`. */
  modified?: string;
  /** `YYYY-MM-DD`, the page's first commit; becomes datePublished. */
  published?: string;
  /** The page's trail, outermost first; a crumb with no `href` is skipped. The page itself is added last. */
  crumbs?: { label: string; href: string | null }[];
  /** `Cypher` for a recipe. */
  language?: string;
}

/** A guide, concept, reference page or recipe: a TechArticle with its breadcrumb trail. */
export function articleGraph(a: ArticleInput): JsonLd {
  const url = absolute(canonicalPath(a.path));
  const items = [...(a.crumbs ?? []).filter((c) => c.href), { label: a.title, href: url }];
  const graph: JsonLd[] = [
    {
      '@type': 'TechArticle',
      '@id': `${url}#article`,
      headline: a.title,
      description: a.description,
      url,
      inLanguage: 'en',
      ...(a.modified ? { dateModified: a.modified } : {}),
      ...(a.published ? { datePublished: a.published } : {}),
      ...(a.language ? { about: { '@type': 'ComputerLanguage', name: a.language } } : {}),
      isPartOf: { '@id': SITE_ID },
      publisher: { '@id': ORG_ID },
      mainEntityOfPage: url,
    },
  ];
  if (items.length > 1) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: items.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.label,
        item: absolute(c.href as string),
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** An index page (the cookbook): a CollectionPage. */
export function collectionGraph(title: string, description: string, path: string): JsonLd {
  const url = absolute(canonicalPath(path));
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${url}#page`, name: title, description, url, inLanguage: 'en', isPartOf: { '@id': SITE_ID } },
    ],
  };
}

/** JSON-LD as the text of a `<script type="application/ld+json">`: `<` escaped so the data can never close the tag. */
export const jsonLdText = (data: JsonLd) => JSON.stringify(data).replaceAll('<', '\\u003c');

/** The body of `/robots.txt` for the build. */
export function robotsTxt(): string {
  return indexable()
    ? `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL_ORIGIN}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
}

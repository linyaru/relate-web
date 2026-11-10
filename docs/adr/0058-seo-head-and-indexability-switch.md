# ADR-0058: One shared page head, JSON-LD per page kind, and a single switch for indexing

Status: Proposed

Date: 2026-11-10

## Context

The site is built to be read by people, search engines and agents, and is now open to
indexing. Whether it is indexable lived in three unconnected places (a meta tag in the
section layout, another in the home page, and a hand-written `robots.txt`), so a build could
change one and miss the others, and there was no way to build a preview that stays out of
search. Head tags were copied across four templates and had drifted: the
Open Graph tags were repeated per layout with no image, Twitter tags existed only on the
home page, every docs page and recipe claimed `og:type` `article` (indexes included), and
only the glossary carried structured data. Shared links showed no preview. The sitemap had
no dates, and the icon set was a 32 px and a 192 px PNG plus an SVG.

## Decision

One component, `SeoHead`, renders the head metadata that is not the title or description:
the robots meta, canonical URL, Open Graph and Twitter cards (large image, with the site name
and the page's modified time for articles), theme colours, the icon and manifest links, a
sitemap link, the markdown alternate and the `describedby` link to the section's agent index,
and any JSON-LD.
`Base.astro` renders it for every section page and the home page renders it directly; the
docs and cookbook layouts pass props to `Base` and no longer write tags.

Structured data is built in one module (`src/lib/seo.ts`) by page kind: Organization, WebSite
and SoftwareApplication on the home page; TechArticle and BreadcrumbList on guides,
concepts, reference pages and recipes; CollectionPage on the cookbook index and the docs
landing. The glossary
keeps its own DefinedTermSet. Dates are the page's first and last change in git (or the
release date for pages without a file of their own), never the build time.

Indexing has one switch. The build is indexable (no robots restriction on a page, a
`robots.txt` that allows everything and names the sitemap) unless `PUBLIC_INDEXABLE=false`,
which gives `noindex, nofollow` on every page and a `robots.txt` that disallows everything,
for a preview or a staging host. The 404 page and the blog placeholder are never indexable. The sitemap lists every page with
`lastmod`, and the playground.

One default social card (`public/og/default.png`, 1200×630) serves every page. The icon set
is rendered from `public/favicon.svg` by `scripts/icons.mjs` and committed.

## Alternatives considered

- **Keep tags in each layout.** Rejected: that is how they drifted.
- **A per-page social image generated at build.** Rejected for now: one card is enough to
  give every shared link a preview, and per-page images can be added to `SeoHead` later
  without changing its callers.
- **Set `noindex` through an HTTP header on the host.** Rejected: the site is served from
  two hosts (one static, one with Functions), so the page itself must carry the answer.
- **Emit `HowTo` or `FAQPage` data.** Rejected: neither earns a search result any more, and
  the pages carry no FAQ markup to describe.

## Consequences

- A preview build is one environment variable, checked in one place; production sets nothing.
- A page kind that needs structured data adds a builder to `src/lib/seo.ts` and passes it
  through its layout; it never writes a `<script>` tag.
- `public/robots.txt` no longer exists; `src/pages/robots.txt.ts` serves the path.
- Absolute URLs in metadata use the canonical origin, never the preview host in
  `astro.config.mjs`.
- Titles, descriptions and copy are unchanged by this decision.

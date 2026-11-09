# ADR-0025: How the docs answer Accept: text/markdown and ?section=

Status: Proposed

Date: 2026-11-07

## Context

ADR-0005 and ADR-0012 put content negotiation for the docs in a Cloudflare
Pages function: a canonical docs URL answers `Accept: text/markdown` with
the page's markdown twin, and `?section=<anchor>` with one section of it
(DOCS-PLAN.md §3.1, §5). Several details were left open, and each one
changes what an agent receives: which Accept headers count as preferring
markdown, what an anchor names when the twin has headings the HTML does not
(one per tab, the Terms section) and generated pages choose their own ids
(the changelog's `#0.16.1`), which terms ride along with a section, how
the token header is computed, and how the function is run without a
Cloudflare account.

## Decision

Markdown is chosen only when `text/markdown` is named with q > 0 and its q
is higher than the q that applies to `text/html` (from `text/html`, else
`text/*`, else `*/*`), or equal to it and listed first. Wildcards never
select markdown, so a browser keeps the HTML, and a harness that sends
`text/markdown, text/html, */*` gets the twin. Only a path shaped like a
page id (lowercase words, `-` and `/`) negotiates, and only when the twin
at its path names that URL as its `canonical_url`: a percent-encoded `../`,
`/docs/feedback/` and the `/index.md` copies never answer with markdown.
Everything else passes through to the static file unchanged, with `Vary:
Accept` on a page URL's HTML, and so do the `.md` URLs.

An anchor is the page's HTML heading id, or a glossary entry's id, which
the twin writes as an H3. The function reads the built HTML page and pairs
those ids with the twin's headings by text, in order.
A twin-only heading answers to its github-slugger slug. An unknown anchor
is a 404 listing the anchors.

A section response is the frontmatter block, the heading's subtree, the
page's Terms entries the section uses (a glossary link or the term as a
word), at most five, and one line naming the full page's canonical URL and
its twin. The hosted docs MCP server's `get_page` returns a section with
the same code, so the two answers are the same bytes (ADR-0023).

`x-markdown-tokens` is the characters divided by four, rounded up, an
estimate rather than a tokenizer count. Markdown responses are
`Cache-Control: private` with `Vary: Accept`, because Cloudflare's cache
ignores `Vary`.

The function logs one line per markdown answer, and a root middleware one
per fetch of a twin, an `llms.txt` or the skill (`/skill.md`, `/skills/*`,
the `/.well-known/` skill indexes): kind, path, status, user agent, and no
query string. `public/_routes.json` limits the paths that invoke a function
to those and `/docs/*`. It is checked
locally on workerd with wrangler run through npx at a pinned version.
Nothing is installed in `functions/`, because wrangler compiles every
script file under that directory.

## Alternatives considered

- **Any Accept that mentions text/markdown.** Simplest, and what some docs
  hosts do. Rejected: a client that ranks HTML first would get markdown
  it did not ask for.
- **Anchors from the twin's slugs alone.** No second asset fetch.
  Rejected: the changelog, the glossary letters and any future generated
  page use ids the slugs do not reproduce, so the URL a reader copies from
  the page would 404.
- **The first five Terms entries.** Literal and cheap. Rejected: the
  entries would often define words the section never uses.
- **A tokenizer for the header.** Exact for one model. Rejected: adds a
  large dependency to the function, and counts differ by model anyway.
- **`?section=` on the `.md` URLs as well**, as DOCS-PLAN.md §3.1 writes
  it. Rejected for phase 1: the `.md` URLs stay plain static files, so
  every host serves them the same way; the canonical URL with a markdown
  Accept carries the section form.

## Consequences

- A `?section=` request reads two assets (twin and HTML); a plain
  negotiated request reads one.
- Every request under `/docs/*`, and every fetch of the skill or the root
  `llms.txt`, invokes a function, including HTML, which counts toward the
  Workers request quota; no other path does.
- The landing page's twin is a different document from its HTML, so the
  landing's HTML ids do not resolve as sections; the check reports them.
- `npm run docs:negotiation-check` enforces these rules on a build.

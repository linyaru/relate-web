# ADR-0018: Generated reference pages, an authored changelog data file and a JSON Feed

Status: Proposed

Date: 2026-11-07

## Context

Phase 1 needs a glossary page and a changelog page (DOCS-PLAN.md §2, §4.11),
the changelog's JSON feed and `/docs/feedback.md` (§3.2, §5 Endpoints). The
glossary's source is `_glossary/`, one file per term (ADR-0009). The
changelog is authored here (ADR-0002). Every twin links
`/docs/reference/changelog/#since-<verified>`, so that anchor must exist.
The five JSX components phase 1 allows (ADR-0015) are spent on `<Install>`,
`<Errors>`, `<ExitCodes>`, `<Flags>` and `<EnvVars>`. A page built from data
is not prose, so an `.mdx` file holding only a component would be a page in
name only and a sixth component.

## Decision

1. **Generated pages are a second kind of docs page.** They are listed in
   `src/lib/docs/model.ts` (id, title, description, order) and rendered from
   data by `src/lib/docs/generated/` to an HTML body and a markdown twin
   with the same frontmatter as an authored page's twin. They have their own
   routes and are published like authored pages: sidebar, `llms.txt`,
   `llms-full.txt`, sitemap, link resolution. No `.mdx` file may claim
   their ids.
2. **The glossary page** files every term under a letter heading at the
   anchor `#<id>`, with its short definition, other names in use, its
   `see` page once that page is published, and its related terms.
3. **The changelog is a data file**, `_data/changelog.json`: per release,
   the version, date, optional publication time and previous version, a
   summary, and items under Added, Changed, Deprecated, Removed and Fixed.
   Each item is one sentence, optionally marked breaking, with page ids to
   link. The deprecation policy is paragraphs in the same file. `#<version>`
   marks a release; `#since-<v>` marks the release after `v`, or for the
   newest release, a line saying nothing later is listed yet. The build
   fails unless the verified engine version is an entry or an entry's
   `previous`.
4. **The feed is JSON Feed 1.1** at `/docs/changelog.json`: one item per
   release, with its twin section as `content_text` and the structured
   entry, with canonical URLs, in the item's `_relate` extension.
   `/docs/changelog.md` serves the changelog twin.
5. **`/docs/feedback.md` is markdown only.** It says the operator decides
   whether a report is sent (ADR-0013), lists what a report holds, and
   names no address until one is published.

## Alternatives considered

- **An `.mdx` page per generated page with a `<Glossary />` or
  `<Changelog />` component.** Fits the one page kind. Rejected: it exceeds
  the five-component cap and adds two more toMarkdown round trips for pages
  that hold no prose.
- **The changelog as MDX prose.** Easiest to write. Rejected: the feed, the
  `since` anchors, the breaking markers and the back-links from pages need
  structure, and one data file feeds the page, the twin and the feed.
- **Atom, or an ad hoc JSON shape, for the feed.** Atom is the older
  standard. Rejected: agents read JSON more readily, and JSON Feed is a
  standard that feed readers parse and that allows a namespaced extension
  for the structured entry.
- **`#since-<v>` on release `v` itself.** Simpler to place. Rejected: a
  reader on `v` needs what came after it, so the anchor marks where that
  begins.

## Consequences

- Adding a generated page takes an entry in `model.ts`, a renderer, and a
  route if it lives outside `reference/`.
- `content.ts` and `scripts/docs.ts` treat the generated ids as published.
  `docs:check` checks generated pages through
  `src/lib/docs/checks/generated.ts`.
- Bumping `_data/engine.json` to a new release needs its changelog entry
  in the same change, or the build fails.
- Phase 2's glossary bodies and filter box extend the generated glossary
  page; they need no new component.
- The docs graph (ADR-0020) does not model generated pages as `Page` nodes
  yet; links to them render in its section text but add no `LINKS_TO`.

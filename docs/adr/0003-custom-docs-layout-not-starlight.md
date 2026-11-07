# ADR-0003: A custom docs layout on the site's design system, not Starlight

Status: Accepted

Date: 2026-11-07

## Context

The docs section needs a sidebar, a table of contents, previous and next
links, search, and MDX. Starlight, Astro's documentation framework,
provides all of that and is the default choice for an Astro docs site. It
also brings its own header, theme, sidebar markup, and CSS.

The site already has a design system: brand tokens from the shared design
system artifact in `src/styles/base.css`, a header component used on every
page, and a cookbook layout built on the shared shell. `MAINTAINING.md`
makes the design system an invariant. The home page still renders legacy
markup during the Astro migration.

## Decision

Build `src/layouts/Docs.astro` on the existing `Base` shell and design
tokens, the way `Cookbook.astro` was built: sidebar generated from the
content collection, table of contents from headings, previous and next,
breadcrumb, and Pagefind for search. Do not adopt Starlight.

Starlight remains the named fallback: if the sidebar and search work grows
beyond what a custom layout justifies, the move is to Starlight with a
heavy theme override, not a redesign of the site.

## Alternatives considered

- **Starlight.** Sidebar, TOC, search, i18n, dark mode, and MDX out of the
  box; the widely used option. Rejected: it is a second design system next
  to the one the site protects, and the docs would feel like a different
  site from the home page and cookbook. What it adds over the cookbook
  layout is a few hundred lines.
- **A hosted docs platform.** No build work. Rejected: the site is static
  and self-hosted by decision, the docs must run the WASM engine in the
  page, and the agent-delivery choices (ADR-0005, ADR-0006) need control of
  the build and the host.

## Consequences

- Sidebar, TOC, previous and next, breadcrumb, mobile navigation, and the
  search UI are this repo's code to maintain.
- Search is Pagefind, indexed after the Astro build and before the
  playground build, over the docs and cookbook.
- The docs share `base.css` tokens and the cookbook's code-block, callout,
  and table styles; a `docs.css` holds what is specific to docs pages.

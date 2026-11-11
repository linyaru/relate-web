# ADR-0055: The top bar is borderless, and the cookbook index is one filterable ruled grid

Status: Proposed

Date: 2026-11-10

## Context

ADR-0044 drew the top bar as a row of ruled cells, following the first export of the home
design. The current export of the design replaces that: the bar has no rules and no cell
borders, its links are plain text, GitHub is a plain link with its mark, and "Get started" is a
filled button with a small radius. A hairline shows only after the page scrolls. The same export
adds a cookbook landing page: a filter bar over one ruled grid of recipe cards. The site's
index instead grouped recipes under category headings in loose rounded cards.

## Decision

The bar follows the current design on every page: 64 px high, no border at rest, a one-pixel
hairline once scrolled, text links that need no hover block, and below 900 px the links fold
into a menu panel with ruled rows. The rest of ADR-0044 stands (footer, theme switch, shared
lockup, `--header-h` read everywhere).

The cookbook index is a wide page: an eyebrow, the title and lede, a filter bar (category,
level, search with the `/` shortcut), then every recipe in one three-column grid ruled by
hairlines with square corners. A card carries a pixel icon for its category, the title, the
summary and a category and level line. Filtering is client-side over server-rendered cards, so
the page is complete without JavaScript. The recipe page's "more in this category" list uses
the same card.

Copy stays what this repository states; the design's placeholder wording is not imported.

## Alternatives considered

- **Keep the ruled-cell bar.** Rejected: it is the superseded export, and the home design no
  longer draws it.
- **Keep the category headings on the index.** Rejected: the design drops them for filters, and
  with a dozen recipes a single grid with a category line reads faster.
- **Render the filters only in the browser.** Rejected: pages here must stay complete without
  JavaScript.

## Consequences

- Header and cookbook index change on every page that uses the shared shell.
- ADR-0044's bar decision is superseded in part; its footer and theme decisions are not.
- The design's "Share a recipe" card and the live GitHub star count are not built: both need
  the public repository.

## Later references

- The "Share a recipe" card is now built as the last tile of the cookbook grid, linking to the public repository; it hides while a filter is active.

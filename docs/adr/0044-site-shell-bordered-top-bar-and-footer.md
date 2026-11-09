# ADR-0044: The site shell is a bordered-cell top bar and a footer that carries the theme switch

Status: Proposed

Date: 2026-11-09

## Context

ADR-0043 moved the tokens and faces to the home design. The shell around every page, the top
bar and the missing footer, still had the old look: a floating bar with rounded buttons and a
theme toggle in the bar. The home design draws the bar as a grid of ruled cells (lockup, links,
call to action), adds a footer of link columns with the theme switch in its legal row, and uses
square corners. The site has nine top-level links where the design has four, so the bar needs a
point at which it folds into a menu.

## Decision

The top bar is a row of ruled cells, 64 px high (`--header-h`): the lockup, the links, and a
filled "Get started" cell. Below 1180 px, where the nine links no longer fit, the links fold into
a menu. Every sticky offset (the docs bar, the sidebar, the cookbook contents, anchor scroll
margins) reads `--header-h`, so the bar's height is set once.

A footer follows every page, on the section layout and on the home page: link columns, then a
legal row with the project line, the GitHub link and a three-way theme switch (system, light,
dark). The choice is stored under `theme` as before; "system" removes it. The theme is applied
by a small inline script in the head, so a stored choice shows without a flash.

The lockup is one shared SVG symbol (`/lockup.svg`) drawn in the logo colour. The footer carries
only the project's own links: the design's columns for other organisations' products are left
out. Its legal row states the same holder and license as the engine's `LICENSE` (Apache-2.0,
"The Relate Authors") and links this repository's own `LICENSE`, which is the same text.

## Alternatives considered

- **Keep the floating bar and add only a footer.** Rejected: the bar is the most visible part of
  the design, and the rebuilt sections assume the ruled grid around them.
- **Cut the links to the design's four.** Rejected: the others are real sections and anchors the
  site needs; folding them into a menu keeps them one tap away.
- **Keep the theme toggle in the bar.** Rejected: the design has no room for it in the cells and
  a three-way switch needs more than one button.

## Consequences

- Header and footer change on every page at once; section layouts inherit them from `Base`.
- The home page's old footer is gone; its links moved into the shared footer.
- The footer's interactive toy and the GitHub star count from the design are not built yet; the
  star count needs a public repository to read.
- If the engine's holder or license changes, the legal row changes with it.

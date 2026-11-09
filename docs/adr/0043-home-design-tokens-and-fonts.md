# ADR-0043: The site takes its colours and type from the Relate home design: Night by default, three open-source faces, the older token names kept as aliases

Status: Proposed

Date: 2026-11-09

## Context

The site's palette (a cream Day theme, Night under a system preference) and its faces
(Public Sans, Fira Code) came from an earlier design-system export. The home design that the
project's designers iterated on uses a different system: neutral surfaces, the Baltic brand
colour, Night as the default theme, and three faces (a sans, a mono and a pixel face for
accents). The site's pages are being rebuilt from that design, section by section, so the
tokens and faces have to match it first, or every later section would carry its own overrides.

The tokens are read by more than CSS: the recipe diagrams and the recorded static forms of
docs elements take their colours from `src/styles/base.css` (ADR-0003 names that file the one
source), so a palette change also changes recordings.

## Decision

`base.css` defines the home design's token names (`--surface-0..3`, `--line`, `--ink`,
`--brand`, `--term-*` and the rest) as the source of truth. Night is the default and the
`:root` block; Day applies under `data-theme="light"`, or under a light system preference when
no theme is chosen. The older names (`--bg`, `--fg`, `--accent`, `--code-*`) stay as aliases of
the new ones, so pages migrate when their section is rebuilt, not all at once. Code and
terminal surfaces follow the theme instead of staying dark in both.

The faces are served from `public/fonts` under the names Relate Sans, Relate Mono and Relate
Pixel. They are Geist, Geist Mono and Pixelify Sans, each under the SIL Open Font License 1.1,
subset to Latin; `public/fonts/LICENSES.md` keeps their notices. The tokens reader for the
diagrams (`src/lib/cookbook/tokens.ts`) takes Night from `:root` and Day from the light block.

## Alternatives considered

- **Keep the earlier palette and add the missing tokens.** Rejected: the rebuilt sections
  assume the new surfaces and Night default, so the two systems would sit side by side.
- **New palette, keep Public Sans and Fira Code.** Rejected: the design's type is part of its
  look, and the new faces ship as small subsets with no licensing cost.
- **Rename every use at once.** Rejected: a large diff across docs and cookbook for no visible
  change; aliases let each section move with its own change.

## Consequences

- The whole site, docs and cookbook included, changes look with one token change, and the
  recorded static forms and diagrams are re-recorded with it.
- The recording code, the diagram renderer and the recorded static forms measure and draw in
  Relate Sans (advance widths read from the font file), so recorded labels match the live ones.
  A change of face means measuring again and re-rendering the diagrams.
- The subsets cover Latin only; text outside it falls back to the system face.
- The aliases are a transition: they are removed when no stylesheet or component uses them.

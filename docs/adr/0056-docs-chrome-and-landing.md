# ADR-0056: Docs and recipe pages get their own ruled header and sidebar; the docs landing is a plain site page

Status: Proposed

Date: 2026-11-10

## Context

The docs landing sat inside the docs shell: a sidebar of every page beside a list of
about 150 task links, under two stacked bars (the site's and a docs bar). The sidebar was
a flat run of small links with little to show where a page sits. Recipe pages used the
site shell alone, with no way to move between recipes.

## Decision

Two shells. The docs landing uses the regular site shell and header, with no sidebar: a title
with search, then "I want to…" as one ruled grid of cards in the cookbook index's style (an
icon, a blurb, the first five tasks, the rest behind a disclosure), then the sections, install
and agent strips.

Docs pages and recipe pages share one chrome: a full-width header with a rule beneath it (the
lockup, the section's name, the site links and search, one bar in place of two), and a sticky
sidebar with a clear hierarchy (section labels, groups as disclosures with a rule down their
pages, the current page marked by a bar and the current group opened and emphasised). On a
recipe page the sidebar lists recipes by category. Below 900 px the sidebar is the header's
menu. Search and the menu script are one module both shells load.

## Alternatives considered

- **Keep the sidebar on the landing.** Rejected: the landing is a map of the docs; a second map
  beside it is the wall of links the change removes.
- **Show every task on the landing.** Rejected: the index is about 150 entries; the disclosure
  keeps it complete (and the twin unchanged) while the page stays scannable.
- **Keep the site header on docs pages.** Rejected: it duplicates the docs bar's job and has no
  rule beneath it at rest, which the docs' two-column layout needs.

## Consequences

- ADR-0055's borderless bar applies to the site shell; docs and recipe pages deliberately keep a rule.
- Recipe pages load the search module (a few KB) they did not before; the 60 KB budget still applies.
- The recipe page's contents column opens at 1400 px instead of 1240 px, as the sidebar takes the width.

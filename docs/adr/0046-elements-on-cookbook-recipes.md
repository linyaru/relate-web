# ADR-0046: Cookbook recipes take the docs pages' interactive elements by the same directive, recorded by the cookbook and loaded by the docs element loader

Status: Proposed

Date: 2026-11-09

## Context

The interactive element framework (ADR-0035) serves docs pages: an element
is a container directive with a recorded static form, a lazily loaded
browser module and a case file, found by directory. Cookbook recipes are
plain markdown files with their own parser, runner, renderer and page
runtime (ADR-0002 keeps both authored here), so phase 2 left elements off
recipe pages. Several recipes are the natural home of an element (a radius
tool beside the geospatial explorer, a fused recall beside the hybrid view,
an agent's memory calls beside a trace), and two more elements are planned
for recipes only (a graph diff and a timeline).

The constraints: a recipe page stays complete without JavaScript and is
checked by `cookbook:check` on every pull request; its markdown twin is the
file agents read; a recipe's recordings are its result blocks plus the run
the cookbook makes anyway, with no results sidecar; and an element must not
need a second implementation to appear on a recipe.

## Decision

**The same directive.** A line `:::<name>{attrs}` at column 0, closed by a
line `:::`, is an element in a recipe, with remark-directive's attribute
syntax and plain markdown children (no fences). The recipe parser finds the
blocks; which names exist is the docs registry's answer, so every element
in `src/lib/docs/elements/` is placeable and no other construct is. A data
block an element names counts as used.

**A recipe is a page to the framework.** Its cells are the page's cells,
each titled by its heading; its data blocks are the page's; its recordings
are the cookbook run, in the docs sidecar's form (each cell's recording and
its last envelope without timings). The element's own build file validates
the directive and makes the static form from them, unchanged.

**The cookbook records.** `cookbook:record` writes each form after the
result blocks, from the same run, into the cookbook's `diagrams/` beside
the recipe's diagrams, stamped as on a docs page. `cookbook:check` and the
build read the forms back and fail on a missing, stale, invalid or orphaned
one; the per-page check and record code is shared with `docs:check` and
`docs:record`.

**The docs runtime renders and loads.** The recipe page renders the
`<docs-element>` host with the static form, as a docs page does, and the
recipe runtime starts the docs element loader on the steps' engine, so
modules load when their host comes near, never with the page. The engine
bar names the version the build replayed on. The twin replaces each
directive with its static form, as a docs twin does; `recipe.json` and
`results.json` stay the steps' alone. The 60 KB budget is measured on
recipe pages, statically and in the browser, and every element's case file
runs at its first docs placement and its first recipe placement.

## Alternatives considered

- **Record recipe forms with `docs:record`.** One recorder. Rejected: it
  would replay recipes a second way and keep a sidecar recipes do not have,
  while the cookbook already holds the run and is the command an author runs
  after changing a recipe.
- **A cookbook-only element runtime.** Recipes keep a separate world.
  Rejected: two loaders and two APIs to keep in step, and every element
  written twice.
- **Fenced blocks (```` ```element geo-explorer ````) instead of the
  directive.** GitHub shows a fence tidily. Rejected: one element would have
  two spellings, and the twin's form would differ by section.

## Consequences

- A new element reaches recipes with no cookbook change: it is placed by its
  directive, and recorded by `cookbook:record`.
- Case files read the page they run on (a recorded result comes from the
  cell or from `results.json`) and pass with a note when a placement leaves
  out an optional attribute.
- An element's `live` sentence must hold for every placement, so it names
  optional parts as optional; the geospatial explorer's does.
- A recipe whose element reads its parameters as separate numbers may need
  a step shaped for it beside its own (nearby-places has one).
- Task skills that cite a changed recipe are recorded again.

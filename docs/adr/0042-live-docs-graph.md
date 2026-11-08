# ADR-0042: The live docs graph draws a build-made view of the docs graph through the one graph module, with a static form that changes only when pages do

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 puts "the docs graph, live" on `reference/docs-graph`
in phase 2: the docs graph (ADR-0007, ADR-0020) drawn with NVL, pages by
section, links and terms, a click through to each page and a search that
picks nodes out. It is not a landing hero (§7.4). The interactive element
framework (ADR-0035, the framework) gives each element a recorded static
form and a browser module; ADR-0010 keeps every NVL use in one module
(`src/scripts/cookbook/graph.ts`) and asks for a table beside every graph.

Three facts shape it. The graph has about 4,000 nodes and 9,000
relationships, and `/docs/graph.json` is about 6 MB with every section's
text; the canvas renderer is comfortable under about 1,000 drawn nodes.
graph.ts draws query results: wire nodes colored by label, laid out by
NVL, expanded from the page's database; it cannot draw a styled graph at
positions given to it. And the docs graph changes with nearly every edit to
any page (a link, a marked term, a CLI flag in a code block), while a
section's embedding is computed from its twin text (ADR-0028), which
carries the element's static form.

## Decision

`:::docs-graph`, with no attribute but `id`, on `reference/docs-graph`.

**A view built with the site.** The build writes `/docs/graph-view.json`
(about 170 KB, 40 KB compressed): the published pages, glossary terms,
capabilities, problems, recipes, CLI commands and flags and surfaces, each
with title, short text, link and position, and the distinct relationships
between them, plus every label's and type's count in the whole graph.
Sections, examples and the two index nodes are left out; each belongs to a
page that is drawn. The element fetches this file, never `graph.json`.

**A layout that depends only on the pages.** Each section's published pages
sit on a sunflower spiral in id order, the four clusters in a two-by-two
grid in sidebar order; every other kind sits on a ring around them, near
the nodes it is joined to. The pages' places follow from the list of pages
alone, not from the links, so the recorded picture stays true until a page
is added, removed or moved, and nothing moves when the view loads.

**The static form** holds only what changes with the page list: each
section's page count, how the live view treats each label and relationship
type, and a light and a dark SVG of the pages where the live view first
draws them, labelled by section. Links and counts are drawn and counted
live from `graph-view.json`; the seed script's header lists the counts for
agents. `validate` rebuilds the form in `docs:check` and fails when the
record differs, since the framework's hash cannot see the docs collection.

**Live**, through one export of graph.ts, `renderNetwork(host, {nodes,
rels}, options)`: NVL's canvas renderer and free layout drawing the given
positions, colors, sizes and captions, with replace, restyle (dim, mark),
fit, zoom, a screen point per node and a state read-back for tests. It
shares graph.ts's theme watcher and wheel gate, recolors instead of using
NVL's selected and disabled states (fixed at start, so stale after a theme
switch), and its camera jumps rather than animating. The element adds a
title search that enlarges matches and dims the rest, a toggle per kind
and per page-to-page relationship type, an inspector naming each node's
neighbors, a click (on touch, a second tap) that opens the page, a table
of the drawn nodes, a table of the whole graph's counts, full screen and
keyboard tools. Until graph.ts exports `renderNetwork`, the element keeps
its static form and the loader reports why.

## Alternatives considered

- **Draw from `graph.json` or the seed on the WASM engine.** One source for
  everything. Rejected: 6 MB or a full seed replay for a picture of 142
  pages, past the page budget's intent.
- **Lay the pages out by their links (d3-force).** Clusters follow the
  real structure. Rejected: positions then change with every link on any
  page, so the recorded picture goes stale on nearly every edit.
- **Exact counts and the section-to-section link table in the static
  form.** Agents read the numbers in the twin. Rejected: every edit would
  stale the form and, through the twin, this page's section embedding,
  which only the authoring-only `docs:embeddings` refreshes.
- **A second module that imports NVL for this element.** No change to the
  shared graph module. Rejected: ADR-0010's one-module rule exists so a
  library or license change is one change, and the copy would miss what
  graph.ts gains.
- **Animate NVL's force layout in the browser.** Livelier. Rejected: motion
  on load with nothing to learn from it, and a different picture each time.

## Consequences

- `src/scripts/cookbook/graph.ts` gains the `renderNetwork` export and its
  types; the element's types mirror them until then.
- Adding, removing, publishing or moving a page stales the form:
  `DOCS_ONLY=reference/docs-graph node scripts/docs.ts --record`, then
  `npm run docs:embeddings` (a new page needs both anyway). A link, term or
  CLI edit elsewhere changes nothing recorded here.
- The element sits below the page's schema tables, out of reach of the
  loader's 600 px margin on a desktop window, so NVL and the view data load
  when the reader scrolls to it, never with the page.
- ADR-0010 gains a Later references line naming this record when it is
  accepted (the one module grows a second kind of view).
- The README's Interactive elements table carries the element's row.

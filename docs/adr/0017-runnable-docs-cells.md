# ADR-0017: Runnable docs cells: recorded sidecars, recorded static graph forms, and a twin-based playground hand-off

Status: Proposed

Date: 2026-11-07

## Context

ADR-0010 makes Cypher examples on docs pages live: runnable on the
shipped WASM, drawn with NVL, each with a built static form that the HTML
shows before JavaScript and the markdown twin carries. The cookbook already
does this for recipes, but its parser stores results inside the recipe's
markdown and its playground hand-off reads a per-recipe `recipe.json`.
Docs pages are MDX (ADR-0002), and a result belongs to the engine, not to
the prose, so the docs needed their own answer to four questions: where
recordings live and how they are kept honest, how a graph result gets its
static picture, how cells take parameters, and how a page opens in the
playground. The build must not need Chrome, and the page's own JavaScript
stays under 60 KB (DOCS-PLAN.md §7.1).

## Decision

A docs cell is a ```` ```cypher run ```` fence; its info string takes
`name=<id>`, `params=<name>` (a ```` ```json data=<name> ```` block on the
page) and `expect=error`. Recordings live in a sidecar beside the page,
keyed by cell id: kind, text, table, graph, and the last envelope with its
timings removed. One command, `node scripts/docs.ts --record`, rewrites
the sidecars from a run on `public/wasm` and nothing else; `docs:check`
replays every page and fails on any difference, on a cell that goes other
than its info string says, and on an engine that is not the one
`_data/engine.json` names.

A graph result's static form is drawn at record time, not at build time:
`--record` lays the recorded graph out with d3-force through the
cookbook's data-model layout and writes a light and a dark SVG beside the
page, stamped with a hash of the graph. Text is measured from a committed
table of Public Sans advance widths, so recording needs no browser. The
build inlines both, checks them inert, and fails when one is missing or
its hash is stale; it also serves them at
`/docs/<page>/result-<cell>-<theme>.svg`, and the twin links the light one.

The page runtime is the cookbook's, moved into one shared module that both
pipelines start with their own options; recorded envelopes and graphs ride
in each cell's markup, so no per-page results endpoint is needed.

The playground hand-off for docs, `#docs=<page>[&cell=<id>]`, reads the
page's markdown twin and takes its cells and parameters blocks from the
fences, with the parser shared between the build and the playground.

## Alternatives considered

- **Draw static graph forms in the Astro build.** No committed SVGs.
  Rejected: the layout runs twelve force simulations per graph on every
  build of every page, and a committed, hashed file can be reviewed as a
  diff, as the mermaid renderings already are.
- **Replay the cells in the build, as the cookbook does.** Drift fails
  the deploy itself. Rejected for now: `docs:check` runs in the same CI
  jobs, and keeping the build free of engine runs keeps docs builds fast
  as the page count grows.
- **A `cells.json` per page for the playground, like `recipe.json`.**
  Rejected: the twin already carries every cell and parameter block
  verbatim, so a second format would be one more thing to keep in step;
  reading the twin also keeps the hand-off on the same text an agent
  reads.
- **Parameters inline in the fence meta.** Shorter. Rejected: JSON in an
  info string cannot hold spaces or newlines, and the cookbook's
  `data=`/`params=` pairing is already known to authors.

## Consequences

- A page with cells commits its sidecar and its graph SVGs; changing a
  cell, the engine or the drawing (`GRAPH_DRAWING_VERSION`) means
  re-recording and reviewing the diff.
- The twin's fence and info-string format is now an interface the
  playground depends on; changing how the twin prints a cell needs the
  shared parser and its test updated in the same change.
- The cookbook and the docs share one runtime module, so a runtime
  change is tested by both pipelines' browser cases.
- Sidecars grow by the recorded envelope; results stay capped at 200 rows
  per statement.
- This refines ADR-0010's static form "laid out at build" to "laid out at
  record time, checked at build".

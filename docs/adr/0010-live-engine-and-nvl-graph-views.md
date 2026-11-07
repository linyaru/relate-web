# ADR-0010: Live engine and NVL graph views as the docs' default, with built static forms

Status: Accepted

Date: 2026-11-07

## Context

The docs' audience is AI engineers and developers who judge a database by
seeing it work. Relate's advantages are visible: it runs in the page over
WebAssembly, results are graphs, every statement returns its plan and
timings, and agents call it over a documented envelope. The cookbook already
runs every recipe step on the shipped WASM in a worker and draws graph
results with NVL, Neo4j's visualization library, pinned at one version with
its telemetry aliased out; the playground draws graphs with the Needle
wrapper over the same library.

NVL's license permits use with Neo4j products only. The maintainers hold
written permission from Neo4j to use NVL on this site for relate. In-browser
database docs that land (DuckDB, SQLite Cloud) run the real engine on the
page; explorable explanations work when they steer attention to one
phenomenon; agents and readers without JavaScript need a static form.

## Decision

Live over static wherever the engine can run it: Cypher examples are
runnable cells on the shipped WASM, numbers come from the run, and graph
results are drawn by NVL by default, through one shared module extended
from the cookbook's. The catalogue of elements and where each lives is
`DOCS-PLAN.md` §7: cells and the graph view, an agent-mode terminal driven
by the engine's envelope, a plan viewer over the engine's plan document,
vector and geospatial explorers, a storage animator, an MCP tryout, an
agent trace playback, the docs graph drawn live on the landing page, and a
WebGL scale demo.

Every live element has a built static form (the recorded result table, an
SVG laid out at build with d3-force, the plan as text) that the HTML shows
before JavaScript runs and the markdown twin carries. The engine and NVL
load on first interaction or when an opted-in element scrolls into view,
never on page load; a page's own JavaScript stays under a budget; layouts
do not animate under reduced motion; every graph has its table beside it.

NVL use is recorded here as a dependency decision: it is used with Neo4j's
permission, pinned, telemetry disabled, canvas renderer by default and
WebGL only for the scale demo, and all use goes through one module so a
license or library change is one change.

## Alternatives considered

- **Static screenshots and diagrams only.** Cheapest, and what most docs
  do. Rejected: the product's claim is that it runs anywhere with nothing
  to deploy; a page that cannot run it undercuts the claim, and the
  cookbook has already proven the live approach on this site.
- **A different graph library** (an open-source force-graph renderer).
  No license question. Rejected: NVL is what the cookbook and playground
  already use, its expand, inspector and theme code exist, and permission
  is in hand; a second renderer would mean two visual languages for the
  same graph.
- **Live elements without static forms.** Less build work. Rejected: it
  fails agents, readers without JavaScript, and the markdown twins
  (ADR-0005), and it makes the page incomplete on a slow connection.

## Consequences

- Phase 1 ships cells, the graph view, the agent-mode terminal, the timing
  bar and the SVG fallbacks; the explorers, plan viewer, animator, MCP
  tryout, trace playback, live docs graph and scale demo are phase 2.
- `docs:check` fails on drift between a cell and its recording; the
  browser check gains a case per element.
- A change to the NVL version, renderer policy, or the permission's scope
  is a new ADR.

## Later references

- Diagrams (DOCS-PLAN.md §7.6, 2026-11-07): hand-drawn diagrams use the
  cookbook's pre-rendered mermaid pipeline, shared between the two
  collections; `accTitle` and a multi-line `accDescr` are required, and
  the markdown twin carries the mermaid source followed by the
  description, so no diagram is only a picture for an agent.

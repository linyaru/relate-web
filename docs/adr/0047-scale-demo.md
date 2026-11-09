# ADR-0047: The scale demo builds a large tree from the page's own cells on a second engine in the tab, draws nothing, and shows only the reader's own run

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 lists a scale demo for `concepts/architecture`: a
hundred thousand nodes built in the reader's tab with `UNWIND range(...)`,
with the count and traversal times updating live, behind a button with a
memory note, desktop first. The plan also had NVL's WebGL renderer draw
the graph. The interactive element framework (ADR-0035) gives each
element a recorded static form and a browser module on the page's one
engine. ADR-0044 removed the performance page: no docs page publishes
timings, throughput or benchmark results.

Three facts shape it. The page's cells share one database, so a hundred
thousand nodes written there would change what every later cell returns
and stay until Reset. A WebAssembly memory grows and never shrinks:
freeing a database inside the worker leaves the tab holding the memory
until the worker ends. And the framework's other database, `runReadOnly`,
is empty and refuses writes.

## Decision

`:::scale-demo{build=<cell> count=<cell> walk=<cell> [sizes=…]}` names
three cells of the page, in that order. The build cell takes `n` from its
parameters block and makes a tree whose relationships point from child to
parent; the count and the walk read it. The cells are recorded at the
page's small `n` like any other, so every statement the demo runs is a
verified example with a recording. On `concepts/architecture` they build a
binary tree of `:Item` nodes in one `UNWIND` statement.

**A database of its own.** The page API gains `scratch()`: a fresh
writable in-memory database in a second engine worker of the same build,
outside the cells' lock, whose `close()` terminates the worker and so
returns every byte. Its runs skip rendering a recording and report the
module's memory size. The page's database and cells never see the tree.
The demo closes it on Free, on the engine bar's Reset, and when the page
unloads. No engine API changes.

**Behind a button.** Nothing runs until the reader presses Build. A note
beside it says the tree lives in this tab's memory until Free. The size
picker offers 1,000, 10,000 and 100,000 nodes (a directive may offer up to
five sizes, at most 200,000); a column at least 720 px wide is offered the
largest first, a narrower one the middle size, since phones give a tab
less memory. Stop closes the engine mid-build.

**No drawing.** The demo shows each cell's first row and engine time in a
table beside its recording, and reruns the count and the walk from a node
the reader names. It does not draw the tree: the numbers the engine
returns are what the demo shows.

**Only the reader's run.** Each time and the status line come from this
tab's run, worded with `liveLine`; the memory line names this tab's second
engine. The static form and the twin say what the demo does and hold the
three recordings at the page's `n`, with no time, memory or speed figure.

**Tests.** The cookbook:browser cases build 100,000 nodes, check the
counts and that nothing is drawn, rerun the walk from another node, and
check that Free, Reset and Stop each put the recordings back.

## Alternatives considered

- **Draw the tree with NVL's WebGL renderer.** The plan's picture of a
  hundred thousand nodes. Built first and then removed by the maintainers:
  NVL 1.2.2 places at most 65,536 nodes in WebGL, so a 100,000-node tree
  could only be drawn in part, and the drawing added a renderer entry
  point, a layout and a test-only browser flag for a picture that carried
  no number the table does not.
- **Write the tree into the page's database under the lock.** No new page
  API. Rejected: later cells would return other results, and the memory
  would stay with the page until Reset.
- **A second database in the page's worker.** No second worker. Rejected:
  the memory it grows stays with the tab after the database is freed, and
  a trap in it would discard the page's database.
- **Generate the statements in the element instead of naming cells.**
  Fewer authoring rules. Rejected: the statements would run without a
  recording or a check.
- **A grid graph instead of a tree.** Rejected: a walk over a grid has to
  stop at a depth or count paths that multiply, and a tree's walk reaches
  every node below one exactly once.
- **Report a memory figure in the static form.** Readers ask what it
  costs. Rejected by ADR-0044; the sizing guide carries measured figures.

## Consequences

- The page API (`src/scripts/docs/element-api.ts`) has `scratch()`, which
  another element may use for a graph that must not touch the page's
  (the graph diff does, ADR-0050).
- graph.ts keeps its two kinds of view; nothing in the docs uses NVL's
  WebGL renderer.
- The architecture page's database gains the small tree when its cells
  run; it shares no label with the cells before it.
- The README's Interactive elements table carries the element's row.

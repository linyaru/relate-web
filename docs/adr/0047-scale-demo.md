# ADR-0047: The scale demo builds a large tree from the page's own cells on a second engine in the tab, draws it with NVL's WebGL renderer, and shows only the reader's own run

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 lists a scale demo for `concepts/architecture`: a
hundred thousand nodes built in the reader's tab with `UNWIND range(...)`,
drawn with NVL's WebGL renderer, with the count and traversal times
updating live, behind a button with a memory note, desktop first. The
interactive element framework (ADR-0035) gives each element a recorded
static form and a browser module on the page's one engine, and keeps NVL
in one module (ADR-0010). ADR-0044 removed the performance page: no docs
page publishes timings, throughput or benchmark results.

Four facts shape it. The page's cells share one database, so a hundred
thousand nodes written there would change what every later cell returns
and stay until Reset. A WebAssembly memory grows and never shrinks:
freeing a database inside the worker leaves the tab holding the memory
until the worker ends. The framework's other database, `runReadOnly`, is
empty and refuses writes. And NVL 1.2.2's canvas renderer draws every node
on the page's thread; its WebGL renderer draws dots and lines on the GPU
without captions or arrowheads, but keeps node positions in one 256 by 256
texture, so it places at most 65,536 nodes and draws any past that at
another node's place. Headless Chrome offers WebGL only through
SwiftShader when asked.

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

**Drawn with WebGL.** graph.ts gains `renderScale` and `webglAvailable`:
NVL's WebGL renderer with the free layout, zoom and pan only (hover and
click would hit-test every node on each pointer move), colours from the
site's tokens, repainted on a theme switch. The demo reads the
relationships back and lays the tree out in rings before drawing, a
ring's radius growing with the square root of the nodes out to it, so
the disc is evenly dense at any size. Nothing moves, under
`prefers-reduced-motion` or not: no layout runs and the camera jumps.
A tree past 65,536 nodes is drawn out to the last whole ring that fits
(at 100,000 nodes, the inner 16 of 17 rings), and the element says so in
words; the engine holds, counts and walks every node. Without WebGL the
cells still run and the tree is not drawn; the view never falls back to
the canvas renderer.

**Only the reader's run.** Each time and the status line come from this
tab's run, worded with `liveLine`; the memory line names this tab's second
engine. The static form and the twin say what the demo does and hold the
three recordings at the page's `n`, with no time, memory or speed figure.

**Tests.** cookbook:browser launches Chrome with SwiftShader WebGL. The
cases build 100,000 nodes and read back from NVL that its WebGL renderer
holds the inner 65,535, draw 1,000 whole, rerun the walk from another
node, and check that Free, Reset and Stop each put the recordings back.

## Alternatives considered

- **Write the tree into the page's database under the lock.** No new page
  API. Rejected: later cells would return other results, and the memory
  would stay with the page until Reset.
- **A second database in the page's worker.** No second worker. Rejected:
  the memory it grows stays with the tab after the database is freed, and
  a trap in it would discard the page's database.
- **Generate the statements in the element instead of naming cells.**
  Fewer authoring rules. Rejected: the statements would run without a
  recording or a check.
- **NVL's force layout on the GPU.** No layout code here. Rejected: motion
  on load, a different picture each time, and nothing to show under
  reduced motion until it settles.
- **A grid graph instead of a tree.** A layout from the ids alone.
  Rejected: a walk over a grid has to stop at a depth or count paths that
  multiply, and a tree's walk reaches every node below one exactly once.
- **Offer at most 65,536 nodes, so every node is drawn.** No cut tree.
  Rejected: the limit is the renderer's, not the engine's, and the demo is
  about the graph the tab holds; the cut is stated where it happens.
- **Report a memory figure in the static form.** Readers ask what it
  costs. Rejected by ADR-0044; the sizing guide carries measured figures.

## Consequences

- The page API (`src/scripts/docs/element-api.ts`) has `scratch()`, which
  another element may use for a graph that must not touch the page's.
- graph.ts has a third kind of view; ADR-0010 gains a Later references
  line naming this record when it is accepted.
- cookbook:browser runs every graph view with WebGL available, as a
  reader's browser does; NVL's layouts there run on SwiftShader.
- The architecture page's database gains the small tree when its cells
  run; it shares no label with the cells before it.
- The README's Interactive elements table carries the element's row, and
  `AGENTS.md` counts nine directives.

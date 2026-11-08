# ADR-0035: Interactive elements are directives with recorded static forms, found by directory and loaded lazily on the page's one engine

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists about ten phase 2 interactive elements (a plan
viewer, an agent-mode terminal, a vector search explorer, a geospatial
explorer, an MCP tryout, a live schema, the docs graph, graph view extras,
a timing bar, agent trace playback), built by separate groups at the same
time. Each must answer its page's question with the engine's own numbers,
be complete without JavaScript with a static form built rather than drawn by
hand, put that form in the markdown twin, keep the page under 60 KB of its
own JavaScript before lazy chunks, load the engine and NVL only on first use,
and get a cookbook:browser case (§7.1, §7.5, ADR-0005, ADR-0010).

ADR-0015 keeps prose constructs in directives rendered by one pipeline to
the page and the twin, and reserves JSX for generated components under a
cap; ADR-0031 added directives under that rule. ADR-0017 gave pages one
engine in a module worker, shared by every cell, with an exclusive lock and
recorded results; the cookbook's runtime is that code. Without a framework
every group would edit the same layout, stylesheet, check script and
browser script, and each would invent its own static form and loading.

## Decision

1. **One directive family.** An element is a container directive named
   after it, `:::<name>{attributes}` … `:::`. Its children are the authored
   part of its static form. Elements do not nest and take no label. Graph
   view extras and the timing bar are words on a cell's info string
   (`timing`, `layout=…`, `highlight=path`, `caption=<property>`), a closed
   set in the parser the build and the playground share, because they
   change how a cell's own result is shown. An unknown directive fails the
   build.
2. **Static forms are recorded.** `docs:record` runs each element's
   `staticForm` on the page's recordings, data blocks and declared input
   files and writes generated markdown and an optional light and dark SVG,
   drawn from the site's tokens, to the page's `diagrams/` sidecar. Each is
   stamped with a hash of its inputs: the element's build file, the helpers
   it imports from its directory, the drawing kit, and the colour tokens
   when it has a picture. The record also holds each picture's SHA-256 and
   one of its words (text, live line, caption). The
   build reads and re-hashes the files and fails on a missing, stale or
   hand-edited one without running element code, so the page build stays
   synchronous and identical in Node and in Vite.
3. **The page and the twin.** The page gets a `<docs-element>` host holding
   the static form (the children, the generated text, the picture and a
   "Live:" sentence) and an empty live pane the module fills. The twin gets
   the children, the generated text, the Live sentence, then a link to the
   light SVG.
4. **Found by directory.** An element is four files named after it: a
   build file (live sentence, validator, static form), a browser module, an
   optional CSS file, and a browser case file. The build, docs:check, the
   element loader and cookbook:browser each discover them by listing a
   directory, so a new element edits no shared file. docs:check fails an
   element without its browser module or case file.
5. **Lazy loading on one engine.** The page runtime starts with the page,
   and only on pages with cells or elements. It imports an element's module
   when the host comes within 600 px of the viewport or the reader points
   at, touches or focuses it. The module receives a page API over the cells'
   session: run on the page's database under the exclusive lock (checked and
   taken in one step, so runs never overlap), run on a fresh read-only
   database, hear every cell run and every reset, the cells with their
   graph views and one pane per module, the engine's readiness, the status
   bar, reduced motion and the one graph module. Element CSS travels inside
   the lazy chunk as text. An element that runs no engine says so, and a
   page without cells then keeps the engine bar out of sight until
   something starts the engine. Elements are destroyed when the page
   unloads; a page kept in the back/forward cache keeps them.
6. **A read-only instance is empty.** A read-only in-memory database loads
   once and refuses writes, so the page's cells cannot seed it; the engine
   raises the refusal when a write executes, not at plan time. The API
   documents both facts and offers the empty instance only for showing a
   refusal.
7. **The budget is measured twice.** `docs:check --built` sums, per built
   docs page, every inline script and every script file it loads with the
   static imports those reach, and fails a page over 60 KB; the page shell
   imports the runtime statically, so it counts, and dynamic imports are
   the lazy chunks. cookbook:browser loads each docs page with the runtime
   and fails one that loads, before any interaction, a script the static
   count misses or more than 60 KB.
8. **One wording for where a number came from.** Every element's status
   line opens with "Recorded on relate <version> when the page was built."
   or "From this tab's run on relate <version>, <time> ms in the engine.",
   and every duration prints with one formatter: one decimal, `<0.1` below
   it. A page that is not cross-origin isolated reads a timer that ticks in
   0.1 ms steps, so a finer figure would claim a precision no reading has.
   The Live sentence is inline markdown, commands and paths in code spans.

## Alternatives considered

- **A JSX component per element.** Reasonable, since elements are
  interactive. Rejected: ten components would break ADR-0015's cap, and the
  authored part of a static form is prose, which directives already render
  to the twin.
- **A hand-edited registry of elements.** Simpler to read. Rejected: every
  group would edit the same file at once, and a stale entry is a silent
  failure; directory listing has neither problem.
- **Drawing static forms during the build.** No sidecar files to review.
  Rejected: the page build is synchronous inside the MDX compiler and runs
  in both Node and Vite, element code would run on every build, and a
  recorded file shows its change in review like the cells' graph pictures.
- **Bundling the engine into the element chunks.** Fewer moving parts.
  Rejected: it would ship the engine once per element and break the rule
  that `public/wasm` loads at runtime and is never bundled.
- **Seeding a read-only database through browser storage (OPFS).** It
  works in the shipped WASM (open `opfs://<name>` writable, seed, free,
  reopen read-only) and would give a populated read-only instance.
  Rejected for now: it writes to the reader's storage and is not available
  in every browser. An element that needs it raises a request.
- **Loading the page runtime with a dynamic import on load.** The first
  version did; the static budget count could not see it. A static import
  in a component the page renders only when it has cells or elements costs
  the same bytes and is counted.

## Consequences

- The docs README gains an "Interactive elements" section with the
  directive family, the static-form rule, the twin form, the lazy-loading
  rule, the budget, the four files and a table with a row per element.
- Changing an element's build file, a helper it imports, the kit or a
  colour token stales every page whose form depends on it until
  `docs:record` runs; what the kit imports is not followed, and an element
  that depends on one of those files names it in `inputs`.
- The engine bar shows on pages with elements but no cells when an element
  runs the engine; an element that needs an engine-bar toggle declares it
  on the bar in the page template.
- cookbook:browser checks every element's static form with scripts
  disabled at 1400 and 390 px and that its module and the engine stay
  unloaded while it is out of reach, before the element's own cases, then
  runs the first case again at phone width and under reduced motion.

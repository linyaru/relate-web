# ADR-0036: Graph view extras live in the one graph module and work on every graph view; cell words set their defaults and the static picture

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists graph view extras for phase 2: path highlighting
for named-path results (the reason the traversal pages exist), a layout
switch for pages about hierarchies, a property-as-caption picker, pinned
nodes and a relationship-type legend. ADR-0010 keeps every NVL use in one
module (`src/scripts/cookbook/graph.ts`, canvas renderer, NVL pinned at
1.2.2) and requires a static form for every visual; the interactive
element framework (ADR-0035, the framework) reserves the cell words
`layout=`, `caption=` and `highlight=path` for these extras and gives each
word a browser module. Cookbook recipes cannot carry words, yet their graph
results benefit as much as the docs pages'. The engine marks a path column
`PATH` in `columnTypes` and sends a path as an alternating list of nodes
and relationships (relate 0.16.1). Reduced motion is the framework's
standing requirement, and graph.ts animated its layout and fit regardless.

## Decision

The extras are features of the graph view itself, not an element beside
it. Every graph view, docs or cookbook, has a controls row (a Layout menu:
force, hierarchical, circular, NVL's `d3Force`, `hierarchical` and
`circular` layouts; a Caption menu listing the property keys of the nodes
drawn; Highlight path when the result holds a path; Pin all and Unpin
all), a full-screen button in its toolbar, Pin and Expand buttons in the
inspector of a clicked node, and a legend that lists relationship types
beside labels. Dragging a node pins it, and only it: NVL's drag moves
every selected node together, and the view selects the path's nodes and
the held element to ring them, so graph.ts gives the drag an empty
selection. A click rings a node without sending its size again: after any
size update NVL's hierarchical and circular layouts place every node
again on their next update, pinned ones too, and a drag is one. A
double-tap on a touch screen pins, a double-click expands (on a touch
screen the inspector opens only
once no second tap came, so its panel never takes the second tap). A
pinned node keeps its place through layout changes, expansions and their
Reset: NVL's hierarchical and circular layouts place every node, so the
view puts each pinned node back once a layout settles. Pins are remembered
per cell with their places, so a run that redraws the view (expanding a
recorded result runs the step first) keeps them. NVL 1.2.2 marks its
circular layout `@experimental`; if it goes, the circular choice becomes a
force layout started from an even circle. Full screen is a modal dialog:
the rest of the page is inert while it shows.

A path is the value of a `PATH` column; when no column is typed `PATH`,
any path value in the rows counts. Highlighting draws the path's nodes
larger, inside NVL's static selection ring (the page's paper inside its
ink, so the ring shows on either theme's pane after a switch; NVL fixes
these colours when it starts), and its relationships five times as wide,
and dims the rest by mixing each element's own colour toward the pane, so
a dimmed node keeps its label's hue. NVL's `activated` state is not used:
it draws a pulse that never stops, motion no reader asked for. The legend
names the path in order, so the highlight is never colour alone. It is off
by default and on with `highlight=path`: a result made only of paths has
nothing to dim, so the word marks the cells that return a path among other
elements. DOCS-PLAN §7.3 can be read as default-on; this departs from it.

A relationship type's colour comes from its name, so a type is the same
colour on every view and page. The colours are the label palette's hues;
the light theme darkens each until it holds 3:1 against the page and the
output pane (unit-tested against base.css). The static picture keeps one
neutral relationship colour: its layout, caption and highlight match the
live first frame, its relationship colours do not.

Cell words set a view's defaults; a reader's choice is remembered for that
cell while the page is open, so a run or Reset keeps it. The cell-word
module (`src/scripts/docs/elements/graph-extras.ts`) only hands the words
and the result's paths to each view and says in the cell's pane what the
words did. The static picture follows the words: hierarchical layers or a
circle laid out at record time, the chosen caption, the path drawn in ink
with the rest faded. A cell without such words keeps its plain picture byte
for byte, and its stamp is unchanged.

Under prefers-reduced-motion the view hides the canvas while a layout runs
(a switch, an expansion, its Reset), shows it settled, fits without
animating, and stops a settled force layout so a drag moves only the node
dragged.

## Alternatives considered

- **A separate element per extra, mounted beside the graph.** It would
  follow the framework's element shape exactly. Rejected: each would need
  hooks into the NVL instance graph.ts owns, cookbook pages would get none
  of it, and five panes around one graph crowd a phone screen.
- **Highlight every path result by default.** The plan reads that way.
  Rejected: a result of paths alone would dim nothing and only thicken
  lines, and the static pictures of existing pages with path cells would
  change for no gain; the button is there on every path result.
- **Colour relationship types by order of appearance on the page.** No two
  types on one page would share a colour. Rejected: the static pictures and
  a re-run view could not agree without page-wide coordination; the type is
  written on every relationship, so a shared hue is never ambiguous.
- **The Fullscreen API.** Rejected: iOS Safari has no element full screen;
  a fixed overlay with Escape works on every phone.

## Consequences

- graph.ts grows by the controls, the legend groups, pins and the
  reduced-motion handling, all in its lazy chunk. The shared model is its
  own module (`src/lib/cookbook/graph-extras-model.ts`), not part of
  graph-model.ts, which the cell runtime imports eagerly: Rollup keeps a
  module whole in one chunk, so the model would otherwise ride in every
  page's eager JavaScript (it added 2.3 KB there until it moved).
- The cell runtime passes each view its envelope and the cell's words
  (session.ts), so every path result, docs or cookbook, has the button.
- The static picture's stamp covers the words and the highlighted path ids
  (results.ts `graphHash`, checks/cells.ts, constructs.ts and the SVG route
  pass them), so a changed word makes the picture stale in docs:check.
- cookbook:browser gains the extras' cases: a highlighted path counted
  against the engine's answer, on a worded docs cell and on a cookbook step
  without words; a layout switch, an expansion and its Reset that move
  nodes while a pinned one stays, also under reduced motion; drag
  pinning only the node dragged while the path and a held node are
  selected, and touch double-tap pinning; the caption word and picker; the type legend;
  full screen as a dialog that keeps Tab inside.

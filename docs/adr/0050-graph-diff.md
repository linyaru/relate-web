# ADR-0050: The graph diff matches two of the page's results by a key property, draws the changes with a mark as well as a colour, and reruns the page's cells on a database of its own

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 lists a graph diff: a migration's before and after in one
view, with added, removed and changed elements coloured, on the migration
rehearsal recipe and on `guides/storage/clone-and-convert`, built on the
graph view. The interactive element framework (ADR-0035) gives an element a
recorded static form and a browser module; recipes take elements by the same
directive (ADR-0045); NVL is drawn only in the one graph module (ADR-0010);
and `page.scratch()` gives an element a database of its own (ADR-0047).

Three facts shape it. Element ids are not stable: another store, a clone, or
the same statements run again on a fresh database may number nodes and
relationships differently, so an id says nothing about which element is
which. A migration cannot be run twice on the page's database: it is not
idempotent, the page's later cells read what it left, and nothing rewinds
it. And colour alone does not carry meaning for every reader, or in a
greyscale print of the picture.

The clone-and-convert guide has no pair the element could compare: its
before and after are two stores on disk, compared by the CLI with `cmp`,
and the browser's engine cannot clone a store. The page has no cells.

## Decision

`:::graph-diff{before=<cell> after=<cell> key=<property>}` names two cells of
the page, `before` first, whose results hold the two states: every node and
relationship in the last statement's rows, inside lists, maps and paths too.

**Identity is the page's key.** A node is its `key` property's value; a
relationship is its type with the key of the node at each end, and parallel
ones of a type are told apart by their properties. A node only in the first
state is removed, only in the second added, in both with other labels or
properties changed, else unchanged; a relationship likewise. A changed type
is a removal and an addition, as a relationship's type cannot change in
place. A node without the key, a key twice in one state, or a relationship
whose end the statement did not return is reported, never guessed; the build
fails when the recordings have one. The diff is of what the statements
return, so a statement that keeps its scope fixed (on the recipe, every
city, linked or not) shows a lost link without a lost node.

**One view, marked three ways.** Each status has a symbol on every caption
and in the table (− removed, + added, ~ changed), a word in the legend, a
line pattern or width, and a colour from the site's tokens. The live view is
the graph module's network view with caption, width and token colours on
relationships; the positions are computed before drawing, from a radial tree
out of the most linked node, by a model the static picture shares, so
nothing moves. The table of changes sits beside the view where the element
is wide and under it otherwise; each row is a button that marks its element
and dims the rest.

**Live, on a database of its own.** The element first draws the recorded
diff. Compare runs the page's cells from the first to `after`, as they stand
in the page, a reader's edits included, on `page.scratch()`, then closes it.
A recipe step whose parameters are a dataset gets them as a Run would: the
page API gains `CellHandle.runParams()`, which fetches the dataset where
`params()` reads only an editable block. Reset brings back the recorded diff.

**Static form.** What was compared and how, the counts, the table of changes
and a light and dark picture of the recorded diff with its legend; a diff of
more than 80 nodes is drawn live only.

**Placement.** On the migration-rehearsal recipe, between Nimbus Labs before
the migration and the same statement after it; not on clone-and-convert.

## Alternatives considered

- **Match by element id.** No key to name. Rejected: ids are not stable
  across stores or runs, so the diff would report renumbering as change.
- **Rerun on the page's database.** No second engine. Rejected: running the
  migration again changes what the page's later cells return.
- **Diff the whole database.** No scope to choose. Rejected: on the recipe
  that is hundreds of relationships, unreadable in one view, and a statement
  the page does not run.
- **Pair a removed and an added relationship with the same ends as one
  changed type.** Reads like the migration's intent. Rejected: it guesses at
  intent the engine does not record.
- **A diff on clone-and-convert from its CLI recordings.** Rejected: nothing
  to rerun in the browser, and the two states are equal by construction.

## Consequences

- The page API has `CellHandle.runParams()`, which any element that reruns a
  recipe step with a dataset can use.
- graph.ts's network view takes token colours, widths and captions on
  relationships; the docs graph is unchanged.
- The migration-rehearsal recipe gains a step before its migration and its
  victim steps return Nimbus Labs's neighbourhood with every city; its task
  skill is recorded again.
- The README's Interactive elements table carries the element's row, and
  `AGENTS.md` counts eleven directives.

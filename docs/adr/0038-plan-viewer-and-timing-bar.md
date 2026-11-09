# ADR-0038: The plan viewer is an HTML tree whose static form is the CLI's plan table, and the timing bar shows only a live run

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists a query plan viewer (EXPLAIN as an operator tree,
PROFILE metrics as bars, the notifications with their remedies, a
before/after toggle around the index a notification names, a speedscope
export) for `tune-a-query`, the `explain-and-profile` reference,
`indexes-and-constraints` and the architecture concept, and a phase timing
bar (parse, plan and execute milliseconds under a result) for any cell.
§7.7 leaves open whether the plan viewer is an NVL hierarchical layout or a
plain HTML tree, to be decided by which reads better at phone width.

The interactive element framework (ADR-0035, the framework record) makes an
element a directive with a recorded static form, and the timing bar a cell
word whose static form is the cell's recorded result. Recordings strip the
envelope's four timing fields so a recording never drifts (ADR-0017). For
the same reason a PROFILE cell cannot be recorded at all: its plan carries
per-operator times that differ on every run. The engine has no server, so
anything the CLI alone prints comes from a recording (ADR-0016); the plan
table and the speedscope file are formatter output, not engine output.

## Decision

1. **`:::plan{cell=<id>}` binds an EXPLAIN cell.** `compare=<id>` names a
   second EXPLAIN cell of the same statement later on the page (after an
   index exists); `index="CREATE INDEX …"` names the index the toggle runs,
   by default the remedy of the plan's missing-index notification (03C91).
   A PROFILE cell is refused: the viewer runs PROFILE live instead.
2. **The static form is the plan as the CLI prints it.** The build turns the
   recorded `relate.plan/v1` document and notifications into the table
   `relate --mode table` prints (columns shown as the CLI shows them, the
   `Warnings:` line, the `Notifications:` block), then lists each
   notification with its remedy and its errors-reference anchor, and with
   `compare`, the second plan and a table of what changed. A unit test
   rebuilds every EXPLAIN table the plan pages record from the binary and
   four PROFILE tables from the same runs' measures, byte for byte. The twin
   carries the tables as `text` fences. No picture: the text is the plan.
3. **Live, an HTML tree.** An indented nested list, root first, one row per
   operator (name, id, estimate, details wrapped, warnings in words). PROFILE
   runs the statement on the page's database after the cells before it and
   adds rows, own time and database hits as bars on one scale across the
   panes, with the numbers as text. A statement whose plan writes gets
   EXPLAIN only. The source line says whether a pane is the recording or
   this tab's run, in the framework's shared wording (ADR-0035). A
   comparison titles its panes by what differs ("Without the index", "With
   <index>"), not by cell id. A notification's colour follows its severity:
   only a WARNING or an ERROR takes the error colour.
4. **The index toggle writes to the page's database, visibly.** Pressed, it
   creates the index (dropping and recreating it first when a cell made it
   already), plans without and with it, and shows both side by side with
   what changed; pressed again, it drops the index it created. An index a
   cell created stays: Drop ends the comparison and says so. The comparison
   holds until Drop or Reset, whatever cells run meanwhile: a cell's plan
   takes the pane for what the database held, read from the engine (the
   plan carries 03C91 for the index exactly when the index is missing), and
   a cell's `CREATE INDEX` that clashes with the viewer's index is explained
   on the status line. Reset undoes it too. The status line names the index
   and says it is on this page's database. On a viewer that compares two
   cells (`compare=`), EXPLAIN and PROFILE plan the statement without and
   with the index in one go and drop an index they created, so the page's
   database ends as it started. While a run is in progress the controls are
   `aria-disabled`, not `disabled`, so keyboard focus stays on the pressed
   button.
5. **The speedscope export is the CLI's bytes.** A PROFILE pane offers a
   download of the evented profile `relate --mode speedscope` writes:
   compact JSON with sorted keys, one frame per operator in pre-order, each
   interval the operator's own time in nanoseconds, children laid out in
   turn and scaled to fit. A profile the CLI refuses (a top operator with no
   measures) is refused with the CLI's message. The unit test checks the
   shape and key order against three CLI recordings, and the scaling
   against upstream's fixture. The file spans the top operator's own time,
   which in a browser is often under the timer's 0.1 ms step; such a file is
   all zeros, and the pane says why under its link. Times in the comparison
   table print as the panes print them, at one decimal.
6. **The timing bar shows only a live run.** The `timing` word, and the
   engine bar's "Show timing" toggle for every cell, draw parse, plan and
   execute from each statement's envelope as a stacked bar with the numbers
   as text, labelled as this tab's run, at one decimal (the step of the
   browser's timer, which the pane states). A module that mounts after the
   reader ran the cell draws from that run's envelopes. A cell showing its
   recording says the recording keeps no timings; that note is kept out of
   the result's live region (`aria-live="off"`), because the toggle writes
   one under every cell at once and the engine bar's status line announces
   the toggle. The visible numbers are the only text: nothing repeats them
   for a screen reader. Its static form is the recorded result,
   with no timings in it, on purpose: a recorded millisecond would be one
   machine's number on one day, which §7.5 forbids showing as the engine's.
   Nothing animates.

## Alternatives considered

- **An NVL hierarchical layout for the tree.** It matches Neo4j Browser and
  reuses the one graph module. Rejected after a spike at 390 x 844: the
  tune-a-query comparison's two PROFILE plans drawn through graph.ts's
  `renderGraph` with the hierarchical layout, beside the HTML tree on the
  same page. NVL gave one two-operator plan about a full phone screen (the
  canvas, the toolbar, the layout and caption controls and the legend), the
  second plan below the fold, and only the operator names, with
  `ProduceResults` wrapped in its circle; the details (up to about 90
  characters on these pages), rows, time and database hits wait in the
  inspector, one operator at a time, and the canvas text cannot be selected
  or found in the page. The tree showed both measured plans, every detail
  and all three measures with their bars, the speedscope links and the
  table of what changed in about two screens, with no tap. It also loads no
  graph chunk for a plan.
- **Recording PROFILE cells with the times masked.** It would give a
  measured static form. Rejected: the recording would hold numbers the
  engine did not return, and the masking would hide real drift in rows and
  database hits.
- **Drawing the static plan as an SVG.** Rejected: §7.5 names the plan text
  as the static form, and an agent reads text better than a picture.
- **A `statement=` attribute instead of a bound cell.** Rejected: its plan
  would have no recording to build the static form from.
- **Recorded timings, labelled with the machine.** Rejected for the static
  form: they would go stale with every engine build and still be one
  machine's numbers; the live bar answers the question on the reader's own
  machine.

## Consequences

- The plan pages carry `:::plan` after an EXPLAIN cell; the architecture
  concept gains cells (the example graph, an EXPLAIN, a `timing` run) and a
  results sidecar.
- The plan table and the speedscope bytes follow upstream's formatter; an
  engine refresh that changes either fails `src/lib/docs/plan.test.ts`
  until the model follows.
- A reader who uses the toggle changes the page's database: a later cell
  that creates the same index, or lists indexes, differs from its recording
  until the toggle is pressed off or the page is reset.
- The `timing` word has no build file: it is a browser module and a case
  file only, as the framework provides for cell words.

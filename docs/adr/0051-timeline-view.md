# ADR-0051: The timeline view draws a step's own rows on a time axis, with columns named by attributes and an as-of slider that re-runs the page's own statement

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 lists a timeline view for temporal and bi-temporal
results, placed on the agent-trajectory and bi-temporal recipes. Those
recipes already teach the reads a picture would show: a session's steps
in time order, everything since a cutoff, and a decision log with valid
time and record time whose as-of statement answers "what was true on
`t`" and "what did the log believe on `t`" differently. The bi-temporal
recipe carried a hand-drawn gantt of the same decisions, whose dates and
open ends were typed by hand. The interactive element framework
(ADR-0035) and its extension to recipes (ADR-0045) require the engine's
own numbers, a static form built at record time, a lazy module and a
case file.

Result columns carry no meaning a drawing can rely on: an integer may be
epoch milliseconds or a sequence number, and a row may hold three
datetimes. "What was believed at `t`" is a predicate over four times
that each recipe spells its own way.

## Decision

1. **`:::timeline{cell= start= [end=] [record-start= record-end=] [lane=] [label=]}`
   names a cell and its columns, never statements, and guesses nothing.**
   `start` is when a row happens or starts; with `end` a row is an
   interval and a null end is open; `record-start` and `record-end` are a
   bi-temporal row's record-time pair, drawn under its valid-time bar;
   `lane` groups rows into lanes (a trajectory's step kinds), else each
   row is a lane named by `label`. `validate` checks the columns exist and
   that every value in a time column is a date or datetime the engine
   returned.
2. **Values print as the engine returned them.** The static form's table
   and every mark's accessible name use the engine's strings
   (`2024-01-07T00:41:14.04Z` stays so); times are parsed only to place
   marks, and tick labels are generated in UTC.
3. **The as-of slider re-runs the page's own statement.** With
   `asof=<cell> param=<name> match=<column> [match-record=<column>] [key=<column>]`,
   moving the slider to `T` runs the drawn cell and then the as-of cell on
   the page's database, with `param` set to `T` (in a list when the data
   block holds a list), keys the two cells share taken from the drawn
   cell, and the rest of the as-of cell's parameters as the reader left
   them. The rows its `match` column names light up on the first axis, and
   those `match-record` names on the record axis. The element never
   evaluates a temporal predicate itself: the highlight is the engine's
   answer, so a recorded-but-not-yet-valid plan reads differently from a
   bar that merely covers `T`.
4. **Live follows the step.** A run of the drawn cell, the reader's edited
   text included, redraws the timeline; Reset returns to the recording.
   The engine loads on the first Run or slider move, never on scroll.
5. **Access.** The marks are one tab stop with a roving focus: the arrow
   keys move along a lane and between lanes, and each mark is named with
   its values and echoed in a polite live region; the drawing has a
   description in words and a table of its rows. At phone width the
   drawing keeps a legible size and scrolls sideways inside its frame;
   reduced motion drops the only transition.
6. **Placements.** The trajectory recipe gains a step returning a
   session's steps with their `at`, drawn by kind, whose slider re-runs the
   "since a cutoff" step. The bi-temporal recipe gains a step returning
   the decisions about an entity with their four times, whose slider
   re-runs its as-of step; the timeline replaces the hand-drawn gantt.
   The model-agent-memory guide's as-of section gains the same picture
   for its slot's two facts.

## Alternatives considered

- **Inferring the time columns from the column types.** Less to write.
  Rejected: an integer column cannot say whether it is a time, a row may
  hold several datetimes, and a wrong guess draws a confident lie.
- **Computing "true at `T`" and "believed at `T`" in the browser from the
  four columns.** No second statement to run. Rejected: each page defines
  belief its own way, and a re-implementation could drift from the
  statement the page teaches; the engine's answer cannot.
- **A two-dimensional valid-time by record-time plot.** The textbook
  picture. Rejected: it reads poorly for a handful of rows and has no
  place for point events; two bars per row on one axis show both and
  stack in lanes.
- **Keeping the gantt beside the timeline.** GitHub renders it. Rejected:
  two pictures of one thing, one typed by hand with an invented end date.

## Consequences

- A page whose as-of statement takes its time from a dataset cannot place
  the slider: `CellHandle.params()` reads only an inline parameters
  editor, so `validate` requires the as-of cell's data block to hold the
  parameter. The three placements use small blocks.
- The trajectory recipe records one more 41-row step; the bi-temporal
  recipe drops its second diagram. Task skills citing the bi-temporal
  recipe are recorded again, and the guide's sections need new embeddings.
- The as-of slider's `list` handling assumes one time per run; a
  statement that needs two times (a valid time and a knowledge time) gets
  one slider, on the parameter the placement names.

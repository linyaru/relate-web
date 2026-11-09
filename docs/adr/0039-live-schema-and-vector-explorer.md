# ADR-0039: The live schema reuses the data-model drawing, and the vector explorer projects at record time and checks fusion against the page

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists two phase 2 elements that show what the engine
holds or ranks: the live schema (`db.schema.visualization()` drawn from the
page's database, beside the data-model figure the page authors) and the
vector search explorer (a 2D projection of real vectors, the question
point, the top k as k changes, the pre-filter, and hybrid fusion). §7.4
places the explorer on the vector search guide and the hybrid search
guide, and the live schema on the pages that draw a data model.

Both follow the element framework (the interactive elements record): a
directive with a recorded static form, a lazy module on the page's one
engine, a browser case. ADR-0010 keeps every number the engine's and
forbids canned animation. A projection of 384 dimensions to two is not a
number the engine returns, and reciprocal rank fusion is arithmetic the
page shows next to the engine's fused statement, so both need a rule for
where their numbers come from.

## Decision

1. **`:::schema-live{[cell=<id>]}`** sits directly under a data-model
   figure (a mermaid flowchart of circles; validation fails without one).
   Live, a button runs the cells up to `cell` (default: all), then `CALL
   db.schema.visualization()`, and draws what it reports with the code that
   draws the data-model figures (`schema-layout.ts`, and one drawing
   function the build and the browser both call), in the colours the
   figure above gives each label, with a table of each label's indexes and
   constraints and a sentence on the labels the figure and the database
   disagree on. Nothing runs before the button. Its static form is the
   authored figure plus one sentence from the recorded counters of the
   cells it runs; it has no picture of its own, because the figure is the
   picture.
2. **`:::vector-explorer`** has two views. The scatter (`data=<json block>
   cell=<ranking cell> [filter=] [euclidean=] [group=]`) projects the data
   block's vectors on their first two principal components when the page
   is recorded (power iteration with deflation, a fixed start and a fixed
   sign, so the same block gives the same picture) and ships the
   coordinates in the static SVG's data attributes; the browser reads them
   back and never re-projects. Live, a k slider, a pre-filter toggle and a
   metric switch run the page's own statements with `$k`; the view rings
   the ids the engine returns and greys the points the pre-filter removes.
   The text states each axis's share of the variance, and the page says
   the engine ranks in all dimensions.
3. **The hybrid view** (`lists="<cell>,<cell>" [fuse=<cell>] [constant=]
   [weights=]`) shows each ranked list and fuses them by reciprocal rank
   with the arithmetic written out. `fuse` names the page's own fused
   statement: `docs:check` fails when the recorded arithmetic disagrees
   with it, and live the view prints the engine's score beside each
   computed one. The slider stops at the number of ids the lists can
   return.
4. **A timing shown is the search statement's own** (`elapsed_ms` of its
   envelope in that run), never a sum with the cells run first.

## Alternatives considered

- **Re-projecting in the browser on each run.** It would follow a changed
  data block. Rejected: the block is fixed on the page, the chunk would
  carry the projection's cost on every load, and a live picture that could
  differ from the static one by float noise would make the static form a
  different picture.
- **t-SNE or UMAP.** Better at showing clusters. Rejected: they are
  stochastic, depend on tuning, and their axes mean nothing a caption can
  state; PCA is linear, deterministic and testable.
- **A second index for euclidean ranking.** Faster than a scan. Rejected:
  the page teaches that an index ranks with the function it was created
  with; ordering by `vector.similarity.euclidean` shows the other function
  without a second index and says that it reads every note.
- **A seeded read-only database (OPFS) for the live schema.** The
  procedure would not touch the page's database. Rejected, as in the
  framework record: it writes to the reader's browser storage, and the
  procedure only reads.
- **Drawing the live schema with NVL.** One graph module already exists.
  Rejected: the figure above is drawn by the schema code, and the point is
  to compare like with like; a force layout places the same model
  differently.
- **A copy of the drawing function in the browser module.** The build's
  drawing module reaches the colour tokens through Node. Rejected: a copy
  drifts silently; the body lives in a module without Node imports that
  both call.

## Consequences

- The README's "Interactive elements" table describes both elements as
  built; the live schema's static form is the authored figure and a
  sentence, not a picture drawn at build.
- A page that ranks real vectors carries them in a data block; the twin
  generator summarises a large data block (a framework change) so the twin
  stays text an agent can use and its section embedding is not mostly
  numbers.
- The search reference keeps its CLI recordings; a weighted hybrid view
  there waits until a weighted fusion runs on the page's own cells.
- `src/lib/docs/vector-explorer.test.ts` and `schema-live.test.ts` pin the
  projection, the fusion and the reading of the procedure's row.

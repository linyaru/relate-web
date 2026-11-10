# ADR-0047: The storage animator is a diagram of documented behaviour that runs no engine, drawn by one model for its static form and its live frames

Status: Proposed

Date: 2026-11-09

## Context

DOCS-PLAN.md §7.3 lists a storage animator for phase 3: the write path (a
statement appends to the WAL, applies to the in-memory graph, a checkpoint
writes the snapshot), a durability-mode switch with the loss window drawn,
and the anatomy of one `.rl` file, on concepts/storage-and-durability (its
hero, §7.4), guides/operate/durability-modes and
guides/storage/choose-a-store-layout.

Every other element answers with the engine's own numbers (ADR-0035, the
framework; §7.1 "live over static, where the engine can run it"). Here it
cannot. The WASM build the site ships opens an in-memory store: nothing is
synced, checkpointed or written to a file, and its API reports no LSN,
segment or checkpoint. A seeded store in the browser would go through OPFS,
which the framework declines. What the element shows is real only as the
release binary's behaviour, which the storage pages already state and
verify with `bash verify` steps (WAL replay, checkpoint LSNs, `relate info`
of a `.rl` file, the per-mode kill test).

## Decision

1. **`:::storage-animator{[scenes="write-path,durability,rl-file"]}`, with
   `engine: false`.** `scenes` picks the views and their order (default all
   three, behind a view switch). The concept page shows all three in place
   of its write-path diagram; the durability guide shows `durability`; the
   layout guide shows `rl-file` beside its `relate info` output.
2. **A diagram of documented behaviour, said so.** Every step and number is
   one a storage page states: the commit's six steps under `full`, the
   checkpoint's rotate, pin, write, publish and recycle, the open's load and
   replay, the triggers (64 MiB or 10,000 commits, 300 seconds, a clean
   close, `.checkpoint`), each mode's loss window, the `.rl` superblock
   marker and its space that grows and is reused, never shrinking. Where a
   page gives a rule but no number, the drawing gives none: the `.rl` view
   is a logical order of parts, not to scale, and shows no byte count. The
   status line opens with the shared recorded wording and adds that no
   engine runs; a separate live region reads each step.
3. **The facts are held to the binary's recorded help.** `validate` fails
   when `_data/cli.json` names other durability modes, another default
   mode or another default checkpoint interval than the model draws, so a
   release that changes them stales the element with the pages.
4. **One model, two renderings.** A Node-free model holds the store
   simulation (commit, checkpoint, crash as steps), the loss arithmetic
   over a fixed ten-second timeline, and the SVG drawing with its style
   rules over a palette. The static form passes hex colours from the
   site's tokens; the browser passes CSS variables, so a theme switch
   repaints and the live frame is the static picture's drawing.
5. **The static form carries the whole explanation.** Each view's steps as
   text (the commit, checkpoint and recovery lists; a table of what a crash
   4.6 seconds after a checkpoint loses per mode; a table of the `.rl`
   parts), and one picture with a panel per view, in both themes.
6. **Motion is optional.** With motion, an action's steps advance a beat
   each and the named part fades in. Under `prefers-reduced-motion`, or with
   "Step by step" ticked, each step waits for Next and nothing animates.
   Controls are native buttons, radios and a range input, so the keyboard
   works without custom handling; buttons that cannot act stay focusable
   (`aria-disabled`).

## Alternatives considered

- **Run the engine for the commit's counters.** A live statement whose
  envelope's counters decide whether a record is appended. Rejected: the
  record is inferred from a rule, not observed, so it would look live
  while showing nothing the engine reports, and it would load 2.3 MB on
  pages that have no cells.
- **An OPFS store in the reader's browser.** A real WAL on a real file.
  Rejected: the framework declines writing to the reader's storage, and
  the browser's sync is not the binary's, so its loss windows would differ
  from the pages'.
- **A canned animation or video.** Less code. Rejected: §7.1 rules out a
  canned animation, and a video has no static text or reduced-motion form.
- **Keep the mermaid diagram on the concept page beside the element.** No
  page change. Rejected: two pictures of one flow, a few lines apart; the
  element's static text carries what the diagram's words did.

## Consequences

- The concept page's write-path mermaid diagram and its renderings go; the
  element's static form replaces it in the twin.
- A change to a storage fact (a mode, a trigger, a loss window) is a change
  to the model and its pages together; `validate` catches the three that
  `cli.json` records, and the rest are reviewed with the pages.
- The README's Interactive elements table gains the element's row, and
  AGENTS.md counts nine directives.
- On a phone the write-path frame keeps a readable size and scrolls inside
  its frame, as the site's diagrams do; the other two views redraw at the
  column's width.

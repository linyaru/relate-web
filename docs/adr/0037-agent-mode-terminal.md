# ADR-0037: The agent-mode terminal renders the engine's envelopes as the CLI prints them, on an empty read-only database, with CLI-only facts from recordings

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists an agent-mode terminal for the agent quickstart (the
§7.4 hero), the guide to driving relate from an agent, the exit-code
reference and the agent-native concept: one statement shown as relate prints
it in the modes an agent reads, with the stderr lines, the exit code and the
row cap a detected agent harness turns on.

The engine in the page is the WebAssembly build. It returns wire envelopes
and nothing else: it has no exit codes, no stderr, no `--mode` formatter and
no harness detection. Those belong to the CLI. ADR-0016 makes CLI facts
recorded runs, replayed against a binary; ADR-0013 makes every command a
page shows carry `--read-only`; the element framework (ADR-0035, the
framework) requires a static form built from recordings and a lazy browser
module.

## Decision

1. **`:::terminal{cell=<id>}` binds one cell**, optionally `mode=table|
   envelope|jsonl|toon` and `harness=on`. The cell holds one statement with
   no parameters that does not write, and it is the page's first cell, so its
   recording ran on an empty database as the terminal runs it. Its statement
   is one the terminal's fixtures record with the binary, so the claim that
   the bytes are relate's always has a proof behind it; `validate` refuses
   any other.
2. **The renderers are a port of relate's.** `--mode table` at the width
   relate prints to a pipe, `envelope`, `jsonl` and `toon`, the failure path
   (the stderr message, a syntax error's source and caret, the "statement k
   of n failed" line, the error object) and the statement splitter, shared
   by the build and the browser (`_terminal-render.ts`). A unit test runs
   each fixture statement on the shipped WASM and compares the rendered
   bytes and exit code with the binary's recorded output in all four modes,
   with and without the harness, and replays every query run recorded in
   `cli.json` and `errors.json` that the terminal can show. The fixtures name
   the known gaps (the note relate prints for a write that changed nothing,
   one engine wording difference).
3. **What only the CLI decides comes from recordings.** A generated facts
   file digests `cli.json` and `errors.json`: the binary's version, the
   harness row cap (from the run recorded under `CLAUDECODE=1`), the
   detection variables, the exit code per error class. The terminal applies
   the cap to the engine's rows and labels every exit code and class with
   that version. `docs:check` fails when the facts file is stale.
4. **Live, an empty read-only database.** Run sends the statement to
   `page.runReadOnly`, a fresh `new RelateDb(true)`, which is what
   `relate --read-only` opens on an empty store, so a write is refused by
   the engine itself. The statement is editable, with presets for the row
   cap, a syntax error, a missing parameter, a refused write and three
   statements that stop at the second; choosing a preset fills the
   statement and does not run it. The mode tabs switch the rendering of the
   same run without running again; the harness toggle adds the variable to
   the command and the cap to the output. Until the reader runs something
   the pane shows the cell's recording, labelled as recorded. The pane draws
   at most 500 lines, and 20,000 characters of a line, then a line of its
   own saying how much it left out; the exit line and the status keep the
   full counts. The status line, a live region, names the exit code, the
   class and the lines on each stream.
5. **Every command shown carries `--read-only`.** The terminal's command
   line is built, never typed, and always opens read-only.

## Alternatives considered

- **Recorded terminal sessions only.** They are the CLI's real bytes.
  Rejected: the reader could not change the statement, and the plan asks for
  live output where the engine can produce it.
- **Formatting envelopes with JSON.stringify.** Rejected: key order, float
  spelling and escapes differ from relate's, so the bytes would claim to be
  the CLI's and not be.
- **Running on the page's database.** Rejected: the command shown opens a
  store read-only, and the page's database is writable; an empty read-only
  instance is the honest match, and it keeps the cells' state untouched.
- **Detecting the harness in the browser.** Rejected: there is no harness in
  a browser; the toggle plays one, as the CLI would see `CLAUDECODE=1` with
  stdout piped.

## Consequences

- A new terminal statement needs a fixture entry and a run of
  `RELATE_BIN=<relate> node src/lib/docs/elements/_terminal-record.ts`.
- An engine, renderer or CLI change that moves one byte fails `docs:test`
  until the fixtures are recorded again and reviewed.
- concepts/agent-native gains a cell so its terminal has a first cell; the
  terminal sits beside the MCP tryout where the column is wide enough.
- What the pane does not reproduce, listed on the pane: timings (relate
  prints none in these modes; the status gives the run's own engine time);
  TOON as relate's tabular form, not the whole TOON specification; a date,
  time or duration nested in a list or map, quoted in the table where
  relate prints it bare; the plan relate prints for EXPLAIN and PROFILE;
  the did-you-mean line after a syntax error; the note relate writes on
  stderr for a write that changed nothing; wrapping to a terminal's width;
  and display width outside CJK, combining marks, flags and the emoji
  sequences unicode-width 0.2 measures as one picture.
- One engine wording difference: the WASM build words a latitude out of
  range as `type error: InvalidArgumentValue: …` with kind `type`, the
  binary as `semantic error: …` with kind `argument` (both exit 6). The pane
  shows the engine's message and kind under the binary's version label, so
  it names the difference on the exit line and in its list;
  `ENGINE_DIFFERENCES` in `_terminal-render.ts` holds it, and `docs:test`
  fails once a WASM refresh removes it.
- A large result still costs the reader's tab a parse of every row and one
  rendering of each mode the reader views: the engine returns every row to
  the page, and the renderers build every line relate would print. The pane
  draws at most 500 lines, so the page stays responsive (1,000,000 rows in
  headless Chrome: 5.3 to 5.7 s from Run to drawn, the longest main-thread
  task about 0.65 s, in the table mode).

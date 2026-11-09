# ADR-0041: The MCP tryout and the agent trace answer tool calls in the page by relate serve's mapping, with recorded server answers where the engine cannot speak

Status: Proposed

Date: 2026-11-08

## Context

DOCS-PLAN.md §7.3 lists two phase 2 elements for the agent pages: an MCP
tryout (the three tools of `relate serve --mcp` against the page's
database, each request and reply shown, a write refused when the server is
read-only) and an agent trace playback (an agent's tool calls stepped
through with live results). §7.4 puts the tryout on connect-over-mcp, the
MCP server reference and the agent-native concept, and the trace on the
agent memory tutorial.

The page has no server. It has the engine in a worker (ADR-0010) and the
framework's page API (ADR-0035, the interactive element framework): run a
script on the page's database, or on a fresh read-only in-memory one. The
server adds what the engine does not have: a read/write gate that reads the
planner's query type from an `EXPLAIN`, a reply that wraps the engine's
envelope in a JSON-RPC line, pinned refusal texts, a tool list that drops
`write_cypher` under `--read-only`, and a transport. The engine's wire
envelope carries no query type. Anything only the binary shows comes from a
recording labelled with its version (ADR-0016), and nothing an element
shows may claim more than it is (§7.1).

## Decision

1. **Replies are built in the page by the server's own mapping.** One shared
   protocol module, free of Node and DOM imports, answers a `tools/call` as
   upstream's tool layer does: `EXPLAIN` with the call's parameters, the
   gate, the run; the reply text spliced from the engine's JSON (columns,
   types, rows emptied for `write_cypher`, counters, timings of the executed
   statement, notifications and plan of the `EXPLAIN`), keys sorted as the
   server sorts them; `get_schema` from the queries the server runs per
   label. The build runs the same module on the same WASM for the static
   form, and a unit test holds its replies equal to the lines the binary
   printed on the reference page (docs:cli-check replays those).
2. **Parameters travel as the host's text.** The data block's, the request
   line's and the editor's JSON text goes to the engine and into the request
   unchanged (compacted), so `1.0` stays a float, as serde_json keeps it.
3. **The gate reads the plan's operators, closed.** Reads are an allow-list
   of the operators the EXPLAIN reference lists; an operator outside the
   known reads, writes and schema commands counts as a write, so
   `read_cypher` refuses it, and the reply says which operator and that the
   server may run it. A WHEN/ELSE hides its branches from the plan, so it
   counts as a write too, and the page says the server runs a WHEN whose
   branches only read.
4. **Every reply says where it came from**: built from the engine; refused
   by the gate with the server's pinned text; refused for its arguments
   (the server's invalid-params text, nothing ran); the server's recorded
   tool error in a line built with this call's id (`write_cypher` on a
   read-only server); or not sent (a second statement, which the engine
   would run where the server answers a syntax error). A trailing `;` is
   sent: the server runs it and keeps it in the plan's `statement`, so the
   page puts it back where the engine's script runner dropped it.
5. **Read-only is shown twice, each labelled.** The static form quotes the
   recorded run of `relate serve --mcp stdio --read-only` answering
   `write_cypher` (errors.json, with its version). Live, "Serve read-only"
   changes the tool list and answers `write_cypher` with that recorded text,
   and beside it runs the same statement on `runReadOnly` to show the
   engine's own refusal (42N18), labelled as what the CLI and the clients
   report, not an MCP reply. `readonly=on` starts the tryout read-only on a
   page whose every block opens the store `--read-only`.
6. **A trace replays the page; it invents nothing.** `:::agent-trace` takes
   steps whose statements are whole statements the page already runs (a
   cell, or a statement a `bash verify` fence runs) and whose parameters are
   data the page holds; a step that repeats a cell must return that cell's
   recorded rows, at record time and live. The trace starts on the database
   the cells up to `from=` build, empties it first when it holds more, and
   empties it again after its last step so the page's cells run cleanly.
7. **Both static forms are text**: each call's request and reply, timings as
   `<ms>`, with the rows, counters or schema as a table; the trace's steps
   with their notes. With JavaScript the live panes show the same recorded
   results until a call is sent.

## Alternatives considered

- **A seeded read-only database through OPFS.** It would show the engine
  refusing a write on the page's own data. Rejected: it writes to the
  reader's browser storage, which the framework record declines, and the
  server's refusal is not the engine's anyway: it answers before the engine
  sees the call.
- **Emulating the transport** (stdio framing, HTTP 401, 403 and 415).
  Rejected: the page has no socket or process, and a made-up status line
  would be a mock number; the reference page lists the recorded answers.
- **Sending a multi-statement call** and showing the engine's answer.
  Rejected: the engine's script runner runs every statement, where the
  server answers a syntax error, so the page would write what the server
  never would.
- **A deny-list gate** (known writes refused, the rest run). Rejected: an
  operator added later, or one the corpus misses, would run a write through
  `read_cypher` on the page's database while the server refuses it.
- **Canned replies from recordings only.** Rejected: §7.1 asks for live
  numbers where the engine can produce them, and every part of a reply but
  the transport and the refusal texts is the engine's.

## Consequences

- Two directives, `:::mcp-tryout{calls= readonly=}` and
  `:::agent-trace{steps= from=}`, each with a browser case file; the README
  "Interactive elements" table lists them.
- An engine refresh that changes the reply mapping, the plan operators or
  the refusal texts fails `src/lib/docs/mcp-tryout.test.ts` or the
  recording, until the protocol follows.
- Known divergences, stated on the page where they apply: a WHEN/ELSE that
  only reads is refused, an operator the page does not know is refused, a
  second statement is not sent (the server's syntax error is not
  reproduced), and the per-call byte cap is not applied.

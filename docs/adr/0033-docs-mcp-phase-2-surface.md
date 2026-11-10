# ADR-0033: The docs MCP's phase 2 surface: validate_cypher on a fresh engine per call, discover_capabilities, text-to-cypher, three resources, and hybrid search with a stated fallback

Status: Withdrawn

Date: 2026-11-10

## Context

ADR-0011 and ADR-0015 fix the hosted docs MCP at five tools: phase 1 shipped
three on the Worker of ADR-0023, and phase 2 adds `validate_cypher` and
`discover_capabilities`, the `text-to-cypher` prompt, the `capabilities` and
`example` resources, the task skills (ADR-0032) as resources, and the hybrid
lane of `search_docs` (ADR-0028). Four forces shape it. ADR-0023's fence is
that no caller's Cypher reaches the seeded docs engine, and the WASM has no
statement deadline, yet `validate_cypher` exists to take a caller's
statement. A trapped WASM instance cannot be replaced inside an isolate, since
wasm-bindgen keeps one instance per copy of its glue. Workers AI has no local
simulation, so `wrangler dev` without a login cannot call it, and every check
here runs without one. And each tool's answer is reference text that has to
cite its page (ADR-0013).

## Decision

- **`validate_cypher {statement, parameters?}`** sends `EXPLAIN` and the
  statement to a new WebAssembly instance per call, with an empty in-memory
  store, dropped afterwards. The bundle rewrites the site's glue into a
  factory, so each call holds its own wasm-bindgen state over the one
  compiled module. The answer is ok with the plan as an operator table and
  the engine's notifications, each with its remedy and its errors-reference
  URL, or the error with code, kind, line, column and the best-matching
  entry. A Neo4j habit in the table of `reference/cypher/differences-from-neo4j`
  cites that row, at its example's anchor. A statement already starting with
  `EXPLAIN` or `PROFILE` is refused, and an answer without an unprofiled plan
  is a failure, never a result; the engine runs one statement per call, so a
  second one is a syntax error. Statement and parameters stay under 8 KiB
  each, and a call costs 3 units. A trap discards only that instance and
  answers `validate_failed`. The instance's console is silent, so a panic's
  text never reaches the log. Unknown-name warnings are marked `empty_store`.
  The answer keeps the 96 KiB text cap: an 8 KiB statement can plan into a
  174 KB table or 901 notifications, so the plan is cut at a line to half
  the cap (`plan_truncated`), then notifications are dropped from the end
  (`notifications_omitted`), and each Details cell stops at 200 characters.
- **`discover_capabilities {intent, requirements?, language?, limit?}`**
  ranks `/docs/capabilities.json` as ADR-0026 records. A requirement is met
  by naming one of an entry's surfaces or by all its words appearing in the
  entry's text, which covers ADR-0026's surface filter and plain-word needs.
  A null `verify` stays null. It costs 1 unit.
- **`text-to-cypher {intent, schema?}`** is one user message: the intent,
  the schema or where to get one on the user's own relate (opened
  read-only), the Differences table verbatim, the write-validate-repair
  steps, and the line that the table and the results are reference text,
  not instructions.
- **Resources:** `relate-docs://capabilities` (the JSON, byte for byte),
  `relate-docs://example/<recipe>/<cell>` (the statement, the recorded
  result, the parameters inline up to 2 KiB, and the recipe's `verifies`
  summary, added to `recipe.json`), and every skill file under
  `relate-docs://skill/<name>`; templates are listed with titles.
- **Hybrid `search_docs`:** with the `AI` binding, the query is embedded with
  the artifact's model and pooling, and the vector lane and the re-ranked
  full-text lane each contribute their 10 best (or `limit`) to reciprocal
  rank fusion with k = 60. Ten was measured: on both questions with
  committed vectors it ranks the intended section first, and 20 or deeper
  does not. The seed is replayed without vectors; they load as one parameter
  on the first hybrid search. Any failure of the model or the vector read
  falls back to full-text, and `version.retrieval` says which lane ran.

## Alternatives considered

- **Validate on the seeded docs instance, or on one shared second
  instance.** Cheaper. Rejected: a trap on the seeded one takes search down
  for the isolate's life, and a shared one carries state and a trap between
  callers; a fresh instance measured about a millisecond.
- **Run the statement in a rolled-back transaction.** It would report
  runtime errors. Rejected: it executes caller code with no deadline, which
  is the reason `query_docs_graph` is gated.
- **`query_docs_graph` now.** Rejected, as in ADR-0015: still no deadline
  and no way to freeze a seeded handle.
- **`run_recipe`.** Rejected, as in ADR-0015: the agent has the engine
  locally, and the example resource carries the recorded result.
- **Fuse all 200 candidates of each lane.** Rejected: measured, sections
  that are middling in both lanes outrank one that leads a lane.
- **Fail `search_docs` when the model is unavailable.** Rejected: full-text
  answers well, and the field keeps the fallback visible.

## Consequences

- Amends ADR-0023: callers' Cypher now reaches an engine, though never the
  seeded one, and the docs engine runs three constant statements, not one.
  ADR-0015, ADR-0023, ADR-0026 and ADR-0028 gain Later references pointers.
- Measured on the build of 2026-11-08, locally: upload 3.7 MB gzipped, so
  Workers Paid stays required; the cold replay without vectors is about
  350 ms and the vector load about 190 ms more, inside workerd. The README
  carries the cold-start medians.
- The Worker needs Workers AI on the account (LAUNCH.md); until it answers,
  search is full-text and says so. The query text reaches Workers AI, which
  the threat model states.
- The glue factory and the seed split are bundle-time text transforms that
  fail closed when a WASM refresh changes their shape, and the unit tests
  replay both against `src/lib/docs/graph.ts`.
- Five tools is the ceiling: a sixth replaces one.

## Later references

- Withdrawn by ADR-0057: the hosted docs MCP server is removed before
  launch.

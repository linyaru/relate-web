# ADR-0023: The docs MCP Worker runs the Agents SDK's stateless handler over a seeded WASM engine fenced by canned statements

Status: Withdrawn

Date: 2026-11-10

## Context

ADR-0006, ADR-0011 and ADR-0015 put a read-only docs MCP server at
`https://relatedb.ai/mcp`, on a Cloudflare Worker running the site's WASM
engine, behind the Agents SDK's stateless `createMcpHandler`, with a
container fallback if WASM initialization plus the seed replay was too
slow. ADR-0013 decision 4 says the engine opens read-only
(`new RelateDb(true)`).

Three facts emerged in building it. The Agents SDK's handler (agents 0.33)
now wraps the MCP TypeScript SDK v2 (the 2026-07-28 protocol revision) and
serves clients on the 2025 revisions through a stateless lane: a fresh
server per POST, no session id, GET and DELETE refused. In the WASM build,
`new RelateDb(true)` opens an empty in-memory store that refuses every
write, the seed included (upstream ADR-0136), and the WASM can open neither
a `.rl` nor a snapshot, so a read-only store cannot hold the docs graph.
Measured with `wrangler dev`, a cold isolate answers `tools/list` in about
20 ms and its first search in about 360 ms, of which WASM instantiation
plus the seed replay is about 320 ms; warm searches take about 22 ms.

## Decision

- The Worker uses the Agents SDK's `createMcpHandler` over the MCP SDK v2:
  one factory, a fresh server per request, both protocol revisions, no
  Durable Object. Origin checks are off because the data is public,
  read-only and served without credentials; host checks keep the SDK
  default.
- The engine is the site's WASM, initialized once per isolate on first use
  by replaying the docs graph's seed script into a writable in-memory
  handle. The read-only guarantee is structural: no tool accepts Cypher,
  and the only statement run after the seed is one constant full-text read
  with the caller's words bound as a parameter. Free Cypher stays gated as
  ADR-0015 says.
- `search_docs` re-ranks the index's candidates (stopwords dropped, a
  heading that names the query first, then full-text score over section
  length), because the engine's score counts term occurrences and on its
  own favors long sections.
- The WASM path stands; the container fallback is not built. `get_page`
  and `explain_error` read the bundled twins and errors data, not the
  engine, so they survive an engine fault. `get_page` cuts a section with
  the code that answers `?section=` (ADR-0025), so both return the same
  bytes.
- A build step in the Worker's package bundles the site's build outputs
  (twins with section offsets, the seed, errors, skill, releases, a copy of
  the WASM) for each deploy.

## Alternatives considered

- **The v1 `@modelcontextprotocol/sdk` streamable HTTP transport, wired by
  hand.** Fewer moving parts. Rejected: the plan chose the platform's
  stateless handler, which also covers the 2026 revision and Cloudflare's
  host checks with the same factory.
- **Open the store with `new RelateDb(true)` as ADR-0013 says.** Rejected:
  in the WASM it cannot be seeded; the result is an empty store.
- **The container running `relate serve --mcp --read-only` over the
  `.rl`.** A true read-only open and a statement timeout. Rejected for now:
  a second runtime and bill, and the measured cold start does not need it;
  it stays the path if free Cypher is ever served before the WASM has a
  deadline.

## Consequences

- Amends ADR-0013 decision 4: the docs MCP's engine is a writable
  in-memory handle fenced by canned statements, not a read-only open. Its
  Later references point here.
- Upstream asks: a way to freeze a seeded WASM handle (or open a snapshot
  read-only), and a statement deadline.
- The Worker needs Workers Paid (about 320 ms of CPU on a cold isolate; a
  3 MB compressed upload) and `nodejs_compat`.
- The cold-start measurement is a script in the package and is re-run
  against the deployed Worker at launch; the replay grows with the docs'
  section text (ADR-0020).

## Later references

- Amended by ADR-0033 (phase 2 surface): `validate_cypher` takes a caller's
  statement and plans it with `EXPLAIN` on a fresh WebAssembly instance per
  call, never the seeded docs instance. The docs instance runs three constant
  statements (full-text, vector, vector load); it replays the seed without
  vectors and loads them on the first hybrid search. The cold start is
  re-measured with `npm run docs:mcp-check -- --coldstart 5`.
- Withdrawn by ADR-0057: the hosted docs MCP server is removed before
  launch.

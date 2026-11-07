# ADR-0006: A hosted docs MCP server built on relate

Status: Accepted

Date: 2026-11-07

## Context

Agents increasingly reach documentation through MCP servers (Mintlify
hosts one per docs site, Cloudflare runs one for its developer docs,
Context7 indexes libraries). Relate itself ships an MCP surface with
`get_schema`, `read_cypher`, and `write_cypher`, stateless over streamable
HTTP, with auth that can be disabled. The docs are being published as a
relate graph (ADR-0007). The site is static and deploys to Cloudflare
Pages through an existing workflow; the engine's WASM build is 2.3 MB
gzipped.

The maintainers want a hosted endpoint at launch rather than after
measuring demand.

## Decision

Serve `https://relatedb.ai/mcp`: MCP over streamable HTTP, stateless,
unauthenticated, read-only, rate-limited. It is the docs graph served by
relate's own MCP surface, with three plain-language tools on top:
`search_docs` (full-text over sections with section and surface filters,
each hit carrying the page's `.md` URL), `get_page` (the markdown twin with
prerequisites and related pages), and `list_pages`. Relate's `get_schema`
and `read_cypher` pass through for the long tail. `write_cypher` is absent
because the store is read-only.

A Cloudflare Worker fronts the protocol, the plain tools, CORS, rate
limiting, and per-tool logging. The engine behind it is settled by a spike
in phase 1: preferred, the WASM build inside a Durable Object so the graph
instantiates once per isolate; fallback, a Cloudflare Container running
the upstream server image with `relate serve --mcp --read-only --auth
none`. The Worker lives in this repo as its own package and builds from the
same docs-graph artifact as the site.

The local form, `relate serve --mcp stdio --read-only --load <the .rl
URL>`, is documented beside it as the offline twin.

## Alternatives considered

- **No hosted server; document the local form only.** Zero hosting, and
  the evidence for MCP docs traffic is thin. Rejected by the maintainers:
  the endpoint is the product demonstrating itself, and agents without
  relate installed get nothing from the local form.
- **A search-only server with no engine** (a prebuilt index in the
  Worker). Smaller and simpler. Rejected: it would be a second search
  implementation and would forfeit the point of serving the docs with the
  database the docs describe.
- **Run the native server on a container host outside Cloudflare.**
  Fewer unknowns than WASM in a Worker. Kept as the fallback rather than
  the first choice: a second host is a second deploy and a second bill.

## Consequences

- The docs graph build moves into phase 1; the Worker, its smoke test
  (`initialize`, `tools/list`, a known search, `get_page` byte-equal to
  the twin, a write refused), and the install buttons pointing at it ship
  with the launch set.
- Operating rules: per-IP limits, a statement timeout on `read_cypher`,
  no query text in logs. If the Worker is down, the twins, indexes, and
  local form still answer.
- Tool descriptions follow the style guide's task-first rule so hosts pick
  the right tool.

## Later references

- Amended by ADR-0011: the tool list grows (discovery, diagnostics,
  examples, skills, `run_recipe`), `search_docs` becomes hybrid, and the
  Durable Object gives way to the Agents SDK's stateless handler.- Amended by ADR-0015: five tools plus resources and prompts; free Cypher
  is `query_docs_graph`, gated on an engine deadline; threat model in
  ADR-0013.

# ADR-0011: Documentation as an agent API: discovery, diagnostics, executable examples, skills

Status: Accepted

Date: 2026-11-07

## Context

ADR-0005 and ADR-0006 make the docs readable by agents: markdown twins,
indexes, the skill, a hosted MCP server with search and page tools. A
design brief reviewed on 2026-11-07 argues the docs should also let an
agent *complete* an integration: choose relate for a problem stated in
its own words, validate a statement, understand an error, check a
platform, run a tested example, and install a task-specific skill. It
also proposes Starlight and a Cloudflare retrieval stack (D1, Vectorize,
R2, Queues) and a hosted disposable database playground.

Relate is embedded: an agent's natural playground is the engine on its own
machine. The docs graph (ADR-0007) already models pages, examples,
commands, errors, and terms and can hold embeddings; the engine already
does `EXPLAIN`, full-text, and vector search with rank fusion; the
cookbook already is a set of machine-verified recipes with a manifest.
Cloudflare's Agents SDK now provides a stateless streamable-HTTP MCP
handler, so no per-connection Durable Object is needed.

## Decision

- **Capability catalog.** A content collection mapping problems in the
  reader's words to capabilities, guides, recipes, a recommended schema,
  and the recipe cell that verifies it. It renders the docs landing page's
  outcome cards, exports `capabilities.json` and an experimental
  `/.well-known/agent-capabilities.json`, and backs a
  `discover_capabilities` tool.
- **Diagnostics tools on the docs MCP server**: `validate_cypher` (the
  engine's `EXPLAIN`, returning the plan and notifications or the error
  object), `explain_error` (the errors reference), `check_compatibility`
  (the release manifest), plus `get_example` and `get_skill`.
- **`run_recipe` instead of a hosted sandbox**: a stateless tool that
  replays a cookbook recipe to a cell in a scratch in-memory engine and
  reports whether the result matched its recording. No persistent hosted
  database.
- **Hybrid search inside relate**: section embeddings generated at build
  with a small model and stored in the docs graph; `search_docs` fuses
  vector and full-text ranks in one statement. No separate vector store.
- **A task-skills library** authored here, one standard skill folder per
  task family, each citing the recipes that test it.
- **Evals**: a small task suite run by a headless coding agent against the
  MCP server and skills on each release, graded by assertions and
  reviewed by a person.
- Tool design rules: task-first descriptions, stable ids, content hashes,
  compact-by-default results with citations, at most twelve tools.

This amends ADR-0006's tool list; its shape and operating rules stand,
with the Durable Object replaced by the stateless handler.

## Alternatives considered

- **Starlight for the frontend.** Rejected; ADR-0003 is unchanged and the
  brief's reasons for it are met by the custom layout.
- **D1 + Vectorize + R2 as the retrieval stack.** Proven managed
  services. Rejected: for this corpus the docs graph in relate is the
  catalog and the index, which is the demonstration; a second database
  beside the product undercuts it. Revisit if scale demands.
- **A hosted disposable database over MCP.** The brief's playground.
  Rejected: contradicts "deploy nothing", costs money, and the local
  `relate serve --mcp stdio` is the real thing; `run_recipe` covers
  verification.
- **Versioned docs for compatibility.** Rejected per ADR-0004; a
  `version` parameter with warnings and `check_compatibility` cover it.
- **A chat-with-the-docs interface.** Rejected: commonplace and not what
  makes an agent succeed.

## Consequences

- Phase 1 gains the catalog's first entries and the verify step in the
  agent install prompt; phase 2 gains the new tools, hybrid search, the
  manifest, and five skills; phase 3 gains evals and metrics.
- A build-time embedding step enters CI, with the model pinned.
- The graph schema grows capability, problem, recipe, skill, version, and
  integration nodes; `reference/docs-graph` documents it.

## Later references

- Amended by ADR-0015: five tools plus resources and prompts; `run_recipe`,
  the capabilities manifest and content hashes are dropped.
- Amended by ADR-0026 (capability catalog): no outcome cards on the docs
  landing; verify may name a docs cell, a language sample or a CLI verify
  step as well as a recipe cell, or be null where no recorded run
  exercises the capability.

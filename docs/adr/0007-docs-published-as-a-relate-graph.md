# ADR-0007: The docs are published as a relate graph

Status: Accepted

Date: 2026-11-07

## Context

The docs will have more than a hundred pages, each with sections, code
examples, glossary terms, and links to commands, flags, clauses, functions,
and errors. Structural questions (which pages document a flag, which pages
are orphans, whether a phase-1 tutorial depends on a phase-2 page, which
pages use a term without defining it) are graph questions. Vercel publishes
a per-page link graph and a site-wide JSON graph for agents. Relate loads a
`.rl` store from an https URL in one command and has full-text search.

## Decision

The build turns the docs collection into a relate graph: pages, sections,
examples, surfaces, commands, flags, clauses, functions, exit codes,
errors, and glossary terms as nodes; links, prerequisites, documentation,
mention, and use relationships; a full-text index over section text. It
ships as `/docs/relate-docs.rl` (and the JSON codec for diffing) and a
Cypher seed script. From it the build derives a per-page link map at
`/docs/<path>.graph.md`, a site-wide `/docs/graph.json`, the structural
checks in `docs:check`, and the store behind the hosted and local docs MCP
servers (ADR-0006). The cookbook gains a recipe that queries the docs
graph in the browser.

The graph is a build artifact, not a source: the MDX pages and the
glossary files remain the only things anyone edits.

## Alternatives considered

- **Pagefind's index as the only machine form of the docs.** Already
  planned for site search. Rejected: it answers "find text", not "what
  links what" or "what documents what", and it is not something an agent
  can load with relate.
- **A hand-maintained graph of pages and terms.** Full control. Rejected:
  it would drift from the pages within a week; the build already knows
  every link, heading, and fence.
- **Export only JSON, no `.rl`.** Simpler build. Rejected: the `.rl` is
  what `relate --load` and `relate serve --mcp` consume, and it is the
  demonstration.

## Consequences

- The graph export runs on the WASM build if it can write a bundle, else
  through the native CLI in CI; settled in the phase 1 spike alongside
  ADR-0006.
- Structural checks (orphan pages, undocumented flags, phase
  inversions, undefined terms) become Cypher statements in `docs:check`.
- The schema is documented on the glossary page's sibling
  `reference/docs-graph` so agents can write their own queries.

## Later references

- Amended by ADR-0015: the Cypher seed script is the build artifact; the
  `.rl` is built from it by the native CLI in CI, since the WASM cannot
  open one.

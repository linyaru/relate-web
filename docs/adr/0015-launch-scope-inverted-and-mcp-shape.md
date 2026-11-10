# ADR-0015: Launch scope inverted; five MCP tools; directives inside MDX; the seed script is the docs-graph artifact

Status: Accepted

Date: 2026-11-07

## Context

Six adversarial reviews of the docs plan (a coding agent, an evaluating AI
engineer, a docs lead, an engineering lead, an agent-tooling researcher, a
security reviewer) agreed on four structural findings:

- Phase 1 was platform-heavy and content-light: about 45 pages plus a
  Worker, the docs graph, a capability catalog, an agent terminal, glossary
  bodies, toggletips and host deeplinks, while the pages an agent needs on
  its first run (errors, the Neo4j delta, changelog, verified Python and
  Node samples, project status, security, operations) sat in phases 2 and
  3. One to two part-time maintainers cannot ship that before launch.
- Twelve MCP tools is the anti-pattern: hosts' tool selection degrades past
  about six, Cursor caps tools across all servers, and `get_schema` and
  `read_cypher` collide by name with the user's own local relate server.
  Several "tools" were URLs. On the WASM path there is no statement
  deadline, so public free Cypher is a cheap denial of service.
- Every MDX component implied a second, markdown renderer for the twins,
  forever, plus a round-trip check.
- The WASM build cannot open a `.rl` bundle (it exposes `new` and
  `open("opfs://…")` only), so the docs graph and the Worker could not rest
  on one.

## Decision

1. **Phase 1 is inverted.** About 30 CI-verified pages, including
   `reference/errors`, `reference/cypher/differences-from-neo4j`,
   `reference/changelog`, `concepts/where-relate-fits`,
   `reference/project`, `reference/performance`, `reference/security`,
   `reference/privacy-and-telemetry`, the operate basics and the three
   framework integrations; the twins, `llms.txt`, negotiation, the
   published skill, runnable cells, and a minimal read-only hosted MCP.
   The capability catalog, the agent terminal, the timing bar, glossary
   bodies, toggletips, host deeplinks and the live docs graph move to
   phase 2. The launch set is listed in DOCS-PLAN.md §10.
2. **The hosted MCP has five tools**: `search_docs`, `get_page` (section
   level), `discover_capabilities`, `validate_cypher`, `explain_error`.
   Pages, `llms.txt`, the skill, capabilities and releases are MCP
   resources; onboarding and text-to-Cypher are MCP prompts. Free Cypher
   over the docs graph is `query_docs_graph`, enabled only once the engine
   exposes a statement deadline. `run_recipe`, `check_compatibility`,
   `get_skill`, `list_pages` and `get_example` are not tools.
3. **Directives inside MDX.** Pages stay `.mdx`. Prose constructs
   (callouts, tabs, figures, terms) are remark directives rendered by one
   pipeline to HTML and to markdown. JSX is reserved for interactive and
   generated components, each shipping a `toMarkdown` with a round-trip
   check; phase 1 ships at most five.
4. **The Cypher seed script is the docs-graph artifact.** The `.rl` is
   produced from it by the native CLI in CI (installed through
   `install.sh`) for the local `--load` form; the Worker replays the seed
   on each cold isolate, measured in phase 0.

## Alternatives considered

- **Add the content and keep the platform.** Rejected: a larger launch on
  a later date, with the same maintainers.
- **Keep twelve tools, rename two.** Rejected: the overlap dilutes host
  tool selection, and the deadline problem remains.
- **Three tools only.** Rejected: `validate_cypher` and
  `discover_capabilities` are the two tools reviewers rated as genuinely
  ahead of the field.
- **Plain markdown with directives, JSX only for cells and the graph
  view.** Cheapest twins; rejected in favour of keeping MDX's door open
  for the generated tables and the few interactive elements that matter.
- **Wait for the WASM to open `.rl`.** Rejected: an unverified dependency
  on phase 1's critical path.

## Consequences

- Amends ADR-0002 (directive rule), ADR-0006 and ADR-0011 (tool surface),
  ADR-0007 (artifact), ADR-0004 (launch set). Their "Later references"
  sections point here.
- `search_docs` stays full-text at launch; hybrid search waits for a
  committed embeddings artifact (no secrets in CI).
- The capability catalog survives as the "Problems relate solves" page,
  `capabilities.json` and `discover_capabilities` in phase 2; the
  `agent-capabilities.json` manifest and per-result content hashes are
  dropped.

## Later references

- Amended by ADR-0031 (phase 2 constructs): `<Matrix />` is a sixth JSX
  component, generated from data; the cap is six, and `<Agentic>` is the
  `::::agentic` directive.
- ADR-0028 builds the committed embeddings artifact that hybrid
  `search_docs` waits for.
- ADR-0033 builds the phase 2 surface: `validate_cypher` and
  `discover_capabilities` bring the tools to the ceiling of five, with the
  `text-to-cypher` prompt, the capability, example and task-skill
  resources, and hybrid `search_docs`; `query_docs_graph` stays gated and
  there is no `run_recipe`.
- Amended by ADR-0057: the hosted docs MCP server is withdrawn before
  launch. The docs graph and its seed script stay.

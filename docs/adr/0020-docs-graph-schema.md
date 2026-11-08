# ADR-0020: The docs graph's launch schema, seed format and structural checks

Status: Proposed

Date: 2026-11-07

## Context

ADR-0007 publishes the docs as a relate graph and ADR-0015 makes the Cypher
seed script the artifact: the build serves it, docs:check replays it on the
WASM, the hosted MCP's Worker replays it on each cold isolate, and CI turns
it into the `.rl` that `relate --load` opens. Once agents write queries
against it, its labels, property names and URLs are a public interface.
DOCS-PLAN.md §3.5 lists about twenty labels; most of their sources
(capabilities, clauses, functions, skills) do not exist at launch.

## Decision

- The launch graph has nine labels: `Page`, `Section`, `Example`, `Term`,
  `Surface`, `CookbookRecipe`, `Command`, `Flag`, `Index` (llms.txt and the
  landing), and the relationships `LINKS_TO`, `PREREQUISITE_OF` (from the
  prerequisite to the page that needs it), `RELATED_TO`, `HAS_SECTION`,
  `HAS_EXAMPLE`, `USES_TERM`, `APPLIES_TO`, `DOCUMENTS`, `HAS_FLAG`,
  `LISTS`. Every node has an `id` unique within its label; URLs are
  absolute on the canonical origin, so the `.rl` works offline. Other §3.5
  labels join when their data source exists, never as empty labels.
- A `Section` is an H2 or H3 the author wrote (plus the text before the
  first one), with the HTML anchor and the section's markdown as the twin
  has it; a full-text index `docs` covers heading and text.
- `DOCUMENTS` is derived, not authored: a page documents a command or flag
  of `_data/cli.json` when a shell or host-config block, a component's
  markdown or inline code names it.
- The seed is deterministic: rows sorted by id, one per line, no clock or
  git input. Planned pages are nodes without a URL, so the checks can see
  them.
- The structural checks are Cypher on the replayed seed, each rule with
  its own severity, changeable without code: orphan pages, undocumented
  CLI commands and flags (a warning until the CLI reference exists),
  planned prerequisites of published pages, unknown terms.
- Per-page `/docs/<id>.graph.md` ships at launch, pulled forward from
  phase 3 (DOCS-PLAN.md §3.5): once the seed exists, a page's
  neighborhood is a projection of the same graph at no further cost.
- Every rendering says its text is documentation: the seed's header
  comment, a top-level `kind: "documentation"` in graph.json and the
  `.graph.md` frontmatter. Section text holds whole twin sections, prompt
  fences included, so a query returns them as data (ADR-0013 decision 2);
  the hosted MCP's tool results over the graph carry the same `kind`
  rather than a property on every node.

## Alternatives considered

- **The full §3.5 schema at launch, with empty labels.** Matches the plan.
  Rejected: empty labels promise data that is not there, and agents
  querying them get silent empty results.
- **Authored `documents:` frontmatter.** Precise. Rejected: it drifts from
  the page, and every reference page already names its flags in code.
- **One statement per node in the seed.** Simplest to read. Rejected:
  thousands of statements cost parse time on every cold isolate; UNWIND
  rows keep one row per line for diffs at a fraction of the statements.
- **Section text left out, to keep the seed small.** Rejected: §3.5's
  offline search returns `s.text`; without it the `.rl` cannot answer.
- **A `kind` property on every Section and Example node.** Makes each row
  self-describing. Rejected: it repeats one constant thousands of times in
  the seed the Worker replays on every cold isolate, and the tool result
  that wraps the rows can say it once.

## Consequences

- Renaming a label or property after launch is a breaking change for
  agents' queries; it needs a new ADR and a changelog entry.
- Section text dominates the seed's size, and so the Worker's cold start.
  The phase 1 measurement uses this format.
- The native `.rl` is not byte-reproducible (its parquet object names
  vary between runs), so the signed manifest (ADR-0019) lists the seed
  script, which is reproducible; an `.rl` placed under `public/docs/`
  joins it with a checksum that changes on every build.
- The generated pages (ADR-0018) are not `Page` nodes yet; links to them
  add no `LINKS_TO`.
- The `.graph.md` URLs are public from launch: removing them later is a
  breaking change, like a label rename.
- `reference/docs-graph` documents this schema when it is written.

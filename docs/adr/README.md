# Architecture decision records

The decision log for the relate website (`relatedb.ai`): every choice about
how the site is built, hosted, structured, or presented to people and agents
that would be expensive to reverse or that a later maintainer would
otherwise have to rediscover. One decision per file, written before or in
the same change as the implementation, immutable once accepted.

The convention mirrors the upstream relate repository's (its `AGENTS.md`
§1), so a maintainer moving between the two repos finds the same shape.

## When to write one

ADR-worthy: hosting and deploy pipeline; build tooling that other work
depends on (Astro integrations, content collections, the cookbook or docs
check pipeline); content architecture (sections, URL structure, what is
authored here versus synced from upstream); agent-facing surfaces (markdown
delivery, `llms.txt`, the skill, the MCP server); the design system and
anything `MAINTAINING.md` calls an invariant; the style guide and glossary
rules; dependencies pinned for a reason (NVL, Shiki, the WASM copy).

Not ADR-worthy: copy edits, a new page inside an existing section, a bug
fix, a dependency bump with no behaviour change, anything trivially
reversible.

## Format

- Filename `NNNN-short-kebab-slug.md`: four digits, sequential, never
  reused. The next number is one more than the highest in this directory.
  A pull request that would create a duplicate number renumbers before
  merge; CI (`npm run adr:check`) fails duplicates, missing sections, and
  files over the ceiling.
- Header lines, in order: the `# ADR-NNNN: title` heading, `Status:`,
  `Date:` (`YYYY-MM-DD`, the day the status last changed).
- Sections, in order: **Context**, **Decision**, **Alternatives
  considered** (each one ends with why it was rejected), **Consequences**.
  Optional last section: **Later references**, added to an accepted ADR
  only to point at the ADR that supersedes or amends it.
- Status is `Proposed` until agreed, then `Accepted`. An accepted ADR is
  never edited except to add **Later references**; a change of mind is a
  new ADR with status `Accepted` that names the old one as `Superseded by`
  or `Amended by` in that section. `Rejected` and `Withdrawn` are the other
  terminal states.
- Cite other records as `ADR-NNNN`. Cite upstream's as `upstream ADR-NNNN`.
- Line budget: target 80 lines, hard ceiling 150. Over the ceiling, cut
  detail; never split one decision into two files to fit.

## Writing guidance

An ADR records the why and the shape of a decision, not the implementation.
Leave out code, config dumps, file inventories, and the history of how the
change was built or reviewed; the diff and the pull request carry those.
Write the Context so that someone who was not there understands what
problem existed and what constraints applied. Write each alternative as a
real option a reasonable person might have picked, then say what tipped it.

## Public record

ADRs are public. No internal ticket, chat, or tracker references; no
person names (roles, not people: "the maintainers"); no credentials, tokens,
internal hosts, unreleased plans beyond what the record itself decides, or
personal data. The preview host name and anything else `LAUNCH.md` marks
internal stays out.

## History before the log

The site existed before this log: the Astro migration, the cookbook moving
here from upstream, the playground being built here, the WASM copy under
`public/`, and the brand and colour tokens were decided without ADRs. Those
decisions are described in `AGENTS.md`, `MAINTAINING.md`, and `LAUNCH.md`
and are not backfilled. Changing any of them is ADR-worthy from now on.

## Template

Copy `template.md`.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-docs-authored-here-as-mdx.md) | Docs are authored in this repository as MDX, not synced from upstream | Accepted |
| [0003](0003-custom-docs-layout-not-starlight.md) | A custom docs layout on the site's design system, not Starlight | Accepted |
| [0004](0004-diataxis-sections-and-urls.md) | Diátaxis sections with plain URL names | Accepted |
| [0005](0005-markdown-first-delivery-for-agents.md) | Markdown-first delivery for agents: twins, negotiation, indexes, the skill | Accepted |
| [0006](0006-hosted-docs-mcp-server.md) | A hosted docs MCP server built on relate | Accepted |
| [0007](0007-docs-published-as-a-relate-graph.md) | The docs are published as a relate graph | Accepted |
| [0008](0008-style-guide-and-voice.md) | The style guide: voice, tone by page type, and enforced vocabulary | Accepted |
| [0009](0009-glossary-terms-as-toggletips.md) | Glossary terms: one source, first-use toggletips, self-contained twins | Accepted |
| [0010](0010-live-engine-and-nvl-graph-views.md) | Live engine and NVL graph views as the docs' default, with built static forms | Accepted |
| [0011](0011-documentation-as-an-agent-api.md) | Documentation as an agent API: discovery, diagnostics, executable examples, skills | Accepted |
| [0012](0012-cloudflare-hosts-the-site-and-the-docs-mcp.md) | Cloudflare hosts the site and the docs MCP endpoint | Accepted |
| [0013](0013-safe-by-default-agent-surfaces.md) | Agent-facing surfaces are safe by default and docs content is data | Accepted |
| [0014](0014-fit-and-performance-pages.md) | The docs answer "does relate fit" with a fit page and measured performance | Accepted |
| [0015](0015-launch-scope-inverted-and-mcp-shape.md) | Launch scope inverted; five MCP tools; directives inside MDX; the seed script is the docs-graph artifact | Accepted |
| [0016](0016-cli-facts-recorded-and-replayed.md) | CLI facts are recorded runs, replayed against a relate binary | Proposed |
| [0017](0017-runnable-docs-cells.md) | Runnable docs cells: recorded sidecars, recorded static graph forms, and a twin-based playground hand-off | Proposed |
| [0018](0018-generated-reference-pages-and-changelog-feed.md) | Generated reference pages, an authored changelog data file and a JSON Feed | Proposed |
| [0019](0019-skill-publication-and-artifact-manifest.md) | The skill is published byte-identical with generated indexes and a signed artifact manifest | Proposed |
| [0020](0020-docs-graph-schema.md) | The docs graph's launch schema, seed format and structural checks | Proposed |
| [0021](0021-verified-samples-and-release-refresh.md) | Verified language samples, and a release refresh that opens a pull request | Proposed |
| [0022](0022-shared-example-graph-is-the-team-graph.md) | The docs' shared example graph is the team graph | Proposed |
| [0023](0023-docs-mcp-worker-shape.md) | The docs MCP Worker runs the Agents SDK's stateless handler over a seeded WASM engine fenced by canned statements | Withdrawn |
| [0024](0024-docs-mcp-rate-limits.md) | The docs MCP is limited per IP and by a per-IP, per-tool cost budget on Cloudflare's rate limiting binding | Withdrawn |
| [0025](0025-markdown-negotiation-rules.md) | How the docs answer Accept: text/markdown and ?section= | Proposed |
| [0026](0026-capability-catalog.md) | The capability catalog: one page's generated section and capabilities.json | Proposed |
| [0027](0027-compiled-language-samples.md) | Verified samples in Rust, Java, Go, Swift and C | Proposed |
| [0028](0028-embeddings-artifact-and-hybrid-search.md) | Section embeddings are a committed artifact, and the docs graph carries a vector index over them | Proposed |
| [0029](0029-evals-harness-and-usage-data.md) | The docs evals grade stores, not prose, and the per-tool usage page is built from counted log lines | Proposed |
| [0030](0030-glossary-bodies-checks-and-toggletip.md) | Glossary bodies, the §4.11 checks as built, and the toggletip's markup | Proposed |
| [0031](0031-phase-2-constructs.md) | Phase 2 constructs: the agentic and deeplink directives, a sixth JSX component for the matrix, and a language picker on the tab memory | Proposed |
| [0032](0032-task-skills-library.md) | Task skills are authored here, listed beside the CLI bundle, installed by name, and re-reviewed when a cited recipe changes | Proposed |
| [0033](0033-docs-mcp-phase-2-surface.md) | The docs MCP's phase 2 surface: validate_cypher on a fresh engine per call, discover_capabilities, text-to-cypher, three resources, and hybrid search with a stated fallback | Withdrawn |
| [0034](0034-verify-steps-start-loopback-servers.md) | A verify step may start and stop its own loopback server | Proposed |
| [0035](0035-interactive-element-framework.md) | Interactive elements are directives with recorded static forms, found by directory and loaded lazily on the page's one engine | Proposed |
| [0036](0036-graph-view-extras.md) | Graph view extras live in the one graph module and work on every graph view; cell words set their defaults and the static picture | Proposed |
| [0037](0037-agent-mode-terminal.md) | The agent-mode terminal renders the engine's envelopes as the CLI prints them, on an empty read-only database, with CLI-only facts from recordings | Proposed |
| [0038](0038-plan-viewer-and-timing-bar.md) | The plan viewer is an HTML tree whose static form is the CLI's plan table, and the timing bar shows only a live run | Proposed |
| [0039](0039-live-schema-and-vector-explorer.md) | The live schema reuses the data-model drawing, and the vector explorer projects at record time and checks fusion against the page | Proposed |
| [0040](0040-geospatial-explorer.md) | The geospatial explorer searches the page's own cells on a plane, with a first frame laid out at record time | Proposed |
| [0041](0041-mcp-tryout-and-agent-trace.md) | The MCP tryout and the agent trace answer tool calls in the page by relate serve's mapping, with recorded server answers where the engine cannot speak | Proposed |
| [0042](0042-live-docs-graph.md) | The live docs graph draws a build-made view of the docs graph through the one graph module, with a static form that changes only when pages do | Proposed |
| [0043](0043-home-design-tokens-and-fonts.md) | The site takes its colours and type from the Relate home design: Night by default, three open-source faces, the older token names kept as aliases | Proposed |
| [0044](0044-site-shell-bordered-top-bar-and-footer.md) | The site shell is a bordered-cell top bar and a footer that carries the theme switch | Proposed |
| [0045](0045-no-performance-page-or-benchmarks-in-docs.md) | The docs have no performance page and cite no benchmarks | Proposed |
| [0046](0046-elements-on-cookbook-recipes.md) | Cookbook recipes take the docs pages' interactive elements by the same directive, recorded by the cookbook and loaded by the docs element loader | Proposed |
| [0047](0047-storage-animator.md) | The storage animator is a diagram of documented behaviour that runs no engine, drawn by one model for its static form and its live frames | Proposed |
| [0048](0048-scale-demo.md) | The scale demo builds a large tree from the page's own cells on a second engine in the tab, draws nothing, and shows only the reader's own run | Proposed |
| [0049](0049-twins-link-large-data-blocks.md) | A twin links a data block over 2 KiB to a per-page data file instead of inlining it | Proposed |
| [0050](0050-in-browser-embeddings.md) | The reader's own question is embedded in the browser with the docs' own model on the query-the-relate-docs recipe, fetched from the Hugging Face hub behind a button and checked against pinned hashes | Proposed |
| [0051](0051-graph-diff.md) | The graph diff matches two of the page's results by a key property, draws the changes with a mark as well as a colour, and reruns the page's cells on a database of its own | Proposed |
| [0052](0052-timeline-view.md) | The timeline view draws a step's own rows on a time axis, with columns named by attributes and an as-of slider that re-runs the page's own statement | Proposed |
| [0053](0053-verified-sample-manifests.md) | Each verified language sample is published as a manifest, with the client build it actually ran on | Proposed |
| [0054](0054-replays-mask-timing-values.md) | CLI replays compare output with timing values masked, and pages show a real run's timings | Proposed |
| [0055](0055-borderless-top-bar-and-cookbook-grid.md) | The top bar is borderless, and the cookbook index is one filterable ruled grid | Proposed |
| [0056](0056-docs-chrome-and-landing.md) | Docs and recipe pages get their own ruled header and sidebar; the docs landing is a plain site page | Proposed |
| [0057](0057-hosted-docs-mcp-withdrawn-before-launch.md) | The hosted docs MCP server is withdrawn before launch; the site stays on Cloudflare Pages with its Pages Functions | Proposed |

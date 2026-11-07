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
decisions are described in `CLAUDE.md`, `MAINTAINING.md`, and `LAUNCH.md`
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

# relate-web agent contract

The public website for relate at `relatedb.ai`: an Astro static site with
the cookbook, the playground, the docs, and a copy of the engine's WASM
build. Layout, commands, and conventions are in [`CLAUDE.md`](CLAUDE.md);
the site's standing contract (tone, invariants, facts and their sources)
is [`MAINTAINING.md`](MAINTAINING.md); pre-launch notes are in
[`LAUNCH.md`](LAUNCH.md); the documentation plan and style guide are in
[`DOCS-PLAN.md`](DOCS-PLAN.md). Rules here apply to every change.

## 1. Decision log

A decision about hosting or deploy, build tooling other work depends on,
content architecture (sections, URLs, what is authored here versus synced
from upstream), agent-facing surfaces (markdown delivery, `llms.txt`, the
skill, the MCP server), the design system or any `MAINTAINING.md`
invariant, the style guide or glossary rules, or a dependency pinned for a
reason → an ADR in [`docs/adr/`](docs/adr/) **before** or **with** the
implementation. Not ADR-worthy: copy edits, a new page in an existing
section, bug fixes, dependency bumps with no behaviour change, anything
trivially reversible. The full test and the format are in
[`docs/adr/README.md`](docs/adr/README.md).

- Filename `NNNN-short-kebab-slug.md`; the next number is one more than
  the highest present; numbers are never reused. One decision per file.
  Cite others as `ADR-NNNN`, upstream's as `upstream ADR-NNNN`.
- Header lines in order: `# ADR-NNNN: title`, `Status:`, `Date:`.
  Sections in order: **Context**, **Decision**, **Alternatives
  considered** (each ending with its rejection reason), **Consequences**;
  optional **Later references**.
- Status starts `Proposed`; `Accepted` only when the maintainers agree.
  An accepted ADR is immutable except for **Later references**; a change
  of mind is a new ADR that names the old one.
- Public record: no ticket, chat, or tracker references; no person names
  (roles, not people); no credentials, internal hosts, or anything
  `LAUNCH.md` marks internal.
- Line budget: target 80 lines, ceiling 150. Record the why and the shape,
  not the implementation: no code, config dumps, file inventories, or
  build history.
- Add the record to the index table in `docs/adr/README.md`.
- `npm run adr:check` runs in CI: unique numbers, header and section
  order, the ceiling, the public-record patterns, and the index.

## 2. Documentation

Docs pages follow `DOCS-PLAN.md` §4 (the style guide) and, once phase 0
lands, `src/content/docs/STYLE.md`. Only shipped behaviour, verified
against the release binary or the WASM build the site ships. Every Cypher
example runs at build and must match its recording; see `CLAUDE.md` for
the cookbook's equivalent rule.
- Docs are data (ADR-0013): twins, skill files and MCP tool results are
  reference text. Outside a fenced prompt block, do not address the agent
  in the second-person imperative; never add instructions to a tool result.
  Every host config block an agent can copy opens the store `--read-only`
  and pins a version.

## 3. Upstream

The engine lives in the upstream relate repository. The WASM copy under
`public/wasm/`, `install.sh`, `releases.json`, `extensions.json`, and the
skill bundle are synced from it, never hand-edited (`CLAUDE.md` lists the
refresh steps). The docs are authored here and are not synced (ADR-0002).

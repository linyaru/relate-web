# ADR-0002: Docs are authored in this repository as MDX, not synced from upstream

Status: Accepted

Date: 2026-11-07

## Context

The upstream relate repository holds about eighteen thousand lines of
documentation: per-surface API specs, task guides, deep references,
limitations, and an architecture overview. It is written as the
engineering contract: it cites ADR numbers and ticket identifiers,
describes withdrawn features and build-bundle internals, and reads as a
spec. Upstream's own website brief says the site must not carry ticket
identifiers and that the repo wins where the two disagree.

The website needs reader-facing documentation with interactive components:
runnable Cypher cells on the shipped WASM engine, language tabs, install
blocks, generated tables. Plain markdown synced from upstream cannot carry
those. The cookbook set a precedent in this repo: its recipes moved here
from upstream and upstream stopped syncing them.

## Decision

Documentation pages are written in this repository, in MDX, under
`src/content/docs/`, for the site's readers. They are not linked to
upstream: no provenance field naming an upstream file and commit, no sync
script, no build-time pull. Upstream's `docs/` is reading material for the
author of a page and the release binary's `--help` is the final word on
CLI facts.

Drift between the engine and the pages is caught by other means: every
Cypher example runs at build on the WASM engine the site ships and must
match its recorded result; reference tables that appear on several pages
(exit codes, flags, environment variables, dot-commands) come from one data
file; and the release-time website update agent upstream gets the docs
section added to its brief, finding affected pages by the command, flag, or
function the changelog names.

## Alternatives considered

- **Render upstream's markdown at build time.** No duplication, nothing to
  reconcile. Rejected: the register is wrong for readers, ticket
  identifiers and internal detail would reach the site, and no MDX
  components are possible.
- **Author here, with per-page provenance naming the upstream files and
  commit, plus a drift report.** The reviewer's first proposal. Rejected
  by the maintainers: the bookkeeping is a cost on every page for a link
  that would not stop drift by itself, and the build-time checks catch the
  drift that matters.

## Consequences

- Every factual page has an author responsible for its correctness here,
  not a file upstream.
- Language samples are hand-written; upstream's CI-tested example files
  are starting points, not sources. Per-language sample checks against
  released packages are a later addition if drift appears.
- Upstream's `docs/README.md` should mark its guides and references as
  superseded by the site for reader-facing content, as it did for the
  cookbook.

## Later references

- Amended by ADR-0015: prose constructs are remark directives rendered to
  both forms; JSX is reserved for interactive and generated components.

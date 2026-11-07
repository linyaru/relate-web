# ADR-0001: Record architecture decisions

Status: Accepted

Date: 2026-11-07

## Context

The site has grown from a single static page into an Astro project with a
cookbook pipeline, a playground, a copy of the engine's WASM build, and a
documentation section being planned. Its decisions so far live in
`CLAUDE.md`, `MAINTAINING.md`, `LAUNCH.md`, and two historical plan files,
each written for a different moment, none recording why an alternative
was not taken. The upstream relate repository keeps a numbered, immutable
decision log and requires one for every architecture, protocol, API, or
dependency decision; maintainers and agents move between the two repos.

The documentation plan (`DOCS-PLAN.md`) has just settled sixteen decisions
in conversation. Without a log they would survive only as a table in a
plan file that will be edited as the work proceeds.

## Decision

Keep an architecture decision log in `docs/adr/`, in the format upstream
uses: one decision per file, four-digit sequential numbers, Context,
Decision, Alternatives considered, Consequences; `Proposed` then
`Accepted`; immutable once accepted, superseded by a new record rather than
edited. The convention, the test for what is ADR-worthy, and the
public-record rules are in `docs/adr/README.md`; the agent contract in
`AGENTS.md` makes the rule apply to every change.

Numbers are claimed by taking the next integer in the directory. The repo
does not adopt upstream's minting script and claim-commit proof: this repo
has one maintainer stream and no parallel agent fleets, and a CI check for
duplicate numbers is enough.

Decisions made before this record are not backfilled. They are described
in the existing contract files, and any change to them is ADR-worthy from
now on.

## Alternatives considered

- **Keep decisions in the plan and contract files.** They are easy to
  write and already exist. Rejected: a plan is edited as work proceeds, so
  the record of what was decided and why drifts; nothing records rejected
  alternatives; and there is no signal that a later edit reverses an
  earlier agreement.
- **Adopt upstream's log verbatim, including minting and claim commits.**
  Maximum consistency. Rejected: the mint machinery exists to stop
  concurrent agents from colliding on numbers in a high-traffic repo;
  here it would be ceremony with no collision to prevent.
- **Backfill ADRs for the cookbook move, the playground, and the WASM
  copy.** A complete history. Rejected: the records would be
  reconstructions written after the fact, which is the kind of record the
  format exists to avoid; the contract files describe those decisions
  adequately.

## Consequences

- Every ADR-worthy change (the README's list) lands with its record in the
  same pull request, or with the record first.
- `npm run adr:check` is added in the docs phase 0 work: unique numbers,
  required sections in order, the line ceiling, and the public-record
  patterns.
- `DOCS-PLAN.md` becomes a working document again: its decision table
  points at ADRs, and the ADRs are the record.
- The first records, ADR-0002 to ADR-0009, write down the decisions the
  documentation plan already made.

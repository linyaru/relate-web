# ADR-0022: The docs' shared example graph is the team graph

Status: Proposed

Date: 2026-11-07

## Context

ADR-0008 made one shared example graph a style rule, so a reader moving
between pages and languages recognises the steps, and the style guide
named it "the `friends` graph from the quick start". The phase 1 pages
were written to DOCS-PLAN.md §2 instead, which gives the three Get started
tutorials one seed statement: three people (Ada, Grace, Noor), two
projects (`relate`, `opencypher-tck`), and `WORKS_ON`, `MAINTAINS` and
`KNOWS` relationships. About thirty pages followed the plan; the agent
quickstart alone followed the style guide and built a five-person
`KNOWS` ring. A cross-page review found the two graphs side by side, and
an agent moving from the quickstart to any guide met different labels,
properties and file names for the same job.

## Decision

The shared example graph is the team graph, with the seed statement
DOCS-PLAN.md §2 gives, in a store named `team.rl` (or `team` as a
directory) and a seed script named `team.cypher`. A page that needs more
extends it (a new property, a new node) rather than starting another
graph. The style guide (§4.6, both copies) names it; the friends graph
is retired, and the agent quickstart rehearses a team-graph change.

## Alternatives considered

- **Keep the friends graph and move every other page to it.** It is the
  graph the style guide named. Rejected: it has one label and one
  relationship type, so it cannot show a join, a second label or a
  relationship property worth filtering, and thirty pages and their
  recorded outputs would change for no gain.
- **Allow one graph per section.** Each section picks what fits.
  Rejected: the rule exists so a reader switching pages recognises the
  data; two graphs defeat it.

## Consequences

- The style guide's example-data rule names the team graph; changing the
  graph again is a new ADR.
- The agent quickstart's seed script is byte-identical to the one the
  agent guides write, so its recorded SHA-256 matches theirs.
- Pages that model a different domain on purpose (agent memory, the
  cookbook) say why and link the page they extend.

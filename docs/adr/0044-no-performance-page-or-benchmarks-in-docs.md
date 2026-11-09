# ADR-0044: The docs have no performance page and cite no benchmarks

Status: Proposed

Date: 2026-11-09

## Context

ADR-0014 added two pages to the docs to answer "does relate fit":
`concepts/where-relate-fits` and `reference/performance`. The performance
page carried memory per element, `.rl` open time by store size, query
latency on a public social-network query corpus, mixed read and write
throughput from upstream's frozen loadtests, and output bytes per CLI mode.
The maintainers have decided the docs should not publish that page or
mention benchmarks.

## Decision

- `reference/performance` is removed. It is not replaced by another page,
  and nothing redirects from its URL: the site is pre-launch, so no
  published link breaks.
- No docs page mentions benchmarks, benchmark suites or loadtest results,
  and no page links to the removed URL.
- `concepts/where-relate-fits` stays as ADR-0014 describes it. Its
  out-of-core row points at the sizing guide instead.
- `guides/operate/sizing-and-memory` keeps the memory figures a reader needs
  to size a machine (logical bytes per element, process memory as a
  multiple of logical size, size on disk against logical size), each stated
  with the release and machine it was measured on, with no benchmark named
  as its source.

This supersedes the `reference/performance` part of ADR-0014. The rest of
ADR-0014 stands.

## Alternatives considered

- **Keep the page, dropping the query-latency and throughput sections.**
  Memory per element and open time are sizing facts rather than benchmark
  results. Rejected: the sizing guide already carries the memory figures,
  and a page named "Performance" invites the benchmark reading the
  maintainers want to avoid.
- **Move the output-bytes-per-mode table to the agent-mode reference.**
  Rejected for now: the agent-mode page already states that `toon` is the
  piped default under agent mode; a byte table can be added there later as
  an ordinary reference edit if wanted.

## Consequences

- The docs landing's Evaluate group and `/docs/llms.txt`'s Evaluate group
  lose the performance entry.
- The page's CLI recordings and section embeddings are deleted with it.
- `MAINTAINING.md`'s pointer to ADR-0014 no longer mentions a performance
  reference.
- Re-adding measured performance figures to the docs needs a new ADR.

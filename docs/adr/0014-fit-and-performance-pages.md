# ADR-0014: The docs answer "does relate fit" with a fit page and measured performance

Status: Accepted

Date: 2026-11-07

## Context

`MAINTAINING.md` bans competitive comparisons on the site and bulleted
"not for" lists, and asks that latency claims trace to upstream's frozen
baseline loadtests. The docs plan inherited the ban unexamined. Three
adversarial reviewers (an evaluating AI engineer, a coding agent, a docs
lead) independently found that the plan therefore never answers the first
question an evaluator or an agent asks: whether relate fits the job and
what it costs. The most likely bounce is "no evidence it is smaller,
faster or safer than what I have, and no sign it will exist in a year".
Upstream has the evidence: frozen loadtests (ADR-0046, 0060 to 0062, 0070,
0071), an LDBC query corpus (ADR-0479), a single-source loadtest runner
(ADR-0512), and `relate-agentbench`.

## Decision

For the docs section only, two pages are added at launch and the tone
contract is amended to allow them:

- **`concepts/where-relate-fits`** (replacing `what-is-relate`'s fit
  paragraph): the shape of the thing, "use relate when" and "use something
  else when" as plain conditions (single process, whole graph in RAM, one
  writer, no cluster, no cross-graph queries), with the limit each
  condition comes from. It is the first entry in `/docs/llms.txt` and the
  target of a third landing button, "Does relate fit?".
- **`reference/performance`**: bytes per node and relationship, `.rl` load
  time by size, the LDBC queries at a stated scale factor with machine
  class and methodology, agent-mode output bytes per mode; regenerated per
  release from upstream's artifacts, stamped with the version they ran
  on. No number appears without its harness.

No page names other databases in a comparison table. The ban on
adjective-driven competitive marketing stands everywhere.

## Alternatives considered

- **Fit page, performance page, and a neutral shape table naming Neo4j,
  Kuzu, SQLite plus vectors, LanceDB, Chroma, Graphiti and Mem0.**
  Recommended by the reviewers; the maintainers declined the named table,
  keeping the site's rule against naming competitors. Agents asked
  "relate versus X" will answer from training data plus the fit page.
- **Keep the ban as is.** Rejected: it leaves the adoption question
  unanswered on the one section built for evaluators and agents.

## Consequences

- `MAINTAINING.md`'s fit and comparison rules gain a one-line pointer to
  this record for `/docs/`.
- `reference/performance` depends on a repeatable export from upstream's
  loadtest and LDBC artifacts; the docs team owns the page, upstream owns
  the numbers.
- `reference/limitations` stays the exhaustive list; the fit page is the
  decision aid that links into it.

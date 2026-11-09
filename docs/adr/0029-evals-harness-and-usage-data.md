# ADR-0029: The docs evals grade stores, not prose, and the per-tool usage page is built from counted log lines

Status: Proposed

Date: 2026-11-07

## Context

DOCS-PLAN.md §3.8 asks for a cold-start eval (eight to ten tasks, each run by
headless coding agents under four conditions: nothing, the `AGENTS.md`
block, the skill, the hosted docs MCP endpoint), run by hand before launch
and by `docs:evals` on each release after, reviewed by a person and never by
a model alone. Phase 2 (§10) adds a per-tool usage dashboard for the hosted
docs MCP server. ADR-0013 and ADR-0024 bound what that dashboard can know:
the Worker logs one line per request with the tool, a client family from a
fixed list, the status and a zero-result flag, and never query text, page
ids, IP addresses or full user agents.

Constraints: no model key or Cloudflare account exists before launch, and
nothing may spend money without an operator's consent; the required check
(`cookbook.yml`) needs no secret; harnesses differ in how they take a system
prompt, a skill and an MCP server, and their transcript formats change; the
docs are data (ADR-0013), so a generated page states facts and no
instructions; Workers Logs keeps lines for days, not months.

## Decision

1. A task is graded only by what the agent leaves behind: Cypher assertions
   run read-only with the relate binary against the store at the path the
   prompt names, file assertions, and assertions on the agent's transcript
   (an exit code seen, a flag used, `--read-only` on every command naming a
   store, and at least one such command). A store the prompt says must not
   change is compared in full (ids, labels, property counts, names,
   relationships and indexes), not by counts. A relate command is one with
   relate in command position, so a lookup such as `which relate` or
   `ls .claude/skills/relate` is not one. First-command correctness, error
   round trips and, for open-ended prompts that do not name relate, whether
   the store opens with relate are counted from the same transcript. No
   model reads the result.
2. The harness is agent-agnostic: an operator names a command that receives
   the prompt on stdin in a fresh working directory, with the condition's
   files laid out where agents look for them and also named in the
   environment. The transcript is read in the harness's own JSON Lines form,
   or in Claude Code's or Codex's documented stream forms. The repository
   ships one wrapper as a worked example; it never runs in the required
   check.
3. Without an agent command the eval prints "skipped" and exits 0. A dry
   run proves the harness end to end with fixture agents that drive the
   binary directly: one grades every task green, one fails exactly one
   assertion, one writes to a store it must not change and leaves no
   transcript. The live run is a workflow started by hand, or by the
   `relate-release` dispatch once the operator opts in with repository
   variables; it needs the operator's key, never runs on a schedule, and
   opens a pull request with the scores. The agent has unrestricted Bash,
   so it runs in a job with read-only repository permission and no stored
   checkout credential, and it gets only an allowlist of environment
   variables (the model keys, never a repository or Cloudflare token); a
   separate job with write permission checks the scores file and opens the
   pull request.
4. Scores are committed data (`_data/evals.json`): one entry per harness and
   condition, each carrying the date, the engine version graded with, the
   harness and every assertion's result with what came back on failure. A
   new run replaces the same harness and condition.
5. Usage is a committed data file (`_data/usage.json`) collected by a script
   from Cloudflare's Workers Observability telemetry query API as counts
   grouped by tool, client family, status, zero-result flag and tool error
   code (the last two only when the period's lines carry them); no single
   log line is copied out. Per tool it records calls, refusals by the cost
   budget, failures and zero-result calls, from which the page states a
   completion rate. A per-IP refusal is refused before the body is read,
   names no tool, and is not counted per tool. A collection covers at most the retention
   window. Without the account's credentials the script prints "skipped".
   The file starts with no period and the note "no deployment yet".
6. A generated reference page renders the usage file as a table beside the
   docs MCP server's page, and says plainly when there is no data, what is
   counted, what is never counted, how long Cloudflare keeps the lines and
   the period. Its twin is the same table.

## Alternatives considered

- **A model grades the transcript or the answer.** Scales to open-ended
  tasks. Rejected: the plan requires a person's review, and a grader model
  shares the blind spots the eval looks for; a store is a fact.
- **Bind the harness to one agent's SDK.** Richer transcripts and tool
  hooks. Rejected: the eval compares harnesses, and an SDK binding would
  make every other harness second class.
- **Run the eval in CI on every pull request or on a schedule.** Catches
  regressions early. Rejected: it spends money without consent and needs a
  secret the required check cannot have.
- **Run on every relate release with no opt-in.** Matches the plan's "per
  release" with nothing to configure. Rejected: a release is not consent
  to spend; the dispatch runs only once the operator sets the agent's
  package and name as repository variables, which is that consent.
- **A live dashboard querying Cloudflare at page view.** Always current.
  Rejected: it needs a credential in the page or a proxy, breaks the static
  build and the twin, and the counts are reviewed before publication anyway.
- **GraphQL Analytics for the counts.** No log store involved. Rejected:
  its Workers dataset counts invocations by script and status, not the
  fields the Worker writes, so it cannot split calls by tool or client
  family.

## Consequences

- The first operator run against a real agent and the first usage
  collection against the deployed Worker are launch items; until then the
  third-party transcript readers and the telemetry query are checked only
  against their documentation and unit fixtures, and the collection fails
  closed when the log line's fields are not indexed as keys.
- A task suite change or a new condition is a data change reviewed with its
  fixture answer; the dry run must stay green.
- An agent that reaches a store through a client library or a shell
  variable fails the `--read-only` transcript assertion, since no command
  shows the flag; that is the price of never passing it vacuously.
- Harnesses take conditions differently: the shipped Claude Code wrapper
  runs bare except under the skill condition, where bare mode would not tell
  the model the skill exists; that difference is part of what the skill
  condition measures.
- The usage page's period is at most the retention window; a longer history
  is the sum of committed collections in the repository history.
- The docs MCP page and the privacy page point at the usage page; changing
  what the Worker logs changes the page's "what is counted" table with it.

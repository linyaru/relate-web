# ADR-0057: The hosted docs MCP server is withdrawn before launch

Status: Proposed

Date: 2026-11-10

## Context

ADR-0006 decided on a hosted docs MCP server at `relatedb.ai/mcp`, ADR-0012
put it on a Cloudflare Worker beside the Pages site, and ADR-0015, ADR-0023,
ADR-0024 and ADR-0033 shaped its tools, limits and phase 2 surface. It was
built and checked locally, but never deployed, and it is not ready to ship
at launch: the account, the route in front of the Pages domain, Workers AI
for hybrid search, the rate limiting bindings and the paid plan its bundle
size needs are all unverified, and its search ranking has open work.

Keeping it in the repository has a cost even while it is not live. It is
its own package that every CI run installs, tests, bundles and type-checks;
the docs describe it on a reference page, a usage page and a dozen
mentions, each marked as a launch-day target; the evals harness has a
condition for it; and the privacy, security and launch notes track its
logging, limits and abuse contact. Every docs change pays for a surface no
reader can use.

## Decision

The hosted docs MCP server leaves the site until it is ready to ship.

1. The Worker package, its local check, its runbook, the usage page and the
   script and data behind it, and its reference page are removed. Pages
   that mentioned it no longer do, and nothing on the site names
   `relatedb.ai/mcp`.
2. Cloudflare Pages still hosts the site (ADR-0012), with the Pages
   Functions for markdown negotiation and the agent-path log (ADR-0025).
   Only the Worker, its route, and the Workers AI and rate limiting
   bindings go.
3. relate's own MCP server (`relate serve --mcp`) is product documentation
   and is unchanged, as is the docs graph (ADR-0007, ADR-0015): its seed
   script, JSON, `.rl` store and the cookbook recipe over it stay. The
   docs graph page carries the local, read-only way to serve it to an MCP
   host.
4. The cold-start evals run under three conditions: none, the AGENTS.md
   block and the skill (ADR-0029).
5. The committed section embeddings stay; they serve the docs graph and the
   recipe, not only hybrid search on the Worker (ADR-0028).
6. Bringing the server back is a new ADR. The design in `DOCS-PLAN.md`
   §3.7 is kept as the starting point, and the removed code is in the
   repository's history.

## Alternatives considered

- **Keep the code and docs, and leave the deploy step off.** Nothing would
  be lost, and the Worker would be ready when the account is. Rejected:
  every CI run and every docs change would keep paying for it, and the
  pages would keep describing an endpoint that does not answer.
- **Keep the Worker package, remove only its docs.** The pages would be
  honest and the code kept current. Rejected: the package is coupled to the
  docs build (its bundle reads the built twins, recipes and samples), so it
  would still break on docs changes nobody is testing it for.
- **Ship it at launch as planned.** Rejected: the account and platform
  items it depends on are unverified, and a public endpoint with rate
  limits, logging and an abuse contact is not something to launch untested.

## Consequences

- CI no longer installs, tests, bundles or type-checks a Worker. The
  agent-endpoints workflow checks the Pages Functions only. The Worker's
  bundle step also checked that each twin and the docs graph agree on
  section order; that check goes with it.
- The deploy needs Pages permissions only, and launch no longer depends on
  Workers AI, the rate limiting bindings, the Workers Paid plan or a Worker
  route in front of the Pages domain.
- The docs make no promise of a hosted endpoint. An agent reads the docs as
  markdown twins, `llms.txt`, the skill and the docs graph.
- ADR-0006, ADR-0012, ADR-0015, ADR-0028 and ADR-0029 carry a later
  reference to this record; ADR-0023, ADR-0024 and ADR-0033 are withdrawn.

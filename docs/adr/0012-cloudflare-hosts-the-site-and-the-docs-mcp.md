# ADR-0012: Cloudflare hosts the site and the docs MCP endpoint

Status: Accepted

Date: 2026-11-07

## Context

`LAUNCH.md` left the production host open: the interim preview runs on
GitHub Pages, and both a GitHub Pages and a Cloudflare Pages deploy
workflow exist. Two decisions in the docs plan depend on the host:

- ADR-0005 wants `Accept: text/markdown` on a canonical docs URL to return
  the page's markdown twin. That needs a host that can branch on a request
  header. GitHub Pages cannot; Cloudflare (a Pages function or a Worker)
  and Vercel can.
- ADR-0006 and ADR-0011 put the hosted docs MCP at `https://relatedb.ai/mcp`
  on a Cloudflare Worker running the WASM engine through the Agents SDK's
  stateless handler, with a Cloudflare Container as the fallback. Serving
  it on the site's own origin needs the site and the Worker on one
  platform, or a reverse proxy in front of two.

The site is static (ADR-0002, ADR-0003), so the host only has to serve
files, run a small edge function, and run the MCP Worker. The maintainers
want one account, one deploy, and one bill.

## Decision

`relatedb.ai` is served by Cloudflare: Cloudflare Pages for the static
site, built and published by the existing `deploy-cf.yml`, and a Cloudflare
Worker (`workers/docs-mcp/`, deployed by the same workflow after the site)
for `/mcp`. The `Accept: text/markdown` branch and the `x-markdown-tokens`
header live in a Pages function on the docs routes. Content negotiation
(ADR-0005's conditional item) is therefore in, at phase 1.

GitHub Pages remains the interim preview until DNS moves; `deploy-pages.yml`
is retired at launch as `LAUNCH.md` already lists.

## Alternatives considered

- **GitHub Pages for the site, the MCP Worker on its own hostname.** No new
  account for the site. Rejected: no content negotiation, a second origin
  for the MCP endpoint (CORS, a second TLS name, a second place to deploy),
  and a private repo would need a paid GitHub plan for Pages anyway.
- **Vercel for both.** Header-conditioned rewrites and serverless functions
  cover the same needs. Rejected: the MCP design (WASM engine in a Worker,
  Container fallback, Workers AI for build-time embeddings) is already
  Cloudflare-shaped and verified; porting it buys nothing.

## Consequences

- `LAUNCH.md`'s "pick the host" item is decided; the remaining host items
  there (DNS, TLS, `www` redirect, retiring the Pages workflow) stay as
  launch tasks.
- `deploy-cf.yml` grows a Worker deploy step; the Pages function for
  markdown negotiation and the Worker are new code in this repo, covered by
  the docs plan's phase 1.
- ADR-0005's conditional content negotiation becomes unconditional.
- A change of host is a new ADR.

## Later references

- Phase 0 verifies the topology: if a Worker route cannot front `/mcp` on
  the Pages custom domain, the site moves to one Worker with static assets
  (same platform, one deploy). Cloudflare's cache ignores `Vary`, so the
  markdown branch uses its own cache key or `Cache-Control: private`.

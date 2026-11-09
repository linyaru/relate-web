# The docs MCP server (`https://relatedb.ai/mcp`)

A Cloudflare Worker (`workers/docs-mcp`) that serves the docs over MCP. It
deploys from `main` only, after the site, in `deploy-cf.yml` (no preview). A
Pages Function in `functions/` serves markdown negotiation for `/docs`,
`/skill.md`, `/skills/*`, `/llms.txt` and `/.well-known/*` (`public/_routes.json`).

Not live until launch: it needs the `relatedb.ai` zone in the same Cloudflare
account, Workers Paid, and the `RL_IP` / `RL_COST` rate-limit bindings (see
the header of `deploy-cf.yml` and `workers/docs-mcp/README.md`).

## Check

```bash
curl -s https://relatedb.ai/healthz                  # JSON: engine version, node count vs expected, vectors, limiter
curl -s https://relatedb.ai/mcp | head               # plain-text description (GET without Accept: text/event-stream)
curl -s -X POST https://relatedb.ai/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Locally, after a site build: `npm ci --prefix workers/docs-mcp && npm run docs:mcp-check`
(runs the Worker under `wrangler dev --local`; `-- --coldstart` times cold starts).
Logs: Cloudflare Workers Logs (one line per request); usage: `npm run docs:usage`.

## Failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/healthz` says node count differs from expected | The replayed docs graph and the bundle disagree. | Rebuild: `npm run build && npm run mcp:bundle`; it fails when a twin and the graph disagree about a section. |
| `/healthz` limiter is `in-isolate-fixed-window` | The `RL_IP` / `RL_COST` bindings are missing. | Declare them under `ratelimits` in `wrangler.jsonc`; redeploy. |
| 429, `-32010` / `-32011` | Rate limit or tool-cost budget (20 req / 10 s per IP; 120 units / 60 s per IP and tool). | Honour `Retry-After`; not a fault. |
| 413, `-32012` | Request over 64 KiB. | Shrink the request. |
| `/mcp` 404 or served by Pages | The Worker route is not in front of Pages on `relatedb.ai`. | Check the route in `wrangler.jsonc` and the zone. Not verified yet (no account). If a route cannot front Pages, ADR-0012 "Later references": one Worker with static assets. |
| Worker deploy step fails | Token lacks Workers Scripts/Routes: Edit, or Workers Paid is missing. | Fix the token or plan. |
| Bundle step fails in CI | `generated/` is built from `dist/`; the site build must run first. | `npm run build && npm run mcp:bundle`. |
| Markdown negotiation wrong on `/docs` | The Pages Function. | `npm run build && npm run docs:negotiation-check`. |

## Roll back

The Worker is separate from the site. Revert the commit and let `main` redeploy,
or from `workers/docs-mcp`: `npx wrangler rollback` (see the Worker's README for
its pinned wrangler). Site rollback: [rollback-site.md](rollback-site.md).

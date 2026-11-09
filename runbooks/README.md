# Runbooks

Step-by-step procedures for operating and debugging the relate website. Written
for a person or an agent with a shell, `gh` and `curl`, and nothing else
assumed. Each runbook says when to use it, how to check, what to do, and how to
confirm it worked. Public product docs live in `src/content/docs/`, not here.

## The site is wrong or down: start here

Work from the outside in. Stop at the first row that explains it.

| Symptom | Go to |
| --- | --- |
| The URL does not load, wrong certificate, or "site not found" | [dns-and-hosts.md](dns-and-hosts.md) |
| It loads but is old, or a change did not appear | [deploy-failed.md](deploy-failed.md) (was there a deploy? did it fail?) |
| A deploy run is red | [deploy-failed.md](deploy-failed.md) |
| The live demo, cookbook runner or playground says not ready, errors, or hangs | [wasm-demo-broken.md](wasm-demo-broken.md) |
| `releases.json`, `install.sh` or `extensions.json` is stale, missing or wrong; `relate upgrade --check` fails | [release-discovery.md](release-discovery.md) |
| `/mcp` or `/healthz` fails, or an agent cannot reach the docs server | [docs-mcp-worker.md](docs-mcp-worker.md) |
| A bad deploy is live and must come off now | [rollback-site.md](rollback-site.md) |

## First five minutes (any failure)

```bash
# 1. What did the deploys do last?
gh run list -R relatedb/relate-web -L 10
gh run view <run-id> -R relatedb/relate-web --log-failed | tail -80

# 2. What is live? (interim preview host; relatedb.ai after launch)
curl -sI https://r31473.relatedb.ai/ | head -5
curl -s https://r31473.relatedb.ai/releases.json | head -c 300

# 3. What is the repo at?
git -C <checkout> log --oneline -5 main
```

Facts worth knowing before touching anything:

- Two hosts are deployed from `main`: GitHub Pages (`deploy-pages.yml`, the
  interim host `r31473.relatedb.ai`) and Cloudflare Pages (`deploy-cf.yml`,
  project `relate-web`; it skips, green, until its secrets exist).
- The site is static (`dist/`). A failed deploy leaves the previous deploy live.
- The preview host is unlisted, not private, and carries `noindex`.
- `install.sh`, `releases.json` and `extensions.json` (+ `.sig`) are signed or
  generated upstream. Never hand-edit them; see [release-discovery.md](release-discovery.md).
- CI runs Node 24. If `npm ci` refuses a lockfile, regenerate it with the npm
  that ships with Node 24.

## Writing a runbook

One file per procedure. Sections: **When to use**, **Check**, **Fix** (numbered
commands that can be pasted), **Confirm**, **Roll back**. Name the exact
workflow, script or file. If a step has never been run for real, say so.

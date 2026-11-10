# Roll back the site

## When to use

A deploy succeeded but the live site is worse than before: a broken page, a bad
demo, wrong content. If the deploy failed, nothing was replaced; see
[deploy-failed.md](deploy-failed.md).

## Fix: revert and redeploy (both hosts)

The deploys build from `main`, so the rollback is a commit.

```bash
git switch main && git pull
git log --oneline -10                      # find the bad commit (a merge commit needs -m 1)
git revert <sha>                           # or: git revert -m 1 <merge-sha>
git push                                   # branch protection may require a pull request
```

The push triggers `Deploy site` and `Deploy to Cloudflare Pages`. Watch it:
`gh run watch -R relatedb/relate-web`.

## Fix: Cloudflare Pages only, immediately

Cloudflare keeps earlier deployments: dashboard → Workers & Pages → `relate-web`
→ Deployments → pick a good one → Rollback. (CLI:
`npx wrangler pages deployment list --project-name=relate-web`.) This does not
change `main`; follow with a revert so the next deploy does not reintroduce it.

## What a revert does not undo

- **Release-discovery files** (`install.sh`, `releases.json`, `extensions.json`)
  are fetched from upstream at deploy time. Reverting a commit here leaves them
  as upstream has them. To pull a bad release off the site, mark it a prerelease
  or delete it upstream and redeploy: [release-discovery.md](release-discovery.md).
- **The docs MCP Worker** deploys separately, from `main`, after the site:
  [docs-mcp-worker.md](docs-mcp-worker.md).
- **`public/wasm/`** is a plain commit; a revert restores the previous engine.

## Confirm

```bash
gh run list -R relatedb/relate-web -L 3
curl -s https://relatedb.ai/ | head -c 400
npm run cookbook:check && npm run docs:check        # locally, on the reverted tree
```

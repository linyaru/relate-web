# A deploy failed, or a change did not appear

## When to use

A push to `main` is not live, or a deploy run (`Deploy site`, `Deploy to
Cloudflare Pages`) is red. A failed deploy never replaces the live site, so
the site is "old", not broken.

## Check

```bash
gh run list -R relatedb/relate-web -L 10
gh run view <run-id> -R relatedb/relate-web --log-failed | tail -100
gh run view <run-id> -R relatedb/relate-web --json jobs -q '.jobs[].steps[]|select(.conclusion=="failure")|.name'
```

The failed step name tells you the layer. Both deploy workflows run the same
steps in this order (Cloudflare adds the negotiation check and the deploy).
On Cloudflare the steps up to `Sanity check` are the `build` job, which holds
no Cloudflare secret and uploads `dist/`; the `deploy` job installs with
`--ignore-scripts`, downloads `dist/` and runs `Deploy to Cloudflare Pages`
(ADR-0059):

| Failed step | Cause | Fix |
| --- | --- | --- |
| `npm ci` | Lockfile out of sync (CI uses the npm that ships with Node 24), or a registry blip. | Regenerate the lockfile with Node 24's npm, commit, push. Retry once for a network error. |
| `npm ci --prefix playground` | Same, for `playground/package-lock.json`. | Same. |
| `Check cookbook` (`npm run cookbook:check`) | A recipe no longer matches its recorded result, a diagram is stale, or a recipe is invalid. Usually the engine (`public/wasm/`) changed. | Run it locally; `COOKBOOK_ONLY=<slug> npm run cookbook:check` narrows it. If the engine change is intended, `npm run cookbook:record`, review the diff, commit. If not, the WASM is wrong: see [wasm-demo-broken.md](wasm-demo-broken.md). Stale diagrams: `npm run cookbook:diagrams -- --force` after `npm ci --prefix scripts/cookbook-diagrams` (needs Chrome). |
| `Check docs` (`npm run docs:check`) | A docs page, recorded result, link or schema fails its check. | Run locally; it names the file. `DOCS_CHANGELOG_PENDING` is only for the release-refresh PR; CI never sets it, so a missing changelog entry blocks merge by design. Recordings: `npm run docs:record`. |
| `Fetch release-discovery files` | Upstream's release assets are missing or fail verification. | [release-discovery.md](release-discovery.md). |
| `Build site` | Astro or TypeScript error. | Run `npm run build` and `npm run check` locally. |
| `Check built docs` (`docs:check -- --built`) | The built pages disagree with the docs graph. | Run `npm run build && npm run docs:check -- --built`. |
| `Check content negotiation` (Cloudflare) | The Pages Function in `functions/` misbehaves under `wrangler pages dev`. | `npm run docs:negotiation-check` after a build. |
| `Sanity check` | An expected file is missing from `dist/` (`index.html`, `wasm/relate.js`, `wasm/relate_bg.wasm`, `playground/index.html`, `CNAME`, `install.sh`, `releases.json`, `extensions.json`). | `ls dist`; usually a build or fetch problem upstream of this step. |
| `Deploy to Cloudflare Pages` | Bad or missing token, or the project does not exist. A bundling error naming a package means the Pages Functions now need one whose install script must run, which the deploy job does not allow. | Check `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`; the project is `relate-web` (`npx wrangler pages project create relate-web --production-branch main`). For a bundling error, keep `functions/` to dependencies that work without install scripts. |
| `Comment the preview URL on the pull request` (Cloudflare, pull requests) | The `comment` job could not write the comment: GitHub API error, or the repository's workflow permissions forbid write scopes. The preview itself deployed. | The URLs are in the `deploy` job's summary. Re-run the failed job; check Settings > Actions > General > Workflow permissions allows jobs to ask for write. If no comment and the job was skipped, `Record deployment URLs` warned that wrangler's output had no `pages.dev` URL. |
| `configure-pages` / `deploy-pages` | Pages is not set to "GitHub Actions", or the custom domain is unset. | [dns-and-hosts.md](dns-and-hosts.md). |

## Not red, but nothing changed

- The Cloudflare run is **green and skipped** until `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` exist (the build job's first step prints a notice).
- A pull request from a fork never deploys a preview: GitHub gives fork runs
  no secrets and both jobs skip them (ADR-0059). Push the branch to this
  repository to get a preview. Only GitHub
  Pages is deploying until then.
- A newer push cancels an in-progress Pages deploy (`cancel-in-progress`). Look
  at the newest run, not the first.
- The browser or CDN is holding the old page: `curl -sI <url> | grep -i 'etag\|last-modified\|age'`
  and compare with a hard refresh.
- `gh run list` shows no run: the workflow did not trigger. Check the branch
  (`main`) and, for pokes, [release-discovery.md](release-discovery.md).

## Confirm

```bash
gh run list -R relatedb/relate-web -L 3        # newest Deploy site run: success
curl -s https://relatedb.ai/ | grep -o '<title>[^<]*'
```

## Roll back

[rollback-site.md](rollback-site.md).

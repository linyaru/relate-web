# Release discovery files

`install.sh`, `releases.json`, `extensions.json` and `extensions.json.sig` are
served at `/install.sh`, `/releases.json` and `/extensions.json` (canonical:
`https://relatedb.ai/…`). The CLI pins these URLs: `install.sh` installs it and
`relate upgrade --check` reads `releases.json`. Design: upstream ADR-0546
(`relatedb/relate`, `docs/adr/0546-release-discovery-via-relate-web.md`).

## How it works

1. Upstream's release pipeline attaches the files to a release:
   `install.sh` + `releases.json` to the newest stable core release (`vX.Y.Z`);
   the signed `extensions.json` pair to an extension release
   (`relate-extensions-<name>-<X.Y.Z>`). Signing happens upstream only.
2. Upstream sends `repository_dispatch` `relate-release` to this repo with
   `{"kind": "cli"|"extension", "tag": "..."}`, using `RELATE_WEB_DISPATCH_TOKEN`.
3. `deploy-pages.yml` and `deploy-cf.yml` run on it. Before the build they run
   `scripts/fetch-discovery.sh`, which pulls the newest release's files
   (newest by publish date, never by the poke's tag), checks them and writes
   them into `public/`. The deploy then publishes `dist/`. No pull request, no
   review: a release is never held up by the website.
4. Separately, a `cli` poke also runs `engine-release.yml`, which opens a
   reviewed pull request for the docs, WASM and skill refresh. It does not gate
   the files above.

The copies checked in under `public/` are **seed copies** for local work and for
the time before the first release. A deploy overwrites them.

What `fetch-discovery.sh` checks, and fails closed on (the deploy stops and
the live site stays as it was):

- the newest core release has both `install.sh` and `releases.json` assets;
- `releases.json` parses and lists that release as `latest`;
- `install.sh` pins a `SIGNING_KEY`;
- `extensions.json` parses and `extensions.json.sig` verifies against that key
  (SSHSIG, namespace `relate-release`).

With no stable core release yet it keeps the seed copies; likewise for
extensions with none published.

## Check what is live

```bash
HOST=https://relatedb.ai
curl -s $HOST/releases.json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(r.latest?.tag, r.generated_at)'
gh release list -R relatedb/relate --limit 5                       # newest core release
curl -s $HOST/install.sh | grep '^SIGNING_KEY'
curl -sI $HOST/extensions.json | head -3
```

Expected: the live `latest.tag` equals the newest stable `vX.Y.Z` release. If it
does not, find the failing step below.

## Failures

Find the deploy's "Fetch release-discovery files" step (`gh run view <id> -R relatedb/relate-web --log`),
or the summary it writes. Messages come from `scripts/fetch-discovery.sh`.

| Message | Meaning | Fix |
| --- | --- | --- |
| `could not list the releases of … (is GH_TOKEN set…)` | No read access to `relatedb/relate` (private before launch). | Set/refresh org secret `RELATE_UPSTREAM_TOKEN` (contents + releases read), make it visible to this repo; redeploy. |
| `… is the newest core release but has no install.sh and releases.json assets` | The release exists but upstream has not attached the files (pipeline still running, or it failed). | Wait for upstream's release run, or backfill (below); then redeploy. |
| `releases.json on vX lists 'vY' as latest` | Stale or wrong generated document. | Backfill `publish-releases-json` upstream; redeploy. |
| `install.sh … pins no SIGNING_KEY` | Wrong or truncated `install.sh` asset. | Check upstream `distribution/install.sh`; backfill. |
| `no pinned SIGNING_KEY in install.sh to verify extensions.json` | Same, hit from the extensions step. | As above. |
| `extensions.json.sig … does not verify` | Signed with a different key or namespace, or the pair is mismatched. | Do not bypass. Backfill `publish-extensions-json` upstream. Known: the pre-release seed `.sig` verifies only under the old `cypherlite-release` namespace. |
| `… is not JSON` | Corrupt asset. | Backfill upstream. |
| `RELATE_UPSTREAM_TOKEN is not set: using the checked-in …` (notice) | Fetch was skipped; the seed copies were deployed. Fine pre-launch. | Set the token. At launch set repo variable `RELATE_DISCOVERY_REQUIRED=true` so this fails instead of skipping. |

A deploy that races a release (a push to `main` lands after the release but
before upstream attaches the files) fails closed with the "no assets" message;
the poke that follows redeploys.

## Backfill and redeploy by hand

Upstream, regenerate and re-attach (also re-pokes this repo):

```bash
gh workflow run publish-releases-json.yml   -R relatedb/relate   # releases.json + install.sh
gh workflow run publish-extensions-json.yml -R relatedb/relate   # signed extensions pair
```

Here, redeploy without a release (sends the same poke upstream sends; deploys
both hosts):

```bash
gh api repos/relatedb/relate-web/dispatches \
  -f event_type=relate-release -f 'client_payload[kind]=cli' -f 'client_payload[tag]=vX.Y.Z'
```

GitHub Pages only: `gh workflow run deploy-pages.yml -R relatedb/relate-web`.

If the pokes never arrive: in the upstream run, look for
`RELATE_WEB_DISPATCH_TOKEN is not set — skipping the relate-web poke` (token
missing; it needs `contents:write` on this repo and is shared org-wide) or an
HTTP error (any non-204 other than 404 fails that run).

## Try the fetch locally

Overwrites the four files in `public/`; revert afterwards.

```bash
GH_TOKEN=$(gh auth token) npm run discovery:fetch
git status --short public && git checkout -- public/install.sh public/releases.json public/extensions.json public/extensions.json.sig
```

## Take a bad release off the site

Fetch ignores drafts and prereleases, and picks the newest of what remains.
Upstream: mark the bad release as a prerelease or delete it, then redeploy
(dispatch above). Reverting a commit here does not help: these files come from
upstream at deploy time.

## Docs refresh pull request (`engine-release.yml`)

On a `cli` poke it refreshes docs, `public/wasm/`, the skill bundle, recordings
and engine version into a reviewed pull request (draft when a step failed; the
body is a per-step report). By hand:

```bash
gh workflow run engine-release.yml -R relatedb/relate-web -f version=X.Y.Z
```

Secrets: `RELATE_UPSTREAM_TOKEN` (read), `RELEASE_PR_TOKEN` (so the PR starts the
required Cookbook check). Run it locally: `bash scripts/release-refresh.sh --version X.Y.Z`.

## Status

The fetch has been exercised only against a stubbed `gh`; no relate release
existed yet. Dry-run it on the first real release and record what you saw here.

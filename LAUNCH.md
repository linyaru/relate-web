# LAUNCH — relatedb.ai pre-launch notes

Status: **stealth**. Nothing is published: no packages, no releases, no public
repos. Everything on this site that points at a package, release, or URL is
written for the launch-day names and will 404 until then.

Working notes and plans live here. `MAINTAINING.md` is the standing contract
for the site; `PLAN.md` / `WEBSITE-PLAN.md` are historical (from the
cypherlite-era redo) and should not be extended.

## Decisions

- Name: `cypherlite` → `relate`. Site domain: `relatedb.ai`.
- Local preview: launch config `relate-web` (port 8765, `npm run dev`).
- Site is being migrated to Astro (branch `astro-migration`); later: evaluate the relate + Astro beta integration (separate repo).
- `public/wasm/` is a copy of upstream `surfaces/relate-wasm/pkg/` (built with
  `scripts/build-wasm.sh --mode release`). Re-copy after upstream changes.

## Target names (from upstream sources; none published yet)

| Surface | Name |
|---|---|
| Install script | `https://relatedb.ai/install.sh` |
| Release discovery | `https://relatedb.ai/releases.json` |
| Releases / repo | `github.com/relatedb/relate` |
| Binaries | `relate-<os>-<arch>` |
| Python | `relate-db` (`import relate`) |
| npm (Node / browser) | `@relate/relate` / `@relate/relate-wasm` |
| Java | `com.relate:relate` |
| Go | `github.com/relatedb/relate/clients/go` |
| Swift | `Relate` via `github.com/relatedb/relate` |

## Open work before launch

- [ ] Replace remaining `cypherlite` URLs/package/asset names in `index.html`, `llms.txt`, `demo-scenarios.md` with the names above
- [ ] Regenerate or replace `releases.json`, `extensions.json` (+ `.sig`), `install.sh` from upstream (still the cypherlite-era copies)
- [ ] Update `sitemap.xml`, `robots.txt` (currently stealth-appropriate? decide), `update-website.yml`
- [ ] Set up Pages / hosting and DNS for `relatedb.ai`; deploy workflow (old one lived on cypherlite `main`)
- [ ] Add `noindex` / robots block while stealth; remove at launch
- [ ] Playground (`/relate/playground/`) and cookbook (`/relate/cookbook/`) links stay in `index.html`; they 404 on the interim host until those pages are built and published (upstream `examples/wasm-playground`, `scripts/cookbook`) and the paths are settled
- [ ] GitHub links (header, footer) point to `relatedb/relate`, which is private: 404 for logged-out visitors until the repo is public. Other repo links (releases, issues, TCK doc, extensions examples) still point at `neo4j-labs/cypherlite`
- [ ] Fix canonical / `og:url` / `sitemap.xml` (still `neo4j-labs.github.io/cypherlite/`) for the interim host, then again for `relatedb.ai`

## Switch hosts: github.io → relatedb.ai

Interim: GitHub Pages at `https://relatedb.github.io/relate-web/` via
`.github/workflows/deploy-pages.yml` (needs Settings → Pages → Source:
GitHub Actions; a private repo needs a paid plan, and the published site is
public). Later: `relatedb.ai` on a more scalable host (CDN / static hosting).

- [ ] Pick the host and set up hosting, TLS, and DNS for `relatedb.ai` (+ `www` redirect)
- [ ] Replace or retire `deploy-pages.yml` with a deploy for the new host; remove the Pages site and `github-pages` environment
- [ ] Serve from the domain root: check root-relative links (`/relate/playground/`, `/relate/cookbook/`) and the `/relate-web/` subpath assumption are gone
- [ ] Update canonical, `og:url`, `sitemap.xml`, and any hard-coded `github.io` URLs
- [ ] Keep `install.sh` and `releases.json` at `https://relatedb.ai/` (the CLI's `upgrade` reads `releases.json`; release workflows rewrite it), with correct content types and no caching that hides new releases
- [ ] Set cache headers: long-lived for `fonts/` and `wasm/`, short for `index.html`, `releases.json`, `install.sh`; serve `.wasm` as `application/wasm`
- [ ] Redirect the old github.io URL to `relatedb.ai` if it was ever shared; update links in READMEs and package metadata
- [ ] Re-run the launch-day sanity checks below against `relatedb.ai`

## Launch-day sanity checks

Run in order, from a clean machine/container with no cached state and no
GitHub token.

**Site**
- [ ] `https://relatedb.ai/` loads over HTTPS, valid cert, `www` redirect works
- [ ] No console errors; live WASM demo reaches "ready" and runs a sample query
- [ ] No remaining `cypherlite` / `neo4j-labs` strings: `curl -s https://relatedb.ai/ https://relatedb.ai/llms.txt | grep -ci cypherlite` → `0`
- [ ] Every link on the page resolves (run `lychee` against the live URL); no 404s to repos/releases/packages
- [ ] `robots.txt` and `sitemap.xml` allow indexing; `noindex` removed; `llms.txt` served as text
- [ ] Light/dark theme, mobile width, cli/agentic toggle, copy buttons all work
- [ ] Version shown on the page matches the latest release tag

**Install paths** (each one on a clean environment)
- [ ] `curl -sSfL https://relatedb.ai/install.sh | bash` installs; `relate --version` matches the release; signature + SHA256SUMS verification passes
- [ ] `relate upgrade --check` reads `https://relatedb.ai/releases.json` successfully
- [ ] Prebuilt binaries download for macOS arm64/amd64, Linux arm64/amd64, Windows
- [ ] `pip install relate-db` then `python -c "import relate"`
- [ ] `npm install @relate/relate` and `npm install @relate/relate-wasm` (platform optional deps resolve)
- [ ] Java: `com.relate:relate` resolves from Maven Central
- [ ] Go: `go get github.com/relatedb/relate/clients/go`
- [ ] Swift: package resolves from `github.com/relatedb/relate`
- [ ] `relate skill install` works and the agent skill loads

**Quickstart fidelity**
- [ ] Copy-paste every command block in the quickstart and examples on a clean machine; output matches what the page shows
- [ ] `llms.txt` instructions work end to end for an agent with no prior context

**Repo / access**
- [ ] `relatedb/relate` repo visibility is public; README, LICENSE, releases visible logged out
- [ ] Private repos (`*-private`) remain private; no private URLs, internal ADR links, or customer data in public pages
- [ ] Release signing public key on the site matches `distribution/release-signing-key.pub`

## Rollback

- Site: revert the deploy commit on `main` and redeploy.
- Packages cannot be un-published cleanly; verify names/versions in a dry run (TestPyPI, `npm publish --dry-run`) before the real push.

## Interim preview host (internal, unlisted)

- Host: `https://r31473.relatedb.ai/` (CNAME `r31473` → `relatedb.github.io` in GoDaddy DNS; `CNAME` file in the repo and deploy artifact).
- Hostname is obscure, **not private**: certificate-transparency logs expose it. `index.html` has `noindex, nofollow` and `robots.txt` disallows all. Remove both at launch.
- GitHub: `relatedb/relate-web` → Settings → Pages → Source: GitHub Actions, custom domain `r31473.relatedb.ai`, then Enforce HTTPS (after DNS verifies: `dig +short CNAME r31473.relatedb.ai` → `relatedb.github.io.`).
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim its subdomains on Pages.
- Retire this record and the `CNAME` file when switching hosts.

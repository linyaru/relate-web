# LAUNCH — relatedb.ai pre-launch notes

Status: **stealth**. Nothing is published: no packages, no releases, no public
repos. Everything on this site that points at a package, release, or URL is
written for the launch-day names and will 404 until then.

Working notes and plans live here. `MAINTAINING.md` is the standing contract
for the site; `PLAN.md` / `WEBSITE-PLAN.md` are historical (from the
cypherlite-era redo) and should not be extended.

## Decisions

- Independent OSS project (heading toward the Linux Foundation): no Neo4j Labs branding ("labs" tag, `neo4j-labs` org/package/URL names) on the site.
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
- [x] Playground is built by this site at `/playground/` (source: `playground/`, its own package); the header and the home page link it
- [x] Cookbook is built by this site at `/cookbook/` (source: `src/content/cookbook/`); the header links it
- [ ] Cookbook link policy: `src/lib/cookbook/links.ts` `NOT_PUBLIC_YET` drops links to `github.com/relatedb/` and `relatedb.ai` from recipe prose; delete those entries at launch
- [ ] All repo links (header, footer, releases, issues, TCK doc, ADRs, extension examples) now point at `relatedb/relate`, which is private: they 404 for logged-out visitors until the repo is public, and the docs paths (`docs/tck/compliance.md`, `docs/adr/`, `docs/api/extensions/...`) must exist there
- [x] canonical / `og:url` / `sitemap.xml` / install URL now use `https://relatedb.ai/` (the preview host `r31473.relatedb.ai` is `noindex`)
- [ ] `public/releases.json` and `extensions.json` are still the cypherlite-era copies (release notes mention neo4j-labs); regenerate from upstream when the first relate release is cut
- [ ] After the first relate-named release: remove `continue-on-error` from `.github/workflows/docs-cli-check.yml` and run it once by hand (workflow_dispatch) so CLI drift turns the run red
- [ ] Release refresh (`.github/workflows/engine-release.yml`): upstream's release pipeline sends a `repository_dispatch` of type `relate-release` (payload `version`, `tag`) to this repo after it publishes `releases.json`; until then run the workflow by hand. Configure the secrets `RELATE_UPSTREAM_TOKEN` (read access to the engine repo's contents and releases; `docs-samples.yml` skips without it) and `RELEASE_PR_TOKEN` (so the refresh PR starts the required Cookbook check); the WASM package must be a release asset (`relate-relate-wasm-<version>.tgz`) or on npm. `public/extensions.json.sig` verifies only under the old `cypherlite-release` namespace, so the refresh's extensions step fails closed until upstream republishes under `relate-release`
- [ ] After the first release with published clients: switch `docs-samples.yml` and `scripts/samples/setup.sh` from building the clients out of the upstream checkout to installing the published `relate-db` and `@relate/relate` packages

## Switch hosts: github.io → relatedb.ai

Interim: GitHub Pages at `https://relatedb.github.io/relate-web/` via
`.github/workflows/deploy-pages.yml` (needs Settings → Pages → Source:
GitHub Actions; a private repo needs a paid plan, and the published site is
public). Later: `relatedb.ai` on a more scalable host (CDN / static hosting).

- [x] Pick the host: Cloudflare (Pages for the site, a Worker for `/mcp`; ADR-0012 in `docs/adr/`)
- [ ] Set up hosting, TLS, and DNS for `relatedb.ai` (+ `www` redirect)
- [ ] Replace or retire `deploy-pages.yml` with a deploy for the new host; remove the Pages site and `github-pages` environment
- [ ] Serve from the domain root: check the `/relate-web/` subpath assumption is gone (the cookbook and playground already use `/cookbook/` and `/playground/`)
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
- [ ] No remaining `cypherlite` / `neo4j-labs` / "labs" branding strings: `curl -s https://relatedb.ai/ https://relatedb.ai/llms.txt | grep -ci cypherlite` → `0`
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

**Docs (DOCS-PLAN.md §10, phase 1)**
- [ ] Every docs page builds: `npm run build` then `npm run docs:check -- --built` reports no error
- [ ] Every cell runs: `npm run docs:check` replays every page's cells on `public/wasm`, and `npm run cookbook:browser` runs them in Chrome
- [ ] `https://relatedb.ai/docs/llms.txt` resolves, and so does every URL it lists
- [ ] Every config block that opens a store carries `--read-only`, except on a page about writing
- [ ] The cold-start eval scores are recorded (see "Docs work deferred within phase 1" below)

**Repo / access**
- [ ] `relatedb/relate` repo visibility is public; README, LICENSE, releases visible logged out
- [ ] Private repos (`*-private`) remain private; no private URLs, internal ADR links, or customer data in public pages
- [ ] Release signing public key on the site matches `distribution/release-signing-key.pub`

## Rollback

- Site: revert the deploy commit on `main` and redeploy.
- Packages cannot be un-published cleanly; verify names/versions in a dry run (TestPyPI, `npm publish --dry-run`) before the real push.

## Discovery and coordination for the docs (DOCS-PLAN.md §3.9)

Owned by the docs team, mostly shipped outside this repo. Phase 1 unless
marked.

- [ ] Canonical phrase everywhere a model reads first: "relate, the embedded Cypher graph database (relatedb.ai)" in `llms.txt`'s first line, every docs description, the skill description, MCP `serverInfo`, PyPI/npm descriptions, the README H1; one line "Not the Neo4j Desktop Relate framework" on the fit page and in the skill
- [ ] Confirm publishing rights for the `@relate` npm scope (owned by the Neo4j organisation; `@relate/cli` is the Desktop framework) before announcing `@relate/relate`
- [ ] PyPI and npm metadata: descriptions, keywords (agent memory, knowledge graph, GraphRAG, Cypher, embedded), links to `/docs/llms.txt` and the skill
- [ ] Official MCP registry: `server.json` for the local server and a `remotes` entry for `https://relatedb.ai/mcp`; `mcpName` in `package.json`
- [ ] Context7, Smithery, Glama, awesome-mcp-servers listings; the skills registries (`/.well-known/agent-skills/index.json` live)
- [ ] `--help` and `relate agent-context` print the docs URLs; the error object carries a `docs` URL (upstream)
- [ ] `SECURITY.md` upstream and `/.well-known/security.txt` here; a disclosure address for `reference/security`
- [ ] Add `{"security": {"contact": "mailto:…"}}` to `src/content/docs/_data/project.json` once the disclosure address exists; `/.well-known/security.txt` is built from it (RFC 9116 requires Contact) and gains its Policy line when `reference/security` is published
- [ ] Sign `/docs/docs-artifacts.json` with the release key after the final build: `ssh-keygen -Y sign -f <release key> -n relate-release dist/docs/docs-artifacts.json`, and commit the result as `public/docs/docs-artifacts.json.sig`. It covers the exact bytes the build writes (the skill files and the docs graph's seed script), so any change to a listed artifact, a skill sync or a docs page edit included, needs a new signature; confirm the namespace (`relate-release`, as `install.sh` uses for SHA256SUMS) with upstream. `npm run docs:check` verifies it once it exists
- [ ] Decide whether `relate-docs.rl` is listed in the signed manifest: it is not byte-reproducible between builds (`npm run docs:graph` writes it to `dist/docs/`; the manifest lists it only from `public/docs/`). After launch the deploy workflows install relate with `public/install.sh` and run `RELATE_BIN=$HOME/.local/bin/relate npm run docs:graph` so the `.rl` ships
- [ ] Upstream asks for the skill bundle: a description carrying the canonical phrase (`docs:check` warns until then), no internal ADR ids in the public bundle, lowercase `relate`, and a line pointing at `https://relatedb.ai/docs/llms.txt`
- [x] Fix the root `llms.txt` TCK wording and `.cl` → `.rl` (phase 0)
- [ ] First relate-named release: move `src/content/docs/_data/engine.json` to it, confirm the `relate-<os>-<arch>` asset names and the signature namespace, and re-record the docs' CLI outputs against the release binary (they were recorded from a release-profile source build of upstream `ac441ec`, which reports 0.16.1 but includes engine changes made after the v0.16.1 release; engine.json says so with `source_build: true`, and `recorded_with` says "source build"). The release refresh (`scripts/release-refresh.sh`) drops `source_build` and re-records the CLI facts; the language samples (recorded from client builds of the same commit) are re-recorded from the published clients. Run `npm run docs:check -- --built`
- [ ] Pick the contact address `/docs/feedback.md` and `reference/security` use, and add a "Report a problem" link to the docs layout pointing at it (none exists in the repo yet; feedback.md says the address is to be published at launch)
- [ ] When ADR-0019 is accepted, add a **Later references** line to ADR-0013 ("Amended by ADR-0019": decision 3's per-file SHA-256 moved from the skills index to the signed manifest)

### Docs work deferred within phase 1

Listed in DOCS-PLAN.md §10's phase 1 platform list and not built in the platform pass; each one is still a launch requirement.

- [ ] Content negotiation and `?section=` (DOCS-PLAN.md §3.1, §5; ADR-0012): a Cloudflare Pages `_middleware` function that answers `Accept: text/markdown` on a docs URL with its twin, and `?section=<anchor>` with that section and the Terms cap per section. GitHub Pages, the interim host, cannot run it, so it lands with the move to Cloudflare Pages; until then the `.md` twins are the only markdown form
- [ ] The config blocks per host (DOCS-PLAN.md §3.4): Codex, Windsurf, Gemini CLI, Cline and OpenCode, `--read-only` in every one. Only the Claude Code line and the `.mcp.json` block exist; the rest land with `guides/agents/connect-over-mcp`, each checked against that host's own config format
- [ ] The `<Agentic>` dual view (DOCS-PLAN.md §3.4, §7.3): not built. ADR-0015 allows at most five JSX components in phase 1 and all five are taken (`<Install>`, `<Errors>`, `<ExitCodes>`, `<Flags>`, `<EnvVars>`), so it is to be a directive
- [ ] The cold-start eval (DOCS-PLAN.md §3.8): run by hand before launch (tasks × Claude Code, Codex, Cursor × the four conditions) and record the scores here

- [ ] Phase 2: pull requests to LangGraph, Vercel AI SDK, LlamaIndex, Mastra and Agno docs for the integrations; a GitHub template repo with the `AGENTS.md` snippet, the skill and a verify script

## Interim preview host (internal, unlisted)

- Host: `https://r31473.relatedb.ai/` (CNAME `r31473` → `relatedb.github.io` in GoDaddy DNS; `CNAME` file in the repo and deploy artifact).
- Hostname is obscure, **not private**: certificate-transparency logs expose it. `index.html` has `noindex, nofollow` and `robots.txt` disallows all. Remove both at launch.
- GitHub: `relatedb/relate-web` → Settings → Pages → Source: GitHub Actions, custom domain `r31473.relatedb.ai`, then Enforce HTTPS (after DNS verifies: `dig +short CNAME r31473.relatedb.ai` → `relatedb.github.io.`).
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim its subdomains on Pages.
- Retire this record and the `CNAME` file when switching hosts.

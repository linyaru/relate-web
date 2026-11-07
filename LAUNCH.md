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
- [ ] Fix the root `llms.txt` TCK wording and `.cl` → `.rl` (phase 0)
- [ ] Phase 2: pull requests to LangGraph, Vercel AI SDK, LlamaIndex, Mastra and Agno docs for the integrations; a GitHub template repo with the `AGENTS.md` snippet, the skill and a verify script

## Interim preview host (internal, unlisted)

- Host: `https://r31473.relatedb.ai/` (CNAME `r31473` → `relatedb.github.io` in GoDaddy DNS; `CNAME` file in the repo and deploy artifact).
- Hostname is obscure, **not private**: certificate-transparency logs expose it. `index.html` has `noindex, nofollow` and `robots.txt` disallows all. Remove both at launch.
- GitHub: `relatedb/relate-web` → Settings → Pages → Source: GitHub Actions, custom domain `r31473.relatedb.ai`, then Enforce HTTPS (after DNS verifies: `dig +short CNAME r31473.relatedb.ai` → `relatedb.github.io.`).
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim its subdomains on Pages.
- Retire this record and the `CNAME` file when switching hosts.

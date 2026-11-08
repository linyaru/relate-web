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
- [ ] Docs MCP Worker (`workers/docs-mcp`, ADR-0012): the `relatedb.ai` zone in the Cloudflare account that deploys Pages; the route `relatedb.ai/mcp` from `wrangler.jsonc`; confirm a Worker route fronts `/mcp` on the Pages custom domain (unverified: no account so far; if it cannot, move the site to one Worker with static assets, ADR-0012 "Later references")
- [ ] Workers Paid on that account: the upload is about 3 MB gzipped (3092 KiB at the 2026-11-07 build, over the Free plan's 3 MB limit) and the cold seed replay takes about 0.3 s of CPU (`workers/docs-mcp/README.md`)
- [ ] The rate limiting bindings `RL_IP` (20 per 10 s per IP) and `RL_COST` (120 units per 60 s per IP and tool) live on the deployed Worker; the namespace ids 4101 and 4102 in `wrangler.jsonc` are placeholders any free ids replace. `GET https://relatedb.ai/healthz` reports `"limiter": "cloudflare-rate-limiting-binding"`, not `in-isolate-fixed-window`
- [ ] `CLOUDFLARE_API_TOKEN` can deploy the Worker as well as Pages: Workers Scripts: Edit on the account and Workers Routes: Edit on the zone; `CLOUDFLARE_ACCOUNT_ID` set for `deploy-cf.yml`
- [ ] Deploy order: the site first, then the Worker; `deploy-cf.yml` does this on pushes to main and runs `node scripts/docs-mcp-check.ts` before `wrangler deploy`
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
- [ ] `curl -sI -H 'Accept: text/markdown' https://relatedb.ai/docs/get-started/install/` shows `content-type: text/markdown; charset=utf-8`, `vary: Accept`, `cache-control: private` and `x-markdown-tokens`; the same URL without the header is HTML
- [ ] `claude mcp add --transport http relate-docs https://relatedb.ai/mcp`, then a `search_docs` call answers with `relatedb.ai` URLs; an OPTIONS preflight to `/mcp` returns CORS `*`

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

- [ ] Canonical phrase everywhere a model reads first: "relate, the embedded Cypher graph database (relatedb.ai)" in `llms.txt`'s first line, every docs description, the skill description, MCP `serverInfo`, PyPI/npm descriptions, the README H1; one line "Not the Neo4j Desktop Relate framework" on the fit page and in the skill. The hosted docs MCP carries the phrase in its `initialize` `instructions` (`serverInfo` has only the name and title, `relate-docs` / `relate docs`)
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
- [ ] First relate-named release: move `src/content/docs/_data/engine.json` to it, confirm the `relate-<os>-<arch>` asset names and the signature namespace, and re-record the docs' CLI outputs against the release binary (they were recorded from a release-profile source build of upstream `ac441ec`, which reports 0.16.1 but includes engine changes made after the v0.16.1 release; engine.json says so with `source_build: true`, and `recorded_with` says "source build"). The release refresh (`scripts/release-refresh.sh`) drops `source_build` and re-records the CLI facts; the language samples (recorded from client builds of the same commit) are re-recorded from the published clients. Run `npm run docs:check -- --built`. Until engine.json names a relate-named release, the Agent prompt and the Pinned binary tab on `get-started/install` and `get-started/agent-quickstart` (`src/components/docs/install.ts`) name what v0.16.1 shipped (`releaseNames`: `cypherlite-<os>-<arch>` assets, `cypherlite-release` as signer and namespace, the `# cypherlite-release-version: ` header), but the `relate --version` output they show, and the `relate skill install` and `relate agent-context` steps after it, come from the source build, not from the cypherlite-named 0.16.1 binary, whose version line and commands were never recorded. Do not launch on 0.16.1
- [ ] Name the operator of the Mixpanel project that receives CLI usage metrics in the Recipient row of `reference/privacy-and-telemetry` (upstream `surfaces/relate-cli/src/telemetry/handle.rs`, the `MIXPANEL_TOKEN` doc comment: "the shared Neo4j Labs CLI project — the same one neo4j-cli reports into"), or record here why not
- [ ] Publish a standalone release-signing key file at a stable `relatedb.ai` URL and update `reference/security`'s key table (its row says "not published yet")
- [ ] When the Cloudflare Web Analytics and the Worker agent-path hit log ship, change their rows on `reference/privacy-and-telemetry` from "Decided, not deployed" and drop the "today" qualifiers
- [ ] When the first relate-named release ships, check `reference/security`'s manual verification block (generic `$VERSION`, `relate-<os>-<arch>`, `relate-release`) against it
- [ ] Pick the contact address `/docs/feedback.md` and `reference/security` use, and add a "Report a problem" link to the docs layout pointing at it (none exists in the repo yet; feedback.md says the address is to be published at launch)
- [ ] When ADR-0022 is accepted, add a **Later references** line to ADR-0008 ("Amended by ADR-0022": the shared example graph is the team graph, not the friends graph)
- [ ] When ADR-0019 is accepted, add a **Later references** line to ADR-0013 ("Amended by ADR-0019": decision 3's per-file SHA-256 moved from the skills index to the signed manifest)

### Docs work deferred within phase 1

Listed in DOCS-PLAN.md §10's phase 1 platform list and not built in the platform pass; each one is still a launch requirement.

- [x] Content negotiation and `?section=` (DOCS-PLAN.md §3.1, §5; ADR-0012): built as the Cloudflare Pages `_middleware` function `functions/docs/_middleware.ts`. `Accept: text/markdown` on a docs URL answers with its twin; `?section=<anchor>` answers with that section and the Terms cap per section. Checked locally on workerd by `npm run docs:negotiation-check`. GitHub Pages, the interim host, cannot run it: until DNS moves to Cloudflare Pages it is live nowhere, and the `.md` twins are the only markdown form readers get
- [x] The hosted docs MCP server (DOCS-PLAN.md §3.7, §3.8; ADR-0012): built as the Worker in `workers/docs-mcp/` and documented on `reference/server/docs-mcp`; checked locally on workerd by `npm run docs:mcp-check`. Not deployed: the account items are under "Switch hosts" above
- [ ] When the docs MCP Worker is live: drop the launch-day-target sentences on `reference/server/docs-mcp`, `guides/agents/connect-over-mcp` and `guides/agents/agent-safety`, the paragraph on the Agent install tab (`src/components/docs/install.ts`), and the "Not deployed" rows and sentences on `reference/security` and `reference/privacy-and-telemetry`
- [ ] Publish on `reference/server/docs-mcp#what-is-logged` and `reference/privacy-and-telemetry` how long Workers Logs (`observability.enabled`, head sampling 1, in `wrangler.jsonc`) keeps the Worker's log lines, and what Cloudflare itself records about each request and for how long, once the account's settings are known. The Pages Functions' log lines (`functions/_middleware.ts`, `functions/docs/_middleware.ts`) reach anyone only if Workers Logs or Logpush is turned on for the Pages project. The Worker's invocation logs are off (`observability.logs.invocation_logs: false`)
- [ ] Publish an abuse contact for the hosted docs MCP on `reference/server/docs-mcp#abuse-contact` and in the Worker's `GET /mcp` text (`workers/docs-mcp/src/index.ts`, "Abuse contact: none is published yet.")
- [ ] Re-record the `initialize` response and the 429 body on `reference/server/docs-mcp` from the deployed endpoint (both were recorded from `wrangler dev` on 2026-11-07), and repeat the cold-start measurement against the deployed Worker (local medians on 2026-11-07: first `tools/list` 22 ms, first `search_docs` about 360 ms, warm `search_docs` about 21 ms, engine init about 320 ms; `node scripts/docs-mcp-check.ts --coldstart 5` is the local form, `workers/docs-mcp/README.md` has the method)
- [ ] Connect each hosted-endpoint entry on `guides/agents/connect-over-mcp` to the live server once (Claude Code, Claude Desktop custom connector, Cursor, Codex, Windsurf `serverUrl`, Gemini CLI `httpUrl`, Cline `streamableHttp`, OpenCode `remote`). They follow each host's docs as of 2026-11-07 and were never tried against a live endpoint. Windsurf's key comes from its plugin docs, now served under docs.devin.ai
- [ ] Serve `/docs/relate-docs.rl` and `/docs/relate-docs.rl.sha256`: the local-equivalent block on `reference/server/docs-mcp` downloads them (see the `relate-docs.rl` manifest item above)
- [ ] `reference/server/docs-mcp` names relate 0.16.1 in prose and in its two recorded examples; nothing regenerates them, so the engine bump to the first relate-named release updates them by hand
- [ ] Upstream (WASM): a way to freeze a seeded in-memory handle read-only (or to open a snapshot read-only), and a statement deadline. Until then the docs MCP replays the seed into a writable handle and runs only one canned statement (ADR-0023, `workers/docs-mcp/README.md`), and `query_docs_graph` stays gated
- [x] The config blocks per host (DOCS-PLAN.md §3.4): Codex, Windsurf, Gemini CLI, Cline and OpenCode, `--read-only` in every one. Landed in `guides/agents/connect-over-mcp` (Claude Code, Claude Desktop, Cursor, Codex, Windsurf, Gemini CLI, Cline, OpenCode), checked against each host's docs on 2026-11-07; re-check quarterly (DOCS-PLAN.md §6 "reverified"). Windsurf's English docs now redirect to Devin Desktop's; the block follows the still-served Windsurf docs (`~/.codeium/windsurf/mcp_config.json`)
- [ ] The `<Agentic>` dual view (DOCS-PLAN.md §3.4, §7.3): not built. ADR-0015 allows at most five JSX components in phase 1 and all five are taken (`<Install>`, `<Errors>`, `<ExitCodes>`, `<Flags>`, `<EnvVars>`), so it is to be a directive
- [ ] The cold-start eval (DOCS-PLAN.md §3.8): run by hand before launch (tasks × Claude Code, Codex, Cursor × the four conditions) and record the scores here

- [ ] Re-check the third-party SDK names on `guides/integrations/*` against current releases (each page names the version it was checked against, as of 2026-11-07, and pins no install). Claude Agent SDK: `claude-agent-sdk` 0.2.179 (CI-run by the page's `options` sample) and `@anthropic-ai/claude-agent-sdk` 0.3.319 (Node >=18.14.0): `mcp_servers`/`mcpServers`, `tools`, `allowed_tools`/`allowedTools`, `permission_mode` `"dontAsk"`, `strict_mcp_config`/`strictMcpConfig`, `ResultMessage`. LangGraph: `langgraph` 1.2.20, `langchain-core` 1.7.6. Vercel AI SDK: `ai` 7.0.165 (`tool`, `inputSchema`, `generateText`, `isStepCount`; Node >=22), `zod` 4.6.7, `@ai-sdk/anthropic` 4.0.99 (Node >=22). No model call was run for these pages (no credential)
- [x] When `reference/server/docs-mcp` is written (phase 1 part C), restore on `guides/agents/agent-safety` the sentence after the permission matrix ("The [hosted docs MCP server](/docs/reference/server/docs-mcp) page describes that server's limits."), drop "Planned: " from the matrix cell, and change "is a planned server for this documentation" back to "serves this documentation". Done in phase 1 part C
- [ ] Phase 2: pull requests to LangGraph, Vercel AI SDK, LlamaIndex, Mastra and Agno docs for the integrations; a GitHub template repo with the `AGENTS.md` snippet, the skill and a verify script

## Interim preview host (internal, unlisted)

- Host: `https://r31473.relatedb.ai/` (CNAME `r31473` → `relatedb.github.io` in GoDaddy DNS; `CNAME` file in the repo and deploy artifact).
- Hostname is obscure, **not private**: certificate-transparency logs expose it. `index.html` has `noindex, nofollow` and `robots.txt` disallows all. Remove both at launch.
- GitHub: `relatedb/relate-web` → Settings → Pages → Source: GitHub Actions, custom domain `r31473.relatedb.ai`, then Enforce HTTPS (after DNS verifies: `dig +short CNAME r31473.relatedb.ai` → `relatedb.github.io.`).
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim its subdomains on Pages.
- Retire this record and the `CNAME` file when switching hosts.

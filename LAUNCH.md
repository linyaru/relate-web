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
- [ ] Release discovery (ADR-0546, upstream): upstream's pipelines attach `install.sh` + `releases.json` (core release) and the signed `extensions.json` pair (extension release) as release assets, then send a `repository_dispatch` `relate-release` (`{kind: cli|extension, tag}`) here. Both deploy workflows run on it and `scripts/fetch-discovery.sh` pulls the files (newest release wins; signature verified; fails closed) before the build, so **a release is never held up by review** (runbook: `runbooks/release-discovery.md`). The checked-in `public/install.sh`, `releases.json`, `extensions.json(.sig)` are seed copies for local work and pre-release. Secrets are shared across the `relatedb` org: make `RELATE_UPSTREAM_TOKEN` (read on `relate`) visible to this repo and `RELATE_WEB_DISPATCH_TOKEN` (`contents:write` on this repo) visible to `relate`. Until `RELATE_UPSTREAM_TOKEN` is set the fetch is skipped with a notice; set the repo variable `RELATE_DISCOVERY_REQUIRED=true` at launch so a missing token fails the deploy. Not yet tried against real assets: dry-run on the first release (`gh workflow run` the deploy, or `npm run discovery:fetch` with a token)
- [ ] Release docs refresh (`.github/workflows/engine-release.yml`, a `cli` poke only; a reviewed pull request, it does not gate the discovery files): until the pokes are live run it by hand. Configure `RELATE_UPSTREAM_TOKEN` (also read by `docs-samples.yml`) and `RELEASE_PR_TOKEN` (so the refresh PR starts the required Cookbook check); the WASM package must be a release asset (`relate-relate-wasm-<version>.tgz`) or on npm. `public/extensions.json.sig` verifies only under the old `cypherlite-release` namespace until upstream republishes under `relate-release`, so verification fails closed until then
- [ ] **Blocker:** the served relate skill (`public/skills/relate/references/vector.md`, also in `relate skill install` and the docs MCP resources) calls the vector index "an HNSW (Hierarchical Navigable Small World) approximate" index, while every docs page and both task skills say `SEARCH` is an exact top-k scan. Land the upstream fix to `surfaces/relate-cli/src/skill/bundle/references/vector.md`, run `npm run skill:sync`, and review the diff before the site publishes
- [ ] One source build for every fact: the CLI facts come from upstream `ac441ec`; of the client samples, Python, Node.js, C, Java and Swift were built from `6a0c391`, a sibling commit, Rust from the `ac441ec` export, and Go from `ac441ec` client source linked against a `librelate_ffi` built from `6a0c391` (`src/content/docs/_data/samples.json`, ADR-0052, which each sample manifest quotes). The Java, Go and Swift API pages say so. Rebuild the sample toolchains from the build `_data/engine.json` names (or move `engine.json` to one build), re-record, rewrite `_data/samples.json`, then drop those sentences. Have `scripts/samples/setup.sh` record the commit it built each client from, so `_data/samples.json` stops being written by hand
- [ ] The docs samples environment and the CLI recordings are pinned to upstream `ac441ec` (relate 0.16.1): the samples env is built from an export of that commit, and `_data/cli.json` and `errors.json` were replayed with a binary built from it (the upstream checkout has since moved on, so a rebuild from its HEAD no longer matches). At launch, re-run `bash scripts/samples/setup.sh` against the release checkout and `RELATE_BIN=<release binary> DO_NOT_TRACK=1 npm run docs:cli-check -- --record` against the release binary, and review both diffs
- [ ] After the first release with published clients: switch `docs-samples.yml` and `scripts/samples/setup.sh` from building the clients out of the upstream checkout to installing the published `relate-db` and `@relate/relate` packages

## Switch hosts: github.io → relatedb.ai

Interim: GitHub Pages at `https://relatedb.github.io/relate-web/` via
`.github/workflows/deploy-pages.yml` (needs Settings → Pages → Source:
GitHub Actions; a private repo needs a paid plan, and the published site is
public). Later: `relatedb.ai` on a more scalable host (CDN / static hosting).

- [x] Pick the host: Cloudflare (Pages for the site, a Worker for `/mcp`; ADR-0012 in `docs/adr/`)
- [ ] Set up hosting, TLS, and DNS for `relatedb.ai` (+ `www` redirect)
- [ ] Docs MCP Worker (`workers/docs-mcp`, ADR-0012): the `relatedb.ai` zone in the Cloudflare account that deploys Pages; the route `relatedb.ai/mcp` from `wrangler.jsonc`; confirm a Worker route fronts `/mcp` on the Pages custom domain (unverified: no account so far; if it cannot, move the site to one Worker with static assets, ADR-0012 "Later references")
- [ ] Workers Paid on that account: the phase 2 upload was about 3.7 MB gzipped with the phase 1 pages and is 5,857 KiB gzipped (22,321 KiB raw) with the 140 phase 2 pages (`npm run dry-run --prefix workers/docs-mcp`, 2026-11-08; `workers/docs-mcp/README.md` "Sizes" has the earlier build's number), over the Free plan's 3 MB limit and under Paid's 10 MB, and the cold seed replay takes about 0.35 s of CPU, plus about 0.19 s for the section vectors on the first hybrid search (`workers/docs-mcp/README.md`)
- [ ] Workers AI on that account for the Worker's `ai` binding (`wrangler.jsonc`, `remote: true`): `search_docs` embeds each query with `@cf/baai/bge-small-en-v1.5` (cls pooling) and is full-text, saying so in `version.retrieval`, until the binding answers. Billed per call; confirm the price and the account's limits, and what Workers AI records about a request (the query text reaches it), then publish that on `reference/server/docs-mcp#threat-model` and `reference/privacy-and-telemetry`. After the deploy, a `search_docs` call answers `"retrieval": "hybrid"` and `GET /healthz` reports `"ai_binding": "bound"` and, after that search, `vectors_loaded` 550 (or the build's count)
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
- [ ] Re-record the `initialize` response and the 429 body on `reference/server/docs-mcp` from the deployed endpoint (both were recorded from `wrangler dev --local` on 2026-11-08), and repeat the cold-start measurement against the deployed Worker, including a first hybrid search, which loads the section vectors (`node scripts/docs-mcp-check.ts --coldstart 5` is the local form, full-text only; `workers/docs-mcp/README.md` has the method and the local medians)
- [ ] Connect each hosted-endpoint entry on `guides/agents/connect-over-mcp` to the live server once (Claude Code, Claude Desktop custom connector, Cursor, Codex, Windsurf `serverUrl`, Gemini CLI `httpUrl`, Cline `streamableHttp`, OpenCode `remote`). They follow each host's docs as of 2026-11-07 and were never tried against a live endpoint. Windsurf's key comes from its plugin docs, now served under docs.devin.ai
- [ ] Serve `/docs/relate-docs.rl` and `/docs/relate-docs.rl.sha256`: the local-equivalent block on `reference/server/docs-mcp` downloads them (see the `relate-docs.rl` manifest item above)
- [ ] `reference/server/docs-mcp` names relate 0.16.1 in prose and in its two recorded examples; nothing regenerates them, so the engine bump to the first relate-named release updates them by hand
- [ ] Upstream (WASM): a way to freeze a seeded in-memory handle read-only (or to open a snapshot read-only), and a statement deadline. Until then the docs MCP replays the seed into a writable handle and runs only canned statements on it (ADR-0023, `workers/docs-mcp/README.md`; `validate_cypher` plans callers' statements on a fresh instance per call, never that one), and `query_docs_graph` stays gated
- [x] The config blocks per host (DOCS-PLAN.md §3.4): Codex, Windsurf, Gemini CLI, Cline and OpenCode, `--read-only` in every one. Landed in `guides/agents/connect-over-mcp` (Claude Code, Claude Desktop, Cursor, Codex, Windsurf, Gemini CLI, Cline, OpenCode), checked against each host's docs on 2026-11-07; re-check quarterly (DOCS-PLAN.md §6 "reverified"). Windsurf's English docs now redirect to Devin Desktop's; the block follows the still-served Windsurf docs (`~/.codeium/windsurf/mcp_config.json`)
- [x] The `<Agentic>` dual view: built in phase 2 as the `::::agentic` directive (README Constructs, ADR-0031); no page uses it yet.
- [ ] The cold-start eval (DOCS-PLAN.md §3.8): run by hand before launch (tasks × Claude Code, Codex, Cursor × the four conditions) and record the scores here. The harness is built (`npm run docs:evals`, ADR-0029); Cursor has no wrapper yet

- [ ] Re-check the third-party SDK names on `guides/integrations/*` against current releases (each page names the version it was checked against, as of 2026-11-07, and pins no install). Claude Agent SDK: `claude-agent-sdk` 0.2.179 (CI-run by the page's `options` sample) and `@anthropic-ai/claude-agent-sdk` 0.3.319 (Node >=18.14.0): `mcp_servers`/`mcpServers`, `tools`, `allowed_tools`/`allowedTools`, `permission_mode` `"dontAsk"`, `strict_mcp_config`/`strictMcpConfig`, `ResultMessage`. LangGraph: `langgraph` 1.2.20, `langchain-core` 1.7.6. Vercel AI SDK: `ai` 7.0.165 (`tool`, `inputSchema`, `generateText`, `isStepCount`; Node >=22), `zod` 4.6.7, `@ai-sdk/anthropic` 4.0.99 (Node >=22). No model call was run for these pages (no credential)
- [x] When `reference/server/docs-mcp` is written (phase 1 part C), restore on `guides/agents/agent-safety` the sentence after the permission matrix ("The [hosted docs MCP server](/docs/reference/server/docs-mcp) page describes that server's limits."), drop "Planned: " from the matrix cell, and change "is a planned server for this documentation" back to "serves this documentation". Done in phase 1 part C
- [ ] Phase 2 integrations, checked 2026-11-08 against what the sample environment installed (no model call; no credential): `pydantic-ai` 2.66.0, `openai-agents` 0.24.0, `llama-index-core` 0.14.25, `langchain` 1.4.9, `crewai` 1.15.37 (its own venv), `@mastra/core` 1.82.0. Re-check with the others above
- [ ] Phase 2: pull requests to LangGraph, Vercel AI SDK, LlamaIndex, Mastra and Agno docs for the integrations; a GitHub template repo with the `AGENTS.md` snippet, the skill and a verify script

### Docs work in phase 2 (interactive elements)

- [x] The phase 2 interactive elements of DOCS-PLAN.md §7.3 are built and placed (ADR-0035 to ADR-0042; §10 "As built (phase 2, part C)"): graph view extras, the timing bar, the plan viewer, the agent-mode terminal, the live schema, the vector and geospatial explorers, the MCP tryout, agent trace playback and the docs graph. `npm run cookbook:browser` runs each element's cases
- [ ] Engine bump: the element recordings name relate 0.16.1. Re-record the terminal's fixtures (`RELATE_BIN=<relate> node src/lib/docs/elements/_terminal-record.ts`; the facts file follows `cli.json` and `errors.json`), then `node scripts/docs.ts --record` (every element form is stamped with its page's recordings) and review the diff; the MCP tryout quotes the errors.json `--read-only` run with its version, and the terminal labels every exit code with the facts' version
- [ ] `reference/docs-graph` lists `https://relatedb.ai/docs/relate-docs.rl` and its `.sha256` as launch-day targets; serve them (the manifest item above) or drop the row
- [ ] The docs graph view fetches `/docs/graph-view.json` and the plan viewer, terminal and explorers load the engine from `/wasm/`: after the host move, open `reference/docs-graph`, `concepts/agent-native` and `guides/cypher/geospatial` on `relatedb.ai` and check each element goes live with no console error
- [ ] Search ranking, a fix to make: for the recipe question "stop the model from deleting nodes", `search_docs` ranks `guides/agents/agent-safety#verify` third since phase 2 part C (the new `reference/docs-graph#node-labels` leads the vector lane by 0.005 cosine; `model-agent-memory#the-model` leads full-text). `workers/docs-mcp/src/hybrid.test.ts` pins it within three; put it back first and tighten the pin
- [ ] Search ranking, a pin to tighten: for "give Cursor access to my graph without letting it write", `workers/docs-mcp/src/hybrid.test.ts` asserts `guides/agents/connect-over-mcp#cursor` first in the fused pipeline, and the vector lane alone only within its top three; tighten the vector-lane pin once the ranking work lands
- [ ] When ADR-0042 is accepted, add a **Later references** line to ADR-0010 naming it (the docs graph's network view is the one graph module's second entry point, `renderNetwork`)

### Docs work in phase 2 (platform)

- [ ] Host deeplinks: the Cursor and VS Code link forms in `src/lib/docs/deeplink.ts` follow each host documentation page as of 2026-11-07 (Cursor install-links page; VS Code extension guide, page dated 2026-11-04); neither link has been opened in the real app. Re-check quarterly
- [ ] `_data/surfaces.json`: re-check every cell at each engine bump. Recorded with the 0.16.1 source build, the shipped WASM and the Python and Node.js clients on 2026-11-07. The C, Java, Go and Swift vector, full-text and LOAD CSV cells, and the Bolt and MCP vector and LOAD CSV cells, are inferred from the shared library or the shared served store, not run on those surfaces. On 2026-11-08 the result-metadata cells of Node.js, C, Java, Go and Swift were corrected to partial from the clients' own types and sample runs (the Java, Go and Swift clients built from upstream 6a0c391), and the served in-memory cells name a listener flag
- [ ] Confirm the license of the docs text (cookbook recipe query-the-relate-docs front matter says Apache-2.0, like the other site-authored recipe datasets; relate-web has no LICENSE file) and cite the source, or change the field
- [ ] Workers AI `@cf/baai/bge-small-en-v1.5` and the committed transformers.js vectors (`_data/embeddings.json`) are asserted to agree because they share the BAAI weights; compare one query's vectors on the deployed Worker before hybrid `search_docs` ships (ADR-0028)
- [ ] Structural check "a term used on three or more pages and defined on none": needs a candidate-term source outside the glossary (none exists; no bold or otherwise marked term occurs on three pages). Owner to be assigned: the glossary check (`checks/glossary.ts`) or a graph query
- [ ] First live docs eval (`docs-evals.yml` by hand, Claude Code wrapper). Confirm that the skill condition's `system/init` event lists the relate skill, that a `-p` run starts with an empty HOME and ANTHROPIC_API_KEY, and that the Bash `tool_use`/`tool_result` transcript is read (`scripts/evals/agents/claude-code.sh`, `scripts/evals/harness.ts`)
- [ ] Before reading Codex scores: confirm that `codex exec --json` `item.completed` command_execution items carry `exit_code` and `aggregated_output` (on no vendor page read so far), and wire the four conditions for Codex
- [ ] To run the eval on every relate release (DOCS-PLAN.md §10): set the repository variables `DOCS_EVALS_AGENT_PACKAGE` (pinned npm spec) and `DOCS_EVALS_HARNESS`, plus ANTHROPIC_API_KEY or CODEX_API_KEY. Until upstream sends the `relate-release` dispatch, no run starts by itself
- [ ] First `npm run docs:usage` against the deployed Worker: confirm that Workers Logs extracts the JSON log line's fields as keys (evt, path, ua, status, tool, zero_results, tool_error), then commit `_data/usage.json`
- [ ] List the five task skills (`relate-agent-memory`, `relate-graphrag`, `relate-schema-design`, `relate-query-tuning`, `relate-migrate-from-vector-search`) wherever the CLI bundle is listed in the skills registries, once `/.well-known/agent-skills/index.json` is live
- [ ] `guides/agents/install-the-skill` names skills CLI 1.7.6 (read and run 2026-11-07); re-check the `--skill` selection and the digest check against the current release before launch
- [ ] Run `docs-samples.yml` once by hand when `RELATE_UPSTREAM_TOKEN` exists: the Linux paths of the C, Go and Java runners and the macos-15 runner's Swift toolchain are untested. The upstream Java client's pom reads 0.1.0 while the engine is 0.16.1; after launch, check that the published packages' versions equal the engine's
- [x] Capability catalog: each phase 2 guide has joined its capability's `guides`, and `neo4j-subgraph-mirror` cites the recorded `--dry-run` push plan (`guides/neo4j/push-to-neo4j#step-3`; a real pull or push still needs a Neo4j or Aura server no check here has). Done in phase 2 part B
- [ ] Capability catalog: several verify runs prove less than the whole capability (`concepts/problems-relate-solves`); re-point them at a `bash verify` step on a guide where one now proves it directly
- [ ] When ADR-0026 to ADR-0034 are accepted, change their status in `docs/adr/README.md`

### Docs work in phase 2 (pages)

Written in phase 2 part B (DOCS-PLAN.md §10); what a launch, a release or upstream still has to settle:

- [ ] Client install lines are launch-day targets, never run against a registry: `go get github.com/relatedb/relate/clients/go` (and its cgo flags outside an upstream checkout), the Java coordinate (written `<release>` because the client pom reads 0.1.0), the SwiftPM URL, and the `@relate/relate-wasm` package layout (`relate.js`, `relate_bg.wasm`, `trap.js`, `snippets/` at its root, per upstream's `package.json.template`). Check each against the published package, and replace `<release>` with the coordinate's version
- [ ] The release `librelate_ffi` dylib's install name: `guides/embed/go` and `reference/api/go` say rpath helps only on Linux because a cargo-built dylib carries an absolute install name; re-check against the first release archive (`relate-ffi-<target>.tar.gz`, whose contents come from `clients/go/README.md`)
- [ ] `guides/serve/docker`: the image was read from upstream's Dockerfile, Makefile and entrypoint, never built or run here; build it once and replay the page
- [ ] `guides/serve/auth-and-tls` names no TLS proxy configuration because none was installed to verify one; add one verified configuration
- [ ] `guides/serve/bolt` and `reference/server/bolt`: the Neo4j driver claims (Java and Python drivers need `--bolt-identity Neo4j/…`; Go does not) come from upstream's compatibility record; only Python drivers 6.0.3 to 6.4.0 were run, and Neo4j Browser only with `--auth none`
- [ ] Browser pages say only Chrome 157 was checked; run the OPFS steps in Firefox and Safari
- [ ] The Java, Go and Swift reference pages name source build 6a0c391, where their clients were built, not ac441ec; the first release re-records all seven languages from one build
- [x] Hybrid `search_docs` ranking: for "give Cursor access to my graph without letting it write" phase 2 part B left `guides/agents/connect-over-mcp#cursor` fifth, behind headings that share one query word. The full-text re-rank (`workers/docs-mcp/src/rank.ts`) now also weighs how much of a heading is query words, which ranks it first again and ranks "Exit codes" on `reference/cli/exit-codes-and-errors` above the per-command "Errors and exit codes" sections; `workers/docs-mcp/src/hybrid.test.ts` asserts first place again
- [ ] Upstream asks found while writing: the CLI skill bundle's `references/vector.md` still calls the vector index approximate HNSW (the search is an exact scan, upstream ADR-0256); C ABI and Node.js open failures report a generic `internal error` where Python reports `storage locked: <path>`; the Go client's `Close` is not idempotent (a call after it is a use-after-free); a write's own property keys raise 01N52 on a fresh store over MCP; upstream `docs/api/http` says "no managed transactions" though the binary serves `/tx`; `docs/api/mcp/spec.md` says any POST without `application/json` is 415 though `application/xml` passes

### Docs work in phase 3

- [ ] `guides/migrate/from-kuzu` quotes Kuzu 0.11.3 (run in a scratch environment on 2026-11-09; CI does not run Kuzu): re-check the repository's archived status and last release, the `COPY ... TO` JSON export and the quoted Kuzu error messages before launch
- [ ] `guides/migrate/from-sqlite`: its `sqlite3` output fences were recorded with sqlite3 3.51.0; the `ubuntu-latest` runner ships 3.45.1. Confirm on the first `docs-cli-check.yml` run (the page uses `-header -list`, whose output did not change between versions; `-table` did). `docs:cli-check` now needs `sqlite3` on PATH
- [ ] Scale demo (ADR-0047): NVL 1.2.2's WebGL renderer places at most 65,536 nodes (one 256×256 position texture), so at 100,000 nodes the engine builds, counts and walks every node and the view draws the inner rings that fit, saying so. Re-check when NVL is bumped; WebGL was exercised only on SwiftShader in headless Chrome, so open `concepts/architecture` on a real GPU in Chrome, Safari and Firefox after the host move
- [ ] `cookbook:browser` launches Chrome with `--enable-unsafe-swiftshader` (ADR-0047) so every NVL view has WebGL in CI as in a real browser; the playground's double-click expansion case failed once under heavy machine load and passed on rerun. Watch it in CI
- [ ] Sample manifests (ADR-0052): after any full `npm run docs:samples` replay, rewrite `src/content/docs/_data/samples.json` (commits, toolchains, date, platform); `docs:check` holds its pins to `scripts/samples/setup.sh`
- [ ] Twin data blocks (ADR-0048): the docs MCP Worker has no resource for `/docs/<page>/data/<name>.json`; add one if MCP-only agents need the data a twin links. The "ten `get_page` calls" measurement in `workers/docs-mcp/README.md` predates the stubs; re-measure
- [ ] In-browser embeddings (ADR-0049): the docs recipe's "Download the model (82 MB)" fetches bge-small-en-v1.5 from huggingface.co (redirected to Hugging Face's CDN) at a pinned revision; state on `reference/privacy-and-telemetry` what Hugging Face logs about those requests and for how long, once known. `cookbook:browser` now downloads about 67 MB from the hub on each full run, so a hub outage fails it; decide whether CI caches the files. No test exercises the refusal of a file whose SHA-256 does not match its pin
- [ ] Integration traces: only `guides/integrations/claude-agent-sdk` reaches relate over MCP; the LangGraph and Vercel AI SDK traces replay their in-process statements as MCP calls and say so. Re-check when those pages' samples change
- [ ] When ADR-0044 to ADR-0052 are accepted, add Later references lines where they amend earlier records (ADR-0010 for ADR-0047's `renderScale` and ADR-0050's network colours; ADR-0035 for recipes carrying elements, ADR-0045, and `page.scratch()`, ADR-0047; ADR-0039 for the search reference placement and ADR-0049; ADR-0027 already names ADR-0052), and change their status in `docs/adr/README.md`

## Interim preview host (internal, unlisted)

- Host: `https://r31473.relatedb.ai/` (CNAME `r31473` → `relatedb.github.io` in GoDaddy DNS; `CNAME` file in the repo and deploy artifact).
- Hostname is obscure, **not private**: certificate-transparency logs expose it. `index.html` has `noindex, nofollow` and `robots.txt` disallows all. Remove both at launch.
- GitHub: `relatedb/relate-web` → Settings → Pages → Source: GitHub Actions, custom domain `r31473.relatedb.ai`, then Enforce HTTPS (after DNS verifies: `dig +short CNAME r31473.relatedb.ai` → `relatedb.github.io.`).
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim its subdomains on Pages.
- Retire this record and the `CNAME` file when switching hosts.

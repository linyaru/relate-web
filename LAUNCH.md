# LAUNCH — relatedb.ai pre-launch notes

Status: **stealth**. relate v0.1.0, v0.1.1 and v0.1.2 are published as GitHub
releases of the upstream repository, which is not public yet, and the docs track
v0.1.2; no package is on a registry and no repo is public. Everything on this
site that points at a package, a release URL, or another URL is written for the
launch-day names and will 404 for a logged-out visitor until then.

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
- [ ] Regenerate or replace `releases.json`, `extensions.json` (+ `.sig`), `install.sh` from upstream: `install.sh` and `releases.json` now come from relate v0.1.2's release assets (`scripts/fetch-discovery.sh`); `extensions.json` (+ `.sig`) are still the cypherlite-era copies, since no relate extension release carries them yet
- [ ] Update `sitemap.xml`, `robots.txt` (currently stealth-appropriate? decide), `update-website.yml`
- [ ] Set up Pages / hosting and DNS for `relatedb.ai`; deploy workflow (old one lived on cypherlite `main`)
- [x] Add `noindex` / robots block while stealth; remove at launch
- [x] Playground is built by this site at `/playground/` (source: `playground/`, its own package); the header and the home page link it
- [x] Cookbook is built by this site at `/cookbook/` (source: `src/content/cookbook/`); the header links it
- [ ] Cookbook link policy: `src/lib/cookbook/links.ts` `NOT_PUBLIC_YET` drops links to `github.com/relatedb/` and `relatedb.ai` from recipe prose; delete those entries at launch
- [ ] All repo links (header, footer, releases, issues, TCK doc, ADRs, extension examples) now point at `relatedb/relate`, which is private: they 404 for logged-out visitors until the repo is public, and the docs paths (`docs/tck/compliance.md`, `docs/adr/`, `docs/api/extensions/...`) must exist there
- [x] canonical / `og:url` / `sitemap.xml` / install URL now use `https://relatedb.ai/` (the site is indexable)
- [ ] `public/extensions.json` (+ `.sig`) is still the cypherlite-era copy (its tags are `cypherlite-extensions-…`); regenerate it from upstream when the first relate extension release is cut. `releases.json` is relate's (v0.1.0 to v0.1.2)
- [x] After the first relate-named release: `continue-on-error` is gone from `.github/workflows/docs-cli-check.yml`, which now installs the latest release with `RELATE_UPSTREAM_TOKEN` (the private repository's release API answered 404 to the job's own token). Run it once by hand (workflow_dispatch) after this lands on `main`
- [ ] Release discovery (ADR-0546, upstream): upstream's pipelines attach `install.sh` + `releases.json` (core release) and the signed `extensions.json` pair (extension release) as release assets, then send a `repository_dispatch` `relate-release` (`{kind: cli|extension, tag}`) here. Both deploy workflows run on it and `scripts/fetch-discovery.sh` pulls the files (newest release wins; signature verified; fails closed) before the build, so **a release is never held up by review** (runbook: `runbooks/release-discovery.md`). The checked-in `public/install.sh`, `releases.json`, `extensions.json(.sig)` are seed copies for local work and pre-release. Secrets are shared across the `relatedb` org: make `RELATE_UPSTREAM_TOKEN` (read on `relate`) visible to this repo and `RELATE_WEB_DISPATCH_TOKEN` (`contents:write` on this repo) visible to `relate`. Until `RELATE_UPSTREAM_TOKEN` is set the fetch is skipped with a notice; set the repo variable `RELATE_DISCOVERY_REQUIRED=true` at launch so a missing token fails the deploy. Not yet tried against real assets: dry-run on the first release (`gh workflow run` the deploy, or `npm run discovery:fetch` with a token)
- [ ] Release docs refresh (`.github/workflows/engine-release.yml`, a `cli` poke only; a reviewed pull request, it does not gate the discovery files): until the pokes are live run it by hand. Configure `RELATE_UPSTREAM_TOKEN` (also read by `docs-samples.yml`) and `RELEASE_PR_TOKEN` (so the refresh PR starts the required Cookbook check); the WASM package must be a release asset (`relate-relate-wasm-<version>.tgz`) or on npm. `public/extensions.json.sig` verifies only under the old `cypherlite-release` namespace until upstream republishes under `relate-release`, so verification fails closed until then
- [ ] **Blocker:** the served relate skill (`public/skills/relate/references/vector.md`, also in `relate skill install`) calls the vector index "an HNSW (Hierarchical Navigable Small World) approximate" index, while every docs page and both task skills say `SEARCH` is an exact top-k scan. Land the upstream fix to `surfaces/relate-cli/src/skill/bundle/references/vector.md`, run `npm run skill:sync`, and review the diff before the site publishes
- [x] One build for every fact: the CLI facts, the WASM build and all seven languages' sample clients come from relate v0.1.2 (upstream `f0c09d2`): the CLI recordings were replayed against the release binary installed by `install.sh`, and every client was built by `scripts/samples/setup.sh` from a clone at the tag (`_data/samples.json`). Still open: have `setup.sh` record the commit it built each client from, so `_data/samples.json` need not be written by hand
- [x] The docs samples environment and the CLI recordings are pinned to the v0.1.2 release, not a source build: re-pin at each release with `scripts/release-refresh.sh` (AGENTS.md §4)
- [ ] After the first release with published clients: switch `docs-samples.yml` and `scripts/samples/setup.sh` from building the clients out of the upstream checkout to installing the published `relate-db` and `@relate/relate` packages

## Feedback (giscus)

Page feedback for corrections lives in GitHub Discussions on `relatedb/relate-web`, shown by `src/components/Feedback.astro` on the site footer on every page. Until the ids are set it shows a plain "Open an issue" link.

- [x] Discussions enabled on `relatedb/relate-web`, with an open `Website` category: anyone signed in to GitHub can comment and start a page's thread.
- [ ] Install the giscus app (https://github.com/apps/giscus) on `relatedb/relate-web`.
- [x] Repo and category ids are in `src/lib/giscus.ts` (from the GitHub API).
- [ ] Check a docs page: the button loads the thread, the theme follows the Day/Night switch, and the discussion is titled with the page path.

## Switch hosts: github.io → relatedb.ai

Interim: GitHub Pages at `https://relatedb.github.io/relate-web/` via
`.github/workflows/deploy-pages.yml` (needs Settings → Pages → Source:
GitHub Actions; a private repo needs a paid plan, and the published site is
public). Later: `relatedb.ai` on a more scalable host (CDN / static hosting).

- [x] Pick the host: Cloudflare Pages (ADR-0012 in `docs/adr/`; the hosted docs MCP Worker it also chose is withdrawn, ADR-0057)
- [ ] The hosted docs MCP server is withdrawn until it is ready to ship (ADR-0057). The local tag `docs-mcp-shelved` marks the last commit with `workers/docs-mcp/`, its checks, the usage page and its docs pages; bringing it back is a new ADR
- [ ] Set up hosting, TLS, and DNS for `relatedb.ai` (+ `www` redirect)
- [ ] `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID` set for `deploy-cf.yml`
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
- [ ] No console errors; the playground (`/playground/`) reaches "ready" and runs a sample query
- [ ] No remaining `cypherlite` / `neo4j-labs` / "labs" branding strings: `curl -s https://relatedb.ai/ https://relatedb.ai/llms.txt | grep -ci cypherlite` → `0`
- [ ] Every link on the page resolves (run `lychee` against the live URL); no 404s to repos/releases/packages
- [ ] `robots.txt` and `sitemap.xml` allow indexing; `noindex` removed; `llms.txt` served as text
- [ ] Light/dark theme, mobile width, cli/agentic toggle, copy buttons all work
- [ ] Version shown on the page matches the latest release tag
- [ ] Home "Zero to querying" shows no TCK pass count: the design's "3,893 tests passed" figure is not published by any engine document (upstream `docs/tck/compliance.md`: the count retired 2026-11-05 with the move to the spec harness). Add a number only when the harness publishes one, with its link
- [ ] The hero banner's Join link (`https://relate.devpost.com`) resolves; the banner runs one month, then remove it from `src/components/Hero.astro`

**Install names** (the table under "Target names" is the source; the site must agree with it)
- [ ] Before the first publish, confirm each name is free or ours: `pip index versions relate-db`, `npm view @relate/relate` and `npm view @relate/relate-wasm` (the `@relate` scope is ours), Maven Central search for `com.relate:relate` (group ownership verified), `go list -m github.com/relatedb/relate/clients/go`
- [ ] After publish, each name resolves to the release just cut (same version as `relate --version`), not a squatted or stale package
- [ ] No unlisted install name on the site: `grep -rhoE "pip install [a-z0-9_.-]+|npm install [@a-z0-9/_.-]+|cargo add [^\`<]+|go get [^\`< ]+" src public dist | sort -u` lists only names from the table; `grep -rhoE "relate-(linux|darwin|windows)[a-z0-9.-]*" dist | sort -u` matches the release's actual asset names
- [ ] Native library and crate names (`relate-ffi`, `librelate_ffi`) match the release assets and the Java jar's bundled natives
- [ ] The same names appear in `llms.txt`, `/skill.md`, the served skill, and `relate skill install` output

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

- [ ] Canonical phrase everywhere a model reads first: "relate, the embedded Cypher graph database (relatedb.ai)" in `llms.txt`'s first line, every docs description, the skill description, MCP `serverInfo`, PyPI/npm descriptions, the README H1
- [ ] Confirm publishing rights for the `@relate` npm scope (owned by the Neo4j organisation; `@relate/cli` is the Desktop framework) before announcing `@relate/relate`
- [ ] PyPI and npm metadata: descriptions, keywords (agent memory, knowledge graph, GraphRAG, Cypher, embedded), links to `/docs/llms.txt` and the skill
- [ ] Official MCP registry: `server.json` for the local server; `mcpName` in `package.json`
- [ ] Context7, Smithery, Glama, awesome-mcp-servers listings; the skills registries (`/.well-known/agent-skills/index.json` live)
- [ ] `--help` and `relate agent-context` print the docs URLs; the error object carries a `docs` URL (upstream)
- [ ] `SECURITY.md` upstream and `/.well-known/security.txt` here; a disclosure address for `reference/security`
- [ ] Add `{"security": {"contact": "mailto:…"}}` to `src/content/docs/_data/project.json` once the disclosure address exists; `/.well-known/security.txt` is built from it (RFC 9116 requires Contact) and gains its Policy line when `reference/security` is published
- [ ] Sign `/docs/docs-artifacts.json` with the release key after the final build: `ssh-keygen -Y sign -f <release key> -n relate-release dist/docs/docs-artifacts.json`, and commit the result as `public/docs/docs-artifacts.json.sig`. It covers the exact bytes the build writes (the skill files and the docs graph's seed script), so any change to a listed artifact, a skill sync or a docs page edit included, needs a new signature; confirm the namespace (`relate-release`, as `install.sh` uses for SHA256SUMS) with upstream. `npm run docs:check` verifies it once it exists
- [ ] Decide whether `relate-docs.rl` is listed in the signed manifest: it is not byte-reproducible between builds (`npm run docs:graph` writes it to `dist/docs/`; the manifest lists it only from `public/docs/`). After launch the deploy workflows install relate with `public/install.sh` and run `RELATE_BIN=$HOME/.local/bin/relate npm run docs:graph` so the `.rl` ships
- [ ] Upstream asks for the skill bundle: a description carrying the canonical phrase (`docs:check` warns until then), no internal ADR ids in the public bundle, lowercase `relate`, and a line pointing at `https://relatedb.ai/docs/llms.txt`
- [x] Fix the root `llms.txt` TCK wording and `.cl` → `.rl` (phase 0)
- [x] First relate-named release: `_data/engine.json` names v0.1.2 (no `source_build`), the `relate-<os>-<arch>` asset names and the `relate-release` signature namespace were checked against the release's `SHA256SUMS` and its signature, and the CLI outputs were re-recorded against the release binary (`recorded_with` "release build")
- [ ] Name the operator of the Mixpanel project that receives CLI usage metrics in the Recipient row of `reference/privacy-and-telemetry` (upstream `surfaces/relate-cli/src/telemetry/handle.rs`, the `MIXPANEL_TOKEN` doc comment: "the shared Neo4j Labs CLI project — the same one neo4j-cli reports into"), or record here why not
- [ ] Publish a standalone release-signing key file at a stable `relatedb.ai` URL and update `reference/security`'s key table (its row says "not published yet")
- [ ] When the Cloudflare Web Analytics and the Pages Functions' agent-path log ship, change their rows on `reference/privacy-and-telemetry` from "Decided, not deployed" and drop the "today" qualifiers
- [x] `reference/security`'s manual verification block was run against v0.1.2 (`Good "relate-release" signature`, header `# relate-release-version: v0.1.2`, `relate-linux-amd64: OK`). Note: `install.sh` accepts a headerless manifest at or below v0.14.0 by version number, which now also covers relate 0.1.0 to 0.14.0; every relate release so far has the header. Raise with upstream (the ceiling should be tied to the old name, not to a number)
- [ ] Pick the contact address `/docs/feedback.md` and `reference/security` use, and add a "Report a problem" link to the docs layout pointing at it (none exists in the repo yet; feedback.md says the address is to be published at launch)
- [ ] When ADR-0022 is accepted, add a **Later references** line to ADR-0008 ("Amended by ADR-0022": the shared example graph is the team graph, not the friends graph)
- [ ] When ADR-0019 is accepted, add a **Later references** line to ADR-0013 ("Amended by ADR-0019": decision 3's per-file SHA-256 moved from the skills index to the signed manifest)

### Docs work deferred within phase 1

Listed in DOCS-PLAN.md §10's phase 1 platform list and not built in the platform pass; each one is still a launch requirement.

- [x] Content negotiation and `?section=` (DOCS-PLAN.md §3.1, §5; ADR-0012): built as the Cloudflare Pages `_middleware` function `functions/docs/_middleware.ts`. `Accept: text/markdown` on a docs URL answers with its twin; `?section=<anchor>` answers with that section and the Terms cap per section. Checked locally on workerd by `npm run docs:negotiation-check`. GitHub Pages, the interim host, cannot run it: until DNS moves to Cloudflare Pages it is live nowhere, and the `.md` twins are the only markdown form readers get
- [ ] Publish on `reference/privacy-and-telemetry` what Cloudflare itself records about each request and for how long, once the account's settings are known. The Pages Functions' log lines (`functions/_middleware.ts`, `functions/docs/_middleware.ts`) reach anyone only if Workers Logs or Logpush is turned on for the Pages project; say how long they are kept if so
- [ ] Connect each hosted-endpoint entry on `guides/agents/connect-over-mcp` to the live server once (Claude Code, Claude Desktop custom connector, Cursor, Codex, Windsurf `serverUrl`, Gemini CLI `httpUrl`, Cline `streamableHttp`, OpenCode `remote`). They follow each host's docs as of 2026-11-07 and were never tried against a live endpoint. Windsurf's key comes from its plugin docs, now served under docs.devin.ai
- [ ] Serve `/docs/relate-docs.rl` and `/docs/relate-docs.rl.sha256`: the download block on `reference/docs-graph` fetches them (see the `relate-docs.rl` manifest item above)
- [x] The config blocks per host (DOCS-PLAN.md §3.4): Codex, Windsurf, Gemini CLI, Cline and OpenCode, `--read-only` in every one. Landed in `guides/agents/connect-over-mcp` (Claude Code, Claude Desktop, Cursor, Codex, Windsurf, Gemini CLI, Cline, OpenCode), checked against each host's docs on 2026-11-07; re-check quarterly (DOCS-PLAN.md §6 "reverified"). Windsurf's English docs now redirect to Devin Desktop's; the block follows the still-served Windsurf docs (`~/.codeium/windsurf/mcp_config.json`)
- [x] The `<Agentic>` dual view: built in phase 2 as the `::::agentic` directive (README Constructs, ADR-0031); no page uses it yet.
- [ ] The cold-start eval (DOCS-PLAN.md §3.8): run by hand before launch (tasks × Claude Code, Codex, Cursor × the four conditions) and record the scores here. The harness is built (`npm run docs:evals`, ADR-0029); Cursor has no wrapper yet

- [ ] Re-check the third-party SDK names on `guides/integrations/*` against current releases (each page names the version it was checked against, as of 2026-11-07, and pins no install). Claude Agent SDK: `claude-agent-sdk` 0.2.179 (CI-run by the page's `options` sample) and `@anthropic-ai/claude-agent-sdk` 0.3.319 (Node >=18.14.0): `mcp_servers`/`mcpServers`, `tools`, `allowed_tools`/`allowedTools`, `permission_mode` `"dontAsk"`, `strict_mcp_config`/`strictMcpConfig`, `ResultMessage`. LangGraph: `langgraph` 1.2.20, `langchain-core` 1.7.6. Vercel AI SDK: `ai` 7.0.165 (`tool`, `inputSchema`, `generateText`, `isStepCount`; Node >=22), `zod` 4.6.7, `@ai-sdk/anthropic` 4.0.99 (Node >=22). No model call was run for these pages (no credential)
- [ ] Phase 2 integrations, checked 2026-11-08 against what the sample environment installed (no model call; no credential): `pydantic-ai` 2.66.0, `openai-agents` 0.24.0, `llama-index-core` 0.14.25, `langchain` 1.4.9, `crewai` 1.15.37 (its own venv), `@mastra/core` 1.82.0. Re-check with the others above
- [ ] Phase 2: pull requests to LangGraph, Vercel AI SDK, LlamaIndex, Mastra and Agno docs for the integrations; a GitHub template repo with the `AGENTS.md` snippet, the skill and a verify script

### Docs work in phase 2 (interactive elements)

- [x] The phase 2 interactive elements of DOCS-PLAN.md §7.3 are built and placed (ADR-0035 to ADR-0042; §10 "As built (phase 2, part C)"): graph view extras, the timing bar, the plan viewer, the agent-mode terminal, the live schema, the vector and geospatial explorers, the MCP tryout, agent trace playback and the docs graph. `npm run cookbook:browser` runs each element's cases
- [x] Engine bump to 0.1.2: the terminal's fixtures were re-recorded and its renderers print the CLI's `timings` and `planCache` (static forms write the values as `<ms>`); `node scripts/docs.ts --record` re-stamped every element form. Repeat at each bump
- [ ] `reference/docs-graph` lists `https://relatedb.ai/docs/relate-docs.rl` and its `.sha256` as launch-day targets; serve them (the manifest item above) or drop the row
- [ ] The docs graph view fetches `/docs/graph-view.json` and the plan viewer, terminal and explorers load the engine from `/wasm/`: after the host move, open `reference/docs-graph`, `concepts/agent-native` and `guides/cypher/geospatial` on `relatedb.ai` and check each element goes live with no console error
- [ ] When ADR-0042 is accepted, add a **Later references** line to ADR-0010 naming it (the docs graph's network view is the one graph module's second entry point, `renderNetwork`)

### Docs work in phase 2 (platform)

- [ ] Host deeplinks: the Cursor and VS Code link forms in `src/lib/docs/deeplink.ts` follow each host documentation page as of 2026-11-07 (Cursor install-links page; VS Code extension guide, page dated 2026-11-04); neither link has been opened in the real app. Re-check quarterly
- [ ] `_data/surfaces.json`: re-check every cell at each engine bump. Rechecked on 2026-11-09 against v0.1.2 (f0c09d2): the release binary (query session; `relate serve` over Bolt with the Neo4j Python driver, HTTP, and MCP on stdio and streamable HTTP), the shipped WASM, and probe programs on the Python, Node.js, C, Java, Go, Swift and Rust clients. No cell is inferred from the shared library any more. Loading a store from a URL was run with an http URL on loopback; https reached a verified TLS handshake but no store was loaded over https. The Arrow and CDC "no" cells of the clients other than Python, Node.js and Rust, and of the served surfaces, rest on the v0.1.2 specs and client sources
- [ ] Confirm the license of the docs text (cookbook recipe query-the-relate-docs front matter says Apache-2.0, like the other site-authored recipe datasets; relate-web has no LICENSE file) and cite the source, or change the field
- [ ] Structural check "a term used on three or more pages and defined on none": needs a candidate-term source outside the glossary (none exists; no bold or otherwise marked term occurs on three pages). Owner to be assigned: the glossary check (`checks/glossary.ts`) or a graph query
- [ ] First live docs eval (`docs-evals.yml` by hand, Claude Code wrapper). Confirm that the skill condition's `system/init` event lists the relate skill, that a `-p` run starts with an empty HOME and ANTHROPIC_API_KEY, and that the Bash `tool_use`/`tool_result` transcript is read (`scripts/evals/agents/claude-code.sh`, `scripts/evals/harness.ts`)
- [ ] Before reading Codex scores: confirm that `codex exec --json` `item.completed` command_execution items carry `exit_code` and `aggregated_output` (on no vendor page read so far), and wire the four conditions for Codex
- [ ] To run the eval on every relate release (DOCS-PLAN.md §10): set the repository variables `DOCS_EVALS_AGENT_PACKAGE` (pinned npm spec) and `DOCS_EVALS_HARNESS`, plus ANTHROPIC_API_KEY or CODEX_API_KEY. Until upstream sends the `relate-release` dispatch, no run starts by itself
- [ ] List the five task skills (`relate-agent-memory`, `relate-graphrag`, `relate-schema-design`, `relate-query-tuning`, `relate-migrate-from-vector-search`) wherever the CLI bundle is listed in the skills registries, once `/.well-known/agent-skills/index.json` is live
- [ ] `guides/agents/install-the-skill` names skills CLI 1.7.6 (read and run 2026-11-07); re-check the `--skill` selection and the digest check against the current release before launch
- [ ] Run `docs-samples.yml` once by hand now that `RELATE_UPSTREAM_TOKEN` exists (it builds from the tag `_data/engine.json` names, v0.1.2): the Linux paths of the C, Go and Java runners and the macos-15 runner's Swift toolchain are untested. The Java client's pom now reads 0.1.2, the engine's version (`relate-0.1.2.jar`); after launch, check that the published packages' versions equal the engine's
- [x] Capability catalog: each phase 2 guide has joined its capability's `guides`, and `neo4j-subgraph-mirror` cites the recorded `--dry-run` push plan (`guides/neo4j/push-to-neo4j#step-3`; a real pull or push still needs a Neo4j or Aura server no check here has). Done in phase 2 part B
- [ ] Capability catalog: several verify runs prove less than the whole capability (`concepts/problems-relate-solves`); re-point them at a `bash verify` step on a guide where one now proves it directly
- [ ] When ADR-0026 to ADR-0034 are accepted, change their status in `docs/adr/README.md`

### Docs work in phase 2 (pages)

Written in phase 2 part B (DOCS-PLAN.md §10); what a launch, a release or upstream still has to settle:

- [ ] Client install lines are launch-day targets, never run against a registry: `go get github.com/relatedb/relate/clients/go` (and its cgo flags outside an upstream checkout), the Java coordinate (written `<release>` because the client pom reads 0.1.0), the SwiftPM URL, and the `@relate/relate-wasm` package layout (`relate.js`, `relate_bg.wasm`, `trap.js`, `snippets/` at its root, per upstream's `package.json.template`). Check each against the published package, and replace `<release>` with the coordinate's version
- [x] The release `librelate_ffi` dylib's install name was checked against v0.1.2's `relate-ffi-aarch64-apple-darwin.tar.gz`: it is the CI runner's absolute path, so an rpath alone does not find it on macOS (a program built that way aborts at launch). The Go pages already said so; the C pages now add `install_name_tool -id @rpath/librelate_ffi.dylib` on macOS. Ask upstream to ship the dylib with an `@rpath/` install name
- [ ] `guides/serve/docker`: the image was read from upstream's Dockerfile, Makefile and entrypoint, never built or run here; build it once and replay the page
- [ ] `guides/serve/auth-and-tls` names no TLS proxy configuration because none was installed to verify one; add one verified configuration
- [ ] `guides/serve/bolt` and `reference/server/bolt`: the Neo4j driver claims (Java and Python drivers need `--bolt-identity Neo4j/…`; Go does not) come from upstream's compatibility record; only Python drivers 6.0.3 to 6.4.0 were run, and Neo4j Browser only with `--auth none`
- [ ] Browser pages say only Chrome 157 was checked; run the OPFS steps in Firefox and Safari
- [ ] The Java, Go and Swift reference pages name source build 6a0c391, where their clients were built, not ac441ec; the first release re-records all seven languages from one build
- [ ] Upstream asks found while writing: the CLI skill bundle's `references/vector.md` still calls the vector index approximate HNSW (the search is an exact scan, upstream ADR-0256); C ABI and Node.js open failures report a generic `internal error` where Python reports `storage locked: <path>`; the Go client's `Close` is not idempotent (a call after it is a use-after-free); a write's own property keys raise 01N52 on a fresh store over MCP; upstream `docs/api/http` says "no managed transactions" though the binary serves `/tx`; `docs/api/mcp/spec.md` says any POST without `application/json` is 415 though `application/xml` passes
- [ ] Upstream asks found re-verifying the docs on v0.1.2 (2026-11-09): `relate clone` refuses every `.rl` destination that carries markdown body properties, so a markdown vault cannot become a markdown `.rl` (since 0.1.0; the error names `parquet` even with `--to-snapshot-format markdown`); an index's `fulltext.analyzer` option is accepted and shown but stored text always uses the standard tokenizer, so `WITH ANALYZER 'english'` can miss stemmed matches; `parquet-wide` is refused by `RELATE_SNAPSHOT_FORMAT` and `clone --to-snapshot-format`, a clone drops the wide encoding, and `--help` says "empty directory only" though an existing parquet store converts; the HTTP Query API's entity `elementId` is the bare id (`"0"`) while `elementId()` and Bolt give `4:relate-neo4j:n0`; opening an https URI over the C ABI (Node.js, C, Java, Go, Swift) reports `internal error` where Rust and Python name the unsupported scheme; `relate serve --help` says `--load` defaults to a `:memory:` target, but `serve` without `--database` fails; MCP `read_cypher` refuses a read-only `LOAD CSV … RETURN` and `write_cypher` drops its rows; upstream `docs/api/java/spec.md` still gives `getQueryType()`/`getNamespace()` as strings, and `PlanActual.loops` is documented as null at the root but is null on the leaf; Go, Swift and JS still use string severity and category and the 8-field `PlanActual`, where Java has enums and the full shape; the release `librelate_ffi.dylib` carries an absolute install name; `install.sh`'s legacy-manifest ceiling (v0.14.0) is a version number that relate 0.1.x falls under

### Docs work in phase 3

- [ ] `guides/migrate/from-kuzu` quotes Kuzu 0.11.3 (run in a scratch environment on 2026-11-09; CI does not run Kuzu): re-check the repository's archived status and last release, the `COPY ... TO` JSON export and the quoted Kuzu error messages before launch
- [ ] `guides/migrate/from-sqlite`: its `sqlite3` output fences were recorded with sqlite3 3.51.0; the `ubuntu-latest` runner ships 3.45.1. Confirm on the first `docs-cli-check.yml` run (the page uses `-header -list`, whose output did not change between versions; `-table` did). `docs:cli-check` now needs `sqlite3` on PATH
- [ ] `cookbook:browser` launches Chrome with `--enable-unsafe-swiftshader` so every NVL view has WebGL in CI as in a real browser; the playground's double-click expansion case failed once under heavy machine load and passed on rerun. Watch it in CI
- [ ] Sample manifests (ADR-0053): after any full `npm run docs:samples` replay, rewrite `src/content/docs/_data/samples.json` (commits, toolchains, date, platform); `docs:check` holds its pins to `scripts/samples/setup.sh`
- [ ] In-browser embeddings (ADR-0050): the docs recipe's "Download the model (82 MB)" fetches bge-small-en-v1.5 from huggingface.co (redirected to Hugging Face's CDN) at a pinned revision; state on `reference/privacy-and-telemetry` what Hugging Face logs about those requests and for how long, once known. `cookbook:browser` now downloads about 67 MB from the hub on each full run, so a hub outage fails it; decide whether CI caches the files. No test exercises the refusal of a file whose SHA-256 does not match its pin
- [ ] Integration traces: only `guides/integrations/claude-agent-sdk` reaches relate over MCP; the LangGraph and Vercel AI SDK traces replay their in-process statements as MCP calls and say so. Re-check when those pages' samples change
- [ ] When ADR-0045 to ADR-0053 are accepted, add Later references lines where they amend earlier records (ADR-0010 for ADR-0051's network colours; ADR-0035 for recipes carrying elements, ADR-0046, and `page.scratch()`, ADR-0048; ADR-0039 for the search reference placement and ADR-0050; ADR-0027 already names ADR-0053), and change their status in `docs/adr/README.md`

## Interim host: GitHub Pages at relatedb.ai

- Host: `https://relatedb.ai/` (apex A records → GitHub Pages in DNS; `public/CNAME` = `relatedb.ai`; Settings → Pages custom domain `relatedb.ai`). The former preview host `r31473.relatedb.ai` is retired.
- Indexable: the `noindex` meta tags are gone and `robots.txt` allows all with the sitemap line (2026-11-10).
- [ ] Settings → Pages → Enforce HTTPS once the certificate issues (`dig +short A relatedb.ai`, then `curl -sI https://relatedb.ai/`).
- [ ] Remove the `r31473` CNAME record in DNS; `www` should point at the apex (`relatedb.github.io` CNAME) so it redirects.
- Optional: verify `relatedb.ai` at the org level (TXT record) so nobody else can claim it on Pages.

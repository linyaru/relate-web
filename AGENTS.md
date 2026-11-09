# relate-web agent contract

The public website for **relate** (formerly *cypherlite*) at `relatedb.ai`: an Astro static site with the docs, the cookbook, the playground, the hosted docs MCP Worker and a copy of the engine's WASM build. Pre-launch and stealth: nothing is published yet, so package names, release URLs and install URLs on the site are launch-day targets and 404 until launch ([`LAUNCH.md`](LAUNCH.md)). Rules here apply to every change. The site's standing contract (tone, invariants, facts and their sources) is [`MAINTAINING.md`](MAINTAINING.md); the documentation plan and style guide are [`DOCS-PLAN.md`](DOCS-PLAN.md) and [`src/content/docs/STYLE.md`](src/content/docs/STYLE.md); each authored content area has its own authoring contract (`src/content/docs/README.md`, `src/content/cookbook/README.md`, `playground/README.md`, `workers/docs-mcp/README.md`).

## 1. Rules

### Decision log

A decision about hosting or deploy, build tooling other work depends on, content architecture (sections, URLs, what is authored here versus synced from upstream), agent-facing surfaces (markdown delivery, `llms.txt`, the skill, the MCP server), the design system or any `MAINTAINING.md` invariant, the style guide or glossary rules, or a dependency pinned for a reason gets an ADR in [`docs/adr/`](docs/adr/) **before** or **with** the implementation. Not ADR-worthy: copy edits, a new page in an existing section, bug fixes, dependency bumps with no behaviour change, anything trivially reversible. The full test and the format are in [`docs/adr/README.md`](docs/adr/README.md); `npm run adr:check` enforces them in CI.

- Filename `NNNN-short-kebab-slug.md`; the next number is one more than the highest present; numbers are never reused. One decision per file. Cite others as `ADR-NNNN`, upstream's as `upstream ADR-NNNN`.
- Header lines in order: `# ADR-NNNN: title`, `Status:`, `Date:`. Sections in order: **Context**, **Decision**, **Alternatives considered** (each ending with its rejection reason), **Consequences**; optional **Later references**.
- Status starts `Proposed`; `Accepted` only when the maintainers agree. An accepted ADR is immutable except for **Later references**; a change of mind is a new ADR that names the old one.
- Public record: no ticket, chat or tracker references; no person names (roles, not people); no credentials, internal hosts, or anything `LAUNCH.md` marks internal.
- Line budget: target 80 lines, ceiling 150. Record the why and the shape, not the implementation: no code, config dumps, file inventories or build history.
- Add the record to the index table in `docs/adr/README.md`.

### Documentation

- Docs pages follow `DOCS-PLAN.md` §4 and `src/content/docs/STYLE.md`. Only shipped behaviour, verified against the release binary or the WASM build the site ships. Every Cypher example runs at build and must match its recording; the cookbook has the same rule.
- Docs are data (ADR-0013): twins, skill files and MCP tool results are reference text. Outside a fenced prompt block, do not address the agent in the second-person imperative; never add instructions to a tool result. Every host config block an agent can copy opens the store `--read-only` and pins a version.
- Only substantiated claims on any page; follow the tone contract in `MAINTAINING.md`.

### Upstream

The engine lives in the upstream relate repository. The WASM copy under `public/wasm/`, `install.sh`, `releases.json`, `extensions.json` (+ `.sig`) and the skill bundle `public/skills/relate/` are synced from it, never hand-edited (refresh steps in §4). The docs and the cookbook are authored here and are not synced (ADR-0002). The docs' facts, samples and CLI recordings are pinned to one upstream commit (today `ac441ec`, relate 0.16.1); re-pin to a release, never to a moving checkout.

### Conventions

- The name is `relate` everywhere on the page. Target package names: Python `relate-db`, npm `@relate/relate` and `@relate/relate-wasm`, Java `com.relate:relate`, Go `github.com/relatedb/relate/clients/go`, binaries `relate-<os>-<arch>`.
- Some `cypherlite` strings intentionally remain until upstream artifacts are regenerated (old URLs, release asset names in `releases.json`, `install.sh`). Check `git grep -i cypherlite` before assuming a leftover is a bug.
- Colours come from the tokens in `src/styles/base.css` (`--bg`, `--fg`, `--accent`, `--on-accent`, …), never hard-coded hex. Day is the default theme; Night via `data-theme="dark"` or `prefers-color-scheme`. Code and terminal blocks stay dark in both.
- The site's tooling runs `.ts` directly on Node ≥ 22.18 (type stripping): keep `src/lib/cookbook/` and `src/lib/docs/` to erasable TypeScript (no enums, namespaces or parameter properties) and import with `.ts` extensions. `src/lib/cookbook/result-view.ts`, `cells.ts`, `graph-model.ts`, `palette.ts` and the `schema-*.ts` files are shared with the browser runtime, so keep them free of Node imports.
- The engine is never bundled: the home page console, the cookbook and docs runtime, the playground and the Worker load it from `/wasm/` (or the Worker's copy) at runtime. The one NVL module is `src/scripts/cookbook/graph.ts` (pinned 1.2.2; `astro.config.mjs` aliases its Segment telemetry to an empty module).
- The home page still renders the legacy single-file markup; keep its behaviour identical while porting (sections, ids, anchors, the lazy-loaded WASM console). Redesign and branding come after the faithful port.

## 2. Layout

### Site shell

- `src/legacy/index.html` is the original whole-page markup (inline CSS and JS); `src/pages/index.astro` renders it unchanged and injects `Header` at the `<!--SITE-HEADER-->` marker. Extract sections into components incrementally, then delete the legacy file.
- `src/components/Header.astro` is the one top bar (nav links, theme toggle, mobile menu and their JS); edit nav items there. `src/styles/base.css` holds the fonts, the Night (default) and Day tokens (the Relate home design's names: `--surface-*`, `--ink`, `--brand`, `--line`, `--term-*`; the older `--bg`/`--fg`/`--accent`/`--code-*` names are aliases of them), the fonts (Geist, Geist Mono and Pixelify Sans under the names Relate Sans/Mono/Pixel; licenses in `public/fonts/LICENSES.md`), the reset and the top-nav styles. `src/layouts/Base.astro` is the shell for section pages; `Placeholder.astro` wraps it for coming-soon pages.
- Brand assets (source: the "Relate Brand Board" artifact): `public/favicon.svg` (+ `favicon-32.png`, `favicon-192.png`), `public/brand/`. The top-bar logomark is inlined in `Header.astro` and shaded via CSS vars. `public/img/favicon.png` is the old icon and is unused.
- `public/` is copied to `dist/` as-is: `llms.txt`, `robots.txt`, `install.sh`, `releases.json`, `extensions.json` (+ `.sig`), `.nojekyll`, `CNAME`, `_routes.json`, `_redirects`, `fonts/`, `img/`, `skills/`, `skill.md`, `wasm/` (a copy of upstream `surfaces/relate-wasm/pkg/`: `relate.js`, `relate_bg.wasm`, `opfs.js`, `trap.js`, `snippets/`; it stays in `public/` so Vite never bundles or rewrites it).
- `src/pages/sitemap.xml.ts` generates the sitemap (home, cookbook, every recipe, every docs page). `astro.config.mjs` `site` is the interim preview host; change it to `https://relatedb.ai` at launch. Canonical URLs use `CANONICAL_ORIGIN` (`relatedb.ai`); `NOT_PUBLIC_YET` in `src/lib/cookbook/links.ts` turns pre-launch links into text.
- `MAINTAINING.md` is the standing contract (its "no build step / single page" statements predate the Astro migration; everything else applies). `LAUNCH.md` holds pre-launch notes, target names and launch-day checks. `PLAN.md` and `WEBSITE-PLAN.md` are historical (cypherlite era); do not extend them.

### Cookbook

- `src/content/cookbook/`: one markdown file per recipe; `README.md` there is the authoring contract (its index section is generated). `diagrams/` holds the pre-rendered SVGs (light and dark) and label colours drawn by `scripts/diagrams/render.mjs` (the shared docs and cookbook renderer, an authoring-only package with its own `package.json`: mermaid and puppeteer-core; CI never installs it; every mermaid block needs `accTitle:` and an `accDescr { }` block) in the site's colours, which `src/lib/cookbook/tokens.ts` and `diagram-theme.ts` read from `base.css`; data models are laid out by `src/lib/cookbook/schema-*.ts`. Re-render with `--force` after changing colour tokens. `query-the-relate-docs.md` carries a `docs` data block (a subset of the docs graph with vectors) generated by `scripts/docs-recipe-data.ts`.
- `src/lib/cookbook/` is the parser, validator and runner, ported from upstream's Rust `relate-cookbook` harness, plus the page rendering: `site.ts` replays every recipe once per build and fails it on any drift, stale diagram, stale element form or invalid recipe; `render.ts` and `markdown.ts` turn a recipe into HTML. `scripts/cookbook.ts` is the check and record command.
- Interactive elements on recipes (ADR-0045): a `:::<name>{…}` … `:::` block at column 0 is a docs element over the recipe's own steps. `recipe.ts` finds the blocks; `elements.ts` (Node only) turns the recipe into the framework's page (steps as cells, the run as recordings) and shares the docs check and record code, so `cookbook:record` writes each form into `diagrams/<slug>-element-<id>.*` and `cookbook:check` and the build read them back; the page renders the `<docs-element>` host, and the twin carries the static form in place of the directive. Placing an element on a recipe is its directive alone.
- Pages: `src/pages/cookbook/` (the index, `[slug]/index.astro`, and the `[slug]/index.md`, `results.json`, `recipe.json`, `data/<name>.json` and `cookbook/llms.txt` endpoints) on `src/layouts/Cookbook.astro`, styled by `src/styles/cookbook.css`. `recipe.json` is format 1 of the playground hand-off, each cell titled by the heading it sits under (`cellTitles` in `recipe.ts`); each step, the engine bar and the header link `/playground/#recipe=<slug>[&cell=<id>]` via `playgroundHref` in `render.ts`.
- Runtime: pages are complete without JavaScript (every step shows its recorded result). `src/scripts/cookbook/session.ts` makes steps runnable (Run, Edit, Run all, Reset, Stop, parameters, JSON view) on a module worker (`worker.ts`) that loads the engine from `/wasm/`; `src/scripts/cookbook/runtime.ts` starts it on recipe pages (with the docs element loader when the recipe has elements) and `src/scripts/docs/runtime.ts` on docs pages. Graph results open in the NVL view in `graph.ts`, loaded only when one comes into view; `graph-model.ts` and `palette.ts` are shared with the check, which expands the first node of every graph result.

### Docs

- `src/content/docs/`: the pages; `_glossary/` (each term's short and full definition; the first use on a page is a toggletip, `src/lib/docs/glossary-toggletip.ts`, and `/docs/glossary.json` serves them as data); `_data/` facts files (`engine.json`, `cli.json`, `errors.json`, `surfaces.json`, `embeddings.json`, `skill.json`, `usage.json`, `evals.json`, `samples.json`); `_capabilities/`, the capability catalog rendered into the generated section of `concepts/problems-relate-solves` and `/docs/capabilities.json` by `src/lib/docs/capabilities.ts`; `README.md` there is the authoring contract.
- Rendered by `src/lib/docs/` (twins, llms indexes, generated reference pages in `generated/`, checks in `checks/`) and `src/components/docs/`, served by `src/pages/docs/`. Every ```` ```json data=<name> ```` block is also served at `/docs/<page>/data/<name>.json` (its exact text); a twin inlines a block of up to 2 KiB and replaces a larger one with a stub naming that URL, the size, SHA-256 and shape (`src/lib/docs/data-blocks.ts`, `checks/data.ts`, ADR-0048), so every surface built from the twin carries the stub. Generated reference pages may have more than one path segment (`src/pages/docs/reference/[...page].astro`): the glossary, the changelog and `reference/server/docs-mcp-usage` (from `_data/usage.json`).
- Constructs: the `::::agentic` and `:::deeplink` directives in `src/lib/docs/constructs.ts` (`deeplink.ts` builds and checks host install links); the components in `src/components/docs/`, the sixth being `<Matrix />` (`Matrix.astro` + `matrix.ts`, from `_data/surfaces.json`); the language picker (`LanguagePicker.astro` in the doc header, key vocabulary and `withSpellings` in `src/lib/docs/languages.ts`, script `src/scripts/docs/language-picker.ts`; it shares the `docs-tab` localStorage entry with the tab script in `Docs.astro` and rewrites it after every tab click so each language keeps all its spellings).
- The docs graph: `src/lib/docs/graph.ts` builds it, served as `/docs/graph.cypher`, `/docs/graph.json` and per page `/docs/<id>.graph.md` (capabilities and the problems they solve included). Sections carry a 384-dim `embedding` (vector index `docs_vector`) from the committed `_data/embeddings.json`, written by the authoring-only package `scripts/embeddings/` (transformers.js, its own package.json; CI never installs it) via `scripts/docs-embeddings.ts`; `docs:check` fails on a stale vector (`src/lib/docs/checks/embeddings.ts`). `/docs/docs-artifacts.json` lists every agent artifact with its SHA-256 (signed at launch).
- Sample manifests (ADR-0052): `src/lib/docs/sample-manifests.ts` serves every verified sample as `/docs/<page>/samples/<id>.json` (the program, its recorded output with SHA-256, the client build it last ran on, how the runner runs it) and the index `/docs/samples.json`; the twin's generated `samples` frontmatter lists a page's manifests. The client builds come from `_data/samples.json`, written by hand after a full `docs:samples` replay (commits, toolchain, platform, date, setup's pins; docs:check holds the pins to `scripts/samples/setup.sh`); never infer a client's commit from `engine.json`. `checks/sample-manifests.ts` compares every manifest with its fence and record, and with `--built` with the served page and twin.
- Skills: `public/skills/relate/` is upstream's bundle (synced by `npm run skill:sync`; do not hand-edit). The five task skills (`public/skills/relate-agent-memory/`, `relate-graphrag/`, `relate-schema-design/`, `relate-query-tuning/`, `relate-migrate-from-vector-search/`, each `SKILL.md` + `references/`) are authored here, modelled by `src/lib/docs/skill.ts`, checked by `checkTaskSkills` and `checkTaskSkillCypher` in `src/lib/docs/checks/skill.ts`, and recorded after review in `_data/skill.json` `task_skills`. `public/skill.md` is their entry point; `src/pages/.well-known/` serves the discovery indexes (`agent-skills/index.json`, `skills/index.json`) and every skill's files under `/.well-known/skills/<name>/`.
- The eval harness is `scripts/docs-evals.ts` with `scripts/evals/` (tasks, fixtures, agent wrappers).

### Interactive elements (ADR-0035 to ADR-0042, ADR-0045 to ADR-0047, ADR-0050, ADR-0051)

- An element is a container directive or a word on a ```` ```cypher run ```` fence. The twelve directives (`:::plan`, `:::terminal`, `:::schema-live`, `:::vector-explorer`, `:::geo-explorer`, `:::mcp-tryout`, `:::agent-trace`, `:::docs-graph`, `:::storage-animator`, `:::scale-demo`, `:::graph-diff`, `:::timeline`) each have a build side `src/lib/docs/elements/<name>.ts` (its static form recorded by `docs:record` into the page's `diagrams/`, hash-stamped on its inputs and its words), a lazy browser module and styles in `src/scripts/docs/elements/`, and a case file `scripts/browser-cases/<name>.ts`. The two cell words (graph view extras, module `graph-extras`, and `timing`) have no build side (the cell's recording is their static form), only the browser module, styles and case file, with shared helpers in `src/lib/docs/elements/_<name>-*.ts`. All are found by directory (docs README "Interactive elements"). A cookbook recipe takes any directive too (ADR-0045, Cookbook above): the same build file, module and case file, its form recorded by `cookbook:record`; cookbook:browser runs each case file on the first docs page and the first recipe that carry the element.
- Every status line opens with the shared wording and prints durations with the one formatter in `src/lib/docs/elements/_wording.ts` (`recordedLine`, `liveLine`, `formatMs`: one decimal, the step of the browser's timer). NVL stays in `graph.ts` (`renderGraph`, `renderNetwork`, and `renderScale` on NVL's WebGL renderer). An element whose graph must not touch the page's database opens its own with `page.scratch()` (a second engine worker, closed to hand its memory back); one that reruns a recipe step reads its parameters with `CellHandle.runParams()`, which fetches a dataset where `params()` reads only an editable block.
- `src/components/docs/PageRuntime.astro` loads the page runtime only on pages with cells or elements. A docs or recipe page runs under 60 KB of its own JavaScript before lazy chunks: `docs:check -- --built` measures it, and `cookbook:browser` fails a page that loads more, or a script the count misses.

### Playground

`playground/` is the full-screen SPA served at `/playground/` (moved from upstream `examples/wasm-playground/`). Its **own package** (Vite 5, React 19, TS 5, Neo4j Needle, NVL, CodeMirror) with its own lockfile and build tuning in `vite.config.ts`; the root `tsconfig.json` excludes it. Install with `npm ci --prefix playground`. Its worker loads `/wasm/relate.js` at runtime (types from `public/wasm/relate.d.ts`), and the `site-wasm` plugin serves `public/wasm/` to its dev server. The cookbook hand-off (`#recipe=<slug>[&cell=<id>]`) imports `src/lib/cookbook/cells.ts`. See `playground/README.md`.

### Hosted docs MCP Worker

`workers/docs-mcp/` is a Cloudflare Worker for `https://relatedb.ai/mcp` (DOCS-PLAN §3.7–3.8, ADR-0012, ADR-0033). Its **own package** (the Agents SDK's `createMcpHandler` over `@modelcontextprotocol/server` v2, wrangler 4) with its own lockfile and tsconfig; the root `tsconfig.json` excludes `workers/`. Install with `npm ci --prefix workers/docs-mcp`. `npm run mcp:bundle` (after `npm run build`) writes its gitignored `generated/` from `dist/` (twins with section offsets, errors, skills, releases, `capabilities.json`, each recipe's cells with recorded results and `verifies` summary, `samples.json` and every sample manifest, the Differences table, the graph seed without vectors, the vectors as one parameter, a copy of `public/wasm` plus `relate-factory.js`); the Worker's source imports those files, so its tsc runs after the bundle. Five tools, the ceiling: `search_docs` (hybrid with the `AI` binding, full-text without), `get_page` (cuts a section with `src/lib/docs/negotiation.ts`, the same code as `?section=`), `explain_error`, `validate_cypher` (`EXPLAIN` on a fresh WASM instance per call, never the seeded docs instance), `discover_capabilities`; the resources (pages, `llms.txt`, every skill file, releases, capabilities, every cookbook cell, the samples index and every sample manifest) and the `onboard` and `text-to-cypher` prompts. The Worker replays the seed without vectors (`scripts/seed.ts`) and loads them on the first hybrid search. Its unit tests need no build. See its README.

### Pages Functions

`functions/` holds the Cloudflare Pages Functions, compiled by `wrangler pages deploy dist` from the repo root. `functions/docs/_middleware.ts` does the docs content negotiation (`Accept: text/markdown` → the twin; `?section=<anchor>` → one section) using `src/lib/docs/negotiation.ts`; `functions/_middleware.ts` logs fetches of the twins, the data files they link, `llms.txt` and the skill; `public/_routes.json` limits the paths that invoke a function. Keep no `package.json` or `node_modules` in `functions/`: wrangler runs esbuild on every file under it. GitHub Pages, the interim host, does not run it; everything else on the site is static and works there.

## 3. Commands

```bash
# install
npm install && npm ci --prefix playground && npm ci --prefix workers/docs-mcp

# develop
npm run dev               # http://127.0.0.1:8765 (launch config `relate-web`)
npm run dev:playground    # the playground's own dev server, http://localhost:5173/playground/
npm run mcp:dev           # the docs MCP Worker under wrangler dev --local, http://127.0.0.1:8787/mcp (no login; search_docs is full-text there)

# build and type-check
npm run build             # -> dist/ (astro build, then the playground into dist/playground/)
npm run check             # astro check
npm run check:playground  # tsc for playground/
npm run mcp:test          # the Worker's unit tests (no build needed) and its tsc (needs generated/, so after mcp:bundle)
npm run adr:check         # docs/adr/: unique sequential numbers, header and section order, line ceiling, public-record patterns, README index

# cookbook
npm run cookbook:check    # every recipe runs on public/wasm and matches its recorded results (COOKBOOK_ONLY=<slug>[,…] limits it)
npm run cookbook:record   # rewrite result blocks, element static forms + README index from a run; review the diff
npm run cookbook:test     # unit tests for src/lib/cookbook
npm run cookbook:diagrams # after `npm ci --prefix scripts/diagrams`: render changed cookbook diagrams (-- --force for all; needs Chrome)
npm run cookbook:browser  # after a build, in headless Chrome: every recipe runs and matches, the playground loads and expands a node, every recipe opens in it; docs pages with cells run, the toggletip, agentic sets, the language picker and deeplinks work; every interactive element's cases at 1400 and 390 px and under reduced motion (on its first docs page and its first recipe), and the 60 KB script budget. Removes its Chrome profile on exit (needs Chrome; CHROME_PATH; ELEMENT_ONLY=<element>[,…] limits the case files; DIST=<dir> serves another build)

# docs
npm run docs:check        # source checks: frontmatter, links, words, twins, trust, diagrams, glossary, docs graph, embeddings, capability catalog, task skills, element static forms (-- --built after a build adds the dist/ checks and the script budget); see src/content/docs/README.md "Checks"
npm run docs:lint         # Vale on the docs prose (needs `vale`; CI pins 3.25.1)
npm run docs:test         # unit tests for src/lib/docs (UPDATE=1 re-pins _example/example.twin.md)
npm run docs:record       # rewrite docs pages' cell results sidecars, static graph SVGs and element static forms from a run on public/wasm (DOCS_ONLY=<id>[,…] limits it); review the diff
npm run docs:diagrams     # the shared renderer for src/content/docs pages
node src/lib/docs/capabilities.ts --write    # rewrite the generated section of concepts/problems-relate-solves from _capabilities (docs:check fails while stale)
RELATE_BIN=<relate> DO_NOT_TRACK=1 npm run docs:cli-check   # replay _data/ CLI recordings and `bash verify` fences (-- --record rewrites); skipped without a binary
RELATE_BIN=<relate> node src/lib/docs/elements/_terminal-record.ts   # re-record the agent-mode terminal's fixtures; docs:test compares the terminal's bytes with them
RELATE_BIN=<relate> npm run docs:graph       # docs graph seed -> dist/docs/relate-docs.rl (+ .sha256, relate-docs.json); without RELATE_BIN it only times the WASM replays and checks seedWithoutVectors
npm ci --prefix scripts/embeddings && npm run docs:embeddings   # re-embed changed sections into _data/embeddings.json (bge-small-en-v1.5; authoring only; -- --force for all), then rewrites the docs data block of query-the-relate-docs; follow with COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record
node scripts/docs-recipe-data.ts [--check]   # the recipe's docs-graph subset from the graph and the embeddings
npm run docs:samples      # run the verified ```<lang> run samples (python, js, rust, java, go, swift, c); needs the env from `bash scripts/samples/setup.sh --upstream <checkout> --out <dir outside both repos>`; -- --record rewrites; -- --lang rust,go limits; DOCS_EXAMPLES=1 includes the example page
npm run docs:evals        # the cold-start eval: DOCS_EVALS_AGENT="<command>" DOCS_EVALS_HARNESS="<name version>" runs scripts/evals/tasks.json under the four conditions and writes _data/evals.json; `DOCS_EVALS_AGENT="bash scripts/evals/fixtures/pass.sh" npm run docs:evals -- --dry-run` proves the harness without a model
npm run docs:usage        # hosted docs MCP usage from Cloudflare Workers Logs into _data/usage.json; skipped without CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID

# agent surfaces
npm run mcp:bundle        # after a build: dist/ -> workers/docs-mcp/generated/ (fails when a twin and the docs graph disagree about a section, or a recipe.json differs from its recipe)
npm run docs:mcp-check    # after a build and the Worker install: the Worker under wrangler dev --local on a free port from 8800: tools, resources, prompts, byte-for-byte twins and sections, refusals, CORS, limits, the log (-- --coldstart 5 times five cold starts); skipped without dist/
npm run docs:negotiation-check  # after a build: the Pages Function on `wrangler pages dev dist` (local, no login): markdown negotiation, ?section=, pass-through; skipped without dist/
npm run skill:sync        # copy upstream's skill bundle into public/skills/relate/ and record the commit in _data/skill.json (keeps task_skills)
npm run skills:record     # after reviewing a task skill or a recipe it cites: record file hashes and recipe digests in _data/skill.json task_skills (-- --dist dist after a build)
```

## 4. Refreshing from upstream

The WASM build comes from the upstream relate checkout (toolchain pinned to 1.88.0; needs the `wasm32-unknown-unknown` target):

```bash
cd <upstream relate checkout> && bash scripts/build-wasm.sh --mode release
# copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into public/wasm/
npm run skill:sync        # then review the diff of public/skills/relate/
```

The WASM serves the home page console, the cookbook, the docs and the playground, so run `npm run cookbook:check` and `npm run docs:check` afterwards. If a recording differs, decide whether the engine changed on purpose; if so, `npm run cookbook:record` and `npm run docs:record`, and review the diffs. `install.sh`, `releases.json` and `extensions.json` (+ `.sig`) are signed or generated upstream: the deploys fetch them from upstream's release assets (`scripts/fetch-discovery.sh`, no review; the checked-in copies are seed files); never hand-edit them. See `runbooks/release-discovery.md`. The samples environment and the CLI recordings follow the same pin (§1 "Upstream"); after a full samples replay, rewrite `_data/samples.json` with the commits and toolchain it ran on.

## 5. CI and deploys

Operating and debugging: `runbooks/` (start at `runbooks/README.md`: the site is wrong or down, a deploy failed, rollback, DNS and hosts, the WASM demo, the docs MCP Worker, release discovery).

- `cookbook.yml` runs on every pull request and push to `main` (no paths filter, so it can be a required check): cookbook, docs and Worker unit tests, `adr:check`, `docs:check`, `docs:lint`, `cookbook:check`, `astro check`, `check:playground`, build, `docs:check -- --built`, the Worker's bundle step and then its tsc (it imports the generated bundle), `cookbook:browser`. CI runs Node 24; regenerate a lockfile with the npm that ships with it when `npm ci` refuses one.
- Not required because of its paths filter (`workers/docs-mcp`, `functions`, the two check scripts, the docs and cookbook sources and pages, `src/layouts`, `public/wasm`, the skill, `releases.json`, the root package files), and needing no secret: `docs-mcp.yml` (build, `docs:mcp-check`, `docs:negotiation-check`).
- Not required, and needing a binary, clients or a token: `docs-cli-check.yml` and `docs-samples.yml` (weekly and by hand) and `engine-release.yml` (on a `cli` `relate-release` dispatch; opens a reviewed docs refresh pull request that does not gate the discovery files). Not required, spending the operator's model account: `docs-evals.yml` (by hand, or on a `relate-release` dispatch once the repository variables `DOCS_EVALS_AGENT_PACKAGE` and `DOCS_EVALS_HARNESS` are set; the agent job has read-only permission and no stored credential, and a second job opens the scores pull request).
- Deploys: `deploy-pages.yml` (GitHub Pages, the interim host) and `deploy-cf.yml` (Cloudflare Pages, needs secrets) both run `npm ci`, `npm ci --prefix playground`, `npm run cookbook:check` and `npm run build`, and publish `dist/` (on Cloudflare, with the Pages Function in `functions/`). `deploy-cf.yml` also runs `docs:negotiation-check` before `pages deploy` (wrangler pinned to 4.158.0) and, on pushes to `main` only, bundles, checks and deploys the Worker after the site (a Worker route has no preview).

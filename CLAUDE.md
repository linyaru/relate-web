# CLAUDE.md

Public website for **relate** (formerly *cypherlite*) at `relatedb.ai`. Pre-launch / stealth: nothing is published yet, so package names, release URLs and install URLs on the site are launch-day targets and will 404 until launch. See [LAUNCH.md](LAUNCH.md).

[AGENTS.md](AGENTS.md) is the agent contract for every change; its first rule is the decision log: anything about hosting, build tooling, content architecture, agent-facing surfaces, the design system, or the style guide gets an ADR in `docs/adr/` (format and the ADR-worthy test in `docs/adr/README.md`; `npm run adr:check` enforces the shape). The docs plan and style guide are in [DOCS-PLAN.md](DOCS-PLAN.md).

## Layout

Astro (static output) site. Migration from the old single-file page is in progress on branch `astro-migration`:

- `src/legacy/index.html` — the original whole-page markup (inline CSS/JS). `src/pages/index.astro` currently renders it unchanged; extract sections into components (layout, section components, JS modules, global CSS) incrementally, then delete the legacy file
- `src/components/Header.astro` — the one top bar used on every page (nav links, theme toggle, mobile menu + their JS); edit nav items there. `src/styles/base.css` — shared fonts, design tokens, reset, top-nav styles. `src/layouts/Base.astro` is the shell for section pages (`/docs`, `/blog`); `Placeholder.astro` wraps it for coming-soon pages. The home page injects `Header` at the `<!--SITE-HEADER-->` marker in the legacy markup
- Brand assets (source: the shared "Relate Brand Board" artifact, which generates them from pixel grids): `public/favicon.svg` (+ `favicon-32.png`, `favicon-192.png`), `public/brand/` (logomark in shaded dark/light, black, white; alternate favicon grounds). The top-bar logomark is inlined in `Header.astro` and shaded via CSS vars in `base.css`. `public/img/favicon.png` is the old icon and is now unused
- Colors: `src/styles/base.css` holds the Night/Day tokens, taken from the "Relate by ABK" design-system artifact (`project/tokens.json`; token names are in the comments). Day is the default; Night via `data-theme="dark"` or `prefers-color-scheme`. Code/terminal blocks stay dark in both. Use the tokens (`--bg`, `--fg`, `--accent`, `--on-accent`, …), never hard-coded hex
- `public/` — copied to `dist/` as-is: `llms.txt`, `robots.txt`, `install.sh`, `releases.json`, `extensions.json` (+ `.sig`), `.nojekyll`, `CNAME`, `fonts/`, `img/`, `wasm/`
  - `install.sh`, `releases.json`, `extensions.json` are synced from upstream; do not hand-edit (signed/generated)
  - `wasm/` is a copy of upstream `surfaces/relate-wasm/pkg/` (`relate.js`, `relate_bg.wasm`, `opfs.js`, `trap.js`, `snippets/`). Keep it in `public/` so Vite never bundles or rewrites it
- `src/content/cookbook/` — the cookbook recipes; this repo is their source (moved from upstream `docs/cookbook`, which is no longer synced). One markdown file per recipe; `README.md` there is the authoring contract (its index section is generated). `diagrams/` holds the pre-rendered diagram SVGs (light + dark) and label colours, drawn by `scripts/diagrams/render.mjs` (the shared docs + cookbook renderer, an authoring-only package with its own `package.json`: mermaid + puppeteer-core; CI never installs it; every mermaid block needs `accTitle:` and an `accDescr { }` block) in the site's colours, which `src/lib/cookbook/tokens.ts` and `diagram-theme.ts` read from `base.css`; data models are laid out by `src/lib/cookbook/schema-*.ts`. Re-render with `--force` after changing colour tokens. `src/lib/cookbook/` is the parser, validator and runner, ported from upstream's Rust `relate-cookbook` harness, plus the page rendering (`site.ts` replays every recipe once per build and fails it on any drift, stale diagram, or invalid recipe; `render.ts`/`markdown.ts` turn a recipe into HTML); `scripts/cookbook.ts` is the check/record command
- Cookbook pages: `src/pages/cookbook/` (index, `[slug]/index.astro`, and the `[slug]/index.md`, `results.json`, `recipe.json`, `data/<name>.json` and `cookbook/llms.txt` endpoints; `recipe.json` is format 1 of the playground hand-off, each cell titled by the heading it sits under (`cellTitles` in `recipe.ts`), which the playground's sample-query list uses once a recipe is loaded, and each step, the engine bar, and the header on a recipe page link `/playground/#recipe=<slug>[&cell=<id>]` via `playgroundHref` in `render.ts`) on `src/layouts/Cookbook.astro`, styled by `src/styles/cookbook.css`. Pages are complete without JavaScript (every step shows its recorded result); `src/scripts/cookbook/session.ts` makes steps runnable (Run, Edit, Run all, Reset, Stop, parameters, JSON view) on a module worker (`worker.ts`) that loads the engine from `/wasm/` at runtime, so Vite never bundles it; `src/scripts/cookbook/runtime.ts` starts it on recipe pages and `src/scripts/docs/runtime.ts` on docs pages with cells. Graph (gram) results open in an NVL graph view (`graph.ts`, pinned to 1.2.2, loaded only when one comes into view; `astro.config.mjs` aliases its Segment telemetry to an empty module, so none ships). `graph-model.ts` and `palette.ts` are shared with the check, which expands the first node of every graph result. `src/lib/cookbook/result-view.ts`, `cells.ts`, `graph-model.ts` and `palette.ts` are shared with the runtime, so keep them free of Node imports. Canonical URLs use `CANONICAL_ORIGIN` (`relatedb.ai`) like the home page; `NOT_PUBLIC_YET` in `links.ts` turns pre-launch links into text
- Docs: `src/content/docs/` (pages, `_glossary/`, `_data/` facts files; `README.md` there is the authoring contract), rendered by `src/lib/docs/` (twins, llms indexes, generated reference pages in `generated/`, checks in `checks/`) and `src/components/docs/`, served by `src/pages/docs/`. `src/lib/docs/graph.ts` builds the docs graph served as `/docs/graph.cypher`, `/docs/graph.json` and per page `/docs/<id>.graph.md`; `/docs/docs-artifacts.json` lists every agent artifact with its SHA-256 (signed at launch). The agent skill is `public/skills/relate/` (copied from upstream by `npm run skill:sync`; do not hand-edit) with `public/skill.md` as its human and agent entry point, and `src/pages/.well-known/` serves the discovery indexes (`agent-skills/index.json`, `skills/index.json`)
- `src/pages/sitemap.xml.ts` generates the sitemap (home, cookbook, every recipe, every docs page)
- `functions/` — Cloudflare Pages Functions, compiled by `wrangler pages deploy dist` from the repo root (wrangler looks for `<cwd>/functions`). `functions/docs/_middleware.ts` does the docs content negotiation (`Accept: text/markdown` → the twin; `?section=<anchor>` → one section) using `src/lib/docs/negotiation.ts`; `functions/_middleware.ts` logs fetches of the twins, `llms.txt` and the skill, and `public/_routes.json` limits the paths that invoke a function at all. Keep no `package.json` or `node_modules` in `functions/`: wrangler runs esbuild on every `.js`/`.ts` file under it. GitHub Pages, the interim host, does not run it
- `playground/` — the full-screen playground SPA served at `/playground/` (moved from upstream `examples/wasm-playground/`). Its **own package** (Vite 5, React 19, TS 5, Neo4j Needle, NVL, CodeMirror) with its own `package.json`/lockfile and build tuning in `vite.config.ts`; the root `tsconfig.json` excludes it. Install with `npm ci --prefix playground`. It does not bundle the engine: its worker loads `/wasm/relate.js` at runtime (types from `public/wasm/relate.d.ts`), and the `site-wasm` plugin serves `public/wasm/` to its dev server. The cookbook hand-off (`#recipe=<slug>[&cell=<id>]`) imports `src/lib/cookbook/cells.ts`. See `playground/README.md`
- `workers/docs-mcp/` — the hosted docs MCP server, a Cloudflare Worker for `https://relatedb.ai/mcp` (DOCS-PLAN §3.7–3.8, ADR-0012). Its **own package** (the Agents SDK's `createMcpHandler` over `@modelcontextprotocol/server` v2, wrangler 4) with its own lockfile and tsconfig; the root `tsconfig.json` excludes `workers/`. Install with `npm ci --prefix workers/docs-mcp`. `npm run mcp:bundle` (after `npm run build`) writes its gitignored `generated/` from `dist/` (twins with section offsets, errors, skill, releases, the graph seed, a copy of `public/wasm`); `npm run mcp:dev` serves it on 127.0.0.1:8787 under `wrangler dev`, no login. Three tools (`search_docs`, `get_page`, `explain_error`), the resources and the `onboard` prompt; `get_page` cuts a section with `src/lib/docs/negotiation.ts`, the same code as `?section=`. See its README
- `astro.config.mjs` — `site` is the interim preview host; change to `https://relatedb.ai` at launch
- `MAINTAINING.md` — standing contract for the site (tone, invariants, facts and sources). Its "no build step / single page" statements predate the Astro migration; everything else still applies
- `LAUNCH.md` — pre-launch notes, target names, launch-day sanity checks
- `PLAN.md`, `WEBSITE-PLAN.md` — historical (cypherlite era); don't extend

## Commands

```bash
npm install && npm ci --prefix playground && npm ci --prefix workers/docs-mcp
npm run dev       # http://127.0.0.1:8765 (launch config `relate-web`)
npm run dev:playground   # the playground's own dev server, http://localhost:5173/playground/
npm run mcp:bundle       # after a build: dist/ -> workers/docs-mcp/generated/ (fails when a twin and the docs graph disagree about a section)
npm run mcp:dev          # the docs MCP Worker under wrangler dev, http://127.0.0.1:8787/mcp (no login)
npm run mcp:test         # the Worker's unit tests and tsc
npm run build     # -> dist/ (astro build, then the playground into dist/playground/)
npm run check:playground # tsc for playground/
npm run check     # astro check
npm run cookbook:check    # every recipe runs on public/wasm and matches its recorded results
npm run cookbook:record   # rewrite result blocks + README index from a run; review the diff
npm run cookbook:test     # unit tests for src/lib/cookbook
npm run cookbook:browser  # after a build, in headless Chrome: every recipe runs and matches, the playground loads and double-click expands a node, every recipe opens in the playground (needs Chrome; CHROME_PATH)
npm run cookbook:diagrams # after `npm ci --prefix scripts/diagrams`: render changed cookbook diagrams (`-- --force` for all; needs Chrome)
npm run docs:diagrams     # same renderer for src/content/docs pages
npm run docs:check        # docs section: frontmatter, links, words, twins, trust and diagram checks (`-- --built` adds the dist/ checks)
npm run docs:lint         # Vale on the docs prose (needs `vale`; CI pins 3.25.1)
npm run docs:test         # unit tests for src/lib/docs
npm run adr:check         # docs/adr/: unique sequential numbers, header and section order, line ceiling, public-record patterns, README index
npm run docs:check        # the docs' source checks (-- --built after a build adds the dist/ checks); see src/content/docs/README.md "Checks"
npm run docs:test         # unit tests for src/lib/docs (UPDATE=1 re-pins _example/example.twin.md)
npm run docs:record       # rewrite docs pages' cell results sidecars and static graph SVGs from a run on public/wasm; review the diff
RELATE_BIN=<path to relate> DO_NOT_TRACK=1 npm run docs:cli-check   # replay _data/ CLI recordings and `bash verify` fences (-- --record rewrites); skipped without a binary
RELATE_BIN=<path to relate> npm run docs:graph   # docs graph seed → dist/docs/relate-docs.rl (+ .sha256, relate-docs.json); without RELATE_BIN it only times the WASM replay
npm run docs:mcp-check    # after a build and `npm ci --prefix workers/docs-mcp`: the docs MCP Worker under wrangler dev on a free port from 8800: tools, resources, prompt, byte-for-byte twins and sections, errors.json lookups, refusals, CORS, rate limit and cost budget with Retry-After, a log with no query text (`-- --coldstart 5` times five cold starts); skipped without dist/
npm run docs:negotiation-check  # after a build: the Pages Function on `wrangler pages dev dist` (npx wrangler@4.158.0, local, no login): markdown negotiation, ?section=, pass-through (skipped without dist/)
npm run docs:samples      # run ```python run / ```js run samples (needs the env from `bash scripts/samples/setup.sh --upstream <checkout>`; -- --record rewrites; DOCS_EXAMPLES=1 includes the example page)
npm run skill:sync        # copy upstream's skill bundle into public/skills/relate/, record the commit in src/content/docs/_data/skill.json
```

The cookbook tooling runs `.ts` directly on Node ≥ 22.18 (type stripping), so keep `src/lib/cookbook/` to erasable TypeScript (no enums, namespaces or parameter properties) and import with `.ts` extensions. `COOKBOOK_ONLY=<slug>[,…]` limits a check or record run.

Refresh the WASM from the upstream checkout (`~/Developer/neo4j-labs/cypherlite`, toolchain pinned to 1.88.0, needs the `wasm32-unknown-unknown` target):

```bash
cd ~/Developer/neo4j-labs/cypherlite && bash scripts/build-wasm.sh --mode release
# then copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into public/wasm/
# then `npm run skill:sync` (copies upstream's skill bundle into public/skills/relate/ and records the commit in src/content/docs/_data/skill.json; review the diff)
```

After refreshing the WASM (it serves the home page console, the cookbook, and the playground), run `npm run cookbook:check`. If it fails, decide whether the engine changed on purpose; if so, run `npm run cookbook:record` and review the diff.

Deploys: `.github/workflows/deploy-pages.yml` (GitHub Pages) and `deploy-cf.yml` (Cloudflare Pages, needs secrets) both run `npm ci`, `npm ci --prefix playground`, `npm run cookbook:check` and `npm run build`, and publish `dist/` (on Cloudflare, with the Pages Function in `functions/`). `deploy-cf.yml` also runs `docs:negotiation-check` before `pages deploy` (wrangler pinned to 4.158.0). On pushes to main only, it then runs `npm ci` and `npm run bundle` in `workers/docs-mcp`, `node scripts/docs-mcp-check.ts`, and `wrangler deploy`: the site first, then the Worker (a Worker route has no preview). CI: `cookbook.yml` runs on every PR and push to `main` (no paths filter, so it can be a required check): cookbook, docs and docs MCP Worker unit tests, `adr:check`, `docs:check`, `docs:lint`, `cookbook:check`, `astro check`, `check:playground`, build, `docs:check -- --built`, the Worker's bundle step and then its tsc (it imports the generated bundle), `cookbook:browser`. Not required, and needing a binary, clients or a token: `docs-cli-check.yml` and `docs-samples.yml` (weekly and by hand) and `engine-release.yml` (on a `relate-release` dispatch; opens a refresh pull request). Not required because of its paths filter (`workers/docs-mcp`, `functions`, the two check scripts, `src/content/docs`, `src/lib/docs`, `src/pages/docs`, `src/components/docs`, `src/layouts`, `public/wasm`, the skill, `releases.json`, the root package files), and needing no secret: `docs-mcp.yml` (build, `docs:mcp-check`, `docs:negotiation-check`).

## Conventions

- Name is `relate` everywhere on the page. Target package names: Python `relate-db`, npm `@relate/relate` and `@relate/relate-wasm`, Java `com.relate:relate`, Go `github.com/relatedb/relate/clients/go`, binaries `relate-<os>-<arch>`.
- Some `cypherlite` strings intentionally remain until upstream artifacts are regenerated (old URLs, release asset names in `releases.json`, `install.sh`). Check `git grep -i cypherlite` before assuming a leftover is a bug.
- The demo imports `./wasm/relate.js` and constructs `RelateDb`; keep these in sync with the files in `wasm/`.
- Only substantiated claims on the page; follow the tone contract in `MAINTAINING.md`.
- Keep behavior identical while porting (sections, ids, anchors, the lazy-loaded WASM console); redesign and branding come after the faithful port.

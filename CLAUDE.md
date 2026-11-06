# CLAUDE.md

Public website for **relate** (formerly *cypherlite*) at `relatedb.ai`. Pre-launch / stealth: nothing is published yet, so package names, release URLs and install URLs on the site are launch-day targets and will 404 until launch. See [LAUNCH.md](LAUNCH.md).

## Layout

Astro (static output) site. Migration from the old single-file page is in progress on branch `astro-migration`:

- `src/legacy/index.html` — the original whole-page markup (inline CSS/JS). `src/pages/index.astro` currently renders it unchanged; extract sections into components (layout, section components, JS modules, global CSS) incrementally, then delete the legacy file
- `src/components/Header.astro` — the one top bar used on every page (nav links, theme toggle, mobile menu + their JS); edit nav items there. `src/styles/base.css` — shared fonts, design tokens, reset, top-nav styles. `src/layouts/Base.astro` is the shell for section pages (`/docs`, `/blog`); `Placeholder.astro` wraps it for coming-soon pages. The home page injects `Header` at the `<!--SITE-HEADER-->` marker in the legacy markup
- Brand assets (source: the shared "Relate Brand Board" artifact, which generates them from pixel grids): `public/favicon.svg` (+ `favicon-32.png`, `favicon-192.png`), `public/brand/` (logomark in shaded dark/light, black, white; alternate favicon grounds). The top-bar logomark is inlined in `Header.astro` and shaded via CSS vars in `base.css`. `public/img/favicon.png` is the old icon and is now unused
- Colors: `src/styles/base.css` holds the Night/Day tokens, taken from the "Relate by ABK" design-system artifact (`project/tokens.json`; token names are in the comments). Day is the default; Night via `data-theme="dark"` or `prefers-color-scheme`. Code/terminal blocks stay dark in both. Use the tokens (`--bg`, `--fg`, `--accent`, `--on-accent`, …), never hard-coded hex
- `public/` — copied to `dist/` as-is: `llms.txt`, `robots.txt`, `install.sh`, `releases.json`, `extensions.json` (+ `.sig`), `.nojekyll`, `CNAME`, `fonts/`, `img/`, `wasm/`
  - `install.sh`, `releases.json`, `extensions.json` are synced from upstream; do not hand-edit (signed/generated)
  - `wasm/` is a copy of upstream `surfaces/relate-wasm/pkg/` (`relate.js`, `relate_bg.wasm`, `opfs.js`, `trap.js`, `snippets/`). Keep it in `public/` so Vite never bundles or rewrites it
- `src/content/cookbook/` — the cookbook recipes; this repo is their source (moved from upstream `docs/cookbook`, which is no longer synced). One markdown file per recipe; `README.md` there is the authoring contract (its index section is generated). `diagrams/` holds the pre-rendered diagram SVGs (light + dark) and label colours, drawn by `scripts/cookbook-diagrams/render.mjs` (an authoring-only package with its own `package.json`: mermaid + puppeteer-core; CI never installs it) in the site's colours, which `src/lib/cookbook/tokens.ts` and `diagram-theme.ts` read from `base.css`; data models are laid out by `src/lib/cookbook/schema-*.ts`. Re-render with `--force` after changing colour tokens. `src/lib/cookbook/` is the parser, validator and runner, ported from upstream's Rust `relate-cookbook` harness, plus the page rendering (`site.ts` replays every recipe once per build and fails it on any drift, stale diagram, or invalid recipe; `render.ts`/`markdown.ts` turn a recipe into HTML); `scripts/cookbook.ts` is the check/record command
- Cookbook pages: `src/pages/cookbook/` (index, `[slug]/index.astro`, and the `[slug]/index.md`, `results.json`, `recipe.json`, `data/<name>.json` and `cookbook/llms.txt` endpoints; `recipe.json` is format 1 of the playground hand-off, and each step, the engine bar, and the header on a recipe page link `/playground/#recipe=<slug>[&cell=<id>]` via `playgroundHref` in `render.ts`) on `src/layouts/Cookbook.astro`, styled by `src/styles/cookbook.css`. Pages are complete without JavaScript (every step shows its recorded result); `src/scripts/cookbook/runtime.ts` makes steps runnable (Run, Edit, Run all, Reset, Stop, parameters, JSON view) on a module worker (`worker.ts`) that loads the engine from `/wasm/` at runtime, so Vite never bundles it. Graph (gram) results open in an NVL graph view (`graph.ts`, pinned to 1.2.2, loaded only when one comes into view; `astro.config.mjs` aliases its Segment telemetry to an empty module, so none ships). `graph-model.ts` and `palette.ts` are shared with the check, which expands the first node of every graph result. `src/lib/cookbook/result-view.ts`, `cells.ts`, `graph-model.ts` and `palette.ts` are shared with the runtime, so keep them free of Node imports. Canonical URLs use `CANONICAL_ORIGIN` (`relatedb.ai`) like the home page; `NOT_PUBLIC_YET` in `links.ts` turns pre-launch links into text
- `src/pages/sitemap.xml.ts` generates the sitemap (home, cookbook, every recipe)
- `playground/` — the full-screen playground SPA served at `/playground/` (moved from upstream `examples/wasm-playground/`). Its **own package** (Vite 5, React 19, TS 5, Neo4j Needle, NVL, CodeMirror) with its own `package.json`/lockfile and build tuning in `vite.config.ts`; the root `tsconfig.json` excludes it. Install with `npm ci --prefix playground`. It does not bundle the engine: its worker loads `/wasm/relate.js` at runtime (types from `public/wasm/relate.d.ts`), and the `site-wasm` plugin serves `public/wasm/` to its dev server. The cookbook hand-off (`#recipe=<slug>[&cell=<id>]`) imports `src/lib/cookbook/cells.ts`. See `playground/README.md`
- `astro.config.mjs` — `site` is the interim preview host; change to `https://relatedb.ai` at launch
- `MAINTAINING.md` — standing contract for the site (tone, invariants, facts and sources). Its "no build step / single page" statements predate the Astro migration; everything else still applies
- `LAUNCH.md` — pre-launch notes, target names, launch-day sanity checks
- `PLAN.md`, `WEBSITE-PLAN.md` — historical (cypherlite era); don't extend

## Commands

```bash
npm install && npm ci --prefix playground
npm run dev       # http://127.0.0.1:8765 (launch config `relate-web`)
npm run dev:playground   # the playground's own dev server, http://localhost:5173/playground/
npm run build     # -> dist/ (astro build, then the playground into dist/playground/)
npm run check:playground # tsc for playground/
npm run check     # astro check
npm run cookbook:check    # every recipe runs on public/wasm and matches its recorded results
npm run cookbook:record   # rewrite result blocks + README index from a run; review the diff
npm run cookbook:test     # unit tests for src/lib/cookbook
npm run cookbook:browser  # after a build, in headless Chrome: every recipe runs and matches, the playground loads, every recipe opens in the playground (needs Chrome; CHROME_PATH)
npm run cookbook:diagrams # after `npm ci --prefix scripts/cookbook-diagrams`: render changed diagrams (`-- --force` for all; needs Chrome)
```

The cookbook tooling runs `.ts` directly on Node ≥ 22.18 (type stripping), so keep `src/lib/cookbook/` to erasable TypeScript (no enums, namespaces or parameter properties) and import with `.ts` extensions. `COOKBOOK_ONLY=<slug>[,…]` limits a check or record run.

Refresh the WASM from the upstream checkout (`~/Developer/neo4j-labs/cypherlite`, toolchain pinned to 1.88.0, needs the `wasm32-unknown-unknown` target):

```bash
cd ~/Developer/neo4j-labs/cypherlite && bash scripts/build-wasm.sh --mode release
# then copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into public/wasm/
```

After refreshing the WASM (it serves the home page console, the cookbook, and the playground), run `npm run cookbook:check`. If it fails, decide whether the engine changed on purpose; if so, run `npm run cookbook:record` and review the diff.

Deploys: `.github/workflows/deploy-pages.yml` (GitHub Pages) and `deploy-cf.yml` (Cloudflare Pages, needs secrets) both run `npm ci`, `npm ci --prefix playground`, `npm run cookbook:check` and `npm run build`, and publish `dist/`. CI: `cookbook.yml` runs on every PR and push to `main` (no paths filter, so it can be a required check): cookbook unit tests, `cookbook:check`, `astro check`, `check:playground`, build, `cookbook:browser`.

## Conventions

- Name is `relate` everywhere on the page. Target package names: Python `relate-db`, npm `@relate/relate` and `@relate/relate-wasm`, Java `com.relate:relate`, Go `github.com/relatedb/relate/clients/go`, binaries `relate-<os>-<arch>`.
- Some `cypherlite` strings intentionally remain until upstream artifacts are regenerated (old URLs, release asset names in `releases.json`, `install.sh`). Check `git grep -i cypherlite` before assuming a leftover is a bug.
- The demo imports `./wasm/relate.js` and constructs `RelateDb`; keep these in sync with the files in `wasm/`.
- Only substantiated claims on the page; follow the tone contract in `MAINTAINING.md`.
- Keep behavior identical while porting (sections, ids, anchors, the lazy-loaded WASM console); redesign and branding come after the faithful port.

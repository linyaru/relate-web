# CLAUDE.md

Public website for **relate** (formerly *cypherlite*) at `relatedb.ai`. Pre-launch / stealth: nothing is published yet, so package names, release URLs and install URLs on the site are launch-day targets and will 404 until launch. See [LAUNCH.md](LAUNCH.md).

## Layout

Astro (static output) site. Migration from the old single-file page is in progress on branch `astro-migration`:

- `src/legacy/index.html` — the original whole-page markup (inline CSS/JS). `src/pages/index.astro` currently renders it unchanged; extract sections into components (layout, section components, JS modules, global CSS) incrementally, then delete the legacy file
- `src/components/Header.astro` — the one top bar used on every page (nav links, theme toggle, mobile menu + their JS); edit nav items there. `src/styles/base.css` — shared fonts, design tokens, reset, top-nav styles. `src/layouts/Base.astro` is the shell for section pages (`/docs`, `/blog`); `Placeholder.astro` wraps it for coming-soon pages. The home page injects `Header` at the `<!--SITE-HEADER-->` marker in the legacy markup
- Brand assets (source: the shared "Relate Brand Board" artifact, which generates them from pixel grids): `public/favicon.svg` (+ `favicon-32.png`, `favicon-192.png`), `public/brand/` (logomark in shaded dark/light, black, white; alternate favicon grounds). The top-bar logomark is inlined in `Header.astro` and shaded via CSS vars in `base.css`. `public/img/favicon.png` is the old icon and is now unused
- Colors: `src/styles/base.css` holds the Night/Day tokens, taken from the "Relate by ABK" design-system artifact (`project/tokens.json`; token names are in the comments). Day is the default; Night via `data-theme="dark"` or `prefers-color-scheme`. Code/terminal blocks stay dark in both. Use the tokens (`--bg`, `--fg`, `--accent`, `--on-accent`, …), never hard-coded hex
- `public/` — copied to `dist/` as-is: `llms.txt`, `robots.txt`, `sitemap.xml`, `install.sh`, `releases.json`, `extensions.json` (+ `.sig`), `.nojekyll`, `CNAME`, `fonts/`, `img/`, `wasm/`
  - `install.sh`, `releases.json`, `extensions.json` are synced from upstream; do not hand-edit (signed/generated)
  - `wasm/` is a copy of upstream `surfaces/relate-wasm/pkg/` (`relate.js`, `relate_bg.wasm`, `opfs.js`, `trap.js`, `snippets/`). Keep it in `public/` so Vite never bundles or rewrites it
- `astro.config.mjs` — `site` is the interim preview host; change to `https://relatedb.ai` at launch
- `MAINTAINING.md` — standing contract for the site (tone, invariants, facts and sources). Its "no build step / single page" statements predate the Astro migration; everything else still applies
- `LAUNCH.md` — pre-launch notes, target names, launch-day sanity checks
- `PLAN.md`, `WEBSITE-PLAN.md` — historical (cypherlite era); don't extend

## Commands

```bash
npm install
npm run dev       # http://127.0.0.1:8765 (launch config `relate-web`)
npm run build     # -> dist/
npm run check     # astro check
```

Refresh the WASM from the upstream checkout (`~/Developer/neo4j-labs/cypherlite`, toolchain pinned to 1.88.0, needs the `wasm32-unknown-unknown` target):

```bash
cd ~/Developer/neo4j-labs/cypherlite && bash scripts/build-wasm.sh --mode release
# then copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into public/wasm/
```

Deploys: `.github/workflows/deploy-pages.yml` (GitHub Pages) and `deploy-cf.yml` (Cloudflare Pages, needs secrets) both run `npm ci && npm run build` and publish `dist/`.

## Conventions

- Name is `relate` everywhere on the page. Target package names: Python `relate-db`, npm `@relate/relate` and `@relate/relate-wasm`, Java `com.relate:relate`, Go `github.com/relatedb/relate/clients/go`, binaries `relate-<os>-<arch>`.
- Some `cypherlite` strings intentionally remain until upstream artifacts are regenerated (old URLs, release asset names in `releases.json`, `install.sh`). Check `git grep -i cypherlite` before assuming a leftover is a bug.
- The demo imports `./wasm/relate.js` and constructs `RelateDb`; keep these in sync with the files in `wasm/`.
- Only substantiated claims on the page; follow the tone contract in `MAINTAINING.md`.
- Keep behavior identical while porting (sections, ids, anchors, the lazy-loaded WASM console); redesign and branding come after the faithful port.

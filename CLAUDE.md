# CLAUDE.md

Public website for **relate** (formerly *cypherlite*) at `relatedb.ai`. Pre-launch / stealth: nothing is published yet, so package names, release URLs and install URLs on the site are launch-day targets and will 404 until launch. See [LAUNCH.md](LAUNCH.md).

## Layout

Single static page, no build step, no framework. Deployed files are served from the repo root:

- `index.html` — the whole site (inline CSS/JS, Public Sans + Fira Code in `fonts/`, light/dark theme, cli|agentic toggle, live WASM demo)
- `llms.txt` — agent-facing description; keep consistent with `index.html`
- `install.sh`, `releases.json`, `extensions.json` (+ `.sig`) — release/install artifacts synced from upstream; do not hand-edit (signed/generated)
- `wasm/` — copy of upstream `surfaces/relate-wasm/pkg/` (`relate.js`, `relate_bg.wasm`, `opfs.js`, `trap.js`, `snippets/`)
- `MAINTAINING.md` — standing contract for the site (tone, invariants, facts and sources). Read before changing content
- `LAUNCH.md` — pre-launch notes, target names, launch-day sanity checks
- `PLAN.md`, `WEBSITE-PLAN.md` — historical (cypherlite era); don't extend

## Commands

Preview locally (launch config `relate-web`, port 8765):

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Opening via `file://` breaks the WASM demo (dynamic import is blocked); always serve over HTTP.

Refresh the WASM from the upstream checkout (`~/Developer/neo4j-labs/cypherlite`, toolchain pinned to 1.88.0, needs the `wasm32-unknown-unknown` target):

```bash
cd ~/Developer/neo4j-labs/cypherlite && bash scripts/build-wasm.sh --mode release
# then copy surfaces/relate-wasm/pkg/{relate.js,relate.d.ts,relate_bg.wasm,relate_bg.wasm.d.ts,opfs.js,trap.js,snippets} into wasm/
```

## Conventions

- Name is `relate` everywhere on the page. Target package names: Python `relate-db`, npm `@relate/relate` and `@relate/relate-wasm`, Java `com.relate:relate`, Go `github.com/relatedb/relate/clients/go`, binaries `relate-<os>-<arch>`.
- Some `cypherlite` strings intentionally remain until upstream artifacts are regenerated (old URLs, release asset names in `releases.json`, `install.sh`). Check `git grep -i cypherlite` before assuming a leftover is a bug.
- The demo imports `./wasm/relate.js` and constructs `RelateDb`; keep these in sync with the files in `wasm/`.
- Only substantiated claims on the page; follow the tone contract in `MAINTAINING.md`.
- Don't add a build step or framework.

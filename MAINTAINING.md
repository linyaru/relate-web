# Maintaining the relate website

This is the contract for anyone — human or agent — updating
`relatedb.ai`. Read it before every change.

## What this site is

A single static page (`index.html`, no build step, no framework) in the
neo4j-cli design system: Public Sans + Fira Code, light/dark theme, sticky
nav, copy-to-clipboard, and a global `cli | agentic` view toggle (agentic is
the default). Plus `llms.txt` for AI agents, `install.sh` (the documented
install entry point — never delete or rewrite it by hand; it is preserved by
the docs deploy workflow), `fonts/`, `robots.txt`, `sitemap.xml`.

The playground SPA lives at `/playground/` and is built from this
repository's `playground/` directory (its own package; see
`playground/README.md`) by `npm run build`, into `dist/playground/`.

## How the site is deployed

`.github/workflows/deploy-pages.yml` (on `main`) assembles the live site
from two sources — this `gh-pages` branch as the base tree, and the
playground `dist/` layered under `playground/` — then publishes via
`actions/deploy-pages`. Triggers:

- pushes to `main` (playground / wasm changes rebuild the site);
- completion of `update-website.yml` (picks up the auto-updater's
  push to this branch);
- manual `workflow_dispatch` from the Actions tab (for hand-edits to
  this branch — direct pushes here do **not** auto-trigger, because
  the workflow file lives on `main`).

Repo Settings → Pages → Source must be **GitHub Actions** for the
workflow's deploy to be live; until then it builds but does not
publish.

Page structure, top to bottom:

| Section | id | Contents |
|---|---|---|
| Hero | — | version pill, outcome-led tagline, substantiation badges (TCK 100% + live-demo link to `#console`), OS install tabs (macOS/Linux/Windows/Python) |
| Memory console | `#console` | live in-browser Relate (WASM), seeded with a 5-person social graph, three clickable query suggestions, user types + submits; lazy-loaded on first click/focus — keep it above the fold |
| Quickstart | `#quickstart` | 4 steps: skill, database format, create (typed params / LOAD CSV / pipe / `pull` from Neo4j/Aura), query; the format toggle rewrites the db argument in steps 3-4 |
| Examples | `#examples` | 5 panes mirroring the quickstart: `install`, `skill`, `database`, `create`, `query` (tab ids `data-tab`/`data-pane`) |
| Reference | `#reference` | concise tabs: `cli`, `dot`, `output`, `cypher`, `vector`, `spatial`, `storage`, `clients`, `fit` (`data-ref-tab`/`data-ref-pane`). The `fit` tab is a positively-framed "Where Relate fits" block — good fits plus a one-line shape note on the single-process, memory-resident model. |

## What must never change

- The design system: CSS tokens, fonts, layout, tone. No framework, no build
  step, no extra pages without a decision on `main`.
- The `cli | agentic` toggle behaviour and the four agentic invariants
  (below).
- `install.sh` is owned by the release pipeline, not by site edits.
- `wasm/` (`relate.js`, `relate.d.ts`, `relate_bg.wasm`,
  `relate_bg.wasm.d.ts`) is owned by the build pipeline. To refresh
  it, run `bash scripts/build-wasm.sh --mode release` on `main` and copy
  the four files out of `crates/relate-wasm/pkg/` into `wasm/`. Never
  hand-edit these files.
- The `#console` live console stays. It is a scenario workbench with
  three tabs — `agent-memory`, `codebase`, `deps` — defined by the
  `SCENARIOS` object in `index.html`. Each scenario carries its own
  seed statements and 4–5 demo queries that correspond to a cookbook
  recipe on `main`. Switching scenario drops the current in-memory db
  and reboots cleanly; the Reset (↺) button in the console header does
  the same for the active scenario. Changes to scenario data or demo
  queries go in the same pass as this file.
- Console suggestions **click-to-run**. The scenarios exist to show
  Relate solving a real problem, so a single click on a suggestion
  pill both populates the input and executes the query. Arrow-up still
  browses history; nothing auto-types or auto-cycles.
- The top-nav `Playground` link stays as the **last** item in
  `#topNav` (after `GitHub`), with `href="/playground/"`,
  `target="_blank"`, `class="nav-external"`, and the inline `.ext-icon`
  SVG: the playground is a full-screen app that opens in its own tab.
  It points at the playground SPA this site builds from `playground/`.
  Never rewrite the href, reorder, or drop the icon.
- Tone: concise, friendly, no marketing fluff, no "revolutionary" language.
  Say what the thing does and show a command.

## Version references

`vX.Y.Z` appears in three places in `index.html` (hero pill, install hint,
footer meta). The authoritative source is the latest GitHub release tag.
`llms.txt` carries no version. Update all occurrences together.

## Facts and their sources

| Fact on the page | Authoritative source on `main` |
|---|---|
| Install commands, supported platforms | `README.md`, `install.sh` |
| CLI flags, commands, exit codes, env vars | `docs/api/cli/spec.md` (kept in sync with hand-written `--help`) |
| Dot-commands | `docs/api/cli/spec.md` / `docs/reference/dot-commands.md` |
| Cypher coverage wording | "100% openCypher TCK 2024.3 — 3,892 / 3,892 scenarios pass, strict run in CI" — cite the exact counts, link `docs/tck/compliance.md`. GQL alignment and Cypher 25 feature coverage are claimed on the same evidence standard. |
| "In milliseconds" / latency wording | Backed by the frozen baseline loadtests on `main` (ADR-0046, ADR-0070, ADR-0071, `baselines/`). Any new latency phrasing on the site must trace to that artefact — not to a dev-machine run. |
| Where Relate fits | `docs/guides/storage-engine.md`, ADR-0116 (namespaces), ADR-0119 (admin scope). Frame positively (good fits + a one-line shape note); no bulleted "not for" lists on the site. |
| Vector / spatial APIs | `docs/guides/vector-similarity.md`, `docs/guides/geospatial-queries.md` |
| Storage formats (memory / directory / `.cl`, codecs) | `README.md`, `docs/guides/storage-engine.md` |
| Python API | `README.md`, `docs/reference/python-library.md` |
| Agent names for `skill install` | `README.md` (§ Agent skill) |
| Changelog for release-driven updates | `CHANGELOG.md` |

Only document **shipped** behavior. Nothing from open PRs, unreleased flags,
or plans.

## Tone contract

- **Lede is "the agent-native graph database."** That is the product
  category we claim. The outcome ("make sense of connected data — in
  milliseconds") is the first sentence underneath, not the H1. Cypher,
  embedding, the `.cl` file, and the WAL are proof, not headline.
- **"Agent-native" means something concrete.** Skill install for every
  detected agent, JSON / JSONL / envelope output, typed errors on exit
  code 6, the `pull` command, the `--max-rows` agent default, the
  in-browser demo. Keep the word connected to those features; do not
  use it as a decoration.
- **No marketing fluff.** No "revolutionary", no "fastest", no superlatives.
  Numeric claims (TCK counts, latency) must trace to a current, in-repo
  artefact and link it. "Full" is a reserved word — use it only where
  "100%" is accurate (TCK, GQL alignment, Cypher 25 features).
- **No competitive comparisons on the site.** (For `/docs/` only, ADR-0014 in `docs/adr/` allows a fit page with "use something else when" conditions; it still names no competitor. ADR-0044 removed the performance reference it also allowed: the docs cite no benchmarks.) Positioning memos belong on
  `main`; the homepage is audience content only.

## The four agentic invariants

The page has two `cli | agentic` toggles (`#quickstartSteps`,
`#examplesSection`). In agentic mode (default, no `.cli-mode` class):

1. **Prompt prefix** — every `.agentic-comment` starts with `> ` and renders
   terminal-green; it is the visual hero.
2. **One loading cue** — exactly one
   `<span class="agentic-loading">→ loading skill relate</span>`
   inside the same `.agentic-line`, immediately after the comment. Unicode
   `→`, no ellipsis.
3. **Dim sweep** — the `$` command block under an agent prompt renders in
   `var(--fg-faint)` grey (the `$` included; `.out` blocks, `.agentic-line`
   content, and `.copy-icon` excluded). Blocks **without** an `.agentic-line`
   (quickstart steps 1–2, the memory console) keep full color — the
   `:has(.agentic-line)` qualifier enforces this; never drop it.
4. **Mode-aware copy** — `.step-cmd` and `.copy-mini` copy the agent prompt
   in agentic mode (from the `.agentic-comment` DOM text, `> ` stripped) and
   the CLI payload (`data-copy` / `paneCommands`) in cli mode. Steps without
   an `.agentic-line` fall back to `data-copy` in both modes.

Any change to one toggle must be mirrored on the other in the same pass.
`span.agentic-result` (one-sentence outcome, ≤ ~75 chars, no `>` prefix) may
close a pane.

## llms.txt

`llms.txt` is the agent-facing mirror of the page. Every factual change to
`index.html` is reflected in it in the same change — flags, commands,
defaults, APIs, storage, clients. No version numbers, no numeric TCK/CIP
counts ("full openCypher TCK coverage").

## How updates happen

`.github/workflows/update-website.yml` on `main` (release-published trigger)
runs Claude Code with `.github/prompts/website-update.md`. It scans
`CHANGELOG.md` + commits since `last-sync-sha.txt`, makes surgical updates to
quickstart / install / examples / reference / version references, validates
example commands against the released binary, then commits to `gh-pages` and
advances the sync marker. Humans can also edit `gh-pages` directly for design
work — the agent only makes factual updates.

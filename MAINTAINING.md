# Maintaining the cypherlite website

This is the contract for anyone — human or agent — updating
`neo4j-labs.github.io/cypherlite`. Read it before every change.

## What this site is

A single static page (`index.html`, no build step, no framework) in the
neo4j-cli design system: Public Sans + Fira Code, light/dark theme, sticky
nav, copy-to-clipboard, and a global `cli | agentic` view toggle (agentic is
the default). Plus `llms.txt` for AI agents, `install.sh` (the documented
install entry point — never delete or rewrite it by hand; it is preserved by
the docs deploy workflow), `fonts/`, `robots.txt`, `sitemap.xml`.

Page structure, top to bottom:

| Section | id | Contents |
|---|---|---|
| Hero | — | version pill, tagline, OS install tabs (macOS/Linux/Windows/Python) |
| Memory console | `#console` | **placeholder** for a future live WASM console, directly below the hero — keep it above the fold and keep it until WASM ships |
| Quickstart | `#quickstart` | 4 steps: skill, database format, create (typed params / LOAD CSV / pipe / `pull` from Neo4j/Aura), query; the format toggle rewrites the db argument in steps 3-4 |
| Examples | `#examples` | 5 panes mirroring the quickstart: `install`, `skill`, `database`, `create`, `query` (tab ids `data-tab`/`data-pane`) |
| Reference | `#reference` | concise tabs: `cli`, `dot`, `output`, `cypher`, `vector`, `spatial`, `storage`, `clients` (`data-ref-tab`/`data-ref-pane`) |

## What must never change

- The design system: CSS tokens, fonts, layout, tone. No framework, no build
  step, no extra pages without a decision on `main`.
- The `cli | agentic` toggle behaviour and the four agentic invariants
  (below).
- `install.sh` is owned by the release pipeline, not by site edits.
- The WASM console placeholder section stays until the real console replaces it.
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
| Cypher coverage wording | Say "full openCypher TCK coverage" — **no numeric pass/skip counts on the site** |
| Vector / spatial APIs | `docs/guides/vector-similarity.md`, `docs/guides/geospatial-queries.md` |
| Storage formats (memory / directory / `.cl`, codecs) | `README.md`, `docs/guides/storage-engine.md` |
| Python API | `README.md`, `docs/reference/python-library.md` |
| Agent names for `skill install` | `README.md` (§ Agent skill) |
| Changelog for release-driven updates | `CHANGELOG.md` |

Only document **shipped** behavior. Nothing from open PRs, unreleased flags,
or plans.

## The four agentic invariants

The page has two `cli | agentic` toggles (`#quickstartSteps`,
`#examplesSection`). In agentic mode (default, no `.cli-mode` class):

1. **Prompt prefix** — every `.agentic-comment` starts with `> ` and renders
   terminal-green; it is the visual hero.
2. **One loading cue** — exactly one
   `<span class="agentic-loading">→ loading skill cypherlite</span>`
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

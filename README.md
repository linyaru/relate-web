# relate-web

The public website for **relate**, the embedded Cypher graph database, at [relatedb.ai](https://relatedb.ai): the home page, the documentation, the cookbook, the in-browser playground and the hosted docs MCP server. It is a static [Astro](https://astro.build) site that ships the engine's WASM build and runs every example against it at build time.

The site is pre-launch. Package names, release URLs and install URLs on the pages are launch-day targets and 404 until the first relate release; [`LAUNCH.md`](LAUNCH.md) tracks what flips at launch.

## What is here

| Path on the site | Source | What it is |
|---|---|---|
| `/` | `src/pages/index.astro`, `src/legacy/` | The home page, with the lazy-loaded WASM console |
| `/docs/` | `src/content/docs/`, `src/lib/docs/`, `src/pages/docs/` | The documentation: 142 pages, each with a markdown twin (`<page>.md`), `llms.txt`, a docs graph (`graph.cypher`, `graph.json`, `<page>.graph.md`), the glossary, the capability catalog and the interactive elements (plan viewer, agent-mode terminal, vector and geospatial explorers, MCP tryout, live schema, the docs graph itself) |
| `/cookbook/` | `src/content/cookbook/`, `src/lib/cookbook/` | Recipes whose every Cypher step runs on the WASM engine, with recorded results, diagrams and a hand-off to the playground |
| `/playground/` | `playground/` | The full-screen Cypher playground, its own Vite and React package |
| `/skill.md`, `/skills/`, `/.well-known/` | `public/skills/`, `src/pages/.well-known/` | The relate agent skill (synced from upstream) and five task skills authored here, with discovery indexes |
| `/mcp` | `workers/docs-mcp/` | The hosted docs MCP server, a Cloudflare Worker running the engine over the docs graph (five read-only tools) |
| `/wasm/` | `public/wasm/` | The engine's WASM build, copied from upstream and never bundled |

Every claim on the site is verified: docs pages replay their CLI recordings against the pinned relate binary, run their language samples against the built clients, and run their Cypher cells on the WASM; the cookbook does the same for recipes; a headless Chrome run exercises the pages, the playground and every interactive element.

## Working on it

Node 22.18 or later (CI runs Node 24), npm, and Chrome for the browser checks.

```bash
npm install && npm ci --prefix playground && npm ci --prefix workers/docs-mcp
npm run dev                # the site on http://127.0.0.1:8765
npm run dev:playground     # the playground on http://localhost:5173/playground/
npm run build              # dist/, including the playground
```

The checks CI runs on every pull request:

```bash
npm run cookbook:test && npm run docs:test && npm run mcp:test   # unit tests
npm run adr:check          # decision records
npm run docs:check         # the docs' source checks (-- --built after a build adds the output checks)
npm run docs:lint          # Vale on the docs prose
npm run cookbook:check     # every recipe matches its recording
npm run check && npm run check:playground
npm run build && npm run docs:check -- --built && npm run mcp:bundle
npm run cookbook:browser   # headless Chrome over dist/
```

Checks that need a relate binary or the client toolchains (`docs:cli-check`, `docs:samples`, `docs:graph`) and the ones that need a Cloudflare account (`docs:usage`) are described, with everything else, in [`AGENTS.md`](AGENTS.md).

## Where to read next

- [`AGENTS.md`](AGENTS.md): the contract for every change and the full guide to the layout, the commands, the upstream refresh and CI. Start here before editing anything.
- [`docs/adr/`](docs/adr/): the decision log. Hosting, content architecture, agent-facing surfaces and the design system are decided there first.
- [`DOCS-PLAN.md`](DOCS-PLAN.md): the documentation plan and style guide, with what each phase built.
- [`MAINTAINING.md`](MAINTAINING.md): the site's standing contract on tone, invariants and sources.
- Authoring contracts per area: [`src/content/docs/README.md`](src/content/docs/README.md), [`src/content/cookbook/README.md`](src/content/cookbook/README.md), [`playground/README.md`](playground/README.md), [`workers/docs-mcp/README.md`](workers/docs-mcp/README.md).

## Deploys

GitHub Pages is the interim host (`deploy-pages.yml`); everything on the site is static and works there. Cloudflare Pages (`deploy-cf.yml`) adds the Pages Functions for markdown content negotiation (`Accept: text/markdown`, `?section=`) and deploys the docs MCP Worker; it needs the account secrets listed in `LAUNCH.md`.

The engine itself is developed in the upstream relate repository. This repository copies its WASM build, skill bundle and release metadata, and authors everything else.

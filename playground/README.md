# Relate Playground

Browser playground for running Relate in-process via WebAssembly, with
Neo4j NVL for graph visualization. Published at `/playground/` as part of
this site: `npm run build` at the repository root builds it into
`dist/playground/`. Moved here from the Relate repository's
`examples/wasm-playground/`.

## Stack

- The site's WASM engine, `public/wasm/` (a copy of the Relate repository's
  `surfaces/relate-wasm/pkg/`; see the root CLAUDE.md to refresh it)
- Vite 5 + React 19 + TypeScript 5, kept as their own package (this
  directory's `package.json` and lockfile), separate from the Astro site's
  toolchain
- Neo4j Needle (`@neo4j-ndl/react`), `@neo4j-nvl/react` for the graph view,
  `@neo4j-cypher/react-codemirror` for the editor

## Build

```sh
npm ci --prefix playground          # once, from the repository root
npm run dev:playground              # http://localhost:5173/playground/
npm run check:playground            # tsc
npm run cookbook:browser            # after a build: the playground and the cookbook hand-off in headless Chrome
npm run build                       # the site, then the playground into dist/playground/
```

The engine is not bundled. The worker (`src/lib/engine.worker.ts`) loads
`/wasm/relate.js` and `/wasm/trap.js` at runtime, so the playground, the
cookbook, and the home page's console share one engine file, and refreshing
`public/wasm/` updates all three. Its types come from
`public/wasm/relate.d.ts`. The site serves `/wasm/` in production; the
`site-wasm` plugin in `vite.config.ts` serves it from `public/wasm/` to the
playground's dev server.

The build keeps the tuning it had upstream (`vite.config.ts`): terser rather
than esbuild (esbuild's minifier breaks labelled statements in dagre and
cypher-language-support), React in one chunk (NVL's React wrapper needs a
single binding), and an explicit dependency pre-bundle list.

## Running queries

The editor accepts several statements separated by `;`. They run with the
engine's own script runner (`executeScript`), which splits with the CLI's
scanner and stops at the first error; the results pane shows the last
statement's result, with counters summed over the script. Each statement
commits on its own.

## Cookbook links

Cookbook steps link here as `#recipe=<slug>&cell=<id>`. The playground then
fetches `../cookbook/<slug>/recipe.json` (format 1; any other format is
refused with a message), shows the step and asks before running anything. On
confirmation it fetches every parameter file it needs, then resets the
database, runs the recipe's earlier steps, and puts the step in the editor
unrun; the replay stops at the first step that goes other than the recipe
says, by the cookbook pages' own rule (imported from the site's
`src/lib/cookbook/cells.ts`). When the step has a parameter file, those
parameters go with every query run from the editor until **Clear** or a
database reset. A recipe page's **Open in playground** links to
`#recipe=<slug>` with no step: the playground runs every step of the recipe
and leaves the editor empty. Once a recipe is loaded, the sample-query list
holds its steps instead of the sample data's queries (setup steps left out),
labelled by the heading each sits under (`title` in recipe.json); a step's
button runs it with its own parameter file, which also becomes the editor's.
**Reset** brings the sample data's queries back. See `src/lib/recipe-link.ts`,
`src/hooks/useRecipeSession.ts`, and `src/components/RecipeDialog.tsx`.

## Layout

```
playground/
  index.html
  package.json
  vite.config.ts
  src/
    App.tsx
    main.tsx
    components/    # QueryWorkspace, ResultsPanel, NeedleGraphView, RecipeDialog, …
    lib/           # engine.ts + engine.worker.ts (wasm bridge), recipe-link.ts, wire.ts, extract-graph.ts, samples.ts
```

// Docs page runtime (DOCS-PLAN.md §7.2): makes a page's ```cypher run cells
// runnable with the cell runtime the cookbook uses (src/scripts/cookbook/
// session.ts): one engine per page in a module worker, started on the first
// Run; cells share one database and run in page order; Run all, Reset (back
// to the page's seed: an empty database the cells rebuild), Stop; table,
// JSON and graph views. The engine (public/wasm) and the graph view (NVL)
// load only when needed, never on page load.
//
// Each cell carries its recorded `{envelope, graph}` in `data-recorded`
// (written by the build from the page's results sidecar), so the JSON and
// graph views of a recording need no fetch. The status bar names the engine
// version once it loads, and says so when it is not the version the page was
// verified against (the bar's `data-verified`).
//
// The page's interactive elements (src/scripts/docs/elements.ts) start here
// too, on the same engine and database: each element's module loads when the
// element comes near the viewport or the reader reaches it.
//
// This module starts with the page (src/components/docs/PageRuntime.astro
// imports it statically, only on a page with cells or elements), so it and
// what it imports statically count in the script budget; keep them small and
// put anything heavy behind a dynamic import.

import { startCells, type Data } from '../cookbook/session.ts';
import { startElements } from './elements.ts';

const bar = document.getElementById('engineBar');
const verified = bar?.dataset.verified ?? null;

function recorded(): Promise<Record<string, Data>> {
  const out: Record<string, Data> = {};
  for (const cell of document.querySelectorAll<HTMLElement>('cypher-cell[data-cell]')) {
    try {
      out[cell.dataset.cell!] = JSON.parse(cell.dataset.recorded ?? 'null') ?? { envelope: null, graph: null };
    } catch {
      out[cell.dataset.cell!] = { envelope: null, graph: null };
    }
  }
  return Promise.resolve(out);
}

// With the runtime up, a graph result shows in the graph view, so its static
// form (the page's no-JavaScript picture) steps aside.
if (bar && typeof Worker !== 'undefined') {
  for (const figure of document.querySelectorAll<HTMLElement>('cypher-cell .out-static')) figure.hidden = true;
}

// A page with elements but no cells talks about its examples.
const noun = document.querySelector('cypher-cell') ? 'cell' : 'example';

const page = startCells({
  base: new URL(location.pathname.replace(/\/?$/, '/'), location.origin),
  noun,
  recorded,
  ready: ({ loadMs, version }) => {
    const loaded = `relate ${version ?? '(version unknown)'} loaded in ${Math.round(loadMs)} ms. Every ${noun} runs in this tab.`;
    if (verified && version && version !== verified) {
      return `${loaded} This page was verified against relate ${verified}, so a result can differ from its recording.`;
    }
    return loaded;
  },
});

if (page) startElements(page);

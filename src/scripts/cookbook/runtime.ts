// Cookbook page runtime: makes each recipe step runnable in the browser with
// the shared cell runtime (session.ts). Recorded results' envelopes and
// graphs live in results.json beside the page and are fetched the first time
// a graph or JSON view needs one; a step's parameter file, data/<name>.json,
// resolves beside it too.
//
// A recipe's interactive elements (ADR-0045) start here with the docs
// pages' element loader (src/scripts/docs/elements.ts), on the same engine
// and database as the steps: each element's module loads when its host
// comes near the viewport or the reader reaches it, never with the page.
// This module and what it imports statically count in the page's script
// budget (src/lib/docs/checks/budget.ts), as the docs runtime does.

import { startElements } from '../docs/elements.ts';
import { fetchText, startCells, type Data } from './session.ts';

// The page's own directory, with a trailing slash however the page was reached,
// so data/<name>.json and results.json resolve beside it.
const PAGE_BASE = new URL(location.pathname.replace(/\/?$/, '/'), location.origin);

const page = startCells({
  base: PAGE_BASE,
  noun: 'step',
  recorded: (): Promise<Record<string, Data>> => fetchText(new URL('results.json', PAGE_BASE).href).then((t) => JSON.parse(t)),
});

if (page && document.querySelector('docs-element')) startElements(page);

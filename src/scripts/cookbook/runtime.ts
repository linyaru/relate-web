// Cookbook page runtime: makes each recipe step runnable in the browser with
// the shared cell runtime (session.ts). Recorded results' envelopes and
// graphs live in results.json beside the page and are fetched the first time
// a graph or JSON view needs one; a step's parameter file, data/<name>.json,
// resolves beside it too.

import { fetchText, startCells, type Data } from './session.ts';

// The page's own directory, with a trailing slash however the page was reached,
// so data/<name>.json and results.json resolve beside it.
const PAGE_BASE = new URL(location.pathname.replace(/\/?$/, '/'), location.origin);

startCells({
  base: PAGE_BASE,
  noun: 'step',
  recorded: (): Promise<Record<string, Data>> => fetchText(new URL('results.json', PAGE_BASE).href).then((t) => JSON.parse(t)),
});

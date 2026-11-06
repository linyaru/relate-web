#!/usr/bin/env node
// Checks the cookbook (src/content/cookbook): every recipe parses and
// validates, runs through the site's WASM engine (public/wasm) without
// going other than it says, and reproduces each recorded `table` / `gram`
// block; and the README index is current.
//
//   node scripts/cookbook.ts            check (npm run cookbook:check)
//   node scripts/cookbook.ts --record   rewrite the result blocks and the
//                                       index instead (npm run cookbook:record)
//
// COOKBOOK_ONLY=<slug>[,<slug>…] limits the run to those recipes and leaves
// the index alone. A run that goes other than its recipe says is never
// recorded.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { renderIndex, spliceIndex } from '../src/lib/cookbook/index.ts';
import { COOKBOOK_DIR, loadRecipes } from '../src/lib/cookbook/load.ts';
import { withResults, type Recording } from '../src/lib/cookbook/recipe.ts';
import { checkRun, loadEngine, resultProblems, runRecipe } from '../src/lib/cookbook/run.ts';

const { values: args } = parseArgs({ options: { record: { type: 'boolean', default: false } } });
const only = process.env.COOKBOOK_ONLY?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

function writeIfChanged(path: string, text: string) {
  if (readFileSync(path, 'utf8') !== text) {
    writeFileSync(path, text);
    console.error(`updated ${path}`);
  }
}

const { recipes, problems } = loadRecipes(COOKBOOK_DIR, { only });
if (only && recipes.length === 0) problems.push(`COOKBOOK_ONLY names no recipe: ${only.join(', ')}`);
const engine = await loadEngine();
let cells = 0;

for (const recipe of recipes) {
  const fail = (msg: string) => problems.push(`[${recipe.slug}] ${msg}`);
  const run = runRecipe(engine, recipe);
  cells += run.cells.length;
  const runProblems = checkRun(recipe, run);
  if (runProblems.length) {
    // Never record a run that went other than the recipe says.
    runProblems.forEach(fail);
  } else if (args.record) {
    const recordings = new Map<string, Recording>(run.cells.map((c) => [c.id, c.recording]));
    writeIfChanged(join(COOKBOOK_DIR, `${recipe.slug}.md`), withResults(recipe, recordings));
  } else {
    resultProblems(recipe, run).forEach(fail);
  }
}

// The index covers every recipe, so a filtered run leaves it alone. It reads
// only front matter, which recording does not change.
if (!only) {
  const readmePath = join(COOKBOOK_DIR, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  try {
    const fresh = spliceIndex(readme, renderIndex(recipes));
    if (args.record) writeIfChanged(readmePath, fresh);
    else if (fresh !== readme) problems.push('README.md index is stale; run `npm run cookbook:record`');
  } catch (e) {
    problems.push((e as Error).message);
  }
}

if (problems.length) {
  console.error(`${problems.length} cookbook problem(s):\n\n${problems.join('\n\n')}`);
  process.exit(1);
}
console.log(`cookbook: ${recipes.length} recipes, ${cells} cells ${args.record ? 'recorded' : 'match their recordings'}`);

#!/usr/bin/env node
// Writes the `docs` data block of the cookbook recipe "Query the relate docs"
// (src/content/cookbook/query-the-relate-docs.md) from the docs graph and
// _data/embeddings.json: the subset rule is recipeData() in
// src/lib/docs/graph.ts (the graph's pages, terms, capabilities, problems
// and recipes with the relationships the recipe's steps read, without
// vectors; every section of a fixed list of pages, text cut short, vectors
// to four decimals; and the recipe's questions with their vectors). Runs on
// Node directly, like scripts/docs.ts; needs no model.
//
//   node scripts/docs-recipe-data.ts            rewrite the block when it differs
//   node scripts/docs-recipe-data.ts --check    exit 1 when it differs; write nothing
//
// `npm run docs:embeddings` runs it after updating the vectors. docs:check
// compares the block with the graph (src/lib/docs/checks/embeddings.ts).
// After a rewrite, record the recipe's results:
// COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { docsGraph, readEmbeddings, recipeData, recipeDataBlock, RECIPE_FILE, withRecipeData } from '../src/lib/docs/graph.ts';

export type RecipeDataResult = 'written' | 'current' | 'stale';

/** Rewrites (or with `check`, compares) the recipe's data block. Throws when the subset cannot be built. */
export function writeRecipeData({ check = false }: { check?: boolean } = {}): { result: RecipeDataResult; bytes: number; recipeBytes: number } {
  if (!existsSync(RECIPE_FILE)) throw new Error(`${relative(process.cwd(), RECIPE_FILE)} does not exist`);
  const data = recipeData(docsGraph(), readEmbeddings());
  const source = readFileSync(RECIPE_FILE, 'utf8');
  const bytes = Buffer.byteLength(data);
  if (recipeDataBlock(source) === data) return { result: 'current', bytes, recipeBytes: Buffer.byteLength(source) };
  if (check) return { result: 'stale', bytes, recipeBytes: Buffer.byteLength(source) };
  const next = withRecipeData(source, data);
  writeFileSync(RECIPE_FILE, next);
  return { result: 'written', bytes, recipeBytes: Buffer.byteLength(next) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  try {
    const r = writeRecipeData({ check: values.check });
    const file = relative(process.cwd(), RECIPE_FILE);
    console.log(`${file}: data block ${r.result} (${r.bytes} bytes; the recipe is ${r.recipeBytes} bytes)`);
    if (r.result === 'stale') {
      console.error(`docs:recipe-data: the \`docs\` block of ${file} differs from the docs graph; run \`node scripts/docs-recipe-data.ts\`, then COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record`);
      process.exit(1);
    }
    if (r.result === 'written') console.log('  now record its results: COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record');
  } catch (e) {
    console.error(`docs:recipe-data: ${(e as Error).message}`);
    process.exit(1);
  }
}

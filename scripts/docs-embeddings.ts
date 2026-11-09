#!/usr/bin/env node
// Embeds the docs graph's sections into src/content/docs/_data/embeddings.json
// (DOCS-PLAN.md §3.5, §3.8, §8 item 3e). Runs on Node directly, like
// scripts/docs.ts; the model runs in the authoring-only package
// scripts/embeddings/ (`npm ci --prefix scripts/embeddings` once), which CI
// never installs.
//
//   npm run docs:embeddings                 embed the sections whose text changed
//   npm run docs:embeddings -- --force      embed every section again
//   npm run docs:embeddings -- --dry-run    say what would change; load no model
//
// What it embeds, per section: sectionInputs() in src/lib/docs/graph.ts (the
// page title, the heading, the text), keyed by section id with the SHA-256 of
// that text. An entry whose hash still matches is kept as it is; an entry for
// a section that no longer exists is dropped. It also embeds the cookbook
// recipe's fixed questions (RECIPE_QUESTIONS) into `queries`. Then it
// rewrites the recipe's `docs` data block (scripts/docs-recipe-data.ts).
//
// The first run downloads the model's weights (about 130 MB) into
// scripts/embeddings/.cache/; later runs need no network. A run that has
// nothing to embed never loads the model. Exits 1 when the package is not
// installed but a vector is needed, or a vector comes back malformed.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { ROOT } from '../src/lib/docs/content.ts';
import {
  artifactMatchesModel,
  docsGraph,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  EMBEDDINGS_FILE,
  encodeVector,
  formatEmbeddings,
  readEmbeddings,
  RECIPE_QUESTIONS,
  sectionInputs,
  sha256Hex,
  type EmbeddingEntry,
} from '../src/lib/docs/graph.ts';
import { writeRecipeData } from './docs-recipe-data.ts';

const { values: args } = parseArgs({
  options: { force: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false } },
});
const PACKAGE = join(ROOT, 'scripts/embeddings');
// One text per call: a padded batch changes the arithmetic by a float16 step for some texts, so a vector would
// depend on its batch mates; alone, the same text gives the same bytes on every run.
const BATCH = 1;
const rel = (p: string) => relative(process.cwd(), p) || '.';

function fail(message: string): never {
  console.error(`docs:embeddings: ${message}`);
  process.exit(1);
}

interface Wanted {
  id: string;
  input: string;
  sha256: string;
}

async function main(): Promise<number> {
  const t0 = performance.now();
  const graph = docsGraph();
  const sections: Wanted[] = sectionInputs(graph);
  const queries: Wanted[] = RECIPE_QUESTIONS.map((q) => ({ id: q, input: q, sha256: sha256Hex(q) }));

  let old = null;
  try {
    old = readEmbeddings();
  } catch (e) {
    console.warn(`${(e as Error).message}; embedding everything`);
  }
  const usable = old && artifactMatchesModel(old) && !args.force ? old : null;
  if (old && !artifactMatchesModel(old)) console.log(`${rel(EMBEDDINGS_FILE)} was made with another model or format; embedding everything`);

  const plan = (wanted: Wanted[], have: EmbeddingEntry[]) => {
    const byId = new Map(have.map((e) => [e.id, e]));
    const keep: EmbeddingEntry[] = [];
    const todo: Wanted[] = [];
    for (const w of wanted) {
      const e = byId.get(w.id);
      if (e && e.sha256 === w.sha256) keep.push(e);
      else todo.push(w);
    }
    const wantedIds = new Set(wanted.map((w) => w.id));
    const dropped = have.filter((e) => !wantedIds.has(e.id)).map((e) => e.id);
    return { keep, todo, dropped };
  };
  const s = plan(sections, usable?.sections ?? []);
  const q = plan(queries, usable?.queries ?? []);
  console.log(
    `sections: ${sections.length} in the docs graph; ${s.keep.length} current, ${s.todo.length} to embed, ${s.dropped.length} orphaned entr${s.dropped.length === 1 ? 'y' : 'ies'} to drop`,
  );
  console.log(`queries: ${queries.length}; ${q.keep.length} current, ${q.todo.length} to embed, ${q.dropped.length} to drop`);
  for (const id of s.dropped) console.log(`  drop ${id}`);
  if (args['dry-run']) {
    for (const w of [...s.todo, ...q.todo]) console.log(`  embed ${w.id}`);
    return 0;
  }

  const todo = [...s.todo, ...q.todo];
  const fresh = new Map<string, string>();
  if (todo.length) {
    if (!existsSync(join(PACKAGE, 'node_modules/@huggingface/transformers'))) {
      fail(`${todo.length} vector(s) to compute, and the embeddings package is not installed: run \`npm ci --prefix scripts/embeddings\` (an authoring-only package; the first run downloads the model, about 130 MB)`);
    }
    // A computed specifier: the package is not installed in CI, and nothing type-checks it.
    const embedModule: string = './embeddings/embed.mjs';
    const { loadEmbedder } = (await import(embedModule)) as {
      loadEmbedder: (model: typeof EMBEDDING_MODEL) => Promise<(texts: string[]) => Promise<number[][]>>;
    };
    const tLoad = performance.now();
    const embed = await loadEmbedder(EMBEDDING_MODEL);
    console.log(`model ${EMBEDDING_MODEL.onnx}@${EMBEDDING_MODEL.revision.slice(0, 12)} (${EMBEDDING_MODEL.dtype}, ${EMBEDDING_MODEL.pooling} pooling): loaded in ${((performance.now() - tLoad) / 1000).toFixed(1)} s`);
    const tEmbed = performance.now();
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const vectors = await embed(batch.map((w) => w.input));
      batch.forEach((w, j) => {
        const v = vectors[j];
        if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSION || !v.every(Number.isFinite)) {
          fail(`${w.id}: the model returned ${Array.isArray(v) ? `${v.length} values` : String(v)}, not ${EMBEDDING_DIMENSION} finite floats`);
        }
        fresh.set(w.id, encodeVector(v));
      });
      if (todo.length > 50 && (i / BATCH) % 10 === 9) console.log(`  ${Math.min(i + BATCH, todo.length)} of ${todo.length}`);
    }
    console.log(`embedded ${todo.length} text(s) in ${((performance.now() - tEmbed) / 1000).toFixed(1)} s`);
  }

  const entries = (p: ReturnType<typeof plan>): EmbeddingEntry[] => [...p.keep, ...p.todo.map((w) => ({ id: w.id, sha256: w.sha256, vector: fresh.get(w.id)! }))];
  const text = formatEmbeddings(entries(s), entries(q));
  const before = existsSync(EMBEDDINGS_FILE) ? readFileSync(EMBEDDINGS_FILE, 'utf8') : null;
  if (before !== text) writeFileSync(EMBEDDINGS_FILE, text);
  const bytes = statSync(EMBEDDINGS_FILE).size;
  console.log(`${rel(EMBEDDINGS_FILE)}: ${before === text ? 'unchanged' : 'written'}, ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB), ${sections.length} sections, ${queries.length} queries`);

  try {
    const r = writeRecipeData();
    console.log(`cookbook recipe data block: ${r.result} (${r.bytes} bytes; the recipe is ${r.recipeBytes} bytes)`);
    if (r.result === 'written') console.log('  now record its results: COOKBOOK_ONLY=query-the-relate-docs npm run cookbook:record');
  } catch (e) {
    fail(`the cookbook recipe's data block: ${(e as Error).message}`);
  }
  console.log(`done in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  return 0;
}

process.exit(await main());

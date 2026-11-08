// The embedding step of `npm run docs:embeddings` (DOCS-PLAN.md §8 item 3e):
// bge-small-en-v1.5 through transformers.js, on the CPU, in Node.js. An
// authoring-only package: `npm ci --prefix scripts/embeddings` installs it,
// CI never does, and nothing in the site build imports it (plain JavaScript,
// so `astro check` never needs its dependency, as with scripts/diagrams/).
// The first run downloads the model's fp32 ONNX weights (about 130 MB) from
// the Hugging Face hub into scripts/embeddings/.cache/ (gitignored); later
// runs read the cache and need no network.
//
// scripts/docs-embeddings.ts imports this file only when a section needs a
// new vector, so the staleness check in docs:check never loads it.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env, pipeline } from '@huggingface/transformers';

export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.cache');

/**
 * Loads the model once and returns a function that embeds a batch of texts.
 * @param {{ onnx: string, revision: string, dtype: string, pooling: string, normalize: boolean }} model
 * @returns {Promise<(texts: string[]) => Promise<number[][]>>}
 */
export async function loadEmbedder(model) {
  env.cacheDir = CACHE_DIR;
  env.allowLocalModels = false;
  const extractor = await pipeline('feature-extraction', model.onnx, {
    revision: model.revision,
    dtype: model.dtype,
    device: 'cpu',
  });
  return async (texts) => {
    const out = await extractor(texts, { pooling: model.pooling, normalize: model.normalize });
    return out.tolist();
  };
}

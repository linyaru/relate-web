// Tests for `:::embed-question`'s pins and rewrite (src/lib/docs/elements/_embed-question-model.ts,
// ADR-0050): the model it runs in the browser is the one the committed
// vectors name; the runtime file it bundles is the one the pinned package
// ships, at the size and SHA-256 it states; the download size the button
// states adds up from those pins; and the statement rewrite swaps exactly the
// first line of a step and refuses a step it cannot swap.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './content.ts';
import {
  bindingOf,
  clsVector,
  cosine,
  DOWNLOAD_BYTES,
  EMBED_MODEL,
  HUB_BYTES,
  hubUrl,
  megabytes,
  MODEL_FILES,
  RUNTIME,
  SITE_BYTES,
  SIZES,
  storedVector,
  TOKENIZERS,
  vectorLine,
  vectorValues,
  withVector,
} from './elements/_embed-question-model.ts';
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from './graph.ts';

const RECIPE_STEP = `MATCH (question:Question {text: $q})
MATCH (s:Section)
SEARCH s IN (VECTOR INDEX docs_vector FOR question.embedding LIMIT $k)
  SCORE AS score
RETURN s.page AS page, s.heading AS heading, round(score, 4) AS score
ORDER BY score DESC, s.id`;

test('the model is the one the committed vectors were made with', () => {
  assert.equal(EMBED_MODEL.id, EMBEDDING_MODEL.id);
  assert.equal(EMBED_MODEL.onnx, EMBEDDING_MODEL.onnx);
  assert.equal(EMBED_MODEL.revision, EMBEDDING_MODEL.revision);
  assert.equal(EMBED_MODEL.pooling, EMBEDDING_MODEL.pooling);
  assert.equal(EMBED_MODEL.normalize, EMBEDDING_MODEL.normalize);
  assert.equal(EMBED_MODEL.maxTokens, EMBEDDING_MODEL.max_tokens);
  assert.equal(EMBED_MODEL.dimension, EMBEDDING_DIMENSION);
  assert.equal(hubUrl('onnx/model_fp16.onnx'), `https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/${EMBEDDING_MODEL.revision}/onnx/model_fp16.onnx`);
  for (const f of MODEL_FILES) assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path);
});

test('the runtime and tokenizer pins are the packages package.json pins, and the runtime file is the one it ships', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies[RUNTIME.package], RUNTIME.version);
  assert.equal(pkg.dependencies[TOKENIZERS.package], TOKENIZERS.version);
  const file = join(ROOT, 'node_modules', RUNTIME.package, 'dist', RUNTIME.file.path);
  const bytes = readFileSync(file);
  assert.equal(bytes.length, RUNTIME.file.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), RUNTIME.file.sha256);
  const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules', TOKENIZERS.package, 'package.json'), 'utf8')) as { version: string };
  assert.equal(installed.version, TOKENIZERS.version);
});

test('the model files match the authoring cache when it holds them', (t) => {
  // scripts/embeddings/.cache/ exists only where `npm run docs:embeddings` ran; CI has none.
  const dir = join(ROOT, 'scripts/embeddings/.cache', EMBED_MODEL.onnx, EMBED_MODEL.revision);
  const present = MODEL_FILES.filter((f) => existsSync(join(dir, f.path)));
  if (!present.length) return t.skip('no authoring cache');
  for (const f of present) {
    const bytes = readFileSync(join(dir, f.path));
    assert.equal(bytes.length, f.bytes, f.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256, f.path);
  }
});

test('the download size the button states adds up from the pins', () => {
  assert.equal(HUB_BYTES, MODEL_FILES.reduce((n, f) => n + f.bytes, 0));
  assert.equal(SITE_BYTES, RUNTIME.file.bytes);
  assert.equal(DOWNLOAD_BYTES, 81_700_871);
  assert.deepEqual(SIZES, { total: '82 MB', weights: '66.7 MB', tokenizer: '0.7 MB', runtime: '14.2 MB' });
  assert.equal(megabytes(133_093_490), '133 MB');
  assert.equal(megabytes(0), '0.0 MB');
});

test('bindingOf reads how a step names its stored vector, and withVector swaps only that line', () => {
  const b = bindingOf(RECIPE_STEP);
  assert.deepEqual(b, { variable: 'question', label: 'Question', key: 'text', property: 'embedding', line: 'MATCH (question:Question {text: $q})' });
  if (typeof b === 'string') return;
  assert.equal(vectorLine(b), 'WITH {embedding: vector($embedding, 384, FLOAT32)} AS question');
  const out = withVector(RECIPE_STEP, b);
  assert.deepEqual(out.split('\n').slice(1), RECIPE_STEP.split('\n').slice(1));
  assert.equal(out.split('\n')[0], vectorLine(b));
  assert.equal(storedVector(b), 'MATCH (question:Question {text: $q}) RETURN question.embedding AS v');
});

test('bindingOf refuses a step it cannot swap', () => {
  const refuse = (code: string, why: RegExp) => {
    const b = bindingOf(code);
    assert.equal(typeof b, 'string', code);
    assert.match(b as string, why);
  };
  refuse('MATCH (s:Section)\nSEARCH s IN (VECTOR INDEX docs_vector FOR $v LIMIT $k)\nRETURN s', /first line/);
  refuse('MATCH (question:Question {text: $other})\nRETURN question', /first line/);
  refuse('MATCH (question:Question {text: $q})\nRETURN question', /exactly once, found 0/);
  refuse('MATCH (question:Question {text: $q})\nMATCH (s)\nSEARCH s IN (VECTOR INDEX a FOR question.embedding LIMIT 1)\nWITH s\nSEARCH s IN (VECTOR INDEX b FOR question.embedding LIMIT 1)\nRETURN s', /found 2/);
  refuse('MATCH (question:Question {text: $q})\nMATCH (s)\nSEARCH s IN (FULLTEXT INDEX docs FOR question.embedding LIMIT 1)\nRETURN s', /VECTOR INDEX/);
  refuse(`${RECIPE_STEP}\n// $embedding`, /already uses/);
});

test('clsVector takes the first token and normalizes it; cosine and vectorValues read vectors', () => {
  const hidden = Float32Array.from([3, 4, 0, 9, 9, 9]);
  assert.deepEqual(clsVector(hidden, 3), [0.6, 0.8, 0]);
  assert.throws(() => clsVector(Float32Array.from([0, 0, 0]), 3), /zero/);
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.ok(Number.isNaN(cosine([1], [1, 2])));
  assert.deepEqual(vectorValues({ dim: 2, type: 'FLOAT32', values: [0.5, 0.25] }), [0.5, 0.25]);
  assert.deepEqual(vectorValues([1, 2]), [1, 2]);
  assert.equal(vectorValues(null), null);
  assert.equal(vectorValues({ values: ['a'] }), null);
});

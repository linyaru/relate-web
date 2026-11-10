// The model worker of `:::embed-question` (ADR-0050; the element is
// embed-question.ts beside this file). It owns bge-small-en-v1.5 in the tab:
// the element starts it when the reader presses the download button, and
// terminates it on Unload, on Reset of the element and when the page goes,
// which is the only way to hand back the WebAssembly memory the runtime
// grew. Vite bundles it, with onnxruntime-web's WebAssembly build and the
// tokenizer library, as chunks that load only then, never with the page.
//
// Messages in:  {type: 'load'}
//               {type: 'embed', id, text}
// Messages out: {type: 'progress', loaded, total}         bytes so far, of DOWNLOAD_BYTES
//               {type: 'ready'}
//               {type: 'vector', id, vector, tokens}      vector: 384 numbers, length 1
//               {type: 'error', id?, message}
//
// Every file is fetched whole, counted and checked against its pinned size
// and SHA-256 (_embed-question-model.ts) before the runtime or the tokenizer
// sees a byte: the model files from the Hugging Face hub at the pinned
// revision, with no cookies and no referrer, and the runtime's WebAssembly
// file from this site (its URL is the asset Vite emits from the pinned npm
// package). Nothing is written to the browser's storage.
//
// One question, one forward pass: the tokenizer's encoding with its special
// tokens ([CLS] … [SEP]), its attention mask and token types as int64, the
// first token's row of the last hidden state, normalized. That is what
// transformers.js's feature-extraction pipeline computes with
// `{pooling: 'cls', normalize: true}` for one text, which is how
// scripts/docs-embeddings.ts made the committed vectors.

import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/wasm';
import runtimeUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

import { clsVector, DOWNLOAD_BYTES, EMBED_MODEL, hex, hubUrl, MAX_QUESTION_CHARS, MODEL_FILES, RUNTIME, type PinnedFile } from '../../../lib/docs/elements/_embed-question-model.ts';

type In = { type: 'load' } | { type: 'embed'; id: number; text: string };

const post = (m: Record<string, unknown>) => (self as unknown as Worker).postMessage(m);

let loaded = 0;
let session: ort.InferenceSession | null = null;
let tokenizer: Tokenizer | null = null;
let loading: Promise<void> | null = null;

/** Fetch one pinned file whole, counting its bytes as they arrive, and check it. */
async function fetchPinned(url: string, file: PinnedFile, init: RequestInit): Promise<Uint8Array> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) throw new Error(`${file.path}: HTTP ${res.status} from ${new URL(url).host}`);
  const bytes = new Uint8Array(file.bytes);
  let at = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > file.bytes) throw new Error(`${file.path}: more than the pinned ${file.bytes} bytes`);
    bytes.set(value, at);
    at += value.length;
    loaded += value.length;
    post({ type: 'progress', loaded, total: DOWNLOAD_BYTES });
  }
  if (at !== file.bytes) throw new Error(`${file.path}: ${at} bytes, not the pinned ${file.bytes}`);
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (sha !== file.sha256) throw new Error(`${file.path}: SHA-256 ${sha}, not the pinned ${file.sha256}`);
  return bytes;
}

async function load(): Promise<void> {
  if (!crypto?.subtle) throw new Error('this page is not a secure context, so the files cannot be checked');
  const hub: RequestInit = { credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors' };
  const [wasm, weights, tokenizerJson, tokenizerConfig] = await Promise.all([
    fetchPinned(new URL(runtimeUrl, self.location.href).href, RUNTIME.file, { credentials: 'same-origin' }),
    ...MODEL_FILES.map((f) => fetchPinned(hubUrl(f.path), f, hub)),
  ]);
  const text = new TextDecoder();
  tokenizer = new Tokenizer(JSON.parse(text.decode(tokenizerJson)), JSON.parse(text.decode(tokenizerConfig)));
  // The page is not cross-origin isolated, so the runtime runs one thread; it is handed the checked bytes and fetches nothing.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmBinary = wasm.buffer as ArrayBuffer;
  ort.env.logLevel = 'error';
  session = await ort.InferenceSession.create(weights, { executionProviders: ['wasm'], logSeverityLevel: 3 });
}

async function embed(text: string): Promise<{ vector: number[]; tokens: number }> {
  if (!session || !tokenizer) throw new Error('the model is not loaded');
  if (!text.trim()) throw new Error('the question is empty');
  if (text.length > MAX_QUESTION_CHARS) throw new Error(`the question is longer than ${MAX_QUESTION_CHARS} characters`);
  const enc = tokenizer.encode(text);
  const n = enc.ids.length;
  if (n > EMBED_MODEL.maxTokens) throw new Error(`the question is ${n} tokens, more than the model reads`);
  const int64 = (a: number[]) => new ort.Tensor('int64', BigInt64Array.from(a, (x) => BigInt(x)), [1, n]);
  const out = await session.run({
    input_ids: int64(enc.ids),
    attention_mask: int64(enc.attention_mask),
    token_type_ids: int64(enc.token_type_ids ?? enc.ids.map(() => 0)),
  });
  const hidden = out.last_hidden_state as ort.Tensor;
  return { vector: clsVector(hidden.data as Float32Array, hidden.dims[2]), tokens: n };
}

self.addEventListener('message', async (event: MessageEvent<In>) => {
  const m = event.data;
  if (m.type === 'load') {
    loading ??= load();
    try {
      await loading;
      post({ type: 'ready' });
    } catch (err) {
      loading = null;
      post({ type: 'error', message: (err as Error)?.message ?? String(err) });
    }
    return;
  }
  if (m.type === 'embed') {
    try {
      const { vector, tokens } = await embed(m.text);
      post({ type: 'vector', id: m.id, vector, tokens });
    } catch (err) {
      post({ type: 'error', id: m.id, message: (err as Error)?.message ?? String(err) });
    }
  }
});

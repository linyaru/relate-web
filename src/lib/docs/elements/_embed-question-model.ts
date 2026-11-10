// What `:::embed-question` (ADR-0050) runs in a reader's browser, pinned:
// the model that made the docs' vectors (bge-small-en-v1.5 through its ONNX
// conversion, at the revision `_data/embeddings.json` names, CLS pooling,
// normalized), as its half-precision weights; the files the browser fetches
// and the SHA-256 it checks each against before use; and the statement
// rewrite that lets a page's own vector search run with the vector the
// reader's question makes. Free of Node and DOM imports: the build side
// (embed-question.ts), the browser module and its worker
// (src/scripts/docs/elements/embed-question.ts, _embed-question-worker.ts)
// and the unit tests share it.
//
// Every number here is measured, never estimated: the model files' sizes and
// SHA-256 are the hub's own for that revision (its LFS pointer, or the file
// as downloaded), and the runtime's are the file the onnxruntime-web
// package pinned in package.json ships. src/lib/docs/embed-question.test.ts
// holds the model fields to graph.ts EMBEDDING_MODEL and the runtime pins to
// node_modules, and the worker refuses a file whose size or SHA-256 differs.

/** The model: the same conversion, revision, pooling and normalization as the committed vectors (graph.ts EMBEDDING_MODEL). */
export const EMBED_MODEL = {
  id: 'BAAI/bge-small-en-v1.5',
  onnx: 'Xenova/bge-small-en-v1.5',
  revision: 'ea104dacec62c0de699686887e3f920caeb4f3e3',
  pooling: 'cls',
  normalize: true,
  dimension: 384,
  /** The input the model reads at most, in tokens; a question is capped well inside it (MAX_QUESTION_CHARS). */
  maxTokens: 512,
} as const;

/** Where the model files come from: the Hugging Face hub, at the pinned revision. */
export const HUB_ORIGIN = 'https://huggingface.co';

export interface PinnedFile {
  /** The path in the model repository, or the runtime's file name. */
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * The model files the browser fetches from the hub. The weights are
 * `onnx/model_fp16.onnx` (float16 weights, float32 inputs and outputs): the
 * fp32 file is 133 MB, and the 8-bit files' vectors drift with the
 * runtime's integer kernels or reorder the results (ADR-0050).
 */
export const MODEL_FILES: readonly PinnedFile[] = [
  { path: 'onnx/model_fp16.onnx', bytes: 66_749_212, sha256: '4d76223b73a3fd708f009a93a830a6ed5e536b07c77d3c812ba7b35a4988d767' },
  { path: 'tokenizer.json', bytes: 711_396, sha256: 'd241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66' },
  { path: 'tokenizer_config.json', bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
];

/** The ONNX runtime's WebAssembly file, bundled from the pinned npm package and served by this site. */
export const RUNTIME = {
  package: 'onnxruntime-web',
  version: '1.30.0',
  file: { path: 'ort-wasm-simd-threaded.wasm', bytes: 14_239_897, sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2' },
} as const;

/** The tokenizer library: the one transformers.js 4.3.1, which made the committed vectors, runs. */
export const TOKENIZERS = { package: '@huggingface/tokenizers', version: '0.2.0' } as const;

/** A question longer than this is refused before it is embedded, so the model never truncates one. */
export const MAX_QUESTION_CHARS = 200;

/**
 * The least cosine similarity a browser's vector may have with the committed
 * vector of the same text (ADR-0050). Measured: 0.9999999 for these weights
 * on onnxruntime-web; the committed vector is stored as float16 and the
 * recipe rounds it to four decimals, which costs less than 1e-6. A
 * different pooling of the same model gives about 0.95, the revision's
 * 8-bit and 4-bit files 0.98 to 0.999.
 */
export const AGREEMENT_MIN_COSINE = 0.9999;

/** The URL of a model file at the pinned revision. */
export const hubUrl = (path: string): string => `${HUB_ORIGIN}/${EMBED_MODEL.onnx}/resolve/${EMBED_MODEL.revision}/${path}`;

const sum = (files: readonly PinnedFile[]) => files.reduce((n, f) => n + f.bytes, 0);
/** Bytes the browser fetches from the hub, and from this site, after the button is pressed. */
export const HUB_BYTES = sum(MODEL_FILES);
export const SITE_BYTES = RUNTIME.file.bytes;
export const DOWNLOAD_BYTES = HUB_BYTES + SITE_BYTES;

/** Megabytes (10^6 bytes), one decimal below 100, whole from 100 up: "66.7 MB", "82 MB" with `whole`. */
export function megabytes(bytes: number, whole = false): string {
  const mb = bytes / 1e6;
  return `${whole || mb >= 100 ? Math.round(mb).toLocaleString('en-US') : mb.toFixed(1)} MB`;
}

/** The weights' size, the tokenizer's, and the runtime's, as the static form and the note say them. */
export const SIZES = {
  total: megabytes(DOWNLOAD_BYTES, true),
  weights: megabytes(MODEL_FILES[0].bytes),
  tokenizer: megabytes(HUB_BYTES - MODEL_FILES[0].bytes),
  runtime: megabytes(SITE_BYTES),
} as const;

// ---------------------------------------------------------------- the statement

/** How a step finds the stored vector it searches with: its first line matches one node by `$q`, and its search reads `<variable>.<property>`. */
export interface Binding {
  variable: string;
  label: string;
  key: string;
  property: string;
  /** The step's first line, as written. */
  line: string;
}

const FIRST_LINE = /^MATCH \(([A-Za-z_][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*) \{([A-Za-z_][A-Za-z0-9_]*): \$q\}\)$/;

/** The step's binding, or why it has none the element can replace. */
export function bindingOf(code: string): Binding | string {
  const line = code.split('\n')[0].trim();
  const m = FIRST_LINE.exec(line);
  if (!m) return 'its first line must match one node by the question text, as in `MATCH (question:Question {text: $q})`';
  const [, variable, label, key] = m;
  const reads = [...code.matchAll(new RegExp(`\\bFOR ${variable}\\.([A-Za-z_][A-Za-z0-9_]*)\\b`, 'g'))];
  if (reads.length !== 1) return `it must search \`FOR ${variable}.<property>\` exactly once, found ${reads.length}`;
  if (!/\bVECTOR INDEX\b/.test(code)) return 'it must search a `VECTOR INDEX`';
  if (/\$embedding\b/.test(code)) return 'it already uses `$embedding`, the parameter the element adds';
  return { variable, label, key, property: reads[0][1], line };
}

/** The line that takes the binding's place: the reader's vector under the same name and property. */
export const vectorLine = (b: Binding): string =>
  `WITH {${b.property}: vector($embedding, ${EMBED_MODEL.dimension}, FLOAT32)} AS ${b.variable}`;

/** The step with its first line replaced by `vectorLine`; every other line as the page wrote it. */
export function withVector(code: string, b: Binding): string {
  const lines = code.split('\n');
  return [vectorLine(b), ...lines.slice(1)].join('\n');
}

/** The statement that reads a stored vector back, to compare with the reader's. */
export const storedVector = (b: Binding): string => `MATCH (${b.variable}:${b.label} {${b.key}: $q}) RETURN ${b.variable}.${b.property} AS v`;

// ---------------------------------------------------------------- the arithmetic

/** CLS pooling, then L2 normalization: the first token's row of `[1, tokens, dimension]` hidden states, scaled to length 1. */
export function clsVector(hidden: ArrayLike<number>, dimension: number = EMBED_MODEL.dimension): number[] {
  const v = Array.from({ length: dimension }, (_, i) => Number(hidden[i]));
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
  if (!(norm > 0) || !Number.isFinite(norm)) throw new Error('the model returned a zero or non-finite vector');
  return v.map((x) => x / norm);
}

/** Cosine similarity of two vectors of one length. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) return Number.NaN;
  let dot = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return dot / Math.sqrt(x * y);
}

/** A stored vector as an envelope row carries it (`{dim, type, values}`), or a plain list; null otherwise. */
export function vectorValues(v: unknown): number[] | null {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray((v as { values?: unknown }).values) ? (v as { values: unknown[] }).values : null;
  return list && list.every((x) => typeof x === 'number') ? (list as number[]) : null;
}

/** Lowercase hex of a digest. */
export const hex = (bytes: ArrayBuffer): string => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

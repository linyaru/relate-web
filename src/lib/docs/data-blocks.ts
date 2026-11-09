// A docs page's ```json data=<name> blocks as files, and the stub a twin
// carries in place of a large one (ADR-0048).
//
// The build serves every block at /docs/<page>/data/<name>.json
// (src/pages/docs/[...block].json.ts): the block's text exactly as the page
// holds it and its cells run it, with no newline added, so the SHA-256 in a
// stub names the bytes the cells take. A twin inlines a block of up to
// INLINE_DATA_BYTES (the cookbook's line between a parameter block and a
// dataset, src/lib/cookbook/recipe.ts) and replaces a larger one with a stub
// fence (constructs.ts):
//
//   ```json data=<name> src=https://relatedb.ai/docs/<page>/data/<name>.json
//   {
//     "data_block": "<name>",
//     "inline": false,
//     "url": "https://relatedb.ai/docs/<page>/data/<name>.json",
//     "media_type": "application/json",
//     "bytes": <the endpoint's length in bytes>,
//     "sha256": "<the endpoint's SHA-256, hex>",
//     "shape": {"<top-level key>": "array of 40 objects", …},
//     "first": {"<key of an array>": <its first item, abbreviated>, …}
//   }
//   ```
//
// The stub is data, never instructions (ADR-0013): it names the block, says
// where its bytes are and what they are shaped like. In `first`, an array of
// more than ARRAY_ITEMS items or more than ARRAY_BYTES bytes of JSON, and an
// item still over ITEM_BYTES after that, is replaced by its description
// ("array of 384 numbers"). The playground's hand-off reads the fence's
// `src` and fetches the file (src/lib/cookbook/cells.ts twinCells).

import { createHash } from 'node:crypto';

import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { INLINE_DATA_BYTES } from '../cookbook/recipe.ts';
import { pageUrl } from './model.ts';

export { INLINE_DATA_BYTES };

/** In a stub's `first`: an array with more items than this is described, not shown. */
export const ARRAY_ITEMS = 8;
/** In a stub's `first`: an array whose JSON is longer than this is described, not shown. */
export const ARRAY_BYTES = 256;
/** In a stub's `first`: an item whose abbreviated JSON is still longer than this is described. */
export const ITEM_BYTES = 1024;

/** Where the build serves a page's data block (site path). */
export const dataBlockPath = (pageId: string, name: string) => `${pageUrl(pageId)}data/${name}.json`;

/** The data block's canonical URL, as the twin names it. */
export const dataBlockUrl = (pageId: string, name: string) => `${CANONICAL_ORIGIN}${dataBlockPath(pageId, name)}`;

/** The bytes the build serves for a block: its text as the page holds it, nothing added. */
export const dataBlockBytes = (text: string): Buffer => Buffer.from(text, 'utf8');

/** Whether the twin carries the block itself (true) or a stub linking it. */
export const inlinedInTwin = (text: string) => dataBlockBytes(text).length <= INLINE_DATA_BYTES;

export const sha256Hex = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export interface DataStub {
  data_block: string;
  inline: false;
  url: string;
  media_type: 'application/json';
  bytes: number;
  sha256: string;
  shape: Record<string, string>;
  first: Record<string, unknown>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

/** A value's type in words: "array of 40 objects", "object with keys id, text", "string". */
export function describe(v: unknown): string {
  if (Array.isArray(v)) {
    const kinds = new Set(v.map(kindOf));
    const kind = kinds.size === 1 ? [...kinds][0] : 'item';
    const nouns: Record<string, [string, string]> = {
      number: ['number', 'numbers'],
      string: ['string', 'strings'],
      boolean: ['boolean', 'booleans'],
      object: ['object', 'objects'],
      array: ['array', 'arrays'],
      null: ['null', 'nulls'],
      item: ['item', 'items'],
    };
    return `array of ${plural(v.length, ...(nouns[kind] ?? nouns.item))}`;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? `object with keys ${keys.join(', ')}` : 'empty object';
  }
  return kindOf(v);
}

/** A value for a stub's `first`: large arrays replaced by their description, objects walked. */
function abbreviate(v: unknown): unknown {
  if (Array.isArray(v)) {
    if (v.length > ARRAY_ITEMS || JSON.stringify(v).length > ARRAY_BYTES) return describe(v);
    return v.map(abbreviate);
  }
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, abbreviate(x)]));
  }
  return v;
}

/** The `shape` and `first` of a data block's parsed JSON object. */
export function summarize(value: Record<string, unknown>): { shape: Record<string, string>; first: Record<string, unknown> } {
  const shape: Record<string, string> = {};
  const first: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    shape[key] = describe(v);
    if (Array.isArray(v) && v.length) {
      const item = abbreviate(v[0]);
      first[key] = JSON.stringify(item).length > ITEM_BYTES ? describe(v[0]) : item;
    }
  }
  return { shape, first };
}

/** The stub for page `pageId`'s block `name` with text `text` (a JSON object: collectCells checks it). */
export function dataStub(pageId: string, name: string, text: string): DataStub {
  const bytes = dataBlockBytes(text);
  const { shape, first } = summarize(JSON.parse(text) as Record<string, unknown>);
  return {
    data_block: name,
    inline: false,
    url: dataBlockUrl(pageId, name),
    media_type: 'application/json',
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
    shape,
    first,
  };
}

/** The stub's text: one top-level key per line, each value as compact JSON. */
export function stubText(stub: DataStub): string {
  const lines = Object.entries(stub).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')}\n}`;
}

/** The stub fence's info string after `json`. */
export const stubMeta = (stub: DataStub) => `data=${stub.data_block} src=${stub.url}`;

/**
 * What is wrong with a stub fence (its meta after `json` and its text) for a
 * block whose bytes are `bytes`, on page `pageId`: the fence must name the
 * block and its URL, and its size and SHA-256 must be those bytes'. Empty
 * when it is right.
 */
export function stubProblems(pageId: string, name: string, meta: string, text: string, bytes: Uint8Array): string[] {
  const out: string[] = [];
  const url = dataBlockUrl(pageId, name);
  if (meta.trim() !== `data=${name} src=${url}`) out.push(`the stub fence of \`${name}\` says \`json ${meta.trim()}\`, not \`json data=${name} src=${url}\``);
  let stub: Partial<DataStub>;
  try {
    stub = JSON.parse(text) as Partial<DataStub>;
  } catch (e) {
    return [...out, `the stub of \`${name}\` is not JSON: ${(e as Error).message}`];
  }
  if (stub.data_block !== name) out.push(`the stub of \`${name}\` names data_block ${JSON.stringify(stub.data_block)}`);
  if (stub.url !== url) out.push(`the stub of \`${name}\` links ${JSON.stringify(stub.url)}, not ${url}`);
  if (stub.bytes !== bytes.length) out.push(`the stub of \`${name}\` says ${String(stub.bytes)} bytes; the block is ${bytes.length}`);
  const sha = sha256Hex(bytes);
  if (stub.sha256 !== sha) out.push(`the stub of \`${name}\` says sha256 ${String(stub.sha256)}; the block's is ${sha}`);
  return out;
}

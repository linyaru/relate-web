// Shared by the unit tests (node --test, type stripping): the site's WASM
// (public/wasm) in Node, through the same factory glue the bundle writes, so
// the tests need neither the site build nor generated/.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { factoryGlue } from '../scripts/seed.ts';

export const ROOT = resolve(import.meta.dirname, '../../..');
const WASM = join(ROOT, 'public/wasm');

export interface Glue {
  initSync(options: { module: WebAssembly.Module }): unknown;
  RelateDb: new () => { execute(q: string, p: string | null): string; executeScript(s: string, p: string | null): string[]; free(): void };
}

let cached: { module: WebAssembly.Module; createRelate: (c: unknown) => Glue; isWasmTrap: (e: unknown) => boolean } | null = null;

export async function wasm() {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), 'docs-mcp-test-'));
  writeFileSync(join(dir, 'relate-factory.js'), factoryGlue(readFileSync(join(WASM, 'relate.js'), 'utf8')));
  cpSync(join(WASM, 'snippets'), join(dir, 'snippets'), { recursive: true });
  const { createRelate } = (await import(pathToFileURL(join(dir, 'relate-factory.js')).href)) as { createRelate: (c: unknown) => Glue };
  const { isWasmTrap } = (await import(pathToFileURL(join(WASM, 'trap.js')).href)) as { isWasmTrap: (e: unknown) => boolean };
  // Node compiles the module from bytes; workerd cannot (its types declare the constructor abstract).
  const Module = WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module;
  cached = { module: new Module(readFileSync(join(WASM, 'relate_bg.wasm'))), createRelate, isWasmTrap };
  return cached;
}

export const quiet = { error() {}, warn() {}, log() {} };

/** A new WebAssembly instance with an empty in-memory store. */
export async function freshDb() {
  const w = await wasm();
  const glue = w.createRelate(quiet);
  glue.initSync({ module: w.module });
  return new glue.RelateDb();
}

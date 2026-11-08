// Module types for what wrangler's bundler imports (wrangler.jsonc `rules`).

declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '*.cypher' {
  const text: string;
  export default text;
}

declare module '*/generated/wasm/trap.js' {
  export function isWasmTrap(err: unknown): boolean;
}

declare module '*.txt' {
  const text: string;
  export default text;
}

declare module '*/generated/wasm/relate-factory.js' {
  import type { RelateDb } from '../generated/wasm/relate.js';
  export function createRelate(console: Pick<Console, 'error' | 'warn' | 'log'>): {
    initSync(options: { module: WebAssembly.Module }): unknown;
    RelateDb: typeof RelateDb;
  };
}

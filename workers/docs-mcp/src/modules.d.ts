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

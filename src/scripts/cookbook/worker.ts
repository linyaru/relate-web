// Engine worker for cookbook pages. Owns the page's one in-memory database.
// Running the engine here, not on the page's thread, is what makes Stop
// possible: there is no query timeout, so the page terminates this worker to
// end a runaway query.
//
// Messages in:  {id, type: 'init'}
//               {id, type: 'run', code, params}   params: JSON text or null
//               {id, type: 'reset'}
// Messages out: {id, ok: true, loadMs}                              (init)
//               {id, ok: true, envelopes, recording, ms}            (run)
//               {id, ok: true}                                      (reset)
//               {id, ok: false, trap, message}                      (any failure)
//
// A step runs through the engine's own script runner (`executeScript`) and is
// rendered by `renderResult`, the code `npm run cookbook:check` records with;
// `envelopes` are the engine's wire JSON text per statement.
//
// The engine is public/wasm, loaded at runtime from /wasm/ so Vite never
// bundles or rewrites it (CLAUDE.md).

interface Db {
  executeScript(script: string, params: string | null): string[];
  reset(): void;
}

type Message = { id: number; type: 'init' } | { id: number; type: 'reset' } | { id: number; type: 'run'; code: string; params: string | null };

// The worker global, typed as much as this file uses (the project's DOM types
// describe a window).
const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Message>) => void) | null;
};

const wasmModule = (file: string) => new URL(`/wasm/${file}`, self.location.origin).href;

let db: Db | null = null;
let renderResult: (envelopes: string[]) => string;
let isWasmTrap: (err: unknown) => boolean;

const ready = (async () => {
  const t0 = performance.now();
  const [relate, trap] = await Promise.all([
    import(/* @vite-ignore */ wasmModule('relate.js')),
    import(/* @vite-ignore */ wasmModule('trap.js')),
  ]);
  await relate.default();
  db = new relate.RelateDb() as Db;
  renderResult = relate.renderResult;
  isWasmTrap = trap.isWasmTrap;
  return performance.now() - t0;
})();

scope.onmessage = async (event) => {
  const msg = event.data;
  try {
    const loadMs = await ready;
    if (msg.type === 'init') {
      scope.postMessage({ id: msg.id, ok: true, loadMs });
    } else if (msg.type === 'reset') {
      db!.reset();
      scope.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'run') {
      const t0 = performance.now();
      const envelopes = db!.executeScript(msg.code, msg.params);
      const recording = JSON.parse(renderResult(envelopes));
      scope.postMessage({ id: msg.id, ok: true, envelopes, recording, ms: performance.now() - t0 });
    } else {
      throw new Error(`unknown message type ${(msg as { type: string }).type}`);
    }
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    scope.postMessage({ id: msg.id, ok: false, trap: isWasmTrap?.(err) ?? false, message });
  }
};

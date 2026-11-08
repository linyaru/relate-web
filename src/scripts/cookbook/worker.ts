// Engine worker for cookbook and docs pages (session.ts). Owns the page's one
// in-memory database.
// Running the engine here, not on the page's thread, is what makes Stop
// possible: there is no query timeout, so the page terminates this worker to
// end a runaway query.
//
// Messages in:  {id, type: 'init'}
//               {id, type: 'run', code, params}   params: JSON text or null
//               {id, type: 'reset'}
//               {id, type: 'run-read-only', code, params}   a fresh read-only database, freed after
// Messages out: {id, ok: true, loadMs, version}                     (init)
//               {id, ok: true, envelopes, recording, ms}            (run, run-read-only)
//               {id, ok: true}                                      (reset)
//               {id, ok: false, trap, message}                      (any failure)
//
// A step runs through the engine's own script runner (`executeScript`) and is
// rendered by `renderResult`, the code `npm run cookbook:check` records with;
// `envelopes` are the engine's wire JSON text per statement.
//
// `version` is the engine's relate version, from `dbms.components()` on a
// throwaway database (null if it does not say), for the status bar.
//
// `run-read-only` is for interactive elements (src/scripts/docs/element-api.ts
// PageApi.runReadOnly): `new RelateDb(true)` is an empty in-memory database
// that refuses writes, made for the one script and freed after it, so the
// page's database never sees the statement. Both live in one wasm module
// instance, though: a trap in the read-only run poisons it, and the session
// discards this worker and the page's database with it, as after any trap.
//
// The engine is public/wasm, loaded at runtime from /wasm/ so Vite never
// bundles or rewrites it (CLAUDE.md).

interface Db {
  executeScript(script: string, params: string | null): string[];
  reset(): void;
  free(): void;
}

type Message =
  | { id: number; type: 'init' }
  | { id: number; type: 'reset' }
  | { id: number; type: 'run' | 'run-read-only'; code: string; params: string | null };

// The worker global, typed as much as this file uses (the project's DOM types
// describe a window).
const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<Message>) => void) | null;
};

const wasmModule = (file: string) => new URL(`/wasm/${file}`, self.location.origin).href;

let db: Db | null = null;
let readOnlyDb: (() => Db) | null = null;
let version: string | null = null;
let renderResult: (envelopes: string[]) => string;
let isWasmTrap: (err: unknown) => boolean;

const ready = (async () => {
  const t0 = performance.now();
  const [relate, trap] = await Promise.all([
    import(/* @vite-ignore */ wasmModule('relate.js')),
    import(/* @vite-ignore */ wasmModule('trap.js')),
  ]);
  await relate.default();
  isWasmTrap = trap.isWasmTrap;
  renderResult = relate.renderResult;
  db = new relate.RelateDb() as Db;
  readOnlyDb = () => new relate.RelateDb(true) as Db;
  // The version is only a label: a probe that fails leaves it null, but a
  // probe that traps poisons the module instance, so the trap propagates and
  // the session discards this worker (as after any trap).
  let probe: Db | null = null;
  try {
    probe = new relate.RelateDb() as Db;
    const [env] = probe.executeScript("CALL dbms.components() YIELD name, versions WHERE name = 'Relate' RETURN versions[0] AS v", null);
    const v = JSON.parse(env)?.rows?.[0]?.v;
    version = typeof v === 'string' ? v : null;
  } catch (err) {
    if (isWasmTrap(err)) throw err;
    version = null;
  } finally {
    try {
      probe?.free();
    } catch {
      // Freeing a probe that never ran cannot leave anything behind.
    }
  }
  return performance.now() - t0;
})();

scope.onmessage = async (event) => {
  const msg = event.data;
  try {
    const loadMs = await ready;
    if (msg.type === 'init') {
      scope.postMessage({ id: msg.id, ok: true, loadMs, version });
    } else if (msg.type === 'reset') {
      db!.reset();
      scope.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'run') {
      const t0 = performance.now();
      const envelopes = db!.executeScript(msg.code, msg.params);
      const recording = JSON.parse(renderResult(envelopes));
      scope.postMessage({ id: msg.id, ok: true, envelopes, recording, ms: performance.now() - t0 });
    } else if (msg.type === 'run-read-only') {
      const t0 = performance.now();
      const ro = readOnlyDb!();
      let envelopes: string[];
      try {
        envelopes = ro.executeScript(msg.code, msg.params);
      } finally {
        try {
          ro.free();
        } catch {
          // After a trap the module is gone anyway; the trap is what reports.
        }
      }
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

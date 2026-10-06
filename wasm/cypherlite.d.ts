/* tslint:disable */
/* eslint-disable */

/**
 * Opaque handle to a Cypherlite database with one connection.
 *
 * `new` is in-memory. [`CypherliteDb::open`] is an OPFS database (ADR-0145).
 */
export class CypherliteDb {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Run a script of one or more statements (`cypherlite::run_script_wire`,
     * ADR-0131): one envelope per statement run, stopping after the first
     * error; none for a blank or comment-only script.
     */
    executeScript(script: string, params_json?: string | null): string[];
    /**
     * Run one statement (`cypherlite::execute_wire`): its wire envelope.
     */
    execute(query: string, params_json?: string | null): string;
    constructor();
    /**
     * Open `opfs://<name>` in a dedicated worker (ADR-0145).
     *
     * `<name>` is one segment of 1–64 characters from `[A-Za-z0-9_-]`.
     * On the page thread this rejects before touching OPFS.
     */
    static open(uri: string): Promise<CypherliteDb>;
    reset(): void;
}

export function __start(): void;

/**
 * Render a script's envelopes (JSON strings, as `executeScript` returns
 * them) as a recording (ADR-0131, ADR-0132): JSON `{kind, text, table,
 * graph, stats}` from `cypherlite_formatter::recording`, the renderer the
 * native cookbook harness uses. Throws on an envelope that is not wire JSON.
 */
export function renderResult(envelopes: string[]): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __start: () => void;
    readonly __wbg_cypherlitedb_free: (a: number, b: number) => void;
    readonly cypherlitedb_execute: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly cypherlitedb_executeScript: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly cypherlitedb_new: (a: number) => void;
    readonly cypherlitedb_open: (a: number, b: number) => number;
    readonly cypherlitedb_reset: (a: number, b: number) => void;
    readonly renderResult: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_14126: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_14142: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

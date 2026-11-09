// The interactive-element API (DOCS-PLAN.md §7, the docs README "Interactive
// elements"): what a lazily loaded element module receives. Types only, so
// importing it costs a module nothing; the implementation is the cell
// runtime's (src/scripts/cookbook/session.ts `pageApi`) and the element
// loader's (src/scripts/docs/elements.ts).
//
// An element module is src/scripts/docs/elements/<name>.ts. It exports
// `mount(ctx)` (and, for an engine-bar toggle, `barToggle(on, ctx)`), and
// imports its own CSS as text (`import styles from './<name>.css?inline'`)
// and hands it to `ctx.adoptStyles(styles)`, so the CSS ships inside the
// lazy chunk. A plain `import './<name>.css'` would not: the build hoists
// the CSS of every module a page script can reach into every docs page.
// The loader imports it when the element's host comes within 600 px of the
// viewport or the reader points at, touches or focuses it; never with the
// page. The engine (public/wasm) loads only when the module asks for it
// (`page.run`, `page.runReadOnly` or `page.engineReady`), and NVL only
// through `page.graph()`.

import type { Graph } from '../../lib/cookbook/graph-model.ts';
import type { TableCells } from '../../lib/cookbook/result-view.ts';
import type { GraphView } from '../cookbook/graph.ts';

export type { GraphView };

/** One operator of an engine plan (`relate.plan/v1`). `actual` is null for EXPLAIN; PROFILE fills it. */
export interface PlanOperator {
  operator: string;
  details: string;
  identifiers: string[];
  estimated_rows: number | null;
  warnings: unknown[];
  children: PlanOperator[];
  actual: null | ({
    db_hits?: number;
    rows?: number;
    time_ms?: number;
    total_time_ms?: number;
    seek_ms?: number;
    walk_ms?: number;
    memory_bytes?: number;
    node_reads?: number;
    neighbor_walks?: number;
  } & Record<string, unknown>);
}

/** The plan document an EXPLAIN or PROFILE envelope carries. */
export interface PlanDocument {
  schema?: string;
  profiled: boolean;
  statement: string;
  root: PlanOperator;
}

/** One statement's wire envelope, as the engine returns it, timings included (a live run keeps them; a recording does not). */
export interface Envelope {
  columns: string[];
  columnTypes: string[];
  rows: Record<string, unknown>[];
  stats: Record<string, unknown> | null;
  notifications: Record<string, unknown>[];
  error: string | null;
  plan: PlanDocument | null;
  elapsed_ms: number;
  parse_ms: number;
  plan_ms: number;
  execute_ms: number;
}

/** A run's recording, rendered by the engine's own renderer (what a cell shows). */
export interface Recording {
  kind: 'table' | 'gram';
  text: string;
  table: TableCells | null;
  graph: Graph | null;
}

/** What `run` and `runReadOnly` resolve to, and what `onResult` hears. */
export interface ElementRun {
  /** One envelope per statement run (a script stops after its first error), parsed. */
  envelopes: Envelope[];
  /** The same envelopes as the engine's JSON text. */
  text: string[];
  recording: Recording;
  /** Wall time in the worker, ms, from the run that produced it. */
  ms: number;
  /** The last envelope's error, or null. */
  error: string | null;
}

/** A runnable cell on the page. */
export interface CellHandle {
  id: string;
  /** 1-based, in page order. */
  index: number;
  /** The <cypher-cell>. */
  element: HTMLElement;
  /** The element words on its info string (`timing` → '', `layout=force` → 'force'). */
  words: Record<string, string>;
  /** The Cypher a Run would send now (the edited text while the reader edits). */
  code(): string;
  /** The Cypher as the page wrote it, which the recording belongs to, whatever the reader has typed. */
  authoredCode(): string;
  /** The parameters a Run would send now (JSON text), or null. */
  params(): string | null;
  /** The recorded result as text, and its kind. */
  recordedText: string;
  recordedKind: 'table' | 'gram';
  /** The recorded `{envelope, graph}` (envelope without timings). */
  recorded(): Promise<{ envelope: unknown; graph: Graph | null }>;
  state(): 'recorded' | 'running' | 'live' | 'error' | 'blocked';
  /**
   * The run whose result the cell shows now, timings included, or null while
   * it shows its recording or a failed run. A module that mounts after the
   * reader ran the cell draws from it instead of waiting for the next run.
   */
  lastRun(): ElementRun | null;
  /**
   * A pane at the end of the cell's output for an element to fill, created on
   * first use inside the output's live region: one per `name`
   * (`div.cell-slot-pane[data-slot=<name>]` inside `.cell-slot`), so two
   * modules on one cell never write over each other. A cell word's module
   * gets `slot(<module name>)` as its `ctx.live`.
   */
  slot(name?: string): HTMLElement;
  /** The graph view the cell shows now (graph.ts), or null when it shows none or it failed to draw. Never draws one. */
  graphView(): Promise<GraphView | null>;
  /**
   * Hear the cell's graph view: called first with the view the cell already
   * shows, if one is drawn, then with each new view it draws (the
   * recording's once it comes near the viewport, a run's, a Reset's), and
   * with null when the cell drops its view. Each view is heard once, so one
   * listener is all a module needs. An expansion grows the same view and is
   * not a change. Returns the function that stops listening.
   */
  onGraph(listener: (view: GraphView | null) => void): () => void;
}

export interface CellResult extends ElementRun {
  cell: CellHandle;
  /** How the run went other than the page says (an error where none is expected, or the reverse), or null. */
  problem: string | null;
}

export interface EngineInfo {
  version: string | null;
  loadMs: number;
}

/** The page: one engine and one database, shared with the cells (DOCS-PLAN.md §7.2). */
export interface PageApi {
  /**
   * Run `code` (one script; `params` JSON text) on the page's database
   * through the cells' exclusive lock: Run buttons disable, Stop aborts it,
   * and it waits for a run in progress (a cell run, another element's run).
   * Runs never overlap, so concurrent calls run one after another, in no
   * promised order. `upTo` first runs the cells that have not run, up to and
   * including that cell id; 'all' (the default) runs them all; null runs
   * none. Rejects when a cell it needed failed, on Stop, or when the engine
   * crashed; a statement error resolves (`error`).
   */
  run(code: string, params?: string | null, options?: { upTo?: string | 'all' | null }): Promise<ElementRun>;
  /**
   * Run `code` on a fresh read-only in-memory database (`new RelateDb(true)`),
   * through the same lock, then free it. It is empty: a read-only in-memory
   * instance refuses every write, so the page's cells cannot seed it. The
   * refusal (WriteOnReadOnlyAccessDatabase, 42N18) comes when a write
   * executes, not at plan time, so only a statement that writes
   * unconditionally (`CREATE`, `MERGE`, `CREATE INDEX`) shows it here;
   * `MATCH (n:X) SET …` matches nothing and succeeds.
   *
   * A seeded read-only database is possible in the shipped WASM through
   * OPFS (open `opfs://<name>` writable, seed, free, reopen it read-only),
   * but it writes to the reader's browser storage, which the framework ADR
   * declines; an element that needs one raises a request.
   *
   * The statement shares the one wasm module instance with the page's
   * database: a trap here discards the worker, and the page's database with
   * it, as after any trap (onReset fires, the cells go back to their
   * recordings).
   */
  runReadOnly(code: string, params?: string | null): Promise<ElementRun>;
  /** Hear every cell run: its id, envelopes and ms. Returns the function that stops listening. */
  onResult(listener: (result: CellResult) => void): () => void;
  /** Hear the database go: Reset, Stop, a crash. Every cell is back on its recording. */
  onReset(listener: () => void): () => void;
  cells(): CellHandle[];
  cell(id: string): CellHandle | null;
  /** Start the engine if it is not running; resolves once it is ready. */
  engineReady(): Promise<EngineInfo>;
  /** The running engine, or null; never starts it. */
  engine(): EngineInfo | null;
  /** Whether a run holds the lock. */
  busy(): boolean;
  /** The engine bar: `say` replaces its status line (the next engine event replaces it again). */
  status: { bar: HTMLElement; say(text: string): void };
  /** prefers-reduced-motion, read now; `onReducedMotion` hears it change. Layout animation stops under it. */
  readonly reducedMotion: boolean;
  onReducedMotion(listener: (reduced: boolean) => void): () => void;
  /** The one graph module (NVL, canvas renderer), loaded on first call. */
  graph(): Promise<typeof import('../cookbook/graph.ts')>;
}

/** What an element module's `mount` receives. */
export interface ElementContext {
  /** The element's name (the directive, or the cell word's module). */
  name: string;
  /** Its id on the page (`id=` on the directive, else `<name>-<n>`; a cell's id for a cell word). */
  id: string;
  /** The host: <docs-element> for a directive, the <cypher-cell> for a cell word. */
  host: HTMLElement;
  /** The directive's attributes, or the cell's element words. */
  attrs: Record<string, string>;
  /** The static form (.element-static), shown until `showLive()`; null for a cell word. */
  staticForm: HTMLElement | null;
  /** The pane to render into: .element-live (hidden until `showLive()`), or the cell's slot. */
  live: HTMLElement;
  /** Hide the static form and show the live pane; call once the live element has something to show. */
  showLive(): void;
  /** Back to the static form (the live pane hides). */
  showStatic(): void;
  /** Put the element's CSS on the page once (`import styles from './<name>.css?inline'`); later calls with the same name do nothing. */
  adoptStyles(css: string): void;
  /** The cell, for a cell word; null for a directive. */
  cell: CellHandle | null;
  page: PageApi;
  /**
   * Aborted when the page is unloaded (pagehide that does not keep the page
   * in the back/forward cache); `mount`'s returned function runs then too. A
   * page kept in that cache keeps its elements as they are, and they go on
   * working when the reader comes back.
   */
  signal: AbortSignal;
}

/** What an engine-bar toggle's `barToggle` receives. */
export interface BarContext {
  button: HTMLButtonElement;
  adoptStyles(css: string): void;
  page: PageApi;
  signal: AbortSignal;
}

/** An element module's exports. */
export interface ElementModule {
  mount?: (ctx: ElementContext) => void | (() => void) | Promise<void | (() => void)>;
  /** For an engine-bar toggle (`data-bar-element="<name>"` on the bar): called on each press, `on` the new state. */
  barToggle?: (on: boolean, ctx: BarContext) => void | Promise<void>;
}

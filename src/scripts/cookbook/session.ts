// The runnable-cell runtime shared by cookbook recipe pages (runtime.ts) and
// docs pages (src/scripts/docs/runtime.ts). Ported from the Relate
// repository's scripts/cookbook/runtime/cookbook.js.
//
// Pages are complete without this script: code and recorded outputs are
// static HTML. `startCells(options)` upgrades each <cypher-cell> in place:
//
// - The engine is a module Web Worker (worker.ts) started on the first Run,
//   never on page load. Nothing runs without a click.
// - All cells on a page share one database. Running a cell first runs the
//   earlier cells that have not run yet, in order, and stops at the first
//   that goes other than its page says (src/lib/cookbook/cells.ts).
// - Stop terminates the worker (there is no query timeout); Reset empties the
//   database. Either way every cell goes back to its recorded output.
// - Parameters are sent to the engine as the JSON text the page holds (or
//   the reader typed), never re-serialized, so 1.0 stays a float.
// - Recorded results' envelopes and graphs come from `options.recorded()`
//   the first time a graph or JSON view needs one.
// - A graph (gram) result opens in the graph view (graph.ts, NVL), loaded only
//   when one comes near the viewport. A double-click on a node adds its
//   neighbours from the page's database, running the cells it needs first
//   (ADR-0151).
// - Interactive elements on docs pages (src/scripts/docs/elements.ts) share
//   the engine, the database and the exclusive lock through `pageApi()`
//   (the API is typed in src/scripts/docs/element-api.ts); `startCells`
//   returns it. Nothing in it runs until an element asks.

import { failed, surprise, type LastEnvelope } from '../../lib/cookbook/cells.ts';
import { expandNode, type Graph } from '../../lib/cookbook/graph-model.ts';
import { canDraw, lastEnvelope, tableHtml, type TableCells } from '../../lib/cookbook/result-view.ts';
import type { GraphView, Outcome } from './graph.ts';
import type { CellHandle, CellResult, ElementRun, EngineInfo, Envelope, PageApi, ScratchDb } from '../docs/element-api.ts';

/** How a page starts its cells. */
export interface CellsOptions {
  /** Where a cell's `data-params` file resolves. */
  base: URL;
  /** The page's recorded `{envelope, graph}`, by cell id. */
  recorded: () => Promise<Record<string, Data>>;
  /** What the page calls a cell in messages ("step", "cell"). */
  noun: string;
  /** The status bar's line once the engine is ready; the cookbook's by default. */
  ready?: (detail: { loadMs: number; version: string | null }) => string;
}

// ---------------------------------------------------------------- engine

/** The database is gone: the reader pressed Stop, or the engine crashed. */
class StoppedError extends Error {}
class CrashedError extends StoppedError {}

interface Recording {
  kind: 'table' | 'gram';
  text: string;
  table: TableCells | null;
  graph: Graph | null;
}

export interface RunReply {
  envelopes: string[];
  recording: Recording;
  ms: number;
}

type Status = 'idle' | 'loading' | 'ready' | 'stopped' | 'crashed' | 'failed' | 'emptied';

interface Pending {
  resolve: (reply: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

/**
 * The engine worker. `start()` creates it; nothing else does, so a
 * continuation left over from a stopped run fails instead of quietly starting
 * a new database. The worker ends one way, `discard()`, which sets the status
 * and fires `discarded`: whatever the database held is gone.
 */
class Engine extends EventTarget {
  worker: Worker | null = null;
  starting: Promise<void> | null = null;
  pending = new Map<number, Pending>();
  seq = 0;
  /** The worker's name in the browser's tools: the page's engine is `relate`, an element's own database another. */
  name: string;
  /** The engine's relate version once it is ready, or null. */
  version: string | null = null;

  constructor(name = 'relate') {
    super();
    this.name = name;
  }

  setStatus(status: Status, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent('status', { detail: { status, ...detail } }));
  }

  /** Start the worker unless it runs; resolves once the engine is ready. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: this.name });
    this.worker.onmessage = (e: MessageEvent) => {
      const { id, ...rest } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (rest.ok) p.resolve(rest);
      else p.reject(Object.assign(new Error(rest.message), { trap: rest.trap }));
    };
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.discard('failed', new Error(`The engine failed to load: ${e.message || 'network or module error'}`));
    };
    this.setStatus('loading');
    this.starting = this.call({ type: 'init' }).then(
      (r) => {
        this.version = (r.version as string | null) ?? null;
        this.setStatus('ready', { loadMs: r.loadMs, version: this.version });
      },
      (err) => {
        if (!(err instanceof StoppedError)) this.discard('failed', err);
        throw err;
      },
    );
    return this.starting;
  }

  /** Send `msg` to the running worker. A trap discards it. */
  async call(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    const worker = this.worker;
    if (!worker) throw new StoppedError('The engine is not running.');
    const id = ++this.seq;
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({ ...msg, id });
      });
    } catch (err) {
      if (!(err as { trap?: boolean }).trap) throw err;
      // A trapped wasm instance cannot be reused; start over next time.
      const crashed = new CrashedError(`The engine crashed (${(err as Error).message}). The database was discarded.`);
      this.discard('crashed', crashed);
      throw crashed;
    }
  }

  /** End the worker: everything in flight fails with `reason`. */
  discard(status: Status, reason: Error) {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.starting = null;
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    this.setStatus(status);
    this.dispatchEvent(new Event('discarded'));
  }

  run(code: string, params: string | null) {
    return this.call({ type: 'run', code, params }) as unknown as Promise<RunReply>;
  }

  /**
   * Run on a fresh read-only in-memory database in the worker, freed after.
   * The page's database does not see the statement, but it shares the one
   * wasm module instance: a trap here discards the worker, and with it the
   * page's database, as after any trap.
   */
  runReadOnly(code: string, params: string | null) {
    return this.call({ type: 'run-read-only', code, params }) as unknown as Promise<RunReply>;
  }

  /** Run without rendering a recording (an element's own database: its results can be large); the reply adds the engine's memory. */
  runBare(code: string, params: string | null) {
    return this.call({ type: 'run', code, params, bare: true }) as unknown as Promise<{ envelopes: string[]; ms: number; memory: number | null }>;
  }

  async reset() {
    if (this.worker) await this.call({ type: 'reset' });
  }

  stop() {
    this.discard('stopped', new StoppedError('Stopped.'));
  }
}

// ---------------------------------------------------------------- session

type StatusDetail = { status: Status; loadMs?: number; version?: string | null };

const messages = (noun: string, ready?: CellsOptions['ready']): Partial<Record<Status, (detail: StatusDetail) => string>> => ({
  loading: () => 'Loading the engine…',
  ready: ({ loadMs = 0, version = null }) =>
    ready ? ready({ loadMs, version }) : `Engine ready (loaded in ${Math.round(loadMs)} ms). Every ${noun} runs in this tab.`,
  failed: () => `The engine failed to load; run a ${noun} to try again. The recorded outputs are still accurate.`,
  stopped: () => `Stopped. The database was discarded; run any ${noun} to start again.`,
  crashed: () => 'The engine crashed (a bug worth reporting). The database was discarded.',
  emptied: () => `Database emptied. Run any ${noun} to start again.`,
});

class Session {
  engine = new Engine();
  cells: CypherCell[] = [];
  done = new Set<CypherCell>();
  busy = false;
  /** The current run's AbortController. */
  current: AbortController | null = null;
  bar: HTMLElement;
  options: CellsOptions;
  messages: ReturnType<typeof messages>;
  /** The element API's listeners: every cell run, and every time the database goes. */
  resultListeners = new Set<(cell: CypherCell, reply: RunReply, problem: string | null) => void>();
  resetListeners = new Set<() => void>();
  idleWaiters: (() => void)[] = [];
  engineInfo: EngineInfo | null = null;

  constructor(bar: HTMLElement, options: CellsOptions) {
    this.bar = bar;
    this.options = options;
    this.messages = messages(options.noun, options.ready);
    this.engine.addEventListener('status', (e) => this.onStatus((e as CustomEvent).detail));
    // The database is gone, so nothing has run in it.
    this.engine.addEventListener('discarded', () => this.forget());
    bar.querySelector('[data-action=run-all]')?.addEventListener('click', () => this.runAll());
    bar.querySelector('[data-action=reset]')?.addEventListener('click', () => this.reset());
    bar.querySelector('[data-action=stop]')?.addEventListener('click', () => this.stop());
    // A quiet bar (a page whose elements need no engine, and no cells) shows
    // once something starts the engine, so Stop and Reset are within reach.
    if (!('quiet' in bar.dataset)) bar.hidden = false;
  }

  register(cell: CypherCell) {
    this.cells.push(cell);
  }

  onStatus(detail: StatusDetail) {
    this.bar.dataset.status = detail.status;
    if (detail.status === 'loading') this.bar.hidden = false;
    if (detail.status === 'ready') this.engineInfo = { version: detail.version ?? null, loadMs: detail.loadMs ?? 0 };
    else if (detail.status !== 'emptied') this.engineInfo = null;
    if (detail.version) this.bar.dataset.engineVersion = detail.version;
    const message = this.messages[detail.status];
    if (message) this.bar.querySelector('.engine-text')!.textContent = message(detail);
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    (this.bar.querySelector('[data-action=stop]') as HTMLButtonElement).hidden = !busy;
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('[data-action=run-all], [data-action=reset]')) {
      b.disabled = busy;
    }
    for (const c of this.cells) c.setBusy(busy);
    if (!busy) for (const wake of this.idleWaiters.splice(0)) wake();
  }

  /** Tell the element API's listeners about a cell's run. */
  emitResult(cell: CypherCell, reply: RunReply, problem: string | null) {
    for (const l of this.resultListeners) {
      try {
        l(cell, reply, problem);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /**
   * Run `code` for an element on the page's database, under the lock, after
   * the cells `upTo` names have run (see PageApi.run). Throws why not when it
   * could not run.
   */
  async runForElement(code: string, params: string | null, upTo: string | null, readOnly: boolean): Promise<RunReply> {
    const target = upTo === null ? null : upTo === 'all' ? (this.cells.at(-1) ?? null) : this.cells.find((c) => c.dataset.cell === upTo);
    if (target === undefined) throw new Error(`the page has no cell \`${upTo}\``);
    // Check and take the lock in one tick: nothing may await between the last
    // look at `busy` and exclusive()'s setBusy(true), or two waiters both see
    // it free and both run (each running the pending cells again).
    while (this.busy) await new Promise<void>((r) => this.idleWaiters.push(r));
    let reply: RunReply | null = null;
    const problem = await this.exclusive(async (signal) => {
      if (target) {
        const blocked = await this.bringUpTo(target, signal);
        if (blocked) return blocked;
      }
      await this.engine.start();
      if (signal.aborted) return 'stopped.';
      reply = readOnly ? await this.engine.runReadOnly(code, params) : await this.engine.run(code, params);
      return null;
    });
    if (problem !== null || reply === null) throw new Error(problem ?? 'stopped.');
    return reply;
  }

  /**
   * Run `task(signal)` while nothing else runs: Run and Reset are disabled
   * and Stop aborts `signal`. Resolves to what `task` returns, or to a
   * problem string when it throws. Every caller checks `busy` in the same
   * tick as it calls this, so the check and the take are one step.
   */
  async exclusive(task: (signal: AbortSignal) => Promise<string | null>): Promise<string | null> {
    if (this.busy) throw new Error('exclusive() called while a run holds the lock');
    this.setBusy(true);
    const run = (this.current = new AbortController());
    try {
      return await task(run.signal);
    } catch (err) {
      if (!(err instanceof StoppedError)) console.error(err);
      return (err as Error).message;
    } finally {
      if (this.current === run) {
        this.current = null;
        this.setBusy(false);
      }
    }
  }

  /**
   * Run every not-yet-run step up to and including `target`. Resolves to
   * null once they all ran as their recipe says, else to why not.
   */
  async bringUpTo(target: CypherCell, signal: AbortSignal): Promise<string | null> {
    const end = this.cells.indexOf(target);
    const todo = this.cells.slice(0, end + 1).filter((c) => !this.done.has(c));
    // Fetch every parameter file the run needs while the engine loads.
    const files = todo.map((c) => c.paramsFile());
    for (const f of files) f?.catch(() => {});
    let current: CypherCell | null = null;
    try {
      await this.engine.start();
      for (const [i, cell] of todo.entries()) {
        if (signal.aborted) return 'stopped.';
        current = cell;
        const problem = await cell.execute(this.engine, files[i], signal);
        if (signal.aborted) return 'stopped.';
        if (problem === null) {
          this.done.add(cell);
          continue;
        }
        if (cell === target) return `this ${this.options.noun} failed.`;
        target.showBlocked(cell);
        return `${this.options.noun} ${cell.dataset.step} failed.`;
      }
      return null;
    } catch (err) {
      if (err instanceof CrashedError) current?.showError(err.message);
      throw err;
    }
  }

  /** Run every not-yet-run step before `target`, then `target` itself. */
  runUpTo(target: CypherCell) {
    if (this.busy) return;
    this.done.delete(target);
    return this.exclusive((signal) => this.bringUpTo(target, signal));
  }

  /**
   * Node `id`'s neighbours in the page's database, for the graph view of
   * `cell` drawing the nodes `drawn`. The database needs the steps up to
   * `cell`, so those that have not run run first, as a Run would run them,
   * except that `cell` does not run again if it has (ADR-0151).
   */
  async expand(cell: CypherCell, id: number, drawn: number[]): Promise<Outcome> {
    if (this.busy) return { problem: 'wait for the run to finish.' };
    let found: Outcome | null = null;
    const problem = await this.exclusive(async (signal) => {
      const blocked = await this.bringUpTo(cell, signal);
      if (blocked) return blocked;
      found = { graph: await expandNode((code, params) => this.engine.run(code, params), id, drawn) };
      return null;
    });
    return problem ? { problem } : found!;
  }

  runAll() {
    return this.runUpTo(this.cells[this.cells.length - 1]);
  }

  forget() {
    this.done.clear();
    for (const c of this.cells) c.showRecorded();
    for (const l of this.resetListeners) {
      try {
        l();
      } catch (err) {
        console.error(err);
      }
    }
  }

  async reset() {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await this.engine.reset();
      this.forget();
      this.onStatus({ status: 'emptied' });
    } catch (err) {
      if (!(err instanceof StoppedError)) console.error(err);
    } finally {
      this.setBusy(false);
    }
  }

  stop() {
    this.current?.abort();
    this.current = null;
    this.engine.stop();
    this.setBusy(false);
  }
}

// ---------------------------------------------------------------- cells

const fetched = new Map<string, Promise<string>>();

/** `url`'s text, fetched once; a failed fetch is forgotten, so the next call tries again. */
export function fetchText(url: string): Promise<string> {
  let text = fetched.get(url);
  if (!text) {
    text = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    });
    fetched.set(url, text);
    text.catch(() => fetched.delete(url));
  }
  return text;
}

/** A result's `{envelope, graph}`: what the JSON and graph views show. */
export interface Data {
  envelope: LastEnvelope | unknown;
  graph: Graph | null;
}

// Graph results render when they come near the viewport, not on page load.
const nearViewport = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      nearViewport.unobserve(e.target);
      (e.target as CypherCell).revealGraph();
    }
  },
  { rootMargin: '600px 0px' },
);

/** What a step's output pane shows. `data` is undefined for a recording until a view needs it. */
interface Result {
  kind: 'table' | 'gram';
  text: string;
  tableHtml: string;
  /** Whether the graph view has anything to draw. */
  drawable: boolean;
  data?: Data;
}

function liveResult({ envelopes, recording }: RunReply): Result {
  return {
    kind: recording.kind,
    text: recording.text,
    tableHtml: recording.table ? tableHtml(recording.table) : '',
    drawable: canDraw(recording.graph),
    data: { envelope: lastEnvelope(envelopes), graph: recording.graph },
  };
}

const errorResult = (message: string): Result => ({
  kind: 'table',
  text: `error: ${message}`,
  tableHtml: '',
  drawable: false,
  data: { envelope: null, graph: null },
});

type View = 'text' | 'graph' | 'json';

/** The view a result opens in: a drawable gram result's graph, else its text. */
const defaultView = (result: Result): View => (result.kind === 'gram' && result.drawable ? 'graph' : 'text');

let session: Session | null = null;

class CypherCell extends HTMLElement {
  upgraded = false;
  session!: Session;
  editor!: HTMLTextAreaElement;
  codeView!: HTMLElement;
  paramsEditor!: HTMLTextAreaElement | null;
  outText!: HTMLElement;
  outTable!: HTMLElement;
  outLabel!: HTMLElement;
  outGraph!: HTMLElement;
  outJson!: HTMLElement;
  copyBtn!: HTMLButtonElement;
  tabs!: HTMLElement;
  runBtn!: HTMLButtonElement;
  editBtn!: HTMLButtonElement;
  expectError = false;
  recorded!: Result;
  result!: Result;
  view: View = 'text';
  /** The graph view of `result`, drawn once per result so expansions last while the reader switches tabs. */
  graph: { result: Result; view: Promise<GraphView | null> } | null = null;
  /** The element API's graph listeners (CellHandle.onGraph): a new view, or null when the view goes. */
  graphListeners = new Set<(view: GraphView | null) => void>();
  /** The current graph view once drawn (what a new onGraph listener hears first), else null. */
  drawnView: GraphView | null = null;
  /** The reply of the run on screen, or null while the step shows its recording or an error (CellHandle.lastRun). */
  lastReply: RunReply | null = null;

  connectedCallback() {
    if (this.upgraded || !session) return;
    this.upgraded = true;
    this.session = session;
    this.session.register(this);
    const q = <T extends Element>(sel: string) => this.querySelector(sel) as T;
    this.editor = q<HTMLTextAreaElement>('.cell-editor');
    this.codeView = q<HTMLElement>('.cell-code');
    this.paramsEditor = q<HTMLTextAreaElement>('.params-editor');
    this.outText = q<HTMLElement>('.out-text');
    this.outTable = q<HTMLElement>('.out-table');
    this.outLabel = q<HTMLElement>('.out-label');
    this.outGraph = q<HTMLElement>('.out-graph');
    this.outJson = q<HTMLElement>('.out-json');
    this.copyBtn = q<HTMLButtonElement>('.out-copy');
    this.tabs = q<HTMLElement>('.out-tabs');
    this.runBtn = q<HTMLButtonElement>('[data-action=run]');
    this.editBtn = q<HTMLButtonElement>('[data-action=edit]');
    this.expectError = this.hasAttribute('data-expect-error');
    // The recording, as the page shows it before anything runs.
    this.recorded = {
      kind: this.dataset.resultKind as Result['kind'],
      text: this.outText.textContent ?? '',
      tableHtml: this.outTable.innerHTML,
      drawable: this.hasAttribute('data-has-graph'),
    };
    this.result = this.recorded;
    this.view = defaultView(this.result);

    this.runBtn.hidden = false;
    this.editBtn.hidden = false;
    this.runBtn.addEventListener('click', () => this.session.runUpTo(this));
    this.editBtn.addEventListener('click', () => this.toggleEdit());
    this.editor.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.session.runUpTo(this);
      }
    });
    this.editor.addEventListener('input', () => this.fitEditor());
    for (const tab of this.tabs.querySelectorAll<HTMLElement>('[data-view]')) {
      tab.addEventListener('click', () => this.showView(tab.dataset.view as View));
    }
    this.renderTabs();
    if (this.view === 'graph') {
      // Keep the recorded text on screen until the graph is drawn.
      this.selectTab('graph');
      nearViewport.observe(this);
    } else {
      this.showView(this.view);
    }
  }

  revealGraph() {
    if (this.view === 'graph' && this.result === this.recorded) this.showView('graph');
  }

  /** Show `result` in `view`: its text or table, its tabs, and that view. */
  paint(result: Result, view: View) {
    if (result !== this.result) this.dropGraph();
    this.result = result;
    this.outText.textContent = result.text;
    this.outTable.innerHTML = result.tableHtml;
    this.renderTabs();
    this.showView(view);
  }

  get editing() {
    return !this.editor.hidden;
  }

  toggleEdit() {
    if (this.editing) {
      // Leaving edit mode restores the recipe's query.
      this.editor.value = this.editor.defaultValue;
      this.editor.hidden = true;
      this.codeView.hidden = false;
      this.editBtn.textContent = 'Edit';
    } else {
      this.editor.hidden = false;
      this.codeView.hidden = true;
      this.editBtn.textContent = 'Revert';
      this.fitEditor();
      this.editor.focus();
    }
  }

  fitEditor() {
    this.editor.style.height = 'auto';
    this.editor.style.height = `${this.editor.scrollHeight + 2}px`;
  }

  setBusy(busy: boolean) {
    this.runBtn.disabled = busy;
  }

  /** The fetch of this step's parameter file, if it loads one. */
  paramsFile(): Promise<string> | null {
    return this.dataset.params ? fetchText(new URL(this.dataset.params, this.session.options.base).href) : null;
  }

  /**
   * Run this step; `file` is its parameter file's fetch. Returns how the run
   * went other than the recipe says, or null.
   */
  async execute(engine: Engine, file: Promise<string> | null, signal: AbortSignal): Promise<string | null> {
    this.classList.add('is-running');
    this.classList.remove('is-error', 'is-blocked');
    this.outLabel.textContent = 'Running…';
    try {
      const params = this.paramsEditor ? this.paramsEditor.value : await file;
      if (signal.aborted) throw new StoppedError('Stopped.');
      const code = this.editing ? this.editor.value : this.editor.defaultValue;
      const res = await engine.run(code, params ?? null);
      const result = liveResult(res);
      const envelope = result.data!.envelope as LastEnvelope;
      const problem = surprise({ id: this.dataset.cell!, expectError: this.expectError }, envelope);
      const n = res.envelopes.length;
      const parts = [`Live · ${res.ms < 1 ? '<1' : Math.round(res.ms)} ms`];
      if (this.expectError) parts.unshift(failed(envelope) ? 'Expected error' : 'Expected an error, got none');
      if (n > 1) parts.push(`${n} statements`);
      const unchanged = !this.editing && !this.paramsEdited();
      if (unchanged && result.kind === this.recorded.kind && result.text === this.recorded.text) {
        parts.push('matches the recording');
      }
      this.outLabel.textContent = parts.join(' · ');
      this.classList.toggle('is-error', problem !== null);
      this.classList.add('is-live');
      this.lastReply = res;
      // A reader looking at the JSON goes on looking at it.
      this.paint(result, this.view === 'json' ? 'json' : defaultView(result));
      this.session.emitResult(this, res, problem);
      return problem;
    } catch (err) {
      if (err instanceof StoppedError) {
        this.showRecorded();
        throw err;
      }
      this.showError((err as Error).message);
      return (err as Error).message;
    } finally {
      this.classList.remove('is-running');
    }
  }

  paramsEdited() {
    return this.paramsEditor ? this.paramsEditor.value !== this.paramsEditor.defaultValue : false;
  }

  showError(message: string) {
    this.lastReply = null;
    this.outLabel.textContent = 'Could not run';
    this.classList.add('is-error');
    this.paint(errorResult(message), 'text');
  }

  showBlocked(culprit: CypherCell) {
    this.classList.add('is-blocked');
    this.outLabel.textContent = `Not run: ${this.session.options.noun} ${culprit.dataset.step} failed`;
  }

  showRecorded() {
    this.lastReply = null;
    this.classList.remove('is-live', 'is-error', 'is-blocked', 'is-running');
    this.outLabel.textContent = this.expectError ? 'Expected error' : 'Recorded result';
    this.paint(this.recorded, defaultView(this.recorded));
  }

  /** The Cypher as the page wrote it (CellHandle.authoredCode). */
  authoredCode() {
    return this.editor.defaultValue;
  }

  /** The Cypher a Run would send now. */
  currentCode() {
    return this.editing ? this.editor.value : this.editor.defaultValue;
  }

  /**
   * The element pane named `name` at the end of the output (PageApi
   * CellHandle.slot), made on first use: one per module, inside one
   * .cell-slot, so two modules on a cell never write over each other.
   */
  elementSlot(name: string): HTMLElement {
    const output = this.querySelector('.cell-output')!;
    let slot = output.querySelector<HTMLElement>(':scope > .cell-slot');
    if (!slot) {
      slot = Object.assign(document.createElement('div'), { className: 'cell-slot' });
      output.append(slot);
    }
    let pane = [...slot.children].find((c) => (c as HTMLElement).dataset.slot === name) as HTMLElement | undefined;
    if (!pane) {
      pane = Object.assign(document.createElement('div'), { className: 'cell-slot-pane' });
      pane.dataset.slot = name;
      slot.append(pane);
    }
    return pane;
  }

  /** Tell the element API's graph listeners about a new view, or null when the view went. */
  emitGraph(view: GraphView | null) {
    for (const l of this.graphListeners) {
      try {
        l(view);
      } catch (err) {
        console.error(err);
      }
    }
  }

  /** `{envelope, graph}` of the result on screen; the recording's come from results.json. */
  async data(): Promise<Data> {
    if (this.result !== this.recorded) return this.result.data!;
    return (await this.session.options.recorded())[this.dataset.cell!] ?? { envelope: null, graph: null };
  }

  renderTabs() {
    (this.tabs.querySelector('[data-view=graph]') as HTMLElement).hidden = !this.result.drawable;
    this.tabs.hidden = false;
    this.copyBtn.hidden = this.result.tableHtml === '';
  }

  selectTab(view: View) {
    for (const tab of this.tabs.querySelectorAll<HTMLElement>('[data-view]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.view === view));
    }
  }

  async showView(view: View) {
    this.view = view;
    const result = this.result;
    this.selectTab(view);
    const table = view === 'text' && result.tableHtml !== '';
    this.outTable.hidden = !table;
    this.outText.hidden = view !== 'text' || table;
    this.outJson.hidden = view !== 'json';
    this.outGraph.hidden = view !== 'graph';
    if (view === 'graph') {
      try {
        await this.graphView();
      } catch (err) {
        if (this.view === view && this.result === result) {
          const note = Object.assign(document.createElement('p'), { className: 'out-graph-error' });
          note.textContent = `Could not load the result: ${(err as Error).message}`;
          this.outGraph.replaceChildren(note);
        }
      }
      return;
    }
    if (view !== 'json') return;
    let data: Data;
    try {
      this.outJson.textContent = 'Loading…';
      data = await this.data();
    } catch (err) {
      if (this.view === view) this.outJson.textContent = `Could not load the result: ${(err as Error).message}`;
      return;
    }
    // The reader moved on, or a run replaced the result, while it loaded.
    if (this.view === view && this.result === result) {
      this.outJson.textContent = JSON.stringify(data.envelope, null, 2);
    }
  }

  /**
   * The graph view of the result on screen, drawn once per result so
   * expansions last while the reader switches tabs; null when a run replaced
   * the result while it loaded.
   */
  graphView(): Promise<GraphView | null> {
    const result = this.result;
    if (this.graph?.result !== result) {
      this.dropGraph();
      const view = Promise.all([this.data(), import('./graph.ts')]).then(([data, { renderGraph }]) => {
        if (this.result !== result || !data.graph) return null;
        const drawn = renderGraph(this.outGraph, data.graph, {
          onExpand: (id, nodes) => this.expand(id, nodes),
          // The graph view extras: the result's paths, and the cell's words (layout=, caption=, highlight=path).
          envelope: data.envelope,
          words: this.dataset.words ? (JSON.parse(this.dataset.words) as Record<string, string>) : null,
        });
        // Only a view that is still this cell's current one reaches the listeners.
        if (this.graph?.view === view) {
          this.drawnView = drawn;
          this.emitGraph(drawn);
        }
        return drawn;
      });
      // A failed load is tried again the next time the graph shows.
      view.catch(() => {
        if (this.graph?.view === view) this.graph = null;
      });
      this.graph = { result, view };
    }
    return this.graph.view;
  }

  /** Destroy the graph view, and empty its pane. */
  dropGraph() {
    const had = this.graph;
    had?.view.then(
      (v) => v?.destroy(),
      () => {},
    );
    this.graph = null;
    this.outGraph.replaceChildren();
    this.drawnView = null;
    if (had) this.emitGraph(null);
  }

  /**
   * Expand node `id` of the graph view (`drawn`: the nodes it draws). The
   * session may run this very step first, which gives it a new result and a
   * new view; the neighbours go to the result's view when they arrive.
   */
  async expand(id: number, drawn: number[]) {
    const outcome = await this.session.expand(this, id, drawn);
    if (!this.result.drawable) return; // the step failed; its output says why
    (await this.graphView().catch(() => null))?.grow(id, outcome);
  }
}

// ---------------------------------------------------------------- boot

/**
 * Make the page's cells runnable, if it has an engine bar (#engineBar) and
 * the browser has workers. Returns the element API (null without either).
 */
export function startCells(options: CellsOptions): PageApi | null {
  const bar = document.getElementById('engineBar');
  if (!bar || typeof Worker === 'undefined' || session) return null;
  session = new Session(bar, options);
  customElements.define('cypher-cell', CypherCell);
  return pageApi(session);
}

// ---------------------------------------------------------------- element API

function elementRun(reply: RunReply): ElementRun {
  const envelopes = reply.envelopes.map((t) => JSON.parse(t) as Envelope);
  return { envelopes, text: reply.envelopes, recording: reply.recording, ms: reply.ms, error: envelopes.at(-1)?.error ?? null };
}

/**
 * A database of an element's own (PageApi.scratch): a second engine worker
 * with a fresh writable in-memory database, apart from the page's database
 * and its lock. Closing it terminates the worker, which hands back every
 * byte of its WebAssembly memory (a freed database leaves the memory grown).
 */
async function scratchDb(): Promise<ScratchDb> {
  const engine = new Engine('relate-scratch');
  let closed = false;
  engine.addEventListener('discarded', () => (closed = true));
  try {
    await engine.start();
  } catch (err) {
    engine.discard('failed', err as Error);
    throw err;
  }
  return {
    version: engine.version,
    run: async (code, params = null) => {
      if (closed) throw new Error('this database was closed');
      const reply = await engine.runBare(code, params);
      const envelopes = reply.envelopes.map((t) => JSON.parse(t) as Envelope);
      return { envelopes, ms: reply.ms, memory: reply.memory ?? null, error: envelopes.at(-1)?.error ?? null };
    },
    closed: () => closed,
    close: () => {
      closed = true;
      engine.discard('stopped', new StoppedError('Closed.'));
    },
  };
}

/** The element API over a session (src/scripts/docs/element-api.ts documents each member). */
function pageApi(s: Session): PageApi {
  const handles = new WeakMap<CypherCell, CellHandle>();
  const handle = (c: CypherCell): CellHandle => {
    let h = handles.get(c);
    if (!h) {
      let words: Record<string, string> = {};
      try {
        words = JSON.parse(c.dataset.words ?? '{}');
      } catch {
        // Written by the build; a cell without words has none.
      }
      h = {
        id: c.dataset.cell!,
        index: Number(c.dataset.step),
        element: c,
        words,
        code: () => c.currentCode(),
        authoredCode: () => c.authoredCode(),
        params: () => c.paramsEditor?.value ?? null,
        runParams: async () => (c.paramsEditor ? c.paramsEditor.value : ((await c.paramsFile()) ?? null)),
        recordedText: c.recorded.text,
        recordedKind: c.recorded.kind,
        recorded: async () => {
          const data = (await s.options.recorded())[c.dataset.cell!];
          return { envelope: data?.envelope ?? null, graph: data?.graph ?? null };
        },
        state: () =>
          c.classList.contains('is-running') ? 'running'
          : c.classList.contains('is-blocked') ? 'blocked'
          : c.classList.contains('is-error') ? 'error'
          : c.classList.contains('is-live') ? 'live'
          : 'recorded',
        lastRun: () => (c.lastReply ? elementRun(c.lastReply) : null),
        slot: (name = 'default') => c.elementSlot(name),
        graphView: () => c.graph?.view.catch(() => null) ?? Promise.resolve(null),
        onGraph: (listener) => {
          c.graphListeners.add(listener);
          // A view already drawn is heard first; one still drawing reaches the listener when it is drawn.
          const now = c.drawnView;
          if (now) {
            queueMicrotask(() => {
              if (c.graphListeners.has(listener) && c.drawnView === now) listener(now);
            });
          }
          return () => c.graphListeners.delete(listener);
        },
      };
      handles.set(c, h);
    }
    return h;
  };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  return {
    run: async (code, params = null, options = {}) => elementRun(await s.runForElement(code, params, options.upTo === undefined ? 'all' : options.upTo, false)),
    runReadOnly: async (code, params = null) => elementRun(await s.runForElement(code, params, null, true)),
    onResult: (listener) => {
      const l = (cell: CypherCell, reply: RunReply, problem: string | null) => listener({ ...elementRun(reply), cell: handle(cell), problem } satisfies CellResult);
      s.resultListeners.add(l);
      return () => s.resultListeners.delete(l);
    },
    onReset: (listener) => {
      s.resetListeners.add(listener);
      return () => s.resetListeners.delete(listener);
    },
    cells: () => s.cells.map(handle),
    cell: (id) => {
      const c = s.cells.find((x) => x.dataset.cell === id);
      return c ? handle(c) : null;
    },
    engineReady: async () => {
      await s.engine.start();
      return s.engineInfo ?? { version: s.bar.dataset.engineVersion ?? null, loadMs: 0 };
    },
    engine: () => s.engineInfo,
    busy: () => s.busy,
    status: {
      bar: s.bar,
      say: (text) => {
        s.bar.querySelector('.engine-text')!.textContent = text;
      },
    },
    get reducedMotion() {
      return motion.matches;
    },
    onReducedMotion: (listener) => {
      const l = () => listener(motion.matches);
      motion.addEventListener('change', l);
      return () => motion.removeEventListener('change', l);
    },
    graph: () => import('./graph.ts'),
    scratch: scratchDb,
  };
}

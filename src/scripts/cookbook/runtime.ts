// Cookbook page runtime: makes each recipe step runnable in the browser.
// Ported from the Relate repository's scripts/cookbook/runtime/cookbook.js.
//
// Pages are complete without this script: code and recorded outputs are
// static HTML. This script upgrades each <cypher-cell> in place:
//
// - The engine is a module Web Worker (worker.ts) started on the first Run,
//   never on page load. Nothing runs without a click.
// - All steps on a page share one database. Running a step first runs the
//   earlier steps that have not run yet, in order, and stops at the first
//   that goes other than its recipe says (src/lib/cookbook/cells.ts).
// - Stop terminates the worker (there is no query timeout); Reset empties the
//   database. Either way every step goes back to its recorded output.
// - Parameters are sent to the engine as the JSON text the recipe holds (or
//   the reader typed), never re-serialized, so 1.0 stays a float.
// - Recorded results' envelopes and graphs live in results.json beside the
//   page and are fetched the first time a graph or JSON view needs one.
// - A graph (gram) result opens in the graph view (graph.ts, NVL), loaded only
//   when one comes near the viewport. A double-click on a node adds its
//   neighbours from the page's database, running the steps it needs first
//   (ADR-0151).

import { failed, surprise, type LastEnvelope } from '../../lib/cookbook/cells.ts';
import { expandNode, type Graph } from '../../lib/cookbook/graph-model.ts';
import { canDraw, lastEnvelope, tableHtml, type TableCells } from '../../lib/cookbook/result-view.ts';
import type { GraphView, Outcome } from './graph.ts';

// The page's own directory, with a trailing slash however the page was reached,
// so data/<name>.json and results.json resolve beside it.
const PAGE_BASE = new URL(location.pathname.replace(/\/?$/, '/'), location.origin);

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

interface RunReply {
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

  setStatus(status: Status, detail: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent('status', { detail: { status, ...detail } }));
  }

  /** Start the worker unless it runs; resolves once the engine is ready. */
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'relate' });
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
      (r) => this.setStatus('ready', { loadMs: r.loadMs }),
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

  async reset() {
    if (this.worker) await this.call({ type: 'reset' });
  }

  stop() {
    this.discard('stopped', new StoppedError('Stopped.'));
  }
}

// ---------------------------------------------------------------- session

const MESSAGES: Partial<Record<Status, (detail: { loadMs?: number }) => string>> = {
  loading: () => 'Loading the engine…',
  ready: ({ loadMs = 0 }) => `Engine ready (loaded in ${Math.round(loadMs)} ms). Every step runs in this tab.`,
  failed: () => 'The engine failed to load; run a step to try again. The recorded outputs are still accurate.',
  stopped: () => 'Stopped. The database was discarded; run any step to start again.',
  crashed: () => 'The engine crashed (a bug worth reporting). The database was discarded.',
  emptied: () => 'Database emptied. Run any step to start again.',
};

class Session {
  engine = new Engine();
  cells: CypherCell[] = [];
  done = new Set<CypherCell>();
  busy = false;
  /** The current run's AbortController. */
  current: AbortController | null = null;
  bar: HTMLElement;

  constructor(bar: HTMLElement) {
    this.bar = bar;
    this.engine.addEventListener('status', (e) => this.onStatus((e as CustomEvent).detail));
    // The database is gone, so nothing has run in it.
    this.engine.addEventListener('discarded', () => this.forget());
    bar.querySelector('[data-action=run-all]')?.addEventListener('click', () => this.runAll());
    bar.querySelector('[data-action=reset]')?.addEventListener('click', () => this.reset());
    bar.querySelector('[data-action=stop]')?.addEventListener('click', () => this.stop());
    bar.hidden = false;
  }

  register(cell: CypherCell) {
    this.cells.push(cell);
  }

  onStatus(detail: { status: Status; loadMs?: number }) {
    this.bar.dataset.status = detail.status;
    const message = MESSAGES[detail.status];
    if (message) this.bar.querySelector('.engine-text')!.textContent = message(detail);
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    (this.bar.querySelector('[data-action=stop]') as HTMLButtonElement).hidden = !busy;
    for (const b of this.bar.querySelectorAll<HTMLButtonElement>('[data-action=run-all], [data-action=reset]')) {
      b.disabled = busy;
    }
    for (const c of this.cells) c.setBusy(busy);
  }

  /**
   * Run `task(signal)` while nothing else runs: Run and Reset are disabled
   * and Stop aborts `signal`. Resolves to what `task` returns, or to a
   * problem string when it throws.
   */
  async exclusive(task: (signal: AbortSignal) => Promise<string | null>): Promise<string | null> {
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
        if (cell === target) return 'this step failed.';
        target.showBlocked(cell);
        return `step ${cell.dataset.step} failed.`;
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
function fetchText(url: string): Promise<string> {
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

interface Data {
  envelope: LastEnvelope | unknown;
  graph: Graph | null;
}

/** The page's recorded `{envelope, graph}`, by cell id (results.json). */
const loadRecorded = (): Promise<Record<string, Data>> =>
  fetchText(new URL('results.json', PAGE_BASE).href).then((t) => JSON.parse(t));

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
    return this.dataset.params ? fetchText(new URL(this.dataset.params, PAGE_BASE).href) : null;
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
      // A reader looking at the JSON goes on looking at it.
      this.paint(result, this.view === 'json' ? 'json' : defaultView(result));
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
    this.outLabel.textContent = 'Could not run';
    this.classList.add('is-error');
    this.paint(errorResult(message), 'text');
  }

  showBlocked(culprit: CypherCell) {
    this.classList.add('is-blocked');
    this.outLabel.textContent = `Not run: step ${culprit.dataset.step} failed`;
  }

  showRecorded() {
    this.classList.remove('is-live', 'is-error', 'is-blocked', 'is-running');
    this.outLabel.textContent = this.expectError ? 'Expected error' : 'Recorded result';
    this.paint(this.recorded, defaultView(this.recorded));
  }

  /** `{envelope, graph}` of the result on screen; the recording's come from results.json. */
  async data(): Promise<Data> {
    if (this.result !== this.recorded) return this.result.data!;
    return (await loadRecorded())[this.dataset.cell!] ?? { envelope: null, graph: null };
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
      const view = Promise.all([this.data(), import('./graph.ts')]).then(([data, { renderGraph }]) =>
        this.result === result && data.graph
          ? renderGraph(this.outGraph, data.graph, { onExpand: (id, drawn) => this.expand(id, drawn) })
          : null,
      );
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
    this.graph?.view.then(
      (v) => v?.destroy(),
      () => {},
    );
    this.graph = null;
    this.outGraph.replaceChildren();
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

const bar = document.getElementById('engineBar');
if (bar && typeof Worker !== 'undefined') {
  session = new Session(bar);
  customElements.define('cypher-cell', CypherCell);
}

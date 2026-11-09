// `:::scale-demo`, the scale demo (DOCS-PLAN.md §7.3, ADR-0047; the build
// side, and the static form, are src/lib/docs/elements/scale-demo.ts). Live,
// it shows the three cells' recordings beside empty columns, a size picker
// and a Build button with a note on memory. Nothing runs until the reader
// presses Build: then the element opens a database of its own
// (`page.scratch()`, a second engine worker, so the page's database and its
// cells never see the large graph), runs the build, count and walk cells as
// the page wrote them with `n` set to the size picked, reads the
// relationships back, lays the tree out (_scale-demo-model.ts) and draws it
// with NVL's WebGL renderer (graph.ts `renderScale`): the whole tree, or the
// whole rings from the root out that fit the 65,536 nodes that renderer
// places (`SCALE_MAX_NODES`), saying so. Every number it shows
// is from this tab's run (liveLine). "Run the count and the walk again"
// times them once more, from the node the reader names. Free closes the
// second engine, which hands its memory back; so do the engine bar's Reset
// and leaving the page. Without WebGL the cells still run and the tree is
// not drawn: the canvas renderer would stall the tab at this size.
//
// Narrow screens are offered the middle size first (phones have less memory
// to give a tab). Nothing animates: the layout is computed before drawing
// and the camera jumps, under prefers-reduced-motion or not.

import { engineMs, formatMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import { DEFAULT_SIZES, firstSize, radialTree, sizesOf, WIDE_PX } from '../../../lib/docs/elements/_scale-demo-model.ts';
import type { ElementContext, Envelope, ScratchDb, ScratchRun } from '../element-api.ts';
import type { ScaleView } from '../../cookbook/graph.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would put them on every docs page).
import styles from './scale-demo.css?inline';

/** What the element reads back to draw: every relationship, child to parent, as engine ids. */
const READ_BACK = 'MATCH (child)-->(parent) RETURN collect(id(child)) AS child, collect(id(parent)) AS parent';
/** Layout units between neighbouring nodes, and a node's radius in them. */
const SPACING = 10;
const NODE_SIZE = 4;

const ROLES = ['build', 'count', 'walk'] as const;
type Role = (typeof ROLES)[number];

const fmt = (n: number) => n.toLocaleString('en-US');
const megabytes = (bytes: number) => `${fmt(Math.round(bytes / 1e6))} MB`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  parent?.append(node);
  return node;
}

const ICONS: Record<string, string> = {
  in: '<path d="M8 3v10M3 8h10"/>',
  out: '<path d="M3 8h10"/>',
  fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
};

function tool(parent: HTMLElement, icon: string, label: string) {
  const b = el('button', { type: 'button', class: 'sd-tool', title: label, 'aria-label': label }, parent);
  b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return b;
}

/** A first row as `key: value` pairs, the way the static form prints a recording. */
function rowText(env: Pick<Envelope, 'rows' | 'error'> | null | undefined): string {
  if (!env) return '-';
  if (env.error) return `error: ${env.error}`;
  const row = env.rows?.[0];
  if (!row) return 'no rows';
  return Object.entries(row).map(([k, v]) => `${k}: ${typeof v === 'number' ? fmt(v) : JSON.stringify(v)}`).join(', ');
}

/** The cell's parameters (the block the reader may have edited) with `n`, and `start` when given, set. */
function paramsWith(text: string | null, n: number, start: number | null): string {
  let base: Record<string, unknown> = {};
  try {
    const value = text ? JSON.parse(text) : {};
    if (value && typeof value === 'object' && !Array.isArray(value)) base = value;
  } catch {
    // A block the reader broke: the size and the start node are all the statements need.
  }
  return JSON.stringify({ ...base, n, ...(start === null ? {} : { start }) });
}

export async function mount(ctx: ElementContext) {
  const { page, live, attrs } = ctx;
  ctx.adoptStyles(styles);
  const cells = Object.fromEntries(ROLES.map((r) => [r, page.cell(attrs[r] ?? '')])) as Record<Role, ReturnType<typeof page.cell>>;
  const missing = ROLES.filter((r) => !cells[r]);
  if (missing.length) throw new Error(`scale demo: the page has no cell ${missing.map((r) => attrs[r]).join(', ')}`);
  const sizes = sizesOf(attrs.sizes) ?? DEFAULT_SIZES;
  const wide = matchMedia(`(min-width: ${WIDE_PX}px)`).matches;
  const recordedParams = (() => {
    try {
      return JSON.parse(cells.build!.params() ?? '{}') as { n?: number; start?: number };
    } catch {
      return {};
    }
  })();

  // ---------------------------------------------------------------- the pane
  const root = el('div', { class: 'scale-demo' });
  el('p', {
    class: 'sd-note',
    text:
      'Build runs the three cells in a second copy of the engine in this tab, apart from the page\'s database, and the tree it makes stays in this tab\'s memory until Free closes that engine. ' +
      `The largest size is for a desktop browser; ${wide ? 'on a phone the demo offers a smaller size first' : 'this narrow screen is offered a smaller size first'}.`,
  }, root);
  const bar = el('div', { class: 'sd-bar' }, root);
  const sizeLabel = el('label', { class: 'sd-size' }, bar);
  el('span', { text: 'Nodes' }, sizeLabel);
  const sizeSelect = el('select', {}, sizeLabel);
  for (const s of sizes) el('option', { value: String(s), text: fmt(s) }, sizeSelect);
  sizeSelect.value = String(firstSize(sizes, wide));
  const build = el('button', { type: 'button', class: 'btn sd-build', text: 'Build the tree' }, bar);
  build.setAttribute('aria-label', 'Build the tree: run the three cells at the chosen size on a separate database');
  const stop = el('button', { type: 'button', class: 'btn sd-stop', text: 'Stop' }, bar);
  stop.hidden = true;
  const free = el('button', { type: 'button', class: 'btn sd-free', text: 'Free' }, bar);
  free.setAttribute('aria-label', 'Free: close the second engine and return its memory');
  free.disabled = true;

  const said = el('p', { class: 'sd-said', role: 'status' }, root);
  const table = el('table', { class: 'sd-table' }, root);
  el('caption', { text: 'Each cell: recorded on this page, and from this tab\'s run' }, table);
  table.createTHead().innerHTML = '<tr><th scope="col">Cell</th><th scope="col">Recorded</th><th scope="col">This tab</th><th scope="col">In the engine</th></tr>';
  const body = table.createTBody();
  const rows = {} as Record<Role, { live: HTMLElement; time: HTMLElement }>;
  for (const r of ROLES) {
    const tr = body.insertRow();
    tr.dataset.role = r;
    const name = el('th', { scope: 'row' }, tr);
    el('code', { text: cells[r]!.id }, name);
    el('td', { class: 'sd-recorded', text: rowText((await cells[r]!.recorded()).envelope as Envelope | null) }, tr);
    rows[r] = { live: el('td', { class: 'sd-live', text: '-' }, tr), time: el('td', { class: 'sd-time', text: '-' }, tr) };
  }

  const again = el('div', { class: 'sd-again' }, root);
  const startLabel = el('label', { class: 'sd-start' }, again);
  el('span', { text: 'Walk down from node' }, startLabel);
  const startInput = el('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric' }, startLabel);
  startInput.value = String(recordedParams.start ?? 0);
  const rerun = el('button', { type: 'button', class: 'btn sd-rerun', text: 'Run the count and the walk again' }, again);
  rerun.disabled = true;
  const memory = el('p', { class: 'sd-memory' }, root);

  const frame = el('div', { class: 'sd-frame' }, root);
  frame.hidden = true;
  const stage = el('div', { class: 'sd-stage' }, frame);
  const canvas = el('div', { class: 'sd-canvas' }, stage);
  const tools = el('div', { class: 'sd-tools' }, stage);
  const fitButton = tool(tools, 'fit', 'Fit the tree');
  const zoomIn = tool(tools, 'in', 'Zoom in');
  const zoomOut = tool(tools, 'out', 'Zoom out');
  const hint = el('p', { class: 'sd-hint', role: 'status' }, stage);
  hint.hidden = true;
  const drawn = el('p', { class: 'sd-drawn' }, root);

  live.replaceChildren(root);
  const recordedNote = () => `${recordedLine(versions(page).recorded)} The table shows the cells' recordings, with n = ${recordedParams.n === undefined ? '?' : fmt(recordedParams.n)}.`;
  said.textContent = recordedNote();
  ctx.showLive();

  // ---------------------------------------------------------------- state
  let db: ScratchDb | null = null;
  let view: ScaleView | null = null;
  let size = 0;
  let busy = false;
  /** Bumped by every release: a run that started before one has been stopped, and its answer is dropped. */
  let generation = 0;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const setBusy = (on: boolean) => {
    busy = on;
    build.disabled = on;
    sizeSelect.disabled = on;
    stop.hidden = !on;
    free.disabled = on || !db;
    rerun.disabled = on || !db;
    root.dataset.state = on ? 'running' : db ? 'built' : 'idle';
  };
  const show = (r: Role, run: ScratchRun) => {
    rows[r].live.textContent = rowText(run.envelopes.at(-1));
    rows[r].time.textContent = `${formatMs(engineMs(run.envelopes))} ms`;
  };
  const showMemory = (run: ScratchRun) => {
    memory.textContent = run.memory ? `The second engine's memory in this tab: ${megabytes(run.memory)}. It grows with the graph and is handed back only when the engine closes.` : '';
  };
  const clearView = () => {
    view?.destroy();
    view = null;
    delete (frame as { scaleView?: unknown }).scaleView;
    frame.hidden = true;
    canvas.replaceChildren();
    drawn.textContent = '';
  };
  /** Close the second engine (its memory goes back to the tab) and go back to the recordings. */
  const release = () => {
    generation++;
    clearView();
    db?.close();
    db = null;
    for (const r of ROLES) {
      rows[r].live.textContent = '-';
      rows[r].time.textContent = '-';
    }
    memory.textContent = '';
    startInput.removeAttribute('max');
  };
  const start = () => {
    const v = Number(startInput.value);
    return Number.isInteger(v) && v >= 0 ? v : 0;
  };

  /** Run one cell, as the page wrote it, on the second engine; throws on a statement error. */
  const runCell = async (r: Role, at: ScratchDb) => {
    const run = await at.run(cells[r]!.authoredCode(), paramsWith(cells[r]!.params(), size, r === 'walk' ? start() : null));
    show(r, run);
    showMemory(run);
    if (run.error) throw new Error(`cell ${cells[r]!.id} failed: ${run.error}`);
    return run;
  };

  async function draw(at: ScratchDb) {
    const back = await at.run(READ_BACK);
    showMemory(back);
    if (back.error) throw new Error(`reading the tree back failed: ${back.error}`);
    const row = back.envelopes.at(-1)?.rows?.[0] as { child?: number[]; parent?: number[] } | undefined;
    const graph = await page.graph();
    if (!graph.webglAvailable()) {
      drawn.textContent = `This browser gives the page no WebGL, so the tree is not drawn; the counts and times in the table are the engine's.`;
      return;
    }
    const tree = radialTree(row?.child ?? [], row?.parent ?? [], SPACING, graph.SCALE_MAX_NODES);
    frame.hidden = false;
    view = graph.renderScale(canvas, tree.nodes, tree.rels, {
      frame: root,
      size: NODE_SIZE,
      onWheelPast: () => {
        hint.textContent = 'Click the tree, or hold Ctrl or ⌘, to zoom with the wheel';
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => (hint.hidden = true), 2500);
      },
    });
    view.fit();
    // A browser case reads NVL's state through the frame, as the page has no other handle on the view.
    Object.defineProperty(frame, 'scaleView', { value: view, configurable: true });
    const state = view.state();
    frame.dataset.nodes = String(state.nodes);
    frame.dataset.rels = String(state.rels);
    const rings = tree.drawnDepth + 1;
    drawn.textContent =
      tree.nodes.length === tree.total
        ? `Drawn with WebGL: ${fmt(state.nodes)} nodes and ${fmt(state.rels)} relationships, in ${rings} rings out from the root.`
        : `Drawn with WebGL: the inner ${rings} of ${tree.depth + 1} rings, ${fmt(state.nodes)} of the ${fmt(tree.total)} nodes and the ${fmt(state.rels)} relationships between them. NVL's WebGL renderer places at most ${fmt(graph.SCALE_MAX_NODES)} nodes; the engine holds them all.`;
  }

  /** What a run that threw comes to: the reader stopped it, the engine ended (a crash, memory), or a statement failed. */
  const failed = (err: unknown, at: ScratchDb | null, gen: number) => {
    const message = (err as Error)?.message ?? String(err);
    if (gen !== generation) said.textContent = 'Stopped: the second engine is closed and its memory is back with the tab.';
    else if (at?.closed()) {
      release();
      setBusy(false);
      said.textContent = `The second engine ended (${message}); its memory is back with the tab.`;
    } else said.textContent = `Could not finish: ${message}`;
  };

  build.addEventListener('click', async () => {
    if (busy) return;
    release();
    const gen = generation;
    size = Number(sizeSelect.value);
    setBusy(true);
    said.textContent = `Starting a second engine in this tab for ${fmt(size)} nodes…`;
    let at: ScratchDb | null = null;
    try {
      at = await page.scratch();
      // Stopped while the engine started: close the one that came up too late to be wanted.
      if (gen !== generation) {
        at.close();
        return;
      }
      db = at;
      said.textContent = `Building ${fmt(size)} nodes…`;
      const runs = [];
      for (const r of ROLES) runs.push(await runCell(r, at));
      startInput.max = String(size - 1);
      said.textContent = liveLine({ version: at.version, ms: engineMs(runs.flatMap((x) => x.envelopes)), of: `cells ${ROLES.map((r) => cells[r]!.id).join(', ')} with n = ${fmt(size)}` });
      await draw(at);
    } catch (err) {
      failed(err, at, gen);
    } finally {
      if (gen === generation) setBusy(false);
    }
  });
  stop.addEventListener('click', () => {
    release();
    setBusy(false);
    said.textContent = 'Stopped: the second engine is closed and its memory is back with the tab.';
  });
  free.addEventListener('click', () => {
    if (busy) return;
    release();
    setBusy(false);
    said.textContent = `The second engine is closed and its memory is back with the tab. ${recordedNote()}`;
  });
  rerun.addEventListener('click', async () => {
    if (busy || !db) return;
    const at = db;
    const gen = generation;
    setBusy(true);
    try {
      const runs = [await runCell('count', at), await runCell('walk', at)];
      said.textContent = liveLine({ version: at.version, ms: engineMs(runs.flatMap((x) => x.envelopes)), of: `cells ${cells.count!.id} and ${cells.walk!.id} from node ${fmt(start())}` });
    } catch (err) {
      failed(err, at, gen);
    } finally {
      if (gen === generation) setBusy(false);
    }
  });
  fitButton.addEventListener('click', () => view?.fit());
  zoomIn.addEventListener('click', () => view?.zoomBy(1.5));
  zoomOut.addEventListener('click', () => view?.zoomBy(1 / 1.5));
  stage.addEventListener('pointerdown', () => root.classList.add('is-engaged'));
  const disengage = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) root.classList.remove('is-engaged');
  };
  document.addEventListener('pointerdown', disengage);

  // The engine bar's Reset (or Stop, or a crash) empties the page: the demo's engine goes too.
  const offReset = page.onReset(() => {
    if (!db) return;
    release();
    setBusy(false);
    said.textContent = `The page was reset, and the second engine closed with it. ${recordedNote()}`;
  });
  setBusy(false);
  return () => {
    offReset();
    document.removeEventListener('pointerdown', disengage);
    clearTimeout(hintTimer);
    release();
  };
}

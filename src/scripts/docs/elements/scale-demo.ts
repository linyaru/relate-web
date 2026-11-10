// `:::scale-demo`, the scale demo (DOCS-PLAN.md §7.3, ADR-0048; the build
// side, and the static form, are src/lib/docs/elements/scale-demo.ts). Live,
// it shows the three cells' recordings beside empty columns, a size picker
// and a Build button with a note on memory. Nothing runs until the reader
// presses Build: then the element opens a database of its own
// (`page.scratch()`, a second engine worker, so the page's database and its
// cells never see the large graph), runs the build, count and walk cells as
// the page wrote them with `n` set to the size picked, and shows each
// cell's first row and engine time beside its recording. It draws nothing.
// Every number it shows is from this tab's run (liveLine). "Run the count
// and the walk again" times them once more, from the node the reader names.
// Free closes the second engine, which hands its memory back; so do the
// engine bar's Reset and leaving the page.
//
// Narrow screens are offered the middle size first (phones have less memory
// to give a tab). Nothing animates.

import { engineMs, formatMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import { DEFAULT_SIZES, firstSize, sizesOf, WIDE_PX } from '../../../lib/docs/elements/_scale-demo-model.ts';
import type { ElementContext, Envelope, ScratchDb, ScratchRun } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would put them on every docs page).
import styles from './scale-demo.css?inline';

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

  live.replaceChildren(root);
  const recordedNote = () => `${recordedLine(versions(page).recorded)} The table shows the cells' recordings, with n = ${recordedParams.n === undefined ? '?' : fmt(recordedParams.n)}.`;
  said.textContent = recordedNote();
  ctx.showLive();

  // ---------------------------------------------------------------- state
  let db: ScratchDb | null = null;
  let size = 0;
  let busy = false;
  /** Bumped by every release: a run that started before one has been stopped, and its answer is dropped. */
  let generation = 0;

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
  /** Close the second engine (its memory goes back to the tab) and go back to the recordings. */
  const release = () => {
    generation++;
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
    release();
  };
}

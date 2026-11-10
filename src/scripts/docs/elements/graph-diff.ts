// `:::graph-diff`, the graph diff (DOCS-PLAN.md §7.3, ADR-0051; the build
// side, and the static form, are src/lib/docs/elements/graph-diff.ts). Live,
// it first draws the recorded diff of the `before` and `after` cells with the
// one graph module's network view (src/scripts/cookbook/graph.ts
// `renderNetwork`, NVL's free layout at the positions _graph-diff-model.ts
// computes, so nothing moves on screen), with a legend that names each
// status by symbol and word and the table of changes beside the view or
// under it. Compare runs the page's cells again, from the first to `after`,
// as they stand now (the reader's edits included, a recipe's dataset fetched
// as a Run would), on a database of the element's own (`page.scratch()`), and
// draws the new diff: running a migration a second time on the page's
// database would change what the page's later cells return, and nothing can
// rewind it. The second engine closes when the comparison ends.
//
// Each table row is a button that marks its element in the view (the rest
// dims); a click on a node in the view picks its row; Escape clears. The
// statuses differ by symbol (in every caption, the legend and the table),
// word and line width as well as colour.

import type { CellHandle, ElementContext, Envelope, ScratchDb } from '../element-api.ts';
import type { NetNode, NetRel, NetworkView } from '../../cookbook/graph.ts';
import { engineMs, liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import {
  changeRows,
  countsOf,
  diffGraphs,
  graphFromRows,
  layoutDiff,
  MARKS_TEXT,
  markedCaption,
  markedType,
  STATUS_STYLE,
  STATUSES,
  summaryText,
  type ChangeRow,
  type Diff,
  type Status,
} from '../../../lib/docs/elements/_graph-diff-model.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would put them on every docs page).
import styles from './graph-diff.css?inline';

/** A node's radius in layout units (the model's rings keep neighbours ARC apart). */
const NODE_SIZE = 20;
const NODE_COLOR: Record<Status, string> = { removed: '--danger', added: '--success', changed: '--rel', unchanged: '--line-strong' };
const REL_WIDTH: Record<Status, number> = { removed: 2, added: 3, changed: 2, unchanged: 1 };

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
  const b = el('button', { type: 'button', class: 'gd-tool', title: label, 'aria-label': label }, parent);
  b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return b;
}

/** The legend's sample of a status: a line in its pattern and a circle, drawn in its token. */
function sample(status: Status): string {
  const st = STATUS_STYLE[status];
  const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
  return (
    `<svg viewBox="0 0 44 14" width="44" height="14" aria-hidden="true" style="color: var(${st.token})">` +
    `<line x1="1" y1="7" x2="26" y2="7" stroke="currentColor" stroke-width="${status === 'added' ? 3 : status === 'unchanged' ? 1.2 : 2}"${dash}/>` +
    `<circle cx="36" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"${dash}/></svg>`
  );
}

const nodeKey = (id: string) => `n:${id}`;
const relKey = (id: string) => `r:${id}`;
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

export async function mount(ctx: ElementContext) {
  const { page, live, attrs } = ctx;
  ctx.adoptStyles(styles);
  const cellOf = (id: string | undefined): CellHandle => {
    const cell = page.cell(id ?? '');
    if (!cell) throw new Error(`graph diff: the page has no cell ${id}`);
    return cell;
  };
  const before = cellOf(attrs.before);
  const after = cellOf(attrs.after);
  const key = attrs.key ?? 'id';

  const recordedRows = async (cell: CellHandle) => ((await cell.recorded()).envelope as Envelope | null)?.rows ?? [];
  const recordedDiff = diffGraphs(graphFromRows(await recordedRows(before)), graphFromRows(await recordedRows(after)), key);
  const graph = await page.graph();

  // ---------------------------------------------------------------- the pane
  const root = el('div', { class: 'graph-diff' });
  const bar = el('div', { class: 'gd-bar' }, root);
  const compare = el('button', { type: 'button', class: 'btn gd-compare', text: 'Compare again' }, bar);
  compare.setAttribute('aria-label', `Compare again: run the page's cells up to ${after.id}, as they are now, on a separate database, and diff cells ${before.id} and ${after.id}`);
  const said = el('p', { class: 'gd-said', role: 'status' }, bar);
  const summary = el('p', { class: 'gd-summary' }, root);
  const problems = el('ul', { class: 'gd-problems' }, root);
  problems.hidden = true;

  const body = el('div', { class: 'gd-body' }, root);
  const viewCol = el('div', { class: 'gd-view' }, body);
  const legend = el('ul', { class: 'gd-legend', 'aria-label': 'What the marks mean' }, viewCol);
  const frame = el('div', { class: 'gd-frame' }, viewCol);
  const stage = el('div', { class: 'gd-stage', role: 'img' }, frame);
  const canvas = el('div', { class: 'gd-canvas' }, stage);
  const tools = el('div', { class: 'gd-tools' }, frame);
  const zoomIn = tool(tools, 'in', 'Zoom in');
  const zoomOut = tool(tools, 'out', 'Zoom out');
  const fitAll = tool(tools, 'fit', 'Fit the diff to the view');
  const hint = el('p', { class: 'gd-hint', role: 'status' }, frame);
  hint.hidden = true;
  const picked = el('p', { class: 'gd-picked', 'aria-live': 'polite' }, viewCol);

  const tableCol = el('div', { class: 'gd-changes' }, body);
  const tableWrap = el('div', { class: 'gd-table-wrap' }, tableCol);
  const table = el('table', { class: 'gd-table' }, tableWrap);
  const caption = el('caption', {}, table);
  table.createTHead().innerHTML = '<tr><th scope="col">Change</th><th scope="col">Element</th><th scope="col">What changed</th></tr>';
  const tbody = table.createTBody();

  // ---------------------------------------------------------------- state
  let diff: Diff = recordedDiff;
  let rows: ChangeRow[] = [];
  let view: NetworkView | null = null;
  let db: ScratchDb | null = null;
  let busy = false;
  let selected: string | null = null;
  /** Bumped by every comparison and by a Reset: an answer for an older one is dropped. */
  let generation = 0;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  const recordedNote = () => `${recordedLine(versions(page).recorded)} The view compares the recordings of cells ${before.id} and ${after.id}.`;

  function drawLegend() {
    const nodes = countsOf(diff.nodes);
    const rels = countsOf(diff.rels);
    legend.replaceChildren();
    for (const s of STATUSES) {
      const st = STATUS_STYLE[s];
      const li = el('li', { class: `gd-key is-${s}` }, legend);
      li.dataset.status = s;
      const art = el('span', { class: 'gd-sample' }, li);
      art.innerHTML = sample(s);
      el('span', { class: 'gd-symbol', text: st.symbol || '·', 'aria-hidden': st.symbol ? 'false' : 'true' }, li);
      el('span', { class: 'gd-word', text: st.word }, li);
      el('span', { class: 'gd-count', text: `${plural(nodes[s], 'node')}, ${plural(rels[s], 'relationship')}` }, li);
    }
  }

  function drawTable(fromRun: boolean) {
    rows = changeRows(diff);
    caption.textContent = `${rows.length ? plural(rows.length, 'change') : 'No changes'}, ${fromRun ? "from this tab's run" : 'as recorded'}`;
    tbody.replaceChildren();
    for (const r of rows) {
      const tr = tbody.insertRow();
      tr.dataset.status = r.status;
      tr.dataset.kind = r.kind;
      tr.dataset.id = r.id;
      el('td', { class: 'gd-change', text: r.change }, tr);
      const cell = el('td', { class: 'gd-element' }, tr);
      const b = el('button', { type: 'button', class: 'gd-pick', 'aria-pressed': 'false', text: r.element }, cell);
      b.addEventListener('click', () => pick(selected === rowKey(r) ? null : rowKey(r)));
      el('td', { class: 'gd-what', text: r.what || '-' }, tr);
    }
    if (!rows.length) {
      const tr = tbody.insertRow();
      el('td', { colspan: '3', class: 'gd-none', text: 'Nothing was added, removed or changed.' }, tr);
    }
  }

  const rowKey = (r: Pick<ChangeRow, 'kind' | 'id'>) => (r.kind === 'node' ? nodeKey(r.id) : relKey(r.id));

  function drawView() {
    view?.destroy();
    view = null;
    canvas.replaceChildren();
    const pos = layoutDiff(diff);
    const nodes: NetNode[] = diff.nodes.map((n) => ({
      id: nodeKey(n.id),
      x: pos.get(n.id)?.x ?? 0,
      y: pos.get(n.id)?.y ?? 0,
      color: NODE_COLOR[n.status],
      size: NODE_SIZE,
      caption: markedCaption(n),
    }));
    const rels: NetRel[] = diff.rels.map((r) => ({
      id: relKey(r.id),
      from: nodeKey(r.from),
      to: nodeKey(r.to),
      caption: markedType(r),
      width: REL_WIDTH[r.status],
      ...(r.status === 'unchanged' ? {} : { color: STATUS_STYLE[r.status].token }),
    }));
    stage.setAttribute('aria-label', `The diff of cells ${before.id} and ${after.id}. ${summaryText(diff)} ${MARKS_TEXT} The table lists every change.`);
    view = graph.renderNetwork(canvas, { nodes, rels }, {
      frame: root,
      clearRight: tools.offsetWidth + 8,
      onNodeClick: (id) => {
        const id0 = id.slice(2);
        // The node's own row when it changed, else the first change it takes part in.
        const row = rows.find((r) => r.kind === 'node' && r.id === id0) ?? rows.find((r) => r.kind === 'relationship' && diff.rels.some((x) => x.id === r.id && (x.from === id0 || x.to === id0)));
        if (!row) {
          pick(null);
          picked.textContent = `${diff.nodes.find((n) => n.id === id0)?.caption ?? id0} is unchanged, and so is every relationship it has here.`;
          return;
        }
        pick(rowKey(row));
        tbody.querySelector(`tr[data-id="${CSS.escape(row.id)}"]`)?.scrollIntoView({ block: 'nearest' });
      },
      onCanvasClick: () => pick(null),
      onHover: (id) => {
        stage.style.cursor = id ? 'pointer' : '';
      },
      onWheelPast: () => {
        hint.textContent = 'Click the diff, or hold Ctrl or ⌘, to zoom with the wheel';
        hint.hidden = false;
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => (hint.hidden = true), 2500);
      },
    });
    view.fit();
    // A browser case reads NVL's state through the frame, as the page has no other handle on the view.
    Object.defineProperty(frame, 'networkView', { value: view, configurable: true });
  }

  /** Mark one row's element in the view (its ends too, for a relationship) and dim the rest; null clears. */
  function pick(which: string | null) {
    selected = which;
    for (const b of tbody.querySelectorAll<HTMLButtonElement>('.gd-pick')) {
      const tr = b.closest('tr')!;
      b.setAttribute('aria-pressed', String(rowKey({ kind: tr.dataset.kind as 'node' | 'relationship', id: tr.dataset.id! }) === which));
    }
    if (!view) return;
    const marked = new Set<string>();
    const rel = which?.startsWith('r:') ? diff.rels.find((r) => relKey(r.id) === which) : undefined;
    if (which?.startsWith('n:')) marked.add(which);
    if (rel) marked.add(nodeKey(rel.from)).add(nodeKey(rel.to));
    view.restyle(
      diff.nodes.map((n) => ({ id: nodeKey(n.id), dim: which !== null && !marked.has(nodeKey(n.id)), mark: which !== null && marked.has(nodeKey(n.id)) })),
      diff.rels.map((r) => ({ id: relKey(r.id), dim: which !== null && relKey(r.id) !== which })),
    );
    const row = rows.find((r) => rowKey(r) === which);
    picked.textContent = row ? `Marked in the view: ${row.element}, ${row.change.replace(/^\S+ /, '')}${row.what ? ` (${row.what})` : ''}.` : '';
  }

  function show(next: Diff, fromRun: boolean) {
    diff = next;
    summary.textContent = `${summaryText(diff)} ${MARKS_TEXT}`;
    problems.replaceChildren(...diff.problems.map((p) => el('li', { text: p })));
    problems.hidden = !diff.problems.length;
    drawLegend();
    drawTable(fromRun);
    drawView();
    pick(null);
  }

  live.replaceChildren(root);
  ctx.showLive();
  try {
    show(recordedDiff, false);
  } catch (err) {
    live.replaceChildren();
    ctx.showStatic();
    throw err;
  }
  said.textContent = recordedNote();

  // ---------------------------------------------------------------- Compare
  const setBusy = (on: boolean) => {
    busy = on;
    compare.disabled = on;
    root.dataset.state = on ? 'running' : 'idle';
  };
  const release = () => {
    db?.close();
    db = null;
  };

  compare.addEventListener('click', async () => {
    if (busy) return;
    const gen = ++generation;
    setBusy(true);
    const cells = page.cells().filter((c) => c.index <= after.index);
    const edited = cells.filter((c) => c.code() !== c.authoredCode()).map((c) => c.id);
    said.textContent = `Running the page's cells up to ${after.id} on a separate database in this tab…`;
    let at: ScratchDb | null = null;
    try {
      at = await page.scratch();
      if (gen !== generation) return;
      db = at;
      const envelopes: Envelope[] = [];
      const states: Record<'before' | 'after', Envelope | undefined> = { before: undefined, after: undefined };
      for (const c of cells) {
        const run = await at.run(c.code(), await c.runParams());
        if (gen !== generation) return;
        envelopes.push(...run.envelopes);
        // A cell the page expects to fail recorded its error; any other error ends the comparison.
        const expected = !!((await c.recorded()).envelope as Envelope | null)?.error;
        if (run.error && !expected) throw new Error(`cell ${c.id} failed on the separate database: ${run.error}`);
        if (c.id === before.id) states.before = run.envelopes.at(-1);
        if (c.id === after.id) states.after = run.envelopes.at(-1);
      }
      const next = diffGraphs(graphFromRows(states.before?.rows), graphFromRows(states.after?.rows), key);
      show(next, true);
      const edits = edited.length ? ` With your edit${edited.length === 1 ? '' : 's'} to cell${edited.length === 1 ? '' : 's'} ${edited.join(', ')}.` : '';
      said.textContent = `${liveLine({ version: at.version, ms: engineMs(envelopes), of: `the page's cells up to ${after.id}, on a separate database` })}${edits}`;
    } catch (err) {
      if (gen === generation) said.textContent = `Could not compare: ${(err as Error)?.message ?? String(err)}. The view keeps the last diff.`;
    } finally {
      // The comparison is over: the second engine closes and hands its memory back.
      at?.close();
      if (db === at) db = null;
      if (gen === generation) setBusy(false);
    }
  });

  fitAll.addEventListener('click', () => view?.fit());
  zoomIn.addEventListener('click', () => view?.zoomBy(1.5));
  zoomOut.addEventListener('click', () => view?.zoomBy(1 / 1.5));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selected) {
      pick(null);
      e.stopPropagation();
    }
  });
  stage.addEventListener('pointerdown', () => root.classList.add('is-engaged'));
  const disengage = (e: PointerEvent) => {
    if (!root.contains(e.target as Node)) root.classList.remove('is-engaged');
  };
  document.addEventListener('pointerdown', disengage);

  // The engine bar's Reset puts every cell back on its recording: the diff goes back to the recorded one too.
  const offReset = page.onReset(() => {
    if (diff === recordedDiff && !busy) return;
    generation++;
    release();
    setBusy(false);
    show(recordedDiff, false);
    said.textContent = `The page was reset. ${recordedNote()}`;
  });
  setBusy(false);
  return () => {
    offReset();
    generation++;
    document.removeEventListener('pointerdown', disengage);
    clearTimeout(hintTimer);
    release();
    view?.destroy();
  };
}

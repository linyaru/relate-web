// `:::docs-graph`, the docs graph, live (DOCS-PLAN.md §7.3; the build side,
// and the static form, are src/lib/docs/elements/docs-graph.ts). Loaded when
// the element comes near the viewport or the reader reaches it, it fetches
// /docs/graph-view.json (a part of the docs graph with the layout the build
// computed; /docs/graph.json is several megabytes) and draws it with the one
// graph module's network view (src/scripts/cookbook/graph.ts
// `renderNetwork`, NVL's free layout): pages coloured by section, the links
// and prerequisites between them, and a toggle per further kind (glossary
// terms, capabilities, recipes, CLI commands and flags, surfaces, problems)
// on rings around them. A search box enlarges the nodes whose title matches
// and dims the rest; hovering or focusing a node shows its description and
// the nodes it is joined to in the inspector; a click opens its page (on a
// touch screen, the first tap shows the inspector and a second tap on the
// same node opens the page). The tables under the view list every drawn node
// as a link and count every kind in the whole graph, so every node is
// reachable by keyboard and named in text. It runs no engine.

import { NEUTRAL } from '../../../lib/cookbook/palette.ts';
import type { DocsGraphView, ViewNode } from '../../../lib/docs/elements/_docs-graph-view.ts';
import type { ElementContext } from '../element-api.ts';
// `?inline`: the styles ride in this lazy chunk (a plain import would put them on every docs page).
import styles from './docs-graph.css?inline';

// The network view's shape, as src/scripts/cookbook/graph.ts exports it
// (`renderNetwork`). Written out here so this module type-checks against a
// graph.ts that does not export it yet; the element then keeps its static
// form and the loader reports why.
interface NetNode {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
  caption: string;
}
interface NetRel {
  id: string;
  from: string;
  to: string;
  strong?: boolean;
}
interface NetStyle {
  id: string;
  dim?: boolean;
  mark?: boolean;
}
interface NetworkView {
  replace(nodes: NetNode[], rels: NetRel[]): void;
  restyle(nodes: NetStyle[], rels: NetStyle[]): void;
  fit(ids?: string[]): void;
  zoomBy(factor: number): void;
  point(id: string): { x: number; y: number } | null;
  state(): unknown;
  destroy(): void;
}
type RenderNetwork = (
  host: HTMLElement,
  first: { nodes: NetNode[]; rels: NetRel[] },
  options: {
    frame: HTMLElement;
    clearRight?: number;
    onNodeClick: (id: string, pointerType: string) => void;
    onCanvasClick: () => void;
    onHover: (id: string | null) => void;
    onWheelPast: () => void;
  },
) => NetworkView;

const VIEW_URL = '/docs/graph-view.json';
const PAGE_SIZE = 9;
const OTHER_SIZE = 6;
/** Matches listed under the search box; the view marks them all. */
const LISTED = 8;
/** Neighbours the inspector names per relationship type and direction. */
const NAMED = 4;

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
  full: '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>',
};

function tool(parent: HTMLElement, icon: string, label: string) {
  const b = el('button', { type: 'button', class: 'dg-tool', title: label, 'aria-label': label }, parent);
  b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[icon]}</svg>`;
  return b;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

export async function mount(ctx: ElementContext) {
  const { page, live, signal } = ctx;
  ctx.adoptStyles(styles);
  // A failed fetch, a missing graph module or an NVL that throws leaves the
  // tables and the picture where they are (the loader marks the element
  // failed): the static form is hidden only while the view draws.
  let nv: NetworkView;
  let view: DocsGraphView;
  let renderNetwork: RenderNetwork;
  try {
    const [response, graph] = await Promise.all([fetch(VIEW_URL, { signal }), page.graph()]);
    if (!response.ok) throw new Error(`docs graph: ${VIEW_URL} answered ${response.status}`);
    view = (await response.json()) as DocsGraphView;
    if (view.format !== 1) throw new Error(`docs graph: ${VIEW_URL} is format ${view.format}, not 1`);
    const exported = (graph as unknown as { renderNetwork?: RenderNetwork }).renderNetwork;
    if (typeof exported !== 'function') throw new Error('docs graph: src/scripts/cookbook/graph.ts exports no renderNetwork');
    renderNetwork = exported;
  } catch (err) {
    ctx.showStatic();
    throw err;
  }

  // ---------------------------------------------------------------- the model
  const sectionOf = new Map(view.sections.map((s) => [s.id, s]));
  const kindOf = new Map(view.kinds.map((k) => [k.label, k]));
  const on = new Set<string>(view.kinds.filter((k) => k.on).map((k) => k.label));
  const toggled = new Map<string, boolean>(view.pageRels.map((r) => [r.type, r.on]));
  const byKey = new Map(view.nodes.map((n, i) => [n.key, i]));
  const colorOf = (n: ViewNode) => (n.label === 'Page' ? sectionOf.get(n.section!)?.color : kindOf.get(n.label)?.color) ?? NEUTRAL;
  const kindName = (n: ViewNode) => (n.label === 'Page' ? `Page, ${sectionOf.get(n.section!)?.label ?? n.section}` : (kindOf.get(n.label)?.name.replace(/s$/, '') ?? n.label));
  // Each node's neighbours in the whole view, by type and direction, for the inspector and the table.
  const joined = view.nodes.map(() => new Map<string, { out: number[]; in: number[] }>());
  for (const [t, a, b] of view.rels) {
    const type = view.types[t];
    const at = (i: number) => joined[i].get(type) ?? joined[i].set(type, { out: [], in: [] }).get(type)!;
    at(a).out.push(b);
    at(b).in.push(a);
  }
  const drawnNodes = () => view.nodes.filter((n) => on.has(n.label));
  const relOn = (t: number) => toggled.get(view.types[t]) ?? true;
  const drawnRels = () => view.rels.map((r, i) => [r, i] as const).filter(([[t, a, b]]) => relOn(t) && on.has(view.nodes[a].label) && on.has(view.nodes[b].label));
  const netNode = (n: ViewNode): NetNode => ({ id: n.key, x: n.x, y: n.y, color: colorOf(n), size: n.label === 'Page' ? PAGE_SIZE : OTHER_SIZE, caption: n.title });
  const netRels = () => drawnRels().map(([[t, a, b], i]): NetRel => ({ id: `r${i}`, from: view.nodes[a].key, to: view.nodes[b].key, strong: view.types[t] === 'PREREQUISITE_OF' }));
  const total = (o: Record<string, number | undefined>) => Object.values(o).reduce<number>((t, n) => t + (n ?? 0), 0);

  // ---------------------------------------------------------------- the frame
  const root = el('div', { class: 'docs-graph' });
  const bar = el('div', { class: 'dg-bar' }, root);
  const searchLabel = el('label', { class: 'dg-search' }, bar);
  el('span', { text: 'Find' }, searchLabel);
  const search = el('input', { type: 'search', placeholder: 'A title, such as MCP', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Find nodes by title' }, searchLabel);
  const said = el('p', { class: 'dg-said', role: 'status' }, bar);
  const matches = el('ul', { class: 'dg-matches', 'aria-label': 'Nodes whose title matches' }, root);
  matches.hidden = true;

  const frame = el('div', { class: 'dg-frame' }, root);
  const stage = el('div', { class: 'dg-stage', role: 'img' }, frame);
  stage.setAttribute('aria-label', 'The docs graph: pages colored by section and the relationships between them. The tables under the view list every drawn node and count every kind.');
  // NVL sets its container's height to 100%: it draws in a box that fills the stage, which holds the height.
  const canvasBox = el('div', { class: 'dg-canvas' }, stage);
  const tools = el('div', { class: 'dg-tools' }, frame);
  const zoomIn = tool(tools, 'in', 'Zoom in');
  const zoomOut = tool(tools, 'out', 'Zoom out');
  const fitAll = tool(tools, 'fit', 'Fit the graph to the view');
  const full = tool(tools, 'full', 'Full screen');
  full.setAttribute('aria-pressed', 'false');
  const inspector = el('div', { class: 'dg-inspector', role: 'region', 'aria-label': 'Node details' }, frame);
  inspector.hidden = true;
  const hint = el('p', { class: 'dg-hint', role: 'status' }, frame);
  hint.hidden = true;

  const controls = el('div', { class: 'dg-controls' }, root);
  const kinds = el('fieldset', { class: 'dg-kinds' }, controls);
  el('legend', { text: 'Draw' }, kinds);
  const pageKey = el('div', { class: 'dg-key' }, kinds);
  el('span', { class: 'dg-key-name', text: `Pages (${kindOf.get('Page')?.count ?? 0}), by section:` }, pageKey);
  for (const s of view.sections) {
    const item = el('span', { class: 'dg-key-item' }, pageKey);
    el('i', { class: 'dg-swatch', 'aria-hidden': 'true' }, item).style.background = s.color;
    item.append(`${s.label} ${s.pages}`);
  }
  for (const k of view.kinds) {
    if (k.label === 'Page') continue;
    const label = el('label', { class: 'dg-toggle' }, kinds);
    const box = el('input', { type: 'checkbox', name: 'dg-kind', value: k.label }, label);
    box.checked = k.on;
    el('i', { class: 'dg-swatch', 'aria-hidden': 'true' }, label).style.background = k.color ?? NEUTRAL;
    label.append(`${k.name} (${k.count})`);
  }
  const relsField = el('fieldset', { class: 'dg-rels' }, controls);
  el('legend', { text: 'Between pages' }, relsField);
  for (const r of view.pageRels) {
    const label = el('label', { class: 'dg-toggle' }, relsField);
    const box = el('input', { type: 'checkbox', name: 'dg-rel', value: r.type }, label);
    box.checked = r.on;
    el('i', { class: `dg-line${r.type === 'PREREQUISITE_OF' ? ' is-strong' : ''}`, 'aria-hidden': 'true' }, label);
    el('span', { text: r.name }, label);
    el('code', { text: r.type }, label);
  }

  const tableBox = el('details', { class: 'dg-table' }, root);
  el('summary', { text: 'The drawn nodes as a table' }, tableBox);
  const tableWrap = el('div', { class: 'dg-table-wrap' }, tableBox);
  const countsBox = el('details', { class: 'dg-table dg-counts' }, root);
  el('summary', { text: `Every kind in the whole graph: ${plural(total(view.counts.nodes), 'node')} and ${plural(total(view.counts.rels), 'relationship')}` }, countsBox);
  countsBox.append(countsTable());

  // ---------------------------------------------------------------- the view
  let pinned: string | null = null;
  let tapped: string | null = null;
  // NVL sizes its canvas from its container when it starts, so the pane shows
  // first; if the view cannot draw, the static form comes back.
  live.replaceChildren(root);
  ctx.showLive();
  try {
    nv = renderNetwork(canvasBox, { nodes: drawnNodes().map(netNode), rels: netRels() }, {
      frame: root,
      clearRight: tools.offsetWidth + 8,
      onNodeClick: (key, pointer) => {
        const n = node(key);
        if (!n) return;
        // A touch has no hover: the first tap shows the node, a second tap on it opens its page.
        if (pointer === 'touch' && tapped !== key) {
          tapped = key;
          pin(key);
          return;
        }
        if (n.href) location.assign(n.href);
        else pin(key);
      },
      onCanvasClick: () => {
        tapped = null;
        pin(null);
      },
      onHover: (key) => {
        stage.style.cursor = key ? 'pointer' : '';
        if (!pinned) inspect(key);
      },
      onWheelPast: () => say(hint, 'Click the graph, or hold Ctrl or ⌘, to zoom with the wheel', 2500),
    });
  } catch (err) {
    live.replaceChildren();
    ctx.showStatic();
    throw err;
  }

  function node(key: string): ViewNode | undefined {
    const i = byKey.get(key);
    return i === undefined ? undefined : view.nodes[i];
  }

  let quiet: ReturnType<typeof setTimeout> | undefined;
  function say(where: HTMLElement, text: string, ttl: number | null = null) {
    if (where === hint) clearTimeout(quiet);
    where.textContent = text;
    where.hidden = !text;
    if (where === hint && text && ttl !== null) quiet = setTimeout(() => (hint.hidden = true), ttl);
  }

  /** A node's name as a link to its page, or as text when it has none. */
  function nameOf(i: number, parent: HTMLElement) {
    const n = view.nodes[i];
    if (n.href) el('a', { href: n.href, text: n.title }, parent);
    else parent.append(n.title);
  }

  /** The inspector, in words: kind, title, description, the nodes it is joined to, and the page link. */
  function inspect(key: string | null) {
    const n = key ? node(key) : undefined;
    inspector.hidden = !n;
    if (!n) return;
    inspector.replaceChildren();
    inspector.classList.toggle('is-pinned', key === pinned);
    const head = el('div', { class: 'dg-inspector-head' }, inspector);
    const chip = el('span', { class: 'dg-chip', text: kindName(n) }, head);
    chip.style.background = colorOf(n);
    if (key === pinned) {
      const close = el('button', { type: 'button', class: 'dg-close', 'aria-label': 'Close the node details', text: '×' }, head);
      close.addEventListener('click', () => pin(null));
    }
    el('p', { class: 'dg-inspector-title', text: n.title }, inspector);
    if (n.text) el('p', { class: 'dg-inspector-text', text: n.text }, inspector);
    const rels = [...joined[byKey.get(n.key)!]].sort(([a], [b]) => (a < b ? -1 : 1));
    if (rels.length) {
      const dl = el('dl', {}, inspector);
      for (const [type, d] of rels) {
        for (const [way, list] of [['out', d.out], ['in', d.in]] as const) {
          if (!list.length) continue;
          el('dt', { text: `${type} ${way === 'out' ? '→' : '←'} ${list.length}` }, dl).title = way === 'out' ? `${type}, from this node` : `${type}, to this node`;
          const dd = el('dd', {}, dl);
          list.slice(0, NAMED).forEach((i, k) => {
            if (k) dd.append(', ');
            nameOf(i, dd);
          });
          if (list.length > NAMED) dd.append(` and ${fmt(list.length - NAMED)} more`);
        }
      }
    }
    if (n.href) {
      const a = el('a', { class: 'dg-open', href: n.href, text: `Open ${n.title}` }, inspector);
      a.addEventListener('click', () => (tapped = null));
    } else {
      el('p', { class: 'dg-inspector-none', text: 'No page of its own' }, inspector);
    }
  }

  function pin(key: string | null) {
    pinned = key;
    inspect(key);
  }

  // ---------------------------------------------------------------- search
  let query = '';
  const hitsOf = (q: string) => drawnNodes().filter((n) => q !== '' && n.title.toLowerCase().includes(q));
  function applySearch() {
    const q = query.trim().toLowerCase();
    const found = hitsOf(q);
    const hidden = q ? view.nodes.filter((n) => !on.has(n.label) && n.title.toLowerCase().includes(q)).length : 0;
    const keys = new Set(found.map((n) => n.key));
    nv.restyle(
      drawnNodes().map((n) => ({ id: n.key, mark: keys.has(n.key), dim: q !== '' && !keys.has(n.key) })),
      drawnRels().map(([[, a, b], i]) => ({ id: `r${i}`, dim: q !== '' && !keys.has(view.nodes[a].key) && !keys.has(view.nodes[b].key) })),
    );
    root.dataset.matches = String(found.length);
    matches.replaceChildren();
    matches.hidden = !q || !found.length;
    for (const n of found.slice(0, LISTED)) {
      const li = el('li', {}, matches);
      const target = n.href ? el('a', { href: n.href, text: n.title }, li) : el('span', { text: n.title }, li);
      target.addEventListener('focus', () => !pinned && inspect(n.key));
      target.addEventListener('pointerenter', () => !pinned && inspect(n.key));
      el('span', { class: 'dg-match-kind', text: ` ${kindName(n)}` }, li);
    }
    if (found.length > LISTED) el('li', { class: 'dg-more', text: `and ${plural(found.length - LISTED, 'more')}, enlarged in the view` }, matches);
    const off = hidden ? `; ${plural(hidden, 'more match', 'more matches')} in kinds that are off` : '';
    say(said, q ? `${plural(found.length, 'drawn node')} match “${query.trim()}”${off}.` : summary());
  }
  const summary = () =>
    `Drawing ${plural(drawnNodes().length, 'node')} and ${plural(drawnRels().length, 'relationship')} of the docs graph's ${fmt(total(view.counts.nodes))} and ${fmt(total(view.counts.rels))}.`;
  let typing: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      query = search.value;
      applySearch();
    }, 120);
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(typing);
      query = search.value;
      applySearch();
      const keys = hitsOf(query.trim().toLowerCase()).map((n) => n.key);
      if (keys.length) nv.fit(keys);
    } else if (e.key === 'Escape' && search.value) {
      // The first Escape clears the search; only a second one leaves full screen.
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(typing);
      search.value = '';
      query = '';
      applySearch();
    }
  });

  // ---------------------------------------------------------------- toggles, tables, tools
  function redraw() {
    nv.replace(drawnNodes().map(netNode), netRels());
    root.dataset.drawnNodes = String(drawnNodes().length);
    root.dataset.drawnRels = String(drawnRels().length);
    if (pinned && !on.has(node(pinned)!.label)) pin(null);
    applySearch();
    if (tableBox.open) fillTable();
  }
  kinds.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    if (box.checked) on.add(box.value);
    else on.delete(box.value);
    redraw();
  });
  relsField.addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    toggled.set(box.value, box.checked);
    redraw();
  });

  function fillTable() {
    const table = el('table');
    el('caption', { text: 'Every drawn node, with its relationships in the view' }, table);
    const head = el('tr', {}, el('thead', {}, table));
    for (const h of ['Node', 'Kind', 'Relationships out', 'Relationships in']) el('th', { scope: 'col', text: h }, head);
    const body = el('tbody', {}, table);
    for (const n of drawnNodes()) {
      const tr = el('tr', {}, body);
      const th = el('th', { scope: 'row' }, tr);
      if (n.href) el('a', { href: n.href, text: n.title }, th);
      else th.textContent = n.title;
      el('td', { text: kindName(n) }, tr);
      const d = [...joined[byKey.get(n.key)!].values()];
      el('td', { class: 'num', text: String(d.reduce((t, x) => t + x.out.length, 0)) }, tr);
      el('td', { class: 'num', text: String(d.reduce((t, x) => t + x.in.length, 0)) }, tr);
    }
    tableWrap.replaceChildren(table);
  }
  tableBox.addEventListener('toggle', () => tableBox.open && fillTable());

  /** Every label and relationship type in the whole graph, counted at build: what the static form leaves to this view. */
  function countsTable() {
    const wrap = el('div', { class: 'dg-table-wrap' });
    for (const [title, counts] of [['Label', view.counts.nodes], ['Relationship', view.counts.rels]] as const) {
      const table = el('table', {}, wrap);
      el('caption', { text: title === 'Label' ? 'Nodes per label, planned pages included' : 'Relationships per type' }, table);
      const head = el('tr', {}, el('thead', {}, table));
      el('th', { scope: 'col', text: title }, head);
      el('th', { scope: 'col', text: 'Count' }, head);
      const body = el('tbody', {}, table);
      for (const [name, count] of Object.entries(counts)) {
        const tr = el('tr', {}, body);
        el('code', { text: name }, el('th', { scope: 'row' }, tr));
        el('td', { class: 'num', text: fmt(count ?? 0) }, tr);
      }
    }
    return wrap;
  }

  zoomIn.addEventListener('click', () => nv.zoomBy(1.4));
  zoomOut.addEventListener('click', () => nv.zoomBy(1 / 1.4));
  fitAll.addEventListener('click', () => nv.fit());

  // Touch: one finger scrolls the page past the view until the reader taps
  // into it; then it pans and pinches the graph, until they touch outside.
  stage.addEventListener('pointerdown', () => root.classList.add('is-engaged'));
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!root.contains(e.target as Node)) root.classList.remove('is-engaged');
    },
    { signal },
  );

  // Full screen: the Fullscreen API where the browser has it for an element,
  // else a fixed overlay (iPhone Safari). Either way the root carries
  // `is-full`, which the network view's wheel gate reads. In element full
  // screen the browser keeps Escape for itself: it leaves full screen and the
  // page never sees the key, so the search's first Escape could not clear it.
  // Where the browser has Keyboard Lock (Chromium), full screen locks Escape:
  // a press then reaches the page (the search, then the root's handler below)
  // and holding Escape still leaves, as the browser tells the reader. Other
  // browsers keep their own Escape.
  const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
  let overlay = false;
  const isFull = () => document.fullscreenElement === root || overlay;
  const setFull = async (want: boolean) => {
    if (want === isFull()) return;
    if (document.fullscreenEnabled && root.requestFullscreen) {
      try {
        if (want) {
          await root.requestFullscreen();
          await keyboard?.lock?.(['Escape']).catch(() => {});
        } else await document.exitFullscreen();
        return;
      } catch {
        // Refused (no user gesture, or an iframe without permission): the overlay instead.
      }
    }
    overlay = want;
    document.documentElement.classList.toggle('dg-no-scroll', want);
    sync();
  };
  const sync = () => {
    if (document.fullscreenElement !== root) keyboard?.unlock?.();
    root.classList.toggle('is-full', isFull());
    full.setAttribute('aria-pressed', String(isFull()));
    full.setAttribute('aria-label', isFull() ? 'Leave full screen' : 'Full screen');
    full.title = full.getAttribute('aria-label')!;
    requestAnimationFrame(() => nv.fit());
  };
  full.addEventListener('click', () => void setFull(!isFull()));
  document.addEventListener('fullscreenchange', sync, { signal });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFull()) void setFull(false);
  });

  // The browser case reads where a node is on screen (to press it with a real
  // click) and what NVL draws; removed when the element is torn down.
  const probe = ctx.host as HTMLElement & { docsGraph?: unknown };
  probe.docsGraph = { point: (key: string) => nv.point(key), state: () => nv.state() };

  root.dataset.drawnNodes = String(drawnNodes().length);
  root.dataset.drawnRels = String(drawnRels().length);
  root.dataset.matches = '0';
  say(said, summary());

  return () => {
    clearTimeout(typing);
    clearTimeout(quiet);
    delete probe.docsGraph;
    keyboard?.unlock?.();
    if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
    document.documentElement.classList.remove('dg-no-scroll');
    nv.destroy();
  };
}

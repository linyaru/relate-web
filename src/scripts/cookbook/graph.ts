// Graph view for cookbook steps and docs cells (ADR-0151): a graph result
// drawn by NVL, Neo4j's visualization library. Ported from the Relate
// repository's scripts/cookbook/runtime/graph.js. The reader zooms (pinch,
// the wheel once they have clicked into the view or with Ctrl/⌘ held, or the
// buttons), pans, drags nodes, hovers or clicks an element to inspect it, and
// double-clicks a node to add its neighbours from the page's database. The
// runtime imports this module only when a graph view is about to show.
//
// The graph view extras (DOCS-PLAN.md §7.3, ADR-0036) live here too, so
// every graph view has them without authoring: the paths in the result
// highlighted, a layout switch (force, hierarchical, circular), a
// property-as-caption picker, pinned nodes (drag one, double-tap one on a
// touch screen, or Pin all), a legend of relationship types beside the
// labels, and a full-screen button. A docs cell's words (`layout=`,
// `caption=`, `highlight=path`) set the view's defaults; a reader's own
// choice, and the nodes they pinned, are remembered for the cell while the
// page is open. A pinned node keeps its place through layout changes,
// expansions and their Reset, and through a run that redraws the view with
// it. Under prefers-reduced-motion nothing moves where the reader can see
// it: the canvas is hidden while a layout runs (a switch, an expansion, its
// Reset), shows once it has settled, and fits without animating.

import { NVL } from '@neo4j-nvl/base';
import {
  ClickInteraction,
  DragNodeInteraction,
  HoverInteraction,
  PanInteraction,
  ZoomInteraction,
} from '@neo4j-nvl/interaction-handlers';

import {
  LAYOUTS,
  NVL_LAYOUT,
  captionBy,
  isLayout,
  luminance,
  mixToward,
  pathsOf,
  propertyKeys,
  relColor,
  relTypes,
  viewDefaults,
  type LayoutName,
  type PathSet,
  type ViewDefaults,
} from '../../lib/cookbook/graph-extras-model.ts';
import {
  DrawnGraph,
  EXPAND_LIMIT,
  MAX_DRAWN,
  MAX_NODES,
  NODE_SIZE,
  formatValue,
  idOf,
  kindOf,
  labelColor,
  labelColors,
  labelKey,
  nodeKey,
  nvlNode,
  nvlRel,
  relKey,
  type Expansion,
  type Graph,
  type WireNode,
  type WireRel,
} from '../../lib/cookbook/graph-model.ts';
// The extras' styles ride in this lazy chunk and go on the page with the
// first view (a plain CSS import would put them on every page).
import extrasStyles from '../docs/elements/graph-extras.css?inline';

// Labels are coloured as the recipe's data-model diagram colours them.
const COLORS = labelColors(document.getElementById('label-colors')?.textContent);

const ICONS = {
  in: '<path d="M8 3v10M3 8h10"/>',
  out: '<path d="M3 8h10"/>',
  fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  reset: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2v3h3"/>',
  // Two arrows pointing out of the corners: unlike Fit's four brackets.
  full: '<path d="M9.5 6.5 14 2M10.5 2H14v3.5M6.5 9.5 2 14M5.5 14H2v-3.5"/>',
};

// A pinned node's marker, drawn by NVL on its canvas (an overlay icon): a
// pin, so a pinned node is told apart by shape, not by colour. The canvas is
// out of the CSS's reach, so the disc and pin take the page's --bg and --fg
// when drawn and again on a theme switch.
const pinIcon = (t: { bg: string; fg: string }) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${t.bg}" stroke="${t.fg}" stroke-width="1.5"/>` +
      `<path d="M9 5h6l-1 5 3 3H7l3-3zM12 13v6" fill="${t.fg}" stroke="${t.fg}" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  );

const motion = matchMedia('(prefers-reduced-motion: reduce)');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  parent?.append(node);
  return node;
}

function button(parent: HTMLElement, name: keyof typeof ICONS, label: string) {
  const b = el('button', { type: 'button', class: 'graph-tool', title: label, 'aria-label': label }, parent);
  b.innerHTML =
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return b;
}

/** The extras' CSS on the page, once (the same key an element's adoptStyles uses, so it is never added twice). */
function adoptExtrasStyles() {
  if (document.head.querySelector('style[data-element-style="graph-extras"]')) return;
  const style = document.createElement('style');
  style.dataset.elementStyle = 'graph-extras';
  style.textContent = extrasStyles;
  document.head.append(style);
}

/**
 * The colours NVL draws with in the page's current theme. Its canvas is out
 * of the CSS's reach, so they are read from the page's colour tokens.
 */
function canvasTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const bg = token('--bg');
  return {
    bg,
    fg: token('--fg'),
    rel: token('--fg-faint'),
    shadow: token('--accent'),
    // The output pane the canvas sits on: elements off a highlighted path
    // are mixed toward it.
    pane: token('--bg-alt'),
    // The network view's dimmed elements: the inset surface, a step off the page.
    dimmed: token('--bg-inset'),
    name: (/^#[0-9a-f]{6}$/i.test(bg) && luminance(bg) < 0.4 ? 'dark' : 'light') as 'light' | 'dark',
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const labelText = (labels: string[]) => labels.map((l) => `:${l}`).join('') || '(no label)';

type Theme = ReturnType<typeof canvasTheme>;

/** A path relationship's width, against the others' 1: the highlight is thicker, not only brighter. */
const PATH_WIDTH = 5;
/** A path node's size: larger than the others, and ringed (NVL's static `selected` rings, not its pulsing `activated`). */
const PATH_NODE_SIZE = NODE_SIZE * 1.25;
/** How much of its own colour an element off a highlighted path keeps (the rest is the pane's). */
const DIM_KEEP = 0.4;
/** How long a tap waits for a second one before it opens the inspector (a double-tap pins). */
const DOUBLE_TAP_MS = 350;

// ---------------------------------------------------------------- parts

/** An NVL instance in `host` drawing `first` (`{nodes, rels}`, wire JSON) with `layout`. */
function createNvl(
  host: HTMLElement,
  first: { nodes: unknown[]; rels: unknown[] },
  theme: Theme,
  layout: LayoutName,
  callbacks: { onLayoutDone: () => void },
) {
  return new NVL(
    host,
    first.nodes as never,
    first.rels as never,
    {
      renderer: 'canvas',
      layout: NVL_LAYOUT[layout],
      // NVL lays out on the page's thread: cookbook results are small, and its
      // workers would need more bundling than the view is worth.
      disableWebWorkers: true,
      disableTelemetry: true,
      minZoom: 0.05,
      maxZoom: 4,
      // The ring around a node on a highlighted path (or clicked): the page's
      // paper inside its ink. NVL fixes these colours when it starts, so a
      // ring of one colour would vanish on the other theme's pane after a
      // switch; a light ring beside a dark one shows on either.
      styling: { selectedInnerBorderColor: theme.bg, selectedBorderColor: theme.fg, dropShadowColor: theme.shadow },
    },
    { ...callbacks, onError: (err: unknown) => console.error('graph view:', err) },
  );
}

/**
 * NVL's node drag, moving only the node under the pointer. NVL 1.2.2's
 * DragNodeInteraction moves every selected node together when the pressed
 * one is selected, and the view selects to draw rings (the path's nodes, the
 * held element): a drag would move and pin the whole path. The handler reads
 * the selection through `nvlInstance` only, so it is given an instance whose
 * selection is empty; everything else goes to the real one.
 */
class OneNodeDrag extends DragNodeInteraction {
  private facade: NVL | undefined;
  override get nvlInstance(): NVL {
    this.facade ??= new Proxy(super.nvlInstance, {
      get(target, prop) {
        if (prop === 'getSelectedNodes') return () => [];
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return this.facade;
  }
}

/**
 * NVL's interaction handlers on `nvl`, reporting to the view: `onMove()` when
 * the reader zooms or pans, `onPoint(key)` with the NVL id under the pointer
 * (or null), `onHold(key)` on a click (null on the canvas), `onDouble(id)`
 * with the engine id of a node double-clicked (or double-tapped), and
 * `onDragged(keys)` with the node a drag moved (NVL pins it). Returns the
 * handlers, to destroy.
 */
function interactions(
  nvl: NVL,
  handlers: {
    onMove: () => void;
    onPoint: (key: string | null) => void;
    onHold: (key: string | null) => void;
    onDouble: (id: number) => void;
    onDragged: (keys: string[]) => void;
  },
) {
  const zoom = new ZoomInteraction(nvl);
  const pan = new PanInteraction(nvl, { excludeNodeMargin: true });
  const drag = new OneNodeDrag(nvl);
  // The view marks what is selected itself (the held element, and the path's
  // nodes), so NVL's own click selection would undo the path's rings.
  const click = new ClickInteraction(nvl, { selectOnClick: false });
  const hover = new HoverInteraction(nvl, { drawShadowOnHover: true });
  zoom.updateCallback('onZoom', handlers.onMove);
  pan.updateCallback('onPan', handlers.onMove);
  // NVL hands each callback the element (or nothing), typed as unknown.
  const keyOf = (element: unknown) => (element as { id?: string } | null | undefined)?.id ?? null;
  hover.updateCallback('onHover', (element: unknown) => handlers.onPoint(keyOf(element)));
  click.updateCallback('onNodeClick', (node: unknown) => handlers.onHold(keyOf(node)));
  click.updateCallback('onRelationshipClick', (rel: unknown) => handlers.onHold(keyOf(rel)));
  click.updateCallback('onCanvasClick', () => handlers.onHold(null));
  click.updateCallback('onNodeDoubleClick', (node: unknown) => {
    const key = keyOf(node);
    if (key) handlers.onDouble(idOf(key));
  });
  drag.updateCallback('onDragEnd', (nodes: unknown) => {
    handlers.onDragged(((nodes as { id?: string }[]) ?? []).map((n) => n.id).filter((k): k is string => !!k));
  });
  return [zoom, pan, drag, click, hover];
}

/** Keeping the graph fitted to the pane (`fitAll(animated)` fits it) until the reader zooms or pans it. */
function createCamera(stage: HTMLElement, fitAll: (animated: boolean) => void) {
  let fitted = false; // fitted to the graph since it was drawn
  let moved = false; // the reader has zoomed or panned since
  const fit = (animated: boolean) => {
    if (stage.clientWidth === 0) return;
    fitAll(animated && !motion.matches);
    fitted = true;
  };
  return {
    /** The reader moved the view: leave it where they put it. */
    moved: () => {
      moved = true;
    },
    /** Fit the graph to the pane, and keep it fitted again. */
    fit: () => {
      moved = false;
      fit(true);
    },
    /** The layout settled: fit, unless the reader has moved the view. */
    settled: () => {
      if (!moved) fit(fitted);
    },
    /** The pane resized: fit a graph drawn while its pane was hidden, or one the reader has not moved. */
    resized: (always = false) => {
      if (!moved && (always || !fitted)) fit(false);
    },
  };
}

/** The toolbar: zoom in and out, fit, full screen, and reset. Returns the reset and full-screen buttons. */
function toolbar(
  parent: HTMLElement,
  actions: { zoomBy: (f: number) => void; fit: () => void; reset: () => void; full: () => void },
) {
  const tools = el('div', { class: 'graph-tools' }, parent);
  button(tools, 'in', 'Zoom in').addEventListener('click', () => actions.zoomBy(1.4));
  button(tools, 'out', 'Zoom out').addEventListener('click', () => actions.zoomBy(1 / 1.4));
  button(tools, 'fit', 'Fit the graph to the view').addEventListener('click', actions.fit);
  const fullBtn = button(tools, 'full', 'Full screen');
  fullBtn.setAttribute('aria-pressed', 'false');
  fullBtn.addEventListener('click', actions.full);
  const resetBtn = button(tools, 'reset', 'Show the step’s result again');
  resetBtn.hidden = true;
  resetBtn.addEventListener('click', actions.reset);
  return { resetBtn, fullBtn };
}

/**
 * The inspector: the labels or type and properties of the element clicked
 * (held until it is closed or the canvas is clicked), else of the one under
 * the pointer. `itemOf(key)` is the wire element behind an NVL id;
 * `onRelease()` runs when a held element is let go. A held node also gets
 * Pin and Expand buttons: what drag and double-click do, for a keyboard or
 * a touch screen.
 */
function createInspector(
  parent: HTMLElement,
  itemOf: (key: string) => WireNode | WireRel | undefined,
  actions: { onRelease: () => void; isPinned: (id: number) => boolean; togglePin: (id: number) => void; expand: (id: number) => void },
) {
  const panel = el('div', { class: 'graph-inspector', hidden: '' }, parent);
  let held: string | null = null;

  // Not held, the panel lets the pointer through to the graph beneath.
  function show(key: string | null) {
    const item = key ? itemOf(key) : undefined;
    panel.hidden = !item;
    if (!key || !item) return;
    const kind = kindOf(key);
    panel.replaceChildren();
    panel.classList.toggle('is-pinned', key === held);
    const head = el('div', { class: 'graph-inspector-head' }, panel);
    if ('labels' in item) {
      const chip = el('span', { class: 'graph-chip', text: labelText(item.labels) }, head);
      chip.style.background = labelColor(item.labels, COLORS);
    } else {
      el('span', { class: 'graph-chip rel', text: `:${item.type}` }, head);
    }
    el('span', { class: 'graph-inspector-id', text: `${kind} ${item.id}` }, head);
    if (key === held) {
      const close = el('button', { type: 'button', class: 'graph-inspector-close', 'aria-label': 'Close' }, head);
      close.textContent = '×';
      close.addEventListener('click', () => hold(null));
    }
    const props = Object.entries(item.properties ?? {});
    if (props.length) {
      const dl = el('dl', {}, panel);
      for (const [k, v] of props) {
        el('dt', { text: k }, dl);
        el('dd', { text: formatValue(v) }, dl);
      }
    } else {
      el('p', { class: 'graph-inspector-none', text: 'No properties' }, panel);
    }
    if (kind !== 'node') return;
    if (key !== held) {
      el('p', { class: 'graph-inspector-hint', text: 'Double-click to expand' }, panel);
      return;
    }
    const id = item.id;
    const row = el('div', { class: 'graph-inspector-actions' }, panel);
    const pinned = actions.isPinned(id);
    const pin = el('button', { type: 'button', class: 'graph-btn', 'data-action': 'pin', 'aria-pressed': String(pinned), text: pinned ? 'Unpin' : 'Pin' }, row);
    pin.addEventListener('click', () => {
      // The toggle rebuilds the panel: focus goes to the new button, not to the page.
      const focused = document.activeElement === pin;
      actions.togglePin(id);
      show(key);
      if (focused) panel.querySelector<HTMLButtonElement>('[data-action="pin"]')?.focus();
    });
    el('button', { type: 'button', class: 'graph-btn', 'data-action': 'expand', text: 'Expand' }, row).addEventListener('click', () => actions.expand(id));
  }

  function hold(key: string | null) {
    if (!key && held) actions.onRelease();
    held = key;
    show(key);
  }

  return {
    hold,
    hover: (key: string | null) => {
      if (!held) show(key);
    },
    /** Show the held element again (its pin changed). */
    refresh: () => {
      if (held) show(held);
    },
    /** Let go of a held element the view no longer draws. */
    prune: () => {
      if (held && !itemOf(held)) hold(null);
    },
  };
}

/** The status line: `say(text, ttl)` shows `text` for `ttl` ms, or until the next message when `ttl` is null. */
function statusLine(parent: HTMLElement) {
  const status = el('p', { class: 'graph-status', role: 'status', hidden: '' }, parent);
  let quiet: ReturnType<typeof setTimeout> | undefined;
  return {
    say(text: string, ttl: number | null = 6000) {
      clearTimeout(quiet);
      status.textContent = text;
      status.hidden = !text;
      if (text && ttl !== null) quiet = setTimeout(() => (status.hidden = true), ttl);
    },
    stop: () => clearTimeout(quiet),
  };
}

/** What a path entry in the legend says: the path's captions in order, or how many paths and elements. */
function pathText(paths: PathSet, drawn: DrawnGraph, captionOf: (n: WireNode) => string): string {
  if (paths.paths.length === 1) {
    const p = paths.paths[0];
    const names = p.nodes.map((id) => {
      const n = drawn.nodes.get(id);
      return n ? captionOf(n) : `node ${id}`;
    });
    return `Path (${plural(p.rels.length, 'hop')}): ${names.join(' → ')}`;
  }
  return `${paths.paths.length} paths: ${plural(paths.nodes.size, 'node')}, ${plural(paths.rels.size, 'relationship')}`;
}

/**
 * The legend: a chip per label set `drawn` draws, a line per relationship
 * type in its colour, the paths if any, then `note` if any, then the hint.
 */
function drawLegend(
  legend: HTMLElement,
  drawn: DrawnGraph,
  note: string | null,
  extras: { theme: Theme; paths: string | null; highlight: boolean },
) {
  legend.replaceChildren();
  const sets = new Map([...drawn.nodes.values()].map((n) => [labelKey(n.labels), n.labels]));
  const labels = el('span', { class: 'graph-legend-group', role: 'list', 'aria-label': 'Node labels' }, legend);
  for (const l of sets.values()) {
    const item = el('span', { role: 'listitem' }, labels);
    el('i', {}, item).style.background = labelColor(l, COLORS);
    item.append(labelText(l));
  }
  const types = relTypes(drawn.rels.values());
  if (types.length) {
    const group = el('span', { class: 'graph-legend-group graph-legend-types', role: 'list', 'aria-label': 'Relationship types' }, legend);
    for (const type of types) {
      const item = el('span', { role: 'listitem', 'data-type': type }, group);
      el('i', { class: 'graph-type-swatch' }, item).style.background = relColor(type, extras.theme.name);
      item.append(`:${type}`);
    }
  }
  if (extras.paths) {
    const item = el('span', { class: `graph-path-key${extras.highlight ? '' : ' is-off'}` }, legend);
    el('i', { class: 'graph-path-swatch' }, item);
    item.append(extras.paths);
  }
  if (note) el('span', { class: 'graph-note', text: note }, legend);
  el('span', { class: 'graph-hint', text: 'Double-click a node to expand it; drag a node, or double-tap it on a touch screen, to pin it' }, legend);
}

/**
 * The wheel scrolls the page past a graph until the reader clicks into it
 * (or holds Ctrl/⌘, as a trackpad pinch does); then it zooms, until the
 * pointer leaves. `hint()` runs when a wheel scrolls past.
 */
function gateWheel(root: HTMLElement, stage: HTMLElement, hint: () => void) {
  let engaged = false;
  root.addEventListener('pointerdown', () => (engaged = true));
  root.addEventListener('pointerleave', () => (engaged = false));
  root.addEventListener(
    'wheel',
    (e) => {
      if (!stage.contains(e.target as Node)) return;
      if (engaged || e.ctrlKey || e.metaKey || root.classList.contains('is-full')) {
        e.preventDefault(); // zoom the graph, not the page
        return;
      }
      e.stopPropagation(); // keep it from NVL: the page scrolls
      hint();
    },
    { capture: true, passive: false },
  );
}

/** Watch the page's theme: `onChange()` on each change. Returns the function that stops. */
function watchTheme(onChange: () => void) {
  const attr = new MutationObserver(onChange);
  attr.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    attr.disconnect();
    media.removeEventListener('change', onChange);
  };
}

/** A labelled select in the controls row. */
function picker(parent: HTMLElement, label: string, cls: string) {
  const wrap = el('label', { class: `graph-control ${cls}` }, parent);
  el('span', { text: label }, wrap);
  return el('select', {}, wrap);
}

// ---------------------------------------------------------------- view

/** What expanding a node came to: its neighbours, or why not. */
export type Outcome = { graph: Expansion; problem?: undefined } | { problem: string; graph?: undefined };

/** What a view shows now, for a test or an element to read: from NVL's own state where it can be. */
export interface ViewState {
  layout: LayoutName;
  caption: string | null;
  /** Whether the paths are highlighted (false when the result has none). */
  highlight: boolean;
  paths: number;
  /** Elements NVL draws as on a path: nodes ringed and drawn larger, and relationships drawn wider. */
  highlighted: { nodes: number; rels: number };
  /** Elements NVL draws in their dimmed colour (their own, mixed toward the pane). */
  dimmed: number;
  /** Node positions (NVL ids → layout coordinates). */
  positions: Record<string, { x: number; y: number }>;
  /** Where each node is on screen (client coordinates), for a real click on it. */
  screen: Record<string, { x: number; y: number }>;
  /** Node captions as NVL draws them. */
  captions: Record<string, string>;
  /** The pinned nodes (NVL ids), as the view keeps them. */
  pinned: string[];
  /** The nodes NVL itself holds pinned (its `pinned` flag), and those it draws a pin icon on. */
  nvlPinned: string[];
  pinIcons: string[];
  /** The relationship types drawn, sorted. */
  relTypes: string[];
  /** Whether a layout is still running, or the canvas is hidden while one runs (reduced motion). */
  moving: boolean;
  hidden: boolean;
  full: boolean;
}

export interface GraphView {
  /** Add node `id`'s neighbours. */
  grow(id: number, outcome: Outcome): void;
  /** The authored defaults (a cell's words); a choice the reader made for this cell still wins. */
  configure(defaults: Partial<ViewDefaults>): void;
  setLayout(layout: LayoutName): void;
  /** Draw node property `property` as the caption, or the default caption (null). */
  setCaption(property: string | null): void;
  setHighlight(on: boolean): void;
  /** The result's paths, from its envelope, when the view was drawn without it. */
  setPaths(envelope: unknown): void;
  pin(ids: number[]): void;
  unpin(ids: number[]): void;
  state(): ViewState;
  /** Calls `listener` after the layout, caption, highlight or pins change (by the reader or a call); returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
  destroy(): void;
}

/** A reader's choices per cell (its graph pane), kept while the page is open, so a run or Reset keeps them. */
const remembered = new WeakMap<HTMLElement, Partial<ViewDefaults>>();
/**
 * The nodes a reader pinned per cell, at their pinned places (engine id →
 * NVL layout coordinates). A run or an expansion that reruns the step draws
 * a new view of the same result: the nodes it draws again stay pinned where
 * they were.
 */
const rememberedPins = new WeakMap<HTMLElement, Map<number, { x: number; y: number }>>();

/** The words of the docs cell around `container` (data-words, written by the build), if any. */
function cellWords(container: HTMLElement): Record<string, string> | null {
  const text = container.closest<HTMLElement>('[data-words]')?.dataset.words;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Draw `graph` (a recording's `{nodes, rels}`) into `container`. A
 * double-click on a node calls `onExpand(id, drawn)`, `drawn` being the
 * engine ids of the nodes on screen; the answer comes back through the view's
 * `grow` (a run can replace the view in between, and the answer goes to
 * whichever view shows the step then). `envelope` is the result's last wire
 * envelope (its paths are highlighted); `words` the cell's element words
 * (read from the cell around `container` when not given).
 */
export function renderGraph(
  container: HTMLElement,
  graph: Graph,
  {
    onExpand,
    envelope,
    words,
  }: { onExpand: (id: number, drawn: number[]) => Promise<void>; envelope?: unknown; words?: Record<string, string> | null },
): GraphView {
  adoptExtrasStyles();
  const original = new DrawnGraph();
  original.add(graph, MAX_NODES);
  const drawn = new DrawnGraph();
  const first = drawn.add(graph, MAX_NODES);
  const note = first.left > 0 ? `first ${MAX_NODES} of ${graph.nodes.length} nodes` : null;
  let theme = canvasTheme();

  // What the view shows: the authored defaults, then what the reader chose for this cell.
  const prefs: ViewDefaults = { ...viewDefaults(words ?? cellWords(container)), ...remembered.get(container) };
  let paths: PathSet = pathsOf(envelope);
  const hasPaths = () => paths.nodes.size > 0;
  // The pinned nodes at their places: those pinned in this cell's last view that this one draws too.
  const pins = new Map([...(rememberedPins.get(container) ?? [])].filter(([id]) => drawn.nodes.has(id)));
  rememberedPins.set(container, pins);
  const captionOf = (n: WireNode) => captionBy(n, prefs.caption);
  // How each element looks with the highlight `on` (or off): on a path, or
  // dimmed. `dimmed` holds the colour each dimmed element was painted.
  const dimmed = new Map<string, string>();
  const dim = (id: string, colour: string, off: boolean) => {
    if (!off) {
      dimmed.delete(id);
      return colour;
    }
    const c = mixToward(colour, theme.pane, DIM_KEEP);
    dimmed.set(id, c);
    return c;
  };
  // The element held in the inspector is selected (ringed) too.
  let held: string | null = null;
  const nodeLook = (n: WireNode, on: boolean) => {
    const id = nodeKey(n.id);
    const onPath = on && paths.nodes.has(n.id);
    return {
      id,
      selected: onPath || id === held,
      size: onPath ? PATH_NODE_SIZE : NODE_SIZE,
      color: dim(id, labelColor(n.labels, COLORS), on && !onPath),
    };
  };
  const relLook = (r: WireRel, on: boolean) => {
    const id = relKey(r.id);
    const onPath = on && paths.rels.has(r.id);
    return { id, selected: id === held, width: onPath ? PATH_WIDTH : 1, color: dim(id, relColor(r.type, theme.name), on && !onPath) };
  };
  /** Hold `key` (an NVL id, or null) in the inspector, ringed on the canvas. */
  const select = (key: string | null) => {
    const was = held;
    held = key;
    const on = highlightOn();
    const looks = [was, key].flatMap((k) => (k ? [k] : []));
    // The ring only: any `size` sent, even an unchanged one, makes NVL's
    // hierarchical and circular layouts place every node again, pinned ones
    // too, on their next update (the next drag).
    nvl.updateElementsInGraph(
      looks.flatMap((k) => (kindOf(k) === 'node' && drawn.get(k) ? [{ id: k, selected: nodeLook(drawn.get(k) as WireNode, on).selected }] : [])) as never,
      looks.flatMap((k) => (kindOf(k) === 'relationship' && drawn.get(k) ? [{ id: k, selected: k === key }] : [])) as never,
    );
  };
  const highlightOn = () => prefs.highlight && hasPaths();
  const pinOverlay = () => ({ url: pinIcon(theme), position: [0.75, -0.75], size: 0.45 });
  const pinLook = (id: number) => {
    const at = pins.get(id);
    return at ? { x: at.x, y: at.y, pinned: true, overlayIcon: pinOverlay() } : {};
  };
  const nodeOf = (n: WireNode) => ({ ...nvlNode(n, COLORS), caption: captionOf(n), ...nodeLook(n, highlightOn()), ...pinLook(n.id) });
  const relOf = (r: WireRel) => ({ ...nvlRel(r, theme.rel), ...relLook(r, highlightOn()) });

  const root = el('div', { class: 'graph-view' }, container);
  // NVL sizes its element to its parent's height, so it gets one inside the
  // stage, which the reader can resize.
  const stage = el('div', { class: 'graph-stage' }, root);
  const host = el('div', { class: 'graph-host' }, stage);
  // Under reduced motion the canvas stays hidden while a layout runs.
  const still = () => motion.matches;
  if (still()) host.style.visibility = 'hidden';
  // The camera fits through `nvl`, which is created right after it.
  const camera = createCamera(stage, (animated) =>
    nvl.fit([...drawn.nodes.keys()].map(nodeKey), { animated, maxZoom: 1.25 } as never),
  );
  let settling: (() => void) | null = null;
  const nvl = createNvl(host, { nodes: first.nodes.map(nodeOf), rels: first.rels.map(relOf) }, theme, prefs.layout, {
    onLayoutDone: () => layoutDone(),
  });
  if (prefs.layout === 'hierarchical') nvl.setLayoutOptions({ direction: 'down' });
  const { resetBtn, fullBtn } = toolbar(root, {
    zoomBy: (factor) => {
      camera.moved();
      nvl.setZoom(nvl.getScale() * factor);
    },
    fit: () => camera.fit(),
    reset: showResult,
    full: () => setFull(!root.classList.contains('is-full')),
  });
  const inspector = createInspector(root, (key) => drawn.get(key), {
    onRelease: () => select(null),
    isPinned: (id) => pins.has(id),
    togglePin: (id) => (pins.has(id) ? unpin([id]) : pin([id])),
    expand: (id) => void expand(id),
  });
  // Over the canvas, above its bottom edge: the rows below the stage stay readable.
  const status = statusLine(stage);

  // The controls: layout, caption, path highlight, pin all and unpin all.
  const controls = el('div', { class: 'graph-controls' }, root);
  const layoutSelect = picker(controls, 'Layout', 'graph-layout');
  for (const name of LAYOUTS) el('option', { value: name, text: name[0].toUpperCase() + name.slice(1) }, layoutSelect);
  const captionSelect = picker(controls, 'Caption', 'graph-caption');
  const highlightBtn = el('button', { type: 'button', class: 'graph-btn graph-highlight', 'data-action': 'highlight', 'aria-pressed': 'false', text: 'Highlight path' }, controls);
  const pinAllBtn = el('button', { type: 'button', class: 'graph-btn', 'data-action': 'pin-all', text: 'Pin all' }, controls);
  const unpinAllBtn = el('button', { type: 'button', class: 'graph-btn', 'data-action': 'unpin-all', text: 'Unpin all' }, controls);
  const legend = el('div', { class: 'graph-legend' }, root);

  // A double-tap on a touch screen pins; a double-click expands. On a touch
  // screen a tap opens the inspector only once no second tap came: opened at
  // once, its panel would lie over the stage where the second tap lands.
  let pointer = 'mouse';
  let tapHold: ReturnType<typeof setTimeout> | undefined;
  stage.addEventListener('pointerdown', (e) => (pointer = e.pointerType), { capture: true });
  const handlers = interactions(nvl, {
    onMove: () => camera.moved(),
    onPoint: (key) => {
      stage.style.cursor = key ? 'pointer' : '';
      // A touch screen has no hover: a tap opens the inspector instead.
      if (pointer !== 'touch') inspector.hover(key);
    },
    onHold: (key) => {
      clearTimeout(tapHold);
      const hold = () => {
        if (key) select(key);
        inspector.hold(key);
      };
      if (pointer === 'touch' && key) tapHold = setTimeout(hold, DOUBLE_TAP_MS);
      else hold();
    },
    onDouble: (id) => {
      clearTimeout(tapHold);
      if (pointer !== 'touch') void expand(id);
      else if (pins.has(id)) unpin([id]);
      else pin([id]);
    },
    onDragged: (keys) => pin(keys.filter((k) => kindOf(k) === 'node').map(idOf), true),
  });
  gateWheel(root, stage, () => status.say('Click the graph (or hold Ctrl/⌘) to zoom with the wheel', 2500));
  const resized = new ResizeObserver(() => camera.resized(root.classList.contains('is-full')));
  resized.observe(stage);
  // NVL paints on a canvas, so a theme change repaints the relationship and dimmed colours.
  const unwatchTheme = watchTheme(() => {
    theme = canvasTheme();
    paintHighlight();
    if (pins.size) paintPinIcons(pins.keys());
  });
  const onMotion = () => {
    if (!still()) host.style.visibility = '';
  };
  motion.addEventListener('change', onMotion);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && root.classList.contains('is-full')) setFull(false);
  };
  document.addEventListener('keydown', onKey);

  // ------------------------------------------------ layout

  /** The pinned nodes this view draws, at their pinned places: put back after a layout that ignores pins. */
  const pinnedAt = () =>
    [...pins].filter(([id]) => drawn.nodes.has(id)).map(([id, at]) => ({ id: nodeKey(id), x: at.x, y: at.y, pinned: true }));

  let fallback: ReturnType<typeof setTimeout> | undefined;
  function layoutDone() {
    clearTimeout(fallback);
    const then = settling;
    settling = null;
    then?.();
    camera.settled();
    if (still()) {
      // Shown once settled; under reduced motion a force layout then stops,
      // so a drag moves only the node dragged.
      host.style.visibility = '';
      if (prefs.layout === 'force') nvl.setLayout('free');
    }
  }

  /**
   * A layout is about to run (a switch, nodes added or removed): put the
   * pinned nodes back once it settles, since NVL's hierarchical and circular
   * layouts place every node, pinned or not. Under reduced motion it runs out
   * of sight (a force layout, stopped once settled, starts again to place
   * new nodes), and a layout that never reports done (nothing to move) still
   * shows.
   */
  function relayout(restart: boolean) {
    const keep = pinnedAt();
    settling = () => {
      if (keep.length) nvl.setNodePositions(keep, false);
    };
    if (still()) {
      host.style.visibility = 'hidden';
      if (restart && prefs.layout === 'force') nvl.setLayout(NVL_LAYOUT.force);
    }
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      if (settling) layoutDone();
    }, 4000);
  }

  // Who hears a change of layout, caption, highlight or pins (a cell's
  // graph-extras pane keeps its sentence true); several changes in one task
  // are told once.
  const changeListeners = new Set<() => void>();
  let changeQueued = false;
  function changed() {
    if (changeQueued || changeListeners.size === 0) return;
    changeQueued = true;
    queueMicrotask(() => {
      changeQueued = false;
      for (const l of changeListeners) l();
    });
  }

  function setLayout(name: LayoutName, chosen = false) {
    if (chosen) remember({ layout: name });
    prefs.layout = name;
    root.dataset.layout = name;
    layoutSelect.value = name;
    relayout(false);
    nvl.setLayout(NVL_LAYOUT[name]);
    if (name === 'hierarchical') nvl.setLayoutOptions({ direction: 'down' });
    if (chosen) status.say(`Layout: ${name}`, 2500);
    changed();
  }

  // ------------------------------------------------ captions

  function fillCaptions() {
    const keys = propertyKeys(drawn.nodes.values());
    if (prefs.caption && !keys.includes(prefs.caption)) keys.unshift(prefs.caption);
    captionSelect.replaceChildren(el('option', { value: '', text: 'Default' }));
    for (const k of keys) el('option', { value: k, text: k }, captionSelect);
    captionSelect.value = prefs.caption ?? '';
  }

  function setCaption(property: string | null, chosen = false) {
    if (chosen) remember({ caption: property });
    prefs.caption = property;
    root.dataset.caption = property ?? '';
    captionSelect.value = property ?? '';
    nvl.updateElementsInGraph([...drawn.nodes.values()].map((n) => ({ id: nodeKey(n.id), caption: captionOf(n) })) as never, []);
    paintLegend();
    changed();
  }

  // ------------------------------------------------ paths

  /**
   * Draw the paths on top (wider relationships, ringed nodes) and dim the
   * rest toward the pane, each element keeping its hue, or draw everything in
   * its own colour. Dimming is a colour, not NVL's `disabled`, whose colour
   * is fixed when NVL starts and so could not follow a theme change.
   */
  function paintHighlight() {
    const on = prefs.highlight && hasPaths();
    root.dataset.highlight = hasPaths() ? (on ? 'on' : 'off') : '';
    highlightBtn.hidden = !hasPaths();
    highlightBtn.setAttribute('aria-pressed', String(on));
    highlightBtn.textContent = paths.paths.length > 1 ? 'Highlight paths' : 'Highlight path';
    // A node's size goes to NVL only when it changes (the highlight turned on
    // or off), not on a theme repaint: see select().
    const sizes = new Map((nvl.getNodes() as { id: string; size?: number }[]).map((n) => [n.id, n.size]));
    nvl.updateElementsInGraph(
      [...drawn.nodes.values()].map((n) => {
        const { size, ...look } = nodeLook(n, on);
        return sizes.get(look.id) === size ? look : { ...look, size };
      }) as never,
      [...drawn.rels.values()].map((r) => relLook(r, on)) as never,
    );
    paintLegend();
    changed();
  }

  function setHighlight(on: boolean, chosen = false) {
    if (chosen) remember({ highlight: on });
    prefs.highlight = on;
    paintHighlight();
    if (chosen && hasPaths()) status.say(on ? 'Path highlighted' : 'Highlight off', 2500);
  }

  // ------------------------------------------------ pins

  /** Where node `id` is now, as its pinned place. */
  function place(id: number) {
    const at = nvl.getPositionById(nodeKey(id));
    pins.set(id, { x: at?.x ?? 0, y: at?.y ?? 0 });
  }

  /** Pin `ids` where they are now (a drag has moved them there already). */
  function pin(ids: number[], dragged = false) {
    const now = ids.filter((id) => drawn.nodes.has(id));
    for (const id of now) {
      place(id);
      // NVL's drag pins too; pinning again costs nothing and does not rest on that.
      nvl.pinNode(nodeKey(id));
    }
    // NVL applies a drag's last move on its next frame: the place is read again after it.
    if (dragged) requestAnimationFrame(() => requestAnimationFrame(() => now.forEach((id) => pins.has(id) && place(id))));
    paintPinIcons(now);
    paintPins();
    if (!dragged && now.length) status.say(now.length === 1 ? 'Pinned' : `Pinned ${plural(now.length, 'node')}`, 2500);
  }

  /** The pin marker on `ids`, in the current theme's colours. */
  function paintPinIcons(ids: Iterable<number>) {
    const overlayIcon = pinOverlay();
    nvl.updateElementsInGraph([...ids].map((id) => ({ id: nodeKey(id), overlayIcon })) as never, []);
  }

  function unpin(ids: number[]) {
    const now = ids.filter((id) => pins.has(id));
    for (const id of now) pins.delete(id);
    if (now.length) nvl.unPinNode(now.map(nodeKey));
    nvl.updateElementsInGraph(now.map((id) => ({ id: nodeKey(id), overlayIcon: undefined, pinned: false })) as never, []);
    paintPins();
    if (now.length) status.say(now.length === 1 ? 'Unpinned' : `Unpinned ${plural(now.length, 'node')}`, 2500);
  }

  function paintPins() {
    root.dataset.pinned = String(pins.size);
    unpinAllBtn.disabled = pins.size === 0;
    pinAllBtn.disabled = pins.size === drawn.nodes.size;
    inspector.refresh();
    changed();
  }

  // ------------------------------------------------ full screen

  // A class, not the Fullscreen API: it works on every phone (iOS Safari has
  // no element full screen) and Escape or the button leaves it. While full
  // the view is a modal dialog: everything outside it is inert, so Tab stays
  // among its controls instead of reaching the page hidden behind it.
  let inerted: Element[] = [];
  function setFull(on: boolean) {
    root.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('graph-full-open', on);
    fullBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Leave full screen' : 'Full screen';
    fullBtn.setAttribute('aria-label', label);
    fullBtn.title = label;
    for (const e of inerted) e.removeAttribute('inert');
    inerted = [];
    if (on) {
      for (let n: Element = root; n.parentElement && n !== document.body; n = n.parentElement) {
        for (const sibling of n.parentElement.children) {
          if (sibling === n || sibling.hasAttribute('inert')) continue;
          sibling.setAttribute('inert', '');
          inerted.push(sibling);
        }
      }
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Graph, full screen');
      fullBtn.focus();
    } else {
      root.removeAttribute('role');
      root.removeAttribute('aria-modal');
      root.removeAttribute('aria-label');
    }
  }

  // ------------------------------------------------ the rest

  /** Each node's client coordinates: NVL's getNodes gives them relative to its canvas. */
  function screenPoints() {
    const box = host.getBoundingClientRect();
    return Object.fromEntries(
      (nvl.getNodes() as { id: string; x?: number; y?: number }[]).map((n) => [n.id, { x: box.left + (n.x ?? 0), y: box.top + (n.y ?? 0) }]),
    );
  }

  function paintLegend() {
    drawLegend(legend, drawn, note, {
      theme,
      paths: hasPaths() ? pathText(paths, drawn, captionOf) : null,
      highlight: prefs.highlight,
    });
  }

  function remember(choice: Partial<ViewDefaults>) {
    remembered.set(container, { ...remembered.get(container), ...choice });
  }

  layoutSelect.addEventListener('change', () => isLayout(layoutSelect.value) && setLayout(layoutSelect.value, true));
  captionSelect.addEventListener('change', () => setCaption(captionSelect.value || null, true));
  highlightBtn.addEventListener('click', () => setHighlight(!prefs.highlight, true));
  pinAllBtn.addEventListener('click', () => pin([...drawn.nodes.keys()].filter((id) => !pins.has(id))));
  unpinAllBtn.addEventListener('click', () => unpin([...pins.keys()]));

  let expanding = false;
  async function expand(id: number) {
    if (expanding) return;
    expanding = true;
    status.say('Expanding…', null);
    try {
      await onExpand(id, [...drawn.nodes.keys()]);
    } finally {
      expanding = false;
    }
  }

  /** Drop every expansion: the step's result again. */
  function showResult() {
    const gone = drawn.keepOnly(original);
    for (const id of gone.nodes) pins.delete(id);
    for (const id of gone.nodes) dimmed.delete(nodeKey(id));
    for (const id of gone.rels) dimmed.delete(relKey(id));
    if (gone.nodes.length || gone.rels.length) relayout(false);
    nvl.removeRelationshipsWithIds(gone.rels.map(relKey));
    nvl.removeNodesWithIds(gone.nodes.map(nodeKey));
    inspector.prune();
    resetBtn.hidden = true;
    status.say('');
    fillCaptions();
    paintPins();
    paintLegend();
    camera.fit();
  }

  root.dataset.layout = prefs.layout;
  root.dataset.caption = prefs.caption ?? '';
  layoutSelect.value = prefs.layout;
  fillCaptions();
  paintPins();
  paintHighlight();
  // Nodes pinned in this cell's last view start at their places; the first
  // layout puts them back there once it settles (as after a switch).
  relayout(false);

  const view: GraphView = {
    grow(id, outcome) {
      const { say } = status;
      if (outcome.problem !== undefined) return say(`Could not expand: ${outcome.problem}`);
      if (!drawn.nodes.has(id)) return say('That node is not in this result any more.');
      const { nodes, rels, left } = drawn.add(outcome.graph, MAX_DRAWN);
      if (nodes.length === 0 && rels.length === 0) {
        return say(left ? `The view is full (${MAX_DRAWN} nodes).` : 'Nothing to add: every neighbour is drawn.');
      }
      // New nodes start around the expanded one, and the layout takes it
      // from there; pinned nodes are put back where they were pinned.
      const at = nvl.getPositionById(nodeKey(id)) ?? { x: 0, y: 0 };
      const spread = 40 + 6 * Math.sqrt(nodes.length);
      relayout(true);
      nvl.addAndUpdateElementsInGraph(
        nodes.map((n, i) => {
          const a = (2 * Math.PI * i) / nodes.length;
          return { ...nodeOf(n), x: (at.x ?? 0) + spread * Math.cos(a), y: (at.y ?? 0) + spread * Math.sin(a) };
        }) as never,
        rels.map(relOf) as never,
      );
      resetBtn.hidden = false;
      fillCaptions();
      paintPins();
      paintLegend();
      const notes = [];
      if (outcome.graph.truncated) notes.push(`its first ${EXPAND_LIMIT} neighbours`);
      if (left) notes.push(`the view is full at ${MAX_DRAWN} nodes`);
      const added = `Added ${plural(nodes.length, 'node')} and ${plural(rels.length, 'relationship')}`;
      say(`${added}${notes.length ? ` (${notes.join('; ')})` : ''}.`);
    },

    configure(defaults) {
      const mine = remembered.get(container) ?? {};
      if (defaults.layout !== undefined && mine.layout === undefined && defaults.layout !== prefs.layout) setLayout(defaults.layout);
      if (defaults.caption !== undefined && mine.caption === undefined && defaults.caption !== prefs.caption) setCaption(defaults.caption);
      if (defaults.highlight !== undefined && mine.highlight === undefined && defaults.highlight !== prefs.highlight) setHighlight(defaults.highlight);
    },
    setLayout: (name) => setLayout(name, true),
    setCaption: (property) => setCaption(property, true),
    setHighlight: (on) => setHighlight(on, true),
    setPaths(env) {
      const next = pathsOf(env);
      const same = next.paths.length === paths.paths.length && [...next.rels].every((r) => paths.rels.has(r)) && [...next.nodes].every((n) => paths.nodes.has(n));
      if (same) return;
      paths = next;
      paintHighlight();
    },
    pin: (ids) => pin(ids),
    unpin: (ids) => unpin(ids),

    state() {
      const nodes = nvl.getNodes() as { id: string; selected?: boolean; size?: number; color?: string; caption?: string; pinned?: boolean; overlayIcon?: { url?: string } }[];
      const rels = nvl.getRelationships() as { id: string; width?: number; color?: string }[];
      return {
        layout: prefs.layout,
        caption: prefs.caption,
        highlight: prefs.highlight && hasPaths(),
        paths: paths.paths.length,
        highlighted: { nodes: nodes.filter((n) => n.selected && (n.size ?? NODE_SIZE) > NODE_SIZE).length, rels: rels.filter((r) => (r.width ?? 1) > 1).length },
        dimmed: [...nodes, ...rels].filter((x) => dimmed.has(x.id) && x.color === dimmed.get(x.id)).length,
        positions: Object.fromEntries(nvl.getNodePositions().map((p) => [p.id, { x: p.x, y: p.y }])),
        screen: screenPoints(),
        captions: Object.fromEntries(nodes.map((n) => [n.id, n.caption ?? ''])),
        selected: nodes.filter((n) => n.selected).map((n) => n.id),
        pinned: [...pins.keys()].map(nodeKey),
        nvlPinned: nodes.filter((n) => n.pinned).map((n) => n.id),
        pinIcons: nodes.filter((n) => n.overlayIcon?.url).map((n) => n.id),
        relTypes: relTypes(drawn.rels.values()),
        moving: nvl.isLayoutMoving(),
        hidden: host.style.visibility === 'hidden',
        full: root.classList.contains('is-full'),
      };
    },

    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },

    destroy() {
      changeListeners.clear();
      clearTimeout(fallback);
      clearTimeout(tapHold);
      status.stop();
      resized.disconnect();
      unwatchTheme();
      motion.removeEventListener('change', onMotion);
      document.removeEventListener('keydown', onKey);
      if (root.classList.contains('is-full')) setFull(false);
      for (const h of handlers) h.destroy();
      nvl.destroy();
      root.remove();
    },
  };
  // The view, reachable from its element: cookbook:browser reads `state()`
  // through it, as the page has no other handle on a cell's view.
  Object.defineProperty(root, 'graphView', { value: view });
  return view;
}

// ---------------------------------------------------------------- network

// A graph drawn at positions its caller computed, in the colours, sizes and
// captions its caller gives (`:::docs-graph`,
// src/scripts/docs/elements/docs-graph.ts, draws the docs graph with it).
// NVL's free layout draws each node where it was put, so nothing moves on
// load. It shares the result views' canvas renderer, theme watcher and wheel
// gate, and its camera never animates: a fit jumps.
// Search marks and dims by recolouring and resizing nodes, not with NVL's
// selected and disabled states, whose colours are fixed when NVL starts
// and would stay on the old theme after a switch.

/** A node to draw: its position in layout units, fill colour, radius and caption. */
export interface NetNode {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
  caption: string;
}

/** A relationship to draw; `strong` draws it thicker, in the stronger line colour. */
export interface NetRel {
  id: string;
  from: string;
  to: string;
  strong?: boolean;
}

/** How a drawn node or relationship is marked: `dim` paints it in the inset colour, `mark` draws a node half as large again. */
export interface NetStyle {
  id: string;
  dim?: boolean;
  mark?: boolean;
}

export interface NetworkOptions {
  /** The element whose `is-full` class means the view fills the screen, where the wheel zooms at once. */
  frame: HTMLElement;
  /** CSS pixels a fit leaves clear at the pane's right edge, beyond its margin (a toolbar drawn over the canvas). */
  clearRight?: number;
  /** A node was clicked or tapped, with the pointer type of the press (mouse, pen or touch). */
  onNodeClick: (id: string, pointerType: string) => void;
  /** The canvas, not a node, was clicked. */
  onCanvasClick: () => void;
  /** The pointer is over this node now, or over none. */
  onHover: (id: string | null) => void;
  /** A wheel scrolled past the view without zooming it. */
  onWheelPast: () => void;
}

/** What a network view draws now, read from NVL, for a browser case. */
export interface NetworkState {
  nodes: Record<string, { color: string; size: number }>;
  rels: Record<string, { color: string; width: number }>;
  /** The colour a dimmed element is painted in, in the current theme. */
  dimmed: string;
  /** CSS pixels per layout unit. */
  scale: number;
  pan: { x: number; y: number };
}

export interface NetworkView {
  /** Draw exactly these nodes and relationships: add the new, remove the gone, keep the rest where they are. */
  replace(nodes: NetNode[], rels: NetRel[]): void;
  /** Set the marks of these drawn elements; an element left out keeps its marks. */
  restyle(nodes: NetStyle[], rels: NetStyle[]): void;
  /** Fit the camera to these nodes (every drawn node when empty). */
  fit(ids?: string[]): void;
  zoomBy(factor: number): void;
  /** Where node `id` is on screen (client coordinates), or null when it is not drawn. */
  point(id: string): { x: number; y: number } | null;
  state(): NetworkState;
  destroy(): void;
}

/** Draw `first` into `host` (which needs a height) with NVL's free layout. */
export function renderNetwork(host: HTMLElement, first: { nodes: NetNode[]; rels: NetRel[] }, options: NetworkOptions): NetworkView {
  const tone = () => ({ ...canvasTheme(), strong: getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim() });
  let theme = tone();
  const nodes = new Map(first.nodes.map((n) => [n.id, n]));
  const rels = new Map(first.rels.map((r) => [r.id, r]));
  const marks = new Map<string, NetStyle>();
  let hovered: string | null = null;

  // NVL's own layouts place nodes in device pixels: it draws a node at
  // (position - pan) * zoom / devicePixelRatio from the canvas centre, but its
  // radius, line offsets and arrowheads at size * zoom. The positions given in
  // layout units are handed to NVL times the ratio, so on any screen a layout
  // unit is `zoom` CSS pixels, the same as a node's radius.
  const dpr = () => devicePixelRatio || 1;
  const paintNode = (n: NetNode) => {
    const m = marks.get(n.id);
    return { id: n.id, color: m?.dim ? theme.dimmed : n.color, size: n.size * (m?.mark ? 1.5 : 1) + (hovered === n.id ? 3 : 0) };
  };
  const paintRel = (r: NetRel) => ({
    id: r.id,
    color: marks.get(r.id)?.dim ? theme.dimmed : r.strong ? theme.strong : theme.rel,
    width: r.strong ? 2 : 1,
  });
  const nvlNodeOf = (n: NetNode) => ({ ...n, x: n.x * dpr(), y: n.y * dpr(), ...paintNode(n) });
  const nvlRelOf = (r: NetRel) => ({ from: r.from, to: r.to, ...paintRel(r) });

  const nvl = new NVL(host, first.nodes.map(nvlNodeOf) as never, first.rels.map(nvlRelOf) as never, {
    renderer: 'canvas',
    layout: 'free',
    disableWebWorkers: true,
    disableTelemetry: true,
    // The caller announces what changes in its own words (a status line), not NVL's per-element live region.
    disableAria: true,
    minZoom: 0.05,
    maxZoom: 4,
  }, { onError: (err: unknown) => console.error('network view:', err) });

  // The pointer type of the press behind a click: NVL hands its callbacks the element, not the pointer.
  let pointerType = 'mouse';
  const pressed = (e: PointerEvent) => (pointerType = e.pointerType || 'mouse');
  host.addEventListener('pointerdown', pressed, { capture: true });

  let moved = false; // the reader zoomed or panned: leave the camera where they put it
  const keyOf = (element: unknown) => (element as { id?: string } | null | undefined)?.id ?? null;
  const zoom = new ZoomInteraction(nvl);
  const pan = new PanInteraction(nvl, { excludeNodeMargin: true });
  const drag = new OneNodeDrag(nvl);
  const click = new ClickInteraction(nvl, { selectOnClick: false });
  const hover = new HoverInteraction(nvl, { drawShadowOnHover: false });
  zoom.updateCallback('onZoom', () => (moved = true));
  pan.updateCallback('onPan', () => (moved = true));
  hover.updateCallback('onHover', (element: unknown) => {
    const key = keyOf(element);
    const id = key && nodes.has(key) ? key : null;
    if (id === hovered) return;
    const was = hovered;
    hovered = id;
    // A hovered node grows a little: a change of size, which no theme switch can leave behind.
    const changed = [was, id].flatMap((k) => (k && nodes.has(k) ? [paintNode(nodes.get(k)!)] : []));
    if (changed.length) nvl.updateElementsInGraph(changed as never, []);
    options.onHover(id);
  });
  click.updateCallback('onNodeClick', (node: unknown) => {
    const id = keyOf(node);
    if (id) options.onNodeClick(id, pointerType);
  });
  click.updateCallback('onCanvasClick', () => options.onCanvasClick());
  const handlers = [zoom, pan, drag, click, hover];
  gateWheel(options.frame, host, options.onWheelPast);

  let fitted = false;
  let width = 0;
  // The camera fits the box around the nodes to the pane, with a margin of a
  // node and a little more, and jumps there: NVL's own fit leaves margins that
  // halve the graph in a phone-width pane, and an animated camera is motion
  // that no reader asked for (under prefers-reduced-motion or not).
  const fitTo = (ids: string[]) => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    const at = (ids.length ? ids : [...nodes.keys()]).flatMap((id) => {
      const p = nodes.has(id) ? nvl.getPositionById(id) : undefined;
      return p && p.x !== undefined && p.y !== undefined ? [{ x: p.x / dpr(), y: p.y / dpr(), r: nodes.get(id)!.size }] : [];
    });
    if (w === 0 || h === 0 || !at.length) return false;
    const minX = Math.min(...at.map((p) => p.x - p.r));
    const maxX = Math.max(...at.map((p) => p.x + p.r));
    const minY = Math.min(...at.map((p) => p.y - p.r));
    const maxY = Math.max(...at.map((p) => p.y + p.r));
    const margin = 16;
    const right = margin + (options.clearRight ?? 0);
    const fit = Math.max(0.05, Math.min(1.6, (w - margin - right) / Math.max(maxX - minX, 1), (h - 2 * margin) / Math.max(maxY - minY, 1)));
    // The box's centre goes to the centre of the clear part of the pane.
    const cx = (minX + maxX) / 2 + (right - margin) / 2 / fit;
    nvl.setZoomAndPan(fit, cx * dpr(), ((minY + maxY) / 2) * dpr());
    return true;
  };
  // A view drawn while its pane was hidden fits once the pane has a width;
  // later it refits when the width changes, until the reader moves it. A
  // change of height alone (a phone's address bar showing or hiding as the
  // page scrolls) leaves the camera where it is.
  const resized = new ResizeObserver(() => {
    if (host.clientWidth === width && fitted) return;
    width = host.clientWidth;
    if (!moved && fitTo([])) fitted = true;
  });
  resized.observe(host);

  const unwatchTheme = watchTheme(() => {
    theme = tone();
    nvl.updateElementsInGraph([...nodes.values()].map(paintNode) as never, [...rels.values()].map(paintRel) as never);
  });

  return {
    replace(nextNodes, nextRels) {
      const wantN = new Set(nextNodes.map((n) => n.id));
      const wantR = new Set(nextRels.map((r) => r.id));
      const goneR = [...rels.keys()].filter((id) => !wantR.has(id));
      const goneN = [...nodes.keys()].filter((id) => !wantN.has(id));
      if (goneR.length) nvl.removeRelationshipsWithIds(goneR);
      if (goneN.length) nvl.removeNodesWithIds(goneN);
      for (const id of [...goneR, ...goneN]) marks.delete(id);
      for (const id of goneR) rels.delete(id);
      for (const id of goneN) nodes.delete(id);
      if (hovered && !nodes.has(hovered)) hovered = null;
      const addN = nextNodes.filter((n) => !nodes.has(n.id));
      const addR = nextRels.filter((r) => !rels.has(r.id));
      for (const n of addN) nodes.set(n.id, n);
      for (const r of addR) rels.set(r.id, r);
      if (addN.length || addR.length) nvl.addElementsToGraph(addN.map(nvlNodeOf) as never, addR.map(nvlRelOf) as never);
    },
    restyle(ns, rs) {
      for (const s of [...ns, ...rs]) marks.set(s.id, s);
      nvl.updateElementsInGraph(
        ns.flatMap((s) => (nodes.has(s.id) ? [paintNode(nodes.get(s.id)!)] : [])) as never,
        rs.flatMap((s) => (rels.has(s.id) ? [paintRel(rels.get(s.id)!)] : [])) as never,
      );
    },
    fit(ids = []) {
      moved = false;
      fitted = fitTo(ids) || fitted;
    },
    zoomBy(factor) {
      moved = true;
      nvl.setZoom(nvl.getScale() * factor);
    },
    point(id) {
      const at = nodes.has(id) ? nvl.getPositionById(id) : undefined;
      if (!at || at.x === undefined || at.y === undefined) return null;
      // NVL's position to the canvas: its pan is the position at the canvas centre (both in device pixels).
      const p = nvl.getPan();
      const scale = nvl.getScale() / dpr();
      const rect = host.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + (at.x - p.x) * scale, y: rect.top + rect.height / 2 + (at.y - p.y) * scale };
    },
    state() {
      const drawnNodes = nvl.getNodes() as { id: string; color?: string; size?: number }[];
      const drawnRels = nvl.getRelationships() as { id: string; color?: string; width?: number }[];
      return {
        nodes: Object.fromEntries(drawnNodes.map((n) => [n.id, { color: n.color ?? '', size: n.size ?? 0 }])),
        rels: Object.fromEntries(drawnRels.map((r) => [r.id, { color: r.color ?? '', width: r.width ?? 1 }])),
        dimmed: theme.dimmed,
        scale: nvl.getScale(),
        pan: nvl.getPan(),
      };
    },
    destroy() {
      resized.disconnect();
      unwatchTheme();
      host.removeEventListener('pointerdown', pressed, { capture: true });
      for (const h of handlers) h.destroy();
      nvl.destroy();
    },
  };
}

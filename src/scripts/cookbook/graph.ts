// Graph view for cookbook steps (ADR-0151): a step's graph result drawn by
// NVL, Neo4j's visualization library. Ported from the Relate repository's
// scripts/cookbook/runtime/graph.js. The reader zooms (pinch, the wheel once
// they have clicked into the view or with Ctrl/⌘ held, or the buttons), pans,
// drags nodes, hovers or clicks an element to inspect it, and double-clicks a
// node to add its neighbours from the page's database. The runtime imports
// this module only when a graph view is about to show.

import { NVL } from '@neo4j-nvl/base';
import {
  ClickInteraction,
  DragNodeInteraction,
  HoverInteraction,
  PanInteraction,
  ZoomInteraction,
} from '@neo4j-nvl/interaction-handlers';

import {
  DrawnGraph,
  EXPAND_LIMIT,
  MAX_DRAWN,
  MAX_NODES,
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

// Labels are coloured as the recipe's data-model diagram colours them.
const COLORS = labelColors(document.getElementById('label-colors')?.textContent);

const ICONS = {
  in: '<path d="M8 3v10M3 8h10"/>',
  out: '<path d="M3 8h10"/>',
  fit: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/>',
  reset: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2v3h3"/>',
};

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

/**
 * The colours NVL draws with in the page's current theme. Its canvas is out
 * of the CSS's reach, so they are read from the page's colour tokens.
 */
function canvasTheme() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return { rel: token('--fg-faint'), selected: token('--accent'), shadow: token('--accent') };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const labelText = (labels: string[]) => labels.map((l) => `:${l}`).join('') || '(no label)';

type Theme = ReturnType<typeof canvasTheme>;

// ---------------------------------------------------------------- parts

/** An NVL instance in `host` drawing `first` (`{nodes, rels}`, wire JSON). */
function createNvl(host: HTMLElement, first: Graph, theme: Theme, callbacks: { onLayoutDone: () => void }) {
  return new NVL(
    host,
    first.nodes.map((n) => nvlNode(n, COLORS)),
    first.rels.map((r) => nvlRel(r, theme.rel)),
    {
      renderer: 'canvas',
      layout: 'd3Force',
      // NVL lays out on the page's thread: cookbook results are small, and its
      // workers would need more bundling than the view is worth.
      disableWebWorkers: true,
      disableTelemetry: true,
      minZoom: 0.05,
      maxZoom: 4,
      styling: { selectedBorderColor: theme.selected, dropShadowColor: theme.shadow },
    },
    { ...callbacks, onError: (err: unknown) => console.error('graph view:', err) },
  );
}

/**
 * NVL's interaction handlers on `nvl`, reporting to the view: `onMove()` when
 * the reader zooms or pans, `onPoint(key)` with the NVL id under the pointer
 * (or null), `onPin(key)` on a click (null on the canvas), and `onExpand(id)`
 * with the engine id of a node double-clicked. Returns the handlers, to
 * destroy.
 */
function interactions(
  nvl: NVL,
  handlers: {
    onMove: () => void;
    onPoint: (key: string | null) => void;
    onPin: (key: string | null) => void;
    onExpand: (id: number) => void;
  },
) {
  const zoom = new ZoomInteraction(nvl);
  const pan = new PanInteraction(nvl, { excludeNodeMargin: true });
  const drag = new DragNodeInteraction(nvl);
  const click = new ClickInteraction(nvl, { selectOnClick: true });
  const hover = new HoverInteraction(nvl, { drawShadowOnHover: true });
  zoom.updateCallback('onZoom', handlers.onMove);
  pan.updateCallback('onPan', handlers.onMove);
  // NVL hands each callback the element (or nothing), typed as unknown.
  const keyOf = (element: unknown) => (element as { id?: string } | null | undefined)?.id ?? null;
  hover.updateCallback('onHover', (element: unknown) => handlers.onPoint(keyOf(element)));
  click.updateCallback('onNodeClick', (node: unknown) => handlers.onPin(keyOf(node)));
  click.updateCallback('onRelationshipClick', (rel: unknown) => handlers.onPin(keyOf(rel)));
  click.updateCallback('onCanvasClick', () => handlers.onPin(null));
  click.updateCallback('onNodeDoubleClick', (node: unknown) => {
    const key = keyOf(node);
    if (key) handlers.onExpand(idOf(key));
  });
  return [zoom, pan, drag, click, hover];
}

/** Keeping the graph fitted to the pane (`fitAll(animated)` fits it) until the reader zooms or pans it. */
function createCamera(stage: HTMLElement, fitAll: (animated: boolean) => void) {
  let fitted = false; // fitted to the graph since it was drawn
  let moved = false; // the reader has zoomed or panned since
  const fit = (animated: boolean) => {
    if (stage.clientWidth === 0) return;
    fitAll(animated);
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
    /** The pane resized: fit a graph drawn while its pane was hidden. */
    resized: () => {
      if (!fitted && !moved) fit(false);
    },
  };
}

/** The toolbar: zoom in and out, fit, and reset. Returns the reset button, shown once the view has grown. */
function toolbar(parent: HTMLElement, actions: { zoomBy: (f: number) => void; fit: () => void; reset: () => void }) {
  const tools = el('div', { class: 'graph-tools' }, parent);
  button(tools, 'in', 'Zoom in').addEventListener('click', () => actions.zoomBy(1.4));
  button(tools, 'out', 'Zoom out').addEventListener('click', () => actions.zoomBy(1 / 1.4));
  button(tools, 'fit', 'Fit the graph to the view').addEventListener('click', actions.fit);
  const resetBtn = button(tools, 'reset', 'Show the step’s result again');
  resetBtn.hidden = true;
  resetBtn.addEventListener('click', actions.reset);
  return resetBtn;
}

/**
 * The inspector: the labels or type and properties of the element clicked
 * (pinned until it is closed or the canvas is clicked), else of the one under
 * the pointer. `itemOf(key)` is the wire element behind an NVL id;
 * `onUnpin()` runs when a pinned element is let go.
 */
function createInspector(
  parent: HTMLElement,
  itemOf: (key: string) => WireNode | WireRel | undefined,
  onUnpin: () => void,
) {
  const panel = el('div', { class: 'graph-inspector', hidden: '' }, parent);
  let pinned: string | null = null;

  // Unpinned, the panel lets the pointer through to the graph beneath.
  function show(key: string | null) {
    const item = key ? itemOf(key) : undefined;
    panel.hidden = !item;
    if (!key || !item) return;
    const kind = kindOf(key);
    panel.replaceChildren();
    panel.classList.toggle('is-pinned', key === pinned);
    const head = el('div', { class: 'graph-inspector-head' }, panel);
    if ('labels' in item) {
      const chip = el('span', { class: 'graph-chip', text: labelText(item.labels) }, head);
      chip.style.background = labelColor(item.labels, COLORS);
    } else {
      el('span', { class: 'graph-chip rel', text: `:${item.type}` }, head);
    }
    el('span', { class: 'graph-inspector-id', text: `${kind} ${item.id}` }, head);
    if (key === pinned) {
      const close = el('button', { type: 'button', class: 'graph-inspector-close', 'aria-label': 'Close' }, head);
      close.textContent = '×';
      close.addEventListener('click', () => pin(null));
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
    if (kind === 'node') el('p', { class: 'graph-inspector-hint', text: 'Double-click to expand' }, panel);
  }

  function pin(key: string | null) {
    if (!key && pinned) onUnpin();
    pinned = key;
    show(key);
  }

  return {
    pin,
    hover: (key: string | null) => {
      if (!pinned) show(key);
    },
    /** Let go of a pinned element the view no longer draws. */
    prune: () => {
      if (pinned && !itemOf(pinned)) pin(null);
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

/** The legend: a chip per label set `drawn` draws, then `note` if any, then the hint. */
function drawLegend(legend: HTMLElement, drawn: DrawnGraph, note: string | null) {
  legend.replaceChildren();
  const sets = new Map([...drawn.nodes.values()].map((n) => [labelKey(n.labels), n.labels]));
  for (const labels of sets.values()) {
    const item = el('span', {}, legend);
    el('i', {}, item).style.background = labelColor(labels, COLORS);
    item.append(labelText(labels));
  }
  if (note) el('span', { class: 'graph-note', text: note }, legend);
  el('span', { class: 'graph-hint', text: 'Double-click a node to expand it' }, legend);
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
      if (engaged || e.ctrlKey || e.metaKey) {
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

// ---------------------------------------------------------------- view

/** What expanding a node came to: its neighbours, or why not. */
export type Outcome = { graph: Expansion; problem?: undefined } | { problem: string; graph?: undefined };

export interface GraphView {
  /** Add node `id`'s neighbours. */
  grow(id: number, outcome: Outcome): void;
  destroy(): void;
}

/**
 * Draw `graph` (a recording's `{nodes, rels}`) into `container`. A
 * double-click on a node calls `onExpand(id, drawn)`, `drawn` being the
 * engine ids of the nodes on screen; the answer comes back through the view's
 * `grow` (a run can replace the view in between, and the answer goes to
 * whichever view shows the step then).
 */
export function renderGraph(
  container: HTMLElement,
  graph: Graph,
  { onExpand }: { onExpand: (id: number, drawn: number[]) => Promise<void> },
): GraphView {
  const original = new DrawnGraph();
  original.add(graph, MAX_NODES);
  const drawn = new DrawnGraph();
  const first = drawn.add(graph, MAX_NODES);
  const note = first.left > 0 ? `first ${MAX_NODES} of ${graph.nodes.length} nodes` : null;
  let theme = canvasTheme();

  const root = el('div', { class: 'graph-view' }, container);
  // NVL sizes its element to its parent's height, so it gets one inside the
  // stage, which the reader can resize.
  const stage = el('div', { class: 'graph-stage' }, root);
  const host = el('div', { class: 'graph-host' }, stage);
  // The camera fits through `nvl`, which is created right after it.
  const camera = createCamera(stage, (animated) =>
    nvl.fit([...drawn.nodes.keys()].map(nodeKey), { animated, maxZoom: 1.25 } as never),
  );
  const nvl = createNvl(host, first, theme, { onLayoutDone: () => camera.settled() });
  const resetBtn = toolbar(root, {
    zoomBy: (factor) => {
      camera.moved();
      nvl.setZoom(nvl.getScale() * factor);
    },
    fit: () => camera.fit(),
    reset: showResult,
  });
  const inspector = createInspector(root, (key) => drawn.get(key), () => nvl.deselectAll());
  const status = statusLine(root);
  const legend = el('div', { class: 'graph-legend' }, root);

  const handlers = interactions(nvl, {
    onMove: () => camera.moved(),
    onPoint: (key) => {
      stage.style.cursor = key ? 'pointer' : '';
      inspector.hover(key);
    },
    onPin: (key) => inspector.pin(key),
    onExpand: expand,
  });
  gateWheel(root, stage, () => status.say('Click the graph (or hold Ctrl/⌘) to zoom with the wheel', 2500));
  const resized = new ResizeObserver(() => camera.resized());
  resized.observe(stage);
  // NVL paints on a canvas, so a theme change repaints relationships.
  const unwatchTheme = watchTheme(() => {
    theme = canvasTheme();
    nvl.updateElementsInGraph([], [...drawn.rels.keys()].map((id) => ({ id: relKey(id), color: theme.rel })) as never);
  });

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
    nvl.removeRelationshipsWithIds(gone.rels.map(relKey));
    nvl.removeNodesWithIds(gone.nodes.map(nodeKey));
    inspector.prune();
    resetBtn.hidden = true;
    status.say('');
    drawLegend(legend, drawn, note);
    camera.fit();
  }

  drawLegend(legend, drawn, note);

  return {
    grow(id, outcome) {
      const { say } = status;
      if (outcome.problem !== undefined) return say(`Could not expand: ${outcome.problem}`);
      if (!drawn.nodes.has(id)) return say('That node is not in this result any more.');
      const { nodes, rels, left } = drawn.add(outcome.graph, MAX_DRAWN);
      if (nodes.length === 0 && rels.length === 0) {
        return say(left ? `The view is full (${MAX_DRAWN} nodes).` : 'Nothing to add: every neighbour is drawn.');
      }
      // New nodes start around the expanded one; the layout takes it from there.
      const at = nvl.getPositionById(nodeKey(id)) ?? { x: 0, y: 0 };
      const spread = 40 + 6 * Math.sqrt(nodes.length);
      nvl.addAndUpdateElementsInGraph(
        nodes.map((n, i) => {
          const a = (2 * Math.PI * i) / nodes.length;
          return { ...nvlNode(n, COLORS), x: (at.x ?? 0) + spread * Math.cos(a), y: (at.y ?? 0) + spread * Math.sin(a) };
        }),
        rels.map((r) => nvlRel(r, theme.rel)),
      );
      resetBtn.hidden = false;
      drawLegend(legend, drawn, note);
      const notes = [];
      if (outcome.graph.truncated) notes.push(`its first ${EXPAND_LIMIT} neighbours`);
      if (left) notes.push(`the view is full at ${MAX_DRAWN} nodes`);
      const added = `Added ${plural(nodes.length, 'node')} and ${plural(rels.length, 'relationship')}`;
      say(`${added}${notes.length ? ` (${notes.join('; ')})` : ''}.`);
    },

    destroy() {
      status.stop();
      resized.disconnect();
      unwatchTheme();
      for (const h of handlers) h.destroy();
      nvl.destroy();
      root.remove();
    },
  };
}

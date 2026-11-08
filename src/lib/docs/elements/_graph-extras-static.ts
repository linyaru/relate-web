// The graph view extras in a cell's static graph picture (DOCS-PLAN.md §7.3,
// ADR-0036): the picture a page shows without JavaScript follows the cell's
// words as the live view's first frame does. `layout=hierarchical` draws the
// result in layers, top down; `layout=circular` on a circle; `caption=<p>`
// writes property `p` in each node; `highlight=path` draws the result's paths
// on top (an ink line twice as wide, ink outlines) and the rest faded. A cell
// with none of these gets the plain picture (checks/cells.ts
// drawResultGraph), byte for byte, so its stamp does not change.
//
// A helper (the leading `_` keeps it out of the element registry): the
// cells' static forms (src/lib/docs/checks/cells.ts) call it, and the stamp
// (results.ts graphHash) adds `extrasKey`, so a picture goes stale when a
// word or the result's paths change.

import { diagramColors, type DiagramColors } from '../../cookbook/diagram-theme.ts';
import { THEMES, type Theme } from '../../cookbook/diagrams.ts';
import { captionBy, pathsOf, viewDefaults, type PathSet, type ViewDefaults } from '../../cookbook/graph-extras-model.ts';
import { labelColor } from '../../cookbook/graph-model.ts';
import { outline } from '../../cookbook/palette.ts';
import { esc } from '../../cookbook/result-view.ts';
import { extent, linkGeometry, loopGeometry, type Point } from '../../cookbook/schema-geometry.ts';
import { layoutSchema, type LaidEdge, type LaidNode, type SchemaLayout } from '../../cookbook/schema-layout.ts';
import { captionSize, FONTS, nodeText, type Measure } from '../../cookbook/schema-text.ts';
import type { RecordedGraph } from '../results.ts';

/** Bumped when the drawing below changes, so every picture it drew goes stale. */
export const EXTRAS_DRAWING_VERSION = 1;

const CAPTION_MAX = 24;
const cut = (s: string) => (s.length > CAPTION_MAX ? `${s.slice(0, CAPTION_MAX - 1)}…` : s);

/** What a cell's words and recorded envelope ask of its picture. */
export interface StaticExtras extends ViewDefaults {
  /** The paths to highlight: empty unless `highlight=path` and the result holds one. */
  paths: PathSet;
}

export function staticExtras(words: Record<string, string> | null | undefined, envelope: unknown): StaticExtras {
  const d = viewDefaults(words);
  const paths = pathsOf(d.highlight ? envelope : null);
  return { ...d, paths };
}

/** Whether a cell's picture is the plain one (no layout, caption or highlight to draw). */
export const isPlain = (x: StaticExtras) => x.layout === 'force' && x.caption === null && x.paths.nodes.size === 0;

/**
 * What the stamp of a cell's picture adds for its words: '' for a plain
 * picture (its stamp stays the graph's alone), else the words and the
 * highlighted path ids.
 */
export function extrasKey(words: Record<string, string> | null | undefined, envelope: unknown): string {
  const x = staticExtras(words, envelope);
  if (isPlain(x)) return '';
  return JSON.stringify({
    v: EXTRAS_DRAWING_VERSION,
    layout: x.layout,
    caption: x.caption,
    paths: x.paths.paths.map((p) => [p.nodes, p.rels]),
  });
}

/** The model the picture is laid out from, as checks/cells.ts drawResultGraph builds it, with the caption chosen. */
function model(graph: RecordedGraph, caption: string | null) {
  const colors = new Map<string, string>();
  return {
    direction: 'LR',
    nodes: graph.nodes.map((n) => ({
      id: `n${n.id}`,
      label: cut(captionBy(n, caption)),
      props: n.labels.length ? [n.labels.map((l) => `:${l}`).join('')] : [],
      color: labelColor(n.labels, colors),
    })),
    edges: graph.rels.map((r) => ({ source: `n${r.start_node}`, target: `n${r.end_node}`, type: r.type, props: '', dashed: false, arrow: true, rel: r.id })),
  };
}

type Model = ReturnType<typeof model>;

// ---------------------------------------------------------------- layouts

/** Nodes and edges with text measured, at the origin: what a placement fills in. */
function measured(m: Model, measure: Measure): SchemaLayout {
  const nodes: LaidNode[] = m.nodes.map((n) => ({ ...n, ...nodeText(n, measure), x: 0, y: 0, vx: 0, vy: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = m.edges.map((e) => ({ ...e, s: byId.get(e.source)!, t: byId.get(e.target)!, cap: captionSize(e, measure), bend: 0 })) as unknown as LaidEdge[];
  return { nodes, edges, problems: [] };
}

/** Every relationship's geometry from where the nodes are: pairs bend apart, loops sit above their node. */
function place(layout: SchemaLayout) {
  const groups = new Map<string, LaidEdge[]>();
  for (const e of layout.edges) {
    if (e.s === e.t) continue;
    e.pair = e.s.id < e.t.id ? [e.s, e.t] : [e.t, e.s];
    const key = `${e.pair[0].id}\n${e.pair[1].id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const group of groups.values()) {
    const spacing = Math.max(...group.map((e) => e.cap.h)) + 14;
    group.forEach((e, i) => {
      e.bend = (i - (group.length - 1) / 2) * spacing;
      e.geo = linkGeometry(e);
    });
  }
  const loops = new Map<LaidNode, LaidEdge[]>();
  for (const e of layout.edges) if (e.s === e.t) loops.set(e.s, [...(loops.get(e.s) ?? []), e]);
  for (const [n, own] of loops) {
    own.forEach((e, i) => {
      e.geo = loopGeometry(n, e, -Math.PI / 2 + (i - (own.length - 1) / 2) * 1.2);
    });
  }
}

/**
 * Layers, top down, as NVL's hierarchical layout (dagre) draws them: each
 * node one layer below the deepest node pointing at it (relationships that
 * close a cycle ignored), each layer ordered by its parents' places (a few
 * barycentre sweeps) and centred.
 */
export function layoutHierarchical(m: Model, measure: Measure): SchemaLayout {
  const layout = measured(m, measure);
  const { nodes, edges } = layout;
  const out = new Map<LaidNode, LaidNode[]>(nodes.map((n) => [n, []]));
  for (const e of edges) if (e.s !== e.t) out.get(e.s)!.push(e.t);
  // Depth-first from every node in order, marking edges back to an open node.
  const state = new Map<LaidNode, 'open' | 'done'>();
  const back = new Set<string>();
  const order: LaidNode[] = [];
  const visit = (n: LaidNode) => {
    state.set(n, 'open');
    for (const c of out.get(n)!) {
      if (state.get(c) === 'open') back.add(`${n.id}\n${c.id}`);
      else if (!state.has(c)) visit(c);
    }
    state.set(n, 'done');
    order.push(n);
  };
  for (const n of nodes) if (!state.has(n)) visit(n);
  const rank = new Map(nodes.map((n) => [n, 0]));
  for (const n of order.reverse()) {
    for (const c of out.get(n)!) if (!back.has(`${n.id}\n${c.id}`)) rank.set(c, Math.max(rank.get(c)!, rank.get(n)! + 1));
  }
  const layers: LaidNode[][] = [];
  for (const n of nodes) (layers[rank.get(n)!] ??= []).push(n);
  const parents = new Map<LaidNode, LaidNode[]>(nodes.map((n) => [n, []]));
  const children = new Map<LaidNode, LaidNode[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    if (e.s === e.t || back.has(`${e.s.id}\n${e.t.id}`)) continue;
    parents.get(e.t)!.push(e.s);
    children.get(e.s)!.push(e.t);
  }
  const pos = new Map<LaidNode, number>();
  const index = () => layers.forEach((l) => l.forEach((n, i) => pos.set(n, i)));
  index();
  const sweep = (l: LaidNode[], by: Map<LaidNode, LaidNode[]>) => {
    const centre = (n: LaidNode) => {
      const ns = by.get(n)!;
      return ns.length ? ns.reduce((s, p) => s + pos.get(p)!, 0) / ns.length : pos.get(n)!;
    };
    l.sort((a, b) => centre(a) - centre(b) || pos.get(a)! - pos.get(b)!);
  };
  for (let i = 0; i < 4; i++) {
    for (let r = 1; r < layers.length; r++) sweep(layers[r], parents);
    index();
    for (let r = layers.length - 2; r >= 0; r--) sweep(layers[r], children);
    index();
  }
  const gap = 40;
  const capH = Math.max(0, ...edges.map((e) => e.cap.h));
  let y = 0;
  for (const l of layers) {
    const r = Math.max(...l.map((n) => n.r));
    const width = l.reduce((s, n) => s + 2 * n.r, 0) + gap * (l.length - 1);
    let x = -width / 2;
    for (const n of l) {
      n.x = x + n.r;
      n.y = y + r;
      x += 2 * n.r + gap;
    }
    y += 2 * r + capH + 56;
  }
  place(layout);
  return layout;
}

/** A circle, in the result's order from the top clockwise, as NVL's circular layout places nodes. */
export function layoutCircular(m: Model, measure: Measure): SchemaLayout {
  const layout = measured(m, measure);
  const { nodes } = layout;
  const gap = 36;
  const around = nodes.reduce((s, n) => s + 2 * n.r + gap, 0);
  const radius = nodes.length < 2 ? 0 : Math.max(around / (2 * Math.PI), Math.max(...nodes.map((n) => n.r)) * 1.5);
  let at = 0;
  for (const n of nodes) {
    const a = -Math.PI / 2 + (2 * Math.PI * (at + n.r)) / around;
    n.x = radius * Math.cos(a);
    n.y = radius * Math.sin(a);
    at += 2 * n.r + gap;
  }
  place(layout);
  return layout;
}

// ---------------------------------------------------------------- drawing

const num = (v: number) => String(Math.round(v * 10) / 10);
const pt = (p: Point) => `${num(p.x)},${num(p.y)}`;

/**
 * A laid-out result for `theme`, as schema-draw.ts draws it, with the paths'
 * elements marked: `on` (drawn on top, in ink) and, while a path is
 * highlighted, `off` for the rest (faded).
 */
export function drawExtras(
  layout: SchemaLayout,
  paths: PathSet,
  { id, title, colors }: { id: string; title: string; colors: DiagramColors },
): string {
  const { nodes, edges } = layout;
  const lit = paths.nodes.size > 0;
  const nodeOn = (n: LaidNode) => paths.nodes.has(Number(n.id.slice(1)));
  const edgeOn = (e: LaidEdge) => paths.rels.has((e as LaidEdge & { rel: number }).rel);
  const mark = (on: boolean) => (lit ? (on ? ' on' : ' off') : '');
  // Faded elements go first, so what is on a path is drawn over them.
  const byLight = <T>(items: T[], on: (x: T) => boolean) => [...items.filter((x) => !on(x)), ...items.filter(on)];

  const rels = byLight(edges, edgeOn).map((e) => {
    const g = e.geo;
    const line = `<path class="rel${mark(edgeOn(e))}" d="M${pt(g.start)} C${pt(g.c1)} ${pt(g.c2)} ${pt(g.end)}"/>`;
    const head = g.head ? `<path class="head${mark(edgeOn(e))}" d="M${g.head.map(pt).join(' L')} Z"/>` : '';
    return line + head;
  });
  const circles = byLight(nodes, nodeOn).map((n) => {
    const text = n.lines.map((l) => `<text class="${l.font}" y="${num(l.y)}" dy="0.35em">${esc(l.text)}</text>`).join('');
    return `<g class="node${mark(nodeOn(n))}" transform="translate(${pt(n)})"><circle r="${num(n.r)}" fill="${n.color}" stroke="${outline(n.color)}"/>${text}</g>`;
  });
  const captions = byLight(edges, edgeOn)
    .filter((e) => e.type)
    .map((e) => {
      const { x, y, angle, top } = e.geo.caption;
      const turn = angle ? ` rotate(${num(angle)})` : '';
      return `<g class="cap${mark(edgeOn(e))}" transform="translate(${pt({ x, y })})${turn}"><text class="type" y="${num(top + e.cap.typeH / 2)}" dy="0.35em">${esc(e.type)}</text></g>`;
    });

  const box = extent(nodes, edges);
  const pad = 12;
  const minX = Math.floor(box.minX - pad);
  const minY = Math.floor(box.minY - pad);
  const width = Math.ceil(box.minX + box.width + pad - minX);
  const height = Math.ceil(box.minY + box.height + pad - minY);
  const c = colors;
  const s = `#${id}`;
  const style = [
    `${s}{font-family:"Public Sans",system-ui,sans-serif}`,
    `${s} text{text-anchor:middle}`,
    `${s} .rel{fill:none;stroke:${c.rel};stroke-width:2}`,
    `${s} .head{fill:${c.rel}}`,
    `${s} .node circle{stroke-width:2}`,
    `${s} .label{font-size:${FONTS.label.size}px;font-weight:${FONTS.label.weight};fill:${c.labelText}}`,
    `${s} .props{font-size:${FONTS.props.size}px;font-weight:${FONTS.props.weight};fill:${c.labelText};fill-opacity:0.78}`,
    `${s} .type{stroke:${c.surface};stroke-width:5px;stroke-linejoin:round;paint-order:stroke;font-size:${FONTS.type.size}px;font-weight:${FONTS.type.weight};fill:${c.fg}}`,
    // The highlight: the path in ink, twice as wide, its nodes outlined in ink; the rest faded.
    `${s} .rel.on{stroke:${c.fg};stroke-width:4}`,
    `${s} .head.on{fill:${c.fg}}`,
    `${s} .node.on circle{stroke:${c.fg};stroke-width:3.5}`,
    `${s} .off{opacity:0.32}`,
  ].join('');
  const nodeName = new Map(nodes.map((n) => [n.id, n.label]));
  let desc = edges.map((e) => `${e.s.label} ${e.type || 'to'} ${e.t.label}`).join('; ');
  if (lit) {
    const ways = paths.paths.map((p) => p.nodes.map((n) => nodeName.get(`n${n}`) ?? `node ${n}`).join(', '));
    desc += `. Highlighted ${ways.length === 1 ? 'path' : 'paths'}: ${ways.join('; ')}`;
  }
  return (
    `<svg id="${id}" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: ${width}px;" ` +
    `viewBox="${minX} ${minY} ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">` +
    `<title id="${id}-title">${esc(title)}</title><desc id="${id}-desc">${esc(desc)}</desc>` +
    `<style>${style}</style>` +
    `<g>${rels.join('')}</g><g>${circles.join('')}</g><g>${captions.join('')}</g></svg>`
  );
}

/**
 * A cell's static graph picture with its words applied, light and dark, or
 * null when the cell has none that change it (the caller draws the plain
 * picture). `measure` is the drawings' text measure (checks/cells.ts).
 */
export function drawResultGraphWith(
  graph: RecordedGraph,
  cellId: string,
  title: string,
  { words, envelope, measure }: { words: Record<string, string> | null | undefined; envelope: unknown; measure: Measure },
): Record<Theme, string> | null {
  const x = staticExtras(words, envelope);
  if (isPlain(x)) return null;
  const m = model(graph, x.caption);
  const layout = x.layout === 'hierarchical' ? layoutHierarchical(m, measure) : x.layout === 'circular' ? layoutCircular(m, measure) : layoutSchema(m, measure);
  const out = {} as Record<Theme, string>;
  for (const theme of THEMES) out[theme] = drawExtras(layout, x.paths, { id: `result-${cellId}-${theme}`, title, colors: diagramColors(theme) });
  return out;
}

// The graph view extras' model (DOCS-PLAN.md §7.3 "Graph view extras",
// ADR-0036): path highlighting, the layout switch, the caption picker and the
// relationship-type legend. The live view (src/scripts/cookbook/graph.ts)
// and the static pictures (src/lib/docs/elements/_graph-extras-static.ts)
// share it, so the no-JavaScript picture and the live default agree.
//
// A module of its own, not part of graph-model.ts: the cell runtime
// (session.ts) imports graph-model.ts eagerly on every page with cells, and
// Rollup keeps a module whole in one chunk, so this code would ride in every
// page's eager JavaScript. Only lazy chunks (graph.ts, the graph-extras
// element) and the build import it. Browser-safe: no Node imports.

import { caption, formatValue, type WireNode, type WireRel } from './graph-model.ts';
import { PALETTE } from './palette.ts';

/** The layouts a graph view offers, by the name a cell's `layout=` word uses. */
export const LAYOUTS = ['force', 'hierarchical', 'circular'] as const;
export type LayoutName = (typeof LAYOUTS)[number];
export const isLayout = (v: unknown): v is LayoutName => (LAYOUTS as readonly unknown[]).includes(v);
/** NVL 1.2.2's layout for each: d3Force (the view's default), hierarchical (dagre), circular. */
export const NVL_LAYOUT: Record<LayoutName, 'd3Force' | 'hierarchical' | 'circular'> = {
  force: 'd3Force',
  hierarchical: 'hierarchical',
  circular: 'circular',
};

/**
 * What a cell's element words ask of its graph view (src/lib/cookbook/cells.ts
 * CELL_WORDS): `layout=`, `caption=`, `highlight=path`. Anything else is
 * ignored, so a view can take a cell's whole word set.
 */
export interface ViewDefaults {
  layout: LayoutName;
  /** The node property drawn as the caption, or null for the default (`caption`). */
  caption: string | null;
  /** Whether the paths in the result start highlighted. */
  highlight: boolean;
}

export function viewDefaults(words: Record<string, string> | null | undefined): ViewDefaults {
  const w = words ?? {};
  return {
    layout: isLayout(w.layout) ? w.layout : 'force',
    caption: typeof w.caption === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(w.caption) ? w.caption : null,
    highlight: w.highlight === 'path',
  };
}

/** A node's caption with `property` chosen: that property's value when the node has one, else its default caption. */
export function captionBy(node: WireNode, property: string | null): string {
  if (property === null) return caption(node);
  const v = node.properties?.[property];
  if (v === undefined || v === null) return caption(node);
  return formatValue(v, 40);
}

/** The property keys the nodes carry, sorted: what the caption picker lists. */
export function propertyKeys(nodes: Iterable<WireNode>): string[] {
  const keys = new Set<string>();
  for (const n of nodes) for (const k of Object.keys(n.properties ?? {})) keys.add(k);
  return [...keys].sort();
}

/** The relationship types `rels` draws, sorted: what the type legend lists. */
export function relTypes(rels: Iterable<WireRel>): string[] {
  return [...new Set([...rels].map((r) => r.type))].sort();
}

// Relationship colours: the label palette's hues, picked by the type's name
// so a type is the same colour wherever it is drawn (every cell, every
// page). The palette fills are light: drawn as thin lines on the light
// theme's cream they would vanish, so the light theme darkens each until it
// holds 3:1 against the page (WCAG 1.4.11); the dark theme uses them as they
// are. The type is also written on every relationship, so the colour is
// never the only way to tell types apart.

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** The relative luminance of #RRGGBB (WCAG 2). */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** The contrast ratio of two #RRGGBB colours (WCAG 2). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** `fill` darkened in steps until it holds `ratio` against `ground`. */
export function darkenAgainst(fill: string, ground: string, ratio = 3): string {
  let rgb = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
  for (let i = 0; i < 40 && contrast(hex(rgb), ground) < ratio; i++) rgb = rgb.map((c) => c * 0.94);
  return hex(rgb);
}

/** The darkest ground the light theme draws on (base.css `--bg-alt`, Day: the output pane the canvas sits on, a step darker than the page), which the darkened relationship colours hold 3:1 against. */
export const LIGHT_GROUND = '#F2F2F2';

let lightPalette: readonly string[] | null = null;
/** The relationship palette in `theme`, in the label palette's order (the light one worked out on first use). */
export function relPalette(theme: 'light' | 'dark'): readonly string[] {
  if (theme === 'dark') return PALETTE;
  lightPalette ??= PALETTE.map((c) => darkenAgainst(c, LIGHT_GROUND));
  return lightPalette;
}

/** A relationship type's colour in `theme`: one hue per type name, everywhere. */
export function relColor(type: string, theme: 'light' | 'dark'): string {
  let hash = 7;
  for (const ch of type) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const palette = relPalette(theme);
  return palette[hash % palette.length];
}

/**
 * `fill` mixed toward `ground`, keeping `keep` of it: how an element off a
 * highlighted path is dimmed. Its hue stays, so a dimmed node still reads as
 * its label's colour in the legend; only its strength drops. Colours that
 * are not #RRGGBB come back as they are.
 */
export function mixToward(fill: string, ground: string, keep: number): string {
  const ok = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
  if (!ok(fill) || !ok(ground)) return fill;
  const ch = (c: string, i: number) => parseInt(c.slice(i, i + 2), 16);
  return hex([1, 3, 5].map((i) => keep * ch(fill, i) + (1 - keep) * ch(ground, i)));
}

// Paths: a PATH value in an envelope's rows is a list that alternates nodes
// and relationships (`{kind: 'node', id, …}`, `{kind: 'relationship', id,
// start_node, end_node, …}`), node first and last, each relationship joining
// its neighbours (relate 0.16.1 WASM).

/** One path in a result: its node and relationship ids, in order. */
export interface PathIds {
  nodes: number[];
  rels: number[];
}

/** The paths of a result, and every element on one. */
export interface PathSet {
  paths: PathIds[];
  nodes: Set<number>;
  rels: Set<number>;
}

type WireItem = { kind?: unknown; id?: unknown; start_node?: unknown; end_node?: unknown };

/** The path a value holds, or null when it is not one. A lone node counts only where the column says PATH. */
export function asPath(value: unknown, typed = false): PathIds | null {
  if (!Array.isArray(value) || value.length % 2 === 0) return null;
  if (value.length === 1 && !typed) return null;
  const nodes: number[] = [];
  const rels: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i] as WireItem | null;
    if (!item || typeof item !== 'object' || typeof item.id !== 'number') return null;
    if (i % 2 === 0) {
      if (item.kind !== 'node') return null;
      nodes.push(item.id);
    } else {
      if (item.kind !== 'relationship') return null;
      const prev = (value[i - 1] as WireItem).id;
      const next = (value[i + 1] as WireItem | null)?.id;
      const joins = (item.start_node === prev && item.end_node === next) || (item.start_node === next && item.end_node === prev);
      if (!joins) return null;
      rels.push(item.id);
    }
  }
  return { nodes, rels };
}

/**
 * Every path in an envelope's rows. Where a column is typed PATH, the paths
 * are that column's values; where none is, any value that is a path, inside
 * lists and maps too, counts. So `RETURN p, collect(g) AS context` highlights
 * `p` alone, with `context` drawn around it, and `RETURN collect(p) AS
 * routes` highlights every route.
 */
export function pathsOf(envelope: unknown): PathSet {
  const out: PathSet = { paths: [], nodes: new Set(), rels: new Set() };
  const env = envelope as { columns?: unknown; columnTypes?: unknown; rows?: unknown } | null | undefined;
  if (!env || !Array.isArray(env.rows)) return out;
  const columns = Array.isArray(env.columns) ? (env.columns as string[]) : [];
  const types = Array.isArray(env.columnTypes) ? (env.columnTypes as string[]) : [];
  const typed = columns.filter((_, i) => types[i] === 'PATH');
  const seen = new Set<string>();
  const add = (p: PathIds) => {
    const key = `${p.nodes.join(',')}|${p.rels.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.paths.push(p);
    for (const n of p.nodes) out.nodes.add(n);
    for (const r of p.rels) out.rels.add(r);
  };
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== 'object') return;
    const p = asPath(v);
    if (p) return add(p);
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  for (const row of env.rows as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    if (typed.length) {
      for (const c of typed) {
        const p = asPath(row[c], true);
        if (p) add(p);
      }
    } else {
      walk(row, 0);
    }
  }
  return out;
}

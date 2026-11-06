// The graph view's model (ADR-0151): what a view of a step's graph result
// draws, as NVL elements, and how a node is expanded from the page's
// database. The page (scripts/cookbook/graph.ts, runtime.ts) and the
// cookbook check share it, so it must stay browser-safe: no Node imports.
//
// Graphs are recordings' `{nodes, rels}`: wire JSON, each element once, nodes
// `{id, labels, properties}` and relationships
// `{id, type, start_node, end_node, properties}`.

import { NEUTRAL, PALETTE } from './palette.ts';
import { lastEnvelope } from './result-view.ts';

export interface WireNode {
  id: number;
  labels: string[];
  properties?: Record<string, unknown>;
}

export interface WireRel {
  id: number;
  type: string;
  start_node: number;
  end_node: number;
  properties?: Record<string, unknown>;
}

export interface Graph {
  nodes: WireNode[];
  rels: WireRel[];
}

/** What running one statement returns, as the engine worker (and the Node runner) return it. */
export interface StatementRun {
  envelopes: string[];
  recording: { graph: Graph | null };
}

/** Runs one statement; `params` is JSON text. */
export type RunStatement = (code: string, params: string) => StatementRun | Promise<StatementRun>;

/** How many of a result's nodes a view draws. */
export const MAX_NODES = 300;
/** How many nodes a view grows to by expanding. */
export const MAX_DRAWN = 1000;
/** How many neighbours one expansion asks for. */
export const EXPAND_LIMIT = 100;

/** A node's neighbours and its relationships to them. */
export const NEIGHBOURS = `MATCH (n)-[r]-(m) WHERE id(n) = $id RETURN r, m LIMIT ${EXPAND_LIMIT}`;
/** The relationships between new nodes and drawn ones (`$drawn` includes `$added`). */
export const CONNECTING = 'MATCH (a)-[r]-(b) WHERE id(a) IN $added AND id(b) IN $drawn RETURN r';

// ---------------------------------------------------------------- styling

/** A label set's key, whatever the order of its labels. */
export const labelKey = (labels: readonly string[]) => [...labels].sort().join(':');

/**
 * The recipe's label colours (the page's #label-colors JSON, written by the
 * build from its data-model diagrams) by label-set key.
 */
export function labelColors(json: string | null | undefined): Map<string, string> {
  const colors = JSON.parse(json || '{}') as Record<string, string>;
  return new Map(Object.entries(colors).map(([k, v]) => [labelKey(k.split(':')), v]));
}

/**
 * A node's colour: its label set's colour in the diagram, else one of its
 * labels', else a palette colour picked by its first label's name, so a label
 * is the same colour wherever and whenever it is drawn.
 */
export function labelColor(labels: readonly string[], colors: Map<string, string>): string {
  if (labels.length === 0) return NEUTRAL;
  const known = colors.get(labelKey(labels)) ?? labels.map((l) => colors.get(l)).find(Boolean);
  if (known) return known;
  let hash = 0;
  for (const ch of labels[0]) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

/** The text a node is drawn with: its first naming property, else its first string one. */
export function caption(node: WireNode): string {
  const p = node.properties ?? {};
  for (const key of ['name', 'title', 'text', 'id', 'label', 'key']) {
    if (typeof p[key] === 'string' || typeof p[key] === 'number') return String(p[key]);
  }
  const first = Object.values(p).find((v) => typeof v === 'string') as string | undefined;
  return first ?? node.labels[0] ?? String(node.id);
}

/** A property value as the inspector shows it: strings as they are, the rest as JSON, cut at `max`. */
export function formatValue(value: unknown, max = 240): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// NVL wants ids unique across nodes and relationships, and strings; the
// engine numbers each separately.
export const nodeKey = (id: number) => `n${id}`;
export const relKey = (id: number) => `r${id}`;
/** What an NVL id names. */
export const kindOf = (key: string): 'node' | 'relationship' => (key.startsWith('n') ? 'node' : 'relationship');
/** The engine id behind an NVL id. */
export const idOf = (key: string) => Number(key.slice(1));

/** A node's radius at zoom 1, larger than NVL's 25 so captions show at the zoom a result fits in. */
export const NODE_SIZE = 40;

/** A node as NVL draws it. */
export const nvlNode = (node: WireNode, colors: Map<string, string>) => ({
  id: nodeKey(node.id),
  caption: caption(node),
  color: labelColor(node.labels, colors),
  size: NODE_SIZE,
});

/** A relationship as NVL draws it, in `color`. */
export const nvlRel = (rel: WireRel, color: string) => ({
  id: relKey(rel.id),
  from: nodeKey(rel.start_node),
  to: nodeKey(rel.end_node),
  type: rel.type,
  caption: rel.type,
  color,
});

// ---------------------------------------------------------------- drawn

/**
 * What a view draws, by engine id, and what adding a graph to it adds. A
 * relationship is drawn only when both its ends are.
 */
export class DrawnGraph {
  nodes = new Map<number, WireNode>();
  rels = new Map<number, WireRel>();

  /**
   * Add `graph`'s elements that are not drawn yet, nodes until the view draws
   * `limit`: what was added, and how many new nodes did not fit.
   */
  add(graph: Graph, limit = MAX_DRAWN): { nodes: WireNode[]; rels: WireRel[]; left: number } {
    const nodes: WireNode[] = [];
    let left = 0;
    for (const n of graph.nodes) {
      if (this.nodes.has(n.id)) continue;
      if (this.nodes.size >= limit) {
        left++;
        continue;
      }
      this.nodes.set(n.id, n);
      nodes.push(n);
    }
    const rels: WireRel[] = [];
    for (const r of graph.rels) {
      if (this.rels.has(r.id) || !this.nodes.has(r.start_node) || !this.nodes.has(r.end_node)) continue;
      this.rels.set(r.id, r);
      rels.push(r);
    }
    return { nodes, rels, left };
  }

  /** The wire element behind NVL id `key`, if the view draws it. */
  get(key: string): WireNode | WireRel | undefined {
    return kindOf(key) === 'node' ? this.nodes.get(idOf(key)) : this.rels.get(idOf(key));
  }

  /** Stop drawing everything `keep` does not draw: the ids dropped. */
  keepOnly(keep: DrawnGraph): { nodes: number[]; rels: number[] } {
    const nodes = [...this.nodes.keys()].filter((id) => !keep.nodes.has(id));
    const rels = [...this.rels.keys()].filter((id) => !keep.rels.has(id));
    for (const id of nodes) this.nodes.delete(id);
    for (const id of rels) this.rels.delete(id);
    return { nodes, rels };
  }
}

// ---------------------------------------------------------------- expand

/** A statement's graph, or its error thrown; `rows` is how many rows it returned. */
function graphOf({ envelopes, recording }: StatementRun): Graph & { rows: number } {
  const last = lastEnvelope(envelopes) as { error?: string | null; rows?: unknown[] } | null;
  if (last?.error) throw new Error(last.error);
  return { ...(recording.graph ?? { nodes: [], rels: [] }), rows: last?.rows?.length ?? 0 };
}

const uniqueById = <T extends { id: number }>(items: T[]) => [...new Map(items.map((x) => [x.id, x])).values()];

export interface Expansion extends Graph {
  /** The neighbours were cut at EXPAND_LIMIT rows; there may be more. */
  truncated: boolean;
}

/**
 * Node `id`'s neighbours in the database, for a view drawing the nodes
 * `drawn` (engine ids): the neighbours (at most EXPAND_LIMIT rows' worth),
 * their relationships to the node, and the relationships between the
 * neighbours the view does not draw yet and every node it will.
 */
export async function expandNode(run: RunStatement, id: number, drawn: number[]): Promise<Expansion> {
  const found = graphOf(await run(NEIGHBOURS, JSON.stringify({ id })));
  const truncated = found.rows >= EXPAND_LIMIT;
  const seen = new Set(drawn);
  const added = found.nodes.map((n) => n.id).filter((n) => !seen.has(n));
  if (added.length === 0) return { nodes: found.nodes, rels: found.rels, truncated };
  const links = graphOf(await run(CONNECTING, JSON.stringify({ added, drawn: [...seen, ...added] })));
  return { nodes: found.nodes, rels: uniqueById([...found.rels, ...links.rels]), truncated };
}

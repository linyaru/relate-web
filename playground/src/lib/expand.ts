// Double-click to expand: a node's neighbours from the playground's database.
//
// The query logic is the cookbook graph view's (expandNode in the site's
// src/lib/cookbook/graph-model.ts): the node's neighbours and its
// relationships to them, at most EXPAND_LIMIT rows, then the relationships
// between the new neighbours and every node the view already draws. This
// module adapts the playground's engine to it and hands back the playground's
// own wire entities, so the graph view converts them as it converts results.

import { expandNode, type Graph, type StatementRun } from '../../../src/lib/cookbook/graph-model.ts';
import { engine } from './engine';
import { forEachEntity, nodeId } from './extract-graph';
import type { CLNode, CLRelationship, WireResult } from './wire';

export { EXPAND_LIMIT } from '../../../src/lib/cookbook/graph-model.ts';

export interface Expansion {
  nodes: CLNode[];
  rels: CLRelationship[];
  /** The neighbours were cut at EXPAND_LIMIT rows; there may be more. */
  truncated: boolean;
}

/** The engine id behind each node of a result, by its id in the graph view. */
export function engineIds(result: WireResult): Map<string, number> {
  const ids = new Map<string, number>();
  forEachEntity(
    result,
    (n) => ids.set(nodeId(n), Number(n.id)),
    () => {},
  );
  return ids;
}

/**
 * Node `id`'s neighbours (engine ids throughout), for a view drawing the
 * nodes `drawn`: what expandNode finds, as the wire entities the engine
 * returned.
 */
export async function expandFromEngine(id: number, drawn: number[]): Promise<Expansion> {
  const nodes = new Map<number, CLNode>();
  const rels = new Map<number, CLRelationship>();
  const run = async (code: string, params: string): Promise<StatementRun> => {
    const wire = await engine.execute(code, params);
    const graph: Graph = { nodes: [], rels: [] };
    forEachEntity(
      wire,
      (n) => {
        nodes.set(Number(n.id), n);
        graph.nodes.push({ id: Number(n.id), labels: n.labels, properties: n.properties });
      },
      (r) => {
        rels.set(Number(r.id), r);
        graph.rels.push({
          id: Number(r.id),
          type: r.type,
          start_node: Number(r.start_node),
          end_node: Number(r.end_node),
          properties: r.properties,
        });
      },
    );
    return { envelopes: [JSON.stringify({ rows: wire.rows, error: wire.error })], recording: { graph } };
  };
  const found = await expandNode(run, id, drawn);
  return {
    nodes: found.nodes.map((n) => nodes.get(n.id)!),
    rels: found.rels.map((r) => rels.get(r.id)!),
    truncated: found.truncated,
  };
}

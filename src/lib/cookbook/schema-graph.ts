// Data-model diagrams (ADR-0135). A ```mermaid flowchart whose nodes are all
// circles, `((…))`, is a recipe's graph model. GitHub draws it with mermaid;
// scripts/cookbook-diagrams/render.mjs draws it for the website the way
// Neo4j's graph tools (Bloom, NVL) draw a graph: each label a coloured circle
// holding its properties, each relationship type along its arrow, laid out by
// force. This module reads the model from mermaid's parse of the block; the
// caller measures text. Ported from the Relate repository's
// lib/schema-graph.mjs. The work is split by concern:
//
//   schema-text.ts      fonts; text fitted into circles and captions
//   schema-geometry.ts  relationship curves, overlap tests
//   schema-layout.ts    the force layout and how a drawing is scored
//   schema-draw.ts      the SVG, per theme
//
// A node's text is `<b>Label</b><br/>prop · prop<br/>prop`: the first line
// names the label, the rest list its properties. A relationship's text is
// `<b>TYPE</b><br/>prop · prop`. Class `l1`…`l12` gives a label its colour
// from the palette; a dotted edge (`-. … .->`) is drawn dashed.

import { NEUTRAL, PALETTE } from './palette.ts';

export { drawSchema } from './schema-draw.ts';
export { layoutSchema } from './schema-layout.ts';
export { FONTS, fontSpec } from './schema-text.ts';

/** What render.mjs reads from mermaid's parse of a flowchart. */
export interface ParsedFlowchart {
  direction: string;
  subgraphs: number;
  vertices: { id: string; text?: string; type?: string; classes: string[] }[];
  edges: { start: string; end: string; text?: string; stroke?: string; type?: string }[];
}

export interface SchemaNode {
  id: string;
  label: string;
  props: string[];
  color: string;
}

export interface SchemaEdge {
  source: string;
  target: string;
  type: string;
  props: string;
  dashed: boolean;
  arrow: boolean;
}

export interface SchemaModel {
  direction: string;
  nodes: SchemaNode[];
  edges: SchemaEdge[];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** The lines of a mermaid label, as plain text. */
function textLines(html: string): string[] {
  return html
    .split(/<br\s*\/?>/i)
    .map((l) =>
      l
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
        .trim(),
    )
    .filter(Boolean);
}

/** Whether a parsed flowchart is a data model: at least one node, every node a circle, no subgraphs. */
export function isSchema(parsed: ParsedFlowchart): boolean {
  return parsed.subgraphs === 0 && parsed.vertices.length > 0 && parsed.vertices.every((v) => v.type === 'circle');
}

/** The graph a parsed data-model flowchart draws. */
export function schemaModel(parsed: ParsedFlowchart): SchemaModel {
  const nodes = parsed.vertices.map((v) => {
    const [label = v.id, ...rest] = textLines(v.text ?? '');
    const cls = v.classes.find((c) => /^l\d+$/.test(c));
    const color = cls ? PALETTE[Number(cls.slice(1)) - 1] : NEUTRAL;
    if (!color) throw new Error(`node ${v.id} has class ${cls}; label classes run l1…l${PALETTE.length}`);
    const props = rest
      .flatMap((l) => l.split(' · '))
      .map((p) => p.trim())
      .filter(Boolean);
    return { id: v.id, label, props, color };
  });
  const edges = parsed.edges.map((e) => {
    const [type = '', ...rest] = textLines(e.text ?? '');
    return {
      source: e.start,
      target: e.end,
      type,
      props: rest.join(' · '),
      dashed: e.stroke === 'dotted',
      arrow: e.type !== 'arrow_open',
    };
  });
  return { direction: parsed.direction, nodes, edges };
}

/**
 * The colour of each label a data model draws, by the label as the diagram
 * names it: what the result graph view colours that label with. Throws when
 * two nodes give one label different colours.
 */
export function schemaLabels(model: SchemaModel): Record<string, string> {
  const labels = new Map<string, string>();
  for (const n of model.nodes) {
    const seen = labels.get(n.label);
    if (seen && seen !== n.color) throw new Error(`label ${n.label} has two colours, ${seen} and ${n.color}`);
    labels.set(n.label, n.color);
  }
  return Object.fromEntries(labels);
}

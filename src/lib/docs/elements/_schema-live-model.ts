// What `:::schema-live` (schema-live.ts) makes of `CALL db.schema.visualization()`:
// the procedure's one row turned into the data model the cookbook's drawing
// code lays out (schema-layout.ts) and draws (schema-svg.ts), and a table of
// each label's indexes and constraints. No Node imports: the browser module
// runs it on the live result, and the unit tests on a recorded one.
//
// The procedure returns {nodes, relationships}: a node per label, with
// negative ids and `properties: {name, indexes, constraints}` (indexes as the
// property names they cover, constraints as the engine's description), and a
// relationship per type and pair of labels. On an empty database it returns
// no row at all.

import type { SchemaModel } from '../../cookbook/schema-graph.ts';

export interface SchemaRow {
  nodes?: { id: number; labels?: string[]; properties?: { name?: string; indexes?: unknown[]; constraints?: unknown[] } }[];
  relationships?: { id: number; type?: string; start_node: number; end_node: number; properties?: { name?: string } }[];
}

/** One label as the table lists it. */
export interface LabelFacts {
  label: string;
  indexes: string[];
  constraints: string[];
}

const KINDS: Record<string, string> = {
  'NODE PROPERTY UNIQUENESS': 'unique',
  'NODE PROPERTY EXISTENCE': 'required',
  'NODE PROPERTY TYPE': 'typed',
  'NODE KEY': 'key',
};

/** A constraint description, "Constraint( name='x', type='NODE KEY', schema=(:B {y}) )", as "y (key)"; the text itself when it is in another shape. */
export function constraintNote(text: string): string {
  const m = /type='([^']+)',\s*schema=\([^{]*\{([^}]*)\}\)/.exec(text);
  if (!m) return text;
  return `${m[2].split(',').map((s) => s.trim()).join(', ')} (${KINDS[m[1]] ?? m[1].toLowerCase()})`;
}

/** A constraint's name, from its description, or null. */
export const constraintName = (text: string): string | null => /name='([^']+)'/.exec(text)?.[1] ?? null;

/**
 * The data model the procedure's row describes: a circle per label holding
 * the properties its indexes and constraints cover, an arrow per
 * relationship type and pair of labels. `color(label)` gives each label its
 * colour (the authored figure's, or the palette's).
 */
export function schemaFromRow(row: SchemaRow | null | undefined, color: (label: string) => string): { model: SchemaModel; labels: LabelFacts[] } {
  const nodes = row?.nodes ?? [];
  const labels: LabelFacts[] = nodes.map((n) => {
    const label = n.properties?.name ?? n.labels?.[0] ?? String(n.id);
    return {
      label,
      indexes: (n.properties?.indexes ?? []).map(String),
      constraints: (n.properties?.constraints ?? []).map(String),
    };
  });
  const model: SchemaModel = {
    direction: 'LR',
    nodes: nodes.map((n, i) => {
      const f = labels[i];
      // What the label's indexes and constraints cover, once each: the circle has room for little.
      const props = [...new Set([...f.indexes.map((p) => `${p} (index)`), ...f.constraints.map(constraintNote)])];
      return { id: `n${Math.abs(n.id)}`, label: f.label, props, color: color(f.label) };
    }),
    edges: (row?.relationships ?? []).map((r) => ({
      source: `n${Math.abs(r.start_node)}`,
      target: `n${Math.abs(r.end_node)}`,
      type: r.type ?? r.properties?.name ?? '',
      props: '',
      dashed: false,
      arrow: true,
    })),
  };
  return { model, labels };
}

/** Labels in one list and not the other, both ways, sorted. */
export function compareLabels(written: readonly string[], live: readonly string[]): { onlyWritten: string[]; onlyLive: string[] } {
  const w = new Set(written);
  const l = new Set(live);
  return { onlyWritten: [...w].filter((x) => !l.has(x)).sort(), onlyLive: [...l].filter((x) => !w.has(x)).sort() };
}

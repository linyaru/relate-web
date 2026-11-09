// Tests for what `:::schema-live` makes of `CALL db.schema.visualization()`
// (src/lib/docs/elements/_schema-live-model.ts), on the row the engine
// returns for the agent memory guide's cells (relate 0.16.1, WASM).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareLabels, constraintName, constraintNote, schemaFromRow, type SchemaRow } from './elements/_schema-live-model.ts';

const rel = (id: number, type: string, start: number, end: number) => ({ id, kind: 'relationship', type, start_node: start, end_node: end, properties: { name: type } });
const node = (id: number, name: string, indexes: string[], constraints: string[]) => ({ id, kind: 'node', labels: [name], properties: { name, indexes, constraints } });

/** Recorded from the guide's cells; Person and Project nodes also carry Entity, so Entity shows their relationships too. */
const ROW: SchemaRow = {
  nodes: [
    node(-1, 'Entity', [], ["Constraint( name='entity_key', type='NODE PROPERTY UNIQUENESS', schema=(:Entity {key}) )"]),
    node(-2, 'Episode', [], ["Constraint( name='episode_id', type='NODE PROPERTY UNIQUENESS', schema=(:Episode {id}) )"]),
    node(-3, 'Fact', ['embedding', 'slot'], ["Constraint( name='fact_id', type='NODE PROPERTY UNIQUENESS', schema=(:Fact {id}) )"]),
    node(-4, 'Person', [], []),
    node(-5, 'Project', [], []),
  ],
  relationships: [
    rel(-6, 'KNOWS', -1, -1), rel(-12, 'MENTIONS', -2, -1), rel(-15, 'ABOUT', -3, -1), rel(-18, 'FROM', -3, -2),
    rel(-19, 'SUPERSEDES', -3, -3), rel(-23, 'MAINTAINS', -4, -5),
  ],
};

test('schemaFromRow gives one circle per label and one arrow per relationship the procedure reports', () => {
  const colors = new Map([['Entity', '#111111']]);
  const { model, labels } = schemaFromRow(ROW, (l) => colors.get(l) ?? '#999999');
  assert.deepEqual(model.nodes.map((n) => n.label), ['Entity', 'Episode', 'Fact', 'Person', 'Project']);
  assert.deepEqual(model.nodes.map((n) => n.id), ['n1', 'n2', 'n3', 'n4', 'n5']);
  assert.equal(model.nodes[0].color, '#111111');
  assert.equal(model.nodes[3].color, '#999999');
  assert.deepEqual(model.nodes[2].props, ['embedding (index)', 'slot (index)', 'id (unique)']);
  assert.deepEqual(model.edges.map((e) => `${e.source}-${e.type}->${e.target}`), ['n1-KNOWS->n1', 'n2-MENTIONS->n1', 'n3-ABOUT->n1', 'n3-FROM->n2', 'n3-SUPERSEDES->n3', 'n4-MAINTAINS->n5']);
  assert.deepEqual(labels[2], { label: 'Fact', indexes: ['embedding', 'slot'], constraints: ["Constraint( name='fact_id', type='NODE PROPERTY UNIQUENESS', schema=(:Fact {id}) )"] });
});

test('an empty database returns no row, and the model is empty', () => {
  // On an empty database the procedure returns columns: [], rows: [] (relate 0.16.1), so the row is undefined.
  for (const row of [undefined, null, { nodes: [], relationships: [] }]) {
    const { model, labels } = schemaFromRow(row, () => '#000');
    assert.equal(model.nodes.length, 0);
    assert.equal(model.edges.length, 0);
    assert.equal(labels.length, 0);
  }
});

test('constraintNote and constraintName read the engine\'s constraint text', () => {
  const text = "Constraint( name='entity_key', type='NODE PROPERTY UNIQUENESS', schema=(:Entity {key}) )";
  assert.equal(constraintNote(text), 'key (unique)');
  assert.equal(constraintName(text), 'entity_key');
  assert.equal(constraintNote("Constraint( name='k', type='NODE KEY', schema=(:B {x, y}) )"), 'x, y (key)');
  assert.equal(constraintNote("Constraint( name='r', type='NODE PROPERTY EXISTENCE', schema=(:B {x}) )"), 'x (required)');
  // Another shape passes through unchanged.
  assert.equal(constraintNote('something else'), 'something else');
  assert.equal(constraintName('something else'), null);
});

test('compareLabels lists the labels only one side has', () => {
  assert.deepEqual(compareLabels(['Person', 'Project'], ['Project', 'Person', 'Entity']), { onlyWritten: [], onlyLive: ['Entity'] });
  assert.deepEqual(compareLabels(['B', 'A'], []), { onlyWritten: ['A', 'B'], onlyLive: [] });
});

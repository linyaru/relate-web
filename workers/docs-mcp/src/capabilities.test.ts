// Unit tests for discover_capabilities (node --test) on the catalog built
// from src/content/docs/_capabilities (the same JSON /docs/capabilities.json serves).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capabilitiesJson } from '../../../src/lib/docs/capabilities.ts';
import { discover, DISCOVER_LIMIT_DEFAULT, words } from './capabilities.ts';
import type { CapabilityEntry } from './types.ts';

const catalog = capabilitiesJson().capabilities as unknown as CapabilityEntry[];
const ids = (intent: string, extra: Partial<Parameters<typeof discover>[1]> = {}) => discover(catalog, { intent, ...extra }).results.map((r) => r.id);

test('an intent the catalog lists, as a phrase, ranks its entry first', () => {
  for (const c of catalog) {
    const got = discover(catalog, { intent: c.intents[0] });
    assert.equal(got.results[0]?.id, c.id, `"${c.intents[0]}"`);
    assert.equal(got.results[0]?.match, 'phrase');
  }
});

test('words in the reader\'s own phrasing match by share; nothing relevant is an empty list', () => {
  assert.equal(ids('find duplicate customers')[0], 'entity-resolution');
  assert.equal(ids('what breaks if I change this package')[0], 'dependency-analysis');
  assert.deepEqual(ids('bake a sourdough loaf'), []);
  assert.ok(discover(catalog, { intent: 'database' }).results.length <= DISCOVER_LIMIT_DEFAULT);
});

test('requirements (a surface or words) and language narrow the list', () => {
  const all = ids('agent memory', { limit: 20 });
  assert.ok(all.includes('agent-memory'));
  assert.ok(ids('agent memory', { requirements: ['python'], limit: 20 }).every((id) => catalog.find((c) => c.id === id)!.surfaces.includes('python')));
  assert.deepEqual(ids('agent memory', { requirements: ['vector search'] }), ['agent-memory']);
  assert.deepEqual(ids('agent memory', { language: 'rust' }), []);
  assert.deepEqual(ids('embed a graph database in my app', { language: 'swift' }), ['embedded-graph-in-an-app']);
});

test('an answer carries the URLs, the data model, and a null verify where the catalog has none', () => {
  const r = discover(catalog, { intent: 'give my agent long-term memory' }).results[0];
  assert.equal(r.urls.page, 'https://relatedb.ai/docs/concepts/problems-relate-solves/#agent-memory');
  assert.ok(r.schema?.url.endsWith('schema-agent-memory-light.svg'));
  assert.ok(r.urls.integrations.every((u) => u.includes('/guides/integrations/')));
  assert.ok(r.urls.guides.every((u) => !u.includes('/guides/integrations/')));
  assert.equal(r.verify?.kind, 'cookbook-cell');
  const unverified = catalog.find((c) => c.verify === null);
  if (unverified) {
    const u = discover(catalog, { intent: unverified.intents[0] }).results[0];
    assert.equal(u.id, unverified.id);
    assert.equal(u.verify, null, 'no other run stands in');
  }
});

test('words: stopwords out, plurals folded', () => {
  assert.deepEqual(words('Memories for my agents, running queries'), ['memory', 'agent', 'run', 'query']);
});

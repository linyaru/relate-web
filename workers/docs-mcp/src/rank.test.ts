// Unit tests for search_docs's full-text re-rank (node --test): pure, no
// engine. The numbers in the last case are the engine's scores and section
// lengths for "Exit codes" on the phase 2 docs graph.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { queryWords, rankScore } from './rank.ts';

test('queryWords drops stopwords, unless nothing else is left', () => {
  assert.deepEqual(queryWords('How to open the store'), ['open', 'store']);
  assert.deepEqual(queryWords('What is it'), ['what', 'is', 'it']);
});

test('a heading that names every query word outranks one that names some, whatever the full-text score', () => {
  const words = queryWords('vector index');
  assert.ok(rankScore(words, 'Create a vector index', 1, 2000) > rankScore(words, 'Vector search', 40, 300));
});

test('the heading that is the query outranks one that names it among other words', () => {
  const words = queryWords('Exit codes');
  const exact = rankScore(words, 'Exit codes', 6, 9542);
  for (const [heading, score, length] of [
    ['Errors and exit codes', 25, 1620],
    ['Branch on exit codes', 16, 2536],
    ['Exit codes and errors', 9, 636],
  ] as const) assert.ok(exact > rankScore(words, heading, score, length), heading);
  assert.equal(rankScore(words, 'The exit codes', 0, 0), rankScore(words, 'Exit codes', 0, 0), 'stopwords in a heading do not count against it');
});

test('among equal headings, the denser section ranks first', () => {
  const words = queryWords('exit codes');
  assert.ok(rankScore(words, 'Errors and exit codes', 12, 884) > rankScore(words, 'Errors and exit codes', 10, 5328));
});

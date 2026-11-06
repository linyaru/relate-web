import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseFrontMatter } from './frontmatter.ts';

const BASE =
  'title: Nearby places\nsummary: "Finds \\"close\\" things"\nfeatures: [point, \'a, b\', "c"]\n' +
  'level: Beginner\ncategory: Geospatial\nbrowser: full\n';

const error = (text: string) => {
  try {
    parseFrontMatter(text);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail(`parsed: ${text}`);
};

test('parses scalars, lists and enums', () => {
  const fm = parseFrontMatter(BASE);
  assert.equal(fm.title, 'Nearby places');
  assert.equal(fm.summary, 'Finds "close" things');
  assert.deepEqual(fm.features, ['point', 'a, b', 'c']);
  assert.equal(fm.level, 'Beginner');
  assert.equal(fm.category, 'Geospatial');
  assert.equal(fm.browser, 'full');
  assert.equal(fm.companion, null);
});

test('rejects unknown and duplicate keys and malformed values', () => {
  assert.match(error('titel: x'), /unknown key/);
  assert.match(error('title: a\ntitle: b'), /duplicate/);
  assert.match(error('features: [a, b'), /unterminated/);
  assert.match(error('features: [a, , b]'), /empty list item/);
  assert.match(error('title: "a\\nb"'), /unsupported escape/);
});

test('reports every schema problem', () => {
  const errs = error('title: T\nlevel: Expert\nfeatures: []\ncompanion: http://x\n');
  for (const want of [
    'missing `summary`',
    'missing `category`',
    'missing `browser`',
    '`level: Expert` is not one of',
    '`features` must be a non-empty list',
    'https:// URL',
  ]) {
    assert.ok(errs.includes(want), `${want} not in:\n${errs}`);
  }
  const long = BASE.replace('"Finds \\"close\\" things"', 'x'.repeat(201));
  assert.match(error(long), /longer than 200/);
});

test('keeps colons in values', () => {
  const fm = parseFrontMatter(`${BASE}companion: https://example.com/a#b\n`);
  assert.equal(fm.companion, 'https://example.com/a#b');
});

// Unit tests for the scale demo's model (src/lib/docs/elements/_scale-demo-model.ts):
// the sizes a directive offers and which one a screen is offered first.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_SIZES, firstSize, sizesOf } from './elements/_scale-demo-model.ts';

test('sizesOf reads the sizes a directive offers, and firstSize picks by screen width', () => {
  assert.deepEqual(sizesOf(undefined), DEFAULT_SIZES);
  assert.deepEqual(sizesOf('500, 5000'), [500, 5000]);
  for (const bad of ['', 'a,b', '1.5', '0', '-1', '1,,2']) assert.equal(sizesOf(bad), null, bad);
  assert.equal(firstSize([1000, 10000, 100000], true), 100000);
  assert.equal(firstSize([1000, 10000, 100000], false), 10000);
  assert.equal(firstSize([1000, 10000], false), 1000);
  assert.equal(firstSize([5000], false), 5000);
});

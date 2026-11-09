// Unit tests for the storage animator's model
// (src/lib/docs/elements/_storage-animator-model.ts): the store it steps
// through follows the WAL reference's rules, the loss windows are the
// concept page's, the `.rl` file never shrinks, and the build file's
// validate holds the facts to cli.json.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyStep,
  drawDurability,
  drawRlFile,
  drawWritePath,
  initialStore,
  loss,
  lossSentence,
  refusal,
  stepsFor,
  TIMELINE,
  type Action,
  type StoreState,
} from './elements/_storage-animator-model.ts';
import spec from './elements/storage-animator.ts';

const run = (s: StoreState, action: Action, view: 'write-path' | 'rl-file' = 'write-path') => {
  for (const step of stepsFor(s, action, view)) s = applyStep(s, step);
  return s;
};

test('a commit appends one record to the open segment, then applies it, under full', () => {
  const s0 = initialStore();
  assert.deepEqual([s0.lsn, s0.checkpointLsn, s0.graphLsn, s0.segments.map((g) => g.id)], [1, 1, 1, [2]]);
  const steps = stepsFor(s0, 'commit', 'write-path');
  assert.equal(steps.length, 6);
  const order = steps.map((st) => st.say.split(' ').slice(0, 4).join(' '));
  assert.match(order[2], /appended/);
  assert.match(steps[3].say, /synced to disk before the commit returns/);
  assert.match(steps[4].say, /applied to the in-memory graph/);
  const s1 = run(s0, 'commit');
  assert.deepEqual([s1.lsn, s1.graphLsn, s1.checkpointLsn, s1.segments[0].records], [2, 2, 1, [2]]);
  assert.equal(s1.pending, null);
});

test('a checkpoint rotates, pins the newest closed record, publishes and recycles', () => {
  let s = run(run(initialStore(), 'commit'), 'commit');
  s = run(s, 'checkpoint');
  assert.equal(s.checkpointLsn, 3);
  assert.deepEqual(s.segments.map((g) => [g.id, g.records, g.closed]), [[3, [], false]]);
  assert.match(refusal(s, 'checkpoint') ?? '', /Nothing to checkpoint/);
  assert.equal(refusal(run(s, 'commit'), 'checkpoint'), null);
});

test('a crash loads the snapshot and replays what the WAL holds past it', () => {
  let s = run(run(initialStore(), 'commit'), 'checkpoint');
  s = run(run(s, 'commit'), 'commit');
  const steps = stepsFor(s, 'crash', 'write-path');
  let t = applyStep(s, steps[0]);
  assert.equal(t.graphLsn, null);
  t = applyStep(t, steps[1]);
  assert.equal(t.graphLsn, 2);
  assert.match(steps[2].say, /above 2, in LSN order: 2 records/);
  t = applyStep(applyStep(t, steps[2]), steps[3]);
  assert.equal(t.graphLsn, 4);
});

test('the .rl file grows to what its parts needed at once and never shrinks', () => {
  let s = initialStore();
  const heights: number[] = [];
  for (const a of ['commit', 'checkpoint', 'commit', 'checkpoint', 'commit', 'checkpoint'] as Action[]) {
    for (const step of stepsFor(s, a, 'rl-file')) {
      s = applyStep(s, step);
      heights.push(s.rlHigh);
    }
  }
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] >= heights[i - 1], `the file shrank at step ${i}`);
  assert.ok(heights.at(-1)! > heights[0]);
  // After the first checkpoint, later ones reuse the space.
  const firstCheckpointEnd = 6 + 5 - 1;
  assert.equal(heights.at(-1), heights[firstCheckpointEnd]);
  assert.match(drawRlFile(s).body, /data-part="free"/);
});

test('loss windows: none under full, since the last sync under everysecond, since the checkpoint under snapshot', () => {
  const at = TIMELINE.crash;
  const acked = TIMELINE.commits.filter((t) => t < at).length;
  assert.deepEqual(loss('full', at).lost, []);
  const every = loss('everysecond', at);
  assert.equal(every.from, 4);
  assert.deepEqual(every.lost, TIMELINE.commits.filter((t) => t > 4 && t < at));
  assert.equal(loss('snapshot', at).lost.length, acked);
  assert.equal(loss('everysecond', 0.6).from, 0);
  assert.match(lossSentence(every), /last background sync was at 4 s, so the 2 writes/);
  assert.match(lossSentence(loss('snapshot', at)), /next timed checkpoint is due at 300 s/);
});

test('the drawings name their parts, and the durability view draws a window only where one exists', () => {
  const s = run(initialStore(), 'commit');
  const wp = drawWritePath(s);
  for (const part of ['statement', 'record', 'wal', 'graph', 'snapshot', 'append', 'apply', 'checkpoint', 'load', 'replay', 'recycle']) assert.match(wp.body, new RegExp(`data-part="${part}"`));
  assert.doesNotMatch(drawDurability(['full'], TIMELINE.crash).body, /class="win"/);
  assert.match(drawDurability(['snapshot'], TIMELINE.crash).body, /class="win"/);
  assert.ok(drawDurability(['full', 'everysecond', 'snapshot'], 4, 320).width === 320);
});

test('validate refuses unknown views and attributes, and passes the facts cli.json records', () => {
  const input = (attributes: Record<string, string>) => ({ name: 'storage-animator', id: 'x', attributes, children: '', page: { id: 'p', file: 'p.mdx' }, cells: [], dataBlocks: {}, recordings: {} });
  assert.deepEqual(spec.validate!(input({})), []);
  assert.deepEqual(spec.validate!(input({ scenes: 'durability,rl-file' })), []);
  assert.match(spec.validate!(input({ scenes: 'durability,disk' })).join(' '), /names `disk`/);
  assert.match(spec.validate!(input({ scenes: 'rl-file,rl-file' })).join(' '), /twice/);
  assert.match(spec.validate!(input({ mode: 'full' })).join(' '), /not `mode`/);
  assert.equal(spec.engine, false);
});

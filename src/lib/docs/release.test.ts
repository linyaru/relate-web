// Unit tests for src/lib/docs/release.ts and scripts/engine-bump.ts: the
// release refresh's engine.json bump keeps the recorded runs the build reads.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { engineCheck } from './checks/cli.ts';
import { ENGINE_FILE, ROOT } from './content.ts';
import { bumpEngine } from './release.ts';

const current = () => JSON.parse(readFileSync(ENGINE_FILE, 'utf8')) as Record<string, unknown>;

test('bumpEngine sets the release and keeps every other key in place', () => {
  const before = current();
  const after = bumpEngine(before, { version: '9.9.9', date: '2030-01-02', commit: 'abcdef1' });
  assert.equal(after.version, '9.9.9');
  assert.equal(after.verified, '9.9.9');
  assert.equal(after.date, '2030-01-02');
  assert.equal(after.commit, 'abcdef1');
  assert.equal('source_build' in after, false);
  assert.deepEqual(after.version_check, before.version_check);
  assert.deepEqual(after.envelope_check, before.envelope_check);
  const keys = Object.keys(before).filter((k) => k !== 'source_build');
  assert.deepEqual(Object.keys(after).filter((k) => keys.includes(k)), keys);
});

test('bumpEngine drops a commit it could not read instead of keeping the old one', () => {
  const after = bumpEngine({ version: '0.1.0', verified: '0.1.0', date: '2020-01-01', commit: 'ac441ec' }, { version: '0.2.0', date: '2020-02-01', commit: null });
  assert.equal('commit' in after, false);
});

test('bumpEngine refuses what is not a release', () => {
  assert.throws(() => bumpEngine({}, { version: '0.17.0-rc.1', date: '2030-01-01', commit: null }));
  assert.throws(() => bumpEngine({}, { version: '0.17.0', date: '2030-1-1', commit: null }));
  assert.throws(() => bumpEngine({}, { version: '0.17.0', date: '2030-01-01', commit: 'not a sha' }));
});

test('scripts/engine-bump.ts on the current engine.json leaves the checks install.ts reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-bump-'));
  const file = join(dir, 'engine.json');
  copyFileSync(ENGINE_FILE, file);
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/engine-bump.ts'), '--version', '0.17.0', '--date', '2030-01-02', '--file', file], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // What install.ts reads on import (recordedCheck): both runs, with their command and stdout.
  assert.equal(engineCheck('envelope_check', dir).command, engineCheck('envelope_check').command);
  assert.equal(engineCheck('version_check', dir).output, engineCheck('version_check').output);
  const after = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  assert.equal(after.version, '0.17.0');
  assert.ok(readFileSync(file, 'utf8').endsWith('}\n'));
});

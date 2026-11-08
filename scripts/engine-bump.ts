#!/usr/bin/env node
// Bumps src/content/docs/_data/engine.json to a relate release, keeping the
// recorded runs it holds (src/lib/docs/release.ts says why). Run by
// scripts/release-refresh.sh (step 5).
//
//   node scripts/engine-bump.ts --version 0.17.0 --date 2026-12-01 [--commit abc1234] [--file <engine.json>]

import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { DOCS_DIR } from '../src/lib/docs/content.ts';
import { bumpEngineFile } from '../src/lib/docs/release.ts';

const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    date: { type: 'string' },
    commit: { type: 'string' },
    file: { type: 'string' },
  },
});

if (!values.version || !values.date) {
  console.error('usage: node scripts/engine-bump.ts --version X.Y.Z --date YYYY-MM-DD [--commit SHA] [--file engine.json]');
  process.exit(2);
}
const file = values.file ?? join(DOCS_DIR, '_data/engine.json');
try {
  const next = bumpEngineFile(file, { version: values.version.replace(/^v/, ''), date: values.date, commit: values.commit || null });
  console.log(`engine.json: version and verified ${String(next.version)}, date ${String(next.date)}${next.commit ? `, commit ${String(next.commit)}` : ', no commit'}`);
} catch (e) {
  console.error(`engine-bump: ${(e as Error).message}`);
  process.exit(1);
}

// The engine.json bump of the release refresh (scripts/release-refresh.sh,
// step 5; DOCS-PLAN.md §6). It merges into the file instead of replacing it:
// `version_check` and `envelope_check` are recorded runs that
// src/components/docs/install.ts reads on import, and the refresh's next step
// (`docs:cli-check -- --record`) re-records them against the release binary,
// so they must survive the bump. Run as `node scripts/engine-bump.ts`.
//
// Erasable TypeScript only (Node runs it directly).

import { readFileSync, writeFileSync } from 'node:fs';

export interface EngineRelease {
  /** X.Y.Z, without a leading v. */
  version: string;
  /** The release's publication date, YYYY-MM-DD (UTC). */
  date: string;
  /** The tag's short commit, or null when it could not be read (the key is then dropped, never left naming another build). */
  commit: string | null;
}

/**
 * engine.json after a release: `version`, `verified` and `date` from the
 * release, `commit` set or dropped, `source_build` dropped (the docs now track
 * a published release); every other key kept, in place.
 */
export function bumpEngine(data: Record<string, unknown>, release: EngineRelease): Record<string, unknown> {
  if (!/^\d+\.\d+\.\d+$/.test(release.version)) throw new Error(`not a release version: ${release.version}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date)) throw new Error(`not a date (YYYY-MM-DD): ${release.date}`);
  if (release.commit !== null && !/^[0-9a-f]{7,40}$/.test(release.commit)) throw new Error(`not a commit: ${release.commit}`);
  const out: Record<string, unknown> = { ...data, version: release.version, verified: release.version, date: release.date };
  if (release.commit) out.commit = release.commit;
  else delete out.commit;
  delete out.source_build;
  return out;
}

/** Bumps the engine.json at `file` in place (two-space JSON, final newline). */
export function bumpEngineFile(file: string, release: EngineRelease): Record<string, unknown> {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const next = bumpEngine(data, release);
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

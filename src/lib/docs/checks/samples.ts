// The verified language samples' static check, for docs:check (the runner is
// scripts/docs-samples.ts; the contract is in src/lib/docs/samples.ts): every
// ```python run and ```js run fence on a published page parses, has an id
// that is unique on the page and that no Cypher cell shares, and has an entry
// of kind "text" in the page's results sidecar, recorded from the code as it
// now reads (`source_sha256`); no "text" entry is left without its sample.
// Needs no client. Whether a recorded output is still what the sample prints
// is docs:samples' job (weekly in CI,
// .github/workflows/docs-samples.yml), so an entry recorded by a client of
// another version is a warning here, not an error.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { ROOT, type Engine, type PageFile } from '../content.ts';
import { resultsFile } from '../results.ts';
import { pageSamples, readSidecar, RECORD_COMMAND, recordedFromSource, type Sidecar } from '../samples.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** What the samples check needs of scripts/docs.ts's Site. */
export interface SamplesSite {
  engine: Engine;
  published: Map<string, PageFile>;
}

export function checkSamples(site: SamplesSite, report: Report): void {
  for (const page of site.published.values()) {
    const { samples, problems } = pageSamples(readFileSync(page.file, 'utf8'), page.id);
    for (const p of problems) {
      const m = /^line (\d+): ([\s\S]*)$/.exec(p);
      report(page.file, m ? Number(m[1]) : null, 'error', 'samples', m ? m[2] : p);
    }
    const sidecarPath = resultsFile(page.file);
    let sidecar: Sidecar | null;
    try {
      sidecar = readSidecar(page.file);
    } catch (e) {
      report(sidecarPath, null, 'error', 'samples', (e as Error).message);
      continue;
    }
    for (const s of samples) {
      const entry = sidecar?.cells[s.id];
      if (!entry) {
        report(page.file, s.line, 'error', 'samples', `sample \`${s.id}\` has no recorded output in ${relative(ROOT, sidecarPath)}; set up the clients (scripts/samples/setup.sh) and run ${RECORD_COMMAND}`);
      } else if (entry.kind !== 'text') {
        report(page.file, s.line, 'error', 'samples', `sample \`${s.id}\`: its recorded entry is kind "${entry.kind}", not "text"`);
      } else if (!recordedFromSource(entry, s)) {
        report(page.file, s.line, 'error', 'samples', `sample \`${s.id}\` changed since it was recorded (or was recorded without \`source_sha256\`); run ${RECORD_COMMAND}`);
      } else if (entry.verified !== site.engine.verified) {
        report(page.file, s.line, 'warning', 'samples', `sample \`${s.id}\` was recorded by client ${entry.verified ?? '(unknown)'}, not ${site.engine.verified}; ${RECORD_COMMAND} re-records it`);
      }
    }
    const ids = new Set(samples.map((s) => s.id));
    for (const [id, entry] of Object.entries(sidecar?.cells ?? {})) {
      if (entry.kind === 'text' && !ids.has(id)) {
        report(sidecarPath, null, 'error', 'samples', `a recorded output for sample \`${id}\`, which the page does not have; run ${RECORD_COMMAND}`);
      }
    }
  }
}

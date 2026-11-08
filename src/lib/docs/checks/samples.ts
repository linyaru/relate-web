// The verified language samples' static check, for docs:check (the runner is
// scripts/docs-samples.ts; the contract is in src/lib/docs/samples.ts): every
// sample fence (```python run, ```js run, ```rust run, ```java run,
// ```go run, ```swift run, ```c run) on a published page parses, has an id
// that is unique on the page and that no Cypher cell shares, and has an entry
// of kind "text" in the page's results sidecar, recorded from the code as it
// now reads (`source_sha256`); no "text" entry is left without its sample.
// Needs no client. Whether a recorded output is still what the sample prints
// is docs:samples' job (weekly in CI,
// .github/workflows/docs-samples.yml), so an entry recorded by a client of
// another version is a warning here, not an error. When some clients are set
// up in the environment (env.sh sourced) and a language's are not, its
// samples are reported once per language as a warning (docs:samples would
// skip them; their records stand), never failed; with no client set up, as
// in CI's required check, nothing is said about clients.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { ROOT, type Engine, type PageFile } from '../content.ts';
import { resultsFile } from '../results.ts';
import { pageSamples, readSidecar, RECORD_COMMAND, recordedFromSource, SAMPLE_LANGS, sampleUnavailable, type ClientEnv, type Sidecar } from '../samples.ts';

export type Severity = 'error' | 'warning';
export type Report = (file: string, line: number | null, severity: Severity, rule: string, message: string) => void;

/** What the samples check needs of scripts/docs.ts's Site. */
export interface SamplesSite {
  engine: Engine;
  published: Map<string, PageFile>;
}

/**
 * `env`, when given (scripts/docs.ts passes clientEnv()), adds the warning for
 * samples whose client is not set up while others are; without it the check
 * reads nothing from the environment.
 */
export function checkSamples(site: SamplesSite, report: Report, env: ClientEnv | null = null): void {
  const anyClient = !!env && SAMPLE_LANGS.some((l) => !env.missing[l]);
  /** Per client that is not set up: its samples, the first one's place, and why. */
  const unreplayed = new Map<string, { n: number; pages: Set<string>; file: string; line: number | null; why: string }>();
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
      const why = anyClient && env ? sampleUnavailable(s, env) : null;
      if (why) {
        const key = s.lang === 'python' && s.env ? `python env=${s.env}` : s.lang;
        const u = unreplayed.get(key) ?? { n: 0, pages: new Set<string>(), file: page.file, line: s.line, why };
        u.n++;
        u.pages.add(page.id);
        unreplayed.set(key, u);
      }
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
  for (const [key, u] of unreplayed) {
    report(u.file, u.line, 'warning', 'samples', `${u.n} ${key} sample(s) on ${u.pages.size} page(s) cannot be replayed in this environment (${u.why}); docs:samples skips them and their records stand`);
  }
}

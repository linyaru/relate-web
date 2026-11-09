#!/usr/bin/env node
// Runs the docs' verified language samples (```python run, ```js run,
// ```rust run, ```java run, ```go run, ```swift run and ```c run fences; the
// contract is in src/lib/docs/samples.ts and the docs README) against local
// builds of the relate clients, and compares each sample's output with the
// result recorded in its page's sidecar (`<page>.results.json`, kind
// "text"). DOCS-PLAN.md §6 "Language samples are verified from phase 1".
//
//   node scripts/docs-samples.ts             check every page (npm run docs:samples)
//   node scripts/docs-samples.ts --record    rewrite the samples' entries in the
//                                            sidecars from a run; review the diff
//   node scripts/docs-samples.ts <page>…     only these pages: page ids
//                                            (get-started/python) or .mdx paths
//   --lang <lang>[,<lang>…]                  only those languages' samples
//                                            (python, js, rust, java, go, swift, c)
//   --require                                fail, instead of skipping, when a
//                                            selected language's client is not
//                                            set up (CI)
//   --any-version                            record even when a client's version
//                                            differs from _data/engine.json
//   --clients                                print each client's version and
//                                            where it is, run nothing else; exits
//                                            1 when a set-up client does not load
//                                            (scripts/samples/setup.sh ends with it)
//
// The clients come from the environment (the variables are listed in
// samples.ts and described in scripts/samples/setup.sh, which builds them
// from the upstream checkout and writes env.sh). A language whose variables
// are missing is skipped with a line saying which one and why (an error with
// --require); with no client set up at all the run prints how to set them up
// and exits 0 as skipped. DOCS_EXAMPLES=1 also runs the example page
// (src/content/docs/_example/), which proves each runner end to end.
//
// Check mode fails on a sample that fails to build or run, prints nothing,
// has no recorded result, or prints other than its record, and on a recorded
// "text" entry that is no longer a sample on the page. A client whose
// version differs from _data/engine.json is a warning in check mode and
// stops --record (the sidecar would claim a version it was not run on).
// Cypher cells' entries in the same sidecar are never touched. Samples run
// one at a time; the summary gives each language's sample count and time.
//
// Exits 1 when there is any error.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

import { DOCS_DIR, engine as readEngine, pageFiles, ROOT } from '../src/lib/docs/content.ts';
import { resultsFile } from '../src/lib/docs/results.ts';
import {
  clientEnv,
  clientVersion,
  describeClient,
  formatSidecar,
  mergeSamples,
  outputDiff,
  pageSamples,
  readSidecar,
  RECORD_COMMAND,
  runSample,
  SAMPLE_LANGS,
  sampleEntry,
  sampleSourceHash,
  sampleUnavailable,
  SETUP_COMMAND,
  writeSidecar,
  type Sample,
  type SampleLang,
  type Sidecar,
  type SidecarEntry,
} from '../src/lib/docs/samples.ts';

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    record: { type: 'boolean', default: false },
    require: { type: 'boolean', default: false },
    'any-version': { type: 'boolean', default: false },
    clients: { type: 'boolean', default: false },
    lang: { type: 'string' },
  },
});

const langArg = (args.lang ?? '').split(',').map((l) => l.trim()).filter(Boolean);
const unknownLang = langArg.find((l) => !SAMPLE_LANGS.includes(l as SampleLang));
if (unknownLang) {
  console.error(`--lang takes ${SAMPLE_LANGS.join(', ')} (comma-separated), not ${unknownLang}`);
  process.exit(2);
}
const langs = (langArg.length ? langArg : [...SAMPLE_LANGS]) as SampleLang[];

const rel = (file: string) => {
  const r = relative(ROOT, file);
  return r.startsWith('..') ? file : r.split(sep).join('/');
};

const errors: string[] = [];
const warnings: string[] = [];
const error = (file: string, line: number | null, msg: string) => errors.push(`${rel(file)}${line ? `:${line}` : ''}: ${msg}`);
const warn = (file: string, line: number | null, msg: string) => warnings.push(`${rel(file)}${line ? `:${line}` : ''}: ${msg}`);

// ---------------------------------------------------------------------------
// --clients: each client's version, then exit

if (args.clients) {
  const env = clientEnv();
  let failed = 0;
  for (const lang of langs) {
    const why = env.missing[lang];
    if (why) {
      console.error(`${lang}: not set up (${why})`);
      continue;
    }
    const envs = lang === 'python' ? [null, ...Object.keys(env.pythonEnvs)] : [null];
    for (const pyEnv of envs) {
      const label = pyEnv ? `${lang} env=${pyEnv}` : lang;
      const started = Date.now();
      const { version, error: vErr } = clientVersion(lang, env, pyEnv);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (version) console.error(`${label}: ${version} (${pyEnv ? env.pythonEnvs[pyEnv] : describeClient(lang, env)}; probe ${secs} s)`);
      else {
        failed++;
        console.error(`${label}: does not load: ${vErr}`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The pages

function usageError(message: string): never {
  console.error(`docs:samples: ${message}`);
  process.exit(1);
}

function selectedFiles(): string[] {
  const published = pageFiles().filter((p) => p.data.status !== 'planned');
  if (!positionals.length) return published.map((p) => p.file);
  return positionals.map((arg) => {
    if (arg.endsWith('.mdx')) {
      const file = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
      if (!existsSync(file)) usageError(`${arg}: no such file`);
      return file;
    }
    const page = pageFiles().find((p) => p.id === arg.replace(/^\/?(?:docs\/)?|\/$/g, ''));
    if (!page) usageError(`${arg}: no docs page has that id (an id is a path under ${rel(DOCS_DIR)}, without .mdx; the example page is ${rel(DOCS_DIR)}/_example/example.mdx with DOCS_EXAMPLES=1)`);
    return page.file;
  });
}

interface PageRun {
  file: string;
  samples: Sample[];
  sidecar: Sidecar | null;
}

const pages: PageRun[] = [];
for (const file of selectedFiles()) {
  const { samples, problems } = pageSamples(readFileSync(file, 'utf8'), rel(file));
  for (const p of problems) errors.push(`${rel(file)}: ${p}`);
  let sidecar: Sidecar | null = null;
  try {
    sidecar = readSidecar(file);
  } catch (e) {
    error(file, null, (e as Error).message);
    continue;
  }
  if (samples.length || Object.values(sidecar?.cells ?? {}).some((c) => c.kind === 'text')) pages.push({ file, samples, sidecar });
}

const total = pages.reduce((n, p) => n + p.samples.length, 0);
const wanted = new Set(pages.flatMap((p) => p.samples.map((s) => s.lang)).filter((l) => langs.includes(l)));

// ---------------------------------------------------------------------------
// The clients

const env = clientEnv();
const engine = readEngine();
/** The version each client records, by `lang` or `python env=<name>`. */
const runnable = new Map<string, string>();
const clientKey = (s: Pick<Sample, 'lang' | 'env'>) => (s.lang === 'python' && s.env ? `python env=${s.env}` : s.lang);
const notSetUp = new Set<string>(); // client keys whose variables are missing

const wantedClients = new Map<string, Sample>();
for (const p of pages) for (const s of p.samples) if (langs.includes(s.lang) && !wantedClients.has(clientKey(s))) wantedClients.set(clientKey(s), s);

for (const [key, s] of wantedClients) {
  const why = sampleUnavailable(s, env);
  if (why) {
    notSetUp.add(key);
    (args.require ? errors : warnings).push(`${key} samples ${args.require ? 'cannot run' : 'skipped'}: ${why}`);
    continue;
  }
  const { version, error: vErr } = clientVersion(s.lang, env, s.lang === 'python' ? s.env : null);
  if (!version) {
    errors.push(`the ${key} client does not load: ${vErr}`);
    continue;
  }
  if (version !== engine.version) {
    const msg = `the ${key} client is ${version}, _data/engine.json is ${engine.version}`;
    if (args.record && !args['any-version']) {
      errors.push(`${msg}; not recording (a sample's entry carries the version it ran on; --any-version records anyway)`);
      continue;
    }
    warnings.push(`${msg}; outputs may differ for that reason`);
  }
  console.error(`${key}: client ${version} (${s.lang === 'python' && s.env ? env.pythonEnvs[s.env] : describeClient(s.lang, env)})`);
  runnable.set(key, version);
}

if (wantedClients.size && notSetUp.size === wantedClients.size && !args.require) {
  for (const w of warnings) console.error(`warning: ${w}`);
  console.error(
    [
      '',
      `docs:samples: skipped (${total} sample(s) on ${pages.length} page(s); no client set up).`,
      'The samples run against local builds of the relate clients. To build them from the',
      'upstream checkout (macOS or Linux; needs Rust, and per client Python 3.9+, Node 22.13+,',
      'a C compiler, Go 1.22+, Swift 6 with Xcode; the JDK and Maven are downloaded):',
      '',
      `  ${SETUP_COMMAND}`,
      '  source "${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples/env.sh"',
      '',
      'env.sh sets the variables each client needs (RELATE_PY, RELATE_NODE and NODE_PATH,',
      'RELATE_RUST_PROJECT, RELATE_JAVA_CLASSPATH, RELATE_GO_CLIENT, RELATE_SWIFT_PACKAGE,',
      'RELATE_CC, RELATE_LIB, …; scripts/samples/setup.sh describes each).',
    ].join('\n'),
  );
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Run, compare, record

let ran = 0;
let changedFiles = 0;
const timing = new Map<string, { n: number; ms: number }>(); // language → samples run, time
for (const page of pages) {
  const recorded = new Map<string, SidecarEntry>();
  let failed = false;
  for (const s of page.samples) {
    const old = page.sidecar?.cells[s.id];
    const key = clientKey(s);
    if (!runnable.has(key)) {
      // Not run this time: keep what is recorded.
      if (old) recorded.set(s.id, old);
      continue;
    }
    const started = Date.now();
    const r = runSample(s, env);
    const t = timing.get(s.lang) ?? { n: 0, ms: 0 };
    timing.set(s.lang, { n: t.n + 1, ms: t.ms + Date.now() - started });
    ran++;
    if (!r.ok) {
      failed = true;
      error(page.file, s.line, `sample \`${s.id}\` (${key}) ${r.error}`);
      if (old) recorded.set(s.id, old);
      continue;
    }
    const versionNow = runnable.get(key)!;
    if (args.record) {
      recorded.set(s.id, sampleEntry(r.text, versionNow, sampleSourceHash(s)));
      continue;
    }
    recorded.set(s.id, old ?? sampleEntry(r.text, versionNow, sampleSourceHash(s)));
    if (!old) error(page.file, s.line, `sample \`${s.id}\` has no recorded result in ${rel(resultsFile(page.file))}; record it: ${RECORD_COMMAND}`);
    else if (old.kind !== 'text') error(page.file, s.line, `sample \`${s.id}\`: the recorded entry is kind "${old.kind}", not "text" (an id shared with a Cypher cell?)`);
    else if (old.text !== r.text) error(page.file, s.line, `sample \`${s.id}\` printed other than its record:\n${outputDiff(old.text, r.text)}`);
    else if (old.source_sha256 !== sampleSourceHash(s)) error(page.file, s.line, `sample \`${s.id}\` prints its record, but its code changed since it was recorded; ${RECORD_COMMAND} records it`);
    else if (old.verified !== versionNow) warn(page.file, s.line, `sample \`${s.id}\` matches, but was recorded by client ${old.verified ?? '(unknown)'}, not ${versionNow}; ${RECORD_COMMAND} refreshes it`);
  }
  const ids = new Set(page.samples.map((s) => s.id));
  const stale = Object.entries(page.sidecar?.cells ?? {}).filter(([id, c]) => c.kind === 'text' && !ids.has(id)).map(([id]) => id);
  if (!args.record) {
    for (const id of stale) error(page.file, null, `${rel(resultsFile(page.file))} records \`${id}\`, which is no longer a sample on the page; ${RECORD_COMMAND} drops it`);
    continue;
  }
  if (failed && !page.sidecar) continue;
  const next = mergeSamples(page.sidecar, recorded, engine.version);
  if (!Object.keys(next.cells).length && !page.sidecar) continue;
  if (!page.sidecar || formatSidecar(page.sidecar) !== formatSidecar(next)) {
    writeSidecar(page.file, next);
    changedFiles++;
    console.error(`updated ${rel(resultsFile(page.file))}`);
  }
}

for (const w of warnings) console.error(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
for (const lang of SAMPLE_LANGS) {
  const t = timing.get(lang);
  if (t) console.error(`${lang}: ${t.n} sample(s) in ${(t.ms / 1000).toFixed(1)} s (${(t.ms / t.n / 1000).toFixed(1)} s each)`);
}
const skipped = total - ran;
console.error(
  `docs:samples: ${ran} sample(s) run on ${pages.length} page(s)${skipped ? `, ${skipped} not run` : ''}` +
    `${args.record ? `, ${changedFiles} sidecar(s) updated` : ''}; ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);

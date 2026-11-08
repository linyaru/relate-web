#!/usr/bin/env node
// Runs the docs' verified language samples (```python run and ```js run
// fences; the contract is in src/lib/docs/samples.ts and the docs README)
// against local builds of the relate clients, and compares each sample's
// output with the result recorded in its page's sidecar
// (`<page>.results.json`, kind "text"). DOCS-PLAN.md §6 "Language samples
// are verified from phase 1".
//
//   node scripts/docs-samples.ts             check every page (npm run docs:samples)
//   node scripts/docs-samples.ts --record    rewrite the samples' entries in the
//                                            sidecars from a run; review the diff
//   node scripts/docs-samples.ts <page>…     only these pages: page ids
//                                            (get-started/python) or .mdx paths
//   --lang python|js                         only that language's samples
//   --require                                fail, instead of skipping, when a
//                                            client is not set up (CI)
//   --any-version                            record even when a client's version
//                                            differs from _data/engine.json
//
// The clients come from the environment: RELATE_PY (a Python that can
// `import relate`), RELATE_NODE with NODE_PATH (the node_modules directory
// holding @relate/relate) and, for a client built from source, RELATE_LIB.
// scripts/samples/setup.sh builds both from the upstream checkout and prints
// the variables. Without them the run prints how to set them up and exits 0
// as skipped (exit 1 with --require).
//
// Check mode fails on a sample that fails to run, prints nothing, has no
// recorded result, or prints other than its record, and on a recorded
// "text" entry that is no longer a sample on the page. A client whose
// version differs from _data/engine.json is a warning in check mode and
// stops --record (the sidecar would claim a version it was not run on).
// Cypher cells' entries in the same sidecar are never touched.
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
    lang: { type: 'string' },
  },
});

if (args.lang && !SAMPLE_LANGS.includes(args.lang as SampleLang)) {
  console.error(`--lang takes ${SAMPLE_LANGS.join(' or ')}, not ${args.lang}`);
  process.exit(2);
}
const langs = (args.lang ? [args.lang] : [...SAMPLE_LANGS]) as SampleLang[];

const rel = (file: string) => {
  const r = relative(ROOT, file);
  return r.startsWith('..') ? file : r.split(sep).join('/');
};

const errors: string[] = [];
const warnings: string[] = [];
const error = (file: string, line: number | null, msg: string) => errors.push(`${rel(file)}${line ? `:${line}` : ''}: ${msg}`);
const warn = (file: string, line: number | null, msg: string) => warnings.push(`${rel(file)}${line ? `:${line}` : ''}: ${msg}`);

// ---------------------------------------------------------------------------
// The pages

function selectedFiles(): string[] {
  const published = pageFiles().filter((p) => p.data.status !== 'planned');
  if (!positionals.length) return published.map((p) => p.file);
  return positionals.map((arg) => {
    if (arg.endsWith('.mdx')) {
      const file = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
      if (!existsSync(file)) throw new Error(`${arg}: no such file`);
      return file;
    }
    const page = pageFiles().find((p) => p.id === arg.replace(/^\/?(?:docs\/)?|\/$/g, ''));
    if (!page) throw new Error(`${arg}: no docs page has that id (an id is a path under ${rel(DOCS_DIR)}, without .mdx)`);
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
const runnable = new Map<SampleLang, string>(); // language → client version
for (const lang of wanted) {
  const why = env.missing[lang];
  if (why) {
    (args.require ? errors : warnings).push(`${lang} samples ${args.require ? 'cannot run' : 'skipped'}: ${why}`);
    continue;
  }
  const { version, error: vErr } = clientVersion(lang, env);
  if (!version) {
    errors.push(`the ${lang} client does not load: ${vErr}`);
    continue;
  }
  if (version !== engine.version) {
    const msg = `the ${lang} client is ${version}, _data/engine.json is ${engine.version}`;
    if (args.record && !args['any-version']) {
      errors.push(`${msg}; not recording (a sample's entry carries the version it ran on; --any-version records anyway)`);
      continue;
    }
    warnings.push(`${msg}; outputs may differ for that reason`);
  }
  console.error(`${lang}: client ${version} (${lang === 'python' ? env.python : `${env.node}, ${env.nodeModules}`})`);
  runnable.set(lang, version);
}

if (wanted.size && [...wanted].every((l) => env.missing[l]) && !args.require) {
  for (const w of warnings) console.error(`warning: ${w}`);
  console.error(
    [
      '',
      `docs:samples: skipped (${total} sample(s) on ${pages.length} page(s); no client set up).`,
      'The samples run against local builds of the relate clients. To build them from the',
      'upstream checkout (macOS or Linux; needs Rust, Python 3.9+ and Node 18+):',
      '',
      `  ${SETUP_COMMAND}`,
      '  source "${XDG_CACHE_HOME:-$HOME/.cache}/relate-web-samples/env.sh"',
      '',
      'That sets RELATE_PY (a Python that can `import relate`), RELATE_NODE and NODE_PATH',
      '(the node_modules directory holding @relate/relate) and RELATE_LIB (the native library).',
    ].join('\n'),
  );
  process.exit(errors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Run, compare, record

let ran = 0;
let changedFiles = 0;
for (const page of pages) {
  const recorded = new Map<string, SidecarEntry>();
  let failed = false;
  for (const s of page.samples) {
    const old = page.sidecar?.cells[s.id];
    if (!runnable.has(s.lang)) {
      // Not run this time: keep what is recorded.
      if (old) recorded.set(s.id, old);
      continue;
    }
    const r = runSample(s, env);
    ran++;
    if (!r.ok) {
      failed = true;
      error(page.file, s.line, `sample \`${s.id}\` (${s.lang}) ${r.error}`);
      if (old) recorded.set(s.id, old);
      continue;
    }
    const versionNow = runnable.get(s.lang)!;
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
const skipped = total - ran;
console.error(
  `docs:samples: ${ran} sample(s) run on ${pages.length} page(s)${skipped ? `, ${skipped} not run` : ''}` +
    `${args.record ? `, ${changedFiles} sidecar(s) updated` : ''}; ${errors.length} error(s), ${warnings.length} warning(s)`,
);
process.exit(errors.length ? 1 : 0);

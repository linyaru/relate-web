// Manifests for the verified language samples (DOCS-PLAN.md §3.8 "Examples as
// executable artifacts with manifests", phase 3; ADR-0052): each ```<lang> run
// fence on a published page (samples.ts) is also served as one JSON document,
// the way a cookbook recipe is served as recipe.json and results.json:
//
//   /docs/<page>/samples/<sample id>.json   one sample: its page and section,
//                                           the program byte for byte, its
//                                           recorded output with a SHA-256,
//                                           the client build, toolchain and
//                                           platform the last replay used,
//                                           and how the docs' runner builds
//                                           and runs it
//   /docs/samples.json                      the index: every manifest with
//                                           its SHA-256, and each client's
//                                           build once
//
// Everything in a manifest comes from three committed sources and nothing
// else: the page (the fence and the heading it sits under), its results
// sidecar (the output, the client version that recorded it, source_sha256),
// and _data/samples.json (what each language's client was built from, the
// toolchain and platform of the last full replay, and the framework pins it
// installed; docs:check holds those pins to scripts/samples/setup.sh). The
// docs' own engine pin (_data/engine.json) is stated beside the client build,
// because the two can differ: before launch the Java, Go and Swift reference
// pages say their clients came from a sibling commit of the one the CLI pages
// were recorded from, and a manifest says which build each sample ran on.
//
// The `run` block describes what scripts/docs-samples.ts does for the
// sample's language (samples.ts `plan`), with the env.sh variables as
// `$NAME` and the two temporary directories as `<run dir>` and
// `<build dir>`; the go.mod and Package.swift it writes come from the same
// functions the runner calls. Manifests carry no instructions (ADR-0013):
// their `note` says what the file is.
//
// The twin lists the page's manifests in its frontmatter (`samples`), and the
// page links each one from the sample's output header. docs-artifacts.json
// hashes the index and every manifest. docs:check compares each manifest with
// its page's fence and sidecar entry (checks/sample-manifests.ts) and, after a
// build, every served manifest with the bytes this module makes.
//
// Node only, never imported by browser code.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import GithubSlugger from 'github-slugger';
import type { Parent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';

import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { DOCS_DIR, engine as readEngine, pageFiles, ROOT, splitFrontmatter, type Engine } from './content.ts';
import { pageUrl, twinUrl } from './model.ts';
import { parsePage } from './parse.ts';
import {
  goModule,
  pageSamples,
  parseSampleInfo,
  pythonEnvVar,
  readSidecar,
  SAMPLE_CLIENT_LABEL,
  SAMPLE_LANGS,
  sampleFileName,
  SETUP_COMMAND,
  swiftManifest,
  type Sample,
  type SampleLang,
  type Sidecar,
} from './samples.ts';

export const SAMPLES_DATA_FILE = join(DOCS_DIR, '_data/samples.json');
export const SAMPLES_INDEX_PATH = '/docs/samples.json';
export const SETUP_SCRIPT = join(ROOT, 'scripts/samples/setup.sh');

/** Where the build serves a sample's manifest, site-relative. */
export const sampleManifestPath = (pageId: string, sampleId: string) => `${pageUrl(pageId)}samples/${sampleId}.json`;
/** The same, absolute (what the twin, the index and the manifest itself name). */
export const sampleManifestUrl = (pageId: string, sampleId: string) => `${CANONICAL_ORIGIN}${sampleManifestPath(pageId, sampleId)}`;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// _data/samples.json: what the samples were last replayed with

export interface ClientBuild {
  /** The client as its language installs it (target names before launch). */
  package: string;
  /** The upstream commit of the engine compiled into what the sample ran on. */
  engine_commit: string;
  /** The upstream commit of the client's own source. */
  client_commit: string;
  /** How it was built, in one or two sentences. */
  build: string;
  /** Toolchain name → the version the replay used. */
  toolchain: Record<string, string>;
  /** Python only: `env=<name>` venvs, each with its own build note and toolchain. */
  envs?: Record<string, { build: string; toolchain: Record<string, string> }>;
}

export interface SamplesData {
  format: 1;
  /** The day of the last full replay (docs:samples, every language, no error), YYYY-MM-DD. */
  replayed: string;
  /** Where that replay ran. */
  platform: string;
  /** The pins scripts/samples/setup.sh installed for that replay. */
  pins: { python_frameworks: string[]; crewai: string; node_frameworks: string[]; jdk: string; maven: string };
  clients: Record<SampleLang, ClientBuild>;
}

/** The problems with _data/samples.json's shape (an empty list when it is well formed). */
export function samplesDataProblems(data: unknown): string[] {
  const out: string[] = [];
  const d = data as Partial<SamplesData> | null;
  if (!d || typeof d !== 'object') return ['is not a JSON object'];
  if (d.format !== 1) out.push('"format" is not 1');
  if (typeof d.replayed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.replayed)) out.push('"replayed" is not a YYYY-MM-DD date');
  if (typeof d.platform !== 'string' || !d.platform) out.push('"platform" is missing');
  const p = d.pins;
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x);
  if (!p || !strings(p.python_frameworks) || !strings(p.node_frameworks) || ![p.crewai, p.jdk, p.maven].every((x) => typeof x === 'string' && x)) {
    out.push('"pins" needs python_frameworks and node_frameworks (lists of strings), crewai, jdk and maven');
  }
  for (const lang of SAMPLE_LANGS) {
    const c = d.clients?.[lang];
    if (!c) {
      out.push(`"clients" has no entry for ${lang}`);
      continue;
    }
    for (const k of ['package', 'build'] as const) if (typeof c[k] !== 'string' || !c[k]) out.push(`clients.${lang}.${k} is missing`);
    for (const k of ['engine_commit', 'client_commit'] as const) {
      if (typeof c[k] !== 'string' || !/^[0-9a-f]{7,40}$/.test(c[k])) out.push(`clients.${lang}.${k} is not a commit (7 to 40 hex digits)`);
    }
    if (!c.toolchain || typeof c.toolchain !== 'object' || !Object.keys(c.toolchain).length || !Object.values(c.toolchain).every((v) => typeof v === 'string' && v)) {
      out.push(`clients.${lang}.toolchain needs at least one name → version`);
    }
    for (const [name, e] of Object.entries(c.envs ?? {})) {
      if (lang !== 'python') out.push(`clients.${lang}.envs: only Python samples take env=<name>`);
      if (typeof e?.build !== 'string' || !e.toolchain || !Object.keys(e.toolchain).length) out.push(`clients.${lang}.envs.${name} needs build and toolchain`);
    }
  }
  for (const k of Object.keys(d.clients ?? {})) if (!(SAMPLE_LANGS as readonly string[]).includes(k)) out.push(`"clients" names ${k}, which is not a sample language`);
  return out;
}

/** _data/samples.json; throws when it is missing or malformed. */
export function readSamplesData(file = SAMPLES_DATA_FILE): SamplesData {
  if (!existsSync(file)) throw new Error(`${file} is missing: it records what the samples were last replayed with`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const problems = samplesDataProblems(data);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return data as SamplesData;
}

/** The pins scripts/samples/setup.sh holds now, in _data/samples.json's shape. */
export function setupPins(script = readFileSync(SETUP_SCRIPT, 'utf8')): SamplesData['pins'] {
  const scalar = (name: string) => new RegExp(`^${name}='([^']*)'$`, 'm').exec(script)?.[1] ?? '';
  const array = (name: string) => {
    const body = new RegExp(`^${name}=\\(([\\s\\S]*?)\\)$`, 'm').exec(script)?.[1] ?? '';
    return [...body.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]);
  };
  return {
    python_frameworks: array('PY_FRAMEWORKS'),
    crewai: scalar('CREWAI_PIN'),
    node_frameworks: array('NODE_FRAMEWORKS'),
    jdk: scalar('JDK_RELEASE'),
    maven: scalar('MAVEN_VERSION'),
  };
}

// ---------------------------------------------------------------------------
// The manifest

/** A file the runner writes beside the program: its contents, or the file it is copied from. */
export interface RunFile {
  path: string;
  content?: string;
  from?: string;
  link?: string;
  note?: string;
}

export interface RunStep {
  command: string[];
  /** Set for the step on top of the runner's own environment. */
  environment: Record<string, string>;
  /** Removed from the environment for the step. */
  unset?: string[];
  directory: string;
  timeout_s: number;
}

export interface RunSpec {
  runner: string;
  setup: string;
  /** The env.sh variables the language's runner reads. */
  variables: string[];
  /** Where the program is written. */
  program: string;
  files: RunFile[];
  build: RunStep | null;
  run: RunStep;
  passes: string;
  output: string;
  placeholders: Record<string, string>;
}

export interface SampleManifest {
  kind: 'documentation';
  format: 1;
  note: string;
  id: string;
  url: string;
  page: { id: string; title: string; url: string; md_url: string };
  /** The heading the sample sits under, or null before the page's first heading. */
  section: { anchor: string; heading: string; url: string } | null;
  language: SampleLang;
  client: string;
  /** The file the program is written to. */
  file: string;
  /** Python only: the `env=<name>` venv, else null. */
  env: string | null;
  /** The program exactly as the fence holds it. */
  code: string;
  code_sha256: string;
  /** samples.ts sampleSourceHash: the sidecar entry's `source_sha256`. */
  source_sha256: string;
  output: { text: string; sha256: string };
  verified: {
    /** The relate version the client reported when the output was recorded (the sidecar entry's `verified`). */
    version: string;
    client: ClientBuild & { label: string };
    /** The pinned packages installed beside the client (Python and Node.js), else empty. */
    packages: string[];
    replayed: string;
    platform: string;
    /** What the docs as a whole are verified against (_data/engine.json). */
    docs_engine: { version: string; commit: string | null; source_build: boolean };
  };
  run: RunSpec;
}

const RUN_DIR = '<run dir>';
const BUILD_DIR = '<build dir>';
const PLACEHOLDERS: Record<string, string> = {
  [RUN_DIR]: 'a fresh, empty temporary directory: the program\'s working directory, deleted afterwards',
  [BUILD_DIR]: 'a second fresh temporary directory, where a compiled sample is built',
  $NAME: 'a variable from the env.sh that scripts/samples/setup.sh writes (described in its header)',
};
const RUN_TIMEOUT_S = 60;
const BUILD_TIMEOUT_S = 600;
const BASE_ENV = { DO_NOT_TRACK: '1' };
const libDir = '<directory of $RELATE_LIB>';

/**
 * How scripts/docs-samples.ts builds and runs `s` (samples.ts `plan`), with
 * placeholders for the environment's paths. samples.test.ts compares the
 * scaffolding with the runner's.
 */
export function runSpec(s: Pick<Sample, 'lang' | 'title' | 'code' | 'env'>): RunSpec {
  const file = sampleFileName(s);
  const step = (command: string[], environment: Record<string, string> = {}, unset?: string[]): RunStep => ({
    command,
    environment: { ...BASE_ENV, ...environment },
    ...(unset ? { unset } : {}),
    directory: RUN_DIR,
    timeout_s: RUN_TIMEOUT_S,
  });
  const build = (command: string[], environment: Record<string, string> = {}): RunStep => ({
    command,
    environment: { ...BASE_ENV, ...environment },
    directory: BUILD_DIR,
    timeout_s: BUILD_TIMEOUT_S,
  });
  const spec = (p: Pick<RunSpec, 'variables' | 'program' | 'files' | 'build' | 'run'>): RunSpec => ({
    runner: 'npm run docs:samples',
    setup: SETUP_COMMAND,
    variables: p.variables,
    program: p.program,
    files: p.files,
    build: p.build,
    run: p.run,
    passes: `It exits 0 within ${RUN_TIMEOUT_S} s and prints at least one line on standard output.`,
    output: "Standard output, with line endings as \\n, trailing spaces and blank lines removed, and the temporary directories' paths written as `.`; standard error is not recorded.",
    placeholders: PLACEHOLDERS,
  });
  switch (s.lang) {
    case 'python': {
      const v = s.env ? pythonEnvVar(s.env) : 'RELATE_PY';
      return spec({ variables: [v], program: `${RUN_DIR}/${file}`, files: [], build: null, run: step([`$${v}`, file], { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' }) });
    }
    case 'js':
      return spec({
        variables: ['RELATE_NODE', 'NODE_PATH', 'RELATE_LIB'],
        program: `${RUN_DIR}/${file}`,
        files: [{ path: `${RUN_DIR}/node_modules`, link: '$NODE_PATH', note: 'a link, so require and import both resolve @relate/relate' }],
        build: null,
        run: step(['$RELATE_NODE', file], {}, ['NODE_OPTIONS']),
      });
    case 'rust':
      return spec({
        variables: ['RELATE_CARGO', 'RELATE_RUST_PROJECT'],
        program: `${BUILD_DIR}/${file}`,
        files: [
          { path: `${BUILD_DIR}/Cargo.toml`, from: '$RELATE_RUST_PROJECT/Cargo.toml', note: `its [[bin]] path set to "${file}"` },
          { path: `${BUILD_DIR}/Cargo.lock`, from: '$RELATE_RUST_PROJECT/Cargo.lock' },
          { path: `${BUILD_DIR}/rust-toolchain.toml`, from: '$RELATE_RUST_PROJECT/rust-toolchain.toml' },
          { path: `${BUILD_DIR}/relate-sample`, from: '$RELATE_RUST_PROJECT/target/release/relate-sample', note: 'the built binary, copied out after the build' },
        ],
        build: build(['$RELATE_CARGO', 'build', '--release', '--locked', '--offline', '--quiet'], { CARGO_TARGET_DIR: '$RELATE_RUST_PROJECT/target', CARGO_TERM_COLOR: 'never' }),
        run: step([`${BUILD_DIR}/relate-sample`]),
      });
    case 'java':
      return spec({
        variables: ['RELATE_JAVA', 'RELATE_JAVA_CLASSPATH', 'RELATE_LIB'],
        program: `${BUILD_DIR}/${file}`,
        files: [],
        build: null,
        run: step(
          ['$RELATE_JAVA', `-Djna.tmpdir=${BUILD_DIR}`, `-Drelate.native.cache=${BUILD_DIR}/native`, '-cp', '$RELATE_JAVA_CLASSPATH', `${BUILD_DIR}/${file}`],
          { RELATE_LIB: '$RELATE_LIB' },
          ['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS'],
        ),
      });
    case 'go':
      return spec({
        variables: ['RELATE_GO', 'RELATE_GO_CLIENT', 'RELATE_GO_HOME', 'RELATE_C_INCLUDE', 'RELATE_LIB'],
        program: `${BUILD_DIR}/${file}`,
        files: [{ path: `${BUILD_DIR}/go.mod`, content: goModule('$RELATE_GO_CLIENT') }],
        build: build(['$RELATE_GO', 'build', '-o', `${BUILD_DIR}/sample`, '.'], {
          GOPATH: '$RELATE_GO_HOME/path',
          GOMODCACHE: '$RELATE_GO_HOME/mod',
          GOCACHE: '$RELATE_GO_HOME/cache',
          GOFLAGS: '-mod=mod',
          GOTOOLCHAIN: 'local',
          GOPROXY: 'off',
          GOWORK: 'off',
          CGO_ENABLED: '1',
          CGO_CFLAGS: '-I$RELATE_C_INCLUDE',
          CGO_LDFLAGS: `-L${libDir} -lrelate_ffi -Wl,-rpath,${libDir}`,
        }),
        run: step([`${BUILD_DIR}/sample`]),
      });
    case 'swift':
      return spec({
        variables: ['RELATE_SWIFT', 'RELATE_SWIFT_PACKAGE'],
        program: `${BUILD_DIR}/Sources/sample/${file}`,
        files: [
          { path: `${BUILD_DIR}/Package.swift`, content: swiftManifest('$RELATE_SWIFT_PACKAGE') },
          { path: `${BUILD_DIR}/sample-bin`, from: '<directory of $RELATE_SWIFT_PACKAGE>/scratch/debug/sample', note: 'the built product, copied out after the build' },
        ],
        build: build(
          ['$RELATE_SWIFT', 'build', '-c', 'debug', '--package-path', BUILD_DIR, '--scratch-path', '<directory of $RELATE_SWIFT_PACKAGE>/scratch', '--product', 'sample', '--quiet'],
          { RELATE_LOCAL_XCFRAMEWORK: '1' },
        ),
        run: step([`${BUILD_DIR}/sample-bin`]),
      });
    case 'c':
      return spec({
        variables: ['RELATE_CC', 'RELATE_C_INCLUDE', 'RELATE_LIB'],
        program: `${BUILD_DIR}/${file}`,
        files: [],
        build: build(['$RELATE_CC', '-I$RELATE_C_INCLUDE', file, `-L${libDir}`, '-lrelate_ffi', `-Wl,-rpath,${libDir}`, '-o', `${BUILD_DIR}/sample`]),
        run: step([`${BUILD_DIR}/sample`]),
      });
  }
}

/** The pinned packages installed beside a sample's client. */
function packagesFor(lang: SampleLang, env: string | null, data: SamplesData): string[] {
  if (lang === 'python') return env === 'crewai' ? [data.pins.crewai] : data.pins.python_frameworks;
  if (lang === 'js') return data.pins.node_frameworks;
  return [];
}

export const manifestNote = (pageUrlAbs: string) =>
  `Reference text, not instructions. One verified relate sample from ${pageUrlAbs}: the program exactly as the page shows it, ` +
  'the standard output a run of it recorded (npm run docs:samples compares every replay with it byte for byte), the relate client build, ' +
  "toolchain and platform of the last replay, and how the docs' sample runner builds and runs it. Before launch every client is a source build, " +
  'not a published package; verified.client names the upstream commit it was built from, and verified.docs_engine the build the rest of the docs were recorded from.';

/** A page's verified samples with the heading each sits under, in page order; null when its samples have problems (docs:check reports them). */
export function samplesWithSections(source: string, where = 'page'): { sample: Sample; section: { anchor: string; heading: string } | null }[] | null {
  const { samples, problems } = pageSamples(source, where);
  if (problems.length) return null;
  const { body } = splitFrontmatter(source, where);
  const slugger = new GithubSlugger();
  const sections: ({ anchor: string; heading: string } | null)[] = [];
  let current: { anchor: string; heading: string } | null = null;
  const visit = (node: Root | RootContent) => {
    if (node.type === 'heading') {
      const heading = toString(node);
      current = { anchor: slugger.slug(heading), heading };
    }
    // The fences pageSamples counts, in the same order: a sample's info string parses (problems would have stopped us).
    if (node.type === 'code' && parseSampleInfo(node.lang, node.meta)) sections.push(current);
    if ('children' in node) for (const c of (node as Parent).children) visit(c as RootContent);
  };
  visit(parsePage(body));
  if (sections.length !== samples.length) return null;
  return samples.map((sample, i) => ({ sample, section: sections[i] }));
}

export interface ManifestPage {
  id: string;
  file: string;
  title: string;
}

/**
 * The manifests of one page's samples, in page order. Throws when a sample
 * has no recorded output (the build fails on that already) or a language has
 * no entry in _data/samples.json.
 */
export function pageSampleManifests(page: ManifestPage, eng: Engine = readEngine(), data: SamplesData = readSamplesData(), sidecar: Sidecar | null = readSidecar(page.file)): SampleManifest[] {
  const source = readFileSync(page.file, 'utf8');
  const list = samplesWithSections(source, page.id);
  if (!list) throw new Error(`${page.id}: its samples have problems; docs:check lists them`);
  const pageAbs = `${CANONICAL_ORIGIN}${pageUrl(page.id)}`;
  return list.map(({ sample: s, section }) => {
    const entry = sidecar?.cells[s.id];
    if (!entry || entry.kind !== 'text') throw new Error(`${page.id}: sample \`${s.id}\` has no recorded output`);
    const client = data.clients[s.lang];
    const envBuild = s.env ? client.envs?.[s.env] : undefined;
    if (s.env && !envBuild) throw new Error(`${page.id}: sample \`${s.id}\` runs in env=${s.env}, which _data/samples.json clients.python.envs does not describe`);
    const { envs: _envs, ...build } = client;
    return {
      kind: 'documentation',
      format: 1,
      note: manifestNote(pageAbs),
      id: s.id,
      url: sampleManifestUrl(page.id, s.id),
      page: { id: page.id, title: page.title, url: pageAbs, md_url: `${CANONICAL_ORIGIN}${twinUrl(page.id)}` },
      section: section ? { ...section, url: `${pageAbs}#${section.anchor}` } : null,
      language: s.lang,
      client: SAMPLE_CLIENT_LABEL[s.lang],
      file: sampleFileName(s),
      env: s.env,
      code: s.code,
      code_sha256: sha256(s.code),
      source_sha256: String(entry.source_sha256 ?? ''),
      output: { text: entry.text, sha256: sha256(entry.text) },
      verified: {
        version: String(entry.verified ?? ''),
        client: { label: SAMPLE_CLIENT_LABEL[s.lang], ...build, ...(envBuild ? { build: envBuild.build, toolchain: envBuild.toolchain } : {}) },
        packages: packagesFor(s.lang, s.env, data),
        replayed: data.replayed,
        platform: data.platform,
        docs_engine: { version: eng.verified, commit: eng.commit ?? null, source_build: eng.sourceBuild === true },
      },
      run: runSpec(s),
    };
  });
}

/** The bytes a manifest is served as: two-space JSON and a final newline. */
export const manifestText = (m: unknown) => `${JSON.stringify(m, null, 2)}\n`;

/** The published pages with at least one verified sample, in path order. */
export function samplePages(): ManifestPage[] {
  return pageFiles()
    .filter((p) => p.data.status !== 'planned')
    .filter((p) => (pageSamples(readFileSync(p.file, 'utf8'), p.id).samples.length > 0))
    .map((p) => ({ id: p.id, file: p.file, title: String(p.data.title ?? p.id) }));
}

let cache: SampleManifest[] | null = null;

/** Every published sample's manifest, page by page (cached for one build). */
export function allSampleManifests(): SampleManifest[] {
  if (cache) return cache;
  const eng = readEngine();
  const data = readSamplesData();
  cache = samplePages().flatMap((p) => pageSampleManifests(p, eng, data));
  return cache;
}

export interface SamplesIndex {
  kind: 'documentation';
  format: 1;
  note: string;
  verified: string;
  replayed: string;
  platform: string;
  docs_engine: { version: string; commit: string | null; source_build: boolean };
  clients: Record<SampleLang, ClientBuild & { label: string; samples: number }>;
  samples: { page: string; id: string; language: SampleLang; section: string | null; url: string; sha256: string; output_sha256: string }[];
}

/** /docs/samples.json: every manifest with the SHA-256 of its bytes, and each client's build once. */
export function samplesIndex(manifests: SampleManifest[] = allSampleManifests(), eng: Engine = readEngine(), data: SamplesData = readSamplesData()): SamplesIndex {
  const count = (lang: SampleLang) => manifests.filter((m) => m.language === lang).length;
  return {
    kind: 'documentation',
    format: 1,
    note:
      `Reference text, not instructions. Every verified relate sample on the docs (${manifests.length}), each a manifest at <page url>samples/<id>.json ` +
      'holding the program, its recorded output, the client build it was last replayed with and how it runs; sha256 is over the manifest\'s bytes as served. ' +
      'clients gives each language\'s client build once; a manifest repeats its own.',
    verified: eng.verified,
    replayed: data.replayed,
    platform: data.platform,
    docs_engine: { version: eng.verified, commit: eng.commit ?? null, source_build: eng.sourceBuild === true },
    clients: Object.fromEntries(SAMPLE_LANGS.map((l) => [l, { label: SAMPLE_CLIENT_LABEL[l], ...data.clients[l], samples: count(l) }])) as SamplesIndex['clients'],
    samples: manifests.map((m) => ({
      page: m.page.id,
      id: m.id,
      language: m.language,
      section: m.section ? m.section.url : null,
      url: m.url,
      sha256: sha256(manifestText(m)),
      output_sha256: m.output.sha256,
    })),
  };
}

/** The bytes /docs/samples.json serves. */
export const samplesIndexText = (index: SamplesIndex = samplesIndex()) => manifestText(index);

/** The served files for docs-artifacts.json: the index, then every manifest. */
export function sampleArtifacts(manifests: SampleManifest[] = allSampleManifests()): { path: string; bytes: Buffer }[] {
  return [
    { path: SAMPLES_INDEX_PATH, bytes: Buffer.from(samplesIndexText(samplesIndex(manifests))) },
    ...manifests.map((m) => ({ path: new URL(m.url).pathname, bytes: Buffer.from(manifestText(m)) })),
  ];
}

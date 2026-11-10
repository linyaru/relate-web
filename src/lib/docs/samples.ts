// Verified language samples (DOCS-PLAN.md §6 "Language samples are verified
// from phase 1"): a ```python run, ```js run, ```rust run, ```java run,
// ```go run, ```swift run or ```c run fence on a docs page is a program that
// runs against a local build of the relate client for that language, and its
// standard output is recorded in the page's results sidecar, so the page and
// its twin show output that a real run produced, and drift fails a check.
//
// The authoring contract:
//
//   ```<lang> run [name=<id>] [title="<file>"]        <lang>: python js rust java go swift c
//   ```python run [name=<id>] [title="<file>"] [env=<name>]
//
//   - The sample's id is `name=<id>` (letters, digits, `-`, `_`), or
//     `<lang>-<n>` for the n-th sample of that language on the page (from 1)
//     when it has none. Ids share the sidecar with the page's Cypher cells,
//     so a name may not repeat a cell's id.
//   - Each sample is a whole program, run on its own (no state carries from
//     one sample to the next) in a fresh temporary directory that is its
//     working directory: a relative store path such as `./app.rl` lands
//     there and is deleted afterwards. `title="<file>"` names the file the
//     program is written to (the page shows the name above the block);
//     otherwise it is SAMPLE_FILES' default: `sample.py`; `sample.cjs` or,
//     when the JavaScript has an `import` or `export` statement,
//     `sample.mjs`; `main.rs`; `Main.java`; `main.go`; `main.swift`;
//     `sample.c`. The extension must be the language's (.py; .js .cjs .mjs;
//     .rs; .java; .go; .swift; .c).
//   - A compiled sample is built in a second temporary directory and the
//     program runs in the first, which starts empty:
//       rust   a binary crate with the one file as its root (`[[bin]] path`),
//              depending on the relate crate (`relate = { path = … }`), built
//              with cargo from the template RELATE_RUST_PROJECT holds (its
//              Cargo.lock, rust-toolchain.toml and target directory, so the
//              engine is compiled once); `cargo build --release --locked
//              --offline`: the program can use `relate` and the standard
//              library only
//       java   run as a single-file source program (`java <file>`, compiled
//              in memory) with RELATE_JAVA_CLASSPATH; the file name need not
//              match the class, and the first class declared holds `main`
//       go     a module `relatesample` that requires the client
//              (github.com/relatedb/relate/clients/go, imported as
//              `relate "github.com/relatedb/relate/clients/go"`) through a
//              replace directive; GOPROXY=off, so only the standard library
//              and the client import
//       swift  a package whose one executable target, `sample`, depends on
//              .product(name: "Relate", package: "relate") (import Relate);
//              top-level code goes in `main.swift`, another file name needs
//              `@main`
//       c      compiled with RELATE_CC against relate.h (#include "relate.h")
//              and linked with -lrelate_ffi
//     A build has 10 minutes (a cold cache compiles the engine), a run 60 s.
//   - `env=<name>` (Python only) runs the sample with RELATE_PY_<NAME>
//     instead of RELATE_PY: a second venv for a framework whose pins clash
//     with the main one (setup.sh builds `crewai`).
//   - A sample passes when it exits 0 within the timeout and prints at least
//     one line on standard output. Standard output is the recorded result
//     (line endings normalized to \n, trailing spaces and trailing blank lines
//     removed, the temporary directories' paths replaced by `.`); standard
//     error, and a compiled sample's build output, are shown only when it
//     fails. Print only what is the same on every run: no timings, ids or
//     absolute paths.
//
// The recorded result is a sidecar entry in the cells' format 1
// (results.ts), keyed by the sample's id, with kind "text":
//
//   "python-1": {"kind": "text", "text": "…", "table": null, "graph": null,
//                "expectError": false, "verified": "0.16.1",
//                "source_sha256": "…"}
//
// `verified` on the entry is the version of relate that produced it: for
// Python and Node.js the client package's version (relate-db,
// @relate/relate), and for Rust, Java, Go, Swift and C the engine version the
// client reports (`CALL dbms.components()`, component `Relate`), because those
// clients carry no release version of their own before launch (the Go module
// is v0.0.0 behind a replace directive, the Swift package has none, the Java
// pom's 0.1.0 is not bumped between releases). `source_sha256` is the SHA-256
// of the program that produced it (sampleSourceHash: language, `env`, title
// and code, line endings and trailing spaces normalized), so a sample edited
// after it was recorded fails docs:check and loses its language from the
// twin's `verified_by` until it is recorded again. The twin prints the fence
// as written, then a ```text block holding `text`.
//
// The runner needs the clients, which are built from the upstream checkout
// before launch (scripts/samples/setup.sh, whose header describes each
// variable) and installed from the published packages after:
//
//   python  RELATE_PY (a Python that can `import relate`, package relate-db),
//           RELATE_PY_<NAME> for `env=<name>`
//   js      RELATE_NODE, and NODE_PATH naming the node_modules directory
//           holding @relate/relate (linked into each sample's directory, so
//           `require` and `import` both resolve); RELATE_LIB the native
//           library when the client is not a published install
//   rust    RELATE_CARGO, RELATE_RUST_PROJECT
//   java    RELATE_JAVA, RELATE_JAVA_CLASSPATH, RELATE_LIB
//   go      RELATE_GO, RELATE_GO_CLIENT, RELATE_GO_HOME, RELATE_C_INCLUDE, RELATE_LIB
//   swift   RELATE_SWIFT, RELATE_SWIFT_PACKAGE
//   c       RELATE_CC, RELATE_C_INCLUDE, RELATE_LIB
//
// A language whose variables are missing is not run: docs:samples says so
// and skips it (fails with --require), and docs:check never needs a client.
//
// Node only, never imported by browser code.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';

import type { Code, Parent, Root, RootContent } from 'mdast';

import { splitFrontmatter } from './content.ts';
import { VERIFIERS, type Verifier } from './model.ts';
import { parsePage } from './parse.ts';
import { parseRunInfo, resultsFile } from './results.ts';

export type SampleLang = 'python' | 'js' | 'rust' | 'java' | 'go' | 'swift' | 'c';
/** Every sample language, in the order the runner and the docs list them. */
export const SAMPLE_LANGS: readonly SampleLang[] = ['python', 'js', 'rust', 'java', 'go', 'swift', 'c'];

/** A `verified_by` name for a sample language's client (model.ts VERIFIERS lists the ones the twin prints). */
export type SampleVerifier = 'python' | 'node' | 'rust' | 'java' | 'go' | 'swift' | 'c';

/** The client each sample language runs against, as `verified_by` names it. */
export const SAMPLE_VERIFIER: Record<SampleLang, SampleVerifier> = {
  python: 'python',
  js: 'node',
  rust: 'rust',
  java: 'java',
  go: 'go',
  swift: 'swift',
  c: 'c',
};

/** The highlighter language of each sample language's code block. */
export const SAMPLE_HIGHLIGHT: Record<SampleLang, string> = {
  python: 'python',
  js: 'javascript',
  rust: 'rust',
  java: 'java',
  go: 'go',
  swift: 'swift',
  c: 'c',
};

/** Each sample language's client, as a page or a capability names it. */
export const SAMPLE_CLIENT_LABEL: Record<SampleLang, string> = {
  python: 'Python',
  js: 'Node.js',
  rust: 'Rust',
  java: 'Java',
  go: 'Go',
  swift: 'Swift',
  c: 'C',
};

/** Each language's file extensions (the first is the default's) and default file name. */
export const SAMPLE_FILES: Record<SampleLang, { extensions: readonly string[]; file: string }> = {
  python: { extensions: ['.py'], file: 'sample.py' },
  js: { extensions: ['.js', '.cjs', '.mjs'], file: 'sample.cjs' },
  rust: { extensions: ['.rs'], file: 'main.rs' },
  java: { extensions: ['.java'], file: 'Main.java' },
  go: { extensions: ['.go'], file: 'main.go' },
  swift: { extensions: ['.swift'], file: 'main.swift' },
  c: { extensions: ['.c'], file: 'sample.c' },
};

/** Per-language counters for `<lang>-<n>` ids, all zero (a renderer's starting state). */
export const emptySampleSeq = (): Record<SampleLang, number> =>
  Object.fromEntries(SAMPLE_LANGS.map((l) => [l, 0])) as Record<SampleLang, number>;

const isSampleLang = (lang: string | null | undefined): lang is SampleLang => !!lang && (SAMPLE_LANGS as readonly string[]).includes(lang);

/** The command that sets the clients up, quoted in every "not set up" message. */
export const SETUP_COMMAND = 'bash scripts/samples/setup.sh --upstream <path to the relate checkout>';
export const RECORD_COMMAND = 'npm run docs:samples -- --record';

export interface SampleInfo {
  lang: SampleLang;
  name: string | null;
  title: string | null;
  /** `env=<name>` (Python only): the sample runs with RELATE_PY_<NAME>. */
  env: string | null;
}

/**
 * The info string of a verified sample: `<lang> run` for a sample language,
 * with an optional `name=<id>` and `title="<file>"` (and, for Python,
 * `env=<name>`). Null for any other fence; throws on a malformed sample info
 * string.
 */
export function parseSampleInfo(lang: string | null | undefined, meta: string | null | undefined): SampleInfo | null {
  if (!isSampleLang(lang)) return null;
  const words = [...(meta ?? '').matchAll(/(\w+)=("[^"]*"|\S+)|(\S+)/g)];
  if (words[0]?.[3] !== 'run') return null;
  let name: string | null = null;
  let title: string | null = null;
  let env: string | null = null;
  for (const w of words.slice(1)) {
    const [raw, key, value] = w;
    if (key === 'name' && /^[A-Za-z0-9_-]+$/.test(value)) name = value;
    else if (key === 'title' && /^"[A-Za-z0-9_.-]+"$/.test(value)) title = value.slice(1, -1);
    else if (key === 'env' && lang === 'python' && /^[a-z][a-z0-9_]*$/.test(value)) env = value;
    else {
      const allowed = lang === 'python' ? ', `title="<file>"` (a bare file name) and `env=<name>` (lowercase letters, digits and _)' : ' and `title="<file>"` (a bare file name)';
      throw new Error(`\`${lang} run\` takes only \`name=<id>\` (letters, digits, - and _)${allowed}, not \`${raw}\``);
    }
  }
  if (title !== null) {
    const exts = SAMPLE_FILES[lang].extensions;
    if (!exts.some((e) => title!.endsWith(e) && title!.length > e.length)) {
      throw new Error(`\`${lang} run\` title "${title}" needs the extension ${exts.length > 1 ? `${exts.slice(0, -1).join(', ')} or ${exts.at(-1)}` : exts[0]}`);
    }
  }
  return { lang, name, title, env };
}

export interface Sample extends SampleInfo {
  id: string;
  code: string;
  /** The fence's line in the page (1-based, counted in the whole file). */
  line: number | null;
}

/** What of a sample identifies its program (sampleSourceHash) and its file. */
export type SampleSource = Pick<Sample, 'lang' | 'title' | 'code'> & { env?: string | null };

/** The file a sample is written to in its directory. */
export function sampleFileName(s: Pick<Sample, 'lang' | 'title' | 'code'>): string {
  if (s.title) return s.title;
  if (s.lang === 'js') return /^\s*(?:import\s*[\w{*'"]|export\s)/m.test(s.code) ? 'sample.mjs' : 'sample.cjs';
  return SAMPLE_FILES[s.lang].file;
}

function codeNodes(tree: Root): Code[] {
  const out: Code[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === 'code') out.push(node);
    if ('children' in node) for (const c of (node as Parent).children) visit(c);
  };
  visit(tree);
  return out;
}

/**
 * The verified samples on a page, in page order, from its whole source
 * (frontmatter included, so line numbers match the file), with any
 * problem in their info strings or ids.
 */
export function pageSamples(source: string, where = 'page'): { samples: Sample[]; problems: string[] } {
  const { body } = splitFrontmatter(source, where);
  const offset = source.slice(0, source.length - body.length).split('\n').length - 1;
  const samples: Sample[] = [];
  const problems: string[] = [];
  const cellIds = new Set<string>();
  const seq = emptySampleSeq();
  let cellSeq = 0;
  const seen = new Set<string>();
  for (const node of codeNodes(parsePage(body))) {
    const line = node.position ? node.position.start.line + offset : null;
    try {
      const run = parseRunInfo(node.lang, node.meta);
      if (run) cellIds.add(run.name ?? `cell-${++cellSeq}`);
    } catch {
      // A malformed Cypher cell is docs:check's to report.
    }
    let info: SampleInfo | null;
    try {
      info = parseSampleInfo(node.lang, node.meta);
    } catch (e) {
      problems.push(`line ${line}: ${(e as Error).message}`);
      continue;
    }
    if (!info) continue;
    const id = info.name ?? `${info.lang}-${++seq[info.lang]}`;
    if (info.name) seq[info.lang]++;
    if (seen.has(id)) problems.push(`line ${line}: sample id \`${id}\` is used twice on the page`);
    seen.add(id);
    samples.push({ ...info, id, code: node.value, line });
  }
  for (const s of samples) {
    if (cellIds.has(s.id)) problems.push(`line ${s.line}: sample id \`${s.id}\` is also a Cypher cell's id; name one of them`);
  }
  return { samples, problems };
}

/**
 * The id of the n-th sample of its language (1-based) on a page, for a
 * renderer that walks fences in order: its name, or `<lang>-<n>`.
 */
export const sampleId = (info: Pick<SampleInfo, 'lang' | 'name'>, n: number) => info.name ?? `${info.lang}-${n}`;

// ---------------------------------------------------------------------------
// The sidecar

export interface SidecarEntry {
  kind: string;
  text: string;
  table?: unknown;
  graph?: unknown;
  expectError?: boolean;
  /** On a sample's entry: the client version that recorded it. */
  verified?: string;
  /** On a sample's entry: sampleSourceHash of the program that recorded it. */
  source_sha256?: string;
  [key: string]: unknown;
}

export interface Sidecar {
  format: 1;
  verified?: string;
  cells: Record<string, SidecarEntry>;
  [key: string]: unknown;
}

/**
 * The fingerprint of a sample's program: SHA-256 (hex) of its language (with
 * ` env=<name>` when it has one), its title and its code (line endings as \n,
 * trailing spaces and trailing blank lines removed), one per line.
 */
export function sampleSourceHash(s: SampleSource): string {
  const code = s.code
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
  const lang = s.env ? `${s.lang} env=${s.env}` : s.lang;
  return createHash('sha256').update(`${lang}\n${s.title ?? ''}\n${code}`, 'utf8').digest('hex');
}

/** A sample's entry: what the twin prints, in the cells' format with kind "text". */
export const sampleEntry = (text: string, verified: string, sourceSha256: string): SidecarEntry => ({
  kind: 'text',
  text,
  table: null,
  graph: null,
  expectError: false,
  verified,
  source_sha256: sourceSha256,
});

/** Whether a sample's recorded entry was made from the program as it now reads. */
export const recordedFromSource = (entry: SidecarEntry | undefined, s: SampleSource) =>
  !!entry && entry.source_sha256 === sampleSourceHash(s);

/**
 * The sidecar beside the page at `file`, as written (every entry kept,
 * whatever its kind); null when there is none. Throws on a malformed one.
 */
export function readSidecar(file: string): Sidecar | null {
  const path = resultsFile(file);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}`);
  }
  const r = data as Partial<Sidecar>;
  if (r?.format !== 1 || typeof r.cells !== 'object' || r.cells === null || Array.isArray(r.cells)) {
    throw new Error(`${path} is not a format 1 results file ({"format": 1, "cells": {…}})`);
  }
  for (const [id, cell] of Object.entries(r.cells)) {
    if (typeof cell?.kind !== 'string' || typeof cell.text !== 'string') throw new Error(`${path}: entry \`${id}\` needs "kind" and "text"`);
  }
  return r as Sidecar;
}

/**
 * The sidecar with the samples' entries replaced by `recorded` (id → entry):
 * every Cypher cell's entry is kept as it was, in place; a recorded sample
 * keeps its position or is appended; a "text" entry that is no longer a
 * sample on the page is dropped. A new sidecar takes `verified` from the
 * engine, and so does a sidecar that holds samples only: no cell recording
 * (docs:record's) stays behind to keep the older version.
 */
export function mergeSamples(sidecar: Sidecar | null, recorded: Map<string, SidecarEntry>, engineVersion: string): Sidecar {
  const base: Sidecar = sidecar ?? { format: 1, verified: engineVersion, cells: {} };
  const cells: Record<string, SidecarEntry> = {};
  for (const [id, entry] of Object.entries(base.cells)) {
    if (recorded.has(id)) cells[id] = recorded.get(id)!;
    else if (entry.kind !== 'text') cells[id] = entry;
  }
  for (const [id, entry] of recorded) if (!(id in cells)) cells[id] = entry;
  const samplesOnly = Object.values(cells).every((c) => c.kind === 'text');
  return { ...base, verified: samplesOnly ? engineVersion : base.verified, cells };
}

/** The sidecar as the recorders write it: two-space JSON and a final newline. */
export const formatSidecar = (s: Sidecar) => `${JSON.stringify(s, null, 2)}\n`;

export function writeSidecar(file: string, s: Sidecar) {
  writeFileSync(resultsFile(file), formatSidecar(s));
}

/**
 * The clients `verified_by` can name for a page, from its source and sidecar:
 * a language's client (SAMPLE_VERIFIER: `python`, `node`, `rust`, …) when the
 * page has a sample in that language and every one of them has an entry
 * recorded at `version` from the code as it now reads (`source_sha256`).
 * Only the names model.ts VERIFIERS lists are returned, in its order.
 */
export function sampleVerifiers(source: string, sidecar: Sidecar | null, version: string): Verifier[] {
  const { samples, problems } = pageSamples(source);
  if (problems.length) return [];
  const out = new Set<string>();
  for (const lang of SAMPLE_LANGS) {
    const mine = samples.filter((s) => s.lang === lang);
    const ok =
      mine.length > 0 &&
      mine.every((s) => sidecar?.cells[s.id]?.kind === 'text' && sidecar.cells[s.id].verified === version && recordedFromSource(sidecar.cells[s.id], s));
    if (ok) out.add(SAMPLE_VERIFIER[lang]);
  }
  return VERIFIERS.filter((v) => out.has(v));
}

// ---------------------------------------------------------------------------
// Running

export interface RustClient {
  cargo: string;
  /** The template project: Cargo.toml, Cargo.lock, rust-toolchain.toml, target/. */
  project: string;
}
export interface CClient {
  cc: string;
  include: string;
  lib: string;
}
export interface JavaClient {
  java: string;
  classpath: string;
  lib: string;
}
export interface GoClient {
  go: string;
  /** clients/go, the replace directive's target. */
  client: string;
  /** GOPATH, GOMODCACHE and GOCACHE live under it. */
  home: string;
  include: string;
  lib: string;
}
export interface SwiftClient {
  swift: string;
  /** The package a sample depends on (its directory is named `relate`). */
  package: string;
}

export interface ClientEnv {
  python: string | null;
  /** `env=<name>` → RELATE_PY_<NAME>, for every such variable that names an existing file. */
  pythonEnvs: Record<string, string>;
  node: string | null;
  /** The first NODE_PATH entry: the node_modules directory holding @relate/relate. */
  nodeModules: string | null;
  rust: RustClient | null;
  java: JavaClient | null;
  go: GoClient | null;
  swift: SwiftClient | null;
  c: CClient | null;
  /** Why each language cannot run, when it cannot. */
  missing: Partial<Record<SampleLang, string>>;
}

/** The clients the environment provides (the variables in this file's header). */
export function clientEnv(env: NodeJS.ProcessEnv = process.env): ClientEnv {
  const missing: Partial<Record<SampleLang, string>> = {};
  /** The variables' values, or the first problem with them. */
  const need = (names: string[], dirs: string[] = []): Record<string, string> | string => {
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = env[n];
      if (!v) return `${n} is not set`;
      if (!existsSync(v)) return `${n} (${v}) does not exist`;
      out[n] = v;
    }
    for (const n of dirs) {
      const v = env[n];
      if (!v) return `${n} is not set`;
      out[n] = v;
    }
    return out;
  };
  type Missing = { missing: string };
  const no = (missing: string): Missing => ({ missing });
  const isMissing = (x: unknown): x is Missing => typeof x === 'object' && x !== null && 'missing' in x;
  const set = <T>(lang: SampleLang, got: Record<string, string> | string, make: (v: Record<string, string>) => T | Missing): T | null => {
    if (typeof got === 'string') {
      missing[lang] = got;
      return null;
    }
    const made = make(got);
    if (isMissing(made)) {
      missing[lang] = made.missing;
      return null;
    }
    return made;
  };

  const python = set('python', need(['RELATE_PY']), (v) => v.RELATE_PY);
  const pythonEnvs: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    const m = /^RELATE_PY_([A-Z][A-Z0-9_]*)$/.exec(k);
    if (m && v && existsSync(v)) pythonEnvs[m[1].toLowerCase()] = v;
  }

  let nodeModules: string | null = null;
  const node = set('js', need(['RELATE_NODE']), (v) => {
    nodeModules = (env.NODE_PATH ?? '').split(delimiter).find(Boolean) ?? null;
    if (!nodeModules) return no('NODE_PATH is not set (the node_modules directory holding @relate/relate)');
    if (!existsSync(join(nodeModules, '@relate', 'relate', 'package.json'))) return no(`NODE_PATH (${nodeModules}) holds no @relate/relate`);
    return v.RELATE_NODE;
  });
  if (!node) nodeModules = null;

  const rust = set('rust', need(['RELATE_CARGO', 'RELATE_RUST_PROJECT']), (v): RustClient | Missing => {
    for (const f of ['Cargo.toml', 'Cargo.lock']) {
      if (!existsSync(join(v.RELATE_RUST_PROJECT, f))) return no(`RELATE_RUST_PROJECT (${v.RELATE_RUST_PROJECT}) holds no ${f}`);
    }
    return { cargo: v.RELATE_CARGO, project: v.RELATE_RUST_PROJECT };
  });
  const java = set('java', need(['RELATE_JAVA', 'RELATE_LIB'], ['RELATE_JAVA_CLASSPATH']), (v): JavaClient | Missing => {
    const absent = v.RELATE_JAVA_CLASSPATH.split(delimiter).filter((p) => p && !existsSync(p));
    if (absent.length) return no(`RELATE_JAVA_CLASSPATH names ${absent[0]}, which does not exist`);
    return { java: v.RELATE_JAVA, classpath: v.RELATE_JAVA_CLASSPATH, lib: v.RELATE_LIB };
  });
  const go = set('go', need(['RELATE_GO', 'RELATE_GO_CLIENT', 'RELATE_GO_HOME', 'RELATE_C_INCLUDE', 'RELATE_LIB']), (v): GoClient | Missing => {
    if (!existsSync(join(v.RELATE_GO_CLIENT, 'go.mod'))) return no(`RELATE_GO_CLIENT (${v.RELATE_GO_CLIENT}) holds no go.mod`);
    return { go: v.RELATE_GO, client: v.RELATE_GO_CLIENT, home: v.RELATE_GO_HOME, include: v.RELATE_C_INCLUDE, lib: v.RELATE_LIB };
  });
  const swift = set('swift', need(['RELATE_SWIFT', 'RELATE_SWIFT_PACKAGE']), (v): SwiftClient | Missing => {
    if (!existsSync(join(v.RELATE_SWIFT_PACKAGE, 'Package.swift'))) return no(`RELATE_SWIFT_PACKAGE (${v.RELATE_SWIFT_PACKAGE}) holds no Package.swift`);
    return { swift: v.RELATE_SWIFT, package: v.RELATE_SWIFT_PACKAGE };
  });
  const c = set('c', need(['RELATE_CC', 'RELATE_C_INCLUDE', 'RELATE_LIB']), (v): CClient | Missing => {
    if (!existsSync(join(v.RELATE_C_INCLUDE, 'relate.h'))) return no(`RELATE_C_INCLUDE (${v.RELATE_C_INCLUDE}) holds no relate.h`);
    return { cc: v.RELATE_CC, include: v.RELATE_C_INCLUDE, lib: v.RELATE_LIB };
  });
  return { python, pythonEnvs, node, nodeModules, rust, java, go, swift, c, missing };
}

/** The variable a Python `env=<name>` sample runs with. */
export const pythonEnvVar = (name: string) => `RELATE_PY_${name.toUpperCase()}`;

/**
 * Why `sample` cannot run with the clients in `env`, or null when it can:
 * its language is not set up, or (Python) its `env=<name>` venv is not.
 */
export function sampleUnavailable(sample: Pick<SampleSource, 'lang' | 'env'>, env: ClientEnv): string | null {
  if (env.missing[sample.lang]) return env.missing[sample.lang]!;
  if (sample.lang === 'python' && sample.env && !env.pythonEnvs[sample.env]) {
    return `${pythonEnvVar(sample.env)} is not set or does not exist (the env=${sample.env} venv scripts/samples/setup.sh builds)`;
  }
  return null;
}

/** One line naming a language's client, for logs. */
export function describeClient(lang: SampleLang, env: ClientEnv): string {
  switch (lang) {
    case 'python':
      return [env.python, ...Object.entries(env.pythonEnvs).map(([k, v]) => `env=${k}: ${v}`)].filter(Boolean).join('; ');
    case 'js':
      return `${env.node}, ${env.nodeModules}`;
    case 'rust':
      return `${env.rust?.project} (cargo ${env.rust?.cargo})`;
    case 'java': {
      const jar = env.java?.classpath.split(delimiter)[0] ?? '';
      return `${env.java?.java}, ${basename(jar)}, ${env.java?.lib}`;
    }
    case 'go':
      return `${env.go?.go}, ${env.go?.client}, ${env.go?.lib}`;
    case 'swift':
      return `${env.swift?.swift}, ${env.swift?.package}`;
    case 'c':
      return `${env.c?.cc}, ${env.c?.include}/relate.h, ${env.c?.lib}`;
  }
}

/** What a run printed, normalized for the record. */
export function normalizeOutput(stdout: string, dirs: string[]): string {
  let out = stdout.replace(/\r\n?/g, '\n');
  for (const d of dirs.filter(Boolean).sort((a, b) => b.length - a.length)) out = out.split(d).join('.');
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

export interface RunResult {
  ok: boolean;
  /** The normalized standard output (the record). */
  text: string;
  /** Why it failed, with standard error, when it did. */
  error: string | null;
}

export interface RunOptions {
  /** The program's run (default 60 s). */
  timeoutMs?: number;
  /** A compiled sample's build (default 10 min: a cold cache compiles the engine). */
  buildTimeoutMs?: number;
  baseEnv?: NodeJS.ProcessEnv;
}

const tail = (s: string, n = 20) => s.trimEnd().split('\n').slice(-n).join('\n');

/** A process to start: the build steps of a compiled sample, then its run. */
interface Spawn {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  build: boolean;
  /** Runs after the step succeeds (a build's output copied beside it). */
  then?: () => void;
}

const rustManifest = (template: string, file: string) => {
  const out = template.replace(/^path = "[^"]*"$/m, `path = ${JSON.stringify(file)}`);
  if (out === template && !template.includes(`path = ${JSON.stringify(file)}`)) throw new Error('the template Cargo.toml has no [[bin]] `path = "…"` line');
  return out;
};

/** The go.mod a Go sample is built in: module `relatesample`, the client replaced by `client` (RELATE_GO_CLIENT). */
export const goModule = (client: string) =>
  `module relatesample\n\ngo 1.22\n\nrequire github.com/relatedb/relate/clients/go v0.0.0\n\nreplace github.com/relatedb/relate/clients/go => ${client}\n`;

/** The Package.swift a Swift sample is built in, depending on the package at `pkg` (RELATE_SWIFT_PACKAGE). */
export const swiftManifest = (pkg: string) => `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "sample",
    platforms: [.macOS(.v13)],
    dependencies: [.package(path: ${JSON.stringify(pkg)})],
    targets: [
        .executableTarget(
            name: "sample",
            dependencies: [.product(name: "Relate", package: "relate")],
            path: "Sources/sample"
        ),
    ],
    swiftLanguageModes: [.v6]
)
`;

/**
 * The steps that run `sample`, its file written: into `runDir` for an
 * interpreted language, into `buildDir` for a compiled one.
 */
function plan(sample: SampleSource, env: ClientEnv, runDir: string, buildDir: string, base: NodeJS.ProcessEnv): Spawn[] {
  const file = sampleFileName(sample);
  const code = sample.code.endsWith('\n') ? sample.code : `${sample.code}\n`;
  const childEnv: NodeJS.ProcessEnv = { ...base, DO_NOT_TRACK: '1' };
  const run = (cmd: string, args: string[], extra: NodeJS.ProcessEnv = {}): Spawn => ({ cmd, args, cwd: runDir, env: { ...childEnv, ...extra }, build: false });
  switch (sample.lang) {
    case 'python': {
      writeFileSync(join(runDir, file), code);
      const interpreter = sample.env ? env.pythonEnvs[sample.env] : env.python!;
      return [run(interpreter, [file], { PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' })];
    }
    case 'js': {
      writeFileSync(join(runDir, file), code);
      // ESM ignores NODE_PATH, so the client is linked where both resolvers look.
      symlinkSync(env.nodeModules!, join(runDir, 'node_modules'), 'dir');
      const step = run(env.node!, [file]);
      delete step.env.NODE_OPTIONS;
      return [step];
    }
    case 'rust': {
      const { cargo, project } = env.rust!;
      writeFileSync(join(buildDir, file), code);
      writeFileSync(join(buildDir, 'Cargo.toml'), rustManifest(readFileSync(join(project, 'Cargo.toml'), 'utf8'), file));
      copyFileSync(join(project, 'Cargo.lock'), join(buildDir, 'Cargo.lock'));
      if (existsSync(join(project, 'rust-toolchain.toml'))) copyFileSync(join(project, 'rust-toolchain.toml'), join(buildDir, 'rust-toolchain.toml'));
      const exe = join(buildDir, 'relate-sample');
      return [
        {
          cmd: cargo,
          args: ['build', '--release', '--locked', '--offline', '--quiet'],
          cwd: buildDir,
          env: { ...childEnv, CARGO_TARGET_DIR: join(project, 'target'), CARGO_TERM_COLOR: 'never' },
          build: true,
          // Copied out of the shared target directory before it runs, so a concurrent build cannot replace it.
          then: () => copyFileSync(join(project, 'target', 'release', 'relate-sample'), exe),
        },
        run(exe, []),
      ];
    }
    case 'java': {
      const { java, classpath, lib } = env.java!;
      writeFileSync(join(buildDir, file), code);
      // JNA unpacks its stub into jna.tmpdir, and the client its library into relate.native.cache
      // when RELATE_LIB is unset: both into the build directory, never a user cache.
      return [
        run(java, [`-Djna.tmpdir=${buildDir}`, `-Drelate.native.cache=${join(buildDir, 'native')}`, '-cp', classpath, join(buildDir, file)], {
          RELATE_LIB: lib,
          JAVA_TOOL_OPTIONS: undefined,
          JDK_JAVA_OPTIONS: undefined,
        }),
      ];
    }
    case 'go': {
      const g = env.go!;
      writeFileSync(join(buildDir, file), code);
      writeFileSync(join(buildDir, 'go.mod'), goModule(g.client));
      const libDir = dirname(g.lib);
      const exe = join(buildDir, 'sample');
      return [
        {
          cmd: g.go,
          args: ['build', '-o', exe, '.'],
          cwd: buildDir,
          env: {
            ...childEnv,
            GOPATH: join(g.home, 'path'),
            GOMODCACHE: join(g.home, 'mod'),
            GOCACHE: join(g.home, 'cache'),
            GOFLAGS: '-mod=mod',
            GOTOOLCHAIN: 'local',
            GOPROXY: 'off',
            GOWORK: 'off',
            CGO_ENABLED: '1',
            CGO_CFLAGS: `-I${g.include}`,
            CGO_LDFLAGS: `-L${libDir} -lrelate_ffi -Wl,-rpath,${libDir}`,
          },
          build: true,
        },
        run(exe, []),
      ];
    }
    case 'swift': {
      const { swift, package: pkg } = env.swift!;
      mkdirSync(join(buildDir, 'Sources', 'sample'), { recursive: true });
      writeFileSync(join(buildDir, 'Sources', 'sample', file), code);
      writeFileSync(join(buildDir, 'Package.swift'), swiftManifest(pkg));
      // One build directory beside the package, shared by every sample, so the client compiles once.
      const scratch = join(dirname(pkg), 'scratch');
      const exe = join(buildDir, 'sample-bin');
      return [
        {
          cmd: swift,
          args: ['build', '-c', 'debug', '--package-path', buildDir, '--scratch-path', scratch, '--product', 'sample', '--quiet'],
          cwd: buildDir,
          // The checkout's Package.swift links the local XCFramework under this switch.
          env: { ...childEnv, RELATE_LOCAL_XCFRAMEWORK: '1' },
          build: true,
          then: () => copyFileSync(join(scratch, 'debug', 'sample'), exe),
        },
        run(exe, []),
      ];
    }
    case 'c': {
      const { cc, include, lib } = env.c!;
      writeFileSync(join(buildDir, file), code);
      const libDir = dirname(lib);
      const exe = join(buildDir, 'sample');
      return [
        { cmd: cc, args: [`-I${include}`, file, `-L${libDir}`, '-lrelate_ffi', `-Wl,-rpath,${libDir}`, '-o', exe], cwd: buildDir, env: childEnv, build: true },
        run(exe, []),
      ];
    }
  }
}

/** Runs one sample in a fresh temporary directory against the clients in `env`. */
export function runSample(sample: SampleSource, env: ClientEnv, opts: RunOptions = {}): RunResult {
  const why = sampleUnavailable(sample, env);
  if (why) return { ok: false, text: '', error: why };
  const runDir = mkdtempSync(join(tmpdir(), 'relate-sample-'));
  const buildDir = mkdtempSync(join(tmpdir(), 'relate-build-'));
  const dirs = [runDir, buildDir];
  for (const d of [runDir, buildDir]) {
    try {
      dirs.push(realpathSync(d));
    } catch {
      // The directory is ours; realpath only fails if it is gone.
    }
  }
  try {
    let steps: Spawn[];
    try {
      steps = plan(sample, env, runDir, buildDir, opts.baseEnv ?? process.env);
    } catch (e) {
      return { ok: false, text: '', error: `could not prepare the sample: ${(e as Error).message}` };
    }
    for (const step of steps) {
      const timeout = step.build ? (opts.buildTimeoutMs ?? 600_000) : (opts.timeoutMs ?? 60_000);
      const env = Object.fromEntries(Object.entries(step.env).filter(([, v]) => v !== undefined));
      const res = spawnSync(step.cmd, step.args, { cwd: step.cwd, env, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 });
      const text = normalizeOutput(res.stdout ?? '', dirs);
      const stderr = normalizeOutput(res.stderr ?? '', dirs);
      if (res.error) {
        const timedOut = (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
        const what = step.build ? 'build' : 'run';
        return { ok: false, text: step.build ? '' : text, error: timedOut ? `${what} did not finish within ${timeout / 1000} s` : `could not start ${step.cmd}: ${res.error.message}` };
      }
      if (step.build) {
        if (res.status !== 0) {
          // Compilers print to either stream (SwiftPM to standard output).
          const output = [text, stderr].filter(Boolean).join('\n');
          return { ok: false, text: '', error: `did not build: ${basename(step.cmd)} exited with ${res.status ?? res.signal}${output ? `; its output:\n${tail(output, 30)}` : ''}` };
        }
        try {
          step.then?.();
        } catch (e) {
          return { ok: false, text: '', error: `built, but ${(e as Error).message}` };
        }
        continue;
      }
      if (res.status !== 0) {
        return { ok: false, text, error: `exited with ${res.status ?? res.signal}${stderr ? `; standard error:\n${tail(stderr)}` : ''}` };
      }
      if (!text) return { ok: false, text, error: `printed nothing on standard output; a verified sample prints what it checked${stderr ? `; standard error:\n${tail(stderr)}` : ''}` };
      return { ok: true, text, error: null };
    }
    return { ok: false, text: '', error: 'no run step' };
  } finally {
    rmSync(runDir, { recursive: true, force: true });
    rmSync(buildDir, { recursive: true, force: true });
  }
}

/** The statement the compiled clients' probes run: the engine's version. */
const VERSION_QUERY = "CALL dbms.components() YIELD name, versions WHERE name = 'Relate' RETURN versions[0] AS v";

/** Programs that print the version clientVersion records, per language. */
export const VERSION_PROBES: Record<SampleLang, string> = {
  python: "import importlib.metadata as m\nprint(m.version('relate-db'))",
  js: "console.log(require('@relate/relate/package.json').version)",
  rust: `fn main() {
    let db = relate::Database::open(":memory:").expect("open");
    let mut conn = db.connect().expect("connect");
    let result = conn.query(${JSON.stringify(VERSION_QUERY)}).expect("query");
    println!("{}", result.rows[0][0].as_string().expect("a string"));
}`,
  java: `import com.relate.Database;

public class Main {
    public static void main(String[] args) {
        try (var db = Database.open(":memory:"); var conn = db.connect()) {
            System.out.println(conn.query(${JSON.stringify(VERSION_QUERY)}).rows().get(0).get(0));
        }
    }
}`,
  go: `package main

import (
	"fmt"

	relate "github.com/relatedb/relate/clients/go"
)

func main() {
	db, err := relate.Open(":memory:")
	if err != nil {
		panic(err)
	}
	defer db.Close()
	conn, err := db.Connect()
	if err != nil {
		panic(err)
	}
	defer conn.Close()
	res, err := conn.Query(${JSON.stringify(VERSION_QUERY)})
	if err != nil {
		panic(err)
	}
	fmt.Println(res.Rows[0][0])
}`,
  swift: `import Relate

let db = try Database.inMemory()
let conn = try db.connect()
let result = try conn.query(${JSON.stringify(VERSION_QUERY)})
print(result.rows[0][0].stringValue!)`,
  c: `#include <stdio.h>
#include "relate.h"

int main(void) {
    relate_database db = NULL;
    relate_connection conn = NULL;
    relate_query_result r = NULL;
    char *err = NULL;
    if (relate_database_open(":memory:", &db, &err) != RELATE_OK ||
        relate_connect_namespace(db, NULL, &conn, &err) != RELATE_OK ||
        relate_query_params(conn, ${JSON.stringify(VERSION_QUERY)}, NULL, &r, &err) != RELATE_OK) {
        fprintf(stderr, "%s\\n", err ? err : "failed");
        return 1;
    }
    if (relate_result_is_error(r)) {
        fprintf(stderr, "%s\\n", relate_result_error_json(r));
        return 1;
    }
    size_t len = 0;
    const char *v = relate_value_string(relate_value_at(r, 0, 0), &len);
    if (!v) return 1;
    printf("%.*s\\n", (int)len, v);
    relate_destroy_result(r);
    relate_disconnect(conn);
    relate_database_close(db);
    return 0;
}`,
};

/**
 * The version a language's client records in `verified` (this file's header),
 * or null with the reason: the package version for Python (of the `env=<name>`
 * venv when given) and Node.js, the engine version the client reports for the
 * others.
 */
export function clientVersion(lang: SampleLang, env: ClientEnv, pyEnv: string | null = null): { version: string | null; error: string | null } {
  const r = runSample({ lang, title: null, code: VERSION_PROBES[lang], env: lang === 'python' ? pyEnv : null }, env, { timeoutMs: 60_000 });
  return r.ok ? { version: r.text.trim(), error: null } : { version: null, error: r.error };
}

/** A short line-by-line diff of a recorded and an actual output. */
export function outputDiff(recorded: string, actual: string): string {
  const a = recorded.split('\n');
  const b = actual.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
    if (out.length >= 24) {
      out.push('…');
      break;
    }
  }
  return out.join('\n');
}

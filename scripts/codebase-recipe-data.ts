#!/usr/bin/env node
// Writes the data blocks of the cookbook recipe `codebase-context-graph`
// (src/content/cookbook/codebase-context-graph.md) from a checkout of the
// relate repository: its workspace crates, its README, and its architecture
// decision records (docs/adr/). Runs on Node directly; needs no network.
//
//   node scripts/codebase-recipe-data.ts [--src ../relate]            rewrite the blocks
//   node scripts/codebase-recipe-data.ts [--src ../relate] --check    exit 1 when they differ
//
// What goes in:
//   crates   every workspace member with a Cargo.toml: name, description,
//            normalized terms; its dependencies on other members (normal,
//            dev, build; target-specific tables count as their kind); the
//            ADRs its Cargo.toml comments cite
//   docs     the README and every ADR: path, title, number, status, date,
//            normalized title terms, and the ADRs its text cites;
//            supersessions from the status line ("Superseded [in part] by
//            ADR-n") and from an `Amends: ADR-n` line (a partial one)
//   chunks   one row per section (## and ### headings; a section over 1800
//            characters splits on paragraphs) of the README and of the
//            SECTIONED ADRs: the ones the recipe's questions are about
//            (PINNED), then the most-cited others, until MAX_SECTIONED.
//            Each row holds a 160-character excerpt, the section's distinct
//            normalized terms, the crates it names and the ADRs it cites.
//
// The normalizer (terms()) lowercases, drops stopwords and stems crudely;
// the recipe's questions are normalized by the same function, so their
// `terms` in the recipe must be re-derived if it changes.
//
// After a rewrite, record the recipe and review the diff:
// COOKBOOK_ONLY=codebase-context-graph npm run cookbook:record

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { COOKBOOK_DIR } from '../src/lib/cookbook/load.ts';

export const RECIPE_FILE = join(COOKBOOK_DIR, 'codebase-context-graph.md');

/** ADRs whose sections always go in: the four questions start from or end at these. */
export const PINNED = ['0004', '0007', '0012', '0014', '0051', '0065', '0084'];
/** How many ADRs carry their sections, pinned ones included. */
export const MAX_SECTIONED = 48;
const MAX_CHUNK = 1800;
const EXCERPT = 160;
const ADR_REF = /ADR-(\d{4})/g;

// ---------------------------------------------------------------------------
// Normalizer

const STOPWORDS = new Set(
  `a about above after again all also an and any are as at be because been before being
below between both but by can could did do does doing down during each few for from
further had has have having here how i if in into is it its itself just more most
no nor not now of off on once only or other our out over own same should so some
such than that the their them then there these they this those through to too under
until up very was we were what when where which while who whom why will with would
you your relate cypherlite adr use used uses using via per one two new`.split(/\s+/),
);
const IRREGULAR: Record<string, string> = { withdrawn: 'withdraw', withdrawal: 'withdraw', built: 'build' };
const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ies', 'ers', 'er', 'ed', 'es', 's', 'ly'];

export function stem(word: string): string {
  if (word in IRREGULAR) return IRREGULAR[word];
  let w = word;
  for (const suf of SUFFIXES) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      if (suf === 'ies') w += 'y';
      break;
    }
  }
  // Drop a trailing "e" so "crate"/"crates" and "shape"/"shaped" agree.
  if (w.endsWith('e') && w.length > 3) w = w.slice(0, -1);
  return w;
}

/** Lowercase, drop stopwords, digits and one-letter words, stem. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(w) || w.length < 2 || /^\d+$/.test(w)) continue;
    const s = stem(w);
    if (!STOPWORDS.has(s)) out.push(s);
  }
  return out;
}

const distinct = (xs: string[]) => [...new Set(xs)];
const refs = (text: string) => distinct([...text.matchAll(ADR_REF)].map((m) => m[1])).sort();

// ---------------------------------------------------------------------------
// Crates

interface Crate { name: string; description: string; terms: string }
interface Dep { src: string; dst: string; kind: 'normal' | 'dev' | 'build' }
interface CrateCite { src: string; adr: string }

/** Workspace members: the `members` globs of the root Cargo.toml (one level, `dir/*`), less `exclude`. */
function memberDirs(src: string): string[] {
  const root = readFileSync(join(src, 'Cargo.toml'), 'utf8');
  const list = (key: string) =>
    [...(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm').exec(root)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const exclude = new Set(list('exclude'));
  const dirs: string[] = [];
  for (const glob of list('members')) {
    if (!glob.endsWith('/*')) {
      dirs.push(glob);
      continue;
    }
    const parent = glob.slice(0, -2);
    for (const d of readdirSync(join(src, parent)).sort()) dirs.push(`${parent}/${d}`);
  }
  return dirs.filter((d) => !exclude.has(d) && existsSync(join(src, d, 'Cargo.toml')));
}

interface Toml { name: string; description: string; deps: { name: string; kind: Dep['kind'] }[] }

/** The few things the recipe needs from a Cargo.toml, read line by line. */
function readCargo(text: string): Toml {
  let section = '';
  let name = '';
  let description = '';
  const deps: Toml['deps'] = [];
  const kindOf = (s: string): Dep['kind'] | null => {
    const m = /(?:^|\.)(dependencies|dev-dependencies|build-dependencies)$/.exec(s);
    if (!m || !(s === m[1] || s.startsWith('target.'))) return null;
    return m[1] === 'dependencies' ? 'normal' : m[1] === 'dev-dependencies' ? 'dev' : 'build';
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    // `[table]` and `[[array.of.tables]]` (a `[[bin]]` has a `name` too).
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      section = line.startsWith('[[') ? `[[${header[1].trim()}]]` : header[1].trim();
      // `[dependencies.relate-core]` names one dependency in its header.
      const table = /^(.*(?:dependencies|dev-dependencies|build-dependencies))\.([A-Za-z0-9_-]+)$/.exec(section);
      if (table && kindOf(table[1])) deps.push({ name: table[2], kind: kindOf(table[1])! });
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (section === 'package') {
      if (kv[1] === 'name') name = JSON.parse(kv[2]);
      if (kv[1] === 'description' && kv[2].startsWith('"')) description = JSON.parse(kv[2]);
      continue;
    }
    const kind = kindOf(section);
    if (kind) {
      // `alias = { package = "relate-x", … }` depends on relate-x.
      const pkg = /package\s*=\s*"([^"]+)"/.exec(kv[2]);
      deps.push({ name: pkg ? pkg[1] : kv[1], kind });
    }
  }
  return { name, description, deps };
}

function loadCrates(src: string): { crates: Crate[]; deps: Dep[]; crateCites: CrateCite[] } {
  const tomls = memberDirs(src).map((d) => {
    const text = readFileSync(join(src, d, 'Cargo.toml'), 'utf8');
    return { text, toml: readCargo(text) };
  });
  const names = new Set(tomls.map((t) => t.toml.name));
  const crates = tomls
    .map(({ toml }) => ({
      name: toml.name,
      description: toml.description,
      terms: distinct(terms(`${toml.name.replace(/^relate-/, '')} ${toml.description}`)).join(' '),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  const deps: Dep[] = [];
  const crateCites: CrateCite[] = [];
  for (const { text, toml } of [...tomls].sort((a, b) => a.toml.name.localeCompare(b.toml.name))) {
    for (const d of toml.deps) {
      const key = `${toml.name} ${d.name} ${d.kind}`;
      if (!names.has(d.name) || d.name === toml.name || seen.has(key)) continue;
      seen.add(key);
      deps.push({ src: toml.name, dst: d.name, kind: d.kind });
    }
    for (const n of refs(text)) crateCites.push({ src: toml.name, adr: n });
  }
  deps.sort((a, b) => a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst) || a.kind.localeCompare(b.kind));
  return { crates, deps, crateCites };
}

// ---------------------------------------------------------------------------
// Documents and sections

interface Doc {
  path: string;
  title: string;
  adr: boolean;
  number: string | null;
  status: string | null;
  date: string | null;
  terms: string;
  cites: string[];
}
interface Supersedes { new: string; old: string; partial: boolean }
interface Chunk { id: string; doc: string; ord: number; heading: string; text: string; terms: string; crates: string[]; cites: string[] }

/** Split markdown on ## and ### headings; a long section splits on paragraphs. */
export function splitSections(md: string): [string, string][] {
  const sections: [string, string][] = [];
  let heading = 'Preamble';
  let buf: string[] = [];
  const flush = () => {
    if (buf.join('').trim()) sections.push([heading, buf.join('\n').trim()]);
  };
  for (const line of md.split('\n')) {
    const m = /^#{2,3}\s+(.*)/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
      buf = [];
    } else buf.push(line);
  }
  flush();
  const out: [string, string][] = [];
  for (const [h, body] of sections) {
    let part = '';
    for (const para of body.split('\n\n')) {
      if (part && part.length + para.length > MAX_CHUNK) {
        out.push([h, part.trim()]);
        part = '';
      }
      part += `${para}\n\n`;
    }
    if (part.trim()) out.push([h, part.trim()]);
  }
  return out;
}

/** Whitespace collapsed, cut at a word boundary to at most EXCERPT characters. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if ([...flat].length <= EXCERPT) return flat;
  const cut = flat.slice(0, EXCERPT - 2);
  return `${cut.slice(0, cut.lastIndexOf(' '))} …`;
}

/** Markdown links read as their text: `[ADR-0574](0574-….md)` is `ADR-0574`. */
const unlink = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

/** A header field: `- **Status**: x`, `Status: x`, or a `## Status` heading over its first line. */
function field(md: string, name: string): string | null {
  const head = md.split('\n').slice(0, 15).join('\n');
  const inline = new RegExp(`^(?:- )?(?:\\*\\*${name}\\*\\*|${name}):\\s*(.+)$`, 'm').exec(head);
  if (inline) return unlink(inline[1]).trim();
  const section = new RegExp(`^##\\s+${name}\\s*\\n+([^\\n#].*)$`, 'm').exec(md);
  return section ? unlink(section[1]).trim() : null;
}

function loadDocs(src: string, crateNames: string[]) {
  const adrDir = join(src, 'docs', 'adr');
  const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
  const files = [{ path: 'README.md', file: join(src, 'README.md') }, ...adrFiles.map((f) => ({ path: `docs/adr/${f}`, file: join(adrDir, f) }))];
  const docs: Doc[] = [];
  const supersedes: Supersedes[] = [];
  const bodies = new Map<string, string>();
  for (const { path, file } of files) {
    const md = readFileSync(file, 'utf8');
    const adr = path.startsWith('docs/adr/');
    const number = adr ? basename(path).slice(0, 4) : null;
    const title = md.split('\n')[0].replace(/^#\s*/, '').trim();
    const status = adr ? field(md, 'Status') : null;
    const date = adr ? (field(md, 'Date')?.split(/\s/)[0] ?? null) : null;
    docs.push({ path, title, adr, number, status, date, terms: distinct(terms(title)).join(' '), cites: refs(md).filter((n) => n !== number) });
    bodies.set(path, md);
    if (!number) continue;
    for (const m of (status ?? '').matchAll(/Superseded( in part)? by ADR-(\d{4})/g)) supersedes.push({ new: m[2], old: number, partial: Boolean(m[1]) });
    // `Amends: ADR-0030, ADR-0063 (…)`: the refs before any parenthesis.
    for (const n of refs((field(md, 'Amends') ?? '').split('(')[0])) supersedes.push({ new: number, old: n, partial: true });
  }
  supersedes.sort((a, b) => a.new.localeCompare(b.new) || a.old.localeCompare(b.old));

  // Which ADRs carry their sections: the pinned ones, then by how many other ADRs cite them.
  const citedBy = new Map<string, number>();
  for (const d of docs) if (d.adr) for (const n of d.cites) citedBy.set(n, (citedBy.get(n) ?? 0) + 1);
  const ranked = docs
    .filter((d) => d.adr && !PINNED.includes(d.number!))
    .sort((a, b) => (citedBy.get(b.number!) ?? 0) - (citedBy.get(a.number!) ?? 0) || a.number!.localeCompare(b.number!));
  const sectioned = new Set([...PINNED, ...ranked.slice(0, MAX_SECTIONED - PINNED.length).map((d) => d.number!)]);

  // Longest names first, so `relate-storage` wins over `relate`.
  const crateRe = new RegExp(`\\b(${[...crateNames].sort((a, b) => b.length - a.length).map((n) => n.replace(/[-]/g, '\\-')).join('|')})\\b`, 'g');
  const chunks: Chunk[] = [];
  for (const d of docs) {
    if (d.adr && !sectioned.has(d.number!)) continue;
    splitSections(bodies.get(d.path)!).forEach(([heading, body], ord) => {
      chunks.push({
        id: `${d.path}#${ord}`,
        doc: d.path,
        ord,
        heading,
        text: excerpt(body),
        terms: distinct(terms(`${heading} ${body}`)).join(' '),
        crates: distinct([...body.matchAll(crateRe)].map((m) => m[1])).sort(),
        cites: refs(body).filter((n) => n !== d.number),
      });
    });
  }
  return { docs, supersedes, chunks, sectioned, citedBy };
}

// ---------------------------------------------------------------------------
// The blocks

const rows = (xs: unknown[]) => xs.map((x) => `    ${JSON.stringify(x).replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "')}`).join(',\n');
const block = (parts: [string, unknown[]][]) =>
  ['{', parts.map(([k, xs]) => `  "${k}": [\n${rows(xs)}\n  ]`).join(',\n'), '}'].join('\n');

export interface CodebaseData {
  commit: string;
  blocks: Record<'docs' | 'crates' | 'chunks', string>;
  stats: Record<string, number>;
}

export function codebaseData(src: string): CodebaseData {
  const commit = execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const { crates, deps, crateCites } = loadCrates(src);
  const { docs, supersedes, chunks, sectioned } = loadDocs(src, crates.map((c) => c.name));
  const docRows = docs.map((d) => ({ ...d, sectioned: !d.adr || sectioned.has(d.number!) }));
  return {
    commit,
    blocks: {
      docs: block([['docs', docRows], ['supersedes', supersedes]]),
      crates: block([['crates', crates], ['deps', deps], ['crate_cites', crateCites]]),
      chunks: block([['chunks', chunks]]),
    },
    stats: {
      crates: crates.length,
      deps: deps.length,
      normalDeps: deps.filter((d) => d.kind === 'normal').length,
      crateCites: crateCites.length,
      adrs: docs.filter((d) => d.adr).length,
      sectioned: sectioned.size,
      chunks: chunks.length,
      supersedes: supersedes.length,
      docCites: docs.reduce((n, d) => n + d.cites.length, 0),
    },
  };
}

const BLOCK = (name: string) => new RegExp(`(^\`\`\`json data=${name}\\n)([\\s\\S]*?)(\\n\`\`\`$)`, 'm');

/** The recipe's source with each block (and the size in its `<summary>`) replaced. */
export function withBlocks(source: string, blocks: Record<string, string>): string {
  let out = source;
  for (const [name, data] of Object.entries(blocks)) {
    if (!BLOCK(name).test(out)) throw new Error(`the recipe has no \`\`\`json data=${name} block`);
    const kb = Math.round(Buffer.byteLength(data) / 1024);
    out = out
      .replace(BLOCK(name), (_m, open: string, _old: string, close: string) => `${open}${data}${close}`)
      .replace(new RegExp(`(<summary><code>${name}</code> \\()\\d+ KB(\\)</summary>)`), `$1${kb} KB$2`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { src: { type: 'string', default: '../relate' }, check: { type: 'boolean', default: false } } });
  const src = resolve(values.src!);
  if (!existsSync(join(src, 'docs', 'adr'))) {
    console.error(`codebase-recipe-data: ${src} is not a relate checkout (no docs/adr/)`);
    process.exit(1);
  }
  const data = codebaseData(src);
  const source = readFileSync(RECIPE_FILE, 'utf8');
  const next = withBlocks(source, data.blocks);
  const file = relative(process.cwd(), RECIPE_FILE);
  const sizes = Object.entries(data.blocks).map(([k, v]) => `${k} ${Math.round(Buffer.byteLength(v) / 1024)} KB`).join(', ');
  console.log(`relate @ ${data.commit}: ${JSON.stringify(data.stats)}`);
  console.log(`blocks: ${sizes}`);
  if (next === source) console.log(`${file}: data blocks current`);
  else if (values.check) {
    console.error(`${file}: data blocks differ from relate @ ${data.commit}`);
    process.exit(1);
  } else {
    writeFileSync(RECIPE_FILE, next);
    console.log(`${file}: data blocks written; now COOKBOOK_ONLY=codebase-context-graph npm run cookbook:record`);
  }
}

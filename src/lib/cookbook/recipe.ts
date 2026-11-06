// Recipe parsing: front matter, runnable cells, data blocks, diagrams, and
// each cell's recorded result. A port of the Rust harness's parser
// (testing/relate-cookbook in relatedb/relate, ADR-0130 and ADR-0132), which
// this repo no longer depends on; src/content/cookbook/README.md is the
// authoring contract.
//
// A recipe is one markdown file. Fences are recognised line by line at
// column 0 (``` or ~~~, three or more):
//
// - ```cypher cell=<id> … is a runnable cell;
// - ```json data=<name> is a data block: a JSON object whose keys are
//   statement parameters, named by a cell's `params=<name>`;
// - ```table or ```gram directly after a cell (blank lines between are fine)
//   is that cell's recorded result;
// - a fence whose language is `mermaid` is a diagram (ADR-0135).
//
// Every other fence is code. The only raw HTML allowed is a line holding
// `<details>`, `</details>`, or `<summary>…</summary>`, which collapses the
// data section on GitHub.
//
// Offsets (`start`, `end`) are JavaScript string indices into `source`.

import { parseFrontMatter, type FrontMatter } from './frontmatter.ts';

/** Largest data block allowed in a recipe, in bytes. */
export const MAX_DATA_BYTES = 512 * 1024;
/**
 * Data blocks up to this many bytes are parameters that sit beside their
 * step and are editable on the website; larger ones are datasets.
 */
export const INLINE_DATA_BYTES = 2048;
/** Largest row count a single statement may return; recipes `LIMIT` beyond it. */
export const MAX_RESULT_ROWS = 200;
/** Widest line a step's Cypher may have, in characters. */
export const MAX_CODE_COLUMNS = 88;
/**
 * Most lines a recipe may run before its `## Data` section. The datasets in
 * that section are collapsed on GitHub and never rendered on the site, so
 * they do not count.
 */
export const MAX_NARRATIVE_LINES = 800;

export type ResultKind = 'table' | 'gram';

/** A ```table / ```gram block: kind, span (fences included), and body. */
export interface ResultBlock {
  kind: ResultKind;
  start: number;
  end: number;
  text: string;
}

/** One runnable ```cypher cell=<id> fence. */
export interface Cell {
  id: string;
  /** The fence body: the Cypher script, possibly several statements. */
  code: string;
  /** `setup`: collapsed on the website; still runs in order. */
  setup: boolean;
  /** `params=<name>`: the data block passed verbatim as the parameters. */
  params: string | null;
  /** `expect=error`: the cell must fail; its result shows the error. */
  expectError: boolean;
  /** 1-based line of the opening fence. */
  line: number;
  /** Offset just past the cell's closing fence line. */
  end: number;
  /** The recorded result block, if present. */
  result: ResultBlock | null;
}

/** A ```json data=<name> block. */
export interface DataBlock {
  name: string;
  /** The block body, passed to the engine as the parameters' JSON text. */
  text: string;
  /** 1-based line of the opening fence. */
  line: number;
}

/** A ```mermaid block. */
export interface Diagram {
  /** 1-based position among the recipe's diagrams. */
  index: number;
  source: string;
  line: number;
}

/** What a fence is, by the 1-based line of its opening. */
export type FenceRef =
  | { line: number; kind: 'cell' | 'result' | 'data'; name: string }
  | { line: number; kind: 'diagram'; name: number }
  | { line: number; kind: 'code'; name: null };

export interface Recipe {
  /** File stem, which is also the URL slug. */
  slug: string;
  /** The file as read. */
  source: string;
  front: FrontMatter;
  /** 1-based line where the body (everything after the front matter) starts. */
  bodyLine: number;
  /** Offset where the body starts. */
  bodyStart: number;
  /** The first `# ` heading after the front matter. */
  heading: string | null;
  cells: Cell[];
  data: DataBlock[];
  /** The ```mermaid blocks, in order. */
  diagrams: Diagram[];
  /** Every fence, in order, with what it is. */
  fences: FenceRef[];
  /** 1-based lines of raw HTML other than the allowed `<details>` wrappers. */
  strayHtml: number[];
  /** Lines before the `## Data` heading (the whole file when it has none). */
  narrativeLines: number;
  /** Offset where the `## Data` section starts (the end of the file when it has none). */
  narrativeEnd: number;
}

/** The recording the engine's `renderResult` returns, as far as the harness reads it. */
export interface Recording {
  kind: ResultKind;
  text: string;
}

interface Line {
  start: number;
  end: number;
  text: string;
}

const encoder = new TextEncoder();
/** UTF-8 length, as the format's byte limits count it. */
export const byteLength = (s: string) => encoder.encode(s).length;

function linesWithOffsets(s: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  while (start < s.length) {
    const nl = s.indexOf('\n', start);
    const end = nl < 0 ? s.length : nl + 1;
    out.push({ start, end, text: s.slice(start, end).replace(/\n$/, '').replace(/\r$/, '') });
    start = end;
  }
  return out;
}

/** `[fence char, fence length, info string]` for an opening fence line. */
function fenceOpen(line: string): [string, number, string] | null {
  const ch = line[0];
  if (ch !== '`' && ch !== '~') return null;
  let len = 0;
  while (line[len] === ch) len++;
  if (len < 3) return null;
  const info = line.slice(len);
  if (ch === '`' && info.includes('`')) return null;
  return [ch, len, info.trim()];
}

function isFenceClose(line: string, ch: string, len: number): boolean {
  let run = 0;
  while (line[run] === ch) run++;
  return run >= len && line.slice(run).trim() === '';
}

const isName = (s: string) => /^[a-z0-9-]+$/.test(s);

/**
 * A raw-HTML line (one starting with `<` followed by a letter, `/`, or `!`)
 * other than the allowed `<details>` wrappers.
 */
export function isStrayHtml(text: string): boolean {
  const t = text.trim();
  const html = /^<[A-Za-z/!]/.test(t);
  const allowed =
    t === '<details>' || t === '</details>' || (t.startsWith('<summary>') && t.endsWith('</summary>'));
  return html && !allowed;
}

type Fence =
  | { kind: 'cell'; id: string; setup: boolean; params: string | null; expectError: boolean }
  | { kind: 'data'; name: string }
  | { kind: 'result'; result: ResultKind }
  | { kind: 'diagram' }
  | { kind: 'code' };

/** Classify a fence by its info string. */
function classify(info: string, line: number): Fence {
  if (info === 'table' || info === 'gram') return { kind: 'result', result: info };
  const [lang, ...rest] = info.split(/\s+/).filter(Boolean);
  switch (lang) {
    // A diagram: the fence's language is mermaid, as markdown-it and GitHub
    // read it, whatever else the info string holds.
    case 'mermaid':
      return { kind: 'diagram' };
    case 'json': {
      if (rest.length === 0) return { kind: 'code' };
      const name = rest.length === 1 && rest[0].startsWith('data=') ? rest[0].slice('data='.length) : null;
      if (name !== null && isName(name)) return { kind: 'data', name };
      throw new Error(`line ${line}: expected \`json data=<name>\`, got \`${info}\``);
    }
    case 'cypher': {
      if (rest.length === 0) return { kind: 'code' };
      const cell: Extract<Fence, { kind: 'cell' }> = {
        kind: 'cell',
        id: '',
        setup: false,
        params: null,
        expectError: false,
      };
      for (const token of rest) {
        const eq = token.indexOf('=');
        const [key, value] = eq < 0 ? [null, null] : [token.slice(0, eq), token.slice(eq + 1)];
        if (key === 'cell') cell.id = value!;
        else if (key === 'params' && isName(value!)) cell.params = value;
        else if (key === 'expect' && value === 'error') cell.expectError = true;
        else if (key === null && token === 'setup') cell.setup = true;
        else throw new Error(`line ${line}: unknown cell option \`${token}\``);
      }
      if (!isName(cell.id)) {
        throw new Error(
          `line ${line}: a cypher fence with options needs \`cell=<id>\` (lowercase letters, digits, \`-\`)`,
        );
      }
      return cell;
    }
    default:
      return { kind: 'code' };
  }
}

/** Parse recipe text. Throws when the recipe does not parse. */
export function parseRecipe(slug: string, source: string): Recipe {
  const lines = linesWithOffsets(source);
  if (lines[0]?.text !== '---') throw new Error('the recipe must start with a `---` front-matter block');
  const close = lines.findIndex((l, i) => i > 0 && l.text === '---');
  if (close < 0) throw new Error('front matter is not closed with `---`');
  const front = parseFrontMatter(
    lines
      .slice(1, close)
      .map((l) => `${l.text}\n`)
      .join(''),
  );

  let heading: string | null = null;
  const cells: Cell[] = [];
  const data: DataBlock[] = [];
  const diagrams: Diagram[] = [];
  const fences: FenceRef[] = [];
  const strayHtml: number[] = [];
  let narrativeLines = lines.length;
  // Index of the last cell, while nothing but blank lines follows it.
  let openCell: number | null = null;
  let i = close + 1;
  while (i < lines.length) {
    const line = lines[i];
    const opened = fenceOpen(line.text);
    if (!opened) {
      if (heading === null && line.text.startsWith('# ')) heading = line.text.slice(2).trim();
      if (line.text === '## Data' && narrativeLines === lines.length) narrativeLines = i;
      if (isStrayHtml(line.text)) strayHtml.push(i + 1);
      if (line.text.trim() !== '') openCell = null;
      i++;
      continue;
    }
    const [ch, len, info] = opened;
    const open = i + 1;
    let j = i + 1;
    while (j < lines.length && !isFenceClose(lines[j].text, ch, len)) j++;
    if (j === lines.length) throw new Error(`line ${open}: unclosed code fence`);
    const body = lines
      .slice(i + 1, j)
      .map((l) => `${l.text}\n`)
      .join('')
      .replace(/\n+$/, '');
    const fence = classify(info, open);
    let nextOpen: number | null = null;
    switch (fence.kind) {
      case 'result': {
        if (openCell === null) {
          throw new Error(`line ${open}: a \`${fence.result}\` result block must directly follow a cypher cell`);
        }
        const cell = cells[openCell];
        cell.result = { kind: fence.result, start: lines[i].start, end: lines[j].end, text: body };
        fences.push({ line: open, kind: 'result', name: cell.id });
        break;
      }
      case 'cell': {
        if (cells.some((c) => c.id === fence.id)) throw new Error(`line ${open}: duplicate cell id \`${fence.id}\``);
        cells.push({
          id: fence.id,
          code: body,
          setup: fence.setup,
          params: fence.params,
          expectError: fence.expectError,
          line: open,
          end: lines[j].end,
          result: null,
        });
        fences.push({ line: open, kind: 'cell', name: fence.id });
        nextOpen = cells.length - 1;
        break;
      }
      case 'data': {
        if (data.some((d) => d.name === fence.name)) {
          throw new Error(`line ${open}: duplicate data block \`${fence.name}\``);
        }
        data.push({ name: fence.name, text: body, line: open });
        fences.push({ line: open, kind: 'data', name: fence.name });
        break;
      }
      case 'diagram': {
        const index = diagrams.length + 1;
        diagrams.push({ index, source: body, line: open });
        fences.push({ line: open, kind: 'diagram', name: index });
        break;
      }
      case 'code':
        fences.push({ line: open, kind: 'code', name: null });
        break;
    }
    openCell = nextOpen;
    i = j + 1;
  }

  return {
    slug,
    source,
    front,
    bodyLine: close + 2,
    bodyStart: lines[close].end,
    heading,
    cells,
    data,
    diagrams,
    fences,
    strayHtml,
    narrativeLines,
    narrativeEnd: lines[narrativeLines]?.start ?? source.length,
  };
}

/** The recipe as a reader reads it: everything after the front matter, up to the `## Data` section. */
export const narrative = (r: Recipe) => r.source.slice(r.bodyStart, r.narrativeEnd);

/** The data block named `name`, if any. */
export const dataBlock = (r: Recipe, name: string) => r.data.find((d) => d.name === name);

/** A heading's text without its inline markdown: `code`, *emphasis*, **strong**, and links. */
const plainHeading = (text: string) =>
  text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();

/**
 * Each cell's title, by cell id: the `##` or `###` heading the cell sits
 * under (the closest one above it, outside code fences), plain text. A
 * second or later cell under the same heading gets its position, `Heading
 * (2)`; a cell before any heading is titled by its id.
 */
export function cellTitles(r: Recipe): Map<string, string> {
  const lines = r.source.split('\n').map((l) => l.replace(/\r$/, ''));
  const cellAt = new Map(r.cells.map((c) => [c.line, c]));
  const titles = new Map<string, string>();
  let heading: string | null = null;
  let under = 0;
  let fence: [string, number] | null = null;
  for (let i = r.bodyLine - 1; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (isFenceClose(line, fence[0], fence[1])) fence = null;
      continue;
    }
    const cell = cellAt.get(i + 1);
    if (cell) {
      under += 1;
      titles.set(cell.id, heading === null ? cell.id : under === 1 ? heading : `${heading} (${under})`);
    }
    const opened = fenceOpen(line);
    if (opened) {
      fence = [opened[0], opened[1]];
      continue;
    }
    const m = /^#{2,3} (.+)$/.exec(line);
    if (m) {
      heading = plainHeading(m[1]);
      under = 0;
    }
  }
  return titles;
}

/**
 * Contract checks beyond the front matter's own schema (which parsing
 * enforces), none needing the engine: heading, cells, a diagram, data
 * blocks, step code width, raw HTML, narrative length. Returns every problem
 * found. (A cell with no statements is caught when it runs: the engine runs
 * none for a blank or comment-only script.)
 */
export function validateRecipe(r: Recipe): string[] {
  const errs: string[] = [];
  if (r.heading === null) errs.push('recipe has no `# ` heading');
  else if (r.heading !== r.front.title) {
    errs.push(`first \`# \` heading \`${r.heading}\` differs from title \`${r.front.title}\``);
  }
  if (r.cells.length === 0) errs.push('recipe has no runnable `cypher cell=<id>` fences');
  // Every recipe draws at least its data model (ADR-0135).
  if (r.diagrams.length === 0) errs.push('recipe has no ```mermaid diagram (draw its data model)');
  if (r.data.some((d) => byteLength(d.text) > INLINE_DATA_BYTES)) {
    for (const key of ['dataset', 'source', 'license'] as const) {
      if (r.front[key] === null) errs.push(`recipe ships a dataset but front matter lacks \`${key}\``);
    }
  }
  for (const cell of r.cells) {
    if (cell.params !== null && !dataBlock(r, cell.params)) {
      errs.push(`cell \`${cell.id}\`: no \`json data=${cell.params}\` block`);
    }
    cell.code.split('\n').forEach((line, n) => {
      const width = [...line].length;
      if (width > MAX_CODE_COLUMNS) {
        errs.push(`cell \`${cell.id}\` line ${n + 1} is ${width} columns; wrap Cypher at ${MAX_CODE_COLUMNS}`);
      }
    });
  }
  for (const d of r.data) {
    if (!r.cells.some((c) => c.params === d.name)) errs.push(`data block \`${d.name}\` is not used by any cell`);
    // Parameter blocks sit beside their step and count toward the
    // narrative; only datasets go in the `## Data` section.
    const bytes = byteLength(d.text);
    const dataset = bytes > INLINE_DATA_BYTES;
    const inDataSection = d.line > r.narrativeLines;
    if (inDataSection && !dataset) {
      errs.push(
        `data block \`${d.name}\` is ${bytes} bytes, a parameter block: put it beside the step that uses it; ` +
          `\`## Data\` holds datasets (over ${INLINE_DATA_BYTES} bytes)`,
      );
    } else if (dataset && !inDataSection) {
      errs.push(
        `data block \`${d.name}\` is a ${Math.floor(bytes / 1024)} KB dataset: move it to the \`## Data\` section`,
      );
    }
    if (bytes > MAX_DATA_BYTES) {
      errs.push(
        `data block \`${d.name}\` is ${Math.floor(bytes / 1024)} KB; blocks are capped at ${MAX_DATA_BYTES / 1024} KB`,
      );
    }
    try {
      const value: unknown = JSON.parse(d.text);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errs.push(`data block \`${d.name}\` must be a JSON object`);
      }
    } catch (e) {
      errs.push(`data block \`${d.name}\` is not JSON: ${(e as Error).message}`);
    }
  }
  for (const line of r.strayHtml) {
    errs.push(`line ${line}: raw HTML is not allowed (only \`<details>\` / \`<summary>\` lines)`);
  }
  if (r.narrativeLines > MAX_NARRATIVE_LINES) {
    errs.push(
      `the recipe runs ${r.narrativeLines} lines before \`## Data\`; keep it under ${MAX_NARRATIVE_LINES} ` +
        '(datasets go in the `## Data` section)',
    );
  }
  return errs;
}

/**
 * The recipe's source with every cell's result block set to its recording
 * in `recordings` (by cell id), inserted after the cell when missing.
 */
export function withResults(r: Recipe, recordings: Map<string, Recording>): string {
  const edits: [number, number, string][] = [];
  for (const cell of r.cells) {
    const rec = recordings.get(cell.id);
    if (!rec) continue;
    const fence = rec.text.includes('```') ? '````' : '```';
    const block = `${fence}${rec.kind}\n${rec.text}\n${fence}\n`;
    if (cell.result) edits.push([cell.result.start, cell.result.end, block]);
    else edits.push([cell.end, cell.end, `\n${block}`]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let s = r.source;
  for (const [start, end, text] of edits) s = s.slice(0, start) + text + s.slice(end);
  return s;
}

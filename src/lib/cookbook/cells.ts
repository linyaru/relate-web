// The cell rule every runner shares (ADR-0130): cells run in order, and a run
// stops at the first cell that goes other than its recipe says. The checkers,
// the page runtime and the playground's hand-off use it. Tested with
// cells.cases.json. Browser-safe: no Node imports.

/** A cell's last wire envelope (parsed), or null when it ran no statement. */
export type LastEnvelope = { error?: string | null } | null;

/** Whether a cell failed. A script stops at its first error, so that is its last envelope's. */
export const failed = (last: LastEnvelope): boolean => (last?.error ?? null) !== null;

/**
 * How a cell's run differs from what its recipe says, or null: an error
 * where none is expected, or success where the cell is `expectError`.
 */
export function surprise(cell: { id: string; expectError: boolean }, last: LastEnvelope): string | null {
  if (!cell.expectError && failed(last)) return `cell \`${cell.id}\` failed: ${last!.error}`;
  if (cell.expectError && !failed(last)) return `cell \`${cell.id}\` is marked expect=error but succeeded`;
  return null;
}

// ---------------------------------------------------------------- docs cells
// A docs page's runnable cells (```cypher run fences, DOCS-PLAN.md §5) and
// the grammar of their info strings, shared by the docs build
// (src/lib/docs/results.ts) and the playground's `#docs=<page>&cell=<id>`
// hand-off, which reads the cells from the page's markdown twin.

/** What a runnable cell's info string says. */
export interface RunInfo {
  name: string | null;
  /** The ```json data=<name> block the cell takes its parameters from. */
  params: string | null;
  expectError: boolean;
  /** The interactive-element words (CELL_WORDS) the cell carries, `timing` → '' and `layout=force` → 'force'; absent when it has none. */
  words?: Record<string, string>;
}

const CELL_ID = /^[A-Za-z0-9_-]+$/;

/**
 * The interactive-element words a cell's info string may carry (DOCS-PLAN.md
 * §7.3, the docs README "Interactive elements"): each names the browser
 * module (src/scripts/docs/elements/<module>.ts) that upgrades the cell, and
 * the values it takes (null: a bare word). A word changes what the page does
 * in a browser, never what the cell runs, so the recording and the twin's
 * fence stay as they are. The set is closed here because the playground's
 * hand-off and the build share this parser.
 */
export const CELL_WORDS: Record<string, { module: string; values: RegExp | null; hint: string }> = {
  timing: { module: 'timing', values: null, hint: '`timing`' },
  layout: { module: 'graph-extras', values: /^(?:hierarchical|circular|force)$/, hint: '`layout=hierarchical|circular|force`' },
  highlight: { module: 'graph-extras', values: /^path$/, hint: '`highlight=path`' },
  caption: { module: 'graph-extras', values: /^[A-Za-z_][A-Za-z0-9_]*$/, hint: '`caption=<property>`' },
};

/** The browser modules a cell's words need, each once, in word order. */
export const wordModules = (words: Record<string, string> | undefined): string[] =>
  [...new Set(Object.keys(words ?? {}).map((w) => CELL_WORDS[w].module))];

/** The info string of a runnable cell: `cypher run` with optional `name=<id>`, `params=<name>`, `expect=error` and element words (CELL_WORDS); null for any other fence. Throws on a malformed one. */
export function parseRunInfo(lang: string | null | undefined, meta: string | null | undefined): RunInfo | null {
  if (lang !== 'cypher') return null;
  const words = (meta ?? '').trim().split(/\s+/).filter(Boolean);
  if (words[0] !== 'run') return null;
  const info: RunInfo = { name: null, params: null, expectError: false };
  for (const w of words.slice(1)) {
    const eq = w.indexOf('=');
    const key = eq < 0 ? w : w.slice(0, eq);
    const value = eq < 0 ? '' : w.slice(eq + 1);
    if (key === 'name' && CELL_ID.test(value)) info.name = value;
    else if (key === 'params' && CELL_ID.test(value)) info.params = value;
    else if (key === 'expect' && value === 'error') info.expectError = true;
    else if (key in CELL_WORDS && (CELL_WORDS[key].values === null ? eq < 0 : CELL_WORDS[key].values!.test(value))) {
      if (info.words && key in info.words) throw new Error(`\`cypher run\` takes \`${key}\` once`);
      info.words = { ...info.words, [key]: value };
    } else {
      throw new Error(
        `\`cypher run\` takes \`name=<id>\`, \`params=<name>\` (letters, digits, - and _), \`expect=error\` and the element words ` +
          `${Object.values(CELL_WORDS).map((w) => w.hint).join(', ')}, not \`${w}\``,
      );
    }
  }
  return info;
}

/** The name of a parameters block (```json data=<name>), or null for any other fence. */
export function parseDataInfo(lang: string | null | undefined, meta: string | null | undefined): string | null {
  if (lang !== 'json') return null;
  const m = /^data=([A-Za-z0-9_-]+)$/.exec((meta ?? '').trim());
  return m ? m[1] : null;
}

/** A docs cell as the hand-off carries it. */
export interface TwinCell {
  id: string;
  /** The heading the cell sits under, or null. */
  title: string | null;
  code: string;
  /** The name of the parameters block it takes, or null. */
  params: string | null;
  expectError: boolean;
}

/**
 * A docs page's title, cells and parameters blocks, read from its markdown
 * twin (`/docs/<page>.md`): every top-level fence (indented up to three
 * spaces, as in a list item), in page order, with the same ids the page gives
 * them (`name=<id>`, else `cell-<n>`). Throws on a malformed info string.
 */
export function twinCells(markdown: string): { title: string | null; cells: TwinCell[]; data: Record<string, string> } {
  const lines = markdown.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const cells: TwinCell[] = [];
  const data: Record<string, string> = {};
  let pageTitle: string | null = null;
  let heading: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const open = /^( {0,3})(`{3,}|~{3,})\s*(.*)$/.exec(lines[i]);
    if (!open) {
      const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
      if (h) {
        heading = h[2];
        if (h[1] === '#' && pageTitle === null) pageTitle = h[2];
      }
      continue;
    }
    const [, indent, fence, info] = open;
    const body: string[] = [];
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    for (i++; i < lines.length && !close.test(lines[i]); i++) {
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i].trimStart());
    }
    const [lang = '', ...rest] = info.trim().split(/\s+/);
    const meta = rest.join(' ');
    const run = parseRunInfo(lang, meta);
    if (run) {
      cells.push({ id: run.name ?? `cell-${cells.length + 1}`, title: heading, code: body.join('\n'), params: run.params, expectError: run.expectError });
    }
    const name = parseDataInfo(lang, meta);
    if (name !== null) data[name] = body.join('\n');
  }
  return { title: pageTitle, cells, data };
}

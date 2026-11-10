// `:::scale-demo{build=<cell> count=<cell> walk=<cell> [sizes="1000,10000,100000"]}`:
// the scale demo (DOCS-PLAN.md §7.3, ADR-0048). Three cells of the page,
// recorded at the small size their parameters block gives `n`, are run again
// in the reader's browser at a size the reader picks, up to a hundred
// thousand nodes, on a database of the element's own (PageApi.scratch: a
// second engine worker, so the page's database never holds the large graph
// and closing it hands the memory back). The build cell makes a tree whose
// relationships point from child to parent; the element times the build,
// the count and the walk on each run. It draws nothing: the numbers are
// the demo.
//
// The static form says what the demo does and holds the three cells'
// recorded results at the page's size. It carries no timing and no memory
// figure: those exist only after a run in the reader's tab (ADR-0045). The
// browser module is src/scripts/docs/elements/scale-demo.ts.

import { markdownTable } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import { DEFAULT_SIZES, firstSize, MAX_SIZE, sizesOf } from './_scale-demo-model.ts';

const ATTRIBUTES = new Set(['id', 'build', 'count', 'walk', 'sizes']);
const ROLES = ['build', 'count', 'walk'] as const;

const fmt = (n: number) => n.toLocaleString('en-US');

/** The build cell's parameters as an object, or null when it takes none or they do not read. */
function buildParams(input: ElementInput): Record<string, unknown> | null {
  const cell = input.cells.find((c) => c.id === input.attributes.build);
  const text = cell?.params ? input.dataBlocks[cell.params] : undefined;
  if (text === undefined) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** A recorded cell's first row as `key: value` pairs, or why there is none. */
function firstRow(input: ElementInput, id: string): string {
  const env = input.recordings[id]?.envelope as { rows?: Record<string, unknown>[]; error?: string | null } | null | undefined;
  if (!env) return 'not recorded';
  if (env.error) return `error: ${env.error}`;
  const row = env.rows?.[0];
  if (!row) return 'no rows';
  return Object.entries(row).map(([k, v]) => `${k}: ${typeof v === 'number' ? fmt(v) : JSON.stringify(v)}`).join(', ');
}

export default {
  live: 'a button runs the three cells again at the size picked (the largest by default, the middle size on a narrow screen) on a separate in-memory database in your browser, apart from the page\'s database, and shows each cell\'s result and engine time; a second button runs the count and the walk again from a node you name; it shows how much memory that database\'s engine holds; Free closes it and returns the memory.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes \`build=<cell>\`, \`count=<cell>\`, \`walk=<cell>\`, \`sizes="<n>,<n>"\` and \`id\`, not \`${k}\``);
    const at = (id: string) => input.cells.find((c) => c.id === id);
    for (const role of ROLES) {
      const id = a[role];
      if (!id) {
        out.push(`needs \`${role}=<cell>\``);
        continue;
      }
      const cell = at(id);
      if (!cell) out.push(`\`${role}\` names \`${id}\`, which is not a cell on the page`);
      else if (cell.expectError) out.push(`\`${role}\` names cell \`${id}\`, which is expected to fail`);
    }
    const [build, count, walk] = ROLES.map((r) => at(a[r] ?? ''));
    if (build && count && walk && !(build.index < count.index && count.index < walk.index)) out.push('the cells come in page order: `build`, then `count`, then `walk`');
    if (build && !build.params) out.push(`\`build\` names cell \`${build.id}\`, which takes no parameters; it takes \`n\`, the number of nodes, from a \`json data=<name>\` block`);
    else if (build) {
      const n = buildParams(input)?.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) out.push(`cell \`${build.id}\`'s parameters give no whole number \`n\`, the number of nodes`);
    }
    const sizes = sizesOf(a.sizes);
    if (!sizes) out.push('`sizes` is a list of whole numbers, such as `"1000,10000,100000"`');
    else {
      if (sizes.some((s, i) => i > 0 && s <= sizes[i - 1])) out.push('`sizes` go up');
      if (sizes.at(-1)! > MAX_SIZE) out.push(`\`sizes\` goes past ${fmt(MAX_SIZE)}`);
      if (sizes.length > 5) out.push('`sizes` offers at most five sizes');
    }
    return out;
  },
  staticForm(input) {
    const a = input.attributes;
    const sizes = sizesOf(a.sizes) ?? DEFAULT_SIZES;
    const n = buildParams(input)?.n;
    const cell = (id: string) => `\`${id}\``;
    const list = sizes.map(fmt);
    const choices = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0];
    const middle = firstSize(sizes, false);
    const intro = [
      `The scale demo runs cells ${cell(a.build)}, ${cell(a.count)} and ${cell(a.walk)} again with \`n\` set to ${choices}, on an in-memory database of its own in the browser tab: a second copy of the engine, so the page's database never holds the large graph.`,
      `${cell(a.build)} creates the tree, ${cell(a.count)} counts its nodes and relationships, and ${cell(a.walk)} follows every chain of relationships down from one node.`,
      "It shows each cell's first row and the time the engine took, beside the cell's recording.",
      `It offers ${fmt(firstSize(sizes, true))} nodes first on a wide screen and ${fmt(middle)} on a narrow one, says how much memory the second engine holds, and closes that engine on Free, on the engine bar's Reset, and when the page is left.`,
    ].join(' ');
    const table = markdownTable(
      ['Cell', `Recorded on this page, with \`n\` = ${typeof n === 'number' ? fmt(n) : '?'}`],
      ROLES.map((r) => [cell(a[r]), firstRow(input, a[r])]),
    );
    return { text: `${intro}\n\n${table}` };
  },
} satisfies ElementSpec;

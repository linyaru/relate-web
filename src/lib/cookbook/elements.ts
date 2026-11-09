// Interactive elements on cookbook recipe pages (ADR-0045): the docs
// framework's elements (ADR-0035; src/lib/docs/elements.ts), placed in a
// recipe with the same directive, `:::<name>{attrs}` … `:::`. Node only: the
// build (site.ts) and scripts/cookbook.ts import it, never the browser.
//
// Nothing here is specific to an element. A recipe is a page to the
// framework: its cells are the page's cells (cellTitles gives each its
// heading), its data blocks are the page's data blocks, and its recordings
// are the run the cookbook makes anyway (run.ts), in the docs sidecar's form
// (envelopes without their timings). The element's own build file
// (src/lib/docs/elements/<name>.ts) validates the directive and makes the
// static form from them, exactly as on a docs page; so a new element is
// placed on a recipe by its directive alone.
//
// Static forms are recorded by `npm run cookbook:record`, after the result
// blocks (it runs the recipe, so it has the recordings), into the cookbook's
// diagrams/ directory: `<slug>-element-<id>.json` and, with a picture,
// `-light.svg` and `-dark.svg`, hash-stamped like a docs page's.
// `npm run cookbook:check` and the build read them back and fail on a
// missing, stale or hand-edited one.

import { join } from 'node:path';

import { checkPageElements, recordPageElements, type ElementPage, type PageRules } from '../docs/checks/elements.ts';
import { recordedEnvelope, type Report } from '../docs/checks/cells.ts';
import { ELEMENT_ID, elementNames, readForm, RESERVED_NAMES, type ElementUse, type Form, type FormContext } from '../docs/elements.ts';
import type { PageCells, RecordedCell } from '../docs/results.ts';
import { COOKBOOK_DIR } from './load.ts';
import { cellTitles, type Recipe } from './recipe.ts';
import { lastEnvelope } from './result-view.ts';
import type { CellRun } from './run.ts';

/** The command that records a recipe's element static forms. */
export const COOKBOOK_RECORD = 'npm run cookbook:record';

const RULES: PageRules = { again: `run \`${COOKBOOK_RECORD}\``, unknown: true };

/** A recipe's source file. */
export const recipeFile = (slug: string) => join(COOKBOOK_DIR, `${slug}.md`);

/** A recipe's id among the framework's pages (`page.id` in an element's input). */
export const recipePageId = (slug: string) => `cookbook/${slug}`;

/** Where the build serves an element's picture beside its recipe page. */
export const recipeElementSvgPath = (slug: string, id: string, theme: 'light' | 'dark') => `/cookbook/${slug}/element-${id}-${theme}.svg`;

/**
 * A recipe's element directives as the framework's uses (ids as on a docs
 * page: `id=`, else `<name>-<n>`), and what is wrong with them: a name no
 * element has, a reserved one, a `.class`, a malformed or second id.
 */
export function recipeUses(recipe: Recipe, names: string[] = elementNames()): { uses: ElementUse[]; problems: string[] } {
  const uses: ElementUse[] = [];
  const problems: string[] = [];
  const seq = new Map<string, number>();
  const known = new Set(names);
  for (const e of recipe.elements) {
    const at = `line ${e.line}`;
    if (!known.has(e.name)) {
      const why = RESERVED_NAMES.includes(e.name) ? 'a docs construct, which a recipe does not take' : 'no element';
      problems.push(`${at}: \`:::${e.name}\` is ${why} (elements: ${names.join(', ') || 'none'})`);
      continue;
    }
    const index = (seq.get(e.name) ?? 0) + 1;
    seq.set(e.name, index);
    const id = e.attributes.id || `${e.name}-${index}`;
    if ('class' in e.attributes) problems.push(`${at}: \`:::${e.name}\` takes no \`.class\``);
    if (!ELEMENT_ID.test(id)) problems.push(`${at}: \`:::${e.name}\`: \`id=${id}\` is letters, digits, - and _`);
    if (uses.some((u) => u.id === id)) problems.push(`${at}: a second element with id \`${id}\``);
    uses.push({ name: e.name, id, attributes: { ...e.attributes }, children: e.children, line: e.line });
  }
  return { uses, problems };
}

/** A recipe's cells and data blocks as a page's (PageCells): each cell titled by the heading it sits under. */
export function recipeCells(recipe: Recipe): PageCells {
  const titles = cellTitles(recipe);
  return {
    cells: recipe.cells.map((c, i) => ({
      name: c.id,
      params: c.params,
      expectError: c.expectError,
      id: c.id,
      code: c.code,
      index: i + 1,
      title: titles.get(c.id) ?? null,
      line: c.line,
    })),
    data: new Map(recipe.data.map((d) => [d.name, d.text])),
    problems: [],
  };
}

/** A run's results as a docs page's sidecar holds them, by cell id: each cell's recording and its last envelope without timings. */
export function runRecordings(recipe: Recipe, cells: CellRun[]): Record<string, RecordedCell> {
  const out: Record<string, RecordedCell> = {};
  for (const run of cells) {
    const cell = recipe.cells.find((c) => c.id === run.id);
    const rec = run.recording as RecordedCell;
    out[run.id] = {
      kind: rec.kind,
      text: rec.text,
      table: rec.table ?? null,
      graph: rec.graph ?? null,
      envelope: recordedEnvelope(lastEnvelope(run.envelopes)),
      expectError: cell?.expectError ?? false,
    };
  }
  return out;
}

/** What an element on a recipe is made from: the recipe as a page, and the form context its run gives. */
export function recipeElementPage(recipe: Recipe, cells: CellRun[]): { page: ElementPage; ctx: FormContext } {
  const { uses, problems } = recipeUses(recipe);
  const page: ElementPage = {
    id: recipePageId(recipe.slug),
    file: recipeFile(recipe.slug),
    uses,
    problems,
    cells: recipeCells(recipe),
    unknown: [],
    offset: 0,
  };
  return { page, ctx: { recordings: runRecordings(recipe, cells), dataBlocks: Object.fromEntries(page.cells.data) } };
}

/**
 * Each element on a recipe with its recorded static form, for the page and
 * the twin, by the directive's line; throws with every problem when one is
 * malformed, missing or stale.
 */
export function recipeForms(recipe: Recipe, cells: CellRun[]): Map<number, { use: ElementUse; form: Form }> {
  const out = new Map<number, { use: ElementUse; form: Form }>();
  if (!recipe.elements.length) return out;
  const { page, ctx } = recipeElementPage(recipe, cells);
  const problems = [...page.problems];
  for (const use of page.uses) {
    try {
      out.set(use.line!, { use, form: readForm(page.file, use, ctx, RULES.again) });
    } catch (e) {
      problems.push(`line ${use.line}: ${(e as Error).message}`);
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
  return out;
}

/** cookbook:check: every element directive on the recipe validates and has a current recorded form, and no form is left without its directive. */
export async function checkRecipeElements(recipe: Recipe, cells: CellRun[], report: Report): Promise<void> {
  const { page, ctx } = recipeElementPage(recipe, cells);
  await checkPageElements(page, ctx, report, RULES);
}

/** cookbook:record: the recipe's element static forms from its run. Returns how many files changed. */
export async function recordRecipeElements(recipe: Recipe, cells: CellRun[], report: Report, log: (line: string) => void): Promise<number> {
  const { page, ctx } = recipeElementPage(recipe, cells);
  return (await recordPageElements(page, ctx, report, log, RULES)).changed;
}

/**
 * The recipe's markdown twin (`/cookbook/<slug>/index.md`): the recipe file,
 * with each element directive replaced by its static form as the docs twin
 * gives it (the children, the generated text, the "Live:" line, then a link
 * to the light picture), so nothing the page shows is only in a picture or
 * behind a click.
 */
export function recipeTwin(recipe: Recipe, forms: Map<number, { use: ElementUse; form: Form }>, origin: string): string {
  let out = recipe.source;
  for (const e of [...recipe.elements].sort((a, b) => b.start - a.start)) {
    const found = forms.get(e.line);
    if (!found) throw new Error(`[${recipe.slug}] line ${e.line}: \`:::${e.name}\` has no static form`);
    const { use, form } = found;
    const parts = [use.children, form.text, `Live: ${form.live}`];
    if (form.svg) parts.push(`![${form.caption ?? ''}](${origin}${recipeElementSvgPath(recipe.slug, use.id, 'light')})`);
    const text = `${parts.filter((p) => p.trim()).join('\n\n')}\n`;
    out = out.slice(0, e.start) + text + out.slice(e.end);
  }
  return out;
}

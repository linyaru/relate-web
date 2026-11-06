// The cookbook as the website builds it: every recipe parsed and validated,
// replayed through the site's WASM engine (each step's result must match its
// recording, as `npm run cookbook:check` requires), its diagrams' renderings
// read and checked, and a highlighter for its code. Computed once per build
// and shared by every cookbook page and endpoint; any problem fails the build.

import { createHighlighter, type Highlighter } from 'shiki';

import { readLabels, readRendered, diagramTitle, type Theme } from './diagrams.ts';
import { COOKBOOK_DIR, loadRecipes } from './load.ts';
import type { Recipe, ResultKind } from './recipe.ts';
import { checkRun, lastEnvelope, loadEngine, resultProblems, runRecipe } from './run.ts';

/** A table recording's cells: Cypher literals, as the `table` block records them. */
export interface TableCells {
  columns: string[];
  rows: string[][];
  numeric: boolean[];
  summary: string;
}

export interface GraphNode {
  id: number;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphRel {
  id: number;
  type: string;
  start_node: number;
  end_node: number;
  properties: Record<string, unknown>;
}

/** What the engine's `renderResult` returns for a step. */
export interface FullRecording {
  kind: ResultKind;
  text: string;
  table: TableCells | null;
  graph: { nodes: GraphNode[]; rels: GraphRel[] } | null;
}

/** A step as the build replayed it. */
export interface CellResult {
  recording: FullRecording;
  /** The last statement's wire envelope, parsed (what the JSON view shows). */
  envelope: unknown;
}

export interface RenderedDiagram {
  title: string | null;
  svg: Record<Theme, string>;
}

export interface Page {
  recipe: Recipe;
  /** Each step's replayed result, by cell id. */
  cells: Map<string, CellResult>;
  /** Each diagram's renderings, by index. */
  diagrams: Map<number, RenderedDiagram>;
  /** The colour of each label the recipe's data model draws. */
  labels: Record<string, string>;
}

export interface Cookbook {
  pages: Page[];
  highlight: (code: string, lang: string) => string;
}

const LANG_ALIASES: Record<string, string> = { sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', js: 'javascript', py: 'python' };
const LANGS = ['cypher', 'python', 'shellscript', 'json', 'javascript', 'rust'];
// Code blocks stay dark in both themes.
const THEME = 'github-dark-default';

let cached: Promise<Cookbook> | null = null;

/** The cookbook, built once. */
export function cookbook(): Promise<Cookbook> {
  cached ??= build();
  return cached;
}

async function build(): Promise<Cookbook> {
  const { recipes, problems } = loadRecipes(COOKBOOK_DIR);
  if (recipes.length === 0) problems.push(`no recipes under ${COOKBOOK_DIR}`);
  const engine = await loadEngine();
  const pages: Page[] = [];
  for (const recipe of recipes) {
    const run = runRecipe(engine, recipe);
    const runProblems = [...checkRun(recipe, run), ...resultProblems(recipe, run)];
    problems.push(...runProblems.map((p) => `[${recipe.slug}] ${p}`));
    const cells = new Map<string, CellResult>(
      run.cells.map((c) => [c.id, { recording: c.recording as FullRecording, envelope: lastEnvelope(c.envelopes) }]),
    );
    const diagrams = new Map<number, RenderedDiagram>();
    const labels: Record<string, string> = {};
    const dir = `${COOKBOOK_DIR}/diagrams`;
    for (const d of recipe.diagrams) {
      try {
        diagrams.set(d.index, { title: diagramTitle(d.source), svg: readRendered(dir, recipe.slug, d) });
        Object.assign(labels, readLabels(dir, recipe.slug, d) ?? {});
      } catch (e) {
        problems.push(`[${recipe.slug}] ${(e as Error).message}`);
      }
    }
    pages.push({ recipe, cells, diagrams, labels });
  }
  if (problems.length) {
    throw new Error(`the cookbook has ${problems.length} problem(s):\n\n${problems.join('\n\n')}`);
  }

  const highlighter: Highlighter = await createHighlighter({ themes: [THEME], langs: LANGS });
  const highlight = (code: string, lang: string) => {
    const l = LANG_ALIASES[lang] ?? lang;
    const known = highlighter.getLoadedLanguages().includes(l);
    return highlighter.codeToHtml(code, { lang: known ? l : 'text', theme: THEME });
  };
  return { pages, highlight };
}

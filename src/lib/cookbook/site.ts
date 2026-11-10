// The cookbook as the website builds it: every recipe parsed and validated,
// replayed through the site's WASM engine (each step's result must match its
// recording, as `npm run cookbook:check` requires), its diagrams' renderings
// read and checked, and a highlighter for its code. Computed once per build
// and shared by every cookbook page and endpoint; any problem fails the build.
// A recipe's interactive elements (ADR-0046, elements.ts) get their recorded
// static forms here, read back against the replay and checked like a docs
// page's.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { createHighlighter, type Highlighter } from 'shiki';

import { engineVersion } from '../docs/checks/cells.ts';
import type { ElementUse, Form } from '../docs/elements.ts';
import { diagramTitle, readLabels, readRendered, RENDER_COMMAND, type Theme } from './diagrams.ts';
import { recipeForms } from './elements.ts';
import { COOKBOOK_DIR, loadRecipes } from './load.ts';
import type { Recipe, ResultKind } from './recipe.ts';
import { lastEnvelope, type TableCells } from './result-view.ts';
import { checkRun, loadEngine, resultProblems, runRecipe, WASM_DIR } from './run.ts';

export type { TableCells };

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
  /** Each element directive's recorded static form, by the directive's 1-based line. */
  elements: Map<number, { use: ElementUse; form: Form }>;
}

export interface Cookbook {
  pages: Page[];
  highlight: (code: string, lang: string) => string;
  /** The engine's size over the wire (gzipped), which a page quotes before loading it. */
  wasmGzipBytes: number;
  /** The relate version the build replayed every recipe on (the engine bar's `data-verified`). */
  verified: string;
}

const LANG_ALIASES: Record<string, string> = { sh: 'shellscript', bash: 'shellscript', shell: 'shellscript', js: 'javascript', py: 'python' };
const LANGS = ['cypher', 'python', 'shellscript', 'json', 'javascript', 'rust'];
// Light and dark Shiki themes, emitted as CSS variables; cookbook.css picks one per site theme.
const THEMES = { light: 'github-light-default', dark: 'github-dark-default' } as const;

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
    const run = await runRecipe(engine, recipe);
    const runProblems = [...checkRun(recipe, run), ...run.expandProblems, ...resultProblems(recipe, run)];
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
        problems.push(`[${recipe.slug}] ${(e as Error).message}; render again: ${RENDER_COMMAND}`);
      }
    }
    let elements = new Map<number, { use: ElementUse; form: Form }>();
    if (!runProblems.length) {
      try {
        elements = recipeForms(recipe, run.cells);
      } catch (e) {
        problems.push(...(e as Error).message.split('\n').map((m) => `[${recipe.slug}] ${m}`));
      }
    }
    pages.push({ recipe, cells, diagrams, labels, elements });
  }
  if (problems.length) {
    throw new Error(`the cookbook has ${problems.length} problem(s):\n\n${problems.join('\n\n')}`);
  }

  const highlighter: Highlighter = await createHighlighter({ themes: [THEMES.light, THEMES.dark], langs: LANGS });
  const highlight = (code: string, lang: string) => {
    const l = LANG_ALIASES[lang] ?? lang;
    const known = highlighter.getLoadedLanguages().includes(l);
    return highlighter.codeToHtml(code, { lang: known ? l : 'text', themes: THEMES, defaultColor: false });
  };
  const wasmGzipBytes = gzipSync(readFileSync(join(WASM_DIR, 'relate_bg.wasm'))).length;
  return { pages, highlight, wasmGzipBytes, verified: engineVersion(engine) };
}

// Cookbook → playground hand-off (ADR-0130, ADR-0134).
//
// A cookbook cell links to the playground, `playground/#recipe=<slug>&cell=<id>`
// beside `cookbook/` under the site root. The playground fetches
// `../cookbook/<slug>/recipe.json`, relative to itself (written by the site's
// src/pages/cookbook/[slug]/recipe.json.ts, format 1), asks the reader to confirm, replays
// the steps before the target cell, and puts the target cell in the editor
// unrun. A recipe page's "Open in playground" links to `#recipe=<slug>` with no
// cell: the playground runs every step and leaves the editor empty.
//
// A docs page's cells link the same way, `#docs=<page>&cell=<id>` (the page id,
// `get-started/first-graph`), and its engine bar `#docs=<page>`. The playground
// reads the page's markdown twin, `../docs/<page>.md`, whose ```cypher run
// fences are the cells and whose ```json data=<name> blocks their parameters
// (src/lib/cookbook/cells.ts, shared with the docs build), so the hand-off is
// the same text an agent reads. A block over 2 KiB is a stub in the twin
// (```json data=<name> src=<url>, ADR-0048): the playground fetches its file,
// `../docs/<page>/data/<name>.json` on this site, and checks its size and
// SHA-256 against the stub before the engine sees it.

import { twinCells, type TwinDataRef } from '../../../src/lib/cookbook/cells.ts';

/** The recipe.json format this reads. */
export const RECIPE_FORMAT = 1;

export interface RecipeCell {
  id: string;
  /** The heading the step sits under in the recipe; optional in format 1. */
  title?: string;
  code: string;
  /** Path of the step's JSON parameter file, relative to the recipe page; for a docs cell, its parameters block's name. */
  paramsPath: string | null;
  setup: boolean;
  expectError: boolean;
}

/** Where a hand-off comes from: a cookbook recipe, or a docs page. */
export type RecipeSource = 'recipe' | 'docs';

export interface Recipe {
  source: RecipeSource;
  slug: string;
  title: string;
  cells: RecipeCell[];
  /** A docs page's parameters blocks by name (JSON text); a recipe fetches its files instead. */
  params?: Record<string, string>;
  /** A docs page's parameters blocks its twin links instead of carrying, by name. */
  paramRefs?: Record<string, TwinDataRef>;
}

export interface RecipeLink {
  source: RecipeSource;
  /** The recipe's slug, or the docs page's id. */
  slug: string;
  /** The step to open; null opens the whole recipe. */
  cell: string | null;
}

/** What the dialog and messages call a source and its parts. */
export const NOUNS: Record<RecipeSource, { whole: string; part: string; parts: string }> = {
  recipe: { whole: 'recipe', part: 'step', parts: 'steps' },
  docs: { whole: 'page', part: 'cell', parts: 'cells' },
};

/**
 * What loading a link does: replay `replay` in order, then, for a step link,
 * put `target` in the editor.
 */
export type RecipePlan =
  | { kind: 'whole'; recipe: Recipe; replay: RecipeCell[] }
  | { kind: 'step'; recipe: Recipe; replay: RecipeCell[]; target: RecipeCell };

const ID = /^[a-z0-9-]+$/;
/** A docs page id: lowercase path segments (`_example/example`, `get-started/first-graph`). */
const PAGE_ID = /^[a-z0-9_][a-z0-9_-]*(?:\/[a-z0-9_][a-z0-9_-]*)*$/;
const CELL_ID = /^[A-Za-z0-9_-]+$/;

/** `#recipe=<slug>[&cell=<id>]` or `#docs=<page>[&cell=<id>]` → the link, or null for any other hash. */
export function parseRecipeLink(hash: string): RecipeLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const cell = params.get('cell');
  const slug = params.get('recipe');
  if (slug !== null) {
    if (!ID.test(slug)) return null;
    if (cell !== null && !ID.test(cell)) return null;
    return { source: 'recipe', slug, cell };
  }
  const page = params.get('docs');
  if (page === null || !PAGE_ID.test(page)) return null;
  if (cell !== null && !CELL_ID.test(cell)) return null;
  return { source: 'docs', slug: page, cell };
}

/** The plan for `link`, or null when the recipe has no step with its id. */
export function resolveRecipeLink(recipe: Recipe, link: RecipeLink): RecipePlan | null {
  if (link.cell === null) return { kind: 'whole', recipe, replay: recipe.cells };
  const index = recipe.cells.findIndex((c) => c.id === link.cell);
  if (index < 0) return null;
  return { kind: 'step', recipe, replay: recipe.cells.slice(0, index), target: recipe.cells[index] };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function isRecipeCell(v: unknown): v is RecipeCell {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    (v.title === undefined || typeof v.title === 'string') &&
    typeof v.code === 'string' &&
    (v.paramsPath === null || typeof v.paramsPath === 'string') &&
    typeof v.setup === 'boolean' &&
    typeof v.expectError === 'boolean'
  );
}

/** A fetched recipe.json as a Recipe; throws when it is another format or shape. */
export function toRecipe(json: unknown): Recipe {
  if (!isObject(json) || json.format !== RECIPE_FORMAT) {
    const format = isObject(json) ? json.format : undefined;
    throw new Error(`recipe.json has format ${String(format)}; this playground reads format ${RECIPE_FORMAT}`);
  }
  const { slug, title, cells } = json;
  if (typeof slug !== 'string' || typeof title !== 'string' || !Array.isArray(cells) || !cells.every(isRecipeCell)) {
    throw new Error('recipe.json is not a recipe (format 1)');
  }
  return { source: 'recipe', slug, title, cells };
}

/** A docs page's twin as a Recipe: its cells in page order, with their parameters blocks. */
export function docsRecipe(page: string, markdown: string): Recipe {
  const { title, cells, data, refs } = twinCells(markdown);
  if (cells.length === 0) throw new Error(`/docs/${page}.md has no runnable cells`);
  return {
    source: 'docs',
    slug: page,
    title: title ?? page,
    cells: cells.map((c) => ({
      id: c.id,
      title: c.title ?? c.id,
      code: c.code,
      paramsPath: c.params,
      setup: false,
      expectError: c.expectError,
    })),
    params: data,
    paramRefs: refs,
  };
}

/** The cookbook's root URL: a sibling of the playground on the site. */
function cookbookBase(): URL {
  return new URL('../cookbook/', document.baseURI);
}

/** The docs' root URL: a sibling of the playground on the site. */
function docsBase(): URL {
  return new URL('../docs/', document.baseURI);
}

export function recipePageUrl(link: RecipeLink): string {
  if (link.source === 'docs') {
    // A docs cell's element id is its own when it starts with `cell-` (src/lib/docs/constructs.ts).
    const hash = link.cell ? `#${link.cell.startsWith('cell-') ? link.cell : `cell-${link.cell}`}` : '';
    return new URL(`${link.slug}/${hash}`, docsBase()).href;
  }
  const hash = link.cell ? `#cell-${link.cell}` : '';
  return new URL(`${link.slug}/${hash}`, cookbookBase()).href;
}

async function fetchOk(url: URL): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname}: HTTP ${res.status}`);
  return res;
}

export async function fetchRecipe(link: RecipeLink): Promise<Recipe> {
  if (link.source === 'docs') {
    const res = await fetchOk(new URL(`${link.slug}.md`, docsBase()));
    return docsRecipe(link.slug, await res.text());
  }
  const res = await fetchOk(new URL(`${link.slug}/recipe.json`, cookbookBase()));
  return toRecipe(await res.json());
}

/** A step's parameter file, as text: passed to the engine verbatim. */
export async function fetchParams(slug: string, path: string): Promise<string> {
  const res = await fetchOk(new URL(`${slug}/${path}`, cookbookBase()));
  return res.text();
}

/** The SHA-256 of `bytes`, hex. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A linked block's file, fetched from this site (the stub's URL names the
 * canonical host; its path is the same here), as text, after checking its
 * size and SHA-256 against the stub's.
 */
export async function fetchLinkedParams(ref: TwinDataRef): Promise<string> {
  const path = new URL(ref.src).pathname;
  const res = await fetchOk(new URL(path.replace(/^\//, ''), new URL('../', document.baseURI)));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (ref.bytes !== null && bytes.length !== ref.bytes) {
    throw new Error(`${path} is ${bytes.length} bytes; the page's twin says ${ref.bytes}`);
  }
  if (ref.sha256 !== null && (await sha256Hex(bytes)) !== ref.sha256) {
    throw new Error(`${path} does not have the SHA-256 the page's twin names`);
  }
  return new TextDecoder().decode(bytes);
}

/** A step's parameters as text: a docs page's block (inline, or its linked file fetched), or a recipe's file, fetched. */
export async function recipeParams(recipe: Recipe, path: string): Promise<string> {
  if (recipe.source === 'docs') {
    const text = recipe.params?.[path];
    if (text !== undefined) return text;
    const ref = recipe.paramRefs?.[path];
    if (ref === undefined) throw new Error(`the page has no \`json data=${path}\` block`);
    return fetchLinkedParams(ref);
  }
  return fetchParams(recipe.slug, path);
}

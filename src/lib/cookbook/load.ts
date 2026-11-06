// Reading the cookbook from disk: every recipe file under the cookbook
// directory, parsed and (optionally) validated.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { parseRecipe, validateRecipe, type Recipe } from './recipe.ts';

/**
 * The repository root: the nearest directory at or above the working
 * directory that holds `src/content/cookbook`. (Not found from
 * `import.meta.url`, which points into dist/ once Astro bundles this module.)
 */
export function projectRoot(from = process.cwd()): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'src/content/cookbook'))) return dir;
    if (dirname(dir) === dir) throw new Error(`no src/content/cookbook at or above ${from}`);
  }
}

/** The repository's cookbook directory. */
export const COOKBOOK_DIR = join(projectRoot(), 'src/content/cookbook');

/** Every recipe file (`*.md` other than `README.md`) under `root`, sorted by slug. */
export function recipeFiles(root: string): string[] {
  return readdirSync(root)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && statSync(join(root, f)).isFile())
    .sort()
    .map((f) => join(root, f));
}

/**
 * The recipes under `root`, sorted by slug (only those named in `only`, when
 * given), and every problem loading or, with `validate`, validating them,
 * each prefixed with the recipe's slug.
 */
export function loadRecipes(
  root: string,
  { only = null, validate = true }: { only?: string[] | null; validate?: boolean } = {},
): { recipes: Recipe[]; problems: string[] } {
  const recipes: Recipe[] = [];
  const problems: string[] = [];
  for (const file of recipeFiles(root)) {
    const slug = basename(file, '.md');
    if (only && !only.includes(slug)) continue;
    try {
      const recipe = parseRecipe(slug, readFileSync(file, 'utf8'));
      if (validate) problems.push(...validateRecipe(recipe).map((e) => `[${slug}] ${e}`));
      recipes.push(recipe);
    } catch (e) {
      problems.push(`[${slug}] ${(e as Error).message}`);
    }
  }
  return { recipes, problems };
}

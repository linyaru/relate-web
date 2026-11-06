// The generated recipe index in src/content/cookbook/README.md.
//
// The table between INDEX_START and INDEX_END is regenerated from the
// recipes' front matter: one section per category (in CATEGORIES order), one
// row per recipe sorted by title in code-point order (the byte order of
// UTF-8, as the website sorts).

import { CATEGORIES } from './frontmatter.ts';
import type { Recipe } from './recipe.ts';

export const INDEX_START = '<!-- cookbook-index:start -->';
export const INDEX_END = '<!-- cookbook-index:end -->';

/** Compare two strings by code point (equivalently, by their UTF-8 bytes). */
export function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** The index markdown for `recipes` (without the markers). */
export function renderIndex(recipes: Recipe[]): string {
  let out = '';
  for (const category of CATEGORIES) {
    const rows = recipes
      .filter((r) => r.front.category === category)
      .sort((a, b) => byCodePoint(a.front.title, b.front.title));
    if (rows.length === 0) continue;
    out += `\n### ${category}\n\n| Recipe | What it does | Level | Runs in the browser |\n|---|---|---|---|\n`;
    for (const r of rows) {
      const browser = r.front.browser === 'full' ? 'Fully' : 'Cypher steps';
      out += `| [${r.front.title}](${r.slug}.md) | ${r.front.summary.replaceAll('|', '\\|')} | ${r.front.level} | ${browser} |\n`;
    }
  }
  return `${out}\n`;
}

/** `readme` with the index section replaced by `index`. Throws when the markers are missing. */
export function spliceIndex(readme: string, index: string): string {
  const s = readme.indexOf(INDEX_START);
  if (s < 0) throw new Error(`README.md lacks \`${INDEX_START}\``);
  const start = s + INDEX_START.length;
  const end = readme.indexOf(INDEX_END);
  if (end < 0) throw new Error(`README.md lacks \`${INDEX_END}\``);
  if (end < start) throw new Error('cookbook index markers are out of order');
  return readme.slice(0, start) + index + readme.slice(end);
}

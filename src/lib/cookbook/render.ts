// A recipe page's body as HTML: the narrative through markdown-it, with each
// fence the recipe parser found rendered as what it is (a runnable step with
// its recorded result, a diagram, or plain code; data and result blocks
// render nothing). The Astro pages wrap it in the site's layout.
//
// Pages are complete without JavaScript: every step shows its recorded
// result. The markup carries what the page runtime needs to make steps
// runnable (`<cypher-cell>` and its data attributes, the hidden Run/Edit
// buttons, editors and output tabs), so it can upgrade them in place.

import { createMarkdown, type MarkdownEnv } from './markdown.ts';
import { prepareSvg, type Theme } from './diagrams.ts';
import { byCodePoint } from './index.ts';
import { CATEGORIES, type Category } from './frontmatter.ts';
import { byteLength, dataBlock, INLINE_DATA_BYTES, narrative, type Cell, type Recipe } from './recipe.ts';
import { rewriteHref } from './links.ts';
import { canDraw, esc, tableHtml } from './result-view.ts';
import type { Cookbook, Page, RenderedDiagram } from './site.ts';

export { canDraw, esc, tableHtml };

export const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Where a data block is published, relative to its recipe page. */
export const dataPath = (name: string) => `data/${name}.json`;

/** `recipes` grouped by category, in index order, each sorted by title; empty groups left out. */
export function byCategory(recipes: Recipe[], categories: readonly Category[] = CATEGORIES) {
  return categories
    .map((category) => ({
      category,
      recipes: recipes
        .filter((r) => r.front.category === category)
        .sort((a, b) => byCodePoint(a.front.title, b.front.title)),
    }))
    .filter((g) => g.recipes.length > 0);
}

interface Env extends MarkdownEnv {
  step: number;
  codeSeq: number;
}

function renderParams(recipe: Recipe, cell: Cell, step: number): string {
  if (!cell.params) return '';
  const text = dataBlock(recipe, cell.params)!.text;
  const size = byteLength(text);
  if (size <= INLINE_DATA_BYTES) {
    const rows = Math.min(text.split('\n').length + 1, 12);
    return (
      `<details class="cell-params"><summary>Parameters</summary>` +
      `<textarea class="params-editor" rows="${rows}" spellcheck="false" aria-label="Parameters for step ${step} (JSON)">${esc(text)}</textarea></details>`
    );
  }
  const file = `/cookbook/${recipe.slug}/${dataPath(cell.params)}`;
  return `<div class="cell-params">Loads <a href="${esc(file)}">${esc(`${cell.params}.json`)}</a> (${kb(size)})</div>`;
}

function renderCell(cookbook: Cookbook, page: Page, cell: Cell, env: Env): string {
  const { recording } = page.cells.get(cell.id)!;
  const step = ++env.step;
  const attrs = [
    `id="cell-${esc(cell.id)}"`,
    `data-cell="${esc(cell.id)}"`,
    `data-step="${step}"`,
    cell.params ? `data-params="${esc(dataPath(cell.params))}"` : '',
    cell.setup ? 'data-setup' : '',
    cell.expectError ? 'data-expect-error' : '',
    `data-result-kind="${cell.result!.kind}"`,
    canDraw(recording.graph) ? 'data-has-graph' : '',
  ]
    .filter(Boolean)
    .join(' ');
  // A table result shows as an HTML table; its text form stays in the page
  // (hidden) as the recording the runtime compares with, and for Copy.
  const table = recording.table ? tableHtml(recording.table) : '';
  const body =
    `<div class="cell-code">${cookbook.highlight(cell.code, 'cypher')}</div>` +
    `<textarea class="cell-editor" spellcheck="false" hidden aria-label="Cypher for step ${step}">${esc(cell.code)}</textarea>` +
    renderParams(page.recipe, cell, step) +
    `<div class="cell-output" aria-live="polite">` +
    `<div class="out-head"><span class="out-label">${cell.expectError ? 'Expected error' : 'Recorded result'}</span>` +
    `<button class="out-copy" type="button" data-copy-target="out-${esc(cell.id)}" hidden>Copy as text</button>` +
    `<div class="out-tabs" role="tablist" hidden>` +
    `<button type="button" role="tab" data-view="text" aria-selected="true">Result</button>` +
    `<button type="button" role="tab" data-view="graph" aria-selected="false" hidden>Graph</button>` +
    `<button type="button" role="tab" data-view="json" aria-selected="false">JSON</button></div></div>` +
    `<div class="out-table"${table ? '' : ' hidden'}>${table}</div>` +
    `<pre class="out-text" id="out-${esc(cell.id)}"${table ? ' hidden' : ''}>${esc(cell.result!.text)}</pre>` +
    `<div class="out-graph" id="graph-${esc(cell.id)}" hidden></div>` +
    `<pre class="out-json" hidden></pre>` +
    `</div>`;
  const head =
    `<div class="cell-head"><span class="cell-tag">Step ${step}</span>` +
    `<div class="cell-actions">` +
    `<button class="btn primary" type="button" data-action="run" hidden>Run</button>` +
    `<button class="btn" type="button" data-action="edit" hidden>Edit</button>` +
    `</div></div>`;
  const wrapped = cell.setup ? `<details class="cell-body"><summary>Show the setup step</summary>${body}</details>` : body;
  return `<cypher-cell ${attrs}>${head}${wrapped}</cypher-cell>\n`;
}

/** A diagram: both renderings inline (CSS shows the current theme's), captioned by its accTitle. */
function renderDiagram(index: number, d: RenderedDiagram): string {
  const title = d.title ? esc(d.title) : `Diagram ${index}`;
  const art = (theme: Theme) => `<div class="diagram-art diagram-${theme}">${prepareSvg(d.svg[theme])}</div>`;
  return `<figure class="diagram">${art('light')}${art('dark')}<figcaption>${title}</figcaption></figure>\n`;
}

/** The recipe page's body, and what rendering it found: the lede and the contents. */
export function renderRecipe(cookbook: Cookbook, page: Page) {
  const { recipe } = page;
  const slugs = new Set(cookbook.pages.map((p) => p.recipe.slug));
  const md = createMarkdown({ rewriteHref: (href) => rewriteHref(href, slugs) });
  const fences = new Map(recipe.fences.map((f) => [f.line, f]));
  const env: Env = { step: 0, codeSeq: 0, lede: null, toc: [] };
  env.fence = (token, line) => {
    const fence = fences.get(recipe.bodyLine + line);
    if (!fence) {
      throw new Error(
        `[${recipe.slug}] the fence at line ${recipe.bodyLine + line} is not one the recipe parser found; ` +
          'start fences at the beginning of a line',
      );
    }
    switch (fence.kind) {
      case 'cell':
        return renderCell(cookbook, page, recipe.cells.find((c) => c.id === fence.name)!, env);
      case 'diagram':
        return renderDiagram(fence.name, page.diagrams.get(fence.name)!);
      // Data blocks are published as files; result blocks fill their step's pane.
      case 'data':
      case 'result':
        return '';
      case 'code': {
        const id = `code-${++env.codeSeq}`;
        const lang = token.info.trim().split(/\s+/)[0] || 'text';
        return (
          `<div class="code-block">${cookbook.highlight(token.content.replace(/\n$/, ''), lang)}` +
          `<textarea id="${id}" hidden>${esc(token.content)}</textarea>` +
          `<button class="copy-btn" type="button" data-copy-target="${id}" hidden>Copy</button></div>\n`
        );
      }
    }
  };
  const html = md.render(narrative(recipe), env);
  const inline = (text: string) => md.renderInline(text, env);
  return {
    html,
    lede: env.lede ? inline(env.lede) : esc(recipe.front.summary),
    toc: env.toc ?? [],
    inline,
  };
}

/** The cookbook's llms.txt; `cookbookUrl` is the cookbook's absolute URL. */
export function llmsTxt(cookbook: Cookbook, cookbookUrl: string): string {
  const lines = [
    '# Relate cookbook',
    '',
    '> Task-shaped recipes for Relate, the embedded openCypher graph database. Each recipe is one markdown file: runnable `cypher cell=<id>` steps, `json data=<name>` blocks holding their parameters, and after each step its recorded result as a `table` block or, for nodes and paths, a `gram` block. CI checks every result against the engine.',
    '',
    "A step with `params=<name>` runs with that data block's JSON object as its parameters (CLI: `--param name=<json>`; Python: `db.execute(query, params)`). Each data block is also published beside its page as `data/<name>.json`.",
    '',
  ];
  for (const g of byCategory(cookbook.pages.map((p) => p.recipe))) {
    lines.push(`## ${g.category}`, '');
    for (const r of g.recipes) lines.push(`- [${r.front.title}](${cookbookUrl}${r.slug}/index.md): ${r.front.summary}`);
    lines.push('');
  }
  return lines.join('\n');
}

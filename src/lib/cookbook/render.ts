// A recipe page's body as HTML: the narrative through markdown-it, with each
// fence the recipe parser found rendered as what it is (a runnable step with
// its recorded result, a diagram, or plain code; data and result blocks
// render nothing). The Astro pages wrap it in the site's layout.
//
// Pages are complete without JavaScript: every step shows its recorded
// result. The markup carries what the page runtime needs to make steps
// runnable (`<cypher-cell>` and its data attributes, the hidden Run/Edit
// buttons, editors and output tabs), so it can upgrade them in place.
//
// An element directive (ADR-0045) renders as the docs pages render one:
// `<docs-element>` holding its recorded static form (the children, the
// generated text, the light and dark picture, the "Live:" line) and an
// empty live pane, which the element's module fills once the page runtime
// loads it (src/scripts/docs/elements.ts).

import { createMarkdown, type MarkdownEnv } from './markdown.ts';
import { prepareSvg, type Theme } from './diagrams.ts';
import { byCodePoint } from './index.ts';
import { CATEGORIES, type Category } from './frontmatter.ts';
import { byteLength, cellTitles, dataBlock, INLINE_DATA_BYTES, narrative, verifiesSummary, type Cell, type Recipe } from './recipe.ts';
import { rewriteHref } from './links.ts';
import { canDraw, esc, tableHtml } from './result-view.ts';
import type { Cookbook, Page, RenderedDiagram } from './site.ts';
import type MarkdownIt from 'markdown-it';

export { canDraw, esc, tableHtml };

export const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Where a data block is published, relative to its recipe page. */
export const dataPath = (name: string) => `data/${name}.json`;

/**
 * The playground link for a recipe, or for one of its steps (ADR-0134): the
 * playground fetches the recipe's recipe.json, then runs every step, or the
 * steps before `cellId` with that step left in the editor.
 */
export const playgroundHref = (slug: string, cellId: string | null = null) =>
  `/playground/#recipe=${encodeURIComponent(slug)}${cellId ? `&cell=${encodeURIComponent(cellId)}` : ''}`;

// A console window: "open this step in the playground".
const PLAYGROUND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>';

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
  /** How many element directives rendered, which must be every one the parser found. */
  elementsRendered: number;
}

/** A static code block, highlighted, with its text in a hidden textarea for Copy (an element module reads it there too). */
function codeBlock(cookbook: Cookbook, env: Env, content: string, info: string): string {
  const id = `code-${++env.codeSeq}`;
  const lang = info.trim().split(/\s+/)[0] || 'text';
  return (
    `<div class="code-block">${cookbook.highlight(content.replace(/\n$/, ''), lang)}` +
    `<textarea id="${id}" hidden>${esc(content)}</textarea>` +
    `<button class="copy-btn" type="button" data-copy-target="${id}" hidden>Copy</button></div>\n`
  );
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
    `<a class="btn icon-only" href="${esc(playgroundHref(page.recipe.slug, cell.id))}" target="_blank" rel="noopener" ` +
    `title="Open this step in the playground" aria-label="Open step ${step} in the playground">${PLAYGROUND_ICON}</a>` +
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

/**
 * An element directive's host, as a docs page renders it (src/lib/docs/
 * constructs.ts): its recorded static form, then the empty live pane. The
 * markdown parts render with the recipe's markdown, in their own env (their
 * fences as code blocks; no contents entries).
 */
function renderElement(cookbook: Cookbook, page: Page, md: MarkdownIt, env: Env, line: number): string {
  const found = page.elements.get(line);
  if (!found) throw new Error(`[${page.recipe.slug}] the element directive at line ${line} has no recorded static form`);
  env.elementsRendered++;
  const { use, form } = found;
  const formEnv: MarkdownEnv = { fence: (token) => codeBlock(cookbook, env, token.content, token.info) };
  const markdown = (text: string) => (text.trim() ? md.render(text, formEnv) : '');
  const art = (theme: Theme) => `<div class="diagram-art diagram-${theme}">${prepareSvg(form.svg![theme])}</div>`;
  const figure = form.svg ? `<figure class="diagram element-figure">${art('light')}${art('dark')}<figcaption>${esc(form.caption ?? '')}</figcaption></figure>` : '';
  const live = `<p class="element-note">${md.renderInline(`Live: ${form.live}`, formEnv)}</p>`;
  return (
    `<docs-element id="element-${esc(use.id)}" data-element="${esc(use.name)}" data-element-id="${esc(use.id)}" data-attrs="${esc(JSON.stringify(use.attributes))}">` +
    `<div class="element-static">${markdown(use.children)}${markdown(form.text)}${figure}${live}</div>` +
    `<div class="element-live" hidden></div></docs-element>\n`
  );
}

/** The recipe page's body, and what rendering it found: the lede and the contents. */
export function renderRecipe(cookbook: Cookbook, page: Page) {
  const { recipe } = page;
  const slugs = new Set(cookbook.pages.map((p) => p.recipe.slug));
  const md = createMarkdown({ rewriteHref: (href) => rewriteHref(href, slugs) });
  const fences = new Map(recipe.fences.map((f) => [f.line, f]));
  const env: Env = { step: 0, codeSeq: 0, elementsRendered: 0, lede: null, toc: [] };
  env.element = (_token, line) => renderElement(cookbook, page, md, env, recipe.bodyLine + line);
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
      case 'code':
        return codeBlock(cookbook, env, token.content, token.info);
    }
  };
  const html = md.render(narrative(recipe), env);
  if (env.elementsRendered !== recipe.elements.length) {
    throw new Error(
      `[${recipe.slug}] ${recipe.elements.length - env.elementsRendered} element directive(s) did not render; ` +
        'start `:::<name>` and its closing `:::` at the beginning of a line, outside lists',
    );
  }
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

/**
 * The hand-off the playground reads (ADR-0134): format 1,
 * `{format, slug, title, verifies: {summary, cells, recorded, text}, cells: [{id, title, code, paramsPath, setup, expectError}]}`,
 * `paramsPath` relative to the recipe page. A cell's `title` is the heading
 * it sits under (`cellTitles`), which the playground labels its sample
 * queries with; `verifies` is what passing the recipe means
 * (`verifiesSummary`, DOCS-PLAN.md §3.8), which the docs MCP Worker serves
 * with each example cell. Both are optional in format 1, so a reader that
 * predates them still accepts the file. The playground checks the shape and refuses any
 * other format (playground/src/lib/recipe-link.ts).
 */
export function recipeJson(recipe: Recipe): string {
  const titles = cellTitles(recipe);
  return `${JSON.stringify(
    {
      format: 1,
      slug: recipe.slug,
      title: recipe.front.title,
      verifies: verifiesSummary(recipe),
      cells: recipe.cells.map((c) => ({
        id: c.id,
        title: titles.get(c.id) ?? c.id,
        code: c.code,
        paramsPath: c.params ? dataPath(c.params) : null,
        setup: c.setup,
        expectError: c.expectError,
      })),
    },
    null,
    2,
  )}\n`;
}

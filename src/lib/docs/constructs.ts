// The docs' prose constructs (DOCS-PLAN.md §5, ADR-0015), each defined once
// with its two renderings: `html` for the page (inside Astro's MDX compiler,
// via remark.ts) and `markdown` for the twin (twin.ts). Both walk the same
// mdast that remark-directive and remark-mdx parse, so the page and the twin
// cannot drift apart construct by construct.
//
// The vocabulary:
//   :::note / :::tip / :::warning / :::danger, optional [Title]
//       page: <aside class="callout callout-<kind>">   twin: blockquote, first line **Title** (or **Kind**; **Warning: Title** for warning and danger)
//   ::::tabs holding :::tab[Label]{key=k}
//       page: tab panels, all visible without JS        twin: one `### Label` per tab, in order
//   :term[label]{id=<glossary id>}
//       page: link to /docs/reference/glossary/#<id>    twin: the plain link (text until the glossary page is built), and the closing Terms section
//   :since[0.17], :status[preview]
//       page: badges                                     twin: "(since 0.17)", "(preview)"
//   ::figure[Caption]{src=/docs/img/x.svg alt="…"}
//       page: <figure>                                   twin: a markdown image
//   ```mermaid (pre-rendered, §7.6)
//       page: both SVGs, caption, "In words" line        twin: the fence verbatim, then its accDescr as a paragraph
//   ```cypher run [name=<id>] [params=<name>] [expect=error]
//       page: the cell with its recorded result (a static graph form for a graph), runnable with the page runtime
//                                                        twin: the fence, then a ```table (or ```gram) block, then a link to the static graph form
//   ```json data=<name> (a cell's parameters)
//       page: inside the cell that names it, editable    twin: the fence verbatim
//   ```python run / ```js run [name=<id>] [title="<file>"] (verified samples, samples.ts)
//       page: the code block, then its recorded output   twin: the fence, then a ```text block of the output
//   <Component /> (JSX, generated and interactive things only)
//       page: the Astro component                        twin: the component's toMarkdown
// Links render only when their target exists (links.ts); an unknown text
// directive (`a:b` in prose) renders as the text it was written as.

import { basename, dirname, join, relative, sep } from 'node:path';
import { existsSync } from 'node:fs';

import type { Code, Html, Image, Link, Paragraph, Parent, PhrasingContent, Root, RootContent, Text } from 'mdast';
import type { ContainerDirective, LeafDirective, TextDirective } from 'mdast-util-directive';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import { toString } from 'mdast-util-to-string';

import {
  DOCS_RENDER_COMMAND,
  diagramDescription,
  diagramProblems,
  diagramTitle,
  mermaidBlocks,
  prepareSvg,
  readRendered,
} from '../cookbook/diagrams.ts';
import type { Diagram } from '../cookbook/recipe.ts';
import { esc, tableHtml } from '../cookbook/result-view.ts';
import { DOCS_DIR, ROOT, type GlossaryTerm } from './content.ts';
import type { Highlight } from './highlight.ts';
import { absoluteUrl, resolveHref, type LinkContext } from './links.ts';
import { idFromPath, pageUrl } from './model.ts';
import {
  collectCells,
  drawsStatic,
  graphCaption,
  parseDataInfo,
  parseRunInfo,
  readResultGraph,
  readResults,
  resultsFile,
  type PageCells,
  type Results,
} from './results.ts';
import { parseSampleInfo, readSidecar, RECORD_COMMAND as SAMPLES_RECORD_COMMAND, sampleId, type SampleInfo, type Sidecar } from './samples.ts';

export const CALLOUTS = ['note', 'tip', 'warning', 'danger'] as const;
export const STATUS_BADGES = ['preview', 'deprecated'] as const;
export const GLOSSARY_ID = 'reference/glossary';
export const glossaryHref = (id: string) => `/docs/${GLOSSARY_ID}/#${id}`;

/** Props a JSX component receives, as literals. */
export type ComponentProps = Record<string, string | number | boolean | null | unknown[] | Record<string, unknown>>;
/** A JSX component's markdown rendering for the twin. */
export type ToMarkdown = (props: ComponentProps) => string;

export interface PageContext {
  /** The page's file (absolute). */
  file: string;
  /** The text the tree was parsed from (the page without its frontmatter). */
  source: string;
  links: LinkContext;
  glossary: Map<string, GlossaryTerm>;
  /** The JSX components pages may use, with their markdown renderings. */
  components: Record<string, ToMarkdown>;
  /** Highlights code for the page; not needed for the twin. */
  highlight?: Highlight;
}

/** What rendering found: the glossary terms the page links, in order of first use. */
export interface Rendered {
  terms: GlossaryTerm[];
}

type Target = 'html' | 'markdown';
type Node = RootContent;

interface State {
  target: Target;
  ctx: PageContext;
  rel: string;
  problems: string[];
  terms: Map<string, GlossaryTerm>;
  cellSeq: number;
  codeSeq: number;
  mermaidSeq: number;
  diagrams: Diagram[] | null;
  results: Results | null | undefined;
  /** Verified samples seen so far, per language (their ids are `<lang>-<n>`). */
  sampleSeq: { python: number; js: number };
  /** The sidecar as written, every entry kind kept (samples.ts); read on the first sample. */
  sidecar: Sidecar | null | undefined;
  /** The page's cells and parameters blocks, collected before rendering. */
  cells: PageCells;
}

const text = (value: string): Text => ({ type: 'text', value });
const html = (value: string): Html => ({ type: 'html', value });
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** mdast `data` that tells mdast-util-to-hast which element to make (typed loosely: the augmentation lives in a transitive package). */
const hast = (d: { hName?: string; hProperties?: Record<string, unknown> }) => d as never;

/**
 * Render the constructs of `tree` (a page's mdast) in place for `target`.
 * Throws, listing every problem on the page, when a construct is malformed,
 * a cell has no recorded result, or a diagram has no current rendering.
 */
export function renderConstructs(tree: Root, target: Target, ctx: PageContext): Rendered {
  const st: State = {
    target,
    ctx,
    rel: relative(ROOT, ctx.file),
    problems: [],
    terms: new Map(),
    cellSeq: 0,
    codeSeq: 0,
    mermaidSeq: 0,
    diagrams: null,
    results: undefined,
    sampleSeq: { python: 0, js: 0 },
    sidecar: undefined,
    cells: collectCells(tree),
  };
  // Info strings are reported where each fence renders; the rest here.
  st.problems.push(...st.cells.problems.filter((p) => !/`cypher run` takes/.test(p)));
  walk(tree, st);
  if (st.problems.length) {
    throw new Error(`${st.rel} has ${st.problems.length} problem(s):\n${st.problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return { terms: [...st.terms.values()] };
}

function walk(parent: Parent, st: State) {
  const out: Node[] = [];
  for (const child of parent.children as Node[]) out.push(...visit(child, st));
  parent.children = out as Parent['children'];
}

function visit(node: Node, st: State): Node[] {
  switch (node.type) {
    case 'containerDirective':
      return container(node, st);
    case 'leafDirective':
      return leaf(node, st);
    case 'textDirective':
      return textDirective(node, st);
    case 'code':
      return code(node, st);
    case 'link':
      return link(node, st);
    case 'image':
      if (st.target === 'markdown') node.url = absoluteUrl(node.url);
      return [node];
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return jsx(node, st);
    case 'mdxFlowExpression':
    case 'mdxTextExpression': {
      const comment = /^\s*\/\*[\s\S]*\*\/\s*$/.test(node.value);
      if (!comment) st.problems.push(`line ${line(node)}: a JS expression \`{${node.value.trim()}}\` has no markdown form; use a directive or a component`);
      return st.target === 'markdown' ? [] : [node];
    }
    case 'mdxjsEsm':
      if (st.target === 'markdown') return [];
      st.problems.push(`line ${line(node)}: pages do not import or export; the layout provides the components`);
      return [node];
    default:
      if ('children' in node) walk(node as Parent, st);
      return [node];
  }
}

const line = (node: { position?: { start: { line: number } } }) => node.position?.start.line ?? '?';

/** A directive's label (the `[…]` of a container, as its first paragraph) and its other children. */
function splitLabel(node: ContainerDirective): { label: PhrasingContent[] | null; body: Node[] } {
  const [first, ...rest] = node.children as Node[];
  if (first?.type === 'paragraph' && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
    return { label: first.children, body: rest };
  }
  return { label: null, body: node.children as Node[] };
}

function container(node: ContainerDirective, st: State): Node[] {
  const kind = node.name;
  if ((CALLOUTS as readonly string[]).includes(kind)) {
    walk(node, st);
    const { label, body } = splitLabel(node);
    const title = label && label.length ? label : [text(capitalize(kind))];
    if (st.target === 'markdown') {
      // A warning or danger keeps its kind in the twin (STYLE.md §4.9: it means data loss or security).
      const strong = label && label.length && (kind === 'warning' || kind === 'danger') ? [text(`${capitalize(kind)}: `), ...title] : title;
      return [{ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'strong', children: strong }] }, ...body] as never }];
    }
    const titleP: Paragraph = { type: 'paragraph', children: title, data: hast({ hProperties: { className: ['callout-title'] } }) };
    node.data = hast({ hName: 'aside', hProperties: { className: ['callout', `callout-${kind}`], role: 'note' } });
    node.children = [titleP, ...body] as never;
    return [node];
  }
  if (kind === 'tabs') return tabs(node, st);
  if (kind === 'tab') {
    st.problems.push(`line ${line(node)}: a \`:::tab\` belongs inside a \`::::tabs\` container`);
    return [node];
  }
  st.problems.push(`line ${line(node)}: unknown container \`:::${kind}\` (known: ${[...CALLOUTS, 'tabs'].join(', ')})`);
  return [node];
}

function tabs(node: ContainerDirective, st: State): Node[] {
  const panels: { label: PhrasingContent[]; key: string; body: Node[] }[] = [];
  for (const child of node.children as Node[]) {
    if (child.type !== 'containerDirective' || child.name !== 'tab') {
      st.problems.push(`line ${line(child)}: a \`::::tabs\` container holds only \`:::tab[Label]\` containers`);
      continue;
    }
    walk(child, st);
    const { label, body } = splitLabel(child);
    if (!label || !label.length) {
      st.problems.push(`line ${line(child)}: a tab needs a label: \`:::tab[Python]{key=python}\``);
      continue;
    }
    const labelText = toString({ type: 'paragraph', children: label });
    const key = child.attributes?.key || labelText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    panels.push({ label, key, body });
  }
  if (st.target === 'markdown') {
    return panels.flatMap((p) => [{ type: 'heading', depth: 3, children: p.label } as Node, ...p.body]);
  }
  node.data = hast({ hName: 'div', hProperties: { className: ['tabs'], dataTabs: '' } });
  node.children = panels.map((p) => ({
    type: 'containerDirective',
    name: 'tab',
    attributes: {},
    data: {
      hName: 'div',
      hProperties: { className: ['tab-panel'], dataTabKey: p.key, dataTabLabel: toString({ type: 'paragraph', children: p.label }) },
    },
    children: [{ type: 'paragraph', children: p.label, data: { hProperties: { className: ['tab-label'] } } }, ...p.body],
  })) as never;
  return [node];
}

function leaf(node: LeafDirective, st: State): Node[] {
  if (node.name !== 'figure') {
    st.problems.push(`line ${line(node)}: unknown directive \`::${node.name}\` (known: figure)`);
    return [node];
  }
  const { src, alt } = node.attributes ?? {};
  if (!src || !alt) {
    st.problems.push(`line ${line(node)}: \`::figure\` needs src and alt: \`::figure{src=/docs/img/x.svg alt="…"}\``);
    return [node];
  }
  if (src.startsWith('/') && !existsSync(join(ROOT, 'public', src))) {
    st.problems.push(`line ${line(node)}: \`::figure\` image ${src} is not in public/`);
  }
  const caption = toString(node);
  if (st.target === 'markdown') {
    const image: Image = { type: 'image', url: absoluteUrl(src), alt, title: caption || null };
    return [{ type: 'paragraph', children: [image] }];
  }
  return [
    html(
      `<figure class="figure"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" />` +
        (caption ? `<figcaption>${esc(caption)}</figcaption>` : '') +
        '</figure>',
    ),
  ];
}

function textDirective(node: TextDirective, st: State): Node[] {
  const label = toString(node);
  switch (node.name) {
    case 'term': {
      const id = node.attributes?.id;
      const term = id ? st.ctx.glossary.get(id) : undefined;
      if (!id) st.problems.push(`line ${line(node)}: \`:term[${label}]\` needs an id: \`:term[${label}]{id=…}\``);
      else if (!term) st.problems.push(`line ${line(node)}: \`:term[${label}]{id=${id}}\` names no glossary term (src/content/docs/_glossary/${id}.mdx)`);
      if (!id || !term) return [text(label)];
      if (!st.terms.has(id)) st.terms.set(id, term);
      if (st.target === 'markdown') {
        // Until the glossary page is built the twin keeps the term as text; its Terms section carries the definition.
        return st.ctx.links.pages.has(GLOSSARY_ID) ? [{ type: 'link', url: absoluteUrl(glossaryHref(id)), children: [text(label)] }] : [text(label)];
      }
      if (!st.ctx.links.pages.has(GLOSSARY_ID)) {
        // The glossary page is not built yet: keep the definition on hover, no link.
        return [{ ...node, data: { hName: 'span', hProperties: { className: ['term'], title: term.short } }, children: [text(label)] } as Node];
      }
      return [{ type: 'link', url: glossaryHref(id), children: [text(label)], data: { hProperties: { className: ['term'] } } }];
    }
    case 'since':
    case 'status': {
      if (!label) st.problems.push(`line ${line(node)}: \`:${node.name}[…]\` needs a value`);
      if (node.name === 'status' && label && !(STATUS_BADGES as readonly string[]).includes(label)) {
        st.problems.push(`line ${line(node)}: \`:status[${label}]\` is not one of ${STATUS_BADGES.join(', ')}`);
      }
      const words = node.name === 'since' ? `since ${label}` : label;
      if (st.target === 'markdown') return [text(`(${words})`)];
      return [html(`<span class="badge badge-${node.name}"${node.name === 'status' ? ` data-status="${esc(label)}"` : ''}>${esc(words)}</span>`)];
    }
    default: {
      // Not a directive the author meant (`key:value` in prose): the text as written.
      const { start, end } = node.position ?? {};
      const raw = start?.offset !== undefined && end?.offset !== undefined ? st.ctx.source.slice(start.offset, end.offset) : `:${node.name}${label ? `[${label}]` : ''}`;
      return [text(raw)];
    }
  }
}

function code(node: Code, st: State): Node[] {
  let run: { name: string | null } | null;
  try {
    run = parseRunInfo(node.lang, node.meta);
  } catch (e) {
    st.problems.push(`line ${line(node)}: ${(e as Error).message}`);
    return [node];
  }
  if (run) return cell(node, run.name, st);
  let sample: SampleInfo | null;
  try {
    sample = parseSampleInfo(node.lang, node.meta);
  } catch (e) {
    st.problems.push(`line ${line(node)}: ${(e as Error).message}`);
    return [node];
  }
  if (sample) return sampleBlock(node, sample, st);
  if (node.lang === 'mermaid') return mermaid(node, st);
  // A cell's parameters: shown inside the cell that names it.
  if (parseDataInfo(node.lang, node.meta) !== null) return st.target === 'markdown' ? [node] : [];
  if (st.target === 'markdown') return [node];
  // `title="app.py"` in the fence meta names the block's file (STYLE.md §4.6); the twin keeps the meta as written.
  const title = /(?:^|\s)title="([^"]*)"/.exec(node.meta ?? '')?.[1];
  return [html(codeBlock(node.value, node.lang || 'text', title, st))];
}

/** A plain code block on the page: highlighted, an optional file name above it, a copy button. */
function codeBlock(value: string, lang: string, title: string | null | undefined, st: State): string {
  const id = `code-${++st.codeSeq}`;
  return (
    `<div class="code-block${title ? ' has-title' : ''}">` +
    (title ? `<div class="code-title">${esc(title)}</div>` : '') +
    `${st.ctx.highlight!(value, lang)}` +
    `<textarea id="${id}" hidden>${esc(value)}</textarea>` +
    `<button class="copy-btn" type="button" data-copy-target="${id}" hidden>Copy</button></div>`
  );
}

/**
 * A verified language sample (samples.ts): the program as a code block, then
 * the output a run against the client recorded in the page's sidecar. The
 * build fails when the output is not recorded, as it does for a cell.
 */
function sampleBlock(node: Code, info: SampleInfo, st: State): Node[] {
  const id = sampleId(info, ++st.sampleSeq[info.lang]);
  if (st.sidecar === undefined) {
    try {
      st.sidecar = readSidecar(st.ctx.file);
    } catch (e) {
      st.problems.push((e as Error).message);
      st.sidecar = null;
    }
  }
  const recorded = st.sidecar?.cells[id];
  if (!recorded || recorded.kind !== 'text') {
    st.problems.push(`line ${line(node)}: sample \`${id}\` has no recorded output in ${relative(ROOT, resultsFile(st.ctx.file))}; record it: ${SAMPLES_RECORD_COMMAND}`);
    return [node];
  }
  const output = recorded.text.replace(/\n$/, '');
  // Twin: the fence as written (meta kept), then a ```text block holding the output.
  if (st.target === 'markdown') return [node, { type: 'code', lang: 'text', meta: null, value: output }];
  return [
    html(
      codeBlock(node.value, info.lang === 'js' ? 'javascript' : 'python', info.title, st) +
        `<div class="cell-output sample-output"><div class="out-head"><span class="out-label">Output</span></div>` +
        `<pre class="out-text" id="out-${esc(id)}">${esc(output)}</pre></div>`,
    ),
  ];
}

/** A docs page's id, from its file. */
const pageIdOf = (file: string) => idFromPath(relative(DOCS_DIR, file).split(sep).join('/'));

/**
 * The playground link for a docs page, or one of its cells (the sibling of the
 * cookbook's `#recipe=` hand-off): the playground reads the page's twin, runs
 * every cell, or the cells before `cellId` with that cell left in the editor.
 */
export const docsPlaygroundHref = (pageId: string, cellId: string | null = null) =>
  `/playground/#docs=${encodeURIComponent(pageId)}${cellId ? `&cell=${encodeURIComponent(cellId)}` : ''}`;

/** Where the build serves a cell's static graph form (light), for the twin. */
export const resultGraphUrl = (pageId: string, cellId: string) => `${pageUrl(pageId)}result-${cellId}-light.svg`;

// A console window: "open this cell in the playground" (as the cookbook's steps).
const PLAYGROUND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/></svg>';

/** JSON for an HTML attribute value (escaped by `esc`). */
const attrJson = (v: unknown) => esc(JSON.stringify(v));

function cell(node: Code, name: string | null, st: State): Node[] {
  const index = ++st.cellSeq;
  const id = name ?? `cell-${index}`;
  const info = st.cells.cells[index - 1];
  if (st.results === undefined) {
    try {
      st.results = readResults(st.ctx.file);
    } catch (e) {
      st.problems.push((e as Error).message);
      st.results = null;
    }
  }
  const recorded = st.results?.cells[id];
  if (!recorded) {
    st.problems.push(`line ${line(node)}: cell \`${id}\` has no recorded result in ${relative(ROOT, resultsFile(st.ctx.file))}`);
    return [node];
  }
  const expectError = info?.expectError ?? recorded.expectError ?? false;
  const graph = recorded.graph ?? null;
  const pageId = pageIdOf(st.ctx.file);
  let svg: Record<'light' | 'dark', string> | null = null;
  if (drawsStatic(graph)) {
    try {
      svg = readResultGraph(st.ctx.file, id, graph);
    } catch (e) {
      st.problems.push(`line ${line(node)}: ${(e as Error).message}`);
    }
  }
  const caption = graphCaption(info?.title ?? null);
  if (st.target === 'markdown') {
    const out: Node[] = [node, { type: 'code', lang: recorded.kind, meta: null, value: recorded.text.replace(/\n$/, '') }];
    if (drawsStatic(graph)) {
      const image: Image = { type: 'image', url: absoluteUrl(resultGraphUrl(pageId, id)), alt: caption, title: null };
      out.push({ type: 'paragraph', children: [image] });
    }
    return out;
  }
  const params = info?.params ? (st.cells.data.get(info.params) ?? null) : null;
  const drawable = (graph?.nodes.length ?? 0) > 0;
  const attrs = [
    `id="${esc(id.startsWith('cell-') ? id : `cell-${id}`)}"`,
    `data-cell="${esc(id)}"`,
    `data-step="${index}"`,
    `data-result-kind="${recorded.kind}"`,
    expectError ? 'data-expect-error' : '',
    drawable ? `data-has-graph data-graph-nodes="${graph!.nodes.length}"` : '',
    `data-recorded="${attrJson({ envelope: recorded.envelope ?? null, graph })}"`,
  ].filter(Boolean);
  const table = recorded.table ? tableHtml(recorded.table) : '';
  const rows = params === null ? 0 : Math.min(params.split('\n').length + 1, 12);
  const art = (theme: 'light' | 'dark') => `<div class="diagram-art diagram-${theme}">${prepareSvg(svg![theme])}</div>`;
  return [
    html(
      `<cypher-cell ${attrs.join(' ')}>` +
        `<div class="cell-head"><span class="cell-tag">Cypher</span><div class="cell-actions">` +
        `<button class="btn primary" type="button" data-action="run" hidden>Run</button>` +
        `<button class="btn" type="button" data-action="edit" hidden>Edit</button>` +
        `<a class="btn icon-only" href="${esc(docsPlaygroundHref(pageId, id))}" target="_blank" rel="noopener" ` +
        `title="Open this cell in the playground" aria-label="Open cell ${index} in the playground">${PLAYGROUND_ICON}</a>` +
        `</div></div>` +
        `<div class="cell-code">${st.ctx.highlight!(node.value, 'cypher')}</div>` +
        `<textarea class="cell-editor" spellcheck="false" hidden aria-label="Cypher for cell ${index}">${esc(node.value)}</textarea>` +
        (params === null
          ? ''
          : `<details class="cell-params"><summary>Parameters</summary>` +
            `<textarea class="params-editor" rows="${rows}" spellcheck="false" aria-label="Parameters for cell ${index} (JSON)">${esc(params)}</textarea></details>`) +
        `<div class="cell-output" aria-live="polite">` +
        `<div class="out-head"><span class="out-label">${expectError ? 'Expected error' : 'Recorded result'}</span>` +
        `<button class="out-copy" type="button" data-copy-target="out-${esc(id)}" hidden>Copy as text</button>` +
        `<div class="out-tabs" role="tablist" hidden>` +
        `<button type="button" role="tab" data-view="text" aria-selected="true">Result</button>` +
        `<button type="button" role="tab" data-view="graph" aria-selected="false" hidden>Graph</button>` +
        `<button type="button" role="tab" data-view="json" aria-selected="false">JSON</button></div></div>` +
        `<div class="out-table"${table ? '' : ' hidden'}>${table}</div>` +
        `<pre class="out-text" id="out-${esc(id)}"${table ? ' hidden' : ''}>${esc(recorded.text)}</pre>` +
        (svg ? `<figure class="diagram out-static">${art('light')}${art('dark')}<figcaption>${esc(caption)}</figcaption></figure>` : '') +
        `<div class="out-graph" id="graph-${esc(id)}" hidden></div>` +
        `<pre class="out-json" hidden></pre>` +
        `</div></cypher-cell>`,
    ),
  ];
}

function mermaid(node: Code, st: State): Node[] {
  const index = ++st.mermaidSeq;
  for (const p of diagramProblems(node.value)) st.problems.push(`line ${line(node)}: mermaid block ${index}: ${p}`);
  const words = diagramDescription(node.value);
  if (st.target === 'markdown') return words ? [node, { type: 'paragraph', children: [text(words)] }] : [node];
  if (st.diagrams === null) {
    try {
      st.diagrams = mermaidBlocks(st.ctx.source);
    } catch (e) {
      st.problems.push((e as Error).message);
      st.diagrams = [];
    }
  }
  const diagram = st.diagrams[index - 1];
  if (!diagram || diagram.source.trimEnd() !== node.value.trimEnd()) {
    st.problems.push(`line ${line(node)}: mermaid block ${index} is not where the diagram renderer finds it; start the fence at the beginning of a line`);
    return [node];
  }
  const slug = basename(st.ctx.file, '.mdx');
  let svg;
  try {
    svg = readRendered(join(dirname(st.ctx.file), 'diagrams'), slug, diagram);
  } catch (e) {
    st.problems.push(`${(e as Error).message}; render again: ${DOCS_RENDER_COMMAND}`);
    return [node];
  }
  const title = diagramTitle(node.value) ?? `Diagram ${index}`;
  const art = (theme: 'light' | 'dark') => `<div class="diagram-art diagram-${theme}">${prepareSvg(svg[theme])}</div>`;
  return [
    html(
      `<figure class="diagram">${art('light')}${art('dark')}<figcaption>${esc(title)}</figcaption>` +
        (words ? `<p class="diagram-words"><strong>In words:</strong> ${esc(words)}</p>` : '') +
        '</figure>',
    ),
  ];
}

function link(node: Link, st: State): Node[] {
  walk(node, st);
  const href = resolveHref(node.url, st.ctx.links);
  if (href === null) return node.children as Node[];
  node.url = st.target === 'markdown' ? absoluteUrl(href) : href;
  return [node];
}

/** A JSX attribute's value as a literal: a string, `true` for a bare name, or a JSON-like expression. */
function attributeValue(attr: MdxJsxAttribute, st: State, at: unknown): ComponentProps[string] {
  const v = attr.value;
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v;
  try {
    return JSON.parse(v.value);
  } catch {
    st.problems.push(`line ${at}: attribute \`${attr.name}={${v.value}}\` is not a literal (strings, numbers, booleans, arrays, objects)`);
    return null;
  }
}

function jsx(node: MdxJsxFlowElement | MdxJsxTextElement, st: State): Node[] {
  const name = node.name;
  if (!name || /^[a-z]/.test(name)) {
    // An HTML element written as JSX: the twin keeps what is inside it.
    walk(node, st);
    return st.target === 'markdown' ? (node.children as Node[]) : [node];
  }
  const toMarkdown = st.ctx.components[name];
  if (!toMarkdown) {
    st.problems.push(`line ${line(node)}: <${name}> is not a docs component (known: ${Object.keys(st.ctx.components).join(', ') || 'none'})`);
    return [node];
  }
  if (st.target === 'html') return [node];
  const props: ComponentProps = {};
  for (const attr of node.attributes) {
    if (attr.type !== 'mdxJsxAttribute') {
      st.problems.push(`line ${line(node)}: <${name}> takes plain attributes, not a spread`);
      continue;
    }
    props[attr.name] = attributeValue(attr, st, line(node));
  }
  const md = toMarkdown(props).trim();
  return md ? [html(md)] : [];
}

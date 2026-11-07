// Recipe diagrams (ADR-0135): ```mermaid blocks in the recipe, rendered
// ahead of time to light and dark SVG files in src/content/cookbook/diagrams/
// (for a docs page, in a diagrams/ directory beside the page; DOCS-PLAN.md
// 7.6), plus, for a data model, the colour of each label it draws (a labels
// file), which the result graph view uses. The page inlines the SVGs, so this reads
// them back only when they were rendered from the block's current source and
// hold nothing that can run, fetch, or navigate.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { defaultTreeAdapter, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

import type { Diagram } from './recipe.ts';

type ChildNode = DefaultTreeAdapterMap['childNode'];

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** SHA-256 of a diagram's source, ignoring trailing whitespace. */
export const sourceHash = (source: string) => createHash('sha256').update(source.trimEnd()).digest('hex');

/** The file a diagram renders to, relative to the diagrams directory. */
export const diagramFile = (slug: string, index: number, theme: Theme) => `${slug}-${index}-${theme}.svg`;

/** The file a data model's label colours go to, beside its renderings. */
export const labelsFile = (slug: string, index: number) => `${slug}-${index}-labels.json`;

/** Every file a diagram can render to: an SVG per theme, and its labels. */
export const diagramFiles = (slug: string, index: number) => [
  ...THEMES.map((t) => diagramFile(slug, index, t)),
  labelsFile(slug, index),
];

/** Whether `name`, in the diagrams directory, is a file of a diagram of `slug`. */
export function isDiagramFileOf(slug: string, name: string): boolean {
  const index = name.startsWith(`${slug}-`) ? /^(\d+)-/.exec(name.slice(slug.length + 1))?.[1] : undefined;
  return index !== undefined && diagramFiles(slug, Number(index)).includes(name);
}

/** The command that brings every rendering up to date. */
export const RENDER_COMMAND = 'npm run cookbook:diagrams';

/** The same for the docs pages, whose renderings sit in a `diagrams/` directory beside each page. */
export const DOCS_RENDER_COMMAND = 'npm run docs:diagrams';

/** The comment that opens a rendered file and records its source. */
export const hashComment = (hash: string) => `<!-- mermaid source sha256:${hash} -->`;

/** The name a diagram gives itself with `accTitle:`, or null. */
export const diagramTitle = (source: string) => /^\s*accTitle:\s*(.+?)\s*$/m.exec(source)?.[1] ?? null;

/**
 * What a diagram says it shows, from its multi-line `accDescr { … }` block
 * (the `{` ending its line, the `}` on a line of its own), as one paragraph;
 * null when it has none. A single-line `accDescr:` does not count.
 */
export function diagramDescription(source: string): string | null {
  const body = /^[ \t]*accDescr[ \t]*\{[ \t]*\r?\n([^}]*?)\r?\n[ \t]*\}[ \t]*$/m.exec(source)?.[1];
  const text = body
    ?.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
  return text || null;
}

/**
 * What a diagram lacks for a reader who cannot see it (DOCS-PLAN.md 7.6): an
 * `accTitle:` line and a multi-line `accDescr { … }` block. Empty when it has
 * both.
 */
export function diagramProblems(source: string): string[] {
  const out: string[] = [];
  if (diagramTitle(source) === null) out.push('it has no `accTitle:` line (its caption and accessible name)');
  if (diagramDescription(source) === null) {
    out.push(
      /^[ \t]*accDescr[ \t]*:/m.test(source)
        ? 'its `accDescr:` is a single line; write a multi-line `accDescr {` … `}` block instead'
        : 'it has no multi-line `accDescr {` … `}` block (two to four sentences saying what the picture shows)',
    );
  }
  return out;
}

/**
 * The ```mermaid (or ~~~mermaid) blocks of a markdown or MDX page, in order,
 * numbered from 1, the way the recipe parser numbers a recipe's. Every other
 * fence is skipped whole, so a mermaid block quoted inside one is not a
 * diagram. A fence may be indented (inside a list, say); its body loses that
 * indentation, as a markdown parser strips it, so the hash matches the code
 * node's value. Throws on an unclosed fence.
 */
export function mermaidBlocks(text: string): Diagram[] {
  const lines = text.split(/\r?\n/);
  const out: Diagram[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) continue;
    const [, indent, fence, info] = open;
    if (fence[0] === '`' && info.includes('`')) continue; // inline code, not a fence
    const close = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j === lines.length) throw new Error(`line ${i + 1}: unclosed code fence`);
    if (info.trim().split(/\s+/)[0] === 'mermaid') {
      const source = lines
        .slice(i + 1, j)
        .map((l) => l.replace(new RegExp(`^[ \\t]{0,${indent.length}}`), ''))
        .join('\n')
        .replace(/\n+$/, '');
      out.push({ index: out.length + 1, source, line: i + 1 });
    }
    i = j;
  }
  return out;
}

// The text of the rendered file at `path` after its hash comment, or null
// when the comment records another source than `diagram`'s.
function renderedBody(path: string, diagram: Diagram): string | null {
  const text = readFileSync(path, 'utf8');
  const head = `${hashComment(sourceHash(diagram.source))}\n`;
  return text.startsWith(head) ? text.slice(head.length) : null;
}

/** Whether a diagram's `theme` rendering in `dir` is there and from its current source. */
export function isFresh(dir: string, slug: string, diagram: Diagram, theme: Theme): boolean {
  const path = join(dir, diagramFile(slug, diagram.index, theme));
  return existsSync(path) && renderedBody(path, diagram) !== null;
}

/** Write a data model's label colours (label → #RRGGBB) to `dir`, with the hash of the source they came from. */
export function writeLabels(dir: string, slug: string, diagram: Diagram, labels: Record<string, string>) {
  const record = { source: sourceHash(diagram.source), labels };
  writeFileSync(join(dir, labelsFile(slug, diagram.index)), `${JSON.stringify(record, null, 2)}\n`);
}

// The build parses each rendering the way the browser will (parse5 is a
// spec-compliant HTML parser) and accepts only the elements, attributes, and
// CSS that the renderer emits.
const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'style', 'title', 'desc', 'marker', 'filter', 'fedropshadow',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'text', 'tspan', 'foreignobject',
]);
// HTML inside a foreignObject label.
const HTML_ELEMENTS = new Set(['div', 'span', 'p', 'br', 'b', 'i', 'em', 'strong', 'small', 'code']);
const ATTRIBUTES = new Set([
  'id', 'class', 'style', 'role', 'xmlns', 'viewbox', 'transform', 'transform-origin',
  'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'dx', 'dy', 'width', 'height', 'points',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'alignment-baseline',
  'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight', 'markerunits', 'orient', 'refx', 'refy',
  'stddeviation', 'flood-color', 'flood-opacity',
]);
const CSS_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'var', 'calc', 'drop-shadow', 'rotate', 'scale', 'translate', 'url']);

/** Why `css` could fetch something, or null: escapes, @-rules other than @keyframes, and unknown functions are out. */
function cssProblem(css: string): string | null {
  if (css.includes('\\')) return 'a CSS escape';
  if (/@(?!keyframes\b)/i.test(css)) return 'a CSS @-rule';
  for (const m of css.matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!CSS_FUNCTIONS.has(m[1].toLowerCase())) return `the CSS function ${m[1]}()`;
  }
  if (/url\(\s*(?!['"]?#)/i.test(css)) return 'a url() that is not a fragment';
  return null;
}

const tree = defaultTreeAdapter;

function nodeProblem(node: ChildNode): string | null {
  if (tree.isTextNode(node)) {
    const parent = node.parentNode;
    return parent && tree.isElementNode(parent) && parent.tagName === 'style' ? cssProblem(node.value) : null;
  }
  if (!tree.isElementNode(node)) return null; // a comment
  const html = node.namespaceURI === 'http://www.w3.org/1999/xhtml';
  if (!(html ? HTML_ELEMENTS : SVG_ELEMENTS).has(node.tagName.toLowerCase())) return `the element <${node.tagName}>`;
  for (const { prefix, name: local, value } of node.attrs) {
    const name = prefix ? `${prefix}:${local}` : local;
    const n = name.toLowerCase();
    if (!ATTRIBUTES.has(n) && !/^(aria|data)-[a-z0-9-]+$/.test(n)) return `the attribute ${name}`;
    if (n === 'style' || /url\(/i.test(value)) {
      const why = cssProblem(value);
      if (why) return `${why} in ${name}`;
    }
  }
  for (const child of node.childNodes) {
    const why = nodeProblem(child);
    if (why) return why;
  }
  return null;
}

// The page puts each rendering inside a <div>; parse it in that context, as
// the browser will.
const PAGE_CONTEXT = parseFragment('<div></div>').childNodes[0] as DefaultTreeAdapterMap['element'];

/**
 * `svg` as the page will inline it: parsed as the browser will parse it,
 * checked, and serialized from the checked tree, so what ships is exactly
 * what was checked. Throws, naming `where`, unless it is one inert <svg>.
 */
export function inertSvg(svg: string, where: string): string {
  const fragment = parseFragment(PAGE_CONTEXT, svg, {});
  const nodes = fragment.childNodes.filter(
    (n) => !(tree.isTextNode(n) && !n.value.trim()) && !tree.isCommentNode(n),
  );
  const root = nodes[0];
  if (nodes.length !== 1 || !tree.isElementNode(root) || root.tagName !== 'svg') {
    throw new Error(`${where} is not a single <svg> element`);
  }
  const why = nodeProblem(root);
  if (why) throw new Error(`${where} holds ${why}; renderings must be inert`);
  fragment.childNodes = [root];
  return serialize(fragment);
}

/**
 * The rendered SVGs of a recipe's diagram, by theme, read from `dir`. Throws
 * when a file is missing, was rendered from a different source, or holds
 * anything active.
 */
export function readRendered(dir: string, slug: string, diagram: Diagram): Record<Theme, string> {
  const out = {} as Record<Theme, string>;
  for (const theme of THEMES) {
    const path = join(dir, diagramFile(slug, diagram.index, theme));
    if (!existsSync(path)) throw new Error(`diagram ${diagram.index} of ${slug} has no ${theme} rendering (${path})`);
    const body = renderedBody(path, diagram);
    if (body === null) throw new Error(`diagram ${diagram.index} of ${slug} changed since it was rendered (${path})`);
    out[theme] = inertSvg(body, path);
  }
  return out;
}

/**
 * The label colours of a recipe's diagram read from `dir`: {label: "#RRGGBB"};
 * null when it has no labels file (it is not a data model). Throws when the
 * file was written for a different source or does not map labels to colours.
 */
export function readLabels(dir: string, slug: string, diagram: Diagram): Record<string, string> | null {
  const path = join(dir, labelsFile(slug, diagram.index));
  if (!existsSync(path)) return null;
  let record: { source?: unknown; labels?: unknown };
  try {
    record = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}`);
  }
  if (record?.source !== sourceHash(diagram.source)) {
    throw new Error(`diagram ${diagram.index} of ${slug} changed since its labels were rendered (${path})`);
  }
  const { labels } = record;
  const ok =
    labels !== null &&
    typeof labels === 'object' &&
    !Array.isArray(labels) &&
    Object.values(labels).every((c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c));
  if (!ok) throw new Error(`${path} does not map labels to #RRGGBB colours`);
  return labels as Record<string, string>;
}

/**
 * Record a rendered SVG's natural width (the renderer's `max-width`) as
 * `--natural-width`, so narrow screens can draw it at a readable size and
 * scroll instead of shrinking it.
 */
export const prepareSvg = (svg: string) =>
  svg.replace(/^(<svg\b[^>]*?style=")max-width: ([\d.]+)px;/, (_, head, w) => `${head}max-width: ${w}px; --natural-width: ${w}px;`);

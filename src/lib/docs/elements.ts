// Interactive elements on docs pages (DOCS-PLAN.md §7, the docs README
// "Interactive elements"): the build side of the framework. An element is a
// container directive named after it (`:::plan{cell=nearest}` … `:::`)
// whose children are the authored part of its static form. Each element is
// a set of files found by directory, so adding one edits no shared file:
//
//   src/lib/docs/elements/<name>.ts        build: `live`, `validate`, `staticForm` (ElementSpec, the default export)
//   src/scripts/docs/elements/<name>.ts    browser: `mount(ctx)`, a lazy chunk (src/scripts/docs/elements.ts loads it)
//   src/scripts/docs/elements/<name>.css   its styles, imported by the browser module
//   scripts/browser-cases/<name>.ts        its cookbook:browser cases
//
// Static forms are recorded, not drawn at build: `node scripts/docs.ts
// --record` runs each element's `staticForm` and writes what it returns to
// the page's diagrams/ sidecar, beside the cells' static graph forms:
//
//   diagrams/<page>-element-<id>.json          {format, element, hash, inputs, live, engine, text, caption, svg, svgSha256, textSha256}
//   diagrams/<page>-element-<id>-<theme>.svg   light and dark, when the element has a picture
//
// Each is stamped with the hash of everything the static form was made from
// (the element's build file and the helpers it imports from
// src/lib/docs/elements/, element-kit.ts, the directive's attributes and
// children, the page's recordings and data blocks, the site's colour tokens
// when there is a picture, and the extra files the element names in
// `inputs`), so the build and docs:check read the files, recompute the hash,
// and fail on a missing or stale one without running any element code. The
// JSON also holds each picture's SHA-256 and one of its own words (`text`,
// `live`, `caption`), so a picture or a text-only form edited by hand fails
// too. That keeps the page build synchronous and the same in Node and in
// Vite.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Parent, Root, RootContent } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { inertSvg, THEMES, type Theme } from '../cookbook/diagrams.ts';
import { siteTokens } from '../cookbook/tokens.ts';
import { ROOT } from './content.ts';
import { parsePage } from './parse.ts';
import { collectCells, pageDiagrams, readResults, RECORD_COMMAND, type PageCell, type RecordedCell } from './results.ts';

export const ELEMENTS_DIR = join(ROOT, 'src/lib/docs/elements');
export const BROWSER_ELEMENTS_DIR = join(ROOT, 'src/scripts/docs/elements');
export const BROWSER_CASES_DIR = join(ROOT, 'scripts/browser-cases');
export const ELEMENT_KIT = join(ROOT, 'src/lib/docs/element-kit.ts');

/** An element's name: lower-case words joined by `-`; it is the directive, the file stem and the `data-element` value. */
export const ELEMENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** An element's id on its page (`id=` on the directive, else `<name>-<n>`). */
export const ELEMENT_ID = /^[A-Za-z0-9_-]+$/;
/** Directive names the other constructs own (constructs.ts); an element cannot take one. */
export const RESERVED_NAMES = ['note', 'tip', 'warning', 'danger', 'tabs', 'tab', 'agentic', 'human', 'agent', 'deeplink', 'figure', 'term', 'since', 'status'];
/** Bumped when the recorded form changes shape, so every recorded static form goes stale; it is also the JSON's `format`. */
export const ELEMENT_FORM_VERSION = 2;

// ---------------------------------------------------------------- the shape an element's build file exports

/** What an element's `validate` and `staticForm` receive. */
export interface ElementInput {
  name: string;
  /** The element's id on the page. */
  id: string;
  /** The directive's attributes, `id` included when written. */
  attributes: Record<string, string>;
  /** The authored markdown inside the directive, as written (trimmed). */
  children: string;
  page: { id: string; file: string };
  /** The page's runnable cells, in page order. */
  cells: PageCell[];
  /** The page's ```json data=<name> blocks: their JSON text, by name. */
  dataBlocks: Record<string, string>;
  /** The page's recorded cell results (the results sidecar's `cells`), by cell id. */
  recordings: Record<string, RecordedCell>;
}

/** What `staticForm` returns: the generated part of the static form. */
export interface StaticForm {
  /** Markdown shown after the authored children, on the page and in the twin ('' for none). Plain markdown with GFM: no MDX, no directives, no run fences. */
  text: string;
  /** A light and a dark SVG, both or neither: drawn at record time in the site's colours (element-kit.ts), inert. */
  svgLight?: string;
  svgDark?: string;
  /** The picture's caption: the figure's caption and the twin image's alt text. Required with an SVG. */
  caption?: string;
}

/** An element's build file's default export (`export default { … } satisfies ElementSpec`). */
export interface ElementSpec {
  /** One sentence for the "Live:" line the twin (and the static form) carries: what the element does in a browser. */
  live: string;
  /** Problems with the directive (attributes, children, the cells it names), or none. docs:check and --record run it. */
  validate?: (input: ElementInput) => string[];
  /** The generated part of the static form, from the page's recordings: never from a live run or by hand. */
  staticForm: (input: ElementInput) => StaticForm | Promise<StaticForm>;
  /** Further files (relative to the repository root) the static form reads, hashed into its stamp. */
  inputs?: string[];
  /**
   * Whether the element runs the engine (default true). An element that
   * works from the page's data alone says false: on a page without cells its
   * engine bar then stays out of sight until something starts the engine, so
   * the page makes no claim about an engine it does not use.
   */
  engine?: boolean;
}

// ---------------------------------------------------------------- the registry

/** Problems with the element files themselves: a name that is not one, or a reserved one. */
export function registryProblems(names = elementFileNames()): string[] {
  const out: string[] = [];
  for (const n of names) {
    if (!ELEMENT_NAME.test(n)) out.push(`src/lib/docs/elements/${n}.ts: an element's name is lower-case words joined by - (it is the directive)`);
    else if (RESERVED_NAMES.includes(n)) out.push(`src/lib/docs/elements/${n}.ts: \`${n}\` is another construct's directive`);
  }
  return out;
}

/** Every `<name>.ts` in a directory but helpers (`_*.ts`) and tests. */
export function moduleNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.startsWith('_') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => f.slice(0, -3))
    .sort();
}

const elementFileNames = () => moduleNames(ELEMENTS_DIR);

/** The element directives a page may use: one per build file in src/lib/docs/elements/. */
export function elementNames(): string[] {
  return elementFileNames().filter((n) => ELEMENT_NAME.test(n) && !RESERVED_NAMES.includes(n));
}

/** The element directives a page body uses, from its parsed tree (so a directive shown in a code fence is not one); none when it does not parse. */
export function elementUses(body: string, names = elementNames()): ElementUse[] {
  if (!names.length || !body.includes(':::')) return [];
  try {
    return collectElements(parsePage(body), body, new Set(names)).uses;
  } catch {
    return []; // not valid MDX: the build and the parse check report it
  }
}

/** Whether a page body uses an element directive. */
export const hasElements = (body: string, names = elementNames()): boolean => elementUses(body, names).length > 0;

/**
 * What the page shell needs to know about a page's elements: whether it has
 * any (it gets the page runtime), and whether any runs the engine (it gets
 * the engine bar in sight). A form that does not read counts as needing the
 * engine; the build reports it anyway.
 */
export function elementNeeds(file: string, body: string): { elements: boolean; engine: boolean } {
  if (!elementUses(body).length) return { elements: false, engine: false };
  try {
    return { elements: true, engine: pageForms(file, body).some(({ form }) => form.engine) };
  } catch {
    return { elements: true, engine: true };
  }
}

/** An element's build file, loaded (Node only: docs:check and --record). Throws when it does not export an ElementSpec. */
export async function loadSpec(name: string): Promise<ElementSpec> {
  const file = join(ELEMENTS_DIR, `${name}.ts`);
  const mod = (await import(pathToFileURL(file).href)) as { default?: Partial<ElementSpec> };
  const spec = mod.default;
  if (!spec || typeof spec.live !== 'string' || !spec.live.trim() || typeof spec.staticForm !== 'function') {
    throw new Error(`src/lib/docs/elements/${name}.ts must \`export default { live, staticForm, validate?, inputs? } satisfies ElementSpec\``);
  }
  if (spec.validate !== undefined && typeof spec.validate !== 'function') throw new Error(`src/lib/docs/elements/${name}.ts: \`validate\` is not a function`);
  if (spec.inputs !== undefined && (!Array.isArray(spec.inputs) || spec.inputs.some((p) => typeof p !== 'string'))) {
    throw new Error(`src/lib/docs/elements/${name}.ts: \`inputs\` is a list of paths relative to the repository root`);
  }
  if (spec.engine !== undefined && typeof spec.engine !== 'boolean') throw new Error(`src/lib/docs/elements/${name}.ts: \`engine\` is true or false`);
  return spec as ElementSpec;
}

// ---------------------------------------------------------------- directives on a page

/** One element directive on a page. */
export interface ElementUse {
  name: string;
  id: string;
  attributes: Record<string, string>;
  children: string;
  line: number | null;
}

/** The authored source of a directive's children, as written. */
function childrenSource(node: ContainerDirective, source: string): string {
  const first = node.children[0]?.position?.start.offset;
  const last = node.children.at(-1)?.position?.end.offset;
  return first === undefined || last === undefined ? '' : source.slice(first, last).replace(/\r\n/g, '\n').trim();
}

/** What a directive says about its element, and what is wrong with it; `index` is its place among the page's elements of that name (from 1). */
export function elementUse(node: ContainerDirective, source: string, index: number): { use: ElementUse; problems: string[] } {
  const problems: string[] = [];
  const attributes: Record<string, string> = {};
  for (const [k, v] of Object.entries(node.attributes ?? {})) attributes[k] = v ?? '';
  if ('class' in attributes) problems.push(`\`:::${node.name}\` takes no \`.class\``);
  const id = attributes.id || `${node.name}-${index}`;
  if (!ELEMENT_ID.test(id)) problems.push(`\`:::${node.name}\`: \`id=${id}\` is letters, digits, - and _`);
  const first = node.children[0];
  if (first?.type === 'paragraph' && (first.data as { directiveLabel?: boolean } | undefined)?.directiveLabel) {
    problems.push(`\`:::${node.name}\` takes no [label]; put a caption in its children`);
  }
  const line = node.position?.start.line ?? null;
  return { use: { name: node.name, id, attributes, children: childrenSource(node, source), line }, problems };
}

/** Every element directive on a page, in page order, with what is wrong with them (nesting, duplicate ids, labels). */
export function collectElements(tree: Root, source: string, names: Set<string> = new Set(elementNames())): { uses: ElementUse[]; problems: string[] } {
  const uses: ElementUse[] = [];
  const problems: string[] = [];
  const seq = new Map<string, number>();
  const visit = (node: Root | RootContent, inside: string | null) => {
    if (node.type === 'containerDirective' && names.has(node.name)) {
      const at = `line ${node.position?.start.line ?? '?'}`;
      if (inside) problems.push(`${at}: \`:::${node.name}\` sits inside \`:::${inside}\`; elements do not nest`);
      const index = (seq.get(node.name) ?? 0) + 1;
      seq.set(node.name, index);
      const { use, problems: p } = elementUse(node, source, index);
      problems.push(...p.map((m) => `${at}: ${m}`));
      if (uses.some((u) => u.id === use.id)) problems.push(`${at}: a second element with id \`${use.id}\``);
      uses.push(use);
      for (const c of node.children) visit(c as RootContent, node.name);
      return;
    }
    if ('children' in node) for (const c of (node as Parent).children) visit(c as RootContent, inside);
  };
  visit(tree, null);
  return { uses, problems };
}

// ---------------------------------------------------------------- recorded static forms

/** A recorded static form, as the JSON sidecar holds it. */
export interface RecordedForm {
  format: typeof ELEMENT_FORM_VERSION;
  element: string;
  hash: string;
  inputs: string[];
  live: string;
  /** The element's `engine` when it was recorded (its build file is in the hash, so the two cannot drift). */
  engine: boolean;
  text: string;
  caption: string | null;
  svg: boolean;
  /** Each picture file's SHA-256 (hash comment included), so an edit by hand fails; null without a picture. */
  svgSha256: Record<Theme, string> | null;
  /** formWordsSha256 of the form's words, so a hand edit to a text-only form fails as a picture's does. */
  textSha256: string;
}

/** The SHA-256 a recorded form's words are stamped with: its `text`, `live` and `caption`. */
export const formWordsSha256 = (rec: Pick<RecordedForm, 'text' | 'live' | 'caption'>) =>
  sha256(JSON.stringify([rec.text, rec.live, rec.caption ?? null]));

/** What the hash covers besides the directive: the page's recordings and data blocks. */
export interface FormContext {
  recordings: Record<string, RecordedCell>;
  dataBlocks: Record<string, string>;
}

export const elementFormFile = (stem: string, id: string) => `${stem}-element-${id}.json`;
export const elementSvgFile = (stem: string, id: string, theme: Theme) => `${stem}-element-${id}-${theme}.svg`;
export const elementHashComment = (hash: string) => `<!-- element sha256:${hash} -->`;

/** Whether `name`, in a diagrams/ directory, is a recorded static form of an element on the page with stem `stem`: its id, or null. */
export function elementFileId(stem: string, name: string): string | null {
  const s = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const svg = new RegExp(`^${s}-element-([A-Za-z0-9_-]+)-(?:light|dark)\\.svg$`).exec(name);
  if (svg) return svg[1];
  const json = new RegExp(`^${s}-element-([A-Za-z0-9_-]+)\\.json$`).exec(name);
  return json ? json[1] : null;
}

export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

/** The relative module specifiers a TypeScript file imports or re-exports (`import type` too: a type can carry a constant's shape). */
function relativeImports(source: string): string[] {
  const re = /(?:^|[\s;])(?:import|export)\s[^'";]*?from\s*(['"])(\.{1,2}\/[^'"]+)\1|(?:^|[\s;])import\s*(['"])(\.{1,2}\/[^'"]+)\3/g;
  return [...source.matchAll(re)].map((m) => m[2] ?? m[4]);
}

/**
 * The files an element's build file draws on besides itself, by repository
 * path: element-kit.ts, and every helper in src/lib/docs/elements/ it
 * imports, directly or through another helper. What the kit itself imports
 * is not followed (it is the shared drawing code; an element that depends on
 * one of those files closely names it in `inputs`).
 */
export function specFiles(name: string): string[] {
  const out = new Set<string>([ELEMENT_KIT]);
  const visit = (file: string) => {
    for (const spec of relativeImports(readFileSync(file, 'utf8'))) {
      const next = join(dirname(file), spec);
      if (dirname(next) !== ELEMENTS_DIR || out.has(next) || !existsSync(next)) continue;
      out.add(next);
      visit(next);
    }
  };
  const main = join(ELEMENTS_DIR, `${name}.ts`);
  if (existsSync(main)) visit(main);
  out.delete(main);
  return [...out].filter((f) => existsSync(f)).map((f) => relative(ROOT, f).split(sep).join('/')).sort();
}

/** `value` as JSON with every object's keys sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  );
}

/**
 * The hash a static form is stamped with. `picture`: whether the form has
 * SVGs, which are drawn in the site's colours, so the tokens join the hash.
 * Throws when the element's build file or an input file is missing.
 */
export function formHash(use: ElementUse, ctx: FormContext, inputs: string[], picture: boolean): string {
  const specFile = join(ELEMENTS_DIR, `${use.name}.ts`);
  if (!existsSync(specFile)) throw new Error(`\`:::${use.name}\` has no build file (src/lib/docs/elements/${use.name}.ts)`);
  const files = inputs.map((p) => {
    const abs = join(ROOT, p);
    if (!existsSync(abs)) throw new Error(`element \`${use.id}\`: its input ${p} does not exist`);
    return [p, sha256(readFileSync(abs))];
  });
  return sha256(
    canonical({
      v: ELEMENT_FORM_VERSION,
      name: use.name,
      spec: sha256(readFileSync(specFile)),
      helpers: specFiles(use.name).map((p) => [p, sha256(readFileSync(join(ROOT, p)))]),
      tokens: picture ? siteTokens() : null,
      attributes: use.attributes,
      children: use.children,
      dataBlocks: ctx.dataBlocks,
      // Language samples' entries belong to docs:samples and never feed an element.
      recordings: Object.fromEntries(Object.entries(ctx.recordings).filter(([, c]) => c.kind !== 'text')),
      inputs: files,
    }),
  );
}

/** A recorded static form, checked as the page will show it. */
export interface Form {
  live: string;
  /** Whether the element runs the engine (ElementSpec.engine). */
  engine: boolean;
  text: string;
  caption: string | null;
  svg: Record<Theme, string> | null;
}

/**
 * The recorded static form of `use` on the page at `file`. Throws when it is
 * missing, was made from other inputs than the page has now, or an SVG holds
 * anything active.
 */
export function readForm(file: string, use: ElementUse, ctx: FormContext): Form {
  const { dir, stem } = pageDiagrams(file);
  const path = join(dir, elementFormFile(stem, use.id));
  const again = `run ${RECORD_COMMAND}`;
  if (!existsSync(path)) throw new Error(`element \`${use.id}\` (\`:::${use.name}\`) has no recorded static form (${path}); ${again}`);
  let rec: RecordedForm;
  try {
    rec = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${path} is not JSON: ${(e as Error).message}; ${again}`);
  }
  if (
    rec?.format !== ELEMENT_FORM_VERSION || rec.element !== use.name || typeof rec.hash !== 'string' || !Array.isArray(rec.inputs) ||
    typeof rec.text !== 'string' || typeof rec.live !== 'string' || typeof rec.engine !== 'boolean' || typeof rec.svg !== 'boolean' ||
    (rec.svg && (typeof rec.svgSha256?.light !== 'string' || typeof rec.svgSha256?.dark !== 'string'))
  ) {
    throw new Error(`${path} is not the format ${ELEMENT_FORM_VERSION} static form of a \`:::${use.name}\`; ${again}`);
  }
  if (typeof rec.textSha256 !== 'string' || formWordsSha256(rec) !== rec.textSha256) {
    throw new Error(`element \`${use.id}\`'s recorded words (text, live line or caption) are not the ones its static form was recorded with (${path}); ${again}`);
  }
  if (formHash(use, ctx, rec.inputs, rec.svg) !== rec.hash) {
    throw new Error(
      `element \`${use.id}\` changed since its static form was recorded (its directive, the page's recordings or data, src/lib/docs/elements/${use.name}.ts or a helper it imports, element-kit.ts, the colour tokens, or an input) (${path}); ${again}`,
    );
  }
  let svg: Record<Theme, string> | null = null;
  if (rec.svg) {
    svg = {} as Record<Theme, string>;
    const head = `${elementHashComment(rec.hash)}\n`;
    for (const theme of THEMES) {
      const p = join(dir, elementSvgFile(stem, use.id, theme));
      if (!existsSync(p)) throw new Error(`element \`${use.id}\` has no ${theme} picture (${p}); ${again}`);
      const text = readFileSync(p, 'utf8');
      if (!text.startsWith(head) || sha256(text) !== rec.svgSha256![theme]) {
        throw new Error(`element \`${use.id}\`'s ${theme} picture is not the one its static form was recorded with (${p}); ${again}`);
      }
      svg[theme] = inertSvg(text.slice(head.length), p);
    }
  }
  return { live: rec.live, engine: rec.engine, text: rec.text, caption: rec.caption ?? null, svg };
}

/** Problems with what a `staticForm` returned, or none. */
export function formProblems(form: StaticForm, children: string): string[] {
  const out: string[] = [];
  if (typeof form?.text !== 'string') return ['`staticForm` returned no `text` (use \'\' for none)'];
  const hasSvg = form.svgLight !== undefined || form.svgDark !== undefined;
  if (hasSvg && (typeof form.svgLight !== 'string' || typeof form.svgDark !== 'string')) out.push('`staticForm` returned one theme of its picture; return `svgLight` and `svgDark`');
  if (hasSvg && !form.caption?.trim()) out.push('`staticForm` returned a picture without a `caption`');
  if (!children.trim() && !form.text.trim() && !hasSvg) out.push('the static form is empty: write children, or return text or a picture');
  if (/^\s{0,3}(`{3,}|~{3,})\s*\w+\s+run\b/m.test(form.text)) out.push('the generated text holds a `run` fence; it is shown, never run');
  return out;
}

/** Every element on the page at `file` (`body`: its MDX without frontmatter) with its recorded static form; throws as `readForm` does. */
export function pageForms(file: string, body: string): { use: ElementUse; form: Form }[] {
  const tree = parsePage(body);
  const { uses } = collectElements(tree, body);
  if (!uses.length) return [];
  const ctx: FormContext = { recordings: readResults(file)?.cells ?? {}, dataBlocks: Object.fromEntries(collectCells(tree).data) };
  return uses.map((use) => ({ use, form: readForm(file, use, ctx) }));
}

// ---------------------------------------------------------------- generated markdown

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

/** Generated static text as mdast nodes (plain markdown with GFM, no MDX). */
export const markdownNodes = (text: string): RootContent[] => (text.trim() ? markdownParser.parse(text).children : []);

// Interactive elements (DOCS-PLAN.md §7, elements.ts): the docs:check rules
// and the --record step for their static forms.
//
//   checkElements(site, report)   docs:check: the element files are well
//                                 named and each has its browser module and
//                                 its cookbook:browser case file; every
//                                 directive's attributes pass its element's
//                                 `validate`; every directive has a recorded
//                                 static form that is current and not empty;
//                                 no recorded form is left without its
//                                 directive; every cell word names a browser
//                                 module that exists
//   recordElements(site, ...)     --record: runs each directive's
//                                 `staticForm` and writes the form and its
//                                 pictures to the page's diagrams/ sidecar
//
// Any page may carry any element: nothing here restricts where a directive
// goes. The example page (_example/) is checked and recorded too, built or
// not: it is the framework's fixture (a --record limited by DOCS_ONLY takes
// it only when named). The constructs check reports an unknown container on
// a published page; the example page is not published, so an unknown
// container there is reported here, and a page with one keeps its recorded
// forms (a typo in a directive is fixed in the directive, not by deleting
// its form).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { CELL_WORDS } from '../../cookbook/cells.ts';
import { inertSvg, THEMES } from '../../cookbook/diagrams.ts';
import { DOCS_DIR, ROOT, splitFrontmatter, type PageFile } from '../content.ts';
import type { Root, RootContent } from 'mdast';

import {
  BROWSER_CASES_DIR,
  BROWSER_ELEMENTS_DIR,
  collectElements,
  ELEMENT_FORM_VERSION,
  elementFileId,
  elementFormFile,
  elementHashComment,
  elementNames,
  elementSvgFile,
  ELEMENTS_DIR,
  formHash,
  formWordsSha256,
  formProblems,
  loadSpec,
  readForm,
  registryProblems,
  RESERVED_NAMES,
  sha256,
  type ElementInput,
  type ElementSpec,
  type ElementUse,
  type FormContext,
  type RecordedForm,
} from '../elements.ts';
import { idFromPath } from '../model.ts';
import { parsePage } from '../parse.ts';
import { collectCells, pageDiagrams, readResults, type PageCells } from '../results.ts';
import type { Report } from './cells.ts';

/** What the elements check needs of scripts/docs.ts's Site. */
export interface ElementsSite {
  published: Map<string, PageFile>;
  /** DOCS_ONLY: when set, the example page is looked at only when it names `_example/example`. */
  only?: Set<string> | null;
}

const EXAMPLE = join(DOCS_DIR, '_example/example.mdx');
const EXAMPLE_ID = '_example/example';

interface ElementPage {
  id: string;
  file: string;
  uses: ElementUse[];
  problems: string[];
  cells: PageCells;
  /** Container directives that are neither an element nor another construct, with their lines (body lines). */
  unknown: { name: string; line: number | null }[];
  /** Lines the frontmatter takes, so body lines map to file lines. */
  offset: number;
}

/** Container directives in `tree` that name neither an element nor a construct. */
function unknownContainers(tree: Root, names: Set<string>): { name: string; line: number | null }[] {
  const out: { name: string; line: number | null }[] = [];
  const visit = (node: Root | RootContent) => {
    if (node.type === 'containerDirective' && !names.has(node.name) && !RESERVED_NAMES.includes(node.name)) {
      out.push({ name: node.name, line: node.position?.start.line ?? null });
    }
    if ('children' in node) for (const c of node.children) visit(c as RootContent);
  };
  visit(tree);
  return out;
}

/** The pages to look at: every published page, and the example page (unless DOCS_ONLY leaves it out). */
function pagesOf(site: ElementsSite): ElementPage[] {
  const files = [...site.published.values()].map((p) => p.file);
  if (existsSync(EXAMPLE) && !files.includes(EXAMPLE) && (!site.only || site.only.has(EXAMPLE_ID))) files.push(EXAMPLE);
  const names = new Set(elementNames());
  const out: ElementPage[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const { body } = splitFrontmatter(text, relative(ROOT, file));
    let tree;
    try {
      tree = parsePage(body);
    } catch {
      continue; // not valid MDX: the parse check reports it
    }
    const { uses, problems } = collectElements(tree, body, names);
    const id = idFromPath(relative(DOCS_DIR, file).split(sep).join('/'));
    out.push({
      id,
      file,
      uses,
      problems,
      cells: collectCells(tree),
      unknown: unknownContainers(tree, names),
      offset: text.slice(0, text.length - body.length).split('\n').length - 1,
    });
  }
  return out;
}

function contextOf(page: ElementPage): FormContext {
  let recordings = {};
  try {
    recordings = readResults(page.file)?.cells ?? {};
  } catch {
    // A malformed sidecar is the cells check's to report.
  }
  return { recordings, dataBlocks: Object.fromEntries(page.cells.data) };
}

const inputOf = (page: ElementPage, use: ElementUse, ctx: FormContext): ElementInput => ({
  name: use.name,
  id: use.id,
  attributes: { ...use.attributes },
  children: use.children,
  page: { id: page.id, file: page.file },
  cells: page.cells.cells,
  dataBlocks: ctx.dataBlocks,
  recordings: ctx.recordings,
});

const specs = new Map<string, Promise<ElementSpec>>();
const spec = (name: string) => {
  let s = specs.get(name);
  if (!s) specs.set(name, (s = loadSpec(name)));
  return s;
};

/** Problems a validator reports, or the exception it threw. */
function validated(sp: ElementSpec, input: ElementInput): string[] {
  try {
    return sp.validate?.(input) ?? [];
  } catch (e) {
    return [`its validate threw: ${(e as Error).message}`];
  }
}

// ---------------------------------------------------------------- check

/** docs:check: the element files, and every element directive and cell word on every page. */
export async function checkElements(site: ElementsSite, report: Report): Promise<void> {
  for (const p of registryProblems()) report(ELEMENTS_DIR, null, 'error', 'element', p);
  const names = elementNames();
  for (const name of names) {
    const file = join(ELEMENTS_DIR, `${name}.ts`);
    try {
      await spec(name);
    } catch (e) {
      report(file, null, 'error', 'element', (e as Error).message);
    }
    if (!existsSync(join(BROWSER_ELEMENTS_DIR, `${name}.ts`))) {
      report(file, null, 'error', 'element', `\`:::${name}\` has no browser module (src/scripts/docs/elements/${name}.ts exporting \`mount\`)`);
    }
    if (!existsSync(join(BROWSER_CASES_DIR, `${name}.ts`))) {
      report(file, null, 'error', 'element', `\`:::${name}\` has no cookbook:browser case file (scripts/browser-cases/${name}.ts)`);
    }
  }
  const known = names.join(', ') || 'none';
  for (const page of pagesOf(site)) {
    const at = (l: number | null) => (l === null ? null : l + page.offset);
    for (const p of page.problems) report(page.file, null, 'error', 'element', p);
    // A published page's unknown containers are the constructs check's to report.
    if (!site.published.has(page.id)) {
      for (const u of page.unknown) report(page.file, at(u.line), 'error', 'element', `unknown container \`:::${u.name}\` (elements: ${known})`);
    }
    for (const cell of page.cells.cells) {
      for (const word of Object.keys(cell.words ?? {})) {
        const module = CELL_WORDS[word].module;
        if (!existsSync(join(BROWSER_ELEMENTS_DIR, `${module}.ts`))) {
          report(page.file, at(cell.line), 'error', 'element', `cell \`${cell.id}\` carries \`${word}\`, whose browser module src/scripts/docs/elements/${module}.ts does not exist yet`);
        }
      }
    }
    const ctx = contextOf(page);
    for (const use of page.uses) {
      let sp: ElementSpec;
      try {
        sp = await spec(use.name);
      } catch {
        continue; // reported with the element's file
      }
      for (const p of validated(sp, inputOf(page, use, ctx))) report(page.file, at(use.line), 'error', 'element', `\`:::${use.name}\` (${use.id}): ${p}`);
      try {
        const form = readForm(page.file, use, ctx);
        if (!use.children && !form.text.trim() && !form.svg) report(page.file, at(use.line), 'error', 'element', `\`:::${use.name}\` (${use.id}) has an empty static form`);
      } catch (e) {
        report(page.file, at(use.line), 'error', 'element', (e as Error).message);
      }
    }
    const { dir, stem } = pageDiagrams(page.file);
    if (!existsSync(dir)) continue;
    const ids = new Set(page.uses.map((u) => u.id));
    for (const name of readdirSync(dir)) {
      const id = elementFileId(stem, name);
      if (id === null || ids.has(id)) continue;
      if (page.unknown.length) {
        const list = page.unknown.map((u) => `\`:::${u.name}\` (line ${at(u.line) ?? '?'})`).join(', ');
        report(join(dir, name), null, 'error', 'element', `a static form of element \`${id}\`, which the page does not have while it has the unknown container(s) ${list}; fix the directive (elements: ${known}) before recording`);
      } else {
        report(join(dir, name), null, 'error', 'element', `a static form of element \`${id}\`, which the page does not have; run node scripts/docs.ts --record`);
      }
    }
  }
}

// ---------------------------------------------------------------- record

/**
 * --record: each element directive's static form, made by its element's
 * `staticForm` from the page as it stands (run after the cells are
 * recorded, so it sees their new recordings). A directive whose validation
 * or form fails is reported and left as it was. Returns how many files
 * changed.
 */
export async function recordElements(site: ElementsSite, report: Report, log: (line: string) => void): Promise<number> {
  let changed = 0;
  const write = (path: string, text: string) => {
    if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
    writeFileSync(path, text);
    changed++;
    log(`wrote ${relative(ROOT, path)}`);
  };
  const remove = (path: string) => {
    if (!existsSync(path)) return;
    rmSync(path);
    changed++;
    log(`removed ${relative(ROOT, path)}`);
  };
  let recorded = 0;
  for (const page of pagesOf(site)) {
    for (const p of page.problems) report(page.file, null, 'error', 'element', `not recorded: ${p}`);
    for (const u of page.unknown) {
      if (!site.published.has(page.id)) report(page.file, u.line === null ? null : u.line + page.offset, 'error', 'element', `not recorded: unknown container \`:::${u.name}\` (elements: ${elementNames().join(', ') || 'none'})`);
    }
    const ctx = contextOf(page);
    const { dir, stem } = pageDiagrams(page.file);
    const keep = new Set<string>();
    for (const use of page.uses) {
      // A directive left unrecorded keeps whatever it had.
      const hold = () => {
        keep.add(elementFormFile(stem, use.id));
        for (const theme of THEMES) keep.add(elementSvgFile(stem, use.id, theme));
      };
      const fail = (m: string) => {
        report(page.file, use.line === null ? null : use.line + page.offset, 'error', 'element', `not recorded: \`:::${use.name}\` (${use.id}): ${m}`);
        hold();
      };
      let sp: ElementSpec;
      try {
        sp = await spec(use.name);
      } catch (e) {
        fail((e as Error).message);
        continue;
      }
      const input = inputOf(page, use, ctx);
      const invalid = validated(sp, input);
      if (invalid.length) {
        for (const m of invalid) fail(m);
        continue;
      }
      let form;
      try {
        form = await sp.staticForm(input);
      } catch (e) {
        fail(`its staticForm threw: ${(e as Error).message}`);
        continue;
      }
      const problems = formProblems(form, use.children);
      try {
        if (form.svgLight !== undefined) inertSvg(form.svgLight, `${use.id} (light)`);
        if (form.svgDark !== undefined) inertSvg(form.svgDark, `${use.id} (dark)`);
      } catch (e) {
        problems.push((e as Error).message);
      }
      if (problems.length) {
        for (const m of problems) fail(m);
        continue;
      }
      const svg = typeof form.svgLight === 'string' && typeof form.svgDark === 'string';
      let hash: string;
      try {
        hash = formHash(use, ctx, sp.inputs ?? [], svg);
      } catch (e) {
        fail((e as Error).message);
        continue;
      }
      const pictures = svg
        ? { light: `${elementHashComment(hash)}\n${form.svgLight!.trim()}\n`, dark: `${elementHashComment(hash)}\n${form.svgDark!.trim()}\n` }
        : null;
      const rec: RecordedForm = {
        format: ELEMENT_FORM_VERSION,
        element: use.name,
        hash,
        inputs: sp.inputs ?? [],
        live: sp.live.trim(),
        engine: sp.engine ?? true,
        text: form.text.trim(),
        caption: svg ? form.caption!.trim() : null,
        svg,
        svgSha256: pictures ? { light: sha256(pictures.light), dark: sha256(pictures.dark) } : null,
        textSha256: '',
      };
      rec.textSha256 = formWordsSha256(rec);
      mkdirSync(dir, { recursive: true });
      const json = elementFormFile(stem, use.id);
      keep.add(json);
      write(join(dir, json), `${JSON.stringify(rec, null, 2)}\n`);
      if (pictures) {
        for (const theme of THEMES) {
          const name = elementSvgFile(stem, use.id, theme);
          keep.add(name);
          write(join(dir, name), pictures[theme]);
        }
      }
      recorded++;
      // A form recorded now must read back as current.
      try {
        readForm(page.file, use, ctx);
      } catch (e) {
        report(page.file, null, 'error', 'element', `recorded, but it does not read back: ${(e as Error).message}`);
      }
    }
    // A page with an unknown container may hold a mistyped element: its forms stay until the directive is fixed.
    if (existsSync(dir) && !page.unknown.length) {
      for (const name of readdirSync(dir)) if (elementFileId(stem, name) !== null && !keep.has(name)) remove(join(dir, name));
    }
  }
  if (recorded) log(`recorded ${recorded} element static form(s)`);
  return changed;
}

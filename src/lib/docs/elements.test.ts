// Tests for the interactive-element framework (elements.ts, constructs.ts,
// checks/budget.ts, the cell words in cells.ts): the directive family, the
// recorded static form and its stamp, the page and twin forms, the cell
// words, and the script budget's measure.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { CELL_WORDS, parseRunInfo, wordModules } from '../cookbook/cells.ts';
import { eagerScripts, PAGE_JS_BUDGET, staticImports } from './checks/budget.ts';
import { renderConstructs, type PageContext } from './constructs.ts';
import {
  collectElements,
  ELEMENT_FORM_VERSION,
  elementFileId,
  elementFormFile,
  elementHashComment,
  elementNames,
  elementSvgFile,
  formHash,
  formWordsSha256,
  formProblems,
  hasElements,
  loadSpec,
  readForm,
  registryProblems,
  sha256,
  specFiles,
  type ElementInput,
  type RecordedForm,
} from './elements.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';

const SVG = (theme: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img"><title>${theme}</title><rect x="0" y="0" width="10" height="10"/></svg>`;

/** A scratch page whose diagrams/ holds a recorded form for each element on it (as --record writes them). */
function scratchPage(source: string, form: { text?: string; live?: string; svg?: boolean; engine?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'elements-test-'));
  const file = join(dir, 'page.mdx');
  writeFileSync(file, source);
  mkdirSync(join(dir, 'diagrams'));
  const { uses } = collectElements(parsePage(source), source);
  for (const use of uses) {
    const hash = formHash(use, { recordings: {}, dataBlocks: {} }, [], !!form.svg);
    const files = { light: `${elementHashComment(hash)}\n${SVG('light')}\n`, dark: `${elementHashComment(hash)}\n${SVG('dark')}\n` };
    const rec: RecordedForm = {
      format: ELEMENT_FORM_VERSION,
      element: use.name,
      hash,
      inputs: [],
      live: form.live ?? 'it does a thing.',
      engine: form.engine ?? true,
      text: form.text ?? '',
      caption: form.svg ? 'A picture' : null,
      svg: !!form.svg,
      svgSha256: form.svg ? { light: sha256(files.light), dark: sha256(files.dark) } : null,
      textSha256: '',
    };
    rec.textSha256 = formWordsSha256(rec);
    writeFileSync(join(dir, 'diagrams', elementFormFile('page', use.id)), JSON.stringify(rec));
    if (form.svg) for (const t of ['light', 'dark'] as const) writeFileSync(join(dir, 'diagrams', elementSvgFile('page', use.id, t)), files[t]);
  }
  return { dir, file, uses };
}

const ctx = (file: string, source: string): PageContext => ({
  file,
  source,
  links: { pages: new Set() },
  glossary: new Map(),
  components: COMPONENT_TWINS,
  highlight: (code) => `<pre>${code}</pre>`,
});
const render = (target: 'html' | 'markdown', file: string, source: string) => {
  const tree = parsePage(source);
  renderConstructs(tree, target, ctx(file, source));
  return target === 'markdown' ? stringifyMarkdown(tree) : JSON.stringify(tree);
};

const ONE = `## Rows

:::row-counts{cells="a"}
The rows, as recorded.
:::
`;

test('the registry: one directive per build file, named for it, none reserved', () => {
  assert.ok(elementNames().includes('row-counts'));
  assert.deepEqual(registryProblems(['row-counts']), []);
  assert.match(registryProblems(['Plan'])[0], /lower-case/);
  assert.match(registryProblems(['tabs'])[0], /another construct/);
});

test('hasElements finds an element directive and nothing else', () => {
  assert.ok(hasElements(ONE, ['row-counts']));
  assert.ok(hasElements('::::row-counts\n::::\n', ['row-counts']));
  assert.ok(!hasElements(':::note\nrow-counts\n:::\n', ['row-counts']));
  assert.ok(!hasElements(':::row-countsx\n:::\n', ['row-counts']));
  assert.ok(!hasElements(ONE, []));
  // A directive shown in a code fence is an example of the syntax, not an element.
  assert.ok(!hasElements('````markdown\n:::row-counts{cells="a"}\nx\n:::\n````\n', ['row-counts']));
  assert.ok(!hasElements('```markdown\n:::row-counts{cells="a"}\nx\n:::\n```\n', ['row-counts']));
});

test('collectElements: ids, attributes, children as written, and the problems', () => {
  const source = `:::row-counts
First.
:::

:::row-counts{id=second cells="a,b"}
Second, with **bold**.
:::
`;
  const { uses, problems } = collectElements(parsePage(source), source);
  assert.deepEqual(problems, []);
  assert.deepEqual(uses.map((u) => u.id), ['row-counts-1', 'second']);
  assert.deepEqual(uses[1].attributes, { id: 'second', cells: 'a,b' });
  assert.equal(uses[1].children, 'Second, with **bold**.');
  const bad = `:::row-counts[A label]{.wide}
x
:::

:::row-counts{id=dup}
:::

:::row-counts{id=dup}
:::

::::row-counts{id=outer}
:::row-counts{id=inner}
:::
::::
`;
  const found = collectElements(parsePage(bad), bad).problems.join('\n');
  assert.match(found, /takes no \[label\]/);
  assert.match(found, /takes no `\.class`/);
  assert.match(found, /a second element with id `dup`/);
  assert.match(found, /elements do not nest/);
});

test('elementFileId tells an element\'s recorded files from the other renderings', () => {
  assert.equal(elementFileId('page', 'page-element-plan-1.json'), 'plan-1');
  assert.equal(elementFileId('page', 'page-element-plan-1-dark.svg'), 'plan-1');
  assert.equal(elementFileId('page', 'page-result-ada-light.svg'), null);
  assert.equal(elementFileId('page', 'page-1-light.svg'), null);
  assert.equal(elementFileId('page', 'other-element-plan-1.json'), null);
});

test('the twin: children, the recorded text, the Live line, then the light picture', () => {
  const { file } = scratchPage(ONE, { text: '| a | b |\n| --- | --- |\n| 1 | 2 |', live: 'the bars move.', svg: true });
  const md = render('markdown', file, ONE);
  assert.match(md, /## Rows\n\nThe rows, as recorded\.\n\n\| a \| b \|\n\| - \| - \|\n\| 1 \| 2 \|\n\nLive: the bars move\.\n\n!\[A picture\]\(https:\/\/relatedb\.ai\/docs\/.*element-row-counts-1-light\.svg\)\n/);
  assert.doesNotMatch(md, /:::/);
});

test('the twin of an element without a picture has no image', () => {
  const { file } = scratchPage(ONE);
  const md = render('markdown', file, ONE);
  assert.match(md, /The rows, as recorded\.\n\nLive: it does a thing\.\n$/);
});

test('the page: the host carries its name, id and attributes, the static form and an empty live pane', () => {
  const { file } = scratchPage(ONE, { text: 'Generated.', svg: true });
  const tree = render('html', file, ONE);
  assert.match(tree, /"hName":"docs-element"/);
  assert.match(tree, /"dataElement":"row-counts","dataElementId":"row-counts-1","dataAttrs":"\{\\"cells\\":\\"a\\"\}"/);
  assert.match(tree, /"className":\["element-static"\]/);
  assert.match(tree, /diagram-light.*diagram-dark.*<figcaption>A picture<\/figcaption>/);
  assert.match(tree, /Live: it does a thing\./);
  assert.match(tree, /<div class=\\"element-live\\" hidden><\/div>/);
});

test('a missing or stale static form fails the render, and so does an unknown directive', () => {
  const { file } = scratchPage(ONE);
  const changed = ONE.replace('as recorded', 'as written');
  assert.throws(() => render('markdown', file, changed), /changed since its static form was recorded/);
  const { file: other } = scratchPage('## Nothing\n');
  assert.throws(() => render('markdown', other, ONE), /has no recorded static form/);
  assert.throws(() => render('markdown', other, ':::no-such-element\nx\n:::\n'), /unknown container `:::no-such-element`.*elements: .*row-counts/);
});

test('the stamp covers the attributes, the children, the recordings, the data blocks and the inputs', () => {
  const [use] = collectElements(parsePage(ONE), ONE).uses;
  const base = formHash(use, { recordings: {}, dataBlocks: {} }, [], false);
  assert.notEqual(formHash({ ...use, attributes: { cells: 'b' } }, { recordings: {}, dataBlocks: {} }, [], false), base);
  assert.notEqual(formHash({ ...use, children: 'Other.' }, { recordings: {}, dataBlocks: {} }, [], false), base);
  assert.notEqual(formHash(use, { recordings: { a: { kind: 'table', text: 'x' } }, dataBlocks: {} }, [], false), base);
  assert.notEqual(formHash(use, { recordings: {}, dataBlocks: { who: '{}' } }, [], false), base);
  assert.notEqual(formHash(use, { recordings: {}, dataBlocks: {} }, ['package.json'], false), base);
  // A language sample's output never feeds an element.
  assert.equal(formHash(use, { recordings: { s: { kind: 'text', text: 'out' } }, dataBlocks: {} }, [], false), base);
  assert.throws(() => formHash(use, { recordings: {}, dataBlocks: {} }, ['no/such/file'], false), /does not exist/);
  // A picture is drawn in the site's colours, so the tokens join the stamp of a form with one.
  assert.notEqual(formHash(use, { recordings: {}, dataBlocks: {} }, [], true), base);
});

test('the stamp covers element-kit.ts and the helpers a build file imports from elements/', () => {
  const files = specFiles('row-counts');
  assert.ok(files.includes('src/lib/docs/element-kit.ts'), files.join());
  assert.ok(files.every((f) => f === 'src/lib/docs/element-kit.ts' || /^src\/lib\/docs\/elements\/_/.test(f)), files.join());
});

test('readForm checks the pictures against the stamp', () => {
  const { dir, file, uses } = scratchPage(ONE, { svg: true });
  assert.ok(readForm(file, uses[0], { recordings: {}, dataBlocks: {} }).svg?.dark.includes('<title>dark</title>'));
  writeFileSync(join(dir, 'diagrams', elementSvgFile('page', 'row-counts-1', 'dark')), `${elementHashComment('0'.repeat(64))}\n${SVG('dark')}\n`);
  assert.throws(() => readForm(file, uses[0], { recordings: {}, dataBlocks: {} }), /dark picture is not the one/);
});

test('readForm fails a picture edited by hand under its hash comment', () => {
  const { dir, file, uses } = scratchPage(ONE, { svg: true });
  const path = join(dir, 'diagrams', elementSvgFile('page', 'row-counts-1', 'light'));
  writeFileSync(path, readFileSync(path, 'utf8').replace('width="10" height="10"', 'width="9" height="10"'));
  assert.throws(() => readForm(file, uses[0], { recordings: {}, dataBlocks: {} }), /light picture is not the one/);
});

test('readForm fails a text-only form edited by hand, and one recorded before its words were stamped', () => {
  const { dir, file, uses } = scratchPage(ONE, { text: 'Exit code 0' });
  const path = join(dir, 'diagrams', elementFormFile('page', 'row-counts-1'));
  const none = { recordings: {}, dataBlocks: {} };
  assert.equal(readForm(file, uses[0], none).text, 'Exit code 0');
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...rec, text: 'Exit code 3' }));
  assert.throws(() => readForm(file, uses[0], none), /recorded words .* are not the ones/);
  writeFileSync(path, JSON.stringify({ ...rec, live: 'it does another thing.' }));
  assert.throws(() => readForm(file, uses[0], none), /recorded words/);
  const { textSha256: _, ...unstamped } = rec;
  writeFileSync(path, JSON.stringify(unstamped));
  assert.throws(() => readForm(file, uses[0], none), /recorded words/);
});

test('readForm carries the element\'s engine flag', () => {
  assert.equal(readForm(scratchPage(ONE).file, collectElements(parsePage(ONE), ONE).uses[0], { recordings: {}, dataBlocks: {} }).engine, true);
  const quiet = scratchPage(ONE, { engine: false });
  assert.equal(readForm(quiet.file, quiet.uses[0], { recordings: {}, dataBlocks: {} }).engine, false);
});

test('formProblems: an empty form, half a picture, a picture without a caption, a run fence', () => {
  assert.match(formProblems({ text: '' }, '').join(), /static form is empty/);
  assert.deepEqual(formProblems({ text: '' }, 'Children.'), []);
  assert.match(formProblems({ text: 'x', svgLight: SVG('l') }, '').join(), /one theme/);
  assert.match(formProblems({ text: 'x', svgLight: SVG('l'), svgDark: SVG('d') }, '').join(), /without a `caption`/);
  assert.match(formProblems({ text: '```cypher run\nRETURN 1\n```' }, '').join(), /holds a `run` fence/);
});

test('the example element: validate and staticForm from recordings', async () => {
  const spec = await loadSpec('row-counts');
  const input: ElementInput = {
    name: 'row-counts',
    id: 'row-counts-1',
    attributes: { cells: 'a,b' },
    children: '',
    page: { id: 'x', file: 'x.mdx' },
    cells: [{ id: 'a', code: 'RETURN 1', index: 1, title: null, line: 1, name: 'a', params: null, expectError: false }],
    dataBlocks: {},
    recordings: { a: { kind: 'table', text: '', envelope: { rows: [{}, {}], error: null } } },
  };
  assert.deepEqual(spec.validate!(input), ['`cells` names `b`, which is not a cell on the page']);
  assert.match(spec.validate!({ ...input, attributes: { size: '3' } }).join(), /not `size`/);
  const form = await spec.staticForm({ ...input, attributes: { cells: 'a' } });
  assert.match(form.text, /\| `a` \| 2 \|/);
  assert.ok(form.svgLight && form.svgDark && form.caption);
  assert.notEqual(form.svgLight, form.svgDark);
});

test('cell words: the element words parse, map to their modules, and refuse anything else', () => {
  assert.deepEqual(parseRunInfo('cypher', 'run name=a timing layout=hierarchical'), { name: 'a', params: null, expectError: false, words: { timing: '', layout: 'hierarchical' } });
  assert.deepEqual(parseRunInfo('cypher', 'run highlight=path caption=name')?.words, { highlight: 'path', caption: 'name' });
  assert.equal(parseRunInfo('cypher', 'run')?.words, undefined);
  assert.throws(() => parseRunInfo('cypher', 'run layout=grid'), /not `layout=grid`/);
  assert.throws(() => parseRunInfo('cypher', 'run timing=1'), /not `timing=1`/);
  assert.throws(() => parseRunInfo('cypher', 'run caption=a-b'), /not `caption=a-b`/);
  assert.throws(() => parseRunInfo('cypher', 'run timing timing'), /takes `timing` once/);
  assert.deepEqual(wordModules({ layout: 'force', timing: '', caption: 'name' }), ['graph-extras', 'timing']);
  for (const w of Object.values(CELL_WORDS)) assert.match(w.module, /^[a-z][a-z0-9-]*$/);
});

test('the budget: static imports count, dynamic imports and data scripts do not', () => {
  assert.deepEqual(staticImports('import{a}from"./a.js";import"./b.js";export*from"./c.js";const l=()=>import("./lazy.js");export const s="./no.js";'), ['./a.js', './b.js', './c.js']);
  const files: Record<string, string> = {
    '/_astro/page.js': 'import{x}from"./shared.js";const l=()=>import("./lazy.js");',
    '/_astro/shared.js': 'export const x=1;'.padEnd(1000, ' '),
    '/_astro/lazy.js': ''.padEnd(100_000, ' '),
    '/_astro/inline-dep.js': 'export{};',
  };
  const html =
    '<script type="module" src="/_astro/page.js"></script>' +
    '<script type="module">import "/_astro/inline-dep.js"; const y = 2;</script>' +
    '<script type="application/ld+json">{"a": 1}</script>' +
    '<script type="module" src="https://elsewhere.example/x.js"></script>' +
    '<script type="module" src="/_astro/gone.js"></script>';
  const m = eagerScripts(html, '/docs/x/', (p) => files[p] ?? null);
  assert.deepEqual(m.files.map((f) => f.path).sort(), ['/_astro/inline-dep.js', '/_astro/page.js', '/_astro/shared.js']);
  assert.equal(m.inline, Buffer.byteLength('import "/_astro/inline-dep.js"; const y = 2;'));
  assert.equal(m.bytes, m.inline + files['/_astro/page.js'].length + 1000 + files['/_astro/inline-dep.js'].length);
  assert.deepEqual(m.missing, ['/_astro/gone.js']);
  assert.ok(m.bytes < PAGE_JS_BUDGET);
  // A relative src resolves against the page's path.
  assert.deepEqual(eagerScripts('<script src="../a.js"></script>', '/docs/x/', (p) => (p === '/docs/a.js' ? 'x' : null)).files, [{ path: '/docs/a.js', bytes: 1 }]);
});

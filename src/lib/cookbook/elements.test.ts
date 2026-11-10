// Interactive elements on recipe pages (ADR-0046): the parser finds the
// directives, the markdown renders them where the parser found them, the
// cookbook side turns a recipe into the framework's page, and the twin
// carries each element's static form instead of its directive.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { recipeCells, recipeTwin, recipeUses, runRecordings } from './elements.ts';
import { createMarkdown, type MarkdownEnv } from './markdown.ts';
import { narrative, parseDirectiveAttributes, parseRecipe, validateRecipe } from './recipe.ts';

const HEAD = '---\ntitle: T\nsummary: S\nlevel: Beginner\ncategory: Geospatial\nfeatures: [point]\nbrowser: full\n---\n\n# T\n\nIntro.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n';
const CELLS =
  '## Places\n\n```cypher cell=places\nRETURN 1 AS n\n```\n\n```table\nx\n```\n\n' +
  '```json data=steps\n{"steps": []}\n```\n\n';
const recipe = (body: string) => parseRecipe('t', HEAD + CELLS + body);
const parseError = (body: string) => {
  try {
    recipe(body);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('parsed');
};

test('directive attributes read as remark-directive reads them', () => {
  assert.deepEqual(parseDirectiveAttributes('{points=places radius=near}'), { points: 'places', radius: 'near' });
  assert.deepEqual(parseDirectiveAttributes('{lists="a,b" max=6 #mine .x .y bare}'), { lists: 'a,b', max: '6', id: 'mine', class: 'x y', bare: '' });
  assert.deepEqual(parseDirectiveAttributes("{q='two words'}"), { q: 'two words' });
  assert.deepEqual(parseDirectiveAttributes(undefined), {});
  assert.throws(() => parseDirectiveAttributes('{a="open}'), /cannot read the attributes/);
});

test('the parser finds element directives at column 0, with their children and lines', () => {
  const r = recipe('Before.\n\n:::agent-trace{steps=steps from=places}\n:::\n\n:::geo-explorer{points=places radius=places}\nThe places.\n:::\n');
  assert.equal(r.elements.length, 2);
  assert.deepEqual(
    r.elements.map((e) => [e.name, e.attributes, e.children]),
    [
      ['agent-trace', { steps: 'steps', from: 'places' }, ''],
      ['geo-explorer', { points: 'places', radius: 'places' }, 'The places.'],
    ],
  );
  const [first] = r.elements;
  assert.equal(r.source.split('\n')[first.line - 1], ':::agent-trace{steps=steps from=places}');
  assert.equal(r.source.split('\n')[first.endLine - 1], ':::');
  assert.equal(r.source.slice(first.start, first.end), ':::agent-trace{steps=steps from=places}\n:::\n');
});

test('a directive inside a fence is code, and a malformed one fails the parse', () => {
  assert.equal(recipe('```text\n:::geo-explorer{points=a}\n:::\n```\n').elements.length, 0);
  assert.match(parseError(':::geo-explorer{points=a}\nno close\n'), /is not closed/);
  assert.match(parseError(':::geo-explorer\n:::plan\n:::\n'), /elements do not nest/);
  assert.match(parseError('Text.\n\n:::\n'), /closes no element directive/);
  assert.match(parseError(':::geo-explorer\n```cypher\nRETURN 1\n```\n:::\n'), /an element's children are plain markdown/);
  assert.match(parseError(':::geo-explorer{a="x}\n:::\n'), /cannot read the attributes/);
});

test('a data block an element names is used, and an element after ## Data is refused', () => {
  const used = recipe(':::agent-trace{steps=steps from=places}\n:::\n');
  assert.deepEqual(validateRecipe(used), []);
  const unused = recipe('No element.\n');
  assert.deepEqual(validateRecipe(unused), ['data block `steps` is not used by any cell or element']);
  const late = recipe(':::agent-trace{steps=steps from=places}\n:::\n\n## Data\n\n:::plan{cell=places}\n:::\n');
  assert.ok(validateRecipe(late).some((p) => /sits in the `## Data` section/.test(p)));
});

test('the markdown renders a directive where the parser found it, and nowhere else', () => {
  const r = recipe('Before.\n:::geo-explorer{points=places}\nKids.\n:::\n\nAfter.\n\n- item\n\n  :::plan\n');
  const md = createMarkdown({ rewriteHref: (h) => h });
  const lines: number[] = [];
  const env: MarkdownEnv = { fence: () => '<fence>', element: (_t, line) => (lines.push(r.bodyLine + line), '<element>') };
  const html = md.render(narrative(r), env);
  // It interrupts a paragraph, as the parser reads line by line; one inside a list item is not one.
  assert.deepEqual(lines, [r.elements[0].line]);
  assert.match(html, /<p>Before.<\/p>\n<element><p>After.<\/p>/);
  assert.doesNotMatch(html, /Kids/);
  assert.throws(() => md.render(':::plan\n:::\n', { fence: () => '' }), /where none is rendered/);
});

test('a recipe as the framework\'s page: ids, unknown names, cells and recordings', () => {
  const r = recipe(':::geo-explorer{points=places}\n:::\n\n:::geo-explorer{#second points=places}\n:::\n\n:::note\n:::\n\n:::geo-explorer{.c}\n:::\n');
  const { uses, problems } = recipeUses(r, ['geo-explorer', 'plan']);
  assert.deepEqual(uses.map((u) => u.id), ['geo-explorer-1', 'second', 'geo-explorer-3'], 'the n-th of its name, as on a docs page');
  assert.ok(problems.some((p) => /`:::note` is a docs construct/.test(p)));
  assert.ok(problems.some((p) => /takes no `\.class`/.test(p)));
  assert.ok(recipeUses(r, ['plan']).problems.some((p) => /`:::geo-explorer` is no element/.test(p)));
  const cells = recipeCells(r);
  assert.deepEqual(cells.cells.map((c) => [c.id, c.index, c.title, c.params]), [['places', 1, 'Places', null]]);
  assert.equal(cells.data.get('steps'), '{"steps": []}');
  const env = '{"columns":["n"],"rows":[{"n":1}],"elapsed_ms":0.4,"parse_ms":0.1,"plan_ms":0.1,"execute_ms":0.2,"error":null}';
  const rec = runRecordings(r, [{ id: 'places', envelopes: [env], recording: { kind: 'table', text: 'x' } }]);
  assert.deepEqual(rec.places.envelope, { columns: ['n'], error: null, rows: [{ n: 1 }] }, 'timings are left out, as a docs recording leaves them');
});

test('the twin carries each element\'s static form in place of its directive', () => {
  const r = recipe('Before.\n\n:::geo-explorer{points=places}\nThe places.\n:::\n\nAfter.\n');
  const [use] = recipeUses(r, ['geo-explorer']).uses;
  const form = { live: 'it drags.', engine: true, text: 'Recorded text.', caption: 'A plane', svg: { light: '<svg/>', dark: '<svg/>' } };
  const twin = recipeTwin(r, new Map([[use.line!, { use, form }]]), 'https://relatedb.ai');
  assert.doesNotMatch(twin, /:::/);
  assert.match(twin, /Before\.\n\nThe places\.\n\nRecorded text\.\n\nLive: it drags\.\n\n!\[A plane\]\(https:\/\/relatedb\.ai\/cookbook\/t\/element-geo-explorer-1-light\.svg\)\n\nAfter\./);
  assert.throws(() => recipeTwin(r, new Map(), 'https://relatedb.ai'), /has no static form/);
});

test('a recipe\'s forms sit in the cookbook\'s diagrams/, named by its slug', async () => {
  const { pageDiagrams } = await import('../docs/results.ts');
  assert.deepEqual(pageDiagrams('/r/src/content/cookbook/nearby-places.md'), { dir: '/r/src/content/cookbook/diagrams', stem: 'nearby-places' });
  assert.deepEqual(pageDiagrams('/r/src/content/docs/guides/x.mdx'), { dir: '/r/src/content/docs/guides/diagrams', stem: 'x' });
});

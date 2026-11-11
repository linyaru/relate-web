import assert from 'node:assert/strict';
import { test } from 'node:test';

import { surprise } from './cells.ts';
import type { Category } from './frontmatter.ts';
import cases from './cells.cases.json' with { type: 'json' };
import { renderIndex, spliceIndex } from './index.ts';
import {
  cellTitles,
  INLINE_DATA_BYTES,
  isStrayHtml,
  MAX_NARRATIVE_LINES,
  narrative,
  parseRecipe,
  validateRecipe,
  verifiesSummary,
  withResults,
  type Recipe,
  type Recording,
} from './recipe.ts';

const SAMPLE =
  '---\ntitle: T\nsummary: S\nlevel: Beginner\ncategory: Maps and places\nfeatures: [point]\nbrowser: full\n---\n\n# T\n\nIntro.\n\n' +
  '```mermaid\nflowchart LR\n  A --> B\n```\n\n' +
  '```cypher cell=load setup params=rows\nUNWIND $rows AS r\nCREATE (:P {id: r.id})\n```\n\n' +
  '```table\nold\n```\n\n' +
  '```cypher\nMATCH (n) RETURN n // static, not a cell\n```\n\n' +
  '```json data=k\n{"k": 1}\n```\n\n' +
  '```cypher cell=q params=k\nMATCH (p:P) RETURN p LIMIT $k\n```\n\n' +
  'Text after.\n\n## Data\n\n<details>\n<summary><code>rows</code></summary>\n\n' +
  '```json data=rows\n{"rows": [{"id": 1}]}\n```\n\n</details>\n';

const parse = (s: string) => parseRecipe('t', s);
const parseError = (s: string) => {
  try {
    parse(s);
  } catch (e) {
    return (e as Error).message;
  }
  assert.fail('parsed');
};
const problems = (s: string) => validateRecipe(parse(s)).join('\n');

test('parses cells, data and results', () => {
  const r = parse(SAMPLE);
  assert.equal(r.heading, 'T');
  assert.equal(r.cells.length, 2);
  const [load, q] = r.cells;
  assert.equal(load.id, 'load');
  assert.ok(load.setup);
  assert.equal(load.params, 'rows');
  assert.equal(load.code, 'UNWIND $rows AS r\nCREATE (:P {id: r.id})');
  assert.deepEqual([load.result?.kind, load.result?.text], ['table', 'old']);
  assert.equal(q.result, null);
  assert.deepEqual(
    r.data.map((d) => d.name),
    ['k', 'rows'],
  );
  assert.equal(r.data[1].text, '{"rows": [{"id": 1}]}');
  assert.deepEqual(r.strayHtml, []);
  assert.ok(narrative(r).startsWith('\n# T\n'));
  assert.ok(narrative(r).endsWith('Text after.\n\n'));
  assert.equal(r.bodyLine, 9);
  assert.deepEqual(
    r.fences.map((f) => [f.line, f.kind, f.name]),
    [
      [14, 'diagram', 1],
      [19, 'cell', 'load'],
      [24, 'result', 'load'],
      [28, 'code', null],
      [32, 'data', 'k'],
      [36, 'cell', 'q'],
      [47, 'data', 'rows'],
    ],
  );
  assert.equal(r.narrativeLines, 41);
});

test('rewrites and inserts results', () => {
  const r = parse(SAMPLE);
  const recordings = new Map<string, Recording>([
    ['load', { kind: 'table', text: '(no rows)' }],
    ['q', { kind: 'gram', text: '// 1 row\n(n0:P {id: 1})' }],
  ]);
  const s = withResults(r, recordings);
  assert.ok(s.includes('```table\n(no rows)\n```\n'));
  assert.ok(s.includes('LIMIT $k\n```\n\n```gram\n// 1 row\n(n0:P {id: 1})\n```\n'));
  assert.equal(parse(s).cells[1].result?.kind, 'gram');
  // Recording again changes nothing.
  assert.equal(withResults(parse(s), recordings), s);
});

test('a result holding ``` gets a longer fence', () => {
  const s = withResults(parse(SAMPLE), new Map([['q', { kind: 'table', text: 'error: ``` here' }]]));
  assert.ok(s.includes('\n````table\nerror: ``` here\n````\n'));
  assert.equal(parse(s).cells[1].result?.text, 'error: ``` here');
});

test('results must follow a cell, and options are strict', () => {
  assert.match(parseError(SAMPLE.replace('Text after.', 'Text.\n\n```gram\nx\n```')), /must directly follow/);
  assert.match(parseError(SAMPLE.replace('params=k', 'view=graph')), /unknown cell option/);
  assert.match(parseError(SAMPLE.replace('cell=q', 'cell=load')), /duplicate cell id/);
  assert.match(parseError(SAMPLE.replace('json data=k', 'json data=rows')), /duplicate data block/);
  assert.match(parseError(SAMPLE.replace('json data=k', 'json data=K')), /expected `json data=<name>`/);
  assert.match(parseError(SAMPLE.replace('cell=q ', '')), /needs `cell=<id>`/);
  assert.match(parseError(`${SAMPLE}\n\`\`\`text\nnever closed\n`), /line 53: unclosed code fence/);
  assert.match(parseError(SAMPLE.replace(/^---\n/, '')), /must start with a `---`/);
});

test('validation catches missing and unused data, and raw HTML', () => {
  const errs = problems(SAMPLE.replace('params=k', 'params=nope'));
  assert.ok(errs.includes('no `json data=nope` block'), errs);
  assert.ok(errs.includes('data block `k` is not used'), errs);
  assert.match(problems(SAMPLE.replace('Intro.', 'Intro.\n\n<div>hi</div>')), /raw HTML/);
  assert.ok(!isStrayHtml('<summary><code>rows</code></summary>'));
  assert.ok(!isStrayHtml('a < b'));
});

test('validation checks the heading and the data', () => {
  assert.match(problems(SAMPLE.replace('# T', '# U')), /heading `U` differs from title `T`/);
  assert.match(problems(SAMPLE.replace('# T', 'T')), /no `# ` heading/);
  assert.match(problems(SAMPLE.replace('{"k": 1}', '[1]')), /`k` must be a JSON object/);
  assert.match(problems(SAMPLE.replace('{"k": 1}', '{"k": }')), /`k` is not JSON/);
});

test('validation caps the narrative but not the data', () => {
  const filler = 'Prose.\n'.repeat(MAX_NARRATIVE_LINES);
  assert.match(problems(SAMPLE.replace('Text after.', filler)), /lines before `## Data`/);
  const data = `\n{"rows": [\n${'{"id": 0},\n'.repeat(900)}{"id": 1}]}\n`;
  const big = parse(SAMPLE.replace('\n{"rows": [{"id": 1}]}\n', data));
  assert.ok(big.source.split('\n').length > 900);
  assert.ok(!validateRecipe(big).join('\n').includes('lines before'));
});

test('diagrams are every fence whose language is mermaid', () => {
  const r = parse(
    SAMPLE.replace(
      'Text after.',
      'Text after.\n\n~~~mermaid\nflowchart TD\n  C --> D\n~~~\n\n````mermaid accTitle\ngantt\n````\n\n```text\nmermaid\n```',
    ),
  );
  assert.deepEqual(
    r.diagrams.map((d) => d.source),
    ['flowchart LR\n  A --> B', 'flowchart TD\n  C --> D', 'gantt'],
  );
  assert.equal(r.diagrams[2].index, 3);
});

test('validation requires a diagram', () => {
  const r = parse(SAMPLE.replace('```mermaid\nflowchart LR\n  A --> B\n```\n\n', ''));
  assert.equal(r.diagrams.length, 0);
  assert.match(validateRecipe(r).join('\n'), /no ```mermaid diagram/);
});

/** SAMPLE with its small `rows` block beside the step that uses it. */
function paramsBesideSteps(): string {
  const block = '```json data=rows\n{"rows": [{"id": 1}]}\n```\n';
  const section = `\n## Data\n\n<details>\n<summary><code>rows</code></summary>\n\n${block}\n</details>\n`;
  return SAMPLE.replace(section, '').replace('```cypher cell=load', `${block}\n\`\`\`cypher cell=load`);
}

test('validation caps the width of step code', () => {
  const wide = `RETURN 1 AS ${'x'.repeat(80)}`;
  assert.ok(problems(SAMPLE.replace('MATCH (p:P) RETURN p LIMIT $k', wide)).includes('cell `q` line 1 is 92 columns'));
  assert.deepEqual(validateRecipe(parse(paramsBesideSteps())), []);
});

test('validation keeps parameters beside steps and datasets in `## Data`', () => {
  assert.ok(problems(SAMPLE).includes('data block `rows` is 21 bytes, a parameter block'));
  const dataset = `{"k": 1, "pad": "${'x'.repeat(INLINE_DATA_BYTES)}"}`;
  const errs = problems(paramsBesideSteps().replace('{"k": 1}', dataset));
  assert.ok(errs.includes('data block `k` is a 2 KB dataset: move it to the `## Data` section'), errs);
  assert.ok(errs.includes('recipe ships a dataset but front matter lacks `license`'), errs);
});

test('the index groups by category and sorts by title', () => {
  const base = parse(SAMPLE);
  const recipe = (slug: string, title: string, category: Category, summary = 'S'): Recipe => ({
    ...base,
    slug,
    front: { ...base.front, title, category, summary },
  });
  const index = renderIndex([
    recipe('b', 'beta', 'Maps and places', 'a | b'),
    recipe('a', 'Zeta', 'Maps and places'),
    recipe('m', 'Memory', 'Agent memory'),
  ]);
  assert.ok(index.indexOf('### Agent memory') < index.indexOf('### Maps and places'));
  // Code-point order: upper case sorts before lower case.
  assert.ok(index.indexOf('[Zeta](a.md)') < index.indexOf('[beta](b.md)'));
  assert.ok(index.includes('| [beta](b.md) | a \\| b | Beginner | Fully |\n'));
  assert.ok(!index.includes('### Data wrangling'));
  const readme = 'intro\n<!-- cookbook-index:start -->\nold\n<!-- cookbook-index:end -->\nafter\n';
  assert.equal(spliceIndex(readme, '\nnew\n'), 'intro\n<!-- cookbook-index:start -->\nnew\n<!-- cookbook-index:end -->\nafter\n');
  assert.throws(() => spliceIndex('no markers', ''), /lacks/);
});

test('the cell rule matches the shared cases', () => {
  for (const c of cases) {
    assert.equal(surprise({ id: 'a', expectError: c.expectError }, c.last), c.problem, JSON.stringify(c));
  }
});

test('cellTitles names each cell by the heading it sits under', () => {
  const steps = (body: string) =>
    parse(
      SAMPLE.replace(
        'Text after.',
        `Text after.\n\n${body}`,
      ),
    );
  const r = steps(
    '## Cafes `within` 2 km\n\n```cypher cell=a\nRETURN 1\n```\n\n```python\n## not a heading\n```\n\n' +
      '```cypher cell=b\nRETURN 2\n```\n\n### The **nearest** [k](https://example.com) cafes\n\n```cypher cell=c\nRETURN 3\n```',
  );
  const titles = cellTitles(r);
  // `load` and `q` come before any `##` heading: titled by their ids.
  assert.equal(titles.get('load'), 'load');
  assert.equal(titles.get('q'), 'q');
  assert.equal(titles.get('a'), 'Cafes within 2 km');
  // A heading-shaped line inside a code fence is not a heading.
  assert.equal(titles.get('b'), 'Cafes within 2 km (2)');
  assert.equal(titles.get('c'), 'The nearest k cafes');
});

test('verifiesSummary states the summary and counts the recorded cells', () => {
  const r = parse(SAMPLE);
  assert.deepEqual(verifiesSummary(r), {
    summary: 'S',
    cells: 2,
    recorded: 1,
    text: 'When its 2 steps run in order on a fresh in-memory store, the one step with a recorded result returns it.',
  });
  const all = parse(SAMPLE.replace('LIMIT $k\n```\n', 'LIMIT $k\n```\n\n```table\n1 row\n```\n'));
  assert.equal(verifiesSummary(all).recorded, 2);
  assert.equal(verifiesSummary(all).text, 'When its 2 steps run in order on a fresh in-memory store, each step returns its recorded result.');
  // Expected errors are named only when a cell is `expect=error`, and counted.
  const oneError = parse(SAMPLE.replace('```cypher cell=q params=k', '```cypher cell=q params=k expect=error'));
  assert.equal(oneError.cells[1].expectError, true);
  assert.equal(verifiesSummary(oneError).text, 'When its 2 steps run in order on a fresh in-memory store, the one step with a recorded result returns it, the one expected error included.');
  const twoErrors = parse(SAMPLE.replace('```cypher cell=q params=k', '```cypher cell=q params=k expect=error').replace('```cypher cell=load setup params=rows', '```cypher cell=load setup params=rows expect=error'));
  assert.equal(verifiesSummary(twoErrors).text, 'When its 2 steps run in order on a fresh in-memory store, the one step with a recorded result returns it, its 2 expected errors included.');
});

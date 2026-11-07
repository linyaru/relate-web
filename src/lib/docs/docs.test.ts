// Unit tests for the docs pipeline (npm run docs:test). The example page
// (src/content/docs/_example/example.mdx) exercises every construct; its twin
// is pinned in example.twin.md (UPDATE=1 rewrites it after a reviewed change).

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { parse as parseYaml } from 'yaml';

import { COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { DOCS_DIR, engine, ENGINE_FILE, glossary, splitFrontmatter, type GlossaryTerm } from './content.ts';
import { renderConstructs, type PageContext } from './constructs.ts';
import { docsIdOf, resolveHref } from './links.ts';
import { idFromPath, sectionOf, tokenLabel, twinUrl, typeOf } from './model.ts';
import { breadcrumb, buildNav, prevNext, readingOrder } from './nav.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';
import { parseRunInfo } from './results.ts';
import { renderTwin, type PageData } from './twin.ts';

const EXAMPLE = join(DOCS_DIR, '_example/example.mdx');
const GOLDEN = join(DOCS_DIR, '_example/example.twin.md');
const GLOSSARY = new Map<string, GlossaryTerm>([
  ['store', { id: 'store', term: 'store', short: 'A relate database: a directory, a single `.rl` file, or `:memory:`.' }],
  ['wal', { id: 'wal', term: 'WAL', short: 'Append-only log each commit goes to before it applies.' }],
]);
const ENGINE = { version: '0.16.1', verified: '0.16.1', date: '2026-11-04' };
const LINKS = { pages: new Set(['get-started/install']) };

function exampleTwin() {
  const { data, body } = splitFrontmatter(readFileSync(EXAMPLE, 'utf8'), EXAMPLE);
  return renderTwin(
    { id: '_example/example', file: EXAMPLE, body, data: data as unknown as PageData, lastUpdated: '2026-11-07' },
    { links: LINKS, glossary: GLOSSARY, components: COMPONENT_TWINS, engine: ENGINE },
  );
}

function ctx(file = EXAMPLE, source = ''): PageContext {
  return { file, source, links: LINKS, glossary: GLOSSARY, components: COMPONENT_TWINS, highlight: (code) => `<pre>${code}</pre>` };
}

test('the example twin matches example.twin.md', () => {
  const { markdown } = exampleTwin();
  if (process.env.UPDATE === '1') writeFileSync(GOLDEN, markdown);
  assert.equal(markdown, readFileSync(GOLDEN, 'utf8'));
});

test('the twin opens with the frontmatter agents parse, in order', () => {
  const { markdown } = exampleTwin();
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  assert.ok(m, 'frontmatter block');
  const front = parseYaml(m[1]);
  assert.deepEqual(Object.keys(front), [
    'title', 'description', 'surfaces', 'status', 'since', 'verified', 'canonical_url', 'prerequisites', 'related', 'last_updated',
  ]);
  assert.equal(front.verified, '0.16.1');
  assert.equal(front.canonical_url, 'https://relatedb.ai/docs/_example/example/');
});

test('the twin carries no directive or JSX syntax, and ends with the terms', () => {
  const { markdown, terms } = exampleTwin();
  assert.doesNotMatch(markdown, /^:{2,}/m);
  assert.doesNotMatch(markdown, /<(Install|Errors)\b/);
  assert.doesNotMatch(markdown, /:term\[|:since\[|:status\[/);
  assert.match(markdown, /\(since 0\.16\) and \(preview\)/);
  assert.match(markdown, /ratio a:b, stays text/);
  assert.deepEqual(terms.map((t) => t.id), ['store', 'wal']);
  assert.match(markdown, /## Terms used on this page\n\n- \*\*store\*\*: .*\n- \*\*WAL\*\*: .*\n$/);
  // Each run cell is followed by its recorded result; the mermaid fence by its words.
  assert.match(markdown, /```cypher run name=create\n[^`]+```\n\n```table\n\(no rows\)/);
  assert.match(markdown, /```\n\nA statement is appended to the write-ahead log first\. Then/);
  // Links whose targets do not exist keep their text only.
  assert.match(markdown, /A planned page: import a CSV\./);
  assert.match(markdown, /Not public yet: the repository\./);
});

test('the twin re-parses as plain markdown', () => {
  const tree = parsePage(exampleTwin().markdown.replace(/^---[\s\S]*?\n---\n/, ''));
  const kinds = new Set<string>();
  const walk = (n: { type: string; children?: unknown[] }) => {
    kinds.add(n.type);
    (n.children as { type: string }[] | undefined)?.forEach(walk);
  };
  walk(tree);
  for (const k of ['containerDirective', 'leafDirective', 'mdxJsxFlowElement', 'mdxjsEsm', 'mdxFlowExpression']) assert.ok(!kinds.has(k), k);
});

test('the page rendering turns constructs into their HTML forms', () => {
  const source = splitFrontmatter(readFileSync(EXAMPLE, 'utf8'), EXAMPLE).body;
  const tree = parsePage(source);
  renderConstructs(tree, 'html', ctx(EXAMPLE, source));
  const html = JSON.stringify(tree);
  assert.match(html, /"hName":"aside","hProperties":\{"className":\["callout","callout-warning"\]/);
  assert.match(html, /"className":\["tab-panel"\],"dataTabKey":"python"/);
  assert.match(html, /<cypher-cell id=\\"cell-create\\" data-cell=\\"create\\"/);
  assert.match(html, /<cypher-cell id=\\"cell-2\\" data-cell=\\"cell-2\\"/);
  assert.match(html, /<figure class=\\"diagram\\"><div class=\\"diagram-art diagram-light\\"><svg/);
  assert.match(html, /In words:/);
  assert.match(html, /<span class=\\"badge badge-since\\">since 0.16<\/span>/);
  // The glossary page is not built, so a term keeps its definition on hover, without a link.
  assert.match(html, /"hName":"span","hProperties":\{"className":\["term"\],"title":"A relate database/);
});

const problemsOf = (source: string, file = EXAMPLE) => {
  try {
    renderConstructs(parsePage(source), 'markdown', ctx(file, source));
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

test('malformed constructs fail with the line', () => {
  assert.match(problemsOf(':::aside\nx\n:::\n'), /line 1: unknown container `:::aside`/);
  assert.match(problemsOf('::::tabs\nloose text\n::::\n'), /holds only `:::tab\[Label\]`/);
  assert.match(problemsOf('A :term[thing]{id=nope}.\n'), /names no glossary term/);
  assert.match(problemsOf('A :term[thing].\n'), /needs an id/);
  assert.match(problemsOf(':status[beta]\n'), /is not one of preview, deprecated/);
  assert.match(problemsOf('<Unknown />\n'), /<Unknown> is not a docs component/);
  assert.match(problemsOf('{1 + 1}\n'), /has no markdown form/);
  assert.match(problemsOf('```cypher run name=a b\nRETURN 1\n```\n'), /takes only `name=<id>`/);
  assert.match(problemsOf('```cypher run name=missing\nRETURN 1\n```\n'), /cell `missing` has no recorded result/);
  assert.match(problemsOf('```mermaid\nflowchart LR\n  A --> B\n```\n'), /no `accTitle:` line/);
  assert.match(problemsOf('::figure{src=/nope.svg alt="x"}\n'), /is not in public\//);
});

test('a page with no cells and no diagrams needs no sidecars', () => {
  assert.equal(problemsOf('# Plain\n\nJust prose and `code`.\n', join(DOCS_DIR, 'nowhere/plain.mdx')), '');
});

test('run cells: info strings and ids', () => {
  assert.deepEqual(parseRunInfo('cypher', 'run'), { name: null });
  assert.deepEqual(parseRunInfo('cypher', 'run name=count-1'), { name: 'count-1' });
  assert.equal(parseRunInfo('cypher', null), null);
  assert.equal(parseRunInfo('python', 'run'), null);
});

test('links render only when their target exists', () => {
  const links = { pages: new Set(['guides/cypher/import-csv', 'reference/glossary']) };
  assert.equal(resolveHref('/docs/guides/cypher/import-csv', links), '/docs/guides/cypher/import-csv/');
  assert.equal(resolveHref('/docs/reference/glossary#wal', links), '/docs/reference/glossary/#wal');
  assert.equal(resolveHref('/docs/guides/nope/', links), null);
  assert.equal(resolveHref('/docs/', links), '/docs/');
  assert.equal(resolveHref('/docs/llms.txt', links), '/docs/llms.txt');
  assert.equal(resolveHref('/cookbook/entity-resolution/', links), '/cookbook/entity-resolution/');
  assert.equal(resolveHref('/cookbook/no-such-recipe/', links), null);
  assert.equal(resolveHref('https://github.com/relatedb/relate', links), null);
  assert.equal(resolveHref('https://opencypher.org/', links), 'https://opencypher.org/');
  assert.equal(resolveHref('#anchor', links), '#anchor');
  assert.equal(docsIdOf('/docs/a/b/index.md'), 'a/b');
  assert.equal(docsIdOf('/docs/a/b.md'), 'a/b');
});

test('ids, sections, URLs and token labels', () => {
  assert.equal(idFromPath('guides/cypher/import-csv.mdx'), 'guides/cypher/import-csv');
  assert.equal(idFromPath('guides/index.mdx'), 'guides');
  assert.equal(sectionOf('reference/cli/flags'), 'reference');
  assert.equal(typeOf('get-started/install'), 'tutorial');
  assert.equal(sectionOf('_example/example'), null);
  assert.equal(twinUrl('get-started/install'), '/docs/get-started/install.md');
  assert.equal(tokenLabel(643), '~640 tokens');
  assert.equal(tokenLabel(1234), '~1.2k tokens');
  assert.equal(tokenLabel(3000), '~3k tokens');
});

test('the sidebar groups and orders pages; prev/next follow it', () => {
  const p = (id: string, order = 100, title = id) => ({ id, title, label: title, order });
  const nav = buildNav([
    p('reference/errors', 10),
    p('get-started/install', 10, 'Install'),
    p('get-started/agent-quickstart', 20, 'Agent quickstart'),
    p('guides/cypher/import-csv', 10),
    p('guides/cypher', 5, 'Cypher'),
    p('guides/agents/agent-safety', 30),
    p('guides/agents/connect-over-mcp', 10),
    p('reference/cli/flags', 10),
  ]);
  assert.deepEqual(nav.map((s) => s.id), ['get-started', 'guides', 'reference']);
  const guides = nav[1];
  assert.deepEqual(guides.groups.map((g) => [g.id, g.label]), [['guides/cypher', 'Cypher'], ['guides/agents', 'Agents']]);
  assert.deepEqual(guides.groups[1].pages.map((x) => x.id), ['guides/agents/connect-over-mcp', 'guides/agents/agent-safety']);
  assert.deepEqual(guides.pages, []);
  assert.deepEqual(nav[2].groups.map((g) => g.label), ['CLI']);
  assert.deepEqual(readingOrder(nav).map((x) => x.id).slice(0, 4), [
    'get-started/install', 'get-started/agent-quickstart', 'guides/cypher', 'guides/cypher/import-csv',
  ]);
  const { prev, next } = prevNext(nav, 'guides/cypher');
  assert.equal(prev?.id, 'get-started/agent-quickstart');
  assert.equal(next?.id, 'guides/cypher/import-csv');
  assert.deepEqual(breadcrumb(nav, 'guides/cypher/import-csv'), [
    { label: 'Docs', href: '/docs/' },
    { label: 'Guides', href: null },
    { label: 'Cypher', href: '/docs/guides/cypher/' },
  ]);
});

// The pipeline against the real content files (not the fixtures above): the
// glossary terms in src/content/docs/_glossary feed the twin's closing
// section, and _data/engine.json feeds every twin's generated `verified`.
test('the real glossary loads, and the twin lists its short definitions', () => {
  const real = glossary();
  assert.ok(real.size >= 10, `ten or more terms, found ${real.size}`);
  for (const [id, t] of real) {
    assert.ok(t.short.length > 0 && t.short.length <= 160 && t.short.endsWith('.'), `${id}: short is one sentence under 160 characters`);
  }
  const { data, body } = splitFrontmatter(readFileSync(EXAMPLE, 'utf8'), EXAMPLE);
  const { markdown } = renderTwin(
    { id: '_example/example', file: EXAMPLE, body, data: data as unknown as PageData, lastUpdated: '2026-11-07' },
    { links: LINKS, glossary: real, components: COMPONENT_TWINS, engine: engine() },
  );
  const terms = markdown.split('\n## Terms used on this page\n')[1];
  assert.ok(terms, 'a Terms section');
  for (const id of ['store', 'wal']) assert.ok(terms.includes(`**${real.get(id)!.term}**: ${real.get(id)!.short}`), `${id} with its short`);
});

test('the twin\'s verified comes from _data/engine.json', () => {
  const file = JSON.parse(readFileSync(ENGINE_FILE, 'utf8'));
  assert.equal(engine().verified, String(file.verified ?? file.version).replace(/^v/, ''));
  const { data, body } = splitFrontmatter(readFileSync(EXAMPLE, 'utf8'), EXAMPLE);
  const { markdown } = renderTwin(
    { id: '_example/example', file: EXAMPLE, body, data: data as unknown as PageData, lastUpdated: '2026-11-07' },
    { links: LINKS, glossary: GLOSSARY, components: COMPONENT_TWINS, engine: engine() },
  );
  assert.equal(parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(markdown)![1]).verified, engine().verified);
});

test('a code block with title="…" names its file on the page and keeps the meta in the twin', () => {
  const source = '```python title="app.py"\nimport relate\n```\n';
  const page = parsePage(source);
  renderConstructs(page, 'html', ctx(EXAMPLE, source));
  assert.match(JSON.stringify(page), /<div class=\\"code-block has-title\\"><div class=\\"code-title\\">app.py<\/div>/);
  const twin = parsePage(source);
  renderConstructs(twin, 'markdown', ctx(EXAMPLE, source));
  assert.match(stringifyMarkdown(twin), /```python title="app.py"/);
});

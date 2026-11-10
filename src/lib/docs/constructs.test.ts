// Tests for the phase 2 constructs: the `::::agentic` and `:::deeplink`
// directives (constructs.ts, deeplink.ts), the language picker's vocabulary
// and detection (languages.ts), and <Matrix /> (src/components/docs/matrix.ts).

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { COMPONENT_ANCHORS, COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { surfacesData, table as matrixTable, validate, type SurfacesData } from '../../components/docs/matrix.ts';
import { DOCS_DIR } from './content.ts';
import { renderConstructs, type PageContext } from './constructs.ts';
import { configProblems, decodeDeeplink, deeplinkHref } from './deeplink.ts';
import { KEPT_CHOICES, languageOfKey, LANGUAGES, pickerLanguages, tabSetsOf, withSpellings } from './languages.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';

const FILE = join(DOCS_DIR, 'nowhere/page.mdx');
const ctx = (source: string): PageContext => ({
  file: FILE,
  source,
  links: { pages: new Set() },
  glossary: new Map(),
  components: COMPONENT_TWINS,
  highlight: (code) => `<pre>${code}</pre>`,
});
const twin = (source: string) => {
  const tree = parsePage(source);
  renderConstructs(tree, 'markdown', ctx(source));
  return stringifyMarkdown(tree);
};
const page = (source: string) => {
  const tree = parsePage(source);
  renderConstructs(tree, 'html', ctx(source));
  return JSON.stringify(tree);
};
const problemsOf = (source: string) => {
  try {
    twin(source);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

const AGENTIC = `## Read the store

::::agentic
:::human
A table.
:::
:::agent[Through the envelope]
JSON.
:::
::::
`;

test('agentic: the twin has both views under headings one level below the step, in order', () => {
  const md = twin(AGENTIC);
  assert.match(md, /## Read the store\n\n### As a person\n\nA table\.\n\n### Through the envelope\n\nJSON\.\n/);
  assert.doesNotMatch(md, /:::/);
  // Under an H3 the views are H4; before any heading, H3.
  assert.match(twin(AGENTIC.replace('## Read', '### Read')), /\n#### As a person\n/);
  assert.match(twin(AGENTIC.replace('## Read the store\n', '')), /^### As a person\n/);
});

test('agentic: the page gets a two-tab set the tab script switches and remembers, both views labeled', () => {
  const html = page(AGENTIC);
  assert.match(html, /"className":\["tabs","agentic"\],"dataTabs":"","dataAgentic":""/);
  assert.match(html, /"className":\["tab-panel","agentic-human"\],"dataTabKey":"agentic-human","dataTabLabel":"As a person"/);
  assert.match(html, /"className":\["tab-panel","agentic-agent"\],"dataTabKey":"agentic-agent","dataTabLabel":"Through the envelope"/);
  assert.match(html, /"hProperties":\{"className":\["tab-label"\]\}/);
});

test('agentic: malformed containers fail with the line', () => {
  assert.match(problemsOf('::::agentic\n:::human\nx\n:::\n::::\n'), /line 1: a `::::agentic` container needs both views/);
  assert.match(problemsOf('::::agentic\n:::human\nx\n:::\n:::human\ny\n:::\n:::agent\nz\n:::\n::::\n'), /line 5: a `::::agentic` container has one `:::human`/);
  assert.match(problemsOf('::::agentic\nloose\n:::human\nx\n:::\n:::agent\ny\n:::\n::::\n'), /line 2: a `::::agentic` container holds only/);
  assert.match(problemsOf(':::agent\nx\n:::\n'), /line 1: a `:::agent` belongs inside a `::::agentic` container/);
  assert.match(problemsOf(':::aside\nx\n:::\n'), /known: note, tip, warning, danger, tabs, agentic, deeplink/);
});

const ENTRY = { command: 'relate', args: ['serve', '--mcp', 'stdio', '--database', '<absolute-path>/graph.rl', '--read-only'] };
const DEEPLINK = `:::deeplink{host=cursor name=relate}\n\`\`\`json\n${JSON.stringify(ENTRY, null, 2)}\n\`\`\`\n:::\n`;

test('deeplink: the Cursor link is the documented form, and decodes to the JSON shown', () => {
  const href = deeplinkHref('cursor', 'relate', ENTRY);
  assert.match(href, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=relate&config=[A-Za-z0-9%]+$/);
  const config = new URLSearchParams(href.split('?')[1]).get('config')!;
  assert.deepEqual(JSON.parse(Buffer.from(config, 'base64').toString('utf8')), ENTRY);
  assert.deepEqual(decodeDeeplink(href), { host: 'cursor', name: 'relate', config: ENTRY });
  // The documented example (cursor.com/docs/context/mcp/install-links) encodes the same way, before percent-encoding.
  const pg = { command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/mydb'] };
  assert.equal(
    decodeURIComponent(deeplinkHref('cursor', 'postgres', pg).split('config=')[1]),
    'eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtb2RlbGNvbnRleHRwcm90b2NvbC9zZXJ2ZXItcG9zdGdyZXMiLCJwb3N0Z3Jlc3FsOi8vbG9jYWxob3N0L215ZGIiXX0=',
  );
});

test('deeplink: the VS Code link carries the entry with its name, URL-encoded', () => {
  const href = deeplinkHref('vscode', 'relate', ENTRY);
  assert.equal(href, `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'relate', ...ENTRY }))}`);
  assert.deepEqual(decodeDeeplink(href), { host: 'vscode', name: 'relate', config: ENTRY });
});

test('deeplink: only a read-only server entry can be a link', () => {
  assert.deepEqual(configProblems(ENTRY), []);
  assert.deepEqual(configProblems({ url: 'https://mcp.example.com/mcp' }), []);
  assert.match(configProblems({ command: 'relate', args: ['serve', '--mcp', 'stdio'] })[0], /needs "--read-only"/);
  assert.match(configProblems({ mcpServers: { relate: ENTRY } })[0], /whole config file/);
  assert.match(configProblems([1])[0], /not an object/);
  assert.match(configProblems({ ...ENTRY, env: { RELATE_AUTH: 'x' } })[0], /carries `env` or `headers`/);
  assert.match(configProblems({ url: 'https://mcp.example.com/mcp', headers: { Authorization: 'x' } })[0], /carries `env` or `headers`/);
});

test('deeplink: the twin keeps the fence and gives the link as text; the page has the button, the JSON and the link', () => {
  const md = twin(DEEPLINK);
  const href = deeplinkHref('cursor', 'relate', ENTRY);
  assert.ok(md.startsWith('```json\n{\n  "command": "relate",'));
  assert.ok(md.includes(`Cursor install link for the server \`relate\`, generated from this JSON: \`${href}\``));
  const html = page(DEEPLINK);
  assert.ok(html.includes(`href=\\"${href.replace(/&/g, '&amp;')}\\" data-deeplink-href>Add to Cursor</a>`));
  assert.match(html, /<div class=\\"deeplink\\" data-deeplink data-host=\\"cursor\\" data-name=\\"relate\\">/);
  assert.match(html, /<textarea id=\\"code-1\\" hidden>\{\\n  &quot;command&quot;: &quot;relate&quot;/);
  assert.match(html, /<code data-deeplink-text>cursor:\/\/anysphere/);
});

test('deeplink: malformed directives fail with the line', () => {
  assert.match(problemsOf(DEEPLINK.replace('host=cursor', 'host=zed')), /line 1: `:::deeplink` needs host= one of cursor, vscode/);
  assert.match(problemsOf(DEEPLINK.replace('name=relate', 'name="a b"')), /needs name= the server's name/);
  assert.match(problemsOf(DEEPLINK.replace(',\n    "--read-only"', '')), /a deeplink adds a read-only server/);
  assert.match(problemsOf(':::deeplink{host=cursor name=relate}\nText.\n:::\n'), /holds exactly one ```json fence/);
  assert.match(problemsOf(DEEPLINK.replace('"command"', 'command')), /the JSON does not parse/);
});

test('languages: every key belongs to one language; ids come first', () => {
  const seen = new Set<string>();
  for (const l of LANGUAGES) {
    assert.equal(l.keys[0], l.id);
    for (const k of l.keys) {
      assert.ok(!seen.has(k), `${k} is listed once`);
      seen.add(k);
    }
  }
  assert.equal(languageOfKey('js')?.id, 'node');
  assert.equal(languageOfKey('wasm')?.id, 'browser');
  assert.equal(languageOfKey('agent'), undefined);
  assert.equal(languageOfKey('agentic-agent'), undefined);
});

test('languages: tab sets from the source, fences skipped; the picker needs a set with two languages', () => {
  const source = [
    '::::tabs',
    ':::tab[Python]{key=python}',
    'x',
    ':::',
    ':::tab[Node.js]',
    'y',
    ':::',
    '::::',
    '',
    '````markdown',
    '::::tabs',
    ':::tab[Rust]{key=rust}',
    ':::',
    '::::',
    '````',
    '',
    '::::tabs',
    ':::tab[CLI]{key=cli}',
    ':::',
    ':::tab[Agent]{key=agent}',
    ':::',
    '::::',
  ].join('\n');
  const sets = tabSetsOf(source);
  assert.deepEqual(sets, [['python', 'node-js'], ['cli', 'agent']]);
  assert.deepEqual(pickerLanguages(sets).map((l) => l.id), ['python', 'node', 'cli']);
  assert.deepEqual(pickerLanguages([['cli', 'agent']]), []);
  assert.deepEqual(pickerLanguages([['agentic-human', 'agentic-agent']]), []);
});

test('matrix: the shipped surfaces file is complete: every feature on every surface, every source known', () => {
  const d = surfacesData();
  assert.deepEqual(validate(d), []);
  // The shared language order (python, node, browser, rust, c, java, go, swift), after the CLI and before the served surfaces.
  assert.deepEqual(d.surfaces.map((s) => s.id), ['cli', 'python', 'node', 'browser', 'rust', 'c', 'java', 'go', 'swift', 'bolt', 'http', 'mcp']);
  for (const id of ['open-memory', 'open-directory', 'open-rl', 'read-only', 'transactions', 'parameters', 'result-metadata', 'notifications', 'vector-search', 'full-text', 'load-csv', 'load-url', 'agent-mode']) {
    assert.ok(d.features.some((f) => f.id === id), id);
  }
  // Facts the runs showed, pinned so an edit that contradicts them fails here.
  assert.equal(d.cells['open-rl'].browser.value, 'no');
  assert.equal(d.cells.transactions.browser.value, 'no');
  assert.equal(d.cells['read-only'].browser.value, 'yes');
  assert.equal(d.cells['agent-mode'].cli.value, 'yes');
});

test('matrix: validation catches a missing cell, a bad value and an unknown source', () => {
  const d = structuredClone(surfacesData()) as SurfacesData;
  delete d.cells['read-only'].cli;
  d.cells.transactions.go.value = 'maybe' as never;
  d.cells.parameters.c.sources = ['nowhere'];
  const problems = validate(d).join('\n');
  assert.match(problems, /cells\.read-only\.cli is missing/);
  assert.match(problems, /cells\.transactions\.go: value `maybe`/);
  assert.match(problems, /cells\.parameters\.c: source `nowhere` is not in `sources`/);
});

test('matrix: rows and columns narrow it; the twin is a GFM table; unknown ids fail', () => {
  const t = matrixTable({ rows: ['read-only'], columns: ['cli', 'browser'] });
  assert.deepEqual(t.columns, ['Feature', 'CLI', 'Browser (WASM)']);
  assert.deepEqual(t.rows.map((r) => r.id), ['matrix-read-only']);
  const md = COMPONENT_TWINS.Matrix({ rows: ['read-only'], columns: ['cli', 'browser'] });
  assert.match(md, /^\| Feature \| CLI \| Browser \(WASM\) \|\n\| --- \| --- \| --- \|\n\| Read-only open\. .* \| yes: `--read-only`; a write exits 6 \| yes: `new RelateDb\(true\)` \|/);
  assert.match(md, /Checked on \d{4}-\d{2}-\d{2} against relate /);
  assert.throws(() => matrixTable({ rows: ['teleport'] }), /no feature `teleport`/);
  assert.throws(() => matrixTable({ columns: ['cobol'] }), /no surface `cobol`/);
  assert.throws(() => matrixTable({ size: 'big' }), /unknown prop `size`/);
  assert.ok(COMPONENT_ANCHORS.Matrix().includes('matrix-transactions'));
});

test('picker memory: every language in docs-tab keeps all its spellings, in recency order, eight choices', () => {
  // What the layout's tab script writes after a click on the Windows tab: one spelling of Node.js left.
  assert.deepEqual(withSpellings(['windows', 'cli', 'node', 'package']), ['windows', 'cli', 'node', 'js', 'javascript', 'nodejs', 'node-js', 'package']);
  // Another spelling first keeps its place; the language is not repeated.
  assert.deepEqual(withSpellings(['js', 'python', 'nodejs', 'wasm']), ['js', 'node', 'javascript', 'nodejs', 'node-js', 'python', 'wasm', 'browser']);
  // A language counts once toward the eight choices.
  const ten = ['node', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const kept = withSpellings(ten);
  assert.deepEqual(kept, ['node', 'js', 'javascript', 'nodejs', 'node-js', 'a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(kept.filter((k) => !languageOfKey(k) || languageOfKey(k)!.id !== 'node').length + 1, KEPT_CHOICES);
  assert.deepEqual(withSpellings([]), []);
});

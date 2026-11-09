// Unit tests for the glossary (npm run docs:test): the term files as data
// (src/lib/docs/glossary.ts), the toggletip pass (glossary-toggletip.ts), and
// the §4.11 checks (checks/glossary.ts). The real glossary is loaded too, so a
// new term that breaks a rule fails here as well as in docs:check.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Root } from 'mdast';

import { DOCS_DIR, engine, glossary, type GlossaryTerm } from './content.ts';
import { renderConstructs, type PageContext } from './constructs.ts';
import {
  aliasRules,
  bodyHtml,
  bodyMarkdown,
  bodyTree,
  glossaryJson,
  glossaryJsonText,
  letterOf,
  readGlossary,
  shortProblems,
  SHORT_MAX,
  sortKey,
  termMatcher,
  type GlossaryEntry,
} from './glossary.ts';
import { renderToggletips, tipId, toggletipHtml } from './glossary-toggletip.ts';
import { blankFrontmatter, bodyFences, firstUseMisses, FIRST_USE_IGNORED, linkedTerms, twinTermsProblems, twinTermsSection } from './checks/glossary.ts';
import { parsePage } from './parse.ts';

const EXAMPLE = join(DOCS_DIR, '_example/example.mdx');
const TERMS = new Map<string, GlossaryTerm>([
  ['store', { id: 'store', term: 'store', short: 'A relate database: a directory, a single `.rl` file, or `:memory:`.' }],
  ['wal', { id: 'wal', term: 'WAL', short: 'Append-only log each commit goes to before it applies.' }],
]);

const entry = (over: Partial<GlossaryEntry>): GlossaryEntry => ({
  id: 'x', term: 'x', short: 'An x.', aliases: [], context: 'storage', see: null, related: [], body: '', file: '/tmp/x.mdx', ...over,
});

/** A page's HTML-target tree after constructs.ts and the toggletip pass. */
function htmlTree(source: string): { tree: Root; tips: string[] } {
  const ctx: PageContext = {
    file: EXAMPLE,
    source,
    links: { pages: new Set(['reference/glossary']) },
    glossary: TERMS,
    components: {},
    highlight: (code) => `<pre>${code}</pre>`,
  };
  const tree = parsePage(source);
  renderConstructs(tree, 'html', ctx);
  const tips = renderToggletips(tree, TERMS);
  return { tree, tips };
}
const json = (node: unknown) => JSON.stringify(node);

// ---------------------------------------------------------------- the toggletip

test('the toggletip: a button with popovertarget and a popover="auto" panel holding the short definition and a read-more link', () => {
  const html = toggletipHtml('write-ahead log', TERMS.get('wal')!);
  assert.match(html, /^<button type="button" class="term" popovertarget="term-tip-wal">write-ahead log<\/button>/);
  assert.match(html, /<span class="term-tip" id="term-tip-wal" popover="auto">/);
  assert.match(html, /<span class="term-tip-name">WAL<\/span>/);
  assert.match(html, /Append-only log each commit goes to before it applies\./);
  assert.match(html, /<a class="term-tip-more" href="\/docs\/reference\/glossary\/#wal">Read more in the glossary<\/a>/);
  // Phrasing content only, so it can sit inside a paragraph.
  assert.doesNotMatch(html, /<div|<p\b/);
  assert.equal(tipId('wal'), 'term-tip-wal');
  // Code spans in the short definition render as code; raw HTML does not pass through.
  assert.match(toggletipHtml('store', TERMS.get('store')!), /<code>\.rl<\/code>/);
  assert.doesNotMatch(toggletipHtml('x', { id: 'x', term: 'x', short: 'A <b>bold</b> claim.' }), /<b>/);
});

test('the toggletip: the first use only; later uses plain text; none in headings, table headers or callout titles; a plain link in table cells', () => {
  const source = [
    '## The :term[store]{id=store} heading',
    '',
    'First :term[store]{id=store} here, then the :term[store]{id=store} again, and the :term[WAL]{id=wal}.',
    '',
    '| :term[store]{id=store} | b |',
    '| --- | --- |',
    '| :term[WAL]{id=wal} | c |',
    '',
    ':::note[About the :term[WAL]{id=wal}]',
    'Body.',
    ':::',
  ].join('\n');
  const { tree, tips } = htmlTree(source);
  assert.deepEqual(tips, ['store', 'wal']);
  const out = json(tree);
  assert.equal(out.match(/popovertarget=\\"term-tip-store\\"/g)?.length, 1, 'one toggletip per term');
  assert.equal(out.match(/popovertarget=\\"term-tip-wal\\"/g)?.length, 1);
  // The heading keeps the word as text.
  const heading = (tree.children[0] as { children: unknown[] }).children;
  assert.doesNotMatch(JSON.stringify(heading), /term-tip|"type":"link"/);
  // The table: header cell plain text, body cell a plain link.
  const table = tree.children.find((n) => n.type === 'table')!;
  const [head, row] = (table as { children: unknown[] }).children;
  assert.doesNotMatch(JSON.stringify(head), /"type":"link"|term-tip/);
  assert.match(JSON.stringify(row), /"type":"link","url":"\/docs\/reference\/glossary\/#wal"/);
  assert.doesNotMatch(JSON.stringify(row), /term-tip/);
  // The callout title stays text.
  const callout = json(tree.children.at(-1));
  assert.doesNotMatch(callout, /term-tip|"type":"link"/);
});

test('the toggletip: a table cell or a tab panel never uses up the toggletip; it lands on the first prose use', () => {
  const source = ['| a |', '| --- |', '| :term[store]{id=store} |', '', 'Then the :term[store]{id=store} in prose.'].join('\n');
  const { tips, tree } = htmlTree(source);
  assert.deepEqual(tips, ['store']);
  assert.match(json(tree.children.at(-1)), /popovertarget/);
  const tabbed = ['::::tabs', ':::tab[One]{key=one}', 'A :term[store]{id=store} in a tab.', ':::', '::::', '', 'The :term[store]{id=store} after.'].join('\n');
  const t = htmlTree(tabbed);
  assert.deepEqual(t.tips, ['store']);
  assert.doesNotMatch(json(t.tree.children[0]), /popovertarget/);
  assert.match(json(t.tree.children[0]), /"type":"link"/);
});

// ---------------------------------------------------------------- the Short-definitions rule

test('the Short-definitions rule: one sentence, under 160 characters, plain text, a period, not the term first', () => {
  assert.deepEqual(shortProblems('store', 'A relate database: a directory, a single `.rl` file, or `:memory:`.'), []);
  assert.deepEqual(shortProblems('row cap', 'The limit on rows; `--max-rows <n>` sets it.'), [], 'code spans may hold <placeholders>');
  assert.match(shortProblems('x', 'A'.repeat(SHORT_MAX) + '.').join(), /under 160/);
  assert.match(shortProblems('x', 'No period').join(), /period/);
  assert.match(shortProblems('x', 'See [the page](/docs/x).').join(), /no links/);
  assert.match(shortProblems('x', 'Two sentences here. And another.').join(), /one sentence/);
  assert.match(shortProblems('store', 'Store is a thing.').join(), /does not start with the term/);
  assert.deepEqual(shortProblems('store', 'Stored state, on disk.'), [], 'a longer word that starts with the term is fine');
  assert.match(shortProblems('x', 'A **bold** claim.').join(), /no emphasis/);
  assert.deepEqual(shortProblems('x', ''), ['`short` is required']);
});

// ---------------------------------------------------------------- aliases and First use

test('aliases: matched as words with an optional plural; exact case for a capitalized alias or a case variant of the term', () => {
  const rules = aliasRules([
    entry({ id: 'store', term: 'store', aliases: ['db', 'database file'] }),
    entry({ id: 'cypher', term: 'Cypher', aliases: ['cypher'] }),
    entry({ id: 'opencypher', term: 'openCypher', aliases: ['OpenCypher'] }),
  ]);
  const hits = (text: string) => rules.flatMap((r) => [...text.matchAll(r.phrase)].map((m) => `${m[0]}→${r.term}`));
  assert.deepEqual(hits('two database files and a DB').sort(), ['DB→store', 'database files→store']);
  assert.deepEqual(hits('db-tools and dbx'), [], 'not inside a longer or hyphenated word');
  assert.deepEqual(hits('Cypher and cypher'), ['cypher→Cypher']);
  assert.deepEqual(hits('openCypher, OpenCypher'), ['OpenCypher→openCypher']);
});

test('First use: terms used three times or more without a link, unless linked, ignored, or the page is at the cap', () => {
  const entries = [entry({ id: 'wal', term: 'WAL' }), entry({ id: 'snapshot', term: 'snapshot' }), entry({ id: 'path', term: 'path' })];
  const prose = ['The WAL and the WAL.', 'A snapshot, two snapshots, Snapshot.', 'A WAL again; a path, a path, a path.'];
  assert.deepEqual(firstUseMisses(prose, new Set(), 5, entries).map((m) => [m.id, m.count]), [['snapshot', 3], ['wal', 3]]);
  assert.deepEqual(firstUseMisses(prose, new Set(['wal']), 5, entries).map((m) => m.id), ['snapshot']);
  assert.deepEqual(firstUseMisses(prose, new Set(['a', 'b', 'c', 'd', 'e']), 5, entries), [], 'nothing at the cap');
  assert.ok(FIRST_USE_IGNORED.has('path'));
  // An exact-case term does not match another case; a lowercase term matches any case.
  assert.equal([...'wal WAL Wal'.matchAll(termMatcher('WAL'))].length, 1);
  assert.equal([...'Store store STORE stores storeroom'.matchAll(termMatcher('store'))].length, 4);
  assert.equal([...'a .rl file, two .rls'.matchAll(termMatcher('.rl'))].length, 2);
});

test('linked terms: a :term shown in a code fence or inline code is not a link, and does not fail the Twin check', () => {
  const body = 'The :term[WAL]{id=wal}.\n\n```text\n:term[a codec]{id=codec}\n```\n\nWrite `:term[x]{id=nope}` to link.\n';
  assert.deepEqual(linkedTerms(body).map((t) => `${t.id}@${t.line}`), ['wal@1']);
  const twin = `# T\n\nBody.\n\n## Terms used on this page\n\n- **WAL**: ${TERMS.get('wal')!.short}\n`;
  assert.deepEqual(twinTermsProblems(twin, linkedTerms(body).map((t) => t.id), TERMS), []);
});

test('blankFrontmatter: the frontmatter becomes empty lines, so the body keeps its line numbers', () => {
  const text = '---\nid: bolt\ncontext: cypher\n---\n\nThe body.\n';
  assert.equal(blankFrontmatter(text), '\n\n\n\n\nThe body.\n');
  assert.equal(blankFrontmatter(text).split('\n').indexOf('The body.'), text.split('\n').indexOf('The body.'));
  assert.equal(blankFrontmatter('No frontmatter.\n'), 'No frontmatter.\n');
});

test('bodyFences: every code block of a glossary body, nested ones included, with its body line', () => {
  const body = 'A host config:\n\n```bash\nclaude mcp add relate -- relate serve --mcp stdio --database ./graph.rl\n```\n\n- In a list:\n\n  ```json\n  {"mcpServers": {}}\n  ```\n';
  assert.deepEqual(bodyFences(parsePage(body)).map((f) => `${f.lang}@${f.line}`), ['bash@3', 'json@9']);
  assert.match(bodyFences(parsePage(body))[0].value, /relate serve --mcp stdio --database \.\/graph\.rl$/);
});

test('linked terms and the Twin check: the Terms section lists exactly the linked terms, in order', () => {
  const body = 'The :term[WAL]{id=wal} and the :term[store]{id=store}.\nAgain :term[WAL]{id=wal}.\n:term[x]{id="bad"}';
  assert.deepEqual(linkedTerms(body).map((t) => `${t.id}@${t.line}`), ['wal@1', 'store@1', 'wal@2', 'bad@3']);
  const good = `---\nx: 1\n---\n\n# T\n\nBody.\n\n## Terms used on this page\n\n- **WAL**: ${TERMS.get('wal')!.short}\n- **store**: ${TERMS.get('store')!.short}\n`;
  assert.deepEqual(twinTermsSection(good), [`- **WAL**: ${TERMS.get('wal')!.short}`, `- **store**: ${TERMS.get('store')!.short}`]);
  assert.deepEqual(twinTermsProblems(good, ['wal', 'store', 'wal'], TERMS), []);
  assert.match(twinTermsProblems(good, ['store', 'wal'], TERMS).join(), /not in the order/);
  assert.match(twinTermsProblems(good, ['wal'], TERMS).join(), /does not link/);
  assert.match(twinTermsProblems('# T\n\nBody.\n', ['wal'], TERMS).join(), /no "Terms used on this page"/);
  assert.match(twinTermsProblems(good, [], TERMS).join(), /links no glossary term/);
});

// ---------------------------------------------------------------- bodies and glossary.json

test('a body renders to the twin with absolute links and to the page with in-page term links; bad constructs are reported', () => {
  const ids = new Set(['wal', 'store']);
  const pages = new Set(['reference/glossary', 'get-started/install']);
  const e = entry({ body: 'Each commit goes to the :term[WAL]{id=wal}. See [Install relate](/docs/get-started/install) and [a planned page](/docs/nope).\n\n```bash\nrelate --version\n```' });
  const md = bodyMarkdown(e, pages, ids);
  assert.match(md, /\[WAL\]\(https:\/\/relatedb\.ai\/docs\/reference\/glossary\/#wal\)/);
  assert.match(md, /\[Install relate\]\(https:\/\/relatedb\.ai\/docs\/get-started\/install\/\)/);
  assert.match(md, /and a planned page\./, 'an unpublished page keeps its text');
  const html = bodyHtml(e, pages, ids);
  assert.match(html, /<a href="#wal">WAL<\/a>/);
  assert.match(html, /<div class="code-block"><pre class="glossary-code" data-lang="bash"><code>relate --version<\/code><\/pre><\/div>/);
  assert.doesNotMatch(html, /popovertarget/);
  const bad = entry({ body: '## A heading\n\n:::note\nx\n:::\n\nA :term[ghost]{id=ghost}.\n\n```\nno lang\n```' });
  const problems = bodyTree(bad, 'markdown', pages, ids).problems.join('\n');
  assert.match(problems, /a heading in a glossary body/);
  assert.match(problems, /`:::note` in a glossary body/);
  assert.match(problems, /names no glossary term/);
  assert.match(problems, /without a language/);
});

test('the real glossary: every term well formed, with a body that renders, sorted and filed by letter', () => {
  const entries = readGlossary();
  const ids = new Set(entries.map((e) => e.id));
  assert.ok(entries.length >= 60, `about sixty terms (DOCS-PLAN.md §4.11), found ${entries.length}`);
  for (const e of entries) {
    assert.deepEqual(shortProblems(e.term, e.short), [], e.id);
    assert.ok(e.body, `${e.id}: a body`);
    assert.deepEqual(bodyTree(e, 'markdown', new Set(['reference/glossary']), ids).problems, [], e.id);
    for (const r of e.related) assert.ok(ids.has(r), `${e.id}: related ${r}`);
  }
  const keys = entries.map((e) => sortKey(e.term).toLowerCase());
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b, 'en')));
  assert.equal(letterOf('.rl'), 'R');
  assert.equal(letterOf('WAL'), 'W');
  // content.ts's reader (the twin's Terms section) sees the same terms.
  assert.deepEqual([...glossary().keys()].sort(), [...ids].sort());
});

test('/docs/glossary.json: kind documentation, its source and limits, one row per term with an absolute anchor URL', () => {
  const doc = glossaryJson(engine().verified);
  assert.equal(doc.kind, 'documentation');
  assert.equal(doc.source, 'https://relatedb.ai/docs/reference/glossary/');
  assert.match(doc.limits, /Short definitions only/);
  assert.equal(doc.count, doc.terms.length);
  for (const t of doc.terms) {
    assert.deepEqual(Object.keys(t), ['id', 'term', 'short', 'aliases', 'context', 'url']);
    assert.equal(t.url, `https://relatedb.ai/docs/reference/glossary/#${t.id}`);
  }
  const text = glossaryJsonText(engine().verified);
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(JSON.parse(text), doc, 'the served bytes are the same document');
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/, 'no timestamp');
});

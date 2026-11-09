// Unit tests for the docs content negotiation (src/lib/docs/negotiation.ts),
// which the Pages Function in functions/docs/_middleware.ts runs.
// `npm run docs:negotiation-check` exercises the Function itself on dist/.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agentPathKind, agentPathLine, estimateTokens, headingPlainText, htmlHeadings, isOwnTwin, parseTwin, prefersMarkdown, sectionAnchors, sectionTerms, sliceSection, twinPathFor } from './negotiation.ts';

const FRONT = '---\ntitle: Example\ncanonical_url: https://relatedb.ai/docs/guides/example/\n---';
const TWIN = `${FRONT}

# Example

Intro paragraph.

> Verified against relate 0.16.1.

## Set up

Uses a [store](https://relatedb.ai/docs/reference/glossary/#store).

### Python

\`\`\`python
# not a heading
\`\`\`

### Node.js

\`\`\`\`markdown
\`\`\`bash
## not a heading either
\`\`\`
\`\`\`\`

## Run \`relate\`

The WAL grows here. Nothing about a checkpoint.

~~~
## inside a tilde fence
~~~

## Set up

A second heading with the same text.

## Terms used on this page

- **store**: A relate database.
- **WAL**: Append-only log.
- **snapshot**: A point-in-time view.
`;

test('prefersMarkdown: markdown must be named and ranked above (or level with and before) HTML', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown, text/html, */*'), true);
  assert.equal(prefersMarkdown('text/html;q=0.9, text/markdown'), true);
  assert.equal(prefersMarkdown('text/markdown;q=0.9, text/html;q=0.8'), true);
  assert.equal(prefersMarkdown('text/html, text/markdown'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0.5, text/html'), false);
  assert.equal(prefersMarkdown('text/markdown;q=0'), false);
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown('text/*'), false);
  assert.equal(prefersMarkdown(''), false);
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown('Text/Markdown; charset=utf-8'), true);
  assert.equal(prefersMarkdown('text/markdown, text/*;q=0.9'), true);
});

test('twinPathFor maps canonical page paths to twins and leaves files alone', () => {
  assert.equal(twinPathFor('/docs'), '/docs/index.md');
  assert.equal(twinPathFor('/docs/'), '/docs/index.md');
  assert.equal(twinPathFor('/docs/get-started/install/'), '/docs/get-started/install.md');
  assert.equal(twinPathFor('/docs/get-started/install'), '/docs/get-started/install.md');
  assert.equal(twinPathFor('/docs/reference/errors/'), '/docs/reference/errors.md');
  assert.equal(twinPathFor('/docs/get-started/install.md'), null);
  assert.equal(twinPathFor('/docs/get-started/install/index.md'), null);
  assert.equal(twinPathFor('/docs/get-started/install/index.html'), null);
  assert.equal(twinPathFor('/docs/llms.txt'), null);
  assert.equal(twinPathFor('/docs/graph.json'), null);
  assert.equal(twinPathFor('/docs//x/'), null);
  assert.equal(twinPathFor('/docs/_example/example/'), null);
  assert.equal(twinPathFor('/docsearch/'), null);
  assert.equal(twinPathFor('/cookbook/'), null);
});

test('twinPathFor refuses anything that is not a page id, percent-encoded traversal included', () => {
  // The asset server decodes %2E%2E%2F after this check, so an encoded ../ must never name a twin.
  for (const path of ['/docs/%2E%2E%2Fskill/', '/docs/%2e%2e%2fskills%2frelate%2fSKILL/', '/docs/reference%2Ferrors/', '/docs/..%2Fx/', '/docs/../skill/', '/docs/Get-Started/install/', '/docs/a\\b/', '/docs/a b/', '/docs/-x/']) {
    assert.equal(twinPathFor(path), null, path);
  }
});

test('isOwnTwin: a twin answers only the URL its canonical_url names', () => {
  assert.equal(isOwnTwin('/docs/get-started/install/', 'https://relatedb.ai/docs/get-started/install/'), true);
  assert.equal(isOwnTwin('/docs/get-started/install', 'https://relatedb.ai/docs/get-started/install/'), true);
  assert.equal(isOwnTwin('/docs', 'https://relatedb.ai/docs/'), true);
  assert.equal(isOwnTwin('/docs/changelog/', 'https://relatedb.ai/docs/reference/changelog/'), false);
  assert.equal(isOwnTwin('/docs/get-started/install/index/', 'https://relatedb.ai/docs/get-started/install/'), false);
  assert.equal(isOwnTwin('/docs/feedback/', null), false);
  assert.equal(isOwnTwin('/docs/x/', 'not a url'), false);
});

test('agentPathKind names the skill, the llms.txt files, the twins and the data blocks they link, and nothing else', () => {
  assert.equal(agentPathKind('/docs/guides/cypher/vector-search/data/notes.json'), 'data');
  assert.equal(agentPathKind('/docs/capabilities.json'), null);
  assert.equal(agentPathKind('/skill.md'), 'skill');
  assert.equal(agentPathKind('/skills/relate/SKILL.md'), 'skill');
  assert.equal(agentPathKind('/.well-known/agent-skills/index.json'), 'skill');
  assert.equal(agentPathKind('/.well-known/skills/index.json'), 'skill');
  assert.equal(agentPathKind('/llms.txt'), 'llms');
  assert.equal(agentPathKind('/docs/llms-full.txt'), 'llms');
  assert.equal(agentPathKind('/docs/get-started/install.md'), 'twin');
  assert.equal(agentPathKind('/docs/get-started/install/'), null);
  assert.equal(agentPathKind('/cookbook/'), null);
  assert.equal(agentPathKind('/.well-known/security.txt'), null);
  const line = agentPathLine('skill', `/skills/${'x'.repeat(300)}`, 200, 'u'.repeat(300));
  assert.equal(line.path.length, 200);
  assert.equal(line.ua.length, 200);
});

test('htmlHeadings reads glossary entries as H3s with their term ids, in document order', () => {
  const html = '<h2 id="letter-w">W</h2><dl><div class="glossary-entry" id="wal"><dt><a class="ref-anchor" href="#wal">WAL</a></dt><dd>x</dd></div><div class="glossary-entry" id="conflict"><dt>write-write conflict</dt><dd>y</dd></div></dl><h2 id="later">Later</h2>';
  assert.deepEqual(htmlHeadings(html), [
    { level: 2, id: 'letter-w', text: 'W' },
    { level: 3, id: 'wal', text: 'WAL' },
    { level: 3, id: 'conflict', text: 'write-write conflict' },
    { level: 2, id: 'later', text: 'Later' },
  ]);
  const twin = `${FRONT}\n\n# Glossary\n\n## W\n\n### write-write conflict\n\nTwo writers.\n\n## Later\n\nEnd.\n`;
  const byId = sliceSection(twin, 'conflict', { html });
  assert.ok(byId.ok && byId.anchor === 'conflict' && byId.markdown.includes('### write-write conflict\n\nTwo writers.'));
  const bySlug = sliceSection(twin, 'write-write-conflict', { html });
  assert.ok(bySlug.ok && byId.ok && bySlug.markdown === byId.markdown);
  assert.ok(sectionAnchors(twin, html).includes('conflict'));
});

test('estimateTokens is one token per four characters, rounded up', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
});

test('headingPlainText strips inline markdown the way the HTML heading reads', () => {
  assert.equal(headingPlainText('Run `relate`'), 'Run relate');
  assert.equal(headingPlainText('Add to your [AGENTS.md](https://x/)'), 'Add to your AGENTS.md');
  assert.equal(headingPlainText('**Bold** and _em_'), 'Bold and em');
  assert.equal(headingPlainText('A \\* star &amp; more'), 'A * star & more');
});

test('parseTwin skips headings inside backtick and tilde fences and slugs in order', () => {
  const parsed = parseTwin(TWIN);
  assert.ok(parsed.frontmatter.startsWith('---\ntitle: Example'));
  assert.ok(parsed.frontmatter.endsWith('\n---'));
  assert.equal(parsed.canonicalUrl, 'https://relatedb.ai/docs/guides/example/');
  assert.deepEqual(
    parsed.headings.map((h) => [h.level, h.anchor]),
    [[1, ''], [2, 'set-up'], [3, 'python'], [3, 'nodejs'], [2, 'run-relate'], [2, 'set-up-1'], [2, 'terms-used-on-this-page']],
  );
  assert.deepEqual(sectionAnchors(TWIN), ['set-up', 'python', 'nodejs', 'run-relate', 'set-up-1', 'terms-used-on-this-page']);
});

test('sliceSection returns the heading subtree with the frontmatter, the used terms and a trailer', () => {
  const r = sliceSection(TWIN, 'set-up', { twinUrl: 'https://relatedb.ai/docs/guides/example.md' });
  assert.ok(r.ok);
  assert.equal(
    r.markdown,
    `${FRONT}

## Set up

Uses a [store](https://relatedb.ai/docs/reference/glossary/#store).

### Python

\`\`\`python
# not a heading
\`\`\`

### Node.js

\`\`\`\`markdown
\`\`\`bash
## not a heading either
\`\`\`
\`\`\`\`

## Terms used on this page

- **store**: A relate database.

Full page: https://relatedb.ai/docs/guides/example/ (markdown: https://relatedb.ai/docs/guides/example.md)
`,
  );
});

test('sliceSection stops a deeper heading at the next heading of its level or higher', () => {
  const r = sliceSection(TWIN, 'python');
  assert.ok(r.ok);
  assert.match(r.markdown, /\n\n### Python\n\n```python\n# not a heading\n```\n\nFull page: https:\/\/relatedb\.ai\/docs\/guides\/example\/\n$/);
  assert.doesNotMatch(r.markdown, /Node\.js/);
});

test('sliceSection matches a term by its word, ignoring case, and leaves unused terms out', () => {
  const r = sliceSection(TWIN, 'run-relate');
  assert.ok(r.ok);
  assert.match(r.markdown, /## Terms used on this page\n\n- \*\*WAL\*\*: Append-only log\.\n\nFull page/);
  const dup = sliceSection(TWIN, 'set-up-1');
  assert.ok(dup.ok);
  assert.match(dup.markdown, /## Set up\n\nA second heading with the same text\.\n\nFull page/);
});

test('sectionTerms caps the Terms entries at five', () => {
  const entries = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => `- **term${t}**: Short.`);
  const text = 'terma termb termc termd terme termf termg';
  assert.deepEqual(sectionTerms(entries, text), entries.slice(0, 5));
  assert.deepEqual(sectionTerms(entries, 'termg only'), [entries[6]]);
  assert.deepEqual(sectionTerms(entries, 'nothing here, termgx'), []);
});

test('sliceSection on an unknown anchor lists the anchors', () => {
  const r = sliceSection(TWIN, 'nope');
  assert.deepEqual(r, { ok: false, anchors: ['set-up', 'python', 'nodejs', 'run-relate', 'set-up-1', 'terms-used-on-this-page'] });
  assert.equal(sliceSection(TWIN, '').ok, false);
});

test('the HTML page ids pair with the twin headings by text, and slugs still resolve', () => {
  const twin = `${FRONT}\n\n# Changelog\n\n## 0.16.1\n\n### Changed\n\nA.\n\n### Fixed\n\nB.\n\n## Deprecation policy\n\nC.\n`;
  const html =
    '<h2 class="nav-section-title">Guides</h2><h1>Changelog</h1><h2 id="0.16.1">0.16.1</h2><h3 id="0.16.1-changed">Changed</h3>' +
    '<h3 id="0.16.1-fixed">Fixed</h3><h2 id="deprecation-policy">Deprecation <code>policy</code></h2><h2 id="related">Related</h2>';
  assert.deepEqual(htmlHeadings(html).map((h) => h.id), ['0.16.1', '0.16.1-changed', '0.16.1-fixed', 'deprecation-policy', 'related']);
  assert.deepEqual(sectionAnchors(twin, html), ['0.16.1', '0.16.1-changed', '0.16.1-fixed', 'deprecation-policy']);
  const byId = sliceSection(twin, '0.16.1-changed', { html });
  assert.ok(byId.ok);
  assert.match(byId.markdown, /\n\n### Changed\n\nA\.\n\nFull page/);
  const bySlug = sliceSection(twin, 'fixed', { html });
  assert.ok(bySlug.ok);
  assert.match(bySlug.markdown, /\n\n### Fixed\n\nB\.\n\nFull page/);
  assert.equal(sliceSection(twin, 'related', { html }).ok, false);
});

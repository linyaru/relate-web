import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rewriteHref } from './links.ts';
import { createMarkdown, italicText, slugify, type MarkdownEnv } from './markdown.ts';

const md = createMarkdown({
  rewriteHref: (href) => (href.startsWith('private:') ? null : href.replace(/\.md$/, '/')),
});

function render(body: string) {
  const fences: [number, string][] = [];
  const env: MarkdownEnv = { fence: (token, line) => (fences.push([line, token.info]), `<fence ${line}>`) };
  return { html: md.render(body, env), env, fences };
}

test('the title and the opening italic paragraph are left out, and the lede kept', () => {
  const { html, env } = render('\n# Title\n\n*A lede\nover two lines.*\n\nFirst paragraph.\n');
  assert.equal(env.lede, 'A lede over two lines.');
  assert.equal(html, '<p>First paragraph.</p>\n');
  assert.equal(render('# T\n\nPlain opening.\n').env.lede, undefined);
});

test('fences keep their line; <details> wrappers are dropped', () => {
  const narrative =
    '# T\n\n```cypher cell=a\nRETURN 1\n```\n\n<details>\n<summary>More</summary>\n\nHidden on GitHub.\n\n</details>\n';
  const { html, fences } = render(narrative);
  assert.deepEqual(fences, [[2, 'cypher cell=a']]);
  assert.doesNotMatch(html, /details|summary/);
  assert.match(html, /Hidden on GitHub/);
});

test('headings get ids and make the contents list; callouts get a class', () => {
  const { html, env } = render('# T\n\n## Load `places`\n\n## Load `places`\n\n> **Note** careful\n');
  assert.deepEqual(env.toc, [
    { id: 'load-places', label: 'Load <code>places</code>' },
    { id: 'load-places-2', label: 'Load <code>places</code>' },
  ]);
  assert.match(html, /<blockquote class="callout">/);
});

test('links are rewritten, external ones open in a new tab, private ones become text', () => {
  const { html } = render('[a](other.md) [b](https://x.example/) [d](private:x)');
  assert.match(html, /<a href="other\/">a<\/a>/);
  assert.match(html, /<a href="https:\/\/x\.example\/" target="_blank" rel="noopener">b<\/a>/);
  assert.match(html, / d<\/p>/);
});

test('inline HTML renders as text; text in a wrapper block is kept', () => {
  assert.match(render('a <b>c</b>').html, /a &lt;b&gt;c&lt;\/b&gt;/);
  assert.equal(render('<details>\nplain words\n</details>\n').html, '<p>plain words</p>\n');
});

test('a package name is not linkified as an email address', () => {
  assert.doesNotMatch(render('npm/express@4.18.2').html, /mailto/);
});

test('helpers', () => {
  const used = new Set<string>();
  assert.equal(slugify('Hybrid recall: vector + text', used), 'hybrid-recall-vector-text');
  assert.equal(slugify('', used), 'section');
  assert.equal(italicText('_Underscores work too._'), 'Underscores work too.');
  assert.equal(italicText('*half italic* and not.'), null);
});

test('rewriteHref maps recipe links onto the site and drops what is not public', () => {
  const slugs = new Set(['nearby-places']);
  assert.equal(rewriteHref('nearby-places.md', slugs), '../nearby-places/');
  assert.equal(rewriteHref('./nearby-places.md#data', slugs), '../nearby-places/#data');
  assert.equal(rewriteHref('README.md', slugs), '../');
  assert.equal(rewriteHref('#step-2', slugs), '#step-2');
  assert.equal(rewriteHref('https://deps.dev', slugs), 'https://deps.dev');
  // Public URLs pass through, the relate repository and relatedb.ai included.
  assert.equal(rewriteHref('https://github.com/relatedb/relate/blob/main/README.md', slugs), 'https://github.com/relatedb/relate/blob/main/README.md');
  assert.equal(rewriteHref('https://relatedb.ai/install.sh', slugs), 'https://relatedb.ai/install.sh');
  // Not on the site: a missing recipe and another file of this repository.
  assert.equal(rewriteHref('missing.md', slugs), null);
  assert.equal(rewriteHref('../adr/0035-ordered-expand-ts.md', slugs), null);
  assert.equal(rewriteHref('//evil.example/x', slugs), null);
});

// Unit tests for the section slicer (node --test, type stripping).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findSection, frontmatterEnd, scanHeadings, sliceSection, subtreeEnd, type TwinIndex } from './sections.ts';

const TWIN = [
  '---',
  'title: Example',
  '---',
  '',
  '# Example',
  '',
  'Opening text with a [store](https://relatedb.ai/docs/reference/glossary/#store).',
  '',
  '## First',
  '',
  'First body.',
  '',
  '```bash',
  '## not a heading',
  '```',
  '',
  '### Nested',
  '',
  'Nested body with an [envelope](https://relatedb.ai/docs/reference/glossary/#envelope).',
  '',
  '## Second',
  '',
  'Second body.',
  '',
  '## Terms used on this page',
  '',
  '- **envelope**: One JSON object per result set.',
  '- **store**: A relate database.',
  '',
].join('\n');

function index(): TwinIndex {
  const hs = scanHeadings(TWIN);
  const at = (raw: string) => hs.find((h) => h.raw === raw)!.start;
  return {
    frontmatterEnd: frontmatterEnd(TWIN),
    sections: [
      { anchor: 'first', heading: 'First', level: 2, start: at('First') },
      { anchor: 'nested', heading: 'Nested', level: 3, start: at('Nested') },
      { anchor: 'second', heading: 'Second', level: 2, start: at('Second') },
    ],
    termsStart: at('Terms used on this page'),
    terms: [
      { id: 'envelope', line: '- **envelope**: One JSON object per result set.' },
      { id: 'store', line: '- **store**: A relate database.' },
    ],
  };
}

test('scanHeadings skips fenced code', () => {
  assert.deepEqual(scanHeadings(TWIN).map((h) => h.raw), ['Example', 'First', 'Nested', 'Second', 'Terms used on this page']);
});

test('an H2 subtree includes its H3 and stops at the next H2', () => {
  const ix = index();
  assert.equal(subtreeEnd(ix, 0), ix.sections[2].start);
  const s = sliceSection(TWIN, ix, 0);
  assert.ok(s.markdown.startsWith('---\ntitle: Example\n---\n\n## First\n'));
  assert.ok(s.markdown.includes('### Nested'));
  assert.ok(!s.markdown.includes('## Second'));
  assert.deepEqual(s.terms, ['envelope']);
  assert.ok(s.markdown.endsWith('## Terms used on this page\n\n- **envelope**: One JSON object per result set.\n'));
});

test('the slice is the twin\'s own bytes', () => {
  const ix = index();
  const s = sliceSection(TWIN, ix, 2);
  const body = s.markdown.slice(ix.frontmatterEnd + 1).trimEnd();
  assert.ok(TWIN.includes(body));
  assert.deepEqual(s.terms, []);
});

test('the opening section runs from the H1 to the first section', () => {
  const s = sliceSection(TWIN, index(), -1);
  assert.ok(s.markdown.includes('# Example'));
  assert.ok(!s.markdown.includes('## First'));
  assert.deepEqual(s.terms, ['store']);
});

test('findSection takes an anchor, #anchor or heading text', () => {
  const ix = index();
  assert.equal(findSection(ix, 'nested'), 1);
  assert.equal(findSection(ix, '#second'), 2);
  assert.equal(findSection(ix, 'FIRST'), 0);
  assert.equal(findSection(ix, 'missing'), -1);
});

test('the Terms section is capped at five', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const twin = `---\nt: x\n---\n\n# X\n\n## S\n\n${ids.map((i) => `[${i}](https://relatedb.ai/docs/reference/glossary/#${i})`).join(' ')}\n\n## Terms used on this page\n\n${ids.map((i) => `- **${i}**: d.`).join('\n')}\n`;
  const hs = scanHeadings(twin);
  const ix: TwinIndex = {
    frontmatterEnd: frontmatterEnd(twin),
    sections: [{ anchor: 's', heading: 'S', level: 2, start: hs[1].start }],
    termsStart: hs[2].start,
    terms: ids.map((i) => ({ id: i, line: `- **${i}**: d.` })),
  };
  const s = sliceSection(twin, ix, 0);
  assert.equal(s.terms.length, 5);
  assert.equal(s.termsOmitted, 2);
});

test('a section is the bytes ?section= gives from the built HTML, for an anchor that is not its heading\'s slug', async () => {
  // The Worker slices with the bundle's anchors; the Pages function pairs the
  // twin with the page's HTML. A glossary entry's id (`conflict`) is not the
  // slug of its text (`write-write-conflict`), so the two meet only when the
  // HTML side reads glossary entries as headings.
  const { sliceSection: negotiated } = await import('../../../src/lib/docs/negotiation.ts');
  const twin = [
    '---',
    'title: Glossary',
    'canonical_url: https://relatedb.ai/docs/reference/glossary/',
    '---',
    '',
    '# Glossary',
    '',
    '## W',
    '',
    '### write-write conflict',
    '',
    'Two writers touch one record; the second to commit gets a write-write conflict.',
    '',
    '## Terms used on this page',
    '',
    '- **write-write conflict**: Two writers, one record.',
    '',
  ].join('\n');
  const html = '<h2 id="letter-w">W</h2><dl><div class="glossary-entry" id="conflict"><dt><a class="ref-anchor" href="#conflict">write-write conflict</a></dt><dd>…</dd></div></dl>';
  const hs = scanHeadings(twin);
  const at = (raw: string) => hs.find((h) => h.raw === raw)!.start;
  const ix: TwinIndex = {
    frontmatterEnd: frontmatterEnd(twin),
    sections: [
      { anchor: 'letter-w', heading: 'W', level: 2, start: at('W') },
      { anchor: 'conflict', heading: 'write-write conflict', level: 3, start: at('write-write conflict') },
    ],
    termsStart: at('Terms used on this page'),
    terms: [{ id: 'conflict', line: '- **write-write conflict**: Two writers, one record.' }],
  };
  const md = 'https://relatedb.ai/docs/reference/glossary.md';
  const mine = sliceSection(twin, ix, 1, md);
  const theirs = negotiated(twin, 'conflict', { html, twinUrl: md });
  assert.ok(theirs.ok, 'the HTML id answers ?section=');
  assert.equal(mine.markdown, theirs.ok ? theirs.markdown : '');
  assert.ok(mine.markdown.endsWith('\n\nFull page: https://relatedb.ai/docs/reference/glossary/ (markdown: https://relatedb.ai/docs/reference/glossary.md)\n'));
  assert.deepEqual(mine.terms, ['conflict']);
  // The heading's slug selects the same section on both sides.
  assert.equal(findSection(ix, 'write-write-conflict'), 1);
  const bySlug = negotiated(twin, 'write-write-conflict', { html, twinUrl: md });
  assert.ok(bySlug.ok && bySlug.markdown === mine.markdown);
});

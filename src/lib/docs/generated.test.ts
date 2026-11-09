// Unit tests for the generated reference pieces (npm run docs:test): the
// <ExitCodes />, <Flags /> and <EnvVars /> tables from _data/cli.json, the
// shared table renderer, the glossary and changelog pages, the changelog
// feed, /docs/feedback.md and their docs:check module. They run on the real
// data files, so a regenerated cli.json or a new glossary term is covered.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';

import { parse as parseYaml } from 'yaml';

import { COMPONENT_ANCHORS, COMPONENT_TWINS } from '../../components/docs/registry.ts';
import { table as envVarsTable } from '../../components/docs/envvars.ts';
import { table as exitCodesTable } from '../../components/docs/exitcodes.ts';
import { table as flagsTable } from '../../components/docs/flags.ts';
import { glossary } from './content.ts';
import { changelogData, changelogFeed, changelogPage, changelogProblems, sinceTargets } from './generated/changelog.ts';
import { cliData, settled } from './generated/cli.ts';
import { feedbackMarkdown } from './generated/feedback.ts';
import { glossaryPage } from './generated/glossary.ts';
import { readGlossary, sortKey } from './glossary.ts';
import { GENERATED, generatedContext } from './generated/index.ts';
import { codeSpan, tableHtml, tableMarkdown, type Table } from './generated/table.ts';
import { checkGenerated, type Severity } from './checks/generated.ts';
import { CANONICAL_PHRASE } from './llms.ts';
import { GENERATED_IDS, GENERATED_PAGES } from './model.ts';

const ctx = generatedContext();
const front = (md: string) => parseYaml(/^---\n([\s\S]*?)\n---\n/.exec(md)![1]) as Record<string, unknown>;
/** Rows of a GFM table in `md` (lines that start with a pipe, less the header and the rule). */
const gfmRows = (md: string) => md.split('\n').filter((l) => l.startsWith('| ')).length - 2;

/** The imperative opening docs:check flags in a reference twin (scripts/docs.ts IMPERATIVE_VERBS), outside fences, headings and tables. */
const IMPERATIVE = /^(?:run|install|copy|use|read|open|add|pass|call|paste|execute|download|remove|delete|edit|replace|configure|enable|disable|click|tell|ask|create|write|try|ignore|disregard|forget|do not|don't)\b/i;
function imperativeSentences(md: string): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/```[\s\S]*?```/g, '');
  return body
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('|'))
    .map((l) => l.replace(/^[-*>]\s+/, ''))
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .filter((s) => !s.startsWith('[') && IMPERATIVE.test(s.replace(/^[^A-Za-z]+/, '')) && /[.!?:]$/.test(s) && s.split(/\s+/).length >= 3);
}

test('the registry holds the six components, each with a twin (ADR-0015; the sixth, <Matrix />, by ADR-0031)', () => {
  assert.deepEqual(Object.keys(COMPONENT_TWINS).sort(), ['EnvVars', 'Errors', 'ExitCodes', 'Flags', 'Install', 'Matrix']);
  for (const name of ['Errors', 'ExitCodes', 'Flags', 'EnvVars', 'Matrix']) assert.ok(COMPONENT_ANCHORS[name]().length > 0, `${name} has anchors`);
});

test('<ExitCodes />: one row per exit code at #exit-<n>, kinds from the errors data, retry advice', () => {
  const codes = settled(cliData().exit_codes);
  const t = exitCodesTable();
  assert.deepEqual(t.rows.map((r) => r.id), codes.map((c) => c.id));
  assert.ok(t.rows.every((r) => /^exit-\d+$/.test(r.id)));
  assert.deepEqual(t.columns, ['Exit code', 'Code', 'Meaning', 'Error kinds', 'Retry']);
  const five = t.rows.find((r) => r.id === 'exit-5');
  if (five) {
    assert.match(five.cells[3][0], /`conflict`/);
    assert.match(five.cells[4][0], /^Only kind `conflict`/);
  }
  const md = COMPONENT_TWINS.ExitCodes({});
  assert.equal(gfmRows(md), codes.length);
  assert.throws(() => exitCodesTable({ surface: 'cli' }), /takes no props/);
});

test('<Flags />: every settled flag once, at its id, with argument, default, scope and since', () => {
  const d = cliData();
  const expected = [...settled(d.global_flags), ...settled(d.commands).flatMap((c) => settled(c.flags ?? []))].map((f) => f.id);
  const all = flagsTable();
  assert.deepEqual(all.rows.map((r) => r.id), expected);
  assert.equal(new Set(expected).size, expected.length, 'flag ids are unique anchors');
  assert.deepEqual(all.columns, ['Flag', 'Argument', 'Default', 'Scope', 'Since', 'Description']);
  // The anchors pages already link: README's example and the read-only term's `see`.
  for (const id of ['read-only', 'load-csv-dir']) assert.ok(expected.includes(id), `#${id}`);
  assert.deepEqual(flagsTable({ command: 'query' }).rows.map((r) => r.id), settled(d.global_flags).map((f) => f.id));
  const serve = d.commands.find((c) => c.word === 'serve');
  if (serve?.flags?.length) assert.ok(flagsTable({ command: 'serve' }).rows.every((r) => r.cells[3][0] === '`relate serve`'));
  assert.throws(() => flagsTable({ command: 'nope' }), /no command "nope"/);
  assert.throws(() => flagsTable({ scope: 'x' }), /unknown prop `scope`/);
  assert.equal(gfmRows(COMPONENT_TWINS.Flags({})), expected.length);
});

test('<EnvVars />: every settled variable at its id with effect and default; usedBy filters', () => {
  const vars = settled(cliData().environment_variables);
  const t = envVarsTable();
  assert.deepEqual(t.rows.map((r) => r.id), vars.map((v) => v.id));
  assert.deepEqual(t.columns, ['Variable', 'Effect', 'Default', 'Used by']);
  const pull = envVarsTable({ usedBy: 'pull' });
  assert.ok(pull.rows.length > 0 && pull.rows.length < t.rows.length);
  assert.throws(() => envVarsTable({ usedBy: 'no-such-reader' }), /no variable/);
});

test('the shared table renders one anchored row per entry, and a twin row per entry with pipes escaped', () => {
  const t: Table = { columns: ['A', 'B'], rows: [{ id: 'row-1', cells: [[codeSpan('x|y'), 'second'], ['[Errors](/docs/reference/errors#e)', 'two']] }], notes: ['A note.'] };
  const pages = new Set(['reference/errors']);
  const html = tableHtml(t, pages, { table: 'ref-table', anchor: 'ref-anchor' });
  assert.match(html, /<tr id="row-1"><td><a class="ref-anchor" href="#row-1"><code>x\|y<\/code><\/a><br \/>second<\/td>/);
  assert.match(html, /<a href="\/docs\/reference\/errors\/#e">Errors<\/a><br \/>two/);
  assert.match(html, /<p>A note\.<\/p>$/);
  const md = tableMarkdown(t, pages);
  assert.equal(md, '| A | B |\n| --- | --- |\n| `x\\|y`; second | [Errors](https://relatedb.ai/docs/reference/errors/#e); two |\n\nA note.');
  // A link to a page that is not built keeps its text.
  assert.match(tableMarkdown(t, new Set()), /\| Errors; two \|/);
});

test('generated pages: listed in the model with a renderer, a twin with the frontmatter agents parse', () => {
  assert.deepEqual(GENERATED.map((g) => g.meta.id), GENERATED_PAGES.map((p) => p.id));
  for (const g of GENERATED) {
    assert.ok(g.meta.description.length >= 60 && g.meta.description.length <= 160, `${g.meta.id}: 60–160 character description`);
    const r = g.render(ctx);
    const f = front(r.markdown);
    assert.equal(f.verified, ctx.engine.verified);
    assert.equal(f.type, 'reference');
    assert.ok(String(f.description).startsWith(`${CANONICAL_PHRASE}: `));
    assert.equal(f.canonical_url, `https://relatedb.ai/docs/${g.meta.id}/`);
    assert.match(r.markdown, new RegExp(`#since-${ctx.engine.verified.replaceAll('.', '\\.')}`));
    assert.deepEqual(imperativeSentences(r.markdown), [], `${g.meta.id}: no imperative sentence in the twin (ADR-0013)`);
    assert.ok(r.headings.length >= 2, `${g.meta.id}: headings for "On this page"`);
    for (const h of r.headings) assert.ok(r.anchors.has(h.slug) && r.html.includes(` id="${h.slug}"`), `${g.meta.id}: #${h.slug}`);
  }
  assert.ok(GENERATED_IDS.has('reference/glossary') && GENERATED_IDS.has('reference/changelog'));
});

test('the glossary page: every term at its anchor, alphabetical, with its short definition', () => {
  const r = glossaryPage.render(ctx);
  const terms = [...glossary().values()];
  for (const t of terms) {
    assert.ok(r.anchors.has(t.id) && r.html.includes(`id="${t.id}"`), `#${t.id}`);
    assert.ok(r.markdown.includes(`### ${t.term}\n\n${t.short}`), `${t.id}: heading and short definition in the twin`);
  }
  // Alphabetical by the term without leading punctuation (`.rl` files under R), case ignored.
  const order = [...r.markdown.matchAll(/^### (.+)$/gm)].map((m) => sortKey(m[1]).toLowerCase());
  assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b, 'en')));
  // A term's `see` page renders only once published; links into the glossary are absolute in the twin.
  assert.doesNotMatch(r.markdown, /\]\(\/docs\//);
  // Phase 2: the full definition follows the short one in both renderings; the filter is progressive; JSON-LD for the head.
  const html = r.html;
  for (const e of readGlossary()) {
    assert.ok(e.body.length > 0, `${e.id}: a body`);
    const entry = html.slice(html.indexOf(`id="${e.id}"`), html.indexOf('</dd></div>', html.indexOf(`id="${e.id}"`)));
    assert.match(entry, /<p class="glossary-short">[\s\S]*<div class="glossary-body">/, `${e.id}: short, then the full definition`);
  }
  assert.match(html, /<form class="glossary-filter"[^>]*\bhidden\b/, 'the filter box is hidden until the script runs');
  assert.match(html, /<script>\(\(\) => \{/, 'the inline filter script');
  assert.doesNotMatch(html, /popovertarget/, 'no toggletip on the glossary page');
  const head = (r as typeof r & { head: string }).head;
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*)<\/script>/.exec(head)![1]);
  assert.equal(ld['@type'], 'DefinedTermSet');
  assert.equal(ld.hasDefinedTerm.length, terms.length);
  assert.doesNotMatch(head.slice(head.indexOf('>') + 1, head.lastIndexOf('<')), /</, 'no raw < inside the JSON-LD');
});

test('the changelog: well-formed data, #<version> and #since-<version> anchors, the feed carries the same entries', () => {
  const c = changelogData();
  assert.deepEqual(changelogProblems(c), []);
  const r = changelogPage.render(ctx);
  for (const rel of c.releases) assert.ok(r.anchors.has(rel.version), `#${rel.version}`);
  assert.ok(r.anchors.has(`since-${ctx.engine.verified}`), 'the anchor every twin links');
  assert.ok(r.anchors.has('deprecation-policy'));
  assert.ok(sinceTargets(c).has(ctx.engine.verified));
  const feed = changelogFeed(ctx) as { version: string; feed_url: string; items: { id: string; _relate: { version: string } }[] };
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.feed_url, 'https://relatedb.ai/docs/changelog.json');
  assert.deepEqual(feed.items.map((i) => i._relate.version), c.releases.map((x) => x.version));
  assert.ok(feed.items.every((i) => i.id.startsWith('https://relatedb.ai/docs/reference/changelog/#')));
  // Validation names what is wrong.
  const bad = changelogProblems({ policy: [], releases: [{ version: '1.0', date: 'today', changed: [{ text: 'no period' }] }, { version: '2.0.0', date: '2026-01-01' }] } as never);
  assert.ok(bad.some((p) => p.includes('"policy"')));
  assert.ok(bad.some((p) => p.includes('"version" is MAJOR.MINOR.PATCH')));
  assert.ok(bad.some((p) => p.includes('"date" is YYYY-MM-DD')));
  assert.ok(bad.some((p) => p.includes('ending with a period')));
  assert.ok(bad.some((p) => p.includes('lists no change')));
});

test('feedback.md: the operator decides; no address before launch; no imperative outside fences', () => {
  const md = feedbackMarkdown(ctx);
  const f = front(md);
  assert.equal(f.canonical_url, 'https://relatedb.ai/docs/feedback.md');
  assert.match(md, /operator/);
  assert.match(md, /to be published at launch/);
  assert.doesNotMatch(md, /mailto:|@[\w-]+\.\w/);
  assert.deepEqual(imperativeSentences(md), []);
});

test('the docs:check module reports no error on the real data', () => {
  const findings: { severity: Severity; message: string }[] = [];
  checkGenerated(
    { engine: ctx.engine, published: new Map([...ctx.pages].filter((p) => !GENERATED_IDS.has(p)).map((p) => [p, {}])), planned: new Set(), anchors: new Map(), builtIds: null },
    (_file, _line, severity, _rule, message) => findings.push({ severity, message }),
  );
  assert.deepEqual(findings.filter((f) => f.severity === 'error'), []);
  // A page claiming a generated id is an error.
  const claimed: string[] = [];
  checkGenerated(
    { engine: ctx.engine, published: new Map([['reference/glossary', {}]]), planned: new Set(), anchors: new Map(), builtIds: null },
    (_f, _l, severity, _r, message) => severity === 'error' && claimed.push(message),
  );
  assert.ok(claimed.some((m) => m.includes('claims the id of a generated page')));
});

test('the built checks read the build they are given (docs:check DIST), never ./dist behind its back', () => {
  const dist = mkdtempSync(join(tmpdir(), 'relate-docs-dist-'));
  try {
    mkdirSync(join(dist, 'docs'));
    const files: string[] = [];
    checkGenerated(
      { engine: ctx.engine, published: new Map([...ctx.pages].filter((p) => !GENERATED_IDS.has(p)).map((p) => [p, {}])), planned: new Set(), anchors: new Map(), builtIds: new Map() },
      (file, _line, severity) => severity === 'error' && files.push(file),
      dist,
    );
    // An empty build: every dist/ finding names a file in it, none in the repository's own dist/.
    assert.ok(files.some((f) => f.startsWith(dist)), 'an empty build is reported missing');
    assert.deepEqual(files.filter((f) => f.includes(`${sep}dist${sep}`) && !f.startsWith(dist)), []);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

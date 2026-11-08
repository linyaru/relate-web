// Unit tests for the docs graph (graph.ts) and its structural checks
// (checks/graph.ts): run with `npm run docs:test`.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkGraph, loadWasmSync, severities, type Severity } from './checks/graph.ts';
import { DOCS_DIR } from './content.ts';
import {
  buildGraph,
  cliIndex,
  codeRefs,
  configInvocations,
  cypherLiteral,
  graphInput,
  graphJson,
  inlineRefs,
  nodeKey,
  pageGraphMarkdown,
  publishedPageIds,
  seedScript,
  shellInvocations,
  type CliData,
  type DocsGraph,
  type GraphInput,
} from './graph.ts';

const CLI: CliData = {
  commands: [
    { id: 'query', word: 'query' },
    {
      id: 'serve',
      word: 'serve',
      flags: [
        { id: 'serve-mcp', flag: '--mcp', value: 'PORT|stdio' },
        { id: 'serve-read-only', flag: '--read-only', value: '[=snapshot|live]' },
        { id: 'serve-shared', flag: '--max-traversal-depth, --safe/--no-safe' },
      ],
    },
    { id: 'info', word: 'info', flags: [{ id: 'info-json', flag: '--json' }] },
    { id: 'upgrade', word: 'upgrade', aliases: ['update'], flags: [{ id: 'upgrade-check', flag: '--check' }] },
  ],
  global_flags: [
    { id: 'database', flag: '--database', short: '-d', value: 'PATH' },
    { id: 'read-only', flag: '--read-only', value: '[=snapshot|live]' },
    { id: 'json', flag: '--json' },
    { id: 'safe', flag: '--safe / --no-safe' },
    { id: 'end-of-options', flag: '--' },
  ],
};
const idx = cliIndex(CLI);
const sorted = (s: Set<string>) => [...s].sort();

test('shell invocations: command lines, launchers, quotes, comments', () => {
  assert.deepEqual(shellInvocations('claude mcp add relate -- relate serve --mcp stdio --database ./g.rl --read-only'), [
    ['serve', '--mcp', 'stdio', '--database', './g.rl', '--read-only'],
  ]);
  assert.deepEqual(shellInvocations('DO_NOT_TRACK=1 relate --version # prints the version'), [['--version']]);
  assert.deepEqual(shellInvocations('relate --database ./g.rl \\\n  --read-only "MATCH (n) --json RETURN n"'), [['--database', './g.rl', '--read-only', 'Q']]);
  assert.deepEqual(shellInvocations('echo relate is here'), []);
  assert.deepEqual(shellInvocations('cat seed.cypher | relate query --database ./x.rl'), [['query', '--database', './x.rl']]);
  assert.deepEqual(shellInvocations('relate query -- "MATCH (n) RETURN n"'), [['query', '--', 'Q']]);
  assert.deepEqual(shellInvocations('~/.local/bin/relate upgrade --check && relate info --json'), [['upgrade', '--check'], ['info', '--json']]);
});

test('config invocations: a host config block names relate and its args', () => {
  const json = '{"mcpServers": {"relate": {"command": "relate", "args": ["serve", "--mcp", "stdio", "--database", "./g.rl", "--read-only"]}}}';
  assert.deepEqual(configInvocations(json), [['serve', '--mcp', 'stdio', '--database', './g.rl', '--read-only']]);
  assert.deepEqual(configInvocations('[mcp_servers.relate]\ncommand = "relate"\nargs = ["serve", "--mcp", "stdio"]'), [['serve', '--mcp', 'stdio']]);
  assert.deepEqual(configInvocations('command: relate\nargs: ["serve", "--read-only"]'), [['serve', '--read-only']]);
  assert.deepEqual(configInvocations('{"command": "relatexyz", "args": ["serve"]}'), []);
});

test('code references: own flags first, query-run flags otherwise', () => {
  assert.deepEqual(sorted(codeRefs('bash', 'relate serve --mcp stdio --database ./g.rl --read-only --no-safe', idx)), [
    'Command:serve',
    'Flag:database',
    'Flag:serve-mcp',
    'Flag:serve-read-only',
    'Flag:serve-shared',
  ]);
  assert.deepEqual(sorted(codeRefs('bash', 'relate -d ./g.rl --read-only=live -- "RETURN 1"', idx)), ['Flag:database', 'Flag:end-of-options', 'Flag:read-only']);
  assert.deepEqual(sorted(codeRefs('bash', 'relate update --check', idx)), ['Command:upgrade', 'Flag:upgrade-check']);
  assert.deepEqual(sorted(codeRefs('python', 'subprocess.run(["relate", "serve"])', idx)), []);
  assert.deepEqual(sorted(codeRefs('json', '{"command": "relate", "args": ["info", "--json"]}', idx)), ['Command:info', 'Flag:info-json']);
});

test('inline references: command lines and bare flags', () => {
  assert.deepEqual(sorted(inlineRefs('relate serve --read-only', idx, null)), ['Command:serve', 'Flag:serve-read-only']);
  assert.deepEqual(sorted(inlineRefs('--read-only', idx, null)), ['Flag:read-only']);
  assert.deepEqual(sorted(inlineRefs('--read-only', idx, 'serve')), ['Flag:serve-read-only']);
  assert.deepEqual(sorted(inlineRefs('--mcp stdio', idx, null)), ['Flag:serve-mcp']);
  assert.deepEqual(sorted(inlineRefs('--safe / --no-safe', idx, null)), ['Flag:safe']);
  assert.deepEqual(sorted(inlineRefs('--param name=<value>', idx, null)), []);
  assert.deepEqual(sorted(inlineRefs('MATCH (n) RETURN n', idx, null)), []);
});

test('cypher literals: one line, escaped, nulls left out', () => {
  assert.equal(cypherLiteral("it's a\\b\nc\t "), "'it\\'s a\\\\b\\nc\\t\\u2028'");
  assert.equal(cypherLiteral({ id: 'a', n: 2, b: false, l: ['x', 'y'], gone: null, 'odd-key': 1 }), "{id: 'a', n: 2, b: false, l: ['x', 'y'], `odd-key`: 1}");
});

// A small docs set that exercises every node and relationship and every rule.
const page = (id: string, front: Record<string, unknown>, body: string) => ({ id, file: join(DOCS_DIR, `${id}.mdx`), data: front, body });

function fixture(): GraphInput {
  return {
    pages: [
      page('get-started/install', { title: 'Install relate', description: 'd', surfaces: ['cli', 'python', 'nope'] }, 'Install it.\n\n## Verify\n\nRun `relate --version` and read the :term[store]{id=store}.\n\n```bash\nrelate --version\n```\n'),
      page(
        'guides/serve',
        { title: 'Serve a store', description: 'd', prerequisites: ['get-started/install', 'concepts/later'], related: ['cookbook/agent-memory', 'reference/cli/serve#flags'] },
        [
          'This guide serves a store.',
          '',
          '## Steps',
          '',
          'See [install](/docs/get-started/install#verify) and the [recipe](/cookbook/agent-memory/).',
          '',
          '::::tabs',
          ':::tab[CLI]{key=cli}',
          '```bash',
          'relate serve --mcp stdio --database ./g.rl --read-only',
          '```',
          ':::',
          ':::tab[Config]{key=config}',
          '```json',
          '{"command": "relate", "args": ["serve", "--mcp", "stdio", "--read-only"]}',
          '```',
          ':::',
          '::::',
          '',
          '<Demo />',
          '',
          '### Check it',
          '',
          'Uses :term[store]{id=store} again.',
          '',
        ].join('\n'),
      ),
      page('reference/cli/serve', { title: 'relate serve', description: 'd' }, '## Synopsis\n\n`--read-only` opens the store read-only. Links [Serve](/docs/guides/serve).\n\n## See also\n\n- [Install](/docs/get-started/install)\n'),
      page('concepts/later', { title: 'Later', status: 'planned' }, ''),
      page('misc/island', { title: 'Island', description: 'd' }, 'No links here.\n'),
      page('guides/bad-term', { title: 'Bad term', description: 'd', related: ['get-started/install'] }, 'A :term[thing]{id=no-such-term}.\n'),
    ],
    glossary: [{ id: 'store', term: 'store', short: 'A relate database.', context: 'storage', see: null }],
    recipes: [{ slug: 'agent-memory', title: 'Agent memory', summary: 's' }],
    cli: CLI,
    engine: { version: '0.16.1', verified: '0.16.1', date: '2026-11-04' },
    components: { Demo: () => '```bash\nrelate info --json\n```' },
  };
}

const rels = (g: DocsGraph, type: string) => g.rels.filter((r) => r.type === type).map((r) => `${nodeKey(r.from)} -> ${nodeKey(r.to)}${r.props.anchor ? `#${r.props.anchor}` : ''}`);
const node = (g: DocsGraph, key: string) => g.nodes.find((n) => nodeKey(n) === key);

test('the graph: nodes, relationships and their properties', () => {
  const g = buildGraph(fixture());
  assert.deepEqual(rels(g, 'PREREQUISITE_OF'), ['Page:concepts/later -> Page:guides/serve', 'Page:get-started/install -> Page:guides/serve']);
  assert.deepEqual(rels(g, 'RELATED_TO'), [
    'Page:guides/bad-term -> Page:get-started/install',
    'Page:guides/serve -> Page:reference/cli/serve#flags',
    'Page:guides/serve -> CookbookRecipe:agent-memory',
  ]);
  assert.deepEqual(rels(g, 'LINKS_TO'), [
    'Page:guides/serve -> Page:get-started/install#verify',
    'Page:reference/cli/serve -> Page:get-started/install',
    'Page:reference/cli/serve -> Page:guides/serve',
    'Page:guides/serve -> CookbookRecipe:agent-memory',
  ]);
  assert.deepEqual(rels(g, 'APPLIES_TO'), ['Page:get-started/install -> Surface:cli', 'Page:get-started/install -> Surface:python']);
  assert.deepEqual(rels(g, 'USES_TERM'), ['Page:get-started/install -> Term:store', 'Page:guides/bad-term -> Term:no-such-term', 'Page:guides/serve -> Term:store']);

  // Sections: the intro, each H2 and H3; a tab's heading is not a section.
  const sections = g.nodes.filter((n) => n.label === 'Section' && n.props.page === 'guides/serve');
  assert.deepEqual(
    sections.map((s) => [s.props.anchor, s.props.heading, s.props.level, s.props.position]),
    [
      ['', 'Serve a store', 1, 1],
      ['check-it', 'Check it', 3, 3],
      ['steps', 'Steps', 2, 2],
    ],
  );
  const steps = node(g, 'Section:guides/serve#steps')!;
  assert.match(String(steps.props.text), /### CLI/);
  assert.equal(steps.props.length, String(steps.props.text).length);
  assert.equal(steps.props.url, 'https://relatedb.ai/docs/guides/serve/#steps');

  // Examples: both tabs and the component's block, in page order.
  const examples = g.nodes.filter((n) => n.label === 'Example' && n.props.page === 'guides/serve').sort((a, b) => Number(a.props.position) - Number(b.props.position));
  assert.deepEqual(
    examples.map((e) => [e.props.lang, e.props.section, e.props.first_line]),
    [
      ['bash', 'steps', 'relate serve --mcp stdio --database ./g.rl --read-only'],
      ['json', 'steps', '{"command": "relate", "args": ["serve", "--mcp", "stdio", "--read-only"]}'],
      ['bash', 'steps', 'relate info --json'],
    ],
  );

  // DOCUMENTS from fences, config blocks, components and inline code.
  assert.deepEqual(
    rels(g, 'DOCUMENTS').filter((r) => r.startsWith('Page:guides/serve')),
    ['Page:guides/serve -> Command:info', 'Page:guides/serve -> Command:serve', 'Page:guides/serve -> Flag:database', 'Page:guides/serve -> Flag:info-json', 'Page:guides/serve -> Flag:serve-mcp', 'Page:guides/serve -> Flag:serve-read-only'],
  );
  // On a command's reference page a bare flag is that command's.
  assert.deepEqual(rels(g, 'DOCUMENTS').filter((r) => r.startsWith('Page:reference/cli/serve')), ['Page:reference/cli/serve -> Flag:serve-read-only']);

  // Pages: planned ones have no URL; published ones carry the engine and a token estimate.
  const install = node(g, 'Page:get-started/install')!;
  assert.equal(install.props.url, 'https://relatedb.ai/docs/get-started/install/');
  assert.equal(install.props.md_url, 'https://relatedb.ai/docs/get-started/install.md');
  assert.equal(install.props.type, 'tutorial');
  assert.equal(install.props.verified, '0.16.1');
  assert.ok(Number(install.props.tokens) > 0);
  const later = node(g, 'Page:concepts/later')!;
  assert.equal(later.props.url, null);
  assert.equal(later.props.status, 'planned');

  // An unknown term: a Term with no `short`, and the page is read from the raw source.
  assert.equal(node(g, 'Term:no-such-term')!.props.short, undefined);
  assert.equal(g.problems.length, 1);
  assert.match(g.problems[0], /^guides\/bad-term: /);

  assert.deepEqual(rels(g, 'LISTS').filter((r) => r.startsWith('Index:llms.txt')).length, 4);
});

test('the seed is deterministic, and graph.json carries the same graph', () => {
  const a = seedScript(buildGraph(fixture()));
  const b = seedScript(buildGraph(fixture()));
  assert.equal(a, b);
  const real1 = seedScript(buildGraph(graphInput()));
  const real2 = seedScript(buildGraph(graphInput()));
  assert.equal(real1, real2);

  const g = buildGraph(fixture());
  const json = graphJson(g);
  assert.equal(json.nodes.length, g.nodes.length);
  assert.equal(json.relationships.length, g.rels.length);
  assert.ok(json.relationships.every((r) => json.nodes.some((n) => n.id === r.start) && json.nodes.some((n) => n.id === r.end)));
});

test('the structural checks find each failure, with its page', () => {
  const g = buildGraph(fixture());
  const found: [string, Severity, string, string][] = [];
  const stats = checkGraph(
    { pages: [], engine: g.engine },
    (file, _line, severity, rule, message) => found.push([rule, severity, file, message]),
    { graph: g, wasm: loadWasmSync(), severity: { 'graph-cli': 'error' } },
  );
  assert.equal(stats.nodes, g.nodes.length);
  assert.ok(stats.replayMs > 0);
  const by = (rule: string) => found.filter((f) => f[0] === rule).map((f) => f[2]);
  assert.deepEqual(by('graph-seed'), []);
  assert.deepEqual(by('graph-orphan'), ['misc/island']);
  assert.deepEqual(by('graph-unlinked'), ['guides/bad-term', 'misc/island']);
  assert.deepEqual(by('graph-prereq'), ['guides/serve']);
  assert.deepEqual(by('graph-term'), ['guides/bad-term']);
  const cli = found.filter((f) => f[0] === 'graph-cli');
  assert.ok(cli.every((f) => f[1] === 'error'));
  // reference/cli/serve documents only serve's --read-only; the rest is reported.
  assert.ok(cli.some((f) => /command `serve`: .*the command itself.*--mcp/.test(f[3])));
  assert.ok(cli.some((f) => /query-run flags: .*`--database`/.test(f[3])));
});

test('severities: defaults, the option, then DOCS_GRAPH_SEVERITY', () => {
  assert.equal(severities({}, '')['graph-cli'], 'warning');
  assert.equal(severities({ 'graph-cli': 'error' }, '')['graph-cli'], 'error');
  assert.equal(severities({ 'graph-cli': 'error' }, 'graph-cli=off, graph-orphan=warning')['graph-cli'], 'off');
  assert.throws(() => severities({}, 'graph-nope=error'), /DOCS_GRAPH_SEVERITY/);
});

test('the page graph markdown lists the neighborhood', () => {
  const g = buildGraph(fixture());
  const md = pageGraphMarkdown(g, 'guides/serve');
  assert.match(md, /^---\ntitle: "Serve a store: page graph"\npage: guides\/serve\n/);
  assert.match(md, /## Prerequisites\n\n- Later \(`concepts\/later`, not written yet\)\n- \[Install relate\]\(https:\/\/relatedb\.ai\/docs\/get-started\/install\.md\)\n/);
  assert.match(md, /## Linked from\n\n- \[relate serve\]\(https:\/\/relatedb\.ai\/docs\/reference\/cli\/serve\.md\)\n/);
  assert.match(md, /- \[Agent memory\]\(https:\/\/relatedb\.ai\/cookbook\/agent-memory\/index\.md\) \(cookbook\)/);
  assert.match(md, /## Terms\n\n- \*\*store\*\* \(`store`\): A relate database\.\n/);
  assert.match(md, /- `bash` in "Steps": `relate serve --mcp stdio/);
  assert.match(md, /- Command `relate serve` \(`serve`\)/);
  assert.throws(() => pageGraphMarkdown(g, 'nope'), /no page nope/);
});

// ---------------------------------------------------------------------------
// Section embeddings, the vector index and the cookbook recipe's subset

import { checkEmbeddings } from './checks/embeddings.ts';
import {
  decodeVector,
  EMBEDDING_DIMENSION,
  EMBEDDING_MODEL,
  EMBEDDINGS_ENCODING,
  EMBEDDINGS_FORMAT,
  EMBEDDINGS_INPUT,
  encodeVector,
  float16Literal,
  formatEmbeddings,
  fromFloat16Bits,
  HYBRID_STATEMENT,
  readEmbeddings,
  recipeFloat,
  RECIPE_QUESTIONS,
  sectionInputs,
  sha256Hex,
  toFloat16Bits,
  VECTOR_INDEX,
  seedWithoutVectors,
  VECTOR_LOAD_STATEMENT,
  vectorRows,
  withRecipeData,
  recipeDataBlock,
  type EmbeddingsArtifact,
} from './graph.ts';

/** A unit vector with weight on two components picked by `i`: distinct, deterministic, 384 long. */
const fakeVector = (i: number) => {
  const v = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  v[i % EMBEDDING_DIMENSION] = 0.8;
  v[(i * 7 + 3) % EMBEDDING_DIMENSION] = 0.6;
  return v;
};

function artifactFor(g: DocsGraph, edit: (entries: { id: string; sha256: string; vector: string }[]) => void = () => {}): EmbeddingsArtifact {
  const sections = sectionInputs(g).map((s, i) => ({ id: s.id, sha256: s.sha256, vector: encodeVector(fakeVector(i)) }));
  edit(sections);
  const queries = RECIPE_QUESTIONS.map((q, i) => ({ id: q, sha256: sha256Hex(q), vector: encodeVector(fakeVector(i)) }));
  return JSON.parse(formatEmbeddings(sections, queries)) as EmbeddingsArtifact;
}

test('float16: encode, decode, and the shortest literal that reads back', () => {
  for (const x of [0, -0, 1, -1, 0.5, 0.1, -0.02689, 6e-8, 65504, 1e-3]) {
    const back = fromFloat16Bits(toFloat16Bits(x));
    assert.ok(Math.abs(back - x) <= Math.abs(x) * 2 ** -10 + 6e-8, `${x} -> ${back}`);
    // A signed zero is written 0.0: the sign of a zero component changes no similarity.
    if (x !== 0) assert.equal(toFloat16Bits(Number(float16Literal(x))), toFloat16Bits(x), `${x} -> ${float16Literal(x)}`);
  }
  assert.equal(toFloat16Bits(70000), 0x7c00);
  assert.equal(float16Literal(0), '0.0');
  assert.equal(float16Literal(1), '1.0');
  assert.equal(float16Literal(0.1), '0.1');
  const v = fakeVector(5).map((x, i) => (i % 3 ? x : -x / 3));
  const decoded = decodeVector(encodeVector(v));
  assert.equal(decoded.length, EMBEDDING_DIMENSION);
  assert.ok(decoded.every((x, i) => Math.abs(x - v[i]) < 1e-3));
  assert.equal(recipeFloat(0.00004), '0.0');
  assert.equal(recipeFloat(-0.123456), '-0.1235');
  assert.equal(recipeFloat(1), '1.0');
});

test('section inputs: page title, heading and text, hashed', () => {
  const g = buildGraph(fixture());
  const inputs = sectionInputs(g);
  const intro = inputs.find((s) => s.id === 'guides/serve#')!;
  assert.match(intro.input, /^Serve a store\n\nThis guide serves a store\./);
  const steps = inputs.find((s) => s.id === 'guides/serve#steps')!;
  assert.match(steps.input, /^Serve a store: Steps\n\n/);
  assert.equal(steps.sha256, sha256Hex(steps.input));
  assert.deepEqual(inputs.map((s) => s.id), [...inputs.map((s) => s.id)].sort());
});

test('the seed sets fresh vectors only, creates the vector index, and the WASM answers vector and hybrid queries', () => {
  const plain = buildGraph(fixture());
  assert.equal(plain.vectors.size, 0);
  assert.match(seedScript(plain), new RegExp(`CREATE VECTOR INDEX ${VECTOR_INDEX} IF NOT EXISTS FOR \\(s:Section\\) ON \\(s\\.embedding\\) OPTIONS \\{indexConfig: \\{\`vector\\.dimensions\`: 384, \`vector\\.similarity_function\`: 'cosine'\\}\\};`));
  assert.doesNotMatch(seedScript(plain), /SET s\.embedding/);

  // One stale entry (wrong hash), one orphan: the stale section is left out of the seed.
  const a = artifactFor(plain, (es) => {
    es.find((e) => e.id === 'guides/serve#steps')!.sha256 = '0'.repeat(64);
    es.push({ id: 'gone/page#x', sha256: '0'.repeat(64), vector: encodeVector(fakeVector(99)) });
  });
  const g = buildGraph({ ...fixture(), embeddings: a });
  const sections = g.nodes.filter((n) => n.label === 'Section').length;
  assert.equal(g.vectors.size, sections - 1);
  assert.ok(!g.vectors.has('guides/serve#steps'));
  const seed = seedScript(g);
  assert.match(seed, /\] AS row MATCH \(s:Section \{id: row\.id\}\) SET s\.embedding = vector\(row\.v, 384, FLOAT32\);/);
  assert.match(seed, new RegExp(`embedding: VECTOR<FLOAT32>\\(384\\), ${EMBEDDING_MODEL.id.replace('.', '\\.')} .* on ${sections - 1} of ${sections} sections`));
  assert.equal(seedScript(g), seedScript(buildGraph({ ...fixture(), embeddings: a })));
  assert.equal(graphJson(g).embeddings.sections, sections - 1);

  const wasm = loadWasmSync();
  const query = (db: InstanceType<typeof wasm.RelateDb>, cypher: string, params: unknown = null) => {
    const out = db.executeScript(cypher, params === null ? null : JSON.stringify(params)).map((e) => JSON.parse(e) as { error: string | null; rows: Record<string, unknown>[] });
    const err = out.find((e) => e.error);
    if (err) throw new Error(err.error!);
    return out.flatMap((e) => e.rows);
  };
  const target = sectionInputs(g).findIndex((s) => s.id === 'get-started/install#verify');
  const search = `MATCH (s:Section) SEARCH s IN (VECTOR INDEX ${VECTOR_INDEX} FOR $v LIMIT 1) SCORE AS score RETURN s.id AS id`;

  // The whole seed, vectors as literals.
  const db = new wasm.RelateDb();
  try {
    query(db, seed);
    assert.deepEqual(query(db, search, { v: fakeVector(target) }), [{ id: 'get-started/install#verify' }]);
    const hits = query(db, HYBRID_STATEMENT, { vector: fakeVector(target), query: 'verify version', k: 5, limit: 3 });
    assert.equal(hits[0].id, 'get-started/install#verify');
    assert.equal(hits[0].vector_rank, 1);
  } finally {
    db.free();
  }
  // The seed without the vector statements, then the vectors as one parameter: the same answer.
  const db2 = new wasm.RelateDb();
  try {
    query(db2, seedScript(g, { vectors: false }));
    assert.deepEqual(query(db2, search, { v: fakeVector(target) }), []);
    query(db2, VECTOR_LOAD_STATEMENT, { rows: vectorRows(g) });
    assert.deepEqual(query(db2, search, { v: fakeVector(target) }), [{ id: 'get-started/install#verify' }]);
  } finally {
    db2.free();
  }
});

test('seedWithoutVectors strips exactly the vector statements a served seed carries', () => {
  const plain = buildGraph(fixture());
  assert.equal(seedWithoutVectors(seedScript(plain)), seedScript(plain));
  const g = buildGraph({ ...fixture(), embeddings: artifactFor(plain) });
  assert.ok(g.vectors.size > 0);
  assert.equal(seedWithoutVectors(seedScript(g)), seedScript(g, { vectors: false }));
  // The real graph: more than one vector statement (100 rows each).
  const real = buildGraph(graphInput());
  if (real.vectors.size) assert.ok(real.vectors.size > 100);
  const stripped = seedWithoutVectors(seedScript(real));
  assert.equal(stripped, seedScript(real, { vectors: false }));
  assert.doesNotMatch(stripped, /SET s\.embedding/);
  assert.match(stripped, new RegExp(`CREATE VECTOR INDEX ${VECTOR_INDEX} `));
  assert.throws(() => seedWithoutVectors('UNWIND [\n{id: 1}'), /has no end/);
});

test('readEmbeddings: a malformed artifact names the file and the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relate-embeddings-'));
  try {
    const file = join(dir, 'embeddings.json');
    writeFileSync(file, '{"format": 1, sections: []}');
    assert.throws(() => readEmbeddings(file), /embeddings\.json: not valid JSON \(.+\); run `npm run docs:embeddings -- --force`/);
    writeFileSync(file, '{"format": 0}');
    assert.throws(() => readEmbeddings(file), /not an embeddings artifact of format 1; run `npm run docs:embeddings -- --force`/);
    assert.equal(readEmbeddings(join(dir, 'missing.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the embeddings check: missing, stale, orphaned, malformed, questions and the recipe block', () => {
  const g0 = buildGraph(fixture());
  const found: [string, string, string][] = [];
  const report = (file: string, _line: number | null, _s: Severity, rule: string, message: string) => found.push([rule, file, message]);
  const site = { pages: fixture().pages.map((p) => ({ id: p.id, file: p.file, data: p.data })) } as unknown as Parameters<typeof checkEmbeddings>[0];

  // Current: nothing but the recipe (the fixture has none of the recipe's pages).
  const good = artifactFor(g0);
  checkEmbeddings(site, report, { graph: buildGraph({ ...fixture(), embeddings: good }), artifact: good, recipe: null, severity: 'error' });
  assert.deepEqual(found.map((f) => f[0]), ['embeddings-recipe']);

  found.length = 0;
  const bad = artifactFor(g0, (es) => {
    es.find((e) => e.id === 'guides/serve#steps')!.sha256 = '0'.repeat(64);
    es.splice(es.findIndex((e) => e.id === 'guides/serve#'), 1);
    es.push({ id: 'gone/page#x', sha256: '0'.repeat(64), vector: encodeVector(fakeVector(1)) });
    es.push({ id: 'misc/island#short', sha256: '0'.repeat(64), vector: encodeVector([0.1, 0.2]) });
  });
  bad.queries = bad.queries.filter((q) => q.id !== RECIPE_QUESTIONS[0]);
  const stats = checkEmbeddings(site, report, { graph: buildGraph({ ...fixture(), embeddings: bad }), artifact: bad, recipe: '# no block', severity: 'error' });
  const by = (rule: string) => found.filter((f) => f[0] === rule);
  assert.equal(stats.stale, 2);
  assert.equal(by('embeddings-stale').length, 1);
  assert.match(by('embeddings-stale')[0][1], /guides\/serve\.mdx$/);
  assert.match(by('embeddings-stale')[0][2], /2 section\(s\) have no current vector: the opening text \(no vector\), #steps \(text changed\); run `npm run docs:embeddings`/);
  assert.match(by('embeddings-orphan')[0][2], /gone\/page#x/);
  assert.match(by('embeddings-vector')[0][2], /"misc\/island#short" decodes to 2 values/);
  assert.match(by('embeddings-query')[0][2], new RegExp(`"${RECIPE_QUESTIONS[0]}" has no vector`));
  assert.equal(by('embeddings-recipe').length, 1);

  // Another model: one finding, everything stale.
  found.length = 0;
  checkEmbeddings(site, report, { graph: g0, artifact: { ...good, model: { ...good.model, pooling: 'mean' } }, recipe: null, severity: 'error' });
  assert.deepEqual(found.map((f) => f[0]), ['embeddings-artifact']);
  // No artifact at all.
  found.length = 0;
  checkEmbeddings(site, report, { graph: g0, artifact: null, recipe: null, severity: 'error' });
  assert.match(found[0][2], /^missing: the docs graph's \d+ sections have no vectors/);
  assert.equal(good.format, EMBEDDINGS_FORMAT);
  assert.equal(good.encoding, EMBEDDINGS_ENCODING);
  assert.equal(good.input, EMBEDDINGS_INPUT);
});

test('the recipe block is replaced in place, with its size', () => {
  const src = '# T\n\n## Data\n\n<details>\n<summary><code>docs</code> (0 KB)</summary>\n\n```json data=docs\n{}\n```\n\n</details>\n';
  const data = `{"x": "${'a'.repeat(3000)}"}`;
  const out = withRecipeData(src, data);
  assert.equal(recipeDataBlock(out), data);
  assert.match(out, /<summary><code>docs<\/code> \(3 KB\)<\/summary>/);
  assert.throws(() => withRecipeData('# none', data), /no ```json data=docs block/);
});

test('a prerequisite cycle is reported on each page in it', () => {
  const input = fixture();
  input.pages.push(
    page('guides/a', { title: 'A', description: 'd', prerequisites: ['guides/b'] }, 'Text.\n'),
    page('guides/b', { title: 'B', description: 'd', prerequisites: ['guides/a'] }, 'Text.\n'),
  );
  const g = buildGraph(input);
  const found: [string, string, string][] = [];
  checkGraph({ pages: [], engine: g.engine }, (file, _l, _s, rule, message) => found.push([rule, file, message]), { graph: g, wasm: loadWasmSync() });
  const cycles = found.filter((f) => f[0] === 'graph-prereq-cycle');
  assert.deepEqual(cycles.map((f) => f[1]), ['guides/a', 'guides/b']);
  assert.match(cycles[0][2], /its own prerequisite through 2 PREREQUISITE_OF step/);
  assert.deepEqual(found.filter((f) => f[0] === 'graph-seed'), []);
});

test('the capability catalog joins the graph without leaking into page graphs (DOCS-PLAN.md §3.8)', () => {
  const g = buildGraph(graphInput());
  const caps = g.nodes.filter((n) => n.label === 'Capability');
  assert.ok(caps.length > 0, 'the graph has Capability nodes');
  const capIds = new Set(caps.map((n) => n.id));
  // No page graph lists a Capability id as a page link or a documented command.
  for (const id of publishedPageIds(g)) {
    const md = pageGraphMarkdown(g, id);
    const linked = md.split('\n').filter((l) => /^- /.test(l));
    for (const c of capIds) {
      assert.ok(!linked.some((l) => l.includes(`](/docs/${c})`) || l.includes(`\`${c}\``) && !l.includes('problems-relate-solves')), `${id}.graph.md lists the capability ${c} as a page or command`);
    }
  }
  assert.ok(!pageGraphMarkdown(g, 'guides/agents/model-agent-memory').includes('/docs/agent-memory)'), 'model-agent-memory.graph.md names no capability as a page');
  // Every Capability solves at least two Problems (its problem and its intents).
  for (const c of capIds) {
    const n = g.rels.filter((r) => r.type === 'SOLVES' && r.from.id === c && r.to.label === 'Problem').length;
    assert.ok(n >= 2, `${c} SOLVES ${n} problem(s)`);
  }
  // Every CITES, VERIFIED_BY and HAS_CAPABILITY endpoint is a node.
  const keys = new Set(g.nodes.map((n) => `${n.label}:${n.id}`));
  for (const r of g.rels.filter((x) => ['CITES', 'VERIFIED_BY', 'HAS_CAPABILITY'].includes(x.type))) {
    assert.ok(keys.has(`${r.from.label}:${r.from.id}`), `${r.type} from ${r.from.label}:${r.from.id} exists`);
    assert.ok(keys.has(`${r.to.label}:${r.to.id}`), `${r.type} to ${r.to.label}:${r.to.id} exists`);
  }
  assert.match(seedScript(g), /CREATE FULLTEXT INDEX problems IF NOT EXISTS FOR \(n:Problem\) ON EACH \[n\.text\];/);
});

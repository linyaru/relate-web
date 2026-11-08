// Unit tests for the docs graph (graph.ts) and its structural checks
// (checks/graph.ts): run with `npm run docs:test`.

import assert from 'node:assert/strict';
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

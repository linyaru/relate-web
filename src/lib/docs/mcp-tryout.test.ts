// Tests for `:::mcp-tryout` and `:::agent-trace` (src/lib/docs/elements/):
// the shared protocol answers each tool call with the reply `relate serve
// --mcp` printed in the recorded runs on reference/server/mcp (replayed
// against the binary by docs:cli-check), timings aside; the pinned refusal
// texts are errors.json's; the gate reads the planner's own test corpus as
// the planner does; and the trace refuses a call the page does not make.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadEngine } from '../cookbook/run.ts';
import { ROOT } from './content.ts';
import {
  arrayItems,
  callTool,
  compactJson,
  ENGINE_READ_ONLY,
  gateReading,
  maskTimings,
  MISSING_STATEMENT,
  PARAMETERS_NOT_OBJECT,
  queryType,
  rawParameters,
  READ_ONLY_REJECTION,
  replyLine,
  requestLine,
  requestParameters,
  resultText,
  statementCount,
  topLevelMembers,
  UNKNOWN_WRITE_TOOL,
  WRITE_ONLY_REJECTION,
  type Call,
  type RunScript,
} from './elements/_mcp-tryout-protocol.ts';
import { verifyStatements } from './elements/agent-trace.ts';
import { recordedRun } from './elements/_mcp-tryout-record.ts';
import { loadSpec, type ElementInput } from './elements.ts';

const TEAM = `CREATE (ada:Person {name: 'Ada', role: 'engineer'}),
       (grace:Person {name: 'Grace', role: 'engineer'}),
       (noor:Person {name: 'Noor', role: 'maintainer'}),
       (relate:Project {name: 'relate', language: 'Rust'}),
       (tck:Project {name: 'opencypher-tck', language: 'Gherkin'}),
       (ada)-[:WORKS_ON {since: 2024}]->(relate),
       (grace)-[:WORKS_ON {since: 2023}]->(relate),
       (grace)-[:WORKS_ON {since: 2022}]->(tck),
       (noor)-[:MAINTAINS]->(relate),
       (ada)-[:KNOWS]->(grace)`;

const engine = await loadEngine();
/** A fresh in-memory database, seeded with `seed` when given, as a RunScript. */
function database(seed: string | null): RunScript {
  const db = new engine.RelateDb() as unknown as { executeScript(c: string, p?: string | null): string[] };
  if (seed) db.executeScript(seed);
  return async (code, params) => db.executeScript(code, params);
}

/** Every JSON-RPC line the reference page's recorded runs printed. */
const recorded = new Set(
  readFileSync(join(ROOT, 'src/content/docs/reference/server/mcp.mdx'), 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('{"jsonrpc":"2.0"')),
);
const errors = JSON.parse(readFileSync(join(ROOT, 'src/content/docs/_data/errors.json'), 'utf8'));
const errorEntry = (id: string) => [...errors.mcp, ...errors.engine].find((e: { id: string }) => e.id === id);

async function reply(seed: string | null, call: Call, id: number, readOnly = true) {
  return maskTimings((await callTool(database(seed), call, id, { readOnly })).reply);
}

test('the pinned texts are the recorded server answers in errors.json', () => {
  assert.equal(errorEntry('mcp-read-query-only').message, READ_ONLY_REJECTION);
  assert.equal(errorEntry('mcp-write-query-only').message, WRITE_ONLY_REJECTION);
  assert.equal(errorEntry('mcp-unknown-tool').message.replace('<name>', 'write_cypher'), UNKNOWN_WRITE_TOOL);
  assert.equal(errorEntry('mcp-parameters-not-object').message, PARAMETERS_NOT_OBJECT);
  assert.equal(errorEntry('mcp-missing-statement').message, MISSING_STATEMENT);
  const ro = errorEntry(ENGINE_READ_ONLY.id);
  assert.equal(ro.gql_status, ENGINE_READ_ONLY.code);
  assert.equal(ro.name, ENGINE_READ_ONLY.name);
  // The read-only server's answer to write_cypher, as the binary printed it.
  const line = errorEntry('mcp-unknown-tool').recorded.stdout.trim().split('\n')[1];
  assert.equal(replyLine(2, UNKNOWN_WRITE_TOOL, true), line);
  // The static form quotes that run and names errors.json's version, read at build.
  const page = { id: 'reference/server/mcp', file: join(ROOT, 'src/content/docs/reference/server/mcp.mdx') };
  const quoted = recordedRun({ page } as unknown as ElementInput, 'mcp-unknown-tool');
  assert.equal(quoted.version, errors.verified);
  assert.equal(quoted.run.stdout, errorEntry('mcp-unknown-tool').recorded.stdout);
  assert.match(quoted.run.command, /--read-only/);
});

test('parameters reach the engine and the request as the host wrote them: 1.0 stays a float', async () => {
  const call: Call = { tool: 'read_cypher', arguments: { statement: 'RETURN $x AS x, valueType($x) AS t', parameters: { x: 1 } }, parametersText: '{"x": 1.0}' };
  const out = await callTool(database(null), call, 1, { readOnly: false });
  assert.equal(out.source, 'engine', out.text);
  assert.match(out.request, /"parameters":\{"x":1\.0\}/);
  assert.match(String((out.envelope as { rows: { t: string }[] }).rows[0].t), /^FLOAT/);
  assert.match(out.text, /"x":1\.0/);
  // Without the text, the parsed value is all there is: the integer the parse made.
  const parsed = await callTool(database(null), { tool: call.tool, arguments: call.arguments }, 1, { readOnly: false });
  assert.match(String((parsed.envelope as { rows: { t: string }[] }).rows[0].t), /^INTEGER/);
  // The raw text is found in a data block, in a request line, and kept by the request line.
  const block = '{"calls": [\n  {"tool": "get_schema", "arguments": {}},\n  {"tool": "read_cypher", "arguments": {"statement": "RETURN $v AS v", "parameters": {"v": [0.9, 0.0]}}}\n]}';
  assert.deepEqual(rawParameters(block, 'calls'), [undefined, '{"v": [0.9, 0.0]}']);
  const line = requestLine(3, { tool: 'read_cypher', arguments: { statement: 'RETURN $v AS v', parameters: { v: [0.9, 0] } }, parametersText: '{"v": [0.9, 0.0]}' });
  assert.equal(line, '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_cypher","arguments":{"statement":"RETURN $v AS v","parameters":{"v":[0.9,0.0]}}}}');
  assert.equal(requestParameters(line), '{"v":[0.9,0.0]}');
  assert.equal(compactJson('{ "a" : "x y",\n "b": [1.0, 2] }'), '{"a":"x y","b":[1.0,2]}');
  assert.deepEqual(arrayItems('[1, {"a": [2, 3]}, "x,]"]'), ['1', '{"a": [2, 3]}', '"x,]"']);
});

test('a refusal the server answers before the engine says so', async () => {
  const run = database(null);
  for (const call of [
    { tool: 'read_cypher', arguments: { statement: 'RETURN 1', parameters: [1] } },
    { tool: 'read_cypher', arguments: { query: 'RETURN 1' } },
    { tool: 'get_schema', arguments: { sample_size: -5 } },
  ] as Call[]) {
    const out = await callTool(run, call, 1, { readOnly: false });
    assert.equal(out.source, 'refused', out.text);
    assert.equal(out.isError, true);
  }
  const ro = await callTool(run, { tool: 'write_cypher', arguments: { statement: 'CREATE (n)' } }, 9, { readOnly: true });
  assert.equal(ro.source, 'recorded');
  assert.equal(ro.reply, replyLine(9, UNKNOWN_WRITE_TOOL, true));
});

test('get_schema answers as the recorded server does, with the default and a small sample', async () => {
  for (const [id, args] of [[1, {}], [2, { sample_size: 1 }]] as const) {
    const got = await reply(TEAM, { tool: 'get_schema', arguments: args }, id);
    assert.ok(recorded.has(got), got);
  }
  assert.ok(recorded.has(await reply(TEAM, { tool: 'get_schema', arguments: { sample_size: -2 } }, 7)));
});

test('read_cypher answers as the recorded server does: rows, plan, notifications, timings', async () => {
  const call: Call = {
    tool: 'read_cypher',
    arguments: { statement: 'MATCH (p:Person)-[w:WORKS_ON]->(:Project {name: $project}) RETURN p.name AS name, w.since AS since ORDER BY since', parameters: { project: 'relate' } },
  };
  const got = await reply(TEAM, call, 1);
  assert.ok(recorded.has(got), got);
  const out = await callTool(database(TEAM), call, 1, { readOnly: true });
  assert.equal(out.source, 'engine');
  assert.equal(out.queryType, 'r');
  assert.deepEqual(JSON.parse(out.text).columns, ['name', 'since']);
});

test('write_cypher answers as the recorded server does: counters, empty rows', async () => {
  const call: Call = { tool: 'write_cypher', arguments: { statement: 'CREATE (:Person {name: $name, role: $role})', parameters: { name: 'Ada', role: 'engineer' } } };
  assert.ok(recorded.has(await reply(null, call, 1, false)));
});

test('the refusals and tool errors are the recorded ones', async () => {
  const calls: [number, Call][] = [
    [1, { tool: 'read_cypher', arguments: { statement: 'MATCH (p:Person {name: $name}) DETACH DELETE p', parameters: { name: 'Ada' } } }],
    [2, { tool: 'read_cypher', arguments: { statement: 'CREATE INDEX person_name FOR (p:Person) ON (p.name)' } }],
    [3, { tool: 'write_cypher', arguments: { statement: 'CREATE (:Person {name: "Eve"})' } }],
    [4, { tool: 'read_cypher', arguments: { query: 'MATCH (p:Person) RETURN count(p) AS people' } }],
    [5, { tool: 'read_cypher', arguments: { statement: 'RETURN $limit AS n', parameters: '10' } }],
    [6, { tool: 'read_cypher', arguments: { statement: 'RETURN $limit AS n' } }],
  ];
  for (const [id, call] of calls) {
    const got = await reply(TEAM, call, id);
    assert.ok(recorded.has(got), `${id}: ${got}`);
  }
  const out = await callTool(database(TEAM), calls[0][1], 1, { readOnly: true });
  assert.equal(out.source, 'classified');
  assert.equal((await callTool(database(TEAM), calls[2][1], 3, { readOnly: true })).source, 'recorded');
});

test('the result text splices the engine\'s own JSON, keeping its number spelling', () => {
  const exec = '{"columnTypes":["FLOAT"],"columns":["f"],"elapsed_ms":1.5,"error":null,"execute_ms":1.0,"notifications":[],"parse_ms":0.25,"plan":null,"plan_ms":0.25,"rows":[{"f":2.0}],"stats":{"nodes_created":0}}';
  const plan = '{"columnTypes":[],"columns":[],"notifications":[{"code":"x"}],"plan":{"root":{"operator":"ProduceResults","children":[]}},"rows":[]}';
  const text = resultText(exec, plan, 'read_cypher');
  assert.match(text, /"rows":\[\{"f":2\.0\}\]/);
  assert.match(text, /"notifications":\[\{"code":"x"\}\]/);
  assert.match(resultText(exec, plan, 'write_cypher'), /"rows":\[\]/);
  assert.deepEqual([...topLevelMembers('{"a": "x,}]", "b" : [1, {"c": 2}] }').entries()], [['a', '"x,}]"'], ['b', '[1, {"c": 2}]']]);
});

// relate-planner/src/query_type.rs's own tests, as the gate reads their plans
// on the engine, and the writes and schema statements an edited call invites
// (SET with a map, labels set and removed, the vector and full-text indexes).
// A WHEN/ELSE hides its branches from the plan, so the gate counts it as a
// write and says so (read_cypher refuses a read inside one; closed).
const CORPUS: Record<string, string[]> = {
  r: ['RETURN 1 AS n', 'MATCH (n) RETURN n', 'MATCH (n) WITH n UNWIND [1, 2] AS x RETURN n, x', 'SHOW INDEXES', 'SHOW DATABASES', 'CALL db.labels()', 'RETURN 1 AS x UNION RETURN 2 AS x', 'MATCH (a:Room) OPTIONAL MATCH (a)-[:NORTH]->(b) RETURN a.name, b.name', 'OPTIONAL MATCH (n) RETURN n', 'MATCH (a) OPTIONAL MATCH (a)-[:R]->(b) FINISH', 'MATCH (a) RETURN a NEXT MATCH (b) OPTIONAL MATCH (b)-[:R]->(c) RETURN b, c'],
  w: ['CREATE (n)', 'MERGE (n:N {id: 1})', 'MATCH (n) SET n.x = 1', 'MATCH (n) DETACH DELETE n', 'MATCH (n) DELETE n', 'MATCH (n) REMOVE n.x', 'FOREACH (x IN [1] | CREATE (n))', 'CALL { CREATE (n) }', 'WHEN true THEN { CREATE (n) }', 'RETURN 1 AS x NEXT CREATE (n)', 'MATCH (n) SET n += {a: 1}', 'MATCH (n) SET n = {a: 1}', 'MATCH (n) SET n:L', 'MATCH (n) REMOVE n:L'],
  rw: ['CREATE (n) RETURN n', 'MATCH (n) SET n.x = 1 RETURN n', 'MATCH (n) DETACH DELETE n RETURN n', 'MATCH (n) REMOVE n.x RETURN n', 'RETURN 1 AS x UNION CREATE (n) RETURN 1 AS x', 'CALL { RETURN 1 AS x } RETURN x', 'MERGE (n:N {id: 1}) RETURN *'],
  s: [
    'CREATE INDEX i FOR (n:N) ON (n.p)',
    'DROP INDEX i',
    'CREATE CONSTRAINT c FOR (n:N) REQUIRE n.id IS UNIQUE',
    'DROP CONSTRAINT c',
    'CREATE GRAPH TYPE g { (:A => {id :: INTEGER IS KEY}) }',
    "CREATE VECTOR INDEX v FOR (n:N) ON (n.e) OPTIONS {indexConfig: {`vector.dimensions`: 4, `vector.similarity_function`: 'cosine'}}",
    'CREATE FULLTEXT INDEX f FOR (n:N) ON EACH [n.t]',
  ],
};

test('the gate reads the planner corpus as the planner classifies it', async () => {
  const run = database(null);
  for (const [want, statements] of Object.entries(CORPUS)) {
    for (const s of statements) {
      const [env] = await run(`EXPLAIN ${s}`, null);
      const parsed = JSON.parse(env);
      assert.equal(parsed.error, null, `${s}: ${parsed.error}`);
      assert.equal(queryType(parsed.plan.root), want, s);
      // A read's every operator is one the gate knows: an unknown one would make read_cypher refuse a read the server runs.
      if (want === 'r') assert.equal(gateReading(parsed.plan.root).notes, null, s);
    }
  }
  const [when] = await run('EXPLAIN WHEN true THEN { RETURN 1 AS x } ELSE { RETURN 2 AS x }', null);
  const reading = gateReading(JSON.parse(when).plan.root);
  assert.equal(reading.type, 'w');
  assert.equal(reading.notes?.conditional, true);
});

test('an operator the gate does not know counts as a write, and the outcome names it', () => {
  const plan = { operator: 'ProduceResults', details: '1 item(s)', children: [{ operator: 'SomeFutureWrite', details: '', children: [] }] };
  const reading = gateReading(plan);
  assert.equal(reading.type, 'rw');
  assert.deepEqual(reading.notes, { unknown: ['SomeFutureWrite'], conditional: false });
  assert.equal(gateReading({ operator: 'Catalog', details: 'TERMINATE TRANSACTIONS', children: [] }).type, 'w');
});

test('a trailing semicolon is sent and kept in the plan, as the server keeps it', async () => {
  // relate 0.16.1, `relate serve --mcp stdio --database :memory:`, timings masked.
  const server =
    '{"jsonrpc":"2.0","id":2,"result":{"content":[{"text":"{\\"columnTypes\\":[\\"INTEGER\\"],\\"columns\\":[\\"a\\"],\\"elapsed_ms\\":<ms>,\\"error\\":null,\\"execute_ms\\":<ms>,\\"notifications\\":[],\\"parse_ms\\":<ms>,\\"plan\\":{\\"profiled\\":false,\\"root\\":{\\"actual\\":null,\\"children\\":[],\\"details\\":\\"1 item(s)\\",\\"estimated_rows\\":null,\\"identifiers\\":[],\\"operator\\":\\"ProduceResults\\",\\"warnings\\":[]},\\"schema\\":\\"relate.plan/v1\\",\\"statement\\":\\"RETURN 1 AS a;\\"},\\"plan_ms\\":<ms>,\\"rows\\":[{\\"a\\":1}],\\"stats\\":{\\"constraints_added\\":0,\\"constraints_removed\\":0,\\"indexes_added\\":0,\\"indexes_removed\\":0,\\"labels_added\\":0,\\"labels_removed\\":0,\\"nodes_created\\":0,\\"nodes_deleted\\":0,\\"properties_set\\":0,\\"relationships_created\\":0,\\"relationships_deleted\\":0}}","type":"text"}],"isError":false}}';
  assert.equal(await reply(null, { tool: 'read_cypher', arguments: { statement: 'RETURN 1 AS a;  ' } }, 2), server);
});

test('one statement, a trailing semicolon, or a second statement, outside strings and comments', () => {
  assert.equal(statementCount('MATCH (n) RETURN n; CREATE (x)'), 'second');
  assert.equal(statementCount('RETURN 1;'), 'trailing');
  assert.equal(statementCount('RETURN 1;  \n'), 'trailing');
  assert.equal(statementCount('RETURN 1;;'), 'second');
  assert.equal(statementCount("RETURN 'a;b' AS s, \"c;\" AS t, `x;y` AS u"), 'one');
  assert.equal(statementCount('RETURN 1 // a; b\n'), 'one');
  assert.equal(statementCount('RETURN /* ; */ 1'), 'one');
});

test('a trace counts only whole statements a verify fence runs', () => {
  const fence = [
    "cat > s.cypher <<'EOF'",
    'MATCH (n) WHERE n:Person SET n:Entity;',
    'MATCH (e:Entity) RETURN e.key AS key ORDER BY key;',
    'EOF',
    'relate --database ./x.rl --read-only "MATCH (p:Person) RETURN p.name AS name"',
    "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"read_cypher\",\"arguments\":{\"statement\":\"RETURN 1 AS one\"}}}'",
  ].join('\n');
  const found = verifyStatements([fence]);
  for (const s of ['MATCH (n) WHERE n:Person SET n:Entity', 'MATCH (e:Entity) RETURN e.key AS key ORDER BY key', 'MATCH (p:Person) RETURN p.name AS name', 'RETURN 1 AS one']) assert.ok(found.has(s), s);
  for (const fragment of ['MATCH (n)', 'RETURN e', 'MATCH (p:Person)']) assert.ok(!found.has(fragment), fragment);
});

/** An ElementInput for a scratch page holding `source`. */
function scratch(source: string, attributes: Record<string, string>, dataBlocks: Record<string, string>, cells: ElementInput['cells'] = []): ElementInput {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-tryout-'));
  const file = join(dir, 'page.mdx');
  writeFileSync(file, source);
  return { name: 'agent-trace', id: 'agent-trace-1', attributes, children: '', page: { id: 'scratch/page', file }, cells, dataBlocks, recordings: {} };
}

test('a trace replays only calls the page makes', async () => {
  const trace = await loadSpec('agent-trace');
  const cell = { id: 'seed', code: 'CREATE (:Person {name: $name})', index: 1, title: null, line: 1, name: 'seed', params: 'who', expectError: false } as unknown as ElementInput['cells'][number];
  const page = "```bash verify\nrelate --database ./x.rl --read-only \"MATCH (p:Person) RETURN p.name AS name\"\n```\n";
  const steps = (s: unknown[]) => ({ trace: JSON.stringify({ steps: s }), who: '{"name": "Ada"}' });
  const ok = scratch(page, { steps: 'trace', from: 'seed' }, steps([
    { tool: 'read_cypher', arguments: { statement: 'MATCH (p:Person)  RETURN p.name AS name' }, note: 'The CLI read.' },
    { tool: 'write_cypher', arguments: { statement: 'CREATE (:Person {name: $name})', parameters: { name: 'Ada' } }, note: 'The cell.' },
  ]), [cell]);
  assert.deepEqual(trace.validate!(ok), []);
  const invented = scratch(page, { steps: 'trace', from: 'seed' }, steps([{ tool: 'read_cypher', arguments: { statement: 'MATCH (n) RETURN n' }, note: 'Made up.' }]), [cell]);
  assert.match(trace.validate!(invented).join('\n'), /not one the page runs/);
  const data = scratch(page, { steps: 'trace', from: 'seed' }, steps([{ tool: 'write_cypher', arguments: { statement: 'CREATE (:Person {name: $name})', parameters: { name: 'Eve' } }, note: 'Other data.' }]), [cell]);
  assert.match(trace.validate!(data).join('\n'), /not data the page holds/);
  const noNote = scratch(page, { steps: 'trace', from: 'nope' }, steps([{ tool: 'get_schema', arguments: {} }]), [cell]);
  const problems = trace.validate!(noNote).join('\n');
  assert.match(problems, /`from` names `nope`/);
  assert.match(problems, /`note` says where the call comes from/);
});

test('a request a verify fence sends in a printf argument lends the trace its statement and its parameters', async () => {
  const trace = await loadSpec('agent-trace');
  const cell = { id: 'seed', code: "CREATE (:Person {name: 'Ada'})", index: 1, title: null, line: 1, name: 'seed', params: null, expectError: false } as unknown as ElementInput['cells'][number];
  const request = '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_cypher","arguments":{"statement":"MATCH (p:Person {name: $name}) DETACH DELETE p","parameters":{"name":"Ada"}}}}';
  const page = "```bash verify\nprintf '%s\\n' \\\n  '" + request + "' \\\n  | relate serve --mcp stdio --database ./team --read-only 2>/dev/null\n```\n";
  const step = (name: string) => ({ trace: JSON.stringify({ steps: [{ tool: 'read_cypher', arguments: { statement: 'MATCH (p:Person {name: $name}) DETACH DELETE p', parameters: { name } }, note: 'The refused delete.', expect: 'error' }] }) });
  assert.deepEqual(trace.validate!(scratch(page, { steps: 'trace', from: 'seed' }, step('Ada'), [cell])), []);
  assert.match(trace.validate!(scratch(page, { steps: 'trace', from: 'seed' }, step('Eve'), [cell])).join('\n'), /not data the page holds/);
});

test('a tryout shows all three tools, each with the arguments its schema takes', async () => {
  const tryout = await loadSpec('mcp-tryout');
  const input = (calls: unknown) => ({ ...scratch('', { calls: 'c' }, { c: JSON.stringify({ calls }) }), name: 'mcp-tryout' });
  const three = [
    { tool: 'get_schema', arguments: {} },
    { tool: 'read_cypher', arguments: { statement: 'RETURN 1 AS n' } },
    { tool: 'write_cypher', arguments: { statement: 'CREATE (n)', parameters: { a: 1 } } },
  ];
  assert.deepEqual(tryout.validate!(input(three)), []);
  assert.match(tryout.validate!(input(three.slice(0, 2))).join('\n'), /no call is `write_cypher`/);
  assert.match(tryout.validate!(input([...three, { tool: 'read_cypher', arguments: { query: 'x' } }])).join('\n'), /not `query`/);
  assert.match(tryout.validate!(input([...three, { tool: 'drop_db', arguments: {} }])).join('\n'), /`tool` is one of/);
});

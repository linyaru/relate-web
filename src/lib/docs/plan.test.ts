// Unit tests for the plan viewer's model (src/lib/docs/elements/_plan-model.ts):
// the plan table it rebuilds from a `relate.plan/v1` document must equal what
// the relate binary printed for the same statement (the `bash verify`
// commands on the plan pages and their recorded output, which
// `npm run docs:cli-check` replays against the binary), and the speedscope
// document must be the bytes `relate --mode speedscope` writes.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadEngine } from '../cookbook/run.ts';
import { DOCS_DIR } from './content.ts';
import {
  deltas,
  fixed,
  indexName,
  missingIndex,
  planTableLines,
  planText,
  preOrder,
  speedscope,
  speedscopeRefusal,
  splitStatement,
  summarize,
  withMode,
  type PlanDoc,
  type PlanNote,
  type PlanOp,
} from './elements/_plan-model.ts';

interface Envelope {
  error: string | null;
  plan: PlanDoc | null;
  notifications: PlanNote[];
}

const wasm = await loadEngine();

/** The `bash verify` commands of a page, each with its recorded output: the next fence on the page when that is a `text` fence (as docs:cli-check reads it). */
function verifiedCommands(page: string): { command: string; output: string | null }[] {
  const src = readFileSync(join(DOCS_DIR, page), 'utf8');
  const fences = [...src.matchAll(/^```(\S*)(?: ([^\n]*))?\n([\s\S]*?)\n```$/gm)].map((m) => ({ lang: m[1], meta: m[2] ?? '', body: m[3] }));
  return fences.flatMap((f, i) =>
    f.lang === 'bash' && f.meta.trim() === 'verify' ? [{ command: f.body, output: fences[i + 1]?.lang === 'text' ? fences[i + 1].body : null }] : [],
  );
}

/** The flags and the Cypher of `relate [flags] "<cypher>"`. */
function parseCommand(command: string): { flags: string; cypher: string } {
  const open = command.indexOf('"');
  return { flags: command.slice(0, open), cypher: command.slice(open + 1, command.lastIndexOf('"')) };
}

// Each page's terminal steps, replayed on the WASM: one database per store
// the commands name, and for every table-mode EXPLAIN the plan text rebuilt
// from the envelopes against the binary's recorded output.
for (const page of ['guides/cypher/tune-a-query.mdx', 'guides/cypher/indexes-and-constraints.mdx', 'reference/cypher/explain-and-profile.mdx', 'concepts/architecture.mdx']) {
  test(`planText reproduces the binary's EXPLAIN tables on ${page}`, () => {
    const stores = new Map<string, InstanceType<typeof wasm.RelateDb>>();
    let compared = 0;
    try {
      for (const { command, output } of verifiedCommands(page)) {
        const { flags, cypher } = parseCommand(command);
        if (/--mode speedscope/.test(flags)) continue; // an error case; the speedscope tests below cover the mode
        const store = /--database (\S+)/.exec(flags)?.[1] ?? ':memory:';
        if (store === ':memory:') stores.get(store)?.free();
        if (store === ':memory:' || !stores.has(store)) stores.set(store, new wasm.RelateDb());
        const envelopes = stores.get(store)!.executeScript(cypher, null).map((t) => JSON.parse(t) as Envelope);
        for (const e of envelopes) assert.equal(e.error, null, `${command}: ${e.error}`);
        const plans = envelopes.filter((e) => e.plan);
        if (/--mode table/.test(flags) && plans.length && output !== null) {
          assert.equal(plans.map((e) => planText(e.plan!, e.notifications)).join('\n'), output, command);
          compared++;
        }
        if (/--mode json/.test(flags) && plans.length && output !== null) {
          // The structured plan's `string-representation` is the same table under a version header.
          const repr = (JSON.parse(output) as { plan: { args: Record<string, string> } }).plan.args['string-representation'];
          assert.equal(repr.slice(repr.indexOf('Query: ')), planTableLines(plans[0].plan!).join('\n'), command);
          compared++;
        }
      }
    } finally {
      for (const db of stores.values()) db.free();
    }
    assert.ok(compared > 0, `${page} has no EXPLAIN recording to compare`);
  });
}

// `relate --mode speedscope` output for three PROFILE statements on the
// shared example graph (relate 0.16.1, ac441ec, recorded 2026-11-08 on a
// team.rl store opened --read-only). The times differ on every run, so the
// test plans each statement on the WASM for its operators and shape and
// gives each operator the time its frame spans in the recording: the bytes
// must then come out the same.
const CLI_SPEEDSCOPE: [string, string][] = [
  [
    "PROFILE MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project",
    '{"$schema":"https://www.speedscope.app/file-format-schema.json","exporter":"relate@0.16.1","profiles":[{"endValue":4291,"events":[{"at":0,"frame":0,"type":"O"},{"at":0,"frame":1,"type":"O"},{"at":4291,"frame":1,"type":"C"},{"at":4291,"frame":0,"type":"C"}],"name":"relate PROFILE","startValue":0,"type":"evented","unit":"nanoseconds"}],"shared":{"frames":[{"name":"ProduceResults 0"},{"name":"Expand 1"}]}}\n',
  ],
  [
    'PROFILE MATCH (p:Person)-[:WORKS_ON]->(proj:Project) WITH proj, count(p) AS people WHERE people > 1 RETURN proj.name AS project, people ORDER BY people DESC LIMIT 5',
    '{"$schema":"https://www.speedscope.app/file-format-schema.json","exporter":"relate@0.16.1","profiles":[{"endValue":14541,"events":[{"at":0,"frame":0,"type":"O"},{"at":0,"frame":1,"type":"O"},{"at":0,"frame":2,"type":"O"},{"at":14541,"frame":2,"type":"C"},{"at":14541,"frame":1,"type":"C"},{"at":14541,"frame":0,"type":"C"}],"name":"relate PROFILE","startValue":0,"type":"evented","unit":"nanoseconds"}],"shared":{"frames":[{"name":"ProduceResults 0"},{"name":"EagerAggregation 1"},{"name":"Expand 2"}]}}\n',
  ],
  [
    'PROFILE MATCH (p:Person) OPTIONAL MATCH (p)-[:KNOWS]->(f) RETURN p.name AS name, f.name AS friend',
    '{"$schema":"https://www.speedscope.app/file-format-schema.json","exporter":"relate@0.16.1","profiles":[{"endValue":7542,"events":[{"at":0,"frame":0,"type":"O"},{"at":0,"frame":1,"type":"O"},{"at":0,"frame":2,"type":"O"},{"at":7542,"frame":2,"type":"C"},{"at":7542,"frame":1,"type":"C"},{"at":7542,"frame":0,"type":"C"}],"name":"relate PROFILE","startValue":0,"type":"evented","unit":"nanoseconds"}],"shared":{"frames":[{"name":"ProduceResults 0"},{"name":"Optional(Expand) 1"},{"name":"NodeByLabelScan 2"}]}}\n',
  ],
];

const SEED = `CREATE (ada:Person {name: 'Ada', role: 'engineer'}), (grace:Person {name: 'Grace', role: 'engineer'}), (noor:Person {name: 'Noor', role: 'maintainer'}),
  (relate:Project {name: 'relate', language: 'Rust'}), (tck:Project {name: 'opencypher-tck', language: 'Gherkin'}),
  (ada)-[:WORKS_ON {since: 2024}]->(relate), (grace)-[:WORKS_ON {since: 2023}]->(relate), (grace)-[:WORKS_ON {since: 2022}]->(tck),
  (noor)-[:MAINTAINS]->(relate), (ada)-[:KNOWS]->(grace)`;

/** One statement's last envelope on a fresh database holding the example graph. */
function onExample(statement: string): Envelope {
  const db = new wasm.RelateDb();
  try {
    db.executeScript(SEED, null);
    return JSON.parse(db.executeScript(statement, null).at(-1)!) as Envelope;
  } finally {
    db.free();
  }
}

test('speedscope writes the bytes relate --mode speedscope wrote for the same profile', () => {
  for (const [statement, recorded] of CLI_SPEEDSCOPE) {
    const plan = onExample(statement).plan!;
    assert.ok(plan.profiled, statement);
    const doc = JSON.parse(recorded) as { profiles: { events: { type: string; frame: number; at: number }[] }[] };
    const opened = new Map<number, number>();
    const span = new Map<number, number>();
    for (const e of doc.profiles[0].events) {
      if (e.type === 'O') opened.set(e.frame, e.at);
      else span.set(e.frame, e.at - opened.get(e.frame)!);
    }
    for (const p of preOrder(plan.root)) p.op.actual!.time_ms = span.get(p.id)! / 1e6;
    assert.equal(speedscope(plan, '0.16.1'), recorded, statement);
  }
});

const op = (operator: string, ns: number | null, children: PlanOp[] = []): PlanOp => ({
  operator,
  details: '',
  estimated_rows: null,
  children,
  actual: ns === null ? null : { rows: 1, time_ms: ns / 1e6 },
});

test('speedscope lays out children as upstream does: sequential, scaled to fit, the last taking the remainder', () => {
  // Upstream's golden fixture (surfaces/relate-formatter/src/tests/speedscope.rs): children of 4 and 7 us inside a 10 us parent.
  const plan: PlanDoc = { profiled: true, statement: 'RETURN 1', root: op('ProduceResults', 10_000, [op('AllNodesScan', 4_000), op('Filter', 7_000)]) };
  const doc = JSON.parse(speedscope(plan, '0.16.1'));
  assert.deepEqual(doc.shared.frames.map((f: { name: string }) => f.name), ['ProduceResults 0', 'AllNodesScan 1', 'Filter 2']);
  assert.deepEqual(
    doc.profiles[0].events.map((e: { type: string; frame: number; at: number }) => [e.type, e.frame, e.at]),
    [['O', 0, 0], ['O', 1, 0], ['C', 1, 3636], ['O', 2, 3636], ['C', 2, 10000], ['C', 0, 10000]],
  );
  // Without the overflow, each child keeps its own time.
  const fits: PlanDoc = { profiled: true, statement: 'RETURN 1', root: op('ProduceResults', 9_000, [op('AllNodesScan', 2_000)]) };
  assert.deepEqual(JSON.parse(speedscope(fits, '0.16.1')).profiles[0].events.map((e: { at: number }) => e.at), [0, 0, 2000, 9000]);
});

test('speedscope refuses a plan without PROFILE measures, with the CLI message', () => {
  const explain = onExample("EXPLAIN MATCH (p:Person {name: 'Ada'}) RETURN p").plan!;
  assert.throws(() => speedscope(explain, '0.16.1'), { message: speedscopeRefusal('the plan tree carries no PROFILE metrics') });
  // The binary refuses this UNION too: its root records no measures (relate 0.16.1).
  const union = onExample('PROFILE MATCH (a:Person) RETURN a.name AS n UNION MATCH (b:Project) RETURN b.name AS n').plan!;
  assert.throws(() => speedscope(union, '0.16.1'), { message: speedscopeRefusal('the plan tree carries no PROFILE metrics') });
  const half: PlanDoc = { profiled: true, statement: 'x', root: op('ProduceResults', 5, [op('Expand', null)]) };
  assert.throws(() => speedscope(half, '0.16.1'), { message: speedscopeRefusal('an operator carries no PROFILE metrics') });
});

test('fixed rounds an exact tie to even, as Rust prints an f64', () => {
  assert.equal(fixed(0.0625, 3), '0.062');
  assert.equal(fixed(0.1875, 3), '0.188');
  assert.equal(fixed(0.0055, 3), (0.0055).toFixed(3));
  assert.equal(fixed(25, 1), '25.0');
  assert.equal(fixed(0.004708, 3), '0.005');
});

test('the statement helpers split the prefix and read index statements', () => {
  assert.deepEqual(splitStatement('EXPLAIN MATCH (n) RETURN n'), { version: '', mode: 'EXPLAIN', body: 'MATCH (n) RETURN n' });
  assert.deepEqual(splitStatement('CYPHER 25 profile\nMATCH (n)\nRETURN n;'), { version: 'CYPHER 25 ', mode: 'PROFILE', body: 'MATCH (n)\nRETURN n' });
  assert.equal(splitStatement('MATCH (n) RETURN n'), null);
  assert.equal(withMode('EXPLAIN MATCH (n) RETURN n', 'PROFILE'), 'PROFILE MATCH (n) RETURN n');
  assert.equal(indexName('CREATE INDEX relate_Person__name FOR (n:Person) ON (n.name)'), 'relate_Person__name');
  assert.equal(indexName('CREATE TEXT INDEX t IF NOT EXISTS FOR (n:P) ON (n.x)'), 't');
  assert.equal(indexName('CREATE CONSTRAINT c FOR (n:P) REQUIRE n.x IS UNIQUE'), null);
  const before = onExample("EXPLAIN MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project");
  assert.equal(missingIndex(before.notifications), 'CREATE INDEX relate_Person__name FOR (n:Person) ON (n.name)');
});

test('deltas compare two plans of one statement, before and after its index', () => {
  const db = new wasm.RelateDb();
  try {
    db.executeScript(SEED, null);
    const q = "PROFILE MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project";
    const before = JSON.parse(db.executeScript(q, null)[0]) as Envelope;
    const after = JSON.parse(db.executeScript(`CREATE INDEX relate_Person__name FOR (n:Person) ON (n.name); ${q}`, null)[1]) as Envelope;
    const rows = deltas(summarize(before.plan!, before.notifications), summarize(after.plan!, after.notifications));
    const by = Object.fromEntries(rows.map((r) => [r.measure, r]));
    assert.equal(by['Operators, root first'].before, 'ProduceResults, Expand');
    assert.equal(by['Operators, root first'].after, 'ProduceResults, NodeIndexSeek');
    assert.equal(by['Notifications'].before, '03C91');
    assert.equal(by['Notifications'].after, 'none');
    assert.equal(by['Database hits, every operator'].before, '5');
    assert.equal(by['Database hits, every operator'].after, '2');
    assert.equal(by['Database hits, every operator'].change, '3 fewer');
    assert.equal(by['Estimated rows where the plan starts'].change, '-');
    assert.equal(by['Rows returned'].change, 'same');
    // Times print as every element prints them (formatMs: one decimal, the browser timer's step), never to three places.
    for (const v of [by['Time, every operator (ms)'].before, by['Time, every operator (ms)'].after]) assert.match(v, /^(?:<0\.1|\d+(?:\.\d)?)$/);
    assert.match(by['Time, every operator (ms)'].change, /^(?:same|\d+(?:\.\d)? ms (?:more|less))$/);
  } finally {
    db.free();
  }
});

// `relate --mode json` output's `plan` for four PROFILE statements on the
// example graph (relate 0.16.1, ac441ec, recorded 2026-11-08, team.rl opened
// --read-only): the structured plan carries each operator's measures, and its
// `string-representation` is the PROFILE table printed from the same run, so
// the table rebuilt from those measures must equal it, times included. The
// second is the documented quirk: a count() over an Expand whose top
// operator records no measures, printed as `-`.
const CLI_PROFILE_PLANS: string[] = [
  "{\"args\":{\"DbHits\":0,\"Details\":\"1 item(s)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":0,\"Memory\":45,\"MemoryBytes\":45,\"NeighborWalks\":0,\"NodeReads\":0,\"Rows\":1,\"SeekTimeNs\":0,\"TimeNs\":5417,\"WalkTimeNs\":0,\"planner\":\"relate\",\"planner-impl\":\"relate\",\"planner-version\":\"0.16.1\",\"runtime\":\"relate\",\"runtime-impl\":\"relate\",\"runtime-version\":\"0.16.1\",\"string-representation\":\"Cypher 5\\n\\nPlanner relate\\n\\nRuntime relate\\n\\nRuntime version 0.16.1\\n\\nQuery: MATCH (p:Person {name: 'Ada'})-[:WORKS_ON]->(proj:Project) RETURN proj.name AS project\\nPlan:\\n+------------------+----+----------------------------------------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| Operator         | Id | Details                                                              | Rows | Time (ms) | Total (ms) | Db Hits | Nodes | Degree | Memory (Bytes) | Expression Built (Bytes) |\\n+------------------+----+----------------------------------------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| + ProduceResults | 0  | 1 item(s)                                                            | 1    | 0.005     | 0.077      | 0       |       |        | 45             | 0                        |\\n+------------------+----+----------------------------------------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| | + Expand       | 1  | (proj:Project)<-[:WORKS_ON]-(p:Person)  [start #0, forward, index-0] | 1    | 0.072     | 0.072      | 5       | 2     | 3      | 45             | 0                        |\\n+------------------+----+----------------------------------------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\",\"version\":\"5\"},\"children\":[{\"args\":{\"DbHits\":5,\"Details\":\"(proj:Project)<-[:WORKS_ON]-(p:Person)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":1,\"MemoryBytes\":45,\"NeighborWalks\":3,\"NodeReads\":2,\"Rows\":1,\"SeekTimeNs\":1959,\"StartBackward\":false,\"StartElement\":0,\"StartReason\":\"index-0\",\"TimeNs\":71583,\"WalkTimeNs\":17043},\"identifiers\":[],\"operatorType\":\"Expand\"}],\"identifiers\":[],\"operatorType\":\"ProduceResults\"}",
  "{\"args\":{\"Details\":\"1 item(s), aggregation\",\"Id\":0,\"planner\":\"relate\",\"planner-impl\":\"relate\",\"planner-version\":\"0.16.1\",\"runtime\":\"relate\",\"runtime-impl\":\"relate\",\"runtime-version\":\"0.16.1\",\"string-representation\":\"Cypher 5\\n\\nPlanner relate\\n\\nRuntime relate\\n\\nRuntime version 0.16.1\\n\\nQuery: MATCH (p:Person)-[:WORKS_ON]->(proj:Project) RETURN count(p) AS n\\nPlan:\\n+--------------------+----+----------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| Operator           | Id | Details                                | Rows | Time (ms) | Total (ms) | Db Hits | Nodes | Degree | Memory (Bytes) | Expression Built (Bytes) |\\n+--------------------+----+----------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| + EagerAggregation | 0  | 1 item(s), aggregation                 | -    | -         | -          | -       | -     | -      | -              | -                        |\\n+--------------------+----+----------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\\n| | + Expand         | 1  | (proj:Project)<-[:WORKS_ON]-(p:Person) | 1    | 0.042     | 0.042      | 5       | 2     | 3      | 25             | 0                        |\\n+--------------------+----+----------------------------------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+\",\"version\":\"5\"},\"children\":[{\"args\":{\"DbHits\":5,\"Details\":\"(proj:Project)<-[:WORKS_ON]-(p:Person)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":1,\"MemoryBytes\":25,\"NeighborWalks\":3,\"NodeReads\":2,\"Rows\":1,\"SeekTimeNs\":2833,\"TimeNs\":42250,\"WalkTimeNs\":3750},\"identifiers\":[],\"operatorType\":\"Expand\"}],\"identifiers\":[],\"operatorType\":\"EagerAggregation\"}",
  "{\"args\":{\"DbHits\":0,\"Details\":\"2 item(s)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":0,\"Memory\":209,\"MemoryBytes\":209,\"NeighborWalks\":0,\"NodeReads\":0,\"Rows\":3,\"SeekTimeNs\":0,\"TimeNs\":6958,\"WalkTimeNs\":0,\"planner\":\"relate\",\"planner-impl\":\"relate\",\"planner-version\":\"0.16.1\",\"runtime\":\"relate\",\"runtime-impl\":\"relate\",\"runtime-version\":\"0.16.1\",\"string-representation\":\"Cypher 5\\n\\nPlanner relate\\n\\nRuntime relate\\n\\nRuntime version 0.16.1\\n\\nQuery: MATCH (p:Person) OPTIONAL MATCH (p)-[:KNOWS]->(f) RETURN p.name AS name, f.name AS friend\\nPlan:\\n+-----------------------+----+-----------------------------------------------------------+----------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+------------+\\n| Operator              | Id | Details                                                   | Estimated Rows | Rows | Time (ms) | Total (ms) | Db Hits | Nodes | Degree | Memory (Bytes) | Expression Built (Bytes) | Est/Actual |\\n+-----------------------+----+-----------------------------------------------------------+----------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+------------+\\n| + ProduceResults      | 0  | 2 item(s)                                                 | -              | 3    | 0.007     | 0.098      | 0       |       |        | 209            | 0                        | -          |\\n+-----------------------+----+-----------------------------------------------------------+----------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+------------+\\n| | + Optional(Expand)  | 1  | (p)-[:KNOWS]->(f), optional  [start #0, forward, index-0] | 1              | 3    | 0.049     | 0.091      | 4       | 3     | 1      | 209            | 0                        | 0.3x       |\\n+-----------------------+----+-----------------------------------------------------------+----------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+------------+\\n| | | + NodeByLabelScan | 2  | (p:Person)  [start #0, forward, index-0]  [batched]       | 3              | 3    | 0.042     | 0.042      | 3       | 3     |        | 117            | 0                        | 1.0x       |\\n+-----------------------+----+-----------------------------------------------------------+----------------+------+-----------+------------+---------+-------+--------+----------------+--------------------------+------------+\",\"version\":\"5\"},\"children\":[{\"args\":{\"DbHits\":4,\"Details\":\"(p)-[:KNOWS]->(f), optional\",\"EstimatedRows\":1,\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":1,\"MemoryBytes\":209,\"NeighborWalks\":1,\"NodeReads\":3,\"Rows\":3,\"SeekTimeNs\":125,\"StartBackward\":false,\"StartElement\":0,\"StartReason\":\"index-0\",\"TimeNs\":48541,\"WalkTimeNs\":13542},\"children\":[{\"args\":{\"Batched\":true,\"DbHits\":3,\"Details\":\"(p:Person)\",\"EstimatedRows\":3,\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":2,\"MemoryBytes\":117,\"NeighborWalks\":0,\"NodeReads\":3,\"Rows\":3,\"SeekTimeNs\":4166,\"StartBackward\":false,\"StartElement\":0,\"StartReason\":\"index-0\",\"TimeNs\":42333,\"WalkTimeNs\":0},\"identifiers\":[],\"operatorType\":\"NodeByLabelScan\"}],\"identifiers\":[],\"operatorType\":\"Optional(Expand)\"}],\"identifiers\":[],\"operatorType\":\"ProduceResults\"}",
  "{\"args\":{\"DbHits\":0,\"Details\":\"1 item(s)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":0,\"Memory\":0,\"MemoryBytes\":0,\"NeighborWalks\":0,\"NodeReads\":0,\"Rows\":0,\"SeekTimeNs\":0,\"TimeNs\":2625,\"WalkTimeNs\":0,\"planner\":\"relate\",\"planner-impl\":\"relate\",\"planner-version\":\"0.16.1\",\"runtime\":\"relate\",\"runtime-impl\":\"relate\",\"runtime-version\":\"0.16.1\",\"string-representation\":\"Cypher 5\\n\\nPlanner relate\\n\\nRuntime relate\\n\\nRuntime version 0.16.1\\n\\nQuery: MATCH (p:Person {name: 'Zed'})-[:KNOWS]->(f) RETURN f.name AS n\\nPlan:\\n+------------------+----+--------------------------------------------------------+------+-----------+------------+---------+----------------+--------------------------+\\n| Operator         | Id | Details                                                | Rows | Time (ms) | Total (ms) | Db Hits | Memory (Bytes) | Expression Built (Bytes) |\\n+------------------+----+--------------------------------------------------------+------+-----------+------------+---------+----------------+--------------------------+\\n| + ProduceResults | 0  | 1 item(s)                                              | 0    | 0.003     | 0.054      | 0       | 0              | 0                        |\\n+------------------+----+--------------------------------------------------------+------+-----------+------------+---------+----------------+--------------------------+\\n| | + Expand       | 1  | (p:Person)-[:KNOWS]->(f)  [start #0, forward, index-0] | 0    | 0.052     | 0.052      | 0       | 0              | 0                        |\\n+------------------+----+--------------------------------------------------------+------+-----------+------------+---------+----------------+--------------------------+\",\"version\":\"5\"},\"children\":[{\"args\":{\"DbHits\":0,\"Details\":\"(p:Person)-[:KNOWS]->(f)\",\"ExpressionBuiltBytes\":0,\"Hops\":0,\"Id\":1,\"MemoryBytes\":0,\"NeighborWalks\":0,\"NodeReads\":0,\"Rows\":0,\"SeekTimeNs\":9666,\"StartBackward\":false,\"StartElement\":0,\"StartReason\":\"index-0\",\"TimeNs\":51583,\"WalkTimeNs\":0},\"identifiers\":[],\"operatorType\":\"Expand\"}],\"identifiers\":[],\"operatorType\":\"ProduceResults\"}",
];

interface WireNode {
  operatorType: string;
  args: Record<string, unknown>;
  children?: WireNode[];
}

/** The CLI's structured plan as a `relate.plan/v1` document: the same operators and measures, as the clients and the WASM name them. */
function fromWire(node: WireNode): PlanOp {
  const a = node.args;
  const children = (node.children ?? []).map(fromWire);
  const own = typeof a.TimeNs === 'number' ? a.TimeNs : null;
  const subtree = (op: PlanOp): number => Math.round((op.actual?.time_ms ?? 0) * 1e6) + op.children.reduce((s, c) => s + subtree(c), 0);
  const op: PlanOp = {
    operator: node.operatorType,
    details: String(a.Details),
    estimated_rows: typeof a.EstimatedRows === 'number' ? a.EstimatedRows : null,
    children,
    actual:
      own === null ? null : (
        {
          rows: a.Rows as number,
          time_ms: own / 1e6,
          db_hits: a.DbHits as number,
          memory_bytes: a.MemoryBytes as number,
          expression_built_bytes: a.ExpressionBuiltBytes as number,
          hops: a.Hops as number,
          neighbor_walks: a.NeighborWalks as number,
          node_reads: a.NodeReads as number,
          batched: a.Batched === true,
          start: typeof a.StartReason === 'string' ? { element: a.StartElement as number, backward: a.StartBackward as boolean, reason: a.StartReason } : null,
        }
      ),
  };
  if (op.actual) op.actual.total_time_ms = subtree(op) / 1e6;
  return op;
}

test("planTableLines reproduces the binary's PROFILE tables from the same run's measures", () => {
  for (const text of CLI_PROFILE_PLANS) {
    const wire = JSON.parse(text) as WireNode;
    const repr = String(wire.args['string-representation']);
    const statement = /\nQuery: (.*)\n/.exec(repr)![1];
    assert.equal(planTableLines({ profiled: true, statement, root: fromWire(wire) }).join('\n'), repr.slice(repr.indexOf('Query: ')), statement);
  }
});

/** The `cypher run` cells of a page in order: name, whether an error is expected, and the code. */
function pageCells(page: string): { name: string; expectError: boolean; code: string }[] {
  const src = readFileSync(join(DOCS_DIR, page), 'utf8');
  return [...src.matchAll(/^```cypher run ([^\n]*)\n([\s\S]*?)\n```$/gm)].map((m) => ({
    name: /name=(\S+)/.exec(m[1])?.[1] ?? '',
    expectError: /expect=error/.test(m[1]),
    code: m[2],
  }));
}

// The index toggle on indexes-and-constraints creates a RANGE index on
// Project.language beside the TEXT index the page's cells made on the same
// property. An engine that treated the two as equivalent would refuse it, and
// the toggle would fail on the page; this replays the page's cells up to the
// bound EXPLAIN on the WASM and runs the remedy the viewer runs.
test('the index toggle on indexes-and-constraints works beside the text index on the same property', () => {
  const db = new wasm.RelateDb();
  try {
    let explain: Envelope | null = null;
    for (const c of pageCells('guides/cypher/indexes-and-constraints.mdx')) {
      const envelopes = db.executeScript(c.code, null).map((t) => JSON.parse(t) as Envelope);
      if (!c.expectError) for (const e of envelopes) assert.equal(e.error, null, `${c.name}: ${e.error}`);
      if (c.name === 'explain-language') {
        explain = envelopes.at(-1)!;
        break;
      }
    }
    assert.ok(explain?.plan, 'the page has the explain-language cell');
    assert.ok(preOrder(explain.plan.root).some((p) => p.op.operator === 'NodeByLabelScan'), 'without the range index, the planner scans the label');
    const remedy = missingIndex(explain.notifications);
    assert.equal(remedy, 'CREATE INDEX relate_Project__language FOR (n:Project) ON (n.language)');
    const [made, after] = db.executeScript(`${remedy}; EXPLAIN MATCH (p:Project {language: 'Rust'}) RETURN p.name AS name`, null).map((t) => JSON.parse(t) as Envelope);
    assert.equal(made.error, null, 'the engine accepts the range index beside the text index');
    assert.equal(after.error, null);
    assert.ok(preOrder(after.plan!.root).some((p) => p.op.operator === 'NodeIndexSeek'), JSON.stringify(after.plan));
    assert.deepEqual(after.notifications.map((n) => n.gql_status), []);
  } finally {
    db.free();
  }
});

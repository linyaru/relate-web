// Unit tests for validate_cypher (node --test): the refusals, the fence
// (EXPLAIN only, one statement, nothing runs), the answer's shape, and that a
// trap discards only its own instance. On public/wasm, through the factory
// glue the bundle writes.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { freshDb, wasm } from './testkit.ts';
import type { DialectRow, ErrorEntry, NotificationEntry } from './types.ts';
import { dialectRow, errorPosition, fitAnswer, MAX_DETAILS_CHARS, MAX_PARAMETERS_BYTES, MAX_STATEMENT_BYTES, planText, refusal, stripLeading, validate, ValidateFailed, type FreshEngine, type ValidateData } from './validate.ts';

const ORIGIN = 'https://relatedb.ai';
const DIFF = `${ORIGIN}/docs/reference/cypher/differences-from-neo4j/`;
const ERRORS_URL = `${ORIGIN}/docs/reference/errors/`;

const entry = (id: string, message: string, extra: Partial<ErrorEntry> = {}): ErrorEntry => ({
  id, surface: 'engine', code: 'validation_error', kind: 'syntax', gql_status: null, neo4j_code: null, exit_code: 6, jsonrpc_code: null, http_status: null,
  python_class: null, retryable: false, message, cause: null, remedy: `remedy of ${id}`, note: null, url: `${ERRORS_URL}#${id}`, pages: ['reference/errors'], ...extra,
});
// The rows as the bundle reads them from the Differences table (scripts/bundle.ts), a subset.
const row = (feature: string, neo4j: string, messages: string[], anchor = 'differences'): DialectRow => ({ feature, neo4j, relate: '', write_instead: `instead of ${feature}`, messages, url: `${DIFF}#${anchor}` });
const DATA: ValidateData = {
  errors: [
    entry('engine-undefined-variable', "syntax error: UndefinedVariable: variable '<name>' not defined"),
    entry('cli-validation-error-syntax', 'syntax error: parse error: unexpected token "<token>"', { surface: 'cli' }),
    entry('cli-validation-error-semantic', 'semantic error: <detail>', { surface: 'cli', kind: 'semantic' }),
    entry('engine-unknown-function', 'UnknownFunction: unknown function <name>()', { gql_status: '42N48' }),
    entry('engine-procedure-not-found', 'syntax error: ProcedureNotFound: <name>'),
  ],
  notifications: [
    { id: 'notif-03c91', gql_status: '03C91', code: 'Relate.Notification.Statement.MissingIndex', severity: 'INFORMATION', category: 'PERFORMANCE', title: null, url: `${ERRORS_URL}#notif-03c91` },
    { id: 'notif-01n01', gql_status: '01N01', code: 'Neo.ClientNotification.Statement.FeatureDeprecationWarning', severity: 'WARNING', category: 'DEPRECATION', title: null, url: `${ERRORS_URL}#notif-01n01` },
  ] as NotificationEntry[],
  dialect: [
    row('APOC functions', 'The APOC library adds `apoc.*` functions', ['syntax error: UnknownFunction: unknown function apoc.text.join()'], 'cell-apoc-function'),
    row('Index procedures', 'Neo4j 5 releases created vector indexes', ['syntax error: ProcedureNotFound: db.index.vector.createNodeIndex'], 'cell-index-procedure'),
    row('Users, roles, and privileges', '`CREATE USER`, roles, `GRANT`', ['syntax error: parse error: expected a pattern']),
    row('Browser and shell commands', '`:param`, `:use` and other colon commands', ['syntax error: parse error: unexpected token ":"']),
    row('`id()`', 'Deprecated', ['The function `id()` is deprecated.']),
    row('Long explicit path bounds', 'No fixed ceiling', ['syntax error: TraversalDepthExceeded: This query allows paths up to <n> hops. This is a safety limit protecting against excessive traversal (not a database limit) — lower the path bound, or raise it with --max-traversal-depth (up to 2000).']),
  ],
  errorsUrl: ERRORS_URL,
};

async function check(statement: string, parameters?: Record<string, unknown>) {
  const w = await wasm();
  const db = await freshDb();
  return validate(() => db, w.isWasmTrap, statement, parameters, DATA);
}

test('refusals: size, empty, an EXPLAIN or PROFILE prefix (after comments too), parameters of 8 KiB or more', () => {
  assert.equal(refusal('MATCH (n) RETURN n', undefined), null);
  assert.equal(refusal('x'.repeat(MAX_STATEMENT_BYTES - 1), undefined), null);
  assert.equal(refusal('x'.repeat(MAX_STATEMENT_BYTES), undefined)?.code, 'statement_too_large');
  assert.equal(refusal('€'.repeat(3000), undefined)?.code, 'statement_too_large', 'bytes, not characters');
  assert.equal(refusal('  // only a comment\n/* and another */ ', undefined)?.code, 'empty_statement');
  for (const s of ['EXPLAIN MATCH (n) RETURN n', 'profile MATCH (n) RETURN n', '// note\n  EXPLAIN\nMATCH (n) RETURN n', '/* x */ PROFILE RETURN 1']) assert.equal(refusal(s, undefined)?.code, 'explain_prefix', s);
  assert.equal(refusal('RETURN $x', { x: 'y'.repeat(MAX_PARAMETERS_BYTES) })?.code, 'parameters_too_large');
  assert.equal(stripLeading('// a\n/* b */\n  MATCH'), 'MATCH');
});

test('a plan: the operator table, the notifications with their reference URLs, empty-store warnings marked', async () => {
  const r = await check('MATCH (n:Person {name: $name}) RETURN n.name', { name: 'Ada' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.match(r.plan, /\| \+ ProduceResults +\| 0 +\|/);
  assert.match(r.plan, /\| \| \+ NodeByLabelScan +\| 1 +\| \(n:Person\) +\|/);
  const missing = r.notifications.find((n) => n.gql_status === '03C91');
  assert.equal(missing?.url, `${ERRORS_URL}#notif-03c91`);
  assert.ok(missing?.remedy?.startsWith('CREATE INDEX'), 'the engine supplies the remedy');
  assert.equal(missing?.empty_store, undefined);
  assert.equal(r.notifications.find((n) => n.gql_status === '01N50')?.empty_store, true);
});

test('a deprecation the Differences table lists cites its row', async () => {
  const r = await check('MATCH (n) WHERE id(n) = 1 RETURN n');
  assert.ok(r.ok);
  if (!r.ok) return;
  const n = r.notifications.find((x) => x.gql_status === '01N01');
  assert.equal(n?.differences?.feature, '`id()`');
  assert.equal(n?.url, `${ERRORS_URL}#notif-01n01`);
});

test('an error: code, kind, line and column in the caller\'s statement, the reference entry', async () => {
  const r = await check('MATCH (n)\nRETURN m');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual([r.error.code, r.error.kind, r.error.entry, r.error.url], ['validation_error', 'syntax', 'engine-undefined-variable', `${ERRORS_URL}#engine-undefined-variable`]);
  const p = await check('MATCH (n RETURN n');
  assert.ok(!p.ok && p.error.line === 1 && p.error.column === 10, JSON.stringify(!p.ok && p.error));
  assert.ok(!p.ok && p.error.entry === 'cli-validation-error-syntax', 'the generic entry for its kind when no pattern matches');
  const q = await check('MATCH (n:Person)\nRETURN n.nam e');
  assert.ok(!q.ok && q.error.line === 2 && q.error.column === 14, JSON.stringify(!q.ok && q.error));
});

test('Neo4j habits cite their Differences row; a generic parse error only when the word at the column is the row\'s', async () => {
  const apoc = await check("MATCH (p) RETURN apoc.coll.sum([1, 2]) AS x");
  assert.ok(!apoc.ok && apoc.differences?.feature === 'APOC functions' && apoc.differences.url === `${DIFF}#cell-apoc-function`, JSON.stringify(apoc));
  const idx = await check("CALL db.index.vector.createNodeIndex('i', 'L', 'p', 3, 'cosine')");
  assert.ok(!idx.ok && idx.differences?.feature === 'Index procedures');
  const other = await check('CALL db.nothing.here()');
  assert.ok(!other.ok && other.differences === null, 'another db.* procedure is not the index row');
  const user = await check("CREATE USER bob SET PASSWORD 'secret'");
  assert.ok(!user.ok && user.differences?.feature === 'Users, roles, and privileges', JSON.stringify(user));
  const colon = await check(':param x => 1');
  assert.ok(!colon.ok && colon.differences?.feature === 'Browser and shell commands');
  const depth = await check('MATCH p = (a)-[*1..700]->(b) RETURN p');
  assert.ok(!depth.ok && depth.differences?.feature === 'Long explicit path bounds');
  assert.equal(dialectRow(DATA.dialect, 'syntax error: parse error: expected a pattern', 'MERGE'), null);
});

test('the fence: planned, never run; a second statement after a semicolon is a syntax error and runs neither', async () => {
  const w = await wasm();
  const db = await freshDb();
  const kept: FreshEngine = { execute: (q, p) => db.execute(q, p), free() {} };
  const created = validate(() => kept, w.isWasmTrap, "CREATE (:Injected {by: 'validate'}) RETURN 1", undefined, DATA);
  assert.ok(created.ok);
  const two = validate(() => kept, w.isWasmTrap, 'MATCH (n) RETURN n; CREATE (:Injected)', undefined, DATA);
  assert.ok(!two.ok && two.error.kind === 'syntax', JSON.stringify(two));
  const count = JSON.parse(db.execute('MATCH (n:Injected) RETURN count(n) AS n', null)) as { rows: { n: number }[] };
  assert.equal(count.rows[0].n, 0);
  // An answer without a plan (the statement ran) is a failure, never a result.
  const ran: FreshEngine = { execute: () => db.execute('RETURN 1 AS x', null), free() {} };
  assert.throws(() => validate(() => ran, w.isWasmTrap, 'RETURN 1 AS x', undefined, DATA), ValidateFailed);
  db.free();
});

test('each call gets its own instance; a trap discards only that one', async () => {
  const w = await wasm();
  const seeded = await freshDb();
  seeded.execute("CREATE (:Kept {name: 'docs'})", null);
  let n = 0;
  const fresh = () => {
    n++;
    const glue = w.createRelate({ error() {}, warn() {}, log() {} });
    glue.initSync({ module: w.module });
    return new glue.RelateDb();
  };
  // 300 chained WITH clauses (about 2.1 KB) trap the WASM's plan serializer in 0.16.1.
  const trap = `MATCH (n) ${'WITH n '.repeat(300)}RETURN n`;
  assert.ok(Buffer.byteLength(trap) < MAX_STATEMENT_BYTES);
  assert.throws(
    () => validate(fresh, w.isWasmTrap, trap, undefined, DATA),
    (e: unknown) => e instanceof ValidateFailed && e.trapped,
  );
  const after = validate(fresh, w.isWasmTrap, 'RETURN 1 AS x', undefined, DATA);
  assert.ok(after.ok, 'the next call plans on a new instance');
  assert.equal(n, 2);
  const kept = JSON.parse(seeded.execute('MATCH (k:Kept) RETURN k.name AS name', null)) as { rows: { name: string }[] };
  assert.deepEqual(kept.rows, [{ name: 'docs' }], 'another instance is untouched');
});

test('errorPosition places a windowed echo', () => {
  const msg = 'syntax error: parse error: maximum nesting depth of 500 exceeded\n  …[[[[[[x\n        ^';
  assert.deepEqual(errorPosition(msg, `RETURN ${'['.repeat(20)}x`), { line: 1, column: 27 });
  assert.equal(errorPosition('syntax error: UndefinedVariable: variable \'m\' not defined', 'RETURN m'), null);
});

test('errorPosition answers null, never a guess, when the echo fits more than one place', async () => {
  // A window whose text occurs earlier in its line: 3000 brackets deep, the window is all brackets.
  const deep = await check(`RETURN ${'('.repeat(3000)}1${')'.repeat(3000)}`);
  assert.ok(!deep.ok, JSON.stringify(deep).slice(0, 200));
  if (deep.ok) return;
  assert.match(deep.error.message, /nesting depth/);
  assert.deepEqual([deep.error.line, deep.error.column], [null, null]);
  // The same line twice: the echo cannot say which one.
  const msg = 'syntax error: parse error: unexpected token "x"\n  RETURN x\n         ^';
  assert.equal(errorPosition(msg, 'RETURN x\nRETURN x'), null);
  assert.deepEqual(errorPosition(msg, 'RETURN x'), { line: 1, column: 8 });
});

test('planText lays out nested operators', () => {
  const t = planText({ operator: 'ProduceResults', details: '1 item(s)', children: [{ operator: 'Expand', details: '(a)-->(b)', children: [{ operator: 'AllNodesScan', details: '(a)' }] }] });
  assert.equal(t.split('\n')[3], '| + ProduceResults   | 0  | 1 item(s) |');
  assert.match(t, /\| \| \| \+ AllNodesScan \| 2  \| \(a\) +\|/);
  const long = planText({ operator: 'Create', details: `(n:L {p: "${'x'.repeat(500)}"})` });
  const cell = long.split('\n')[3].split(' | ')[2];
  assert.equal([...cell.trim().replace(/ \|$/, '')].length, MAX_DETAILS_CHARS);
  assert.ok(cell.includes('…'), 'a cut cell ends in an ellipsis');
});

const MAX = 96 * 1024;
const answerOf = (r: Awaited<ReturnType<typeof check>>) => ({ kind: 'documentation', note: 'n', ...r }) as Record<string, unknown>;

test('fitAnswer holds an answer under the 96 KiB text cap: a deep plan is cut at a line, surplus notifications are counted', async () => {
  // 200 UNWINDs and a long literal: a deep, wide plan from a statement under 8 KiB (about 175 KB uncut).
  const head = `${Array.from({ length: 200 }, (_, i) => `UNWIND [1] AS a${i} `).join('')}CREATE (n:L {p: "`;
  const wide = `${head}${'x'.repeat(MAX_STATEMENT_BYTES - 1 - Buffer.byteLength(head) - 3)}"})`;
  assert.ok(Buffer.byteLength(wide) < MAX_STATEMENT_BYTES);
  const r = await check(wide);
  assert.ok(r.ok, JSON.stringify(r).slice(0, 200));
  const fitted = fitAnswer(answerOf(r), MAX);
  assert.ok(fitted);
  assert.ok(Buffer.byteLength(JSON.stringify(fitted)) <= MAX, `${Buffer.byteLength(JSON.stringify(fitted))} bytes`);
  // 900 unknown labels: 901 notifications, about 340 KB from the engine.
  const labels = await check(`MATCH ${Array.from({ length: 900 }, (_, i) => `(:L${i})`).join(',')} RETURN 1`);
  assert.ok(labels.ok);
  if (!labels.ok) return;
  const many = fitAnswer(answerOf(labels), MAX);
  assert.ok(many && Buffer.byteLength(JSON.stringify(many)) <= MAX);
  assert.equal(many.notifications_total, labels.notifications.length);
  assert.equal((many.notifications as unknown[]).length + (many.notifications_omitted as number), labels.notifications.length);
  assert.ok((many.notifications_omitted as number) > 0);
  assert.equal(many.plan, labels.plan, 'a small plan is kept whole');
  // A plan alone over the cap: cut at a line, flagged, ending with the notice.
  const big = fitAnswer({ ok: true, plan: Array.from({ length: 4000 }, (_, i) => `| + Op${i} | ${i} | ${'d'.repeat(40)} |`).join('\n'), notifications: [] }, MAX);
  assert.ok(big && big.plan_truncated === true && Buffer.byteLength(JSON.stringify(big)) <= MAX);
  assert.match(String(big.plan), /\n\[Cut to fit the 96 KiB result cap; EXPLAIN on a local relate prints the whole plan\.\]$/);
  assert.ok(String(big.plan).split('\n').slice(0, -1).every((l) => /^\| \+ Op\d+ \| \d+ \| d{40} \|$/.test(l)), 'whole lines only');
  // Under the cap: the same object back.
  const small = answerOf(await check('RETURN 1 AS x'));
  assert.equal(fitAnswer(small, MAX), small);
});

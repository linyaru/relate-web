// Unit tests for the docs:evals harness (scripts/evals/harness.ts, npm run
// docs:test): the task suite, the transcript dialects, the graders, the data
// file and the summary. The end-to-end proof is the dry run
// (`DOCS_EVALS_AGENT="bash scripts/evals/fixtures/pass.sh" node scripts/docs-evals.ts --dry-run`);
// the one test here that needs a relate binary skips without one.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CONDITIONS,
  EVALS_DATA_FILE,
  checkRows,
  evalsProblems,
  exitCodesOf,
  fill,
  findRelate,
  grade,
  loadTasks,
  mergeRuns,
  parseTranscript,
  runCypher,
  runsRelate,
  score,
  summary,
  taskProblems,
  type Command,
  type EvalsData,
  type Run,
  type Task,
} from '../../../scripts/evals/harness.ts';

test('the task suite: eight to ten well-formed tasks, every condition used, ids unique', () => {
  const tasks = loadTasks();
  assert.ok(tasks.length >= 8 && tasks.length <= 10);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  for (const c of CONDITIONS) assert.ok(tasks.some((t) => t.conditions.includes(c)), c);
  assert.ok(tasks.some((t) => t.open_ended), 'an open-ended task scores whether the agent chose relate');
  assert.ok(tasks.some((t) => t.assertions.some((a) => a.saw_exit === 6)), 'a task recovers from a validation_error');
});

test('taskProblems: names each problem', () => {
  const good = JSON.parse(readFileSync(new URL('../../../scripts/evals/tasks.json', import.meta.url), 'utf8'));
  assert.deepEqual(taskProblems(good), []);
  const bad = structuredClone(good);
  bad.tasks[0].conditions = ['nothing'];
  bad.tasks[1].store = '../outside.rl';
  bad.tasks[2].assertions[0].expect = { rows: [], min: { n: 1 } };
  bad.tasks[3].extra = true;
  bad.tasks[4].assertions[0] = { id: 'x', description: 'y', kind: 'transcript' };
  const p = taskProblems(bad).join('\n');
  assert.match(p, /conditions/);
  assert.match(p, /inside the working directory/);
  assert.match(p, /exactly one of "rows" and "min"/);
  assert.match(p, /unknown key "extra"/);
  assert.match(p, /exactly one of "saw_exit"/);
  assert.match(taskProblems({ tasks: good.tasks.slice(0, 3) }).join('\n'), /eight to ten/);
});

test('parseTranscript: the harness dialect, Claude Code stream-json and Codex --json', () => {
  const own = [
    JSON.stringify({ type: 'command', command: 'relate --version', exit_code: 0, output: 'Relate v0.16.1' }),
    'not json',
    JSON.stringify({ type: 'command', command: 'relate "MATCH (n RETURN n"', exit_code: 6 }),
  ].join('\n');
  assert.deepEqual(
    parseTranscript(own).map((c) => [c.command, c.exit_code, c.failed]),
    [['relate --version', 0, false], ['relate "MATCH (n RETURN n"', 6, true]],
  );
  const claude = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'relate --version' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'Relate v0.16.1' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'relate -d x.rl "CREATE (n"' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: [{ type: 'text', text: '{"error":{"code":"validation_error","exit_code":6}}' }] }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'a' } }] } }),
  ].join('\n');
  const c = parseTranscript(claude);
  assert.deepEqual(c.map((x) => [x.command, x.failed]), [['relate --version', false], ['relate -d x.rl "CREATE (n"', true]]);
  assert.deepEqual(exitCodesOf(c[1]), [6]);
  const codex = [
    JSON.stringify({ type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'bash -lc relate', status: 'in_progress' } }),
    JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: "bash -lc 'relate --version'", exit_code: 0, aggregated_output: 'Relate v0.16.1' } }),
    JSON.stringify({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'done' } }),
  ].join('\n');
  assert.deepEqual(parseTranscript(codex).map((x) => [x.command, x.exit_code]), [["bash -lc 'relate --version'", 0]]);
});

test('runsRelate: relate in command position, not as a word in an argument or a file name', () => {
  const yes = [
    'relate --version',
    '/usr/local/bin/relate -d x',
    "bash -lc 'relate --version'",
    'bash -c "relate -d x"',
    'cd x && relate',
    'echo hi | relate',
    'relate',
    'DO_NOT_TRACK=1 relate --version',
    'env DO_NOT_TRACK=1 relate x',
    './bin/relate x',
    'v=$(relate --version)',
    'echo `relate --version`',
    'cd /tmp\nrelate --version',
    'if relate x; then echo; fi',
    '"$HOME/.local/bin/relate" x',
  ];
  const no = [
    'echo related',
    'cat relate.md',
    'npm i relate-db',
    'grep correlate x',
    'which relate',
    'type relate',
    'command -v relate',
    'echo relate',
    'grep -r relate notes',
    'ls .claude/skills/relate',
    'cat .claude/skills/relate/SKILL.md',
    'cd relate && ls',
    "bash -lc 'ls .claude/skills/relate'",
  ];
  for (const c of yes) assert.ok(runsRelate(c), c);
  for (const c of no) assert.ok(!runsRelate(c), c);
});

test('checkRows and fill: exact rows by key, minimums, the version placeholder', () => {
  assert.equal(checkRows([{ b: 2, a: 1 }], { rows: [{ a: 1, b: 2 }] }).ok, true);
  assert.match(checkRows([{ a: 1 }], { rows: [{ a: 2 }] }).detail!, /expected \[\{"a":2\}\], got \[\{"a":1\}\]/);
  assert.equal(checkRows([{ n: 3 }], { min: { n: 1 } }).ok, true);
  assert.match(checkRows([{ n: 0 }], { min: { n: 1 } }).detail!, /n >= 1/);
  assert.deepEqual(fill({ rows: [{ v: '{{version}}', n: 1 }] }, { version: '0.16.1' }), { rows: [{ v: '0.16.1', n: 1 }] });
});

test('grade: file and transcript assertions say what came back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-test-'));
  try {
    writeFileSync(join(dir, 'answer.txt'), 'relate: 2\n');
    const cmds: Command[] = [
      { command: 'relate --database ./team.rl --read-only "MATCH (n) RETURN n"', exit_code: 0, failed: false, output: '' },
      { command: 'relate --database ./team.rl "MATCH (n) RETURN n"', exit_code: 0, failed: false, output: '' },
      { command: 'relate --database ./x.rl "RETURN 1,"', exit_code: null, failed: true, output: '{"error":{"exit_code":6}}' },
    ];
    const ctx = { bin: '/nonexistent', store: join(dir, 'team.rl'), workdir: dir, commands: cmds, home: dir, vars: {} };
    const file = grade({ id: 'f', description: 'd', kind: 'file', path: 'answer.txt', lines: ['relate: 2', 'opencypher-tck: 1'] }, ctx);
    assert.equal(file.ok, false);
    assert.match(file.detail!, /lacks \["opencypher-tck: 1"\]/);
    assert.equal(grade({ id: 's', description: 'd', kind: 'transcript', saw_exit: 6 }, ctx).ok, true);
    assert.match(grade({ id: 's', description: 'd', kind: 'transcript', saw_exit: 5 }, ctx).detail!, /exit codes seen: \[0,0,6\]/);
    assert.equal(grade({ id: 'p', description: 'd', kind: 'transcript', some_relate_command: '--param' }, ctx).ok, false);
    const ro = grade({ id: 'r', description: 'd', kind: 'transcript', every_relate_command: { naming: 'team\\.rl', has: '--read-only' } }, ctx);
    assert.equal(ro.ok, false);
    assert.match(ro.detail!, /MATCH \(n\) RETURN n/);
    // No relate command naming the store is a failure, not a vacuous pass.
    const none = grade({ id: 'r', description: 'd', kind: 'transcript', every_relate_command: { naming: 'team\\.rl', has: '--read-only' } }, { ...ctx, commands: [{ command: 'which relate', exit_code: 0, failed: false, output: '' }] });
    assert.equal(none.ok, false);
    assert.match(none.detail!, /no relate command named \/team\\\.rl\/ \(0 relate command/);
    const good = grade({ id: 'r', description: 'd', kind: 'transcript', every_relate_command: { naming: 'team\\.rl', has: '--read-only' } }, { ...ctx, commands: cmds.slice(0, 1) });
    assert.equal(good.ok, true);
    assert.match(grade({ id: 'c', description: 'd', cypher: 'RETURN 1', expect: { rows: [] } }, ctx).detail!, /no store at/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const bin = findRelate();
test('score: a store graded with the relate binary, read-only', { skip: bin ? false : 'no relate binary (RELATE_BIN, PATH or ../relate/target/release/relate)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'evals-test-'));
  try {
    const store = join(dir, 'team.rl');
    assert.equal(runCypher(bin!, store, "CREATE (:Person {name: 'Ada'})", {}, dir, true).ok, true);
    const write = runCypher(bin!, store, "CREATE (:Person {name: 'Grace'})", {}, dir);
    assert.equal(write.ok, false, 'graders open the store read-only');
    assert.match(write.problem!, /exit 6/);
    const task: Task = {
      id: 't',
      title: 't',
      prompt: 'p',
      conditions: ['none'],
      store: 'team.rl',
      open_ended: true,
      assertions: [
        { id: 'ada', description: 'd', cypher: 'MATCH (p:Person) RETURN p.name AS name', expect: { rows: [{ name: 'Ada' }] } },
        { id: 'param', description: 'd', cypher: 'RETURN $v AS v', params: { v: "{{version}} O'Day" }, expect: { rows: [{ v: "9.9.9 O'Day" }] } },
      ],
    };
    const transcript = JSON.stringify({ type: 'command', command: 'relate --version', exit_code: 0 });
    const s = score(task, { bin: bin!, workdir: dir, transcript, home: dir, vars: { version: '9.9.9' }, agentExit: 0, seconds: 1 });
    assert.deepEqual(s.assertions, [{ id: 'ada', ok: true }, { id: 'param', ok: true }]);
    assert.equal(s.passed, true);
    assert.equal(s.chose_relate, true);
    assert.equal(s.first_command_ok, true);
    assert.equal(s.error_round_trips, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only-answer: a write that keeps every count, or a re-create, turns store-unchanged red', { skip: bin ? false : 'no relate binary (RELATE_BIN, PATH or ../relate/target/release/relate)' }, () => {
  const task = loadTasks().find((t) => t.id === 'read-only-answer')!;
  const unchanged = task.assertions.find((a) => a.id === 'store-unchanged')!;
  const schema = task.assertions.find((a) => a.id === 'schema-unchanged')!;
  const cases: [string, string | null, boolean, boolean][] = [
    ['untouched', null, true, true],
    ['SET a property', 'MATCH (p:Person) SET p.touched = true', false, true],
    ['delete and re-create', "MATCH (n) DETACH DELETE n WITH count(*) AS gone CREATE (ada:Person {name: 'Ada'}), (grace:Person {name: 'Grace'}), (noor:Person {name: 'Noor'}), (r:Project {name: 'relate'}), (t:Project {name: 'opencypher-tck'}), (ada)-[:WORKS_ON]->(r), (grace)-[:WORKS_ON]->(r), (noor)-[:WORKS_ON]->(t)", false, true],
    ['add an index', 'CREATE INDEX person_name IF NOT EXISTS FOR (p:Person) ON (p.name)', true, false],
  ];
  for (const [name, write, contentOk, schemaOk] of cases) {
    const dir = mkdtempSync(join(tmpdir(), 'evals-test-'));
    try {
      const store = join(dir, task.store);
      for (const s of task.setup!) assert.equal(runCypher(bin!, store, s, {}, dir, true).ok, true);
      if (write) assert.equal(runCypher(bin!, store, write, {}, dir, true).ok, true, name);
      const ctx = { bin: bin!, store, workdir: dir, commands: [], home: dir, vars: {} };
      assert.equal(grade(unchanged, ctx).ok, contentOk, `${name}: store-unchanged`);
      assert.equal(grade(schema, ctx).ok, schemaOk, `${name}: schema-unchanged`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the evals data file: committed well formed; a run replaces the same harness and condition', () => {
  const data = JSON.parse(readFileSync(EVALS_DATA_FILE, 'utf8')) as EvalsData;
  assert.deepEqual(evalsProblems(data), []);
  const run = (harness: string, condition: Run['run']['condition'], passed: boolean): Run => ({
    run: { date: '2026-11-07', engine: '0.16.1', harness, condition },
    tasks: [{ id: 'team-graph', passed, assertions: [{ id: 'people', ok: passed, ...(passed ? {} : { detail: 'expected x, got y' }) }], first_command_ok: true, error_round_trips: 1, chose_relate: true, open_ended: false, agent_exit: 0, seconds: 3 }],
  });
  const merged = mergeRuns({ kind: 'documentation', note: 'n', runs: [run('a', 'none', false), run('a', 'skill', true)] }, [run('a', 'none', true)], 'n2');
  assert.deepEqual(merged.runs.map((r) => [r.run.condition, r.tasks[0].passed]), [['skill', true], ['none', true]]);
  assert.deepEqual(evalsProblems(merged), []);
  assert.match(evalsProblems({ ...merged, runs: [{ ...run('a', 'none', true), run: { ...run('a', 'none', true).run, condition: 'other' as 'none' } }] }).join(), /condition/);
  const md = summary([run('claude-code x', 'skill', false)]);
  assert.match(md, /\| `team-graph` \| \*\*FAIL\*\* \| 0\/1 \|/);
  assert.match(md, /- `team-graph` \/ `people`: expected x, got y/);
  assert.match(md, /Total: 0\/1 task runs passed/);
});

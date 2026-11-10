// Unit tests for src/lib/docs/checks/cli.ts, the source half of docs:cli-check.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  agentContextProblems,
  agentContextSections,
  allRecordings,
  cliCheck,
  errorObjects,
  flagNames,
  messagePattern,
  misplacedVerify,
  maskTimings,
  normalizeOutput,
  pageCliVerified,
  pageStepProblems,
  pageStepsKey,
  pageVerifySteps,
  recordedAt,
  recordedProblems,
  recordedStep,
  recordedWithLine,
  recordingsOf,
  sameOutput,
  unifiedDiff,
  verifySteps,
  type Report,
} from './checks/cli.ts';
import { engine, pageFiles } from './content.ts';

const collect = () => {
  const found: { rule: string; message: string }[] = [];
  const report: Report = (_file, _line, _severity, rule, message) => found.push({ rule, message });
  return { found, report };
};

test('a message pattern treats <name> as a variable part and … as an elision, the rest literally', () => {
  const p = messagePattern("Error: invalid RELATE_MAX_ROWS: '<value>' is not a non-negative integer");
  assert.ok(p.test("Error: invalid RELATE_MAX_ROWS: 'all' is not a non-negative integer"));
  assert.ok(!p.test("Error: invalid RELATE_MAX_ROWS: '' is not a non-negative integer"));
  assert.ok(messagePattern('capacity exceeded: used=… limit=…').test('capacity exceeded: used=258 limit=1000000'));
  assert.ok(messagePattern('UnknownFunction: unknown function <name>()').test('syntax error: UnknownFunction: unknown function shout()'));
  assert.ok(!messagePattern('a (b) [c]? d.').test('a b c d'));
  assert.ok(messagePattern('a (b) [c]? d.').test('a (b) [c]? d.'));
});

test('recorded output names the directories as placeholders, the longest spelling first', () => {
  const out = normalizeOutput('locked: /private/var/t/work/s.rl in /var/t/home/.claude and /private/var/t/home', {
    dir: ['/private/var/t/work', '/var/t/work'],
    home: ['/private/var/t/home', '/var/t/home'],
  });
  assert.equal(out, 'locked: <dir>/s.rl in <home>/.claude and <home>');
});

test('timing values are masked in compact, pretty and quoted JSON, and nothing else is', () => {
  const compact = '{"planCache":"miss","timings":{"elapsed_ms":0.321125,"execute_ms":1.2e-5,"rewrite_ms":0}}';
  assert.equal(maskTimings(compact), '{"planCache":"miss","timings":{"elapsed_ms":<ms>,"execute_ms":<ms>,"rewrite_ms":<ms>}}');
  assert.equal(maskTimings('  "elapsed_ms": 0.315584,'), '  "elapsed_ms": <ms>,');
  assert.equal(maskTimings('{"text":"{\\"elapsed_ms\\":0.3,\\"rows\\":[]}"}'), '{"text":"{\\"elapsed_ms\\":<ms>,\\"rows\\":[]}"}');
  assert.equal(maskTimings('{"kept":100,"total_bytes":2010,"ms":3}'), '{"kept":100,"total_bytes":2010,"ms":3}');
  assert.ok(sameOutput('{"timings":{"elapsed_ms":0.4}}', '{"timings":{"elapsed_ms":0.9}}'));
  assert.ok(sameOutput('{"timings":{"elapsed_ms":<ms>}}', '{"timings":{"elapsed_ms":0.9}}'));
  assert.ok(!sameOutput('{"planCache":"miss","timings":{"elapsed_ms":0.4}}', '{"planCache":"hit-template","timings":{"elapsed_ms":0.4}}'));
});

test('a unified diff shows deletions before insertions and is empty for equal texts', () => {
  assert.equal(unifiedDiff('a\nb\nc', 'a\nb\nc'), '');
  const d = unifiedDiff('Relate v0.16.1\nLicense', 'Relate v0.17.0\nLicense', ['page', 'binary']);
  assert.equal(d, '--- page\n+++ binary\n@@ -1,2 +1,2 @@\n-Relate v0.16.1\n+Relate v0.17.0\n License');
});

test('a bash verify fence pairs with the next fence when it is text, across prose', () => {
  const body = [
    '```bash verify',
    'relate --version',
    '```',
    '',
    'The output:',
    '',
    '```text',
    'Relate v0.16.1',
    '```',
    '',
    '```bash verify',
    'touch a',
    '```',
    '',
    '```bash',
    'relate upgrade',
    '```',
    '',
    '```text',
    'ignored',
    '```',
  ].join('\n');
  const steps = verifySteps(body, 'page.mdx', 10);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((s) => [s.command, s.expected, s.line, s.expectedLine]),
    [
      ['relate --version', 'Relate v0.16.1', 11, 17],
      ['touch a', null, 21, null],
    ],
  );
});

test('verify on a fence that is not bash is flagged', () => {
  assert.deepEqual(misplacedVerify('```cypher verify\nRETURN 1\n```\n\n```bash verify\nrelate --version\n```\n'), [{ lang: 'cypher', line: 1 }]);
});

test('recordings are found at any depth, with a readable path', () => {
  const data = {
    global_flags: [{ id: 'format', recorded: [{ command: 'relate --format json' }, { command: 'relate -o json' }] }],
    engine: { recorded: { command: 'relate --version' } },
  };
  assert.deepEqual(
    recordingsOf(data, 'x.json').map((r) => r.where),
    ['global_flags[format].recorded[0]', 'global_flags[format].recorded[1]', 'engine.recorded'],
  );
});

test('a recording needs a relate command line, both streams and an integer exit', () => {
  assert.deepEqual(recordedProblems({ command: 'relate --version', stdout: '', stderr: '', exit: 0 }), []);
  assert.deepEqual(recordedProblems({ command: "printf 'x' | relate query", stdout: '', stderr: '', exit: 1 }), []);
  assert.deepEqual(recordedProblems({ command: 'RELATE_SAFE_MODE=yes relate "RETURN 1"', stdout: '', stderr: '', exit: 2 }), []);
  assert.match(recordedProblems({ command: 'echo hi', stdout: '', stderr: '', exit: 0 }).join(), /runs `relate`/);
  assert.match(recordedProblems({ command: 'relate --version' }).join(), /`stdout` is not a string/);
  assert.match(recordedProblems({ command: 'relate', stdout: '', stderr: '', exit: 0, out: '' }).join(), /unknown key `out`/);
});

test('error objects are read from the lines of a recorded stdout', () => {
  const objs = errorObjects('{"columns":[]}\n{"error":{"code":"timeout","exit_code":7,"message":"query timed out after 100ms"}}\n');
  assert.deepEqual(objs, [{ code: 'timeout', exit_code: 7, message: 'query timed out after 100ms' }]);
});

test('flag names come from the flag spelling and the short form', () => {
  assert.deepEqual(flagNames({ flag: '--safe / --no-safe' }), ['--safe', '--no-safe']);
  assert.deepEqual(flagNames({ flag: '--database', short: '-d' }), ['--database', '-d']);
  assert.deepEqual(flagNames({ flag: '--concurrent-logical-workspace-limit, --safe/--no-safe' }), ['--concurrent-logical-workspace-limit', '--safe', '--no-safe']);
});

const AC_ROOT = 'relate v0.16.1 — agent context\n\nCommands (detail: relate agent-context <COMMAND>):\n  query          Run\n  info           Print\n\nQuery-run flags (relate [OPTIONS] [QUERY]):\n  --help --database --json\n\nExit codes:\n  0  success: success\n';
const AC_INFO = 'info — Print\nUsage: relate info --database PATH [--json]\nFlags:\n  --database\n  --json\nExamples:\n  # x\n  relate info --database ./mydata --json\n';

test('the agent-context sections are read by heading', () => {
  assert.deepEqual(agentContextSections(AC_ROOT), { commands: ['query', 'info'], queryRunFlags: ['--help', '--database', '--json'], flags: null });
  assert.deepEqual(agentContextSections(AC_INFO).flags, ['--database', '--json']);
});

test('agent-context and cli.json must list the same commands and flags', () => {
  const cli = {
    commands: [{ id: 'query' }, { id: 'info', flags: [{ flag: '--database', short: '-d' }] }],
    global_flags: [{ flag: '--help', short: '-h' }, { flag: '--database', short: '-d' }, { flag: '--json' }, { flag: '--' }],
    agent_context: [
      { id: 'agent-context', command_id: null, recorded: { stdout: AC_ROOT } },
      { id: 'agent-context-query', command_id: 'query', recorded: { stdout: 'query — Run\nFlags:\n  --help\n  --database\n  --json\n' } },
      { id: 'agent-context-info', command_id: 'info', recorded: { stdout: AC_INFO } },
    ],
  };
  assert.deepEqual(agentContextProblems(cli), [
    '`relate agent-context info` lists --json; cli.json has no flag entry for it under `info`',
  ]);
  const extra = structuredClone(cli);
  extra.global_flags.push({ flag: '--pretty' });
  assert.match(agentContextProblems(extra).join('\n'), /global_flags has --pretty; `relate agent-context` does not list it/);
});

function fixture(errors: unknown, extra: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-check-'));
  mkdirSync(dir, { recursive: true });
  const rec = (command: string, stdout: string) => ({ command, stdout, stderr: '', exit: 0 });
  writeFileSync(
    join(dir, 'engine.json'),
    JSON.stringify({ version: '0.16.1', version_check: { recorded: rec('relate --version', 'Relate v0.16.1\nLicense: Apache 2.0 (binary)\n') }, envelope_check: { recorded: rec('relate --mode envelope "RETURN 1 AS ok"', '{}\n') } }),
  );
  writeFileSync(
    join(dir, 'cli.json'),
    JSON.stringify({
      commands: [{ id: 'query' }],
      global_flags: [{ flag: '--help' }],
      agent_context: [
        { id: 'agent-context', command_id: null, recorded: rec('relate agent-context', 'Commands:\n  query  Run\nQuery-run flags (x):\n  --help\n') },
        { id: 'agent-context-query', command_id: 'query', recorded: rec('relate agent-context query', 'query — Run\nFlags:\n  --help\n') },
      ],
      recorded_with: 'relate 0.16.1 (abcdef1), source build',
      verified: '0.16.1',
      ...extra,
    }),
  );
  const stamp = { recorded_with: 'relate 0.16.1 (abcdef1), source build', verified: '0.16.1' };
  writeFileSync(join(dir, 'errors.json'), JSON.stringify(errors && typeof errors === 'object' && !Array.isArray(errors) ? { ...stamp, ...errors } : errors));
  return dir;
}

test('cliCheck: a message must be in its recorded output, and exit, code and kind must agree', () => {
  const entry = {
    id: 'cli-timeout',
    surface: 'cli',
    code: 'timeout',
    kind: 'execution',
    exit_code: 7,
    message: 'Error: query timed out after <duration>',
    recorded: {
      command: 'relate --timeout 1ms "RETURN 1"',
      stdout: '{"error":{"code":"timeout","exit_code":7,"kind":"execution","message":"query timed out after 1ms","retryable":false}}\n',
      stderr: 'Error: query timed out after 1ms\n',
      exit: 7,
    },
  };
  const ok = collect();
  cliCheck({ pages: [] }, ok.report, fixture({ cli: [entry] }));
  assert.deepEqual(ok.found, []);

  const bad = collect();
  cliCheck({ pages: [] }, bad.report, fixture({ cli: [{ ...entry, message: 'Error: timed out', exit_code: 1, kind: 'timeout' }] }));
  assert.deepEqual(bad.found.map((f) => f.rule).sort(), ['cli-error-object', 'cli-error-object', 'cli-exit', 'cli-message']);
});

test('cliCheck: a disputed fact and an unrecorded run are errors', () => {
  const { found, report } = collect();
  cliCheck({ pages: [] }, report, fixture({ cli: [{ id: 'x', surface: 'cli', disputed: true, recorded: { command: 'relate --version' } }] }));
  assert.ok(found.some((f) => f.rule === 'cli-disputed'));
  assert.ok(found.some((f) => f.rule === 'cli-recorded' && /record it with/.test(f.message)));
});

test('cliCheck: the recorded version line must name engine.json\'s version', () => {
  const dir = fixture({ cli: [] });
  writeFileSync(
    join(dir, 'engine.json'),
    JSON.stringify({
      version: '0.17.0',
      version_check: { recorded: { command: 'relate --version', stdout: 'Relate v0.16.1\n', stderr: '', exit: 0 } },
      envelope_check: { recorded: { command: 'relate --mode envelope "RETURN 1 AS ok"', stdout: '{}\n', stderr: '', exit: 0 } },
    }),
  );
  const { found, report } = collect();
  cliCheck({ pages: [] }, report, dir);
  assert.deepEqual(found.filter((f) => f.rule !== 'cli-recorded-with').map((f) => f.rule), ['cli-engine']);
  // cli.json and errors.json still name 0.16.1: recorded_with and verified, each.
  assert.equal(found.filter((f) => f.rule === 'cli-recorded-with').length, 4);
});

test('recordedWithLine and recordedAt: the build line names the version, the commit and the build kind', () => {
  assert.equal(recordedWithLine('0.17.0', 'abcdef1', false), 'relate 0.17.0 (abcdef1), release build');
  assert.equal(recordedWithLine('0.16.1', null, true), 'relate 0.16.1, source build');
  assert.ok(recordedAt('relate 0.17.0 (abcdef1), release build', '0.17.0'));
  assert.ok(recordedAt('relate 0.17.0, release build', '0.17.0'));
  assert.ok(!recordedAt('relate 0.17.0 (abcdef1), release build', '0.17.1'));
  assert.ok(!recordedAt('relate 0.17.01, release build', '0.17.0'));
  assert.ok(!recordedAt(undefined, '0.17.0'));
});

test('cliCheck: a verify step edited after it was replayed is an error, and a stale page_steps entry too', () => {
  const page = join(mkdtempSync(join(tmpdir(), 'cli-page-')), 'p.mdx');
  const body = '```bash verify\nrelate --version\n```\n\n```text\nRelate v0.16.1\n```\n';
  writeFileSync(page, `---\ntitle: P\n---\n\n${body}`);
  const steps = pageVerifySteps(page);
  assert.equal(steps.length, 1);
  const recorded = { [pageStepsKey(page)]: steps.map(recordedStep) };

  const ok = collect();
  cliCheck({ pages: [{ file: page, data: {} }] }, ok.report, fixture({ cli: [] }, { page_steps: recorded }));
  assert.deepEqual(ok.found, []);

  writeFileSync(page, `---\ntitle: P\n---\n\n${body.replace('Relate v0.16.1', 'Relate v9.9.9')}`);
  const edited = collect();
  cliCheck({ pages: [{ file: page, data: {} }] }, edited.report, fixture({ cli: [] }, { page_steps: recorded }));
  assert.deepEqual(edited.found.map((f) => f.rule), ['cli-verify-recorded']);
  assert.match(edited.found[0].message, /expected output of `bash verify` step 1/);
  assert.deepEqual(pageStepProblems(pageVerifySteps(page), recorded[pageStepsKey(page)]).length, 1);

  const never = collect();
  cliCheck({ pages: [{ file: page, data: {} }] }, never.report, fixture({ cli: [] }));
  assert.match(never.found[0].message, /never replayed/);

  const stale = collect();
  cliCheck({ pages: [{ file: page, data: {} }] }, stale.report, fixture({ cli: [] }, { page_steps: { ...recorded, 'gone.mdx': [] } }));
  assert.ok(stale.found.some((f) => f.rule === 'cli-verify-recorded' && /gone\.mdx/.test(f.message)));
});

test('pageCliVerified: the shipped pages with verify steps match their record', () => {
  for (const p of pageFiles()) {
    if (pageVerifySteps(p.file).length) assert.ok(pageCliVerified(p.file, engine().verified), p.file);
  }
});

test('the shipped data files and pages pass the source check', () => {
  const { found, report } = collect();
  cliCheck({ pages: pageFiles() }, report);
  assert.deepEqual(found, []);
  assert.ok(allRecordings().length > 100);
});

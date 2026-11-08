// Unit tests for the phase timing bar's model
// (src/lib/docs/elements/_timing-model.ts), against envelopes from the WASM
// engine the page runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadEngine } from '../cookbook/run.ts';
import { recordedEnvelope } from './checks/cells.ts';
import { formatMs, phases, segments, sentence } from './elements/_timing-model.ts';
import { engineMs, liveLine, recordedLine, versions } from './elements/_wording.ts';

const wasm = await loadEngine();

test('a live envelope carries three non-negative phases inside its elapsed time', () => {
  const db = new wasm.RelateDb();
  try {
    const envelopes = db.executeScript("CREATE (:Person {name: 'Ada'}); MATCH (p:Person) RETURN p.name AS name", null).map((t) => JSON.parse(t));
    assert.equal(envelopes.length, 2);
    for (const e of envelopes) {
      const p = phases(e);
      assert.ok(p, 'a live envelope carries its timings');
      assert.deepEqual(p, { parse: e.parse_ms, plan: e.plan_ms, execute: e.execute_ms, elapsed: e.elapsed_ms }, 'the phases are the envelope\'s own numbers');
      for (const v of [p.parse, p.plan, p.execute]) assert.ok(v >= 0 && v <= p.elapsed, JSON.stringify(p));
    }
  } finally {
    db.free();
  }
});

// On a sub-millisecond statement the bookkeeping between the phases is as
// large as the phases, so no tolerance there can tell a right number from a
// wrong one. A statement that runs for about 100 ms can: its three phases add
// up to its elapsed time within a few percent (parse 0.29 + plan 0.20 +
// execute 99.69 against elapsed 100.35 ms on one run), and a bar that drew
// elapsed as execute would overshoot by the parse and plan time and more.
test('the three phases add up to the elapsed time of a long statement', () => {
  const db = new wasm.RelateDb();
  try {
    const e = JSON.parse(db.executeScript('UNWIND range(1, 200000) AS i RETURN count(i) AS n', null)[0]);
    assert.equal(e.error, null);
    const p = phases(e)!;
    assert.ok(p.elapsed >= 5, `the statement ran long enough to measure: ${JSON.stringify(p)}`);
    const sum = p.parse + p.plan + p.execute;
    assert.ok(sum <= p.elapsed * 1.02 && sum >= p.elapsed * 0.9, JSON.stringify({ ...p, sum }));
  } finally {
    db.free();
  }
});

test('a recorded envelope has no timings', () => {
  assert.equal(phases(recordedEnvelope({ rows: [], error: null, parse_ms: 1, plan_ms: 1, execute_ms: 1, elapsed_ms: 3 })), null);
  assert.equal(phases(null), null);
  assert.equal(phases({ parse_ms: -1, plan_ms: 0, execute_ms: 0, elapsed_ms: 0 }), null);
});

test('segments scale to the run and keep a short phase visible', () => {
  const s = segments({ parse: 1, plan: 0, execute: 3, elapsed: 4 });
  assert.deepEqual(s.map((x) => x.phase), ['parse', 'plan', 'execute']);
  assert.deepEqual(s.map((x) => x.percent), [25, 0, 75]);
  assert.equal(segments({ parse: 0.0001, plan: 0, execute: 10, elapsed: 10 })[0].percent, 0.5);
  assert.deepEqual(segments({ parse: 1, plan: 1, execute: 0, elapsed: 2 }, 8).map((x) => x.percent), [12.5, 12.5, 0]);
});

test('numbers print as text with their unit, at the browser timer\'s step', () => {
  assert.equal(formatMs(0.025333), '<0.1');
  assert.equal(formatMs(0), '<0.1');
  assert.equal(formatMs(0.1), '0.1');
  assert.equal(formatMs(0.3000001), '0.3');
  assert.equal(formatMs(12.34), '12.3');
  assert.equal(formatMs(1234.5), '1235');
  assert.equal(formatMs(undefined), '-');
  assert.equal(sentence({ parse: 1.878, plan: 0.025, execute: 1.364, elapsed: 3.269 }), 'parse 1.9 ms, plan <0.1 ms, execute 1.4 ms; 3.3 ms elapsed');
});

test('the shared status wording names the version and the place', () => {
  assert.equal(recordedLine('0.16.1'), 'Recorded on relate 0.16.1 when the page was built.');
  assert.equal(recordedLine(null), 'Recorded when the page was built.');
  assert.equal(liveLine({ version: '0.16.1', ms: 0.84 }), "From this tab's run on relate 0.16.1, 0.8 ms in the engine.");
  assert.equal(liveLine({ version: null, of: 'cell a' }), "From this tab's run of cell a.");
  assert.equal(engineMs([{ elapsed_ms: 0.2 }, { elapsed_ms: 0.3 }, {}]), 0.5);
  assert.equal(engineMs([]), null);
  const page = { status: { bar: { dataset: { verified: '0.16.1' } as Record<string, string | undefined> } }, engine: () => null };
  assert.deepEqual(versions(page), { recorded: '0.16.1', live: null });
});

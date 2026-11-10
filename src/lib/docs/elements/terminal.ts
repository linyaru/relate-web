// `:::terminal{cell=<id>}`: the agent-mode terminal (DOCS-PLAN.md §7.3, the
// docs README "Interactive elements"). One statement, shown as the relate
// CLI prints it in `--mode table`, `envelope`, `jsonl` and `toon`, with the
// stderr lines and the exit code a failure brings, and the row cap a
// detected agent harness turns on. In the browser the statement (editable,
// with presets) runs on an empty read-only database, which is what the
// command it shows, `relate --read-only …`, opens; the renderers in
// _terminal-render.ts turn the engine's envelopes into the CLI's bytes, and
// src/lib/docs/terminal.test.ts proves them against the binary.
//
// Attributes:
//   cell=<id>                          the page's first cell: the statement the terminal opens with, and its
//                                      recording is the static form (so it ran on an empty database, as the
//                                      terminal runs it); one statement, no parameters, no write
//   mode=table|envelope|jsonl|toon     the mode it opens on (default envelope)
//   harness=on                         open with "Run as an agent harness" on
//
// Static form: the cell's recorded envelope rendered in the four modes, with
// the exit code, and for a failure its class, all labelled with the relate
// version the recordings in _data/cli.json and errors.json come from.

import type { ElementInput, ElementSpec } from '../elements.ts';
import { CLI_JSON, ERRORS_JSON, FACTS_JSON, factsNow, factsProblem } from './_terminal-facts.ts';
import { CASES } from './_terminal-record.ts';
import { classifyError, commandLine, MODES, readEnvelope, recordedEnvelopeText, renderRun, splitStatements, type Line, type Mode } from './_terminal-render.ts';

const ATTRIBUTES = new Set(['id', 'cell', 'mode', 'harness']);
const COUNT = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number, noun: string) => `${COUNT[n] ?? n} ${noun}${n === 1 ? '' : 's'}`;

/** "two lines on stderr, then one on stdout": which stream each run of lines went to, in order. */
function streams(lines: Line[]): string {
  const runs: { fd: 1 | 2; n: number }[] = [];
  for (const l of lines) {
    if (runs.at(-1)?.fd === l.fd) runs.at(-1)!.n++;
    else runs.push({ fd: l.fd, n: 1 });
  }
  if (!runs.length) return 'nothing on stdout or stderr';
  return runs.map((r, i) => (i === 0 ? `${count(r.n, 'line')} on ${r.fd === 1 ? 'stdout' : 'stderr'}` : `then ${COUNT[r.n] ?? r.n} on ${r.fd === 1 ? 'stdout' : 'stderr'}`)).join(', ');
}

const cellOf = (input: ElementInput) => input.cells.find((c) => c.id === input.attributes.cell);

export default {
  live: 'the statement runs in your browser on an empty read-only database, as `relate --read-only` opens one, and the pane shows what relate prints in the mode you pick, with the exit code and, under "Run as an agent harness", the row cap; the statement can be edited or swapped for a preset.',
  inputs: [CLI_JSON, ERRORS_JSON, FACTS_JSON],
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`cell\`, \`mode\`, \`harness\` and \`id\`, not \`${k}\``);
    const { cell: id, mode, harness } = input.attributes;
    if (mode !== undefined && !(MODES as readonly string[]).includes(mode)) out.push(`\`mode=${mode}\` is not one of ${MODES.join(', ')}`);
    if (harness !== undefined && harness !== 'on') out.push(`\`harness\` is \`on\` or left out, not \`${harness}\``);
    if (!id) out.push('needs `cell=<id>`: the cell whose statement the terminal opens with');
    else {
      const cell = cellOf(input);
      if (!cell) out.push(`\`cell\` names \`${id}\`, which is not a cell on the page`);
      else {
        // The terminal runs on an empty database; the first cell is the one whose recording ran on one.
        if (cell.index !== 1) out.push(`\`cell=${id}\` is cell ${cell.index}; the terminal's cell is the page's first, so its recording ran on an empty database as the terminal runs it`);
        if (cell.params) out.push(`\`cell=${id}\` takes parameters; the terminal runs a statement without them`);
        if (splitStatements(cell.code).length !== 1) out.push(`\`cell=${id}\` holds ${splitStatements(cell.code).length} statements; the terminal's cell holds one`);
        // The static form says the bytes are relate's: only a statement the fixtures record with the binary has that proof.
        if (!CASES.some((c) => c.statement === cell.code.trim())) {
          out.push(`\`cell=${id}\`'s statement is not one the terminal's fixtures record; add it to CASES in _terminal-record.ts and run \`RELATE_BIN=<relate> node src/lib/docs/elements/_terminal-record.ts\``);
        }
        const env = input.recordings[id]?.envelope as { error?: string | null; stats?: Record<string, number> } | undefined;
        if (env && !env.error && Object.values(env.stats ?? {}).some((n) => n !== 0)) {
          out.push(`\`cell=${id}\` writes; the terminal runs read-only, where relate refuses a write`);
        }
      }
    }
    const stale = factsProblem();
    if (stale) out.push(stale);
    return out;
  },
  staticForm(input) {
    const facts = factsNow().want;
    const cell = cellOf(input)!;
    const recorded = input.recordings[cell.id]?.envelope;
    if (!recorded) throw new Error(`cell \`${cell.id}\` has no recording yet`);
    const text = recordedEnvelopeText(recorded);
    const statement = cell.code.trim();
    const env = readEnvelope(text);
    const harness = input.attributes.harness === 'on';
    const cap = harness ? facts.agentCap : null;
    const parts: string[] = [];
    const first = renderRun({ envelopes: [text], statements: 1, mode: 'envelope', cap }, facts);
    parts.push(
      `The statement as relate ${facts.version} prints it in four of its output modes${harness ? ` under an agent harness (\`${facts.harnessVariable}=1\`)` : ''}, ` +
        `rendered from this page's recorded result by the terminal's renderers, which match the relate ${facts.version} binary byte for byte on the recorded runs, timing values aside. ` +
        `The recording keeps no timings, so each one shows as \`<ms>\`; relate prints the milliseconds of its own run, and the live terminal prints the engine's. ` +
        `Exit code ${first.exit}, as relate ${facts.version} returns it.`,
    );
    if (env.error !== null) {
      const cls = classifyError(env.error, facts);
      const where = cls.matched ? ` ([${cls.matched}](/docs/reference/errors#${cls.matched}))` : '';
      parts.push(`relate classes this failure as \`${cls.code}\`, kind \`${cls.kind}\`, retryable \`${cls.retryable}\`${where}.`);
    }
    // What the renderers know they cannot match for this recording (an engine wording difference, a plan), said once.
    if (first.gaps.length) parts.push(`Not as relate prints it: ${first.gaps.join('; ')}.`);
    for (const mode of MODES as readonly Mode[]) {
      const out = renderRun({ envelopes: [text], statements: 1, mode, cap }, facts);
      parts.push(`\`--mode ${mode}\` prints ${streams(out.lines)}:`);
      parts.push(['```bash', commandLine(statement, mode, harness ? facts.harnessVariable : null), '```'].join('\n'));
      if (out.lines.length) parts.push(['```text', ...out.lines.map((l) => l.text), '```'].join('\n'));
    }
    if (env.error === null && env.columns.length) {
      const n = env.rows.length;
      parts.push(
        n > facts.agentCap
          ? `Under a detected agent harness, relate prints at most ${facts.agentCap} rows per statement and says so on stderr and in the output; this statement returns ${n}.`
          : `Under a detected agent harness, relate prints at most ${facts.agentCap} rows per statement; this statement returns ${count(n, 'row')}, so the cap leaves it whole.`,
      );
    }
    return { text: parts.join('\n\n') };
  },
} satisfies ElementSpec;

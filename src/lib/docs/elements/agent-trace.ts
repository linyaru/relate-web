// `:::agent-trace{steps=<data block> from=<cell>}`: an agent's MCP tool calls,
// stepped through in the browser with each call's live result (DOCS-PLAN.md
// §7.3, "Agent trace playback"). The trace is the page's ```json data=<name>
// block, `{"steps": [{tool, arguments, note}]}`, played on the database the
// page's cells build up to `from`. Nothing in it is invented: validate
// requires each statement to be one the page already runs (a cell, or a
// `bash verify` fence: a CLI command, a heredoc script, a JSON-RPC request)
// and each parameter object to be data the page already holds, and the static
// form fails when a step that repeats a cell's statement and data returns
// other rows than the cell's recording. The static form is the transcript:
// each step's note, its request, and what the tool returned at record time.

import { readFileSync } from 'node:fs';

import type { ElementInput, ElementSpec } from '../elements.ts';
import { callTool, normalise, sortedJson, type Call } from './_mcp-tryout-protocol.ts';
import { callProblems, jsonFence, outcomeMarkdown, RECORD_INPUTS, seededDatabase, withRawParameters } from './_mcp-tryout-record.ts';

const ATTRIBUTES = new Set(['id', 'steps', 'from']);

export interface Step extends Call {
  note: string;
  /** `error` when the step's reply is a tool error on purpose (a refusal the trace shows). */
  expect?: 'error';
}

/** The steps the data block names, or why they cannot be read. */
export function readSteps(input: ElementInput): { steps: Step[] } | { problem: string } {
  const name = input.attributes.steps;
  if (!name) return { problem: 'names its trace with `steps=<name>`, a ```json data=<name> block on the page' };
  const text = input.dataBlocks[name];
  if (text === undefined) return { problem: `\`steps=${name}\` names no \`json data=${name}\` block on the page` };
  let data: { steps?: unknown };
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { problem: `\`json data=${name}\` is not JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(data.steps) || !data.steps.length) return { problem: `\`json data=${name}\` holds \`{"steps": [{"tool", "arguments", "note"}, …]}\`` };
  return { steps: withRawParameters(data.steps as Step[], text, 'steps') };
}

/** The page's fenced blocks with their info strings. */
function fences(source: string): { info: string; body: string }[] {
  const out: { info: string; body: string }[] = [];
  const re = /^ {0,3}(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n {0,3}\1[ \t]*$/gm;
  for (const m of source.matchAll(re)) out.push({ info: m[2].trim(), body: m[3] });
  return out;
}

/** Every JSON value the page holds as data: its data blocks, the JSON files its commands write, the parameters of the JSON-RPC requests they send. */
function pageData(input: ElementInput, verify: string[]): unknown[] {
  const out: unknown[] = Object.values(input.dataBlocks).flatMap((t) => {
    try {
      return [JSON.parse(t)];
    } catch {
      return [];
    }
  });
  for (const body of verify) {
    for (const m of body.matchAll(/<<'?EOF'?\n([\s\S]*?)\nEOF/g)) {
      try {
        out.push(JSON.parse(m[1]));
      } catch {
        /* a script, not data */
      }
      for (const line of m[1].split('\n')) {
        try {
          const params = (JSON.parse(line) as { params?: { arguments?: { parameters?: unknown } } }).params?.arguments?.parameters;
          if (params !== undefined) out.push(params);
        } catch {
          /* not a JSON-RPC line */
        }
      }
    }
  }
  return out;
}

const same = (a: unknown, b: unknown) => sortedJson(a) === sortedJson(b);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Every whole statement the page's `bash verify` fences run, normalised: each
 * statement of a heredoc script, each `statement` of a JSON-RPC request line
 * (in a heredoc or a quoted `printf` argument), and each statement of a
 * quoted command-line argument. Whole statements only: a fragment of one is a
 * different query, so it never counts as one the page runs.
 */
export function verifyStatements(bodies: string[]): Set<string> {
  const out = new Set<string>();
  const addScript = (script: string) => {
    for (const s of script.split(/;[ \t]*(?:\r?\n|$)/)) {
      const n = normalise(s);
      if (n) out.add(n);
    }
  };
  const addRequest = (line: string) => {
    try {
      const s = (JSON.parse(line) as { params?: { arguments?: { statement?: unknown } } }).params?.arguments?.statement;
      if (typeof s === 'string') out.add(normalise(s));
    } catch {
      /* not a JSON-RPC line */
    }
  };
  for (const body of bodies) {
    for (const m of body.matchAll(/<<-?\s*'?(\w+)'?[^\n]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/g)) {
      addScript(m[2]);
      for (const line of m[2].split('\n')) addRequest(line.trim());
    }
    // A double-quoted shell argument: \" \\ \$ \` stand for the character itself.
    for (const m of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) addScript(m[1].replace(/\\(["\\$`])/g, '$1'));
    for (const m of body.matchAll(/'([^']*)'/g)) {
      addRequest(m[1]);
      addScript(m[1]);
    }
  }
  return out;
}

/** Problems with where a step's statement and parameters come from: both must already be on the page. */
function provenanceProblems(input: ElementInput, steps: Step[]): string[] {
  const source = readFileSync(input.page.file, 'utf8');
  const verify = fences(source).filter((f) => /^bash\s+verify\b/.test(f.info)).map((f) => f.body);
  const cellStatements = new Set(input.cells.flatMap((c) => c.code.split(/;[ \t]*\r?\n/).map(normalise)));
  const fromVerify = verifyStatements(verify);
  const data = pageData(input, verify);
  const out: string[] = [];
  steps.forEach((step, i) => {
    const where = `step ${i + 1}`;
    if (step.tool === 'get_schema') return;
    const s = normalise(String(step.arguments.statement ?? ''));
    if (!cellStatements.has(s) && !fromVerify.has(s)) {
      out.push(`${where}: its statement is not one the page runs whole (a cell's statement, or a statement a \`bash verify\` fence runs); a trace replays the page, it does not invent calls`);
    }
    const p = step.arguments.parameters;
    if (isObject(p) && Object.keys(p).length) {
      const entries = Object.entries(p);
      // The whole object is data the page holds; or every key is one data
      // object's own key with its value; or each value is a whole data item
      // (a file the page binds to that parameter, as --fetch-params does).
      const known =
        data.some((d) => same(d, p)) ||
        data.some((d) => isObject(d) && entries.every(([k, v]) => k in d && same(d[k], v))) ||
        entries.every(([, v]) => data.some((d) => same(d, v)));
      if (!known) out.push(`${where}: its \`parameters\` are not data the page holds (a \`json data=\` block, a JSON file a command writes, a request's parameters)`);
    }
  });
  return out;
}

/** The cell a step repeats exactly (statement and data), if any: its rows must match that cell's recording. */
function repeatedCell(input: ElementInput, step: Step) {
  const s = normalise(String(step.arguments.statement ?? ''));
  return input.cells.find((c) => {
    if (normalise(c.code) !== s) return false;
    const data = c.params ? JSON.parse(input.dataBlocks[c.params] ?? 'null') : null;
    return same(data ?? {}, step.arguments.parameters ?? {});
  });
}

export default {
  live: 'Step sends the next call and Play all sends the rest, each to the page\'s database in your browser on the store the cells build up to the trace\'s starting cell, and each step shows the result `relate serve`\'s tool returns for that call, built from the engine\'s live result; a trace that would write twice starts on an emptied database, and the database is emptied again when the trace ends, so the page\'s cells run on what they write.',
  inputs: RECORD_INPUTS,
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`steps=<name>\`, \`from=<cell>\` and \`id\`, not \`${k}\``);
    const from = input.attributes.from;
    if (!from) out.push('names the cell its database starts after with `from=<cell id>`');
    else if (!input.cells.some((c) => c.id === from)) out.push(`\`from\` names \`${from}\`, which is not a cell on the page`);
    const read = readSteps(input);
    if ('problem' in read) return [...out, read.problem];
    if (read.steps.length > 12) out.push('replays at most twelve steps');
    read.steps.forEach((s, i) => {
      out.push(...callProblems(s, `step ${i + 1}`));
      if (typeof s?.note !== 'string' || !s.note.trim()) out.push(`step ${i + 1}: \`note\` says where the call comes from`);
      if (s?.expect !== undefined && s.expect !== 'error') out.push(`step ${i + 1}: \`expect\` is "error" or absent`);
    });
    if (input.children.trim()) out.push('takes no children: its static form is the recorded transcript; put prose before it');
    if (!out.length) out.push(...provenanceProblems(input, read.steps));
    return out;
  },
  async staticForm(input) {
    const read = readSteps(input);
    if ('problem' in read) throw new Error(read.problem);
    const from = input.attributes.from;
    const db = await seededDatabase(input, from);
    const n = read.steps.length;
    const parts: string[] = [
      `The trace starts on the database the cells up to \`${from}\` build. Each step below ran when the page was recorded, one after another on that database, through the mapping the MCP tryout uses; each result is what relate serve's tool returns for that call, built from the engine's result. No agent and no server took part in the recording.`,
    ];
    try {
      for (const [i, step] of read.steps.entries()) {
        const call: Call = { tool: step.tool, arguments: step.arguments, parametersText: step.parametersText };
        const out = await callTool(db.run, call, i + 1, { readOnly: false });
        if (out.isError !== (step.expect === 'error')) {
          throw new Error(`step ${i + 1}: ${out.isError ? `the tool answered an error, \`${out.text}\`` : 'the tool answered a result'}, and the step ${step.expect === 'error' ? 'expects an error' : 'expects a result'}`);
        }
        const cell = repeatedCell(input, step);
        if (cell && out.envelope) {
          const recorded = (input.recordings[cell.id]?.envelope as { rows?: unknown[] } | null)?.rows;
          const rows = (out.envelope as { rows: unknown[] }).rows;
          if (!same(recorded, rows)) throw new Error(`step ${i + 1} repeats cell \`${cell.id}\` and returned other rows than its recording`);
        }
        parts.push(`**Step ${i + 1} of ${n}: \`${step.tool}\`.** ${step.note.trim()}`, jsonFence(out.request), outcomeMarkdown(call, out));
        if (cell) parts.push(`The rows match cell \`${cell.id}\`'s recording.`);
      }
    } finally {
      db.free();
    }
    return { text: parts.join('\n\n') };
  },
} satisfies ElementSpec;

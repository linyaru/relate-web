// relate's MCP tools (`relate serve --mcp`) reproduced over the engine's wire
// envelopes, for `:::mcp-tryout` and `:::agent-trace`: the build runs it on
// public/wasm in Node for the static forms, the browser modules on the page's
// database. Shared by both, so it stays free of Node and DOM imports.
//
// What it reproduces, from upstream surfaces/relate-mcp/src (relate 0.16.1):
//
// - `read_cypher` and `write_cypher` (tools.rs `Tools::run`, `result_envelope_json`):
//   the server plans `EXPLAIN <statement>` with the call's parameters, gates
//   the plan's query type, then runs the statement. The reply's text is one
//   JSON object: the executed result's columns, columnTypes, rows (emptied for
//   `write_cypher`), stats and timings, with the EXPLAIN's notifications and
//   plan. The pieces are spliced from the engine's own JSON text, so numbers
//   keep the engine's spelling, and its keys are sorted as serde_json's map
//   sorts them.
// - The call's parameters reach the engine as the JSON text the host wrote,
//   never parsed and written again, so `1.0` stays a float: the server decodes
//   them with serde_json, which keeps the difference.
// - `get_schema` (schema.rs `collect_schema`): `CALL db.labels()`, then per
//   label a count, a sample of nodes for property types and a sample of
//   outgoing relationships, `LIMIT sample_size` (1000 by default).
// - Tool errors (tools.rs `tool_error_text`): `isError: true` and the text,
//   `Error: <engine message>` for an engine error.
//
// What it cannot reproduce, and how it says so: the engine's envelope carries
// no query type, so the gate here reads the EXPLAIN plan's operators
// (`gateReading`; the server reads the planner's own classification). It
// knows the operators reference/cypher/explain-and-profile lists; an operator
// it does not know counts as a write, so `read_cypher` refuses rather than
// run a statement the server might refuse, and the outcome names it. The
// pinned refusal texts and the read-only server's `unknown tool
// 'write_cypher'` are the server's recorded answers
// (src/content/docs/_data/errors.json; src/lib/docs/mcp-tryout.test.ts holds
// them equal). Transport (stdio framing, HTTP status codes, auth, Origin) is
// not emulated at all.

/** errors.json `mcp-read-query-only`: `read_cypher` got a write or a schema statement. */
export const READ_ONLY_REJECTION = 'Only MATCH queries are allowed for read-query';
/** errors.json `mcp-write-query-only`: `write_cypher` got a read. */
export const WRITE_ONLY_REJECTION = 'Only write queries are allowed for write-query';
/** errors.json `mcp-unknown-tool`, recorded from `relate serve --mcp stdio --read-only`. */
export const UNKNOWN_WRITE_TOOL = "unknown tool 'write_cypher'";
/** errors.json `mcp-parameters-not-object`. */
export const PARAMETERS_NOT_OBJECT = 'invalid params: "parameters" must be an object';
/** errors.json `mcp-missing-statement`. */
export const MISSING_STATEMENT = 'invalid params: missing string "statement"';
/** errors.json `engine-write-on-read-only`: the engine's own refusal on a read-only database (not an MCP reply). */
export const ENGINE_READ_ONLY = { code: '42N18', name: 'WriteOnReadOnlyAccessDatabase', id: 'engine-write-on-read-only' };
/** The server's `get_schema` sample when the call names none (server.rs `McpServerConfig::default`). */
export const DEFAULT_SAMPLE_SIZE = 1000;

export const TOOLS = ['get_schema', 'read_cypher', 'write_cypher'] as const;
export type Tool = (typeof TOOLS)[number];

/** `tools/list` order, as the recorded server lists them (reference/server/mcp, Methods). */
export const listedTools = (readOnly: boolean): Tool[] => (readOnly ? ['read_cypher', 'get_schema'] : ['write_cypher', 'read_cypher', 'get_schema']);

/** One tool call: what a host puts in `tools/call` params. */
export interface Call {
  tool: Tool;
  arguments: Record<string, unknown>;
  /**
   * `arguments.parameters` as the host wrote it (JSON text), when known. It is
   * what the request line carries and what the engine receives, so a number's
   * spelling (`1.0` against `1`) survives; `arguments.parameters` is the same
   * value parsed, for checks only.
   */
  parametersText?: string;
}

/** Run one script on a database; resolves to the engine's envelope JSON text, one per statement. */
export type RunScript = (code: string, params: string | null) => Promise<string[]>;

/**
 * Where a reply came from:
 * - `engine`: built from the engine's envelopes by the server's mapping;
 * - `classified`: refused by the gate on the engine's EXPLAIN plan, with the server's pinned text;
 * - `refused`: the server's pinned invalid-params text; no statement reached the engine;
 * - `recorded`: the server's recorded tool error, in a line built with this call's id (the engine is not asked);
 * - `not-sent`: the page would not send it (a second statement); no reply.
 */
export type Source = 'engine' | 'classified' | 'refused' | 'recorded' | 'not-sent';

/** What the gate read in a plan besides the query type: operators it does not know, and a WHEN/ELSE whose branches the plan hides. */
export interface GateNotes {
  unknown: string[];
  conditional: boolean;
}

export interface Outcome {
  request: string;
  /** The JSON-RPC response line, or '' when not sent. */
  reply: string;
  /** `content[0].text`. */
  text: string;
  isError: boolean;
  source: Source;
  /** Why the page did not send the call: a second statement after a `;`. */
  notSent?: 'second-statement';
  /** The gate's reading of the plan (`r`, `w`, `rw`, `s`), when it planned one. */
  queryType: QueryType | null;
  /** What made the gate's reading less than the server's, when anything did. */
  gate: GateNotes | null;
  /** The executed statement's envelope, parsed (timings included), for a Cypher tool that ran. */
  envelope: Record<string, unknown> | null;
  /** The schema map, for `get_schema`. */
  schema: Record<string, unknown> | null;
}

// ---------------------------------------------------------------- JSON text

/** The index just past the JSON string that starts at `from` (a `"`). */
function stringEnd(text: string, from: number): number {
  let j = from + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

/** The index just past the JSON value that starts at `from` (after any whitespace), stopping at a `,`, `}` or `]` that closes its container. */
function valueEnd(text: string, from: number): number {
  let i = from;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i = stringEnd(text, i);
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) break;
      depth--;
    } else if (c === ',' && depth === 0) break;
    i++;
  }
  return i;
}

const skipWs = (text: string, i: number) => {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
};

/**
 * The top-level members of a JSON object's text, each value as its raw text,
 * in order. Splicing raw text keeps the engine's number spelling (2.0 stays
 * 2.0), which JSON.parse and JSON.stringify would not.
 */
export function topLevelMembers(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = text.indexOf('{') + 1;
  if (i === 0) return out;
  while (i < text.length) {
    i = skipWs(text, i);
    if (text[i] !== '"') break;
    const keyEnd = stringEnd(text, i);
    const key = JSON.parse(text.slice(i, keyEnd)) as string;
    i = skipWs(text, keyEnd) + 1; // past ':'
    const start = skipWs(text, i);
    i = valueEnd(text, start);
    out.set(key, text.slice(start, i).trim());
    i = skipWs(text, i);
    if (text[i] === ',') i++;
  }
  return out;
}

/** The items of a JSON array's text, each as its raw text, in order. */
export function arrayItems(text: string): string[] {
  const out: string[] = [];
  let i = text.indexOf('[') + 1;
  if (i === 0) return out;
  while (i < text.length) {
    const start = skipWs(text, i);
    if (text[start] === ']') break;
    i = valueEnd(text, start);
    out.push(text.slice(start, i).trim());
    i = skipWs(text, i);
    if (text[i] === ',') i++;
  }
  return out;
}

/** JSON text with the whitespace outside strings removed: one line, as a host sends it, every value spelled as written. */
export function compactJson(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const end = stringEnd(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (!/\s/.test(c)) out += c;
    i++;
  }
  return out;
}

/** A JSON object's text with one member's raw value replaced, every other member as written and in place. */
export function withMember(objectText: string, key: string, rawValue: string): string {
  const members = topLevelMembers(objectText);
  if (!members.has(key)) return objectText;
  members.set(key, rawValue);
  return `{${[...members].map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
}

/** `arguments.parameters` of each call in a `{"<key>": [{…, "arguments": {…}}]}` text, as written (undefined where a call has none). */
export function rawParameters(blockText: string, key: string): (string | undefined)[] {
  const list = topLevelMembers(blockText).get(key);
  if (list === undefined) return [];
  return arrayItems(list).map((item) => {
    const args = topLevelMembers(item).get('arguments');
    return args === undefined ? undefined : topLevelMembers(args).get('parameters');
  });
}

/** `params.arguments.parameters` of a `tools/call` request line, as written. */
export function requestParameters(line: string): string | undefined {
  const params = topLevelMembers(line).get('params');
  const args = params === undefined ? undefined : topLevelMembers(params).get('arguments');
  return args === undefined ? undefined : topLevelMembers(args).get('parameters');
}

// ---------------------------------------------------------------- JSON-RPC lines

/** A placeholder for the raw parameters while the rest of the request is written by JSON.stringify. */
const RAW = '\u0000parameters\u0000';

/**
 * The `tools/call` request a host sends. Its key order is the host's; the
 * reference pages send this one. The parameters are the call's own text,
 * compacted, so they read as the host wrote them.
 */
export function requestLine(id: number, call: Call): string {
  const raw = call.parametersText;
  const args = raw !== undefined && 'parameters' in call.arguments ? { ...call.arguments, parameters: RAW } : call.arguments;
  const line = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: call.tool, arguments: args } });
  return raw !== undefined && args !== call.arguments ? line.replace(JSON.stringify(RAW), () => compactJson(raw)) : line;
}

/** The server's tool result: a struct's fields in order, then a sorted map (`content`, `isError`; `text`, `type`). */
export const replyLine = (id: number, text: string, isError: boolean) =>
  `{"jsonrpc":"2.0","id":${id},"result":{"content":[{"text":${JSON.stringify(text)},"type":"text"}],"isError":${isError}}}`;

/** `value` as JSON with every object's keys sorted, as serde_json's default (BTreeMap) map writes them. */
export function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

/** A statement with its whitespace collapsed and a trailing `;` dropped: how two spellings of one statement compare. */
export const normalise = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/;$/, '').trim();

/** The timings in a reply or envelope as `<ms>`, as the reference pages print them (they change on every run). */
export const maskTimings = (text: string) => text.replace(/(_ms\\?":)-?[0-9][0-9.e+-]*/g, '$1<ms>');

/**
 * The text of a successful `read_cypher` / `write_cypher` call, from the
 * executed statement's envelope and the classification EXPLAIN's: the
 * executed result's members, the EXPLAIN's `notifications` and `plan`, rows
 * emptied for a write, `error` null, keys sorted.
 */
export function resultText(executed: string, explained: string, tool: 'read_cypher' | 'write_cypher'): string {
  const exec = topLevelMembers(executed);
  const plan = topLevelMembers(explained);
  exec.set('notifications', plan.get('notifications') ?? '[]');
  exec.set('plan', plan.get('plan') ?? 'null');
  exec.set('error', 'null');
  if (tool === 'write_cypher') exec.set('rows', '[]');
  return `{${[...exec.keys()].sort().map((k) => `${JSON.stringify(k)}:${exec.get(k)}`).join(',')}}`;
}

// ---------------------------------------------------------------- the gate

export type QueryType = 'r' | 'w' | 'rw' | 's';

interface PlanNode {
  operator: string;
  details?: string;
  children?: PlanNode[];
}

// The operators reference/cypher/explain-and-profile lists, by what they do.
// Reads are an allow-list: an operator outside all three sets counts as a
// write, so read_cypher refuses it rather than run what the server might not.
const READ_OPERATORS = new Set([
  'AllNodesScan',
  'NodeByLabelScan',
  'NodeIndexSeek',
  'NodeIndexSeekByRange',
  'Expand',
  'Projection',
  'Let',
  'Filter',
  'EagerAggregation',
  'Unwind',
  'ProduceResults',
  'ShowIndexes',
  'Use',
  'Union',
  'UnionAll',
  'Next',
]);
// Data writes, as the planner's clause classes count them (relate-planner
// access.rs: a CALL subquery and LOAD CSV count as writes outright).
const WRITE_OPERATORS = new Set(['Create', 'Merge', 'SetProperty', 'SetLabels', 'RemoveProperty', 'RemoveLabels', 'Delete', 'DetachDelete', 'Foreach', 'CallSubquery', 'LoadCSV']);
// Schema commands: the range-index operators, any other create/drop of an
// index or constraint, and a Catalog statement that creates, drops or alters.
const SCHEMA_OPERATOR = /^(?:Create|Drop)\w*(?:Index|Constraint)$/;
const SCHEMA_CATALOG = /^(?:CREATE|DROP|ALTER)\b/i;
// A Catalog statement reads only when it shows; any other keyword is unknown here.
const READ_CATALOG = /^SHOW\b/i;
// A procedure whose name says it changes the store counts as a write (the
// server asks the executor's registry, which the page cannot).
const WRITE_PROCEDURE = /\b(?:create|drop|set|delete|remove|merge|clear|await)\w*\s*\(/i;

/** `Optional(Expand)` is an `Expand` that an OPTIONAL MATCH plans. */
const baseOperator = (name: string) => name.replace(/^Optional\((.*)\)$/, '$1');

/**
 * Whether the plan's last stage hands rows back: the planner's "returns
 * columns", which splits `w` from `rw`. A NEXT chain answers with its last
 * stage, a UNION with any part, `FINISH` with none, and a plan whose top is a
 * write returns none.
 */
function returnsRows(op: PlanNode): boolean {
  const next = op.children?.find((c) => c.operator === 'Next');
  if (next) return returnsRows(next.children?.at(-1) ?? next);
  const name = baseOperator(op.operator);
  if (name === 'Union' || name === 'UnionAll' || name === 'Use') return (op.children ?? []).some(returnsRows);
  if (name === 'ProduceResults') return (op.details ?? '').trim() !== 'FINISH';
  return name === 'EagerAggregation';
}

/**
 * The query type the gate reads from an EXPLAIN plan's operators (`r`, `w`,
 * `rw` or `s`), with what it could not read as the server does: operators it
 * does not know (counted as writes), and a WHEN/ELSE, whose branches the plan
 * does not show, so it counts as a write too (the server looks inside and
 * runs a WHEN whose branches only read).
 */
export function gateReading(root: PlanNode): { type: QueryType; notes: GateNotes | null } {
  let write = false;
  let schema = false;
  let read = false;
  const unknown: string[] = [];
  let conditional = false;
  const visit = (op: PlanNode) => {
    const name = baseOperator(op.operator);
    const details = op.details ?? '';
    if (WRITE_OPERATORS.has(name)) write = true;
    else if (name === 'Conditional') {
      write = true;
      conditional = true;
    } else if (SCHEMA_OPERATOR.test(name) || (name === 'Catalog' && SCHEMA_CATALOG.test(details))) schema = true;
    else if (name === 'ProcedureCall') {
      if (WRITE_PROCEDURE.test(details)) write = true;
      else read = true;
    } else if ((name === 'Catalog' && READ_CATALOG.test(details)) || READ_OPERATORS.has(name)) read = true;
    else {
      write = true;
      const label = name === 'Catalog' ? `Catalog (${details})` : name;
      if (!unknown.includes(label)) unknown.push(label);
    }
    for (const c of op.children ?? []) visit(c);
  };
  visit(root);
  const notes = unknown.length || conditional ? { unknown, conditional } : null;
  if (schema && !write && !read) return { type: 's', notes };
  if (!write && !schema) return { type: 'r', notes };
  return { type: returnsRows(root) ? 'rw' : 'w', notes };
}

/** The query type alone (see `gateReading`). */
export const queryType = (root: PlanNode): QueryType => gateReading(root).type;

/**
 * How many statements `statement` holds, by its `;` outside strings and
 * comments: `one`; `trailing` when the only `;` ends it; `second` when
 * another statement follows one. The server answers a second statement with
 * a syntax error (reference/server/mcp, Limits), and the engine's script
 * runner would run it as a second statement instead, so the page does not
 * send it. A trailing `;` the server accepts and runs, keeping it in the
 * plan's `statement` (relate 0.16.1, checked against the binary); the
 * engine's script runner drops it there, so `callTool` puts it back.
 */
export function statementCount(statement: string): 'one' | 'trailing' | 'second' {
  const s = statement;
  let i = 0;
  let semicolon = -1;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < s.length && s[i] !== q) i += s[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (c === ';') {
      if (semicolon >= 0) return 'second';
      semicolon = i;
    } else if (semicolon >= 0 && !/\s/.test(c)) return 'second';
    i++;
  }
  return semicolon >= 0 ? 'trailing' : 'one';
}

// ---------------------------------------------------------------- get_schema

/** Backticks around a label, inner backticks doubled (relate_model `quote_identifier_always`). */
export const quoteIdentifier = (name: string) => `\`${name.replace(/`/g, '``')}\``;

/** The server's type name for an engine `valueType()` (schema.rs `value_type`); null for NULL. */
export function schemaType(valueType: string): string | null {
  const t = valueType.replace(/ NOT NULL$/, '');
  if (t === 'NULL' || t === 'NOTHING') return null;
  if (t === 'BOOLEAN') return 'Boolean';
  if (t === 'INTEGER') return 'Integer';
  if (t === 'FLOAT') return 'Float';
  if (t === 'STRING' || t === 'UUID') return 'String';
  if (t.startsWith('LIST') || t === 'BYTES') return 'List';
  if (t.startsWith('MAP')) return 'Map';
  if (t === 'NODE') return 'Node';
  if (t === 'RELATIONSHIP') return 'Relationship';
  if (t === 'PATH') return 'Path';
  if (/^(?:DATE|LOCAL TIME|ZONED TIME|TIME|LOCAL DATETIME|ZONED DATETIME|DATETIME|DURATION)$/.test(t)) return 'Temporal';
  if (t.startsWith('POINT')) return 'Point';
  if (t.startsWith('VECTOR')) return 'Vector';
  return t.charAt(0) + t.slice(1).toLowerCase();
}

/**
 * The three queries schema.rs runs per label, one script. Property types come
 * from `valueType()` over the same sample (the server reads the values' own
 * types; the wire's JSON would lose Integer against Float).
 */
export function labelScript(label: string, sample: number | null): string {
  const ident = quoteIdentifier(label);
  const limit = sample === null ? '' : ` LIMIT ${sample}`;
  return [
    `MATCH (n:${ident}) RETURN count(n) AS count`,
    `MATCH (n:${ident}) WITH n${limit} UNWIND keys(n) AS key RETURN key, valueType(n[key]) AS type`,
    `MATCH (n:${ident})-[r]->(m) WITH r, m${limit} RETURN type(r) AS rel_type, labels(m) AS target_labels, [key IN keys(r) | [key, valueType(r[key])]] AS props`,
  ].join(';\n');
}

type Row = Record<string, unknown>;
const rowsOf = (text: string): Row[] => (JSON.parse(text) as { rows?: Row[] }).rows ?? [];
const errorOf = (text: string): string | null => (JSON.parse(text) as { error?: string | null }).error ?? null;

/** One label's schema entry from the three envelopes `labelScript` returns. */
export function labelEntry(envelopes: string[]): Row {
  const [countEnv, propsEnv, relsEnv] = envelopes;
  const count = Number(rowsOf(countEnv)[0]?.count ?? 0);
  const properties: Row = {};
  for (const r of rowsOf(propsEnv)) {
    const ty = schemaType(String(r.type));
    if (ty && !(String(r.key) in properties)) properties[String(r.key)] = { type: ty };
  }
  const byType = new Map<string, { labels: Set<string>; properties: Row }>();
  for (const r of rowsOf(relsEnv)) {
    const t = String(r.rel_type);
    if (!byType.has(t)) byType.set(t, { labels: new Set(), properties: {} });
    const e = byType.get(t)!;
    for (const l of (r.target_labels as string[]) ?? []) e.labels.add(l);
    for (const [k, vt] of (r.props as [string, string][]) ?? []) {
      const ty = schemaType(vt);
      if (ty && !(k in e.properties)) e.properties[k] = { type: ty };
    }
  }
  const entry: Row = { type: 'node', count };
  if (Object.keys(properties).length) entry.properties = properties;
  if (byType.size) {
    const relationships: Row = {};
    for (const [t, e] of byType) {
      const obj: Row = { direction: 'out' };
      if (e.labels.size) obj.labels = [...e.labels].sort();
      if (Object.keys(e.properties).length) obj.properties = e.properties;
      relationships[t] = obj;
    }
    entry.relationships = relationships;
  }
  return entry;
}

// ---------------------------------------------------------------- one call

/** The call's parameters as the engine's JSON text (the host's own text when the call carries it), or a refusal (the server's text). */
function parametersOf(call: Call): { params: string | null } | { refusal: string } {
  const p = call.arguments.parameters;
  if (p === undefined || p === null) return { params: null };
  if (typeof p !== 'object' || Array.isArray(p)) return { refusal: PARAMETERS_NOT_OBJECT };
  if (!Object.keys(p).length) return { params: null };
  return { params: call.parametersText !== undefined ? compactJson(call.parametersText) : JSON.stringify(p) };
}

/**
 * Answer one `tools/call` as `relate serve --mcp` does, on the database
 * behind `run`. `readOnly`: the server was started `--read-only`, so
 * `write_cypher` is not listed and its call gets the recorded refusal.
 */
export async function callTool(run: RunScript, call: Call, id: number, options: { readOnly: boolean }): Promise<Outcome> {
  const request = requestLine(id, call);
  const base = { request, queryType: null, gate: null, envelope: null, schema: null };
  const answer = (text: string, isError: boolean, source: Source, extra: Partial<Outcome> = {}): Outcome => ({
    ...base,
    reply: replyLine(id, text, isError),
    text,
    isError,
    source,
    ...extra,
  });

  if (call.tool === 'get_schema') {
    const raw = call.arguments.sample_size;
    let sample: number | null = DEFAULT_SAMPLE_SIZE;
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return answer('invalid params: "sample_size" must be an integer', true, 'refused');
      if (raw < -1) return answer(`invalid params: sample_size must be -1 or non-negative, got ${raw}`, true, 'refused');
      sample = raw === -1 ? null : raw;
    }
    const [labelsEnv] = await run('CALL db.labels()', null);
    const fail = errorOf(labelsEnv);
    if (fail) return answer(`Error: ${fail}`, true, 'engine');
    const labels = rowsOf(labelsEnv).map((r) => String(r.label));
    const schema: Row = {};
    if (labels.length) {
      const envelopes = await run(labels.map((l) => labelScript(l, sample)).join(';\n'), null);
      for (const [i, label] of labels.entries()) {
        const three = envelopes.slice(i * 3, i * 3 + 3);
        const bad = three.length < 3 ? 'the schema query stopped early' : three.map(errorOf).find(Boolean);
        if (bad) return answer(`Error: ${bad}`, true, 'engine');
        schema[label] = labelEntry(three);
      }
    }
    return answer(sortedJson(schema), false, 'engine', { schema });
  }

  if (call.tool === 'write_cypher' && options.readOnly) return answer(UNKNOWN_WRITE_TOOL, true, 'recorded');
  const statement = call.arguments.statement;
  if (typeof statement !== 'string') return answer(MISSING_STATEMENT, true, 'refused');
  const p = parametersOf(call);
  if ('refusal' in p) return answer(p.refusal, true, 'refused');
  const count = statementCount(statement);
  if (count === 'second') return { ...base, reply: '', text: '', isError: true, source: 'not-sent', notSent: 'second-statement' };

  let [explained] = await run(`EXPLAIN ${statement}`, p.params);
  const planError = errorOf(explained);
  if (planError) return answer(`Error: ${planError}`, true, 'engine');
  if (count === 'trailing') {
    // The server plans the statement as sent, trimmed, `;` included; the script runner dropped the `;`.
    const planText = topLevelMembers(explained).get('plan');
    if (planText && planText !== 'null') explained = withMember(explained, 'plan', withMember(planText, 'statement', JSON.stringify(statement.trim())));
  }
  const plan = (JSON.parse(explained) as { plan: { root: PlanNode } }).plan;
  const { type, notes } = gateReading(plan.root);
  const gated = { queryType: type, gate: notes };
  if (call.tool === 'read_cypher' && type !== 'r') return answer(READ_ONLY_REJECTION, true, 'classified', gated);
  if (call.tool === 'write_cypher' && type === 'r') return answer(WRITE_ONLY_REJECTION, true, 'classified', gated);
  const [executed] = await run(statement, p.params);
  const runError = errorOf(executed);
  if (runError) return answer(`Error: ${runError}`, true, 'engine', gated);
  const text = resultText(executed, explained, call.tool);
  return answer(text, false, 'engine', { ...gated, envelope: JSON.parse(executed) });
}

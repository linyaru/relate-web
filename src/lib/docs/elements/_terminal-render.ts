// The agent-mode terminal's renderers (`:::terminal`, DOCS-PLAN.md §7.3):
// what the relate CLI prints for one run in `--mode table`, `envelope`,
// `jsonl` and `toon`, rebuilt from the wire envelopes the engine returns
// (the WASM build in the browser, a recording at build). The CLI renders the
// same engine result through its own crates (surfaces/relate-formatter and
// surfaces/relate-cli upstream); these functions port the parts the four
// modes use, so src/lib/docs/terminal.test.ts can compare their bytes with
// the binary's on the same statements and fail on any drift.
//
// What the engine cannot say, the CLI decides: the row cap, the exit code,
// the stderr lines and the error object. The cap and the error lines follow
// the CLI's rules; the exit code, the error class and the cap's size come
// from the recorded facts (`TerminalFacts`, digested from _data/cli.json and
// _data/errors.json by _terminal-facts.ts), never typed in here.
//
// Shared by the build (src/lib/docs/elements/terminal.ts) and the browser
// (src/scripts/docs/elements/terminal.ts): no Node imports.

export const MODES = ['table', 'envelope', 'jsonl', 'toon'] as const;
export type Mode = (typeof MODES)[number];

/** The recorded facts the renderers read (src/lib/docs/elements/_terminal-facts.json). */
export interface TerminalFacts {
  /** The relate version the recordings come from, e.g. "0.16.1". */
  version: string;
  /** The recordings' binary, as cli.json names it. */
  recordedWith: string;
  /** The row cap relate applies under a detected agent harness (from the recorded run). */
  agentCap: number;
  /** The harness variable the recorded run sets, e.g. "CLAUDECODE". */
  harnessVariable: string;
  /** Every variable relate's detection reads. */
  harnessVariables: string[];
  /** The stderr warning of a cut result, with `{kept}` and `{total}` for the counts. */
  capWarning: string;
  /** The exit code table, without the reserved rows. */
  exitCodes: { exit: number; code: string; meaning: string }[];
  /** Per error kind: its class, exit code and whether a retry can help (errors.json `cli-<code>-<kind>`). */
  kinds: Record<string, { code: string; exit: number; retryable: boolean; id: string }>;
  /** Recorded error messages as patterns, most specific first (errors.json engine and cli entries). */
  messages: { id: string; pattern: string; kind: string; code: string; exit: number; retryable: boolean }[];
}

// ---------------------------------------------------------------- JSON, kept byte for byte

/**
 * A JSON value with the source text of every part kept: numbers keep their
 * spelling (`1.0`, `1e+21`), so a float the engine printed is re-printed as
 * the CLI prints it, and a row is copied, not re-serialized.
 */
export type Json =
  | { t: 'null' | 'bool' | 'num'; raw: string }
  | { t: 'str'; raw: string; value: string }
  | { t: 'arr'; raw: string; items: Json[] }
  | { t: 'obj'; raw: string; entries: [string, Json][] };

/** Parse JSON text, keeping each value's source text. Throws on text that is not JSON. */
export function parseJson(text: string): Json {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`not JSON at ${i}: ${what}`);
  };
  const value = (): Json => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries: [string, Json][] = [];
      ws();
      if (text[i] === '}') i++;
      else
        for (;;) {
          ws();
          const key = value();
          if (key.t !== 'str') fail('an object key');
          ws();
          if (text[i++] !== ':') fail('":"');
          entries.push([(key as { value: string }).value, value()]);
          ws();
          if (text[i] === ',') i++;
          else if (text[i++] === '}') break;
          else fail('"," or "}"');
        }
      return { t: 'obj', raw: text.slice(start, i), entries };
    }
    if (c === '[') {
      i++;
      const items: Json[] = [];
      ws();
      if (text[i] === ']') i++;
      else
        for (;;) {
          items.push(value());
          ws();
          if (text[i] === ',') i++;
          else if (text[i++] === ']') break;
          else fail('"," or "]"');
        }
      return { t: 'arr', raw: text.slice(start, i), items };
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      if (text[i++] !== '"') fail('a closing quote');
      const raw = text.slice(start, i);
      return { t: 'str', raw, value: JSON.parse(raw) as string };
    }
    for (const [word, t] of [['null', 'null'], ['true', 'bool'], ['false', 'bool']] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return { t, raw: word };
      }
    }
    const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
    if (!m) fail('a value');
    i += m![0].length;
    return { t: 'num', raw: m![0] };
  };
  const out = value();
  ws();
  if (i !== text.length) fail('the end');
  return out;
}

const field = (obj: Json, key: string): Json | undefined => (obj.t === 'obj' ? obj.entries.find(([k]) => k === key)?.[1] : undefined);
const strings = (j: Json | undefined): string[] => (j?.t === 'arr' ? j.items.map((x) => (x.t === 'str' ? x.value : x.raw)) : []);

/** One wire envelope, parsed losslessly: what a renderer needs from it. */
export interface Envelope {
  columns: string[];
  columnTypes: string[];
  rows: Json[];
  error: string | null;
  hasPlan: boolean;
}

/** A wire envelope from its JSON text (the engine's, or a recording's re-serialized). */
export function readEnvelope(text: string): Envelope {
  const j = parseJson(text);
  const error = field(j, 'error');
  const plan = field(j, 'plan');
  return {
    columns: strings(field(j, 'columns')),
    columnTypes: strings(field(j, 'columnTypes')),
    rows: field(j, 'rows')?.t === 'arr' ? (field(j, 'rows') as { items: Json[] }).items : [],
    error: error?.t === 'str' ? error.value : null,
    hasPlan: !!plan && plan.t !== 'null',
  };
}

/**
 * A recorded envelope (results sidecar: parsed JSON, timings left out) as
 * envelope text. JSON.parse lost each float's spelling, so a value in a
 * FLOAT column that reads as a whole number gets its `.0` back; a float
 * nested in a list or map cannot be told from an integer any more.
 */
export function recordedEnvelopeText(envelope: unknown): string {
  const e = envelope as { columns?: string[]; columnTypes?: string[]; rows?: Record<string, unknown>[] };
  const floats = new Set((e.columns ?? []).filter((_, i) => e.columnTypes?.[i] === 'FLOAT'));
  const rows = (e.rows ?? []).map(
    (row) =>
      '{' +
      Object.keys(row)
        .sort(byteOrder)
        .map((k) => {
          const v = row[k];
          const raw = JSON.stringify(v);
          return `${JSON.stringify(k)}:${floats.has(k) && typeof v === 'number' && Number.isInteger(v) && !/e/.test(raw) ? `${raw}.0` : raw}`;
        })
        .join(',') +
      '}',
  );
  const rest = Object.entries(e as Record<string, unknown>).filter(([k]) => k !== 'rows');
  return `{${[...rest.map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`), `"rows":[${rows.join(',')}]`].join(',')}}`;
}

/** UTF-8 byte order, as serde_json's sorted maps use (UTF-16 order differs above U+FFFF). */
function byteOrder(a: string, b: string): number {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(ea.length, eb.length); i++) if (ea[i] !== eb[i]) return ea[i] - eb[i];
  return ea.length - eb.length;
}

// ---------------------------------------------------------------- output safety (relate-formatter escape.rs)

/** Unicode format characters (Cf) relate never prints raw: escape.rs `is_format_char`. */
const FORMAT_CHARS: [number, number][] = [
  [0xad, 0xad], [0x600, 0x605], [0x61c, 0x61c], [0x6dd, 0x6dd], [0x70f, 0x70f], [0x890, 0x891], [0x8e2, 0x8e2],
  [0x180e, 0x180e], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f], [0xfeff, 0xfeff],
  [0xfff9, 0xfffb], [0x110bd, 0x110bd], [0x110cd, 0x110cd], [0x13430, 0x1343f], [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a], [0xe0001, 0xe0001], [0xe0020, 0xe007f],
];

/** escape.rs `is_unsafe_output_char`: a Cc control (Rust's `char::is_control`) or a Cf format character. */
export function isUnsafeChar(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || FORMAT_CHARS.some(([a, b]) => cp >= a && cp <= b);
}

/** escape.rs `escape_control` (table cells): `\\`, `\n`, `\r`, `\t`, the rest of the unsafe set as `\u{XXXX}`. */
function escapeControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (isUnsafeChar(cp)) out += `\\u{${cp.toString(16).toUpperCase()}}`;
    else out += ch;
  }
  return out;
}

/** Rust's `char::is_whitespace` for the unsafe characters: the ones `sanitize_error_text` turns into a space. */
const UNSAFE_SPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x85]);

/** escape.rs `sanitize_error_text`: one line, unsafe whitespace as a space, other unsafe characters dropped. */
export function sanitizeErrorText(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (UNSAFE_SPACE.has(cp)) out += ' ';
    else if (!isUnsafeChar(cp)) out += ch;
  }
  return out;
}

// ---------------------------------------------------------------- display width (the unicode-width crate 0.2, approximately)

const ZERO_WIDTH = /[\p{Grapheme_Extend}\p{Default_Ignorable_Code_Point}]/u;
const EMOJI = /\p{Emoji}/u;
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;
const MODIFIER_BASE = /\p{Emoji_Modifier_Base}/u;
const MODIFIER = /\p{Emoji_Modifier}/u;
const regional = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;

/** Display columns of one code point: 0 for combining and ignorable marks, 2 for East Asian wide and fullwidth characters and emoji shown as emoji. */
function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (ZERO_WIDTH.test(ch)) return 0;
  // A regional indicator is one column; a flag is two of them.
  if (EMOJI_PRESENTATION.test(ch) && !regional(cp)) return 2;
  if (
    (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f200 && cp <= 0x1f2ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

/**
 * Display columns of a string: the sum of its characters, except the emoji
 * sequences unicode-width 0.2 counts as one picture: a character with U+FE0F
 * (emoji presentation) or a modifier base with a skin tone is 2 columns, an
 * emoji with U+FE0E (text presentation) 1. A zero-width joiner never reaches
 * the table: relate escapes it as `\u{200D}`.
 */
export function displayWidth(s: string): number {
  // Printable ASCII, most cells: one column a character.
  if (/^[\x20-\x7e]*$/.test(s)) return s.length;
  const cps = [...s];
  let w = 0;
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    const next = cps[i + 1];
    if (next === '\uFE0F' && EMOJI.test(ch)) {
      w += 2;
      i++;
    } else if (next === '\uFE0E' && EMOJI_PRESENTATION.test(ch) && !regional(ch.codePointAt(0)!)) {
      w += 1;
      i++;
    } else if (next !== undefined && MODIFIER_BASE.test(ch) && MODIFIER.test(next)) {
      w += 2;
      i++;
    } else w += charWidth(ch);
  }
  return w;
}

// ---------------------------------------------------------------- values as the table prints them (relate-model value.rs Display)

/**
 * A float lexeme (`1e+21`, `1.5e-7`, `-0.0`) in Rust's `{}` spelling: plain
 * decimal, never an exponent. serde_json and Rust both print the shortest
 * digits that round-trip, so shifting the decimal point is exact.
 */
function plainDecimal(raw: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m) return raw;
  const [, sign, int, frac = '', exp = '0'] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  let whole: string;
  let fraction: string;
  if (point <= 0) {
    whole = '0';
    fraction = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length);
    fraction = '';
  } else {
    whole = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  return sign + whole + (fraction ? `.${fraction}` : '');
}

const isFloatLexeme = (raw: string) => /[.eE]/.test(raw);

/** `CypherValue::Float` Display: a whole number gets `.0`; NaN and infinities print bare. */
function floatDisplay(raw: string): string {
  const plain = plainDecimal(raw);
  return plain.includes('.') ? plain : `${plain}.0`;
}

/** The column types whose wire value is the value's own Display string (wire.rs: the temporal arm). */
const TEMPORAL = new Set(['DATE', 'TIME', 'DATETIME', 'DURATION']);

/** A value as the table cell shows it, before escaping. `type` is the column's engine-stamped type, for a top-level value only. */
function display(v: Json, type?: string): string {
  switch (v.t) {
    case 'null':
      return 'null';
    case 'bool':
      return v.raw;
    case 'num':
      return isFloatLexeme(v.raw) ? floatDisplay(v.raw) : v.raw;
    case 'str':
      // A temporal value travels as its Display string, and a non-finite
      // float as "NaN"/"Inf"/"-Inf"; only the column type tells them from
      // a string, so a nested one prints quoted (the CLI prints it bare).
      if (type && TEMPORAL.has(type)) return v.value;
      if (type === 'FLOAT' && /^(?:NaN|-?Inf)$/.test(v.value)) return v.value;
      return `"${v.value}"`;
    case 'arr': {
      if (type === 'PATH') return pathDisplay(v.items);
      return `[${v.items.map((x) => display(x)).join(', ')}]`;
    }
    case 'obj': {
      const kind = field(v, 'kind');
      if (kind?.t === 'str' && kind.value === 'node' && field(v, 'labels')) {
        return `(:${strings(field(v, 'labels')).join(':')}${props(field(v, 'properties'))})`;
      }
      if (kind?.t === 'str' && kind.value === 'relationship' && field(v, 'type')) {
        return `[:${(field(v, 'type') as { value: string }).value}${props(field(v, 'properties'))}]`;
      }
      const srid = field(v, 'srid');
      if (srid && field(v, 'crs')) {
        const axis = (a: string, b: string) => field(v, a) ?? field(v, b);
        const coord = (j: Json | undefined) => (j?.t === 'num' ? plainDecimal(j.raw) : j?.t === 'str' ? j.value : '');
        const z = axis('z', 'height');
        return `point({srid: ${srid.raw}, x: ${coord(axis('x', 'longitude'))}, y: ${coord(axis('y', 'latitude'))}${z ? `, z: ${coord(z)}` : ''}})`;
      }
      if (type === 'VECTOR' && field(v, 'dim') && field(v, 'values')) {
        const values = field(v, 'values') as { items: Json[] };
        return `vector([${values.items.map((x) => display(x)).join(', ')}], ${field(v, 'dim')!.raw}, ${(field(v, 'type') as { value: string }).value} NOT NULL)`;
      }
      return `{${v.entries.map(([k, x]) => `${k}: ${display(x)}`).join(', ')}}`;
    }
  }
}

function props(p: Json | undefined): string {
  if (p?.t !== 'obj' || !p.entries.length) return '';
  return ` {${p.entries.map(([k, x]) => `${k}: ${display(x)}`).join(', ')}}`;
}

/** A path's wire form alternates node, relationship, node; Display joins them with `-rel-`, no arrows. */
function pathDisplay(items: Json[]): string {
  let out = '';
  for (let i = 0; i < items.length; i += 2) {
    if (i > 0) out += `-${display(items[i - 1])}-`;
    out += display(items[i]);
  }
  return out;
}

/** A top-level table cell: `<null>` for null (table.rs `format_cell`), else the Display form. */
const cell = (row: Json, column: string, type: string | undefined) => {
  const v = field(row, column);
  return !v || v.t === 'null' ? '<null>' : display(v, type);
};

// ---------------------------------------------------------------- the four modes (relate-formatter table.rs, layout.rs, json.rs, toon.rs)

/** `--mode table` to a pipe: the grid at its natural width (layout.rs with no width budget). */
export function renderTable(env: Envelope, rows: Json[]): string[] {
  if (!env.columns.length) return [];
  const headers = env.columns.map(escapeControl);
  const cells = rows.map((r) => env.columns.map((c, i) => escapeControl(cell(r, c, env.columnTypes[i]))));
  // A loop, not Math.max(...cells): a spread passes one argument per row, and a large result overflows the stack.
  const widths = headers.map((h) => displayWidth(h));
  for (const r of cells) for (let i = 0; i < r.length; i++) widths[i] = Math.max(widths[i], displayWidth(r[i]));
  const sep = `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;
  const line = (cs: string[]) => `|${cs.map((c, i) => ` ${c}${' '.repeat(Math.max(0, widths[i] - displayWidth(c)))} `).join('|')}|`;
  return [sep, line(headers), sep, ...cells.map(line), sep];
}

const rowCapJson = (kept: number, total: number) => `{"kept":${kept},"total":${total}}`;

/** `--mode envelope`: one compact object, keys sorted, no timings and no stats. */
export function renderEnvelope(env: Envelope, rows: Json[], total: number): string[] {
  const cut = rows.length < total;
  const parts = [
    `"columnTypes":${JSON.stringify(env.columnTypes)}`,
    `"columns":${JSON.stringify(env.columns)}`,
    '"notifications":[]',
    ...(cut ? [`"rowCap":${rowCapJson(rows.length, total)}`] : []),
    `"rows":[${env.columns.length ? rows.map((r) => r.raw).join(',') : ''}]`,
    `"truncated":${cut}`,
  ];
  return [`{${parts.join(',')}}`];
}

/** `--mode jsonl`: one row per line, then a `{"rowCap": …}` line when the cap cut the rows. */
export function renderJsonl(env: Envelope, rows: Json[], total: number): string[] {
  if (!env.columns.length) return [];
  return [...rows.map((r) => r.raw), ...(rows.length < total ? [`{"rowCap":${rowCapJson(rows.length, total)}}`] : [])];
}

/** Whether Rust's `str::parse::<f64>` accepts `s` (so TOON must quote it). */
const RUST_FLOAT = /^[+-]?(?:inf|infinity|nan|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)$/i;

/**
 * toon.rs `toon_token`: bare when it cannot be misread, else JSON-quoted.
 * Rust's `str::trim` trims Unicode White_Space; JavaScript's `trim` also
 * trims U+FEFF, which is a format character relate quotes anyway, so the
 * two agree here.
 */
function toonToken(s: string): string {
  const ambiguous = RUST_FLOAT.test(s) || s === 'true' || s === 'false' || s === 'null';
  const safe = s !== '' && !ambiguous && s.trim() === s && ![...s].some((ch) => ch === ',' || ch === '"' || ch === '\\' || isUnsafeChar(ch.codePointAt(0)!));
  return safe ? s : JSON.stringify(s);
}

/** `--mode toon`: `rows[N]{cols}:`, one indented line per row, then a `rowCap:` entry when cut. */
export function renderToon(env: Envelope, rows: Json[], total: number): string[] {
  const out: string[] = [];
  if (env.columns.length) {
    out.push(`rows[${rows.length}]{${env.columns.map(toonToken).join(',')}}:`);
    for (const r of rows) {
      out.push(`  ${env.columns.map((c) => {
        const v = field(r, c);
        if (!v || v.t === 'null') return 'null';
        return v.t === 'str' ? toonToken(v.value) : v.raw;
      }).join(',')}`);
    }
  }
  if (rows.length < total) out.push('rowCap:', `  ${rowCapJson(rows.length, total)}`);
  return out;
}

// ---------------------------------------------------------------- errors (relate-cli errors.rs, syntax_position.rs)

/** How a failed statement is classified: its kind, class, exit code, and where that came from. */
export interface ErrorClass {
  kind: string;
  code: string;
  exit: number;
  retryable: boolean;
  /** The errors.json entry whose recorded message matched, or null when only the message's prefix placed it. */
  matched: string | null;
}

/** The engine's error Display prefixes (relate-core error.rs `#[error]`), for a message no recorded entry matches. */
const PREFIX_KINDS: [string, string][] = [
  ['syntax error: ', 'syntax'],
  ['semantic error: ', 'semantic'],
  ['type error: ', 'type'],
  ['storage locked: ', 'locked'],
  ['storage error: ', 'storage'],
  ['io error: ', 'io'],
  ['internal error', 'internal'],
  ['capacity exceeded: ', 'capacity'],
  ['resource limit exceeded: ', 'resource'],
  ['write-write conflict', 'conflict'],
];

/** The class relate gives an engine error message: a recorded message's, else the one its prefix names (an unprefixed message is an execution failure). */
export function classifyError(message: string, facts: TerminalFacts): ErrorClass {
  const flat = sanitizeErrorText(message);
  const hits = facts.messages.filter((m) => {
    const re = new RegExp(m.pattern);
    return re.test(message) || re.test(flat);
  });
  if (hits.length) {
    // The most specific message decides the class; the link goes to the engine's own entry for it when there is one.
    const [m] = hits;
    const entry = hits.find((h) => h.id.startsWith('engine-') && h.kind === m.kind) ?? m;
    return { kind: m.kind, code: m.code, exit: m.exit, retryable: m.retryable, matched: entry.id };
  }
  const kind = PREFIX_KINDS.find(([p]) => message.startsWith(p))?.[1] ?? 'execution';
  const k = facts.kinds[kind] ?? facts.kinds.execution;
  return { kind, code: k.code, exit: k.exit, retryable: k.retryable, matched: null };
}

/** Where a syntax error points (syntax_position.rs): the echoed source line and the caret's column, or a line and column. */
type Position = { source: string; column: number } | { line: number; column: number } | null;

function syntaxPosition(message: string): Position {
  if (!message.startsWith('syntax error: ')) return null;
  const text = message.slice('syntax error: '.length);
  const lines = text.split('\n');
  if (lines.length === 3 && lines[0].includes('parse error:') && lines[1].startsWith('  ') && lines[2].startsWith('  ') && lines[2].endsWith('^')) {
    const offset = lines[2].slice(2, -1);
    if (/^ *$/.test(offset)) {
      const target = [...offset].length + 1;
      let source = '';
      let removed = 0;
      [...lines[1].slice(2)].forEach((ch, i) => {
        if (isUnsafeChar(ch.codePointAt(0)!)) {
          if (i + 1 < target) removed++;
        } else source += ch;
      });
      return { source, column: target - removed };
    }
  }
  const at = text.lastIndexOf(' at line ');
  if (at >= 0) {
    const m = /^(\d+), col (\d+)$/.exec(text.slice(at + ' at line '.length));
    if (m && Number(m[1]) >= 1 && Number(m[2]) >= 1) return { line: Number(m[1]), column: Number(m[2]) };
  }
  return null;
}

/** The stderr lines of a failed statement (errors.rs `print_human`): the message on one line, or a syntax error's headline, source and caret. */
export function errorStderr(message: string): string[] {
  const pos = syntaxPosition(message);
  if (pos && 'source' in pos) return [sanitizeErrorText(message.split('\n')[0]), `  ${pos.source}`, `  ${' '.repeat(pos.column - 1)}^`];
  return [sanitizeErrorText(message)];
}

/** Where a multi-statement run stood when a statement failed (errors.rs `Progress`). */
export interface Progress {
  statement: number;
  statements: number;
}

/** The progress line a multi-statement failure adds on stderr. */
export const progressLine = (p: Progress) =>
  `statement ${p.statement} of ${p.statements} failed; ${p.statement - 1} completed and committed; ${p.statements - p.statement} not run`;

/** The `{"error": …}` object the JSON modes print on stdout (errors.rs `error_map`), keys sorted. */
export function errorObject(message: string, cls: ErrorClass, progress: Progress | null): string {
  const fields: Record<string, unknown> = { code: cls.code, exit_code: cls.exit, kind: cls.kind, message: sanitizeErrorText(message), retryable: cls.retryable };
  if (progress) Object.assign(fields, { statement: progress.statement, statements: progress.statements, committed: progress.statement - 1 });
  const pos = syntaxPosition(message);
  if (pos && 'source' in pos) Object.assign(fields, { column: pos.column, source: pos.source });
  else if (pos) Object.assign(fields, { line: pos.line, column: pos.column });
  const keys = Object.keys(fields).sort(byteOrder);
  return `{"error":{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(fields[k])}`).join(',')}}}`;
}

// ---------------------------------------------------------------- statements (relate-splitter)

/**
 * relate-splitter `split_executable_statements`: the statements a one-shot
 * run executes, split on `;` outside quotes, backticks and comments, with
 * comment-only pieces dropped. The CLI numbers a failure "statement k of n"
 * from it.
 */
export function splitStatements(input: string): string[] {
  const out: { text: string; content: boolean }[] = [];
  let current = '';
  let pending = false;
  let dot: number | null = null;
  let mode: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    if (mode === 'line') {
      current += ch;
      if (ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block') {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i++;
        mode = 'code';
      }
      continue;
    }
    if (mode === "'" || mode === '"') {
      current += ch;
      if (ch === '\\' && next !== undefined) {
        current += next;
        i++;
      } else if (ch === mode) mode = 'code';
      continue;
    }
    if (mode === '`') {
      current += ch;
      if (ch === '`') mode = 'code';
      continue;
    }
    if (ch === '/' && (next === '/' || next === '*')) {
      current += ch + next;
      i++;
      mode = next === '/' ? 'line' : 'block';
    } else if (ch === "'" || ch === '"' || ch === '`') {
      mode = ch;
      pending = true;
      current += ch;
    } else if (ch === ';' || (ch === '\n' && dot !== null)) {
      const trimmed = current.slice(dot ?? 0).trim();
      if (trimmed) out.push({ text: trimmed, content: ch === ';' ? pending : true });
      current = '';
      pending = false;
      dot = null;
    } else {
      if (!/\s/.test(ch)) {
        if (!pending && ch === '.' && dot === null) dot = current.length;
        pending = true;
      }
      current += ch;
    }
  }
  const trailing = current.slice(dot ?? 0).trim();
  if (trailing) out.push({ text: trailing, content: pending || dot !== null });
  return out.filter((p) => p.content).map((p) => p.text);
}

// ---------------------------------------------------------------- one run

/**
 * Errors the engine in a page (the WASM build) words differently from the
 * relate binary, found by the fixtures: the pane shows the engine's message
 * and kind, and says so. `fixture` names the fixture case that records the
 * difference; terminal.test.ts checks that each still differs as described,
 * so one that a WASM refresh fixes fails the test until it is removed here.
 */
export const ENGINE_DIFFERENCES: { fixture: string; pattern: string; binary: string; kind: string }[] = [
  { fixture: 'a latitude out of range', pattern: '^type error: InvalidArgumentValue: point\\(\\) latitude', binary: 'semantic error: InvalidArgumentValue: …', kind: 'argument' },
];

/** One output line: `fd` 1 is stdout, 2 is stderr. */
export interface Line {
  fd: 1 | 2;
  text: string;
}

export interface RunOutput {
  lines: Line[];
  exit: number;
  /** The failed statement's class, when one failed. */
  error: ErrorClass | null;
  /** What this pane could not reproduce for this run, in words. */
  gaps: string[];
}

export interface RunInput {
  /** One envelope per statement run (the engine stops after the first error): its JSON text, or readEnvelope's result when the caller parsed it once already. */
  envelopes: readonly (string | Envelope)[];
  /** How many statements the script holds (splitStatements). */
  statements: number;
  mode: Mode;
  /** The row cap, or null for none. */
  cap: number | null;
}

/** What relate prints for a run, in one mode: stdout and stderr lines in the order it writes them, and the exit code. */
export function renderRun(input: RunInput, facts: TerminalFacts): RunOutput {
  const lines: Line[] = [];
  const gaps: string[] = [];
  const json = input.mode === 'envelope' || input.mode === 'jsonl';
  for (const [i, given] of input.envelopes.entries()) {
    const env = typeof given === 'string' ? readEnvelope(given) : given;
    if (env.error !== null) {
      const cls = classifyError(env.error, facts);
      const differs = ENGINE_DIFFERENCES.find((d) => new RegExp(d.pattern).test(env.error!));
      if (differs) gaps.push(`the engine in this page words this error differently from the relate ${facts.version} binary, which prints "${differs.binary}" with kind ${differs.kind}; the message and kind shown are the engine's`);
      const progress = input.statements > 1 ? { statement: i + 1, statements: input.statements } : null;
      for (const l of errorStderr(env.error)) lines.push({ fd: 2, text: l });
      if (progress) lines.push({ fd: 2, text: progressLine(progress) });
      if (json) lines.push({ fd: 1, text: errorObject(env.error, cls, progress) });
      return { lines, exit: cls.exit, error: cls, gaps };
    }
    if (env.hasPlan) {
      gaps.push('relate prints an EXPLAIN or PROFILE plan in its own Neo4j-shaped form, which this pane does not draw');
      continue;
    }
    const total = env.columns.length ? env.rows.length : 0;
    const rows = input.cap !== null && total > input.cap ? env.rows.slice(0, input.cap) : env.rows;
    if (rows.length < total) {
      lines.push({ fd: 2, text: facts.capWarning.replace('{kept}', String(rows.length)).replace('{total}', String(total)) });
    }
    const out =
      input.mode === 'table' ? renderTable(env, rows)
      : input.mode === 'envelope' ? renderEnvelope(env, rows, total)
      : input.mode === 'jsonl' ? renderJsonl(env, rows, total)
      : renderToon(env, rows, total);
    for (const l of out) lines.push({ fd: 1, text: l });
  }
  return { lines, exit: 0, error: null, gaps };
}

// ---------------------------------------------------------------- the command line

/** A statement quoted for a POSIX shell the way the docs write commands: single quotes, double quotes when it holds one. */
export function shellQuote(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!/["$`\\]/.test(s)) return `"${s}"`;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The command the pane shows: always `--read-only` (the docs' safe default), with the harness variable when the run plays an agent harness. */
export function commandLine(statement: string, mode: Mode, harness: string | null): string {
  return `${harness ? `${harness}=1 ` : ''}relate --read-only --mode ${mode} ${shellQuote(statement)}`;
}

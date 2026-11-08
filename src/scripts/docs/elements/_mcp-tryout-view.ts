// DOM helpers shared by the `:::mcp-tryout` and `:::agent-trace` modules: the
// calls their static forms carry, what the static form recorded for each,
// and the reply as an agent reads it (rows, counters, the schema's labels).
// A `_` helper, so the element loader never mounts it; each module that
// imports it bundles it into its lazy chunk.

import { requestParameters, type Call, type Outcome } from '../../../lib/docs/elements/_mcp-tryout-protocol.ts';
import { formatMs } from '../../../lib/docs/elements/_wording.ts';

/** Rows a live table shows before it says how many more there are: a result on the main thread stays small. */
export const MAX_TABLE_ROWS = 200;
/** Characters of JSON text a block shows before it says how long the rest is. The reply itself stays exact. */
export const MAX_TEXT_CHARS = 20000;

/** An element with a class, attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

/** The text a static form's code block holds (the page keeps a fence's text in a hidden textarea beside it). */
const blockText = (block: Element) => (block.querySelector('textarea')?.value ?? block.querySelector('code')?.textContent ?? '').trim();

/** Whether `el` opens a call or a step in a static form: a paragraph that starts in bold. */
const isIntro = (el: Element | null) => !!el && el.tagName === 'P' && el.firstChild?.nodeName === 'STRONG';

export interface StaticCall {
  call: Call;
  /** The paragraph before the request. */
  intro: HTMLElement | null;
  /** The request line as recorded. */
  request: string;
  /** The reply line as recorded (timings as `<ms>`), when the form shows one. */
  reply: string | null;
  /** What follows the request up to the next call: the reply block and what an agent reads in it. */
  after: Element[];
}

/**
 * The `tools/call` requests in a static form, in order, with what the form
 * recorded for each. The build writes each request as a one-line JSON fence
 * (src/lib/docs/elements/), so its parameters are read from that line as
 * written: a float such as `0.0` reaches the engine as recorded.
 */
export function staticCalls(form: HTMLElement | null): StaticCall[] {
  const out: StaticCall[] = [];
  for (const block of form?.querySelectorAll<HTMLElement>('.code-block') ?? []) {
    const text = blockText(block);
    let msg: { method?: string; params?: { name: Call['tool']; arguments?: Record<string, unknown> } };
    try {
      msg = JSON.parse(text);
    } catch {
      continue; // not JSON: a recorded command or its output
    }
    if (msg.method !== 'tools/call' || !msg.params) continue;
    const prev = block.previousElementSibling;
    const intro = prev instanceof HTMLElement && prev.tagName === 'P' ? prev : null;
    const after: Element[] = [];
    for (let el = block.nextElementSibling; el && !isIntro(el); el = el.nextElementSibling) after.push(el);
    const replyBlock = after.find((el) => el.classList.contains('code-block') && /^\{"jsonrpc":"2\.0","id":[0-9]+,"result"/.test(blockText(el)));
    const call: Call = { tool: msg.params.name, arguments: msg.params.arguments ?? {} };
    const raw = requestParameters(text);
    if (raw !== undefined) call.parametersText = raw;
    out.push({ call, intro, request: text, reply: replyBlock ? blockText(replyBlock) : null, after });
  }
  return out;
}

/** Copies of a static form's nodes for the live pane, without ids (an id may appear once on a page). */
export function cloned(nodes: Element[]): Element[] {
  return nodes.map((n) => {
    const c = n.cloneNode(true) as Element;
    c.removeAttribute('id');
    for (const el of c.querySelectorAll('[id]')) el.removeAttribute('id');
    return c;
  });
}

/** "parse 0.2, plan <0.1, execute 0.6 ms": the executed statement's own phases, printed the way every element prints a duration. */
export function split(env: Record<string, unknown> | null): string {
  if (!env) return '';
  return `parse ${formatMs(env.parse_ms)}, plan ${formatMs(env.plan_ms)}, execute ${formatMs(env.execute_ms)} ms`;
}

const valueText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** A table with a caption, scrolled sideways inside its own box on a narrow screen; at most MAX_TABLE_ROWS rows, then a line saying how many more. */
export function table(caption: string, columns: string[], rows: unknown[][]): HTMLElement {
  const t = h('table', {}, h('caption', { text: caption }));
  const head = t.createTHead().insertRow();
  for (const c of columns) head.append(h('th', { scope: 'col', text: c }));
  const body = t.createTBody();
  for (const r of rows.slice(0, MAX_TABLE_ROWS)) {
    const tr = body.insertRow();
    for (const v of r) tr.append(h('td', { text: valueText(v) }));
  }
  const box = h('div', { class: 'mcp-table' }, t);
  if (rows.length > MAX_TABLE_ROWS) box.append(h('p', { class: 'mcp-more', text: `${rows.length - MAX_TABLE_ROWS} more rows are in the reply and not shown here.` }));
  return box;
}

const COUNTERS = ['nodes_created', 'nodes_deleted', 'relationships_created', 'relationships_deleted', 'properties_set', 'labels_added', 'labels_removed', 'indexes_added', 'indexes_removed', 'constraints_added', 'constraints_removed'];

/** "nodes_created 1, properties_set 2", or that no counter moved. */
export function counters(stats: unknown): string {
  const s = (stats ?? {}) as Record<string, number>;
  const moved = COUNTERS.filter((k) => Number(s[k] ?? 0) !== 0).map((k) => `${k} ${s[k]}`);
  return moved.length ? moved.join(', ') : 'no counter moved';
}

/** What the agent reads in a reply: the rows, the counters, the schema's labels, or the tool error. */
export function decoded(call: Call, out: Outcome): HTMLElement {
  if (out.source === 'not-sent') return h('p', { text: 'Not sent.' });
  if (out.isError) return h('p', { class: 'mcp-error' }, 'Tool error: ', h('code', { text: out.text }));
  if (call.tool === 'get_schema') {
    const labels = Object.entries(out.schema ?? {}) as [string, { count: number; properties?: Record<string, { type: string }>; relationships?: Record<string, { labels?: string[] }> }][];
    if (!labels.length) return h('p', { text: 'The schema map is empty: the database holds no labels.' });
    return table(
      'The schema map, by label',
      ['Label', 'Nodes', 'Properties', 'Relationships out'],
      labels.map(([label, e]) => [
        label,
        e.count,
        Object.entries(e.properties ?? {}).map(([k, v]) => `${k} (${v.type})`).join(', ') || '-',
        Object.entries(e.relationships ?? {}).map(([t, r]) => `${t} to ${(r.labels ?? []).join(', ')}`).join('; ') || '-',
      ]),
    );
  }
  const env = out.envelope as { columns: string[]; rows: Record<string, unknown>[]; stats: unknown } | null;
  if (!env) return h('p');
  if (call.tool === 'write_cypher') return h('p', { text: `Counters: ${counters(env.stats)}. rows is empty: write_cypher returns counters.` });
  if (!env.rows.length) return h('p', { text: `No rows; the columns are ${env.columns.join(', ') || 'none'}.` });
  return table(`${env.rows.length} ${env.rows.length === 1 ? 'row' : 'rows'}`, env.columns, env.rows.map((r) => env.columns.map((c) => r[c])));
}

/** JSON text for a pre block: whole up to MAX_TEXT_CHARS, else that much and a note with the full length. */
function shown(text: string): { text: string; note: string | null } {
  if (text.length <= MAX_TEXT_CHARS) return { text, note: null };
  return { text: text.slice(0, MAX_TEXT_CHARS), note: `The first ${MAX_TEXT_CHARS} of ${text.length} characters are shown.` };
}

/** A labelled, sideways-scrolling block of JSON text (dark in both themes, like every code block). `kind` marks it for the browser cases (`request`, `reply`). */
export function jsonBlock(label: string, text: string, kind = ''): HTMLElement {
  const s = shown(text);
  const pre = h('pre', { class: 'mcp-json', tabindex: '0', 'aria-label': label }, h('code', { text: s.text }));
  if (kind) pre.dataset.kind = kind;
  if (s.note) pre.dataset.truncated = 'true';
  const block = h('div', { class: 'mcp-block' }, h('p', { class: 'mcp-label', text: label }), pre);
  if (s.note) block.append(h('p', { class: 'mcp-more', text: s.note }));
  return block;
}

/** A collapsed block holding `content[0].text` decoded and indented. */
export function decodedText(text: string): HTMLElement {
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    /* shown as sent */
  }
  const s = shown(pretty);
  const details = h('details', { class: 'mcp-text' }, h('summary', { text: 'content[0].text, decoded' }), h('pre', { class: 'mcp-json', tabindex: '0' }, h('code', { text: s.text })));
  if (s.note) details.append(h('p', { class: 'mcp-more', text: s.note }));
  return details;
}

/** A link inside a sentence. */
export const link = (href: string, text: string) => h('a', { href, text });

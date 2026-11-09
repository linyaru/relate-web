// `:::mcp-tryout` in the browser (the build side, and what the static form
// holds, are in src/lib/docs/elements/mcp-tryout.ts). Each call from the
// static form becomes a button with its arguments editable, and shows the
// recorded request and reply until it is pressed; a press answers the
// `tools/call` on the page's database through the shared protocol
// (src/lib/docs/elements/_mcp-tryout-protocol.ts: EXPLAIN, the read/write
// gate, the run, the reply the server builds) and shows the request, the
// reply and what an agent reads in it. "Serve read-only" lists the tools a
// `--read-only` server lists: `write_cypher` then answers with the server's
// recorded tool error, and beside it the engine's own refusal of the same
// write on a read-only database (`page.runReadOnly`), each labelled for what
// it is.

import type { ElementContext } from '../element-api.ts';
import { callTool, ENGINE_READ_ONLY, listedTools, type Call, type Outcome, type RunScript } from '../../../lib/docs/elements/_mcp-tryout-protocol.ts';
import { liveLine, recordedLine, versions } from '../../../lib/docs/elements/_wording.ts';
import { cloned, decoded, decodedText, h, jsonBlock, link, split, staticCalls, type StaticCall } from './_mcp-tryout-view.ts';
import styles from './mcp-tryout.css?inline';

const DESCRIPTIONS: Record<Call['tool'], string> = {
  get_schema: 'Labels, property types and relationship types, sampled.',
  read_cypher: 'One read-only statement; a write or schema statement is refused.',
  write_cypher: 'One writing statement; the reply carries counters, not rows.',
};

const ERRORS = '/docs/reference/errors';

interface Block {
  call: Call;
  section: HTMLElement;
  send: HTMLButtonElement;
  flag: HTMLElement;
  args: () => { call: Call } | { problem: string };
  out: HTMLElement;
  said: HTMLElement;
}

/** The arguments editor for one call: the statement and its parameters (kept as the JSON text typed), or get_schema's sample size. */
function editor(call: Call, n: number): { fields: HTMLElement; read: Block['args'] } {
  const id = (k: string) => `mcp-${n}-${k}-${Math.random().toString(36).slice(2, 7)}`;
  if (call.tool === 'get_schema') {
    const input = h('input', { type: 'number', step: '1', min: '-1', id: id('sample'), inputmode: 'numeric', placeholder: 'default (1000)' });
    if (call.arguments.sample_size !== undefined) input.value = String(call.arguments.sample_size);
    const fields = h('div', { class: 'mcp-args' }, h('label', { for: input.id, text: 'sample_size' }), input);
    return {
      fields,
      read: () => ({ call: { tool: call.tool, arguments: input.value.trim() === '' ? {} : { sample_size: Number(input.value) } } }),
    };
  }
  const statement = h('textarea', { id: id('statement'), rows: String(Math.min(6, String(call.arguments.statement ?? '').split('\n').length + 1)), spellcheck: 'false', autocapitalize: 'off' });
  statement.value = String(call.arguments.statement ?? '');
  const params = h('textarea', { id: id('params'), rows: '2', spellcheck: 'false', autocapitalize: 'off', placeholder: '{}' });
  if (call.arguments.parameters !== undefined) params.value = call.parametersText ?? JSON.stringify(call.arguments.parameters);
  const fields = h(
    'div',
    { class: 'mcp-args' },
    h('label', { for: statement.id, text: 'statement' }),
    statement,
    h('label', { for: params.id, text: 'parameters (JSON)' }),
    params,
  );
  return {
    fields,
    read: () => {
      const next: Call = { tool: call.tool, arguments: { statement: statement.value } };
      const text = params.value.trim();
      if (text) {
        try {
          next.arguments.parameters = JSON.parse(text);
        } catch {
          return { problem: 'parameters is not JSON, so a host could not send it; the page sent nothing.' };
        }
        // The typed text goes to the engine and into the request, so 1.0 stays a float.
        next.parametersText = text;
      }
      return { call: next };
    },
  };
}

/** The version the static form's recorded server run names ("recorded from relate 0.16.1"), or null. */
function recordedVersion(form: HTMLElement | null): string | null {
  return /recorded from relate (\d+\.\d+\.\d+)/.exec(form?.textContent ?? '')?.[1] ?? null;
}

/** What the gate could not read the way the server reads it, when a refusal rests on that. */
function gateCaveat(out: Outcome): string {
  if (!out.gate) return '';
  const parts: string[] = [];
  if (out.gate.unknown.length) parts.push(`the plan holds ${out.gate.unknown.join(', ')}, an operator this page does not know, so it counts as a write here; the server reads its planner's own query type and may run the statement`);
  if (out.gate.conditional) parts.push('the plan does not show a WHEN/ELSE\'s branches, so the page counts it as a write; the server looks inside and runs a WHEN whose branches only read');
  return ` Here ${parts.join('; and ')}.`;
}

/** What the status line says about a reply: its numbers, and where it came from. */
function said(call: Call, out: Outcome, version: string | null, liveVersion: string | null): (Node | string)[] {
  switch (out.source) {
    case 'not-sent':
      return ['Not sent: one statement per call. The server answers a second statement with a syntax error (', link('/docs/reference/server/mcp#limits', 'Limits'), '), and the engine in this tab would run it as a second statement, so the page does not send it.'];
    case 'recorded':
      return [
        `${recordedLine(version)} The tool error text is the server's (relate serve --mcp stdio --read-only, which does not list write_cypher); the reply line around it carries this call's id. The engine is not asked. `,
        link(`${ERRORS}#mcp-unknown-tool`, 'Errors reference'),
        '.',
      ];
    case 'refused':
      return [
        'Refused before any statement reached the engine: the arguments do not fit the tool\'s input schema, so the page answers with the server\'s invalid-params text instead of running anything. The MCP server reference lists the texts the server was recorded answering: ',
        link('/docs/reference/server/mcp#errors-and-refusals', 'Errors and refusals'),
        '.',
      ];
    case 'classified':
      return [
        `Refused before it ran: this tab's EXPLAIN reads as query type ${out.queryType}, and the text is the server's pinned refusal. ${recordedLine(version)}${gateCaveat(out)} `,
        link(`${ERRORS}#${call.tool === 'read_cypher' ? 'mcp-read-query-only' : 'mcp-write-query-only'}`, 'Errors reference'),
        '.',
      ];
    default: {
      const env = out.envelope as { rows: unknown[]; elapsed_ms?: number } | null;
      const from = liveLine({ version: liveVersion, ms: env?.elapsed_ms });
      if (out.isError) return [`${from} A tool error from the engine: the statement failed, and the reply is built the way relate serve builds it, Error: and the engine's message.`];
      if (call.tool === 'get_schema') {
        const n = Object.keys(out.schema ?? {}).length;
        return [`${liveLine({ version: liveVersion })} ${n} ${n === 1 ? 'label' : 'labels'}, from the engine's answers to the queries the server runs for get_schema.`];
      }
      const notes = ((JSON.parse(out.text) as { notifications?: unknown[] }).notifications ?? []).length;
      const what = call.tool === 'read_cypher' ? `${env?.rows.length ?? 0} ${env?.rows.length === 1 ? 'row' : 'rows'}` : 'Counters';
      return [`${from} ${what}, ${notes} ${notes === 1 ? 'notification' : 'notifications'} (${split(out.envelope)}). Built from the engine's envelopes, the way relate serve builds the reply.`];
    }
  }
}

/** The recorded request and reply, labelled as the recording, until the reader sends the call. */
function recordedView(found: StaticCall): HTMLElement[] {
  const parts: HTMLElement[] = [jsonBlock('Request, as recorded', found.request, 'request')];
  if (found.reply) parts.push(jsonBlock('Reply, as recorded when the page was built (timings as <ms>)', found.reply, 'reply'));
  const rest = found.after.filter((el) => !el.classList.contains('code-block'));
  if (rest.length) parts.push(h('div', { class: 'mcp-recorded-decoded' }, ...cloned(rest)));
  return parts;
}

export async function mount(ctx: ElementContext) {
  const { page, live } = ctx;
  ctx.adoptStyles(styles);
  const found = staticCalls(ctx.staticForm);
  if (!found.length) throw new Error('mcp-tryout: no calls in the static form');
  const version = recordedVersion(ctx.staticForm);

  // A page whose every block opens the store --read-only starts the tryout read-only too.
  let readOnly = ctx.attrs.readonly === 'on';
  let seq = 0;
  const root = h('div', { class: 'mcp-tryout' });
  const listed = h('p', { class: 'mcp-listed' });
  const ro = h('button', { type: 'button', class: 'btn mcp-ro', 'aria-pressed': 'false', 'aria-label': 'Serve read-only: answer as relate serve --read-only does' }, 'Serve read-only ', h('span', { class: 'mcp-ro-state', text: 'off' }));
  root.append(h('div', { class: 'mcp-head' }, listed, ro));

  const showRecorded = (b: Block, f: StaticCall) => {
    b.out.replaceChildren(...recordedView(f));
    b.out.hidden = false;
    b.out.dataset.reply = 'recorded';
    b.said.textContent = `${recordedLine(versions(page).recorded)} ${b.call.tool} sends it to the page's database in this tab.`;
  };

  const blocks: Block[] = found.map((f, i) => {
    const call = f.call;
    const { fields, read } = editor(call, i);
    const send = h('button', { type: 'button', class: 'btn mcp-send', 'aria-label': `${call.tool}: send this call to the page's database` }, call.tool);
    const flag = h('span', { class: 'mcp-flag', hidden: '', text: 'not listed by a read-only server' });
    const out = h('div', { class: 'mcp-out' });
    const status = h('p', { class: 'mcp-said', role: 'status' });
    const section = h('section', { class: 'mcp-call', 'data-tool': call.tool }, h('div', { class: 'mcp-call-head' }, send, h('span', { class: 'mcp-desc', text: DESCRIPTIONS[call.tool] }), flag), fields, status, out);
    root.append(section);
    const b = { call, section, send, flag, args: read, out, said: status };
    showRecorded(b, f);
    return b;
  });

  root.append(
    h(
      'p',
      { class: 'mcp-note' },
      'Each reply is built in this tab from the engine\'s envelopes, the way relate serve --mcp builds it from the same engine; the refusal texts are the server\'s, recorded. Transport answers (HTTP 401, 403 and 415, the session handshake) are not emulated: ',
      link('/docs/reference/server/mcp#errors-and-refusals', 'MCP server reference'),
      '.',
    ),
  );

  const showListed = () => {
    listed.replaceChildren('tools/list: ', ...listedTools(readOnly).flatMap((t, i) => [i ? ', ' : '', h('code', { text: t })]));
    ro.setAttribute('aria-pressed', String(readOnly));
    ro.querySelector('.mcp-ro-state')!.textContent = readOnly ? 'on' : 'off';
    for (const b of blocks) b.flag.hidden = !(readOnly && b.call.tool === 'write_cypher');
  };
  showListed();
  ro.addEventListener('click', () => {
    readOnly = !readOnly;
    showListed();
  });

  const run: RunScript = async (code, params) => (await page.run(code, params)).text;

  /** The engine's own answer to the write on a read-only database: what the CLI and the clients report, not an MCP reply. */
  const engineRefusal = async (call: Call): Promise<HTMLElement> => {
    const params = call.arguments.parameters;
    const text = params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length ? (call.parametersText ?? JSON.stringify(params)) : null;
    const r = await page.runReadOnly(String(call.arguments.statement ?? ''), text);
    const p = h('p', { class: 'mcp-engine-ro' });
    if (r.error) {
      p.append(
        'Beneath the server, the engine refuses the write too. The same statement on an empty read-only database in this tab (new RelateDb(true)), live: ',
        h('code', { text: r.error }),
        ` The errors reference lists ${ENGINE_READ_ONLY.name} (GQL status ${ENGINE_READ_ONLY.code}) as what the CLI and the clients report for a write on a store opened --read-only (`,
        link(`${ERRORS}#${ENGINE_READ_ONLY.id}`, 'errors reference'),
        '); the MCP server answers before the engine sees the call.',
      );
    } else {
      p.append('On an empty read-only database in this tab (new RelateDb(true)) the statement ran without an error: it found nothing to change, so it wrote nothing.');
    }
    return p;
  };

  const send = async (b: Block) => {
    const args = b.args();
    if ('problem' in args) {
      b.said.textContent = args.problem;
      return;
    }
    const call = args.call;
    for (const x of blocks) x.send.disabled = true;
    b.said.textContent = 'Sending…';
    try {
      const out = await callTool(run, call, ++seq, { readOnly });
      const parts: HTMLElement[] = [jsonBlock('Request (what the host sends)', out.request, 'request')];
      if (out.reply) parts.push(jsonBlock('Reply (what the server answers)', out.reply, 'reply'), decoded(call, out));
      if (out.reply && !out.isError) parts.push(decodedText(out.text));
      if (out.source === 'recorded') parts.push(await engineRefusal(call));
      b.out.replaceChildren(...parts);
      b.out.hidden = false;
      b.out.dataset.reply = 'live';
      b.out.dataset.source = out.source;
      b.said.replaceChildren(...said(call, out, version, versions(page).live));
    } catch (err) {
      b.said.textContent = `Could not run: ${(err as Error).message}`;
    } finally {
      for (const x of blocks) x.send.disabled = false;
    }
  };

  for (const b of blocks) {
    b.send.addEventListener('click', () => void send(b));
    // Enter on the focused button sends once: the default (a click from the key press) is cancelled.
    b.send.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      if (!b.send.disabled) void send(b);
    });
  }
  // The database went (Reset, Stop, a crash): replies from before describe a database that is gone, so each call shows its recording again.
  const offReset = page.onReset(() => {
    blocks.forEach((b, i) => showRecorded(b, found[i]));
  });

  live.replaceChildren(root);
  ctx.showLive();
  return () => offReset();
}

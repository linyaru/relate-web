// `:::mcp-tryout{calls=<data block> readonly=on|off}`: relate's three MCP
// tools as buttons against the page's database (DOCS-PLAN.md §7.3, "MCP
// tryout"). The calls are the page's ```json data=<name> block,
// `{"calls": [{tool, arguments}]}`, in the order the element shows them.
// Its static form is each call's JSON-RPC request and the reply, answered at
// record time on a fresh database seeded with the page's cells by the same
// mapping the browser uses (_mcp-tryout-protocol.ts, checked against
// `relate serve --mcp` by src/lib/docs/mcp-tryout.test.ts), then the
// recorded run of a `--read-only` server answering `write_cypher`, quoted
// from errors.json as the binary printed it. `readonly=on` starts the live
// tryout as a read-only server, for a page whose every block opens the store
// `--read-only`.

import type { ElementInput, ElementSpec } from '../elements.ts';
import { callTool, listedTools, TOOLS, type Call } from './_mcp-tryout-protocol.ts';
import { callProblems, jsonFence, outcomeMarkdown, RECORD_INPUTS, recordedRun, seededDatabase, shownReply, withRawParameters } from './_mcp-tryout-record.ts';

const ATTRIBUTES = new Set(['id', 'calls', 'readonly']);

/** The calls the data block names, each with its parameters' own text, or why they cannot be read. */
export function readCalls(input: ElementInput): { calls: Call[] } | { problem: string } {
  const name = input.attributes.calls;
  if (!name) return { problem: 'names its calls with `calls=<name>`, a ```json data=<name> block on the page' };
  const text = input.dataBlocks[name];
  if (text === undefined) return { problem: `\`calls=${name}\` names no \`json data=${name}\` block on the page` };
  let data: { calls?: unknown };
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { problem: `\`json data=${name}\` is not JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(data.calls) || !data.calls.length) return { problem: `\`json data=${name}\` holds \`{"calls": [{"tool", "arguments"}, …]}\`` };
  return { calls: withRawParameters(data.calls as Call[], text, 'calls') };
}

export default {
  // Plain words, no code spans: the twin prints this sentence as text.
  live: 'each call is a button that sends its `tools/call` request to the page\'s database in your browser and shows the request and the reply, built from the engine\'s result the way `relate serve --mcp` builds it, with the statement and parameters editable; "Serve read-only" drops `write_cypher` from the tool list, as `--read-only` does, and shows the engine\'s own refusal of the write on a read-only database beside the server\'s recorded answer.',
  inputs: RECORD_INPUTS,
  validate(input) {
    const out: string[] = [];
    for (const k of Object.keys(input.attributes)) if (!ATTRIBUTES.has(k)) out.push(`takes \`calls=<name>\`, \`readonly=on|off\` and \`id\`, not \`${k}\``);
    const ro = input.attributes.readonly;
    if (ro !== undefined && ro !== 'on' && ro !== 'off') out.push(`\`readonly\` is \`on\` or \`off\`, not \`${ro}\``);
    const read = readCalls(input);
    if ('problem' in read) return [...out, read.problem];
    if (read.calls.length > 6) out.push('shows at most six calls');
    read.calls.forEach((c, i) => out.push(...callProblems(c, `call ${i + 1}`)));
    for (const t of TOOLS) if (!read.calls.some((c) => c?.tool === t)) out.push(`shows all three tools, and no call is \`${t}\``);
    if (input.children.trim()) out.push('takes no children: its static form is the recorded calls; put prose before it');
    return out;
  },
  async staticForm(input) {
    const read = readCalls(input);
    if ('problem' in read) throw new Error(read.problem);
    const { version, run } = recordedRun(input, 'mcp-unknown-tool');
    const db = await seededDatabase(input, null);
    const parts: string[] = [
      `These calls ran when the page was recorded, on a database that holds what this page's cells write, through the same mapping the live tryout uses. Timings show as \`<ms>\`; live, each reply carries the timings of its own run. The server lists ${listedTools(false).map((t) => `\`${t}\``).join(', ')}.`,
    ];
    if (input.attributes.readonly === 'on') {
      parts.push('Live, the tryout starts as a server started `--read-only`, as every configuration on this page opens the store; with **Serve read-only** off it lists `write_cypher` as well.');
    }
    try {
      let id = 0;
      for (const call of read.calls) {
        const out = await callTool(db.run, call, ++id, { readOnly: false });
        const head =
          out.source === 'classified'
            ? `**\`${call.tool}\`** with a ${call.tool === 'read_cypher' ? 'write' : 'read'}: the plan's operators read as query type \`${out.queryType}\`, so the server refuses the call before it runs. The request a host sends, then the reply:`
            : `**\`${call.tool}\`**: the request a host sends, then the reply.`;
        parts.push(head, jsonFence(out.request), jsonFence(shownReply(out)), outcomeMarkdown(call, out));
      }
    } finally {
      db.free();
    }
    parts.push(
      `**\`write_cypher\` on a server started \`--read-only\`**: it lists only ${listedTools(true).map((t) => `\`${t}\``).join(' and ')}, and answers a \`write_cypher\` call with a tool error before the engine sees the statement. This run is recorded from relate ${version} (errors.json \`mcp-unknown-tool\`, replayed against the binary by \`docs:cli-check\`); the page quotes it as the binary printed it:`,
      '```bash\n' + run.command.trim() + '\n```',
      '```text\n' + run.stdout.trim() + '\n```',
      'Transport answers (HTTP 401, 403 and 415, the body cap, the header deadline) are not part of the tryout; the [MCP server reference](/docs/reference/server/mcp#errors-and-refusals) lists them.',
    );
    return { text: parts.join('\n\n') };
  },
} satisfies ElementSpec;

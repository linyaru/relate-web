// Record-time half of `:::mcp-tryout` and `:::agent-trace` (Node only):
// seed a fresh in-memory database on public/wasm with the page's cells, as
// the reader's browser would, answer tool calls on it with the shared
// protocol (_mcp-tryout-protocol.ts), and write what came back as markdown.
// The browser modules never import this file.

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import { markdownTable } from '../element-kit.ts';
import type { ElementInput } from '../elements.ts';
import { maskTimings, rawParameters, TOOLS, type Call, type Outcome, type RunScript } from './_mcp-tryout-protocol.ts';

/** Files the static forms read besides the page: the engine they ran on, and the recorded server answers. */
export const RECORD_INPUTS = ['public/wasm/relate_bg.wasm', 'src/content/docs/_data/errors.json'];

interface Recorded {
  command: string;
  stdout: string;
}

/**
 * errors.json's binary version (`verified`) and the recorded run of one
 * entry (`relate serve --mcp stdio --read-only` answering `write_cypher`, for
 * `mcp-unknown-tool`), replayed against the binary by docs:cli-check. The
 * static forms quote the run as recorded and name the version, so a refresh
 * of errors.json changes them on the next record without a code edit.
 */
export function recordedRun(input: ElementInput, id: string): { version: string; run: Recorded } {
  // The repository root, from the page's own path (the build bundles this
  // file elsewhere, so import.meta.url does not lead there).
  const marker = `${sep}src${sep}content${sep}docs${sep}`;
  const at = input.page.file.lastIndexOf(marker);
  const root = at >= 0 ? input.page.file.slice(0, at) : process.cwd();
  const errors = JSON.parse(readFileSync(join(root, 'src/content/docs/_data/errors.json'), 'utf8')) as {
    verified: string;
    [surface: string]: unknown;
  };
  for (const list of Object.values(errors)) {
    if (!Array.isArray(list)) continue;
    const entry = list.find((e: { id?: string }) => e?.id === id) as { recorded?: Recorded | Recorded[] } | undefined;
    if (!entry) continue;
    const run = Array.isArray(entry.recorded) ? entry.recorded[0] : entry.recorded;
    if (!run?.command || !run.stdout) throw new Error(`errors.json \`${id}\` has no recorded run`);
    return { version: errors.verified, run };
  }
  throw new Error(`errors.json has no entry \`${id}\``);
}

/**
 * The calls (or steps) of a `{"<key>": [...]}` data block, each with its
 * parameters' own text (`parametersText`), so a float such as `0.0` reaches
 * the engine and the request line as written.
 */
export function withRawParameters<T extends Call>(items: T[], blockText: string, key: string): T[] {
  const raw = rawParameters(blockText, key);
  return items.map((item, i) => (raw[i] === undefined || !item || typeof item !== 'object' ? item : { ...item, parametersText: raw[i] }));
}

interface Db {
  executeScript(script: string, params?: string | null): string[];
  free(): void;
}

/**
 * A fresh database with the page's cells run in order, up to and including
 * `upTo` (every cell when null). Throws when a cell goes other than the page
 * says, since the forms would then describe a database the reader never has.
 */
export async function seededDatabase(input: ElementInput, upTo: string | null): Promise<{ run: RunScript; free: () => void }> {
  const { loadEngine } = await import('../../cookbook/run.ts');
  const engine = await loadEngine();
  const db = new (engine.RelateDb as unknown as new () => Db)();
  const end = upTo === null ? input.cells.length - 1 : input.cells.findIndex((c) => c.id === upTo);
  if (end < 0 && input.cells.length && upTo !== null) throw new Error(`the page has no cell \`${upTo}\``);
  for (const cell of input.cells.slice(0, end + 1)) {
    const params = cell.params ? (input.dataBlocks[cell.params] ?? null) : null;
    const envelopes = db.executeScript(cell.code, params);
    const failed = envelopes.map((e) => (JSON.parse(e) as { error?: string | null }).error).find(Boolean);
    if (failed && !cell.expectError) throw new Error(`cell \`${cell.id}\` failed at record time: ${failed}`);
  }
  return { run: async (code, params) => db.executeScript(code, params), free: () => db.free() };
}

/** A JSON value in a table cell: strings as written, the rest as JSON. */
export const cellText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** A one-line JSON fence. */
export const jsonFence = (line: string) => '```json\n' + line + '\n```';

const COUNTERS = ['nodes_created', 'nodes_deleted', 'relationships_created', 'relationships_deleted', 'properties_set', 'labels_added', 'labels_removed', 'indexes_added', 'indexes_removed', 'constraints_added', 'constraints_removed'];

/** "nodes_created 1, properties_set 2": the counters that moved, or that none did. */
export function counters(stats: Record<string, unknown> | null | undefined): string {
  const moved = COUNTERS.filter((k) => Number(stats?.[k] ?? 0) !== 0).map((k) => `\`${k}\` ${stats![k]}`);
  return moved.length ? moved.join(', ') : 'no counter moved';
}

/** What the agent reads in a reply, as markdown: the rows, the counters, the schema's labels, or the tool error. */
export function outcomeMarkdown(call: Call, out: Outcome): string {
  if (out.source === 'not-sent') return 'Not sent: the call holds a second statement.';
  if (out.isError) return `Tool error: \`${out.text}\`.`;
  if (call.tool === 'get_schema') {
    const labels = Object.entries(out.schema ?? {});
    if (!labels.length) return 'The schema map is empty: the database holds no labels.';
    return markdownTable(
      ['Label', 'Nodes', 'Properties', 'Relationships out'],
      labels.map(([label, e]) => {
        const entry = e as { count: number; properties?: Record<string, { type: string }>; relationships?: Record<string, { labels?: string[] }> };
        const props = Object.entries(entry.properties ?? {}).map(([k, v]) => `${k} (${v.type})`).join(', ') || '-';
        const rels = Object.entries(entry.relationships ?? {}).map(([t, r]) => `${t} to ${(r.labels ?? []).join(', ')}`).join('; ') || '-';
        return [label, entry.count, props, rels];
      }),
    );
  }
  const env = out.envelope as { columns: string[]; rows: Record<string, unknown>[]; stats: Record<string, unknown> } | null;
  if (!env) return '';
  if (call.tool === 'write_cypher') return `Counters: ${counters(env.stats)}; \`rows\` is empty, as \`write_cypher\` returns counters.`;
  if (!env.rows.length) return `No rows; the columns are ${env.columns.map((c) => `\`${c}\``).join(', ') || 'none'}.`;
  return markdownTable(env.columns, env.rows.map((r) => env.columns.map((c) => cellText(r[c]))));
}

/** The reply as the static form shows it: timings as `<ms>`, since they change on every run. */
export const shownReply = (out: Outcome) => maskTimings(out.reply);

/** Problems with one call's shape: the tool, and the arguments its input schema takes. */
export function callProblems(call: Call, where: string): string[] {
  const out: string[] = [];
  if (!call || typeof call !== 'object') return [`${where} is not an object`];
  if (!TOOLS.includes(call.tool)) return [`${where}: \`tool\` is one of ${TOOLS.join(', ')}`];
  const args = call.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return [`${where}: \`arguments\` is an object`];
  const allowed = call.tool === 'get_schema' ? ['sample_size'] : ['statement', 'parameters'];
  for (const k of Object.keys(args)) if (!allowed.includes(k)) out.push(`${where}: \`${call.tool}\` takes ${allowed.map((a) => `\`${a}\``).join(' and ')}, not \`${k}\``);
  if (call.tool === 'get_schema') {
    if (args.sample_size !== undefined && !Number.isInteger(args.sample_size)) out.push(`${where}: \`sample_size\` is an integer`);
  } else {
    if (typeof args.statement !== 'string' || !args.statement.trim()) out.push(`${where}: \`statement\` is the Cypher statement, a string`);
    const p = args.parameters;
    if (p !== undefined && (typeof p !== 'object' || p === null || Array.isArray(p))) out.push(`${where}: \`parameters\` is an object`);
  }
  return out;
}


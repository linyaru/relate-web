// <Errors />: the errors tables, generated from src/content/docs/_data/errors.json
// (DOCS-PLAN.md §2 `reference/errors`, README "Facts and data files"). One
// table model, rendered twice: Errors.astro turns it into HTML tables (every
// row at its entry's stable id, so /docs/reference/errors/#<id> names an
// error), and `toMarkdown` into flat markdown tables for the twin, one row
// per entry, so an agent can grep a message.
//
// Props (literals): `surface` picks the table.
//   (none)           every error entry (cli, engine, http, bolt, mcp) in one table
//   "cli" | "engine" | "http" | "bolt" | "mcp"   that surface's errors
//   "gql-status"     the GQL status index: one row per status, linking its entries
//   "python"         the Python exception classes
//   "notifications"  the notifications EXPLAIN and PROFILE report
//
// Data rules carried through: `null` renders as "—" (the sources do not say,
// or it does not apply); a `disputed` entry is left out until the release
// binary settles it, so the page never states a fact two ways; messages are
// quoted character for character.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ComponentProps } from '../../lib/docs/constructs.ts';
import { DOCS_DIR, publishedIds } from '../../lib/docs/content.ts';
import { codeSpan, NONE, tableMarkdown, type Table } from '../../lib/docs/generated/table.ts';

export { codeSpan, type Table };

export const ERRORS_FILE = join(DOCS_DIR, '_data/errors.json');
export const ERROR_SURFACES = ['cli', 'engine', 'http', 'bolt', 'mcp'] as const;
export const TABLES = [...ERROR_SURFACES, 'gql-status', 'python', 'notifications'] as const;
export type TableName = (typeof TABLES)[number];

/** The page the anchors live on. */
export const ERRORS_PAGE = '/docs/reference/errors';

interface Reading {
  text: string;
}

export interface ErrorEntry {
  id: string;
  surface: string;
  code: string | null;
  kind: string | null;
  name?: string | null;
  exit_code: number | null;
  retryable: boolean | null;
  gql_status: string | null;
  neo4j_code: string | null;
  message: string | null;
  cause: string | null;
  remedy: string | null;
  python_class: string | null;
  http_status: number | null;
  jsonrpc_code?: number | null;
  severity?: string | null;
  note?: string | null;
  disputed?: boolean;
  readings?: Reading[];
}

interface PythonClass {
  id: string;
  class: string;
  alias?: string;
  parent: string;
  meaning: string;
}

interface Notification {
  id: string;
  gql_status: string | null;
  code?: string | null;
  name?: string | null;
  severity?: string | null;
  category?: string | null;
  title?: string | null;
  note?: string | null;
}

export interface ErrorsData {
  verified: string;
  cli: ErrorEntry[];
  engine: ErrorEntry[];
  http: ErrorEntry[];
  bolt: ErrorEntry[];
  mcp: ErrorEntry[];
  python: { hierarchy: PythonClass[]; attributes: string[]; disputed?: boolean; readings?: Reading[] };
  notifications: Notification[];
  gql_status_index: Record<string, string[]>;
}

let cached: ErrorsData | null = null;

/** The errors data file, read once per process. */
export function errorsData(): ErrorsData {
  cached ??= JSON.parse(readFileSync(ERRORS_FILE, 'utf8')) as ErrorsData;
  return cached;
}

const entryLink = (id: string) => `[${id}](${ERRORS_PAGE}#${id})`;
/** A prose cell: its text and notes, or the dash when there are none. */
const prose = (...parts: (string | null | undefined | false)[]) => {
  const kept = parts.filter((p): p is string => !!p);
  return kept.length ? kept : [NONE];
};
/** The entries the sources agree on; a disputed one waits for the release binary. */
const settled = (es: ErrorEntry[]) => es.filter((e) => !e.disputed);
const yesNo = (b: boolean | null) => (b === null ? NONE : b ? 'yes' : 'no');

function errorRow(e: ErrorEntry): { id: string; cells: string[][] } {
  const ident: string[] = [];
  if (e.code || e.kind) ident.push([e.code && `code ${codeSpan(e.code)}`, e.kind && `kind ${codeSpan(e.kind)}`].filter(Boolean).join(', '));
  if (e.name) ident.push(`name ${codeSpan(e.name)}`);
  if (e.severity) ident.push(`severity ${e.severity}`);
  if (e.gql_status) ident.push(`GQL status ${codeSpan(e.gql_status)}`);
  if (e.neo4j_code) ident.push(`Neo4j ${codeSpan(e.neo4j_code)}`);
  if (e.http_status !== null && e.http_status !== undefined) ident.push(`HTTP ${e.http_status}`);
  if (e.jsonrpc_code !== null && e.jsonrpc_code !== undefined) ident.push(`JSON-RPC ${e.jsonrpc_code}`);
  if (e.python_class) ident.push(`Python ${codeSpan(e.python_class)}`);
  return {
    id: e.id,
    cells: [
      [codeSpan(e.id), ...ident],
      [e.message ? codeSpan(e.message) : NONE],
      prose(e.cause, e.note),
      [e.remedy ?? NONE],
      [yesNo(e.retryable)],
      [e.exit_code === null ? NONE : `${e.exit_code}`],
    ],
  };
}

const ERROR_COLUMNS = ['Error', 'Message', 'Cause', 'Remedy', 'Retryable', 'Exit code'];

/** The `surface` prop, checked. */
export function tableOf(props: ComponentProps): TableName | null {
  const s = props.surface;
  if (s === undefined || s === null) return null;
  if (typeof s !== 'string' || !(TABLES as readonly string[]).includes(s)) {
    throw new Error(`<Errors surface=${JSON.stringify(s)}>: surface is one of ${TABLES.join(', ')}`);
  }
  return s as TableName;
}

/** The table `<Errors>` renders for `props`. */
export function table(props: ComponentProps): Table {
  const d = errorsData();
  const name = tableOf(props);
  if (name === null) {
    return { columns: ERROR_COLUMNS, rows: ERROR_SURFACES.flatMap((s) => settled(d[s])).map(errorRow), notes: [] };
  }
  switch (name) {
    case 'gql-status':
      return {
        columns: ['GQL status', 'Errors'],
        rows: Object.entries(d.gql_status_index)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([status, ids]) => ({ id: `gql-${status.toLowerCase()}`, cells: [[codeSpan(status)], ids.map(entryLink)] })),
        notes: [],
      };
    case 'python':
      return {
        columns: ['Class', 'Parent', 'Raised for'],
        rows: d.python.hierarchy.map((c) => ({
          id: c.id,
          cells: [[codeSpan(c.class), ...(c.alias ? [`alias ${codeSpan(c.alias)}`] : [])], [codeSpan(c.parent)], [c.meaning]],
        })),
        notes: [
          `Every exception carries the attributes ${d.python.attributes.map(codeSpan).join(', ')}.`,
        ],
      };
    case 'notifications':
      return {
        columns: ['Notification', 'GQL status', 'Code', 'Severity', 'Category', 'Title'],
        rows: d.notifications.map((n) => ({
          id: n.id,
          cells: [
            [codeSpan(n.id), ...(n.name ? [`name ${codeSpan(n.name)}`] : [])],
            [n.gql_status ? codeSpan(n.gql_status) : NONE],
            [n.code ? codeSpan(n.code) : NONE],
            [n.severity ?? NONE],
            [n.category ?? NONE],
            prose(n.title, n.note),
          ],
        })),
        notes: [],
      };
    default:
      return { columns: ERROR_COLUMNS, rows: settled(d[name]).map(errorRow), notes: [] };
  }
}

// ---------- The twin ----------

export function toMarkdown(props: ComponentProps): string {
  return tableMarkdown(table(props), publishedIds());
}

// <Flags />: the CLI flags table, generated from src/content/docs/_data/cli.json
// (`global_flags`, the query-run flags, and each command's `flags`;
// DOCS-PLAN.md §2 `reference/cli/flags`). One row per flag at its stable id
// (`#read-only`, `#serve-mcp`): the flag and its other spellings, its
// argument, its default, where it applies, the release that added it (when
// the data records it), and what it does.
//
// Props (literals): `command` picks the rows.
//   (none)       every flag: the query-run flags, then each command's
//   "query"      the query-run flags (the path-first form and `relate query`)
//   "<command>"  that command's own flags (`serve`, `clone`, …)
//
// cli.json is read fresh on every render. A `disputed` entry is left out
// until the release binary settles it.

import type { ComponentProps } from '../../lib/docs/constructs.ts';
import { publishedIds } from '../../lib/docs/content.ts';
import { cliData, ENV_PAGE, settled, type CliData, type CliFlag } from '../../lib/docs/generated/cli.ts';
import { codeSpan, NONE, tableMarkdown, type Table } from '../../lib/docs/generated/table.ts';
import { checkProps } from './exitcodes.ts';

const COLUMNS = ['Flag', 'Argument', 'Default', 'Scope', 'Since', 'Description'];
const QUERY = 'query';

/** Defaults that describe a state rather than name a value: prose, not code. */
const STATES = new Set(['unset', 'off', 'on', 'denied', 'unlimited', 'none']);

/** A default as a cell: a single token is a value, so code (`:memory:`, `300`, `full`); a state word or a phrase stays prose. */
export const defaultCell = (d: string | null | undefined) =>
  d === null || d === undefined || d === '' ? NONE : /\s/.test(d) || STATES.has(d) ? d : codeSpan(d);

function flagRow(f: CliFlag, scope: string, envIds: Map<string, string>): { id: string; cells: string[][] } {
  const names = [...f.flag.split(/\s*[/,]\s*/).map(codeSpan), ...(f.short ? [codeSpan(f.short)] : [])].join(', ');
  const description = [f.summary ?? NONE];
  if (f.env) {
    // The variable links its row in <EnvVars /> when cli.json lists it there.
    const id = envIds.get(f.env);
    description.push(`Environment: ${id ? `[${codeSpan(f.env)}](${ENV_PAGE}#${id})` : codeSpan(f.env)}.`);
  }
  return {
    id: f.id,
    cells: [
      [names, ...(f.aliases?.length ? [`also ${f.aliases.map(codeSpan).join(', ')}`] : [])],
      [f.value ? codeSpan(f.value) : NONE],
      [defaultCell(f.default)],
      [scope],
      [f.since ?? NONE],
      description,
    ],
  };
}

/** The flags `command` selects, each with its scope label. */
export function selectFlags(d: CliData, command: string | null): { flag: CliFlag; scope: string }[] {
  const query = settled(d.global_flags).map((flag) => ({ flag, scope: 'query run' }));
  const own = (c: CliData['commands'][number]) => settled(c.flags ?? []).map((flag) => ({ flag, scope: codeSpan(`relate ${c.word}`) }));
  if (command === null) return [...query, ...settled(d.commands).flatMap(own)];
  if (command === QUERY) return query;
  const c = d.commands.find((x) => x.id === command || x.word === command);
  if (!c) throw new Error(`<Flags command="${command}">: cli.json has no command "${command}" (known: ${QUERY}, ${d.commands.map((x) => x.word).filter((w) => w !== QUERY).join(', ')})`);
  if (!c.flags?.length) throw new Error(`<Flags command="${command}">: cli.json lists no flags of its own for \`relate ${c.word}\``);
  return own(c);
}

/** The table `<Flags />` renders for `props`. */
export function table(props: ComponentProps = {}): Table {
  checkProps('Flags', props, ['command']);
  const command = props.command ?? null;
  if (command !== null && typeof command !== 'string') throw new Error('<Flags command=…>: command is a string');
  const d = cliData();
  const envIds = new Map(settled(d.environment_variables).map((v) => [v.name, v.id]));
  const rows = selectFlags(d, command).map(({ flag, scope }) => flagRow(flag, scope, envIds));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) throw new Error(`<Flags>: two flags in cli.json share the id "${r.id}"; each is an anchor`);
    seen.add(r.id);
  }
  const notes = rows.some((r) => r.cells[4][0] === NONE) ? [`A ${NONE} under Since: the data does not record the release that added the flag.`] : [];
  return { columns: COLUMNS, rows, notes };
}

/** Every anchor the table can give the page it is on. */
export const anchors = (): string[] => table().rows.map((r) => r.id);

export function toMarkdown(props: ComponentProps): string {
  return tableMarkdown(table(props), publishedIds());
}

// <EnvVars />: the environment variables the CLI reads, generated from
// src/content/docs/_data/cli.json (`environment_variables`; DOCS-PLAN.md §2
// `reference/cli/environment-variables`). One row per variable at its stable
// id (`#env-relate-max-rows`): its name, its effect, its default, and the
// command, flag or subsystem that reads it (a flag links its row on the flags
// page).
//
// Props (literals): `usedBy` keeps the variables whose `used_by` mentions it
// (`usedBy="serve"`, `usedBy="usage metrics"`); none lists every variable.
//
// cli.json is read fresh on every render. A `disputed` entry is left out
// until the release binary settles it.

import type { ComponentProps } from '../../lib/docs/constructs.ts';
import { publishedIds } from '../../lib/docs/content.ts';
import { cliData, FLAGS_PAGE, settled, type CliData } from '../../lib/docs/generated/cli.ts';
import { codeSpan, NONE, tableMarkdown, type Table } from '../../lib/docs/generated/table.ts';
import { checkProps } from './exitcodes.ts';
import { defaultCell } from './flags.ts';

const COLUMNS = ['Variable', 'Effect', 'Default', 'Used by'];

/** One reader named in `used_by`, as a cell part: a flag links its row on the flags page, a command is code, anything else prose. */
function reader(part: string, d: CliData): string {
  const words = new Set(d.commands.map((c) => c.word));
  const m = /^(?:([a-z][\w-]*) )?(--[\w-]+)/.exec(part);
  if (m) {
    const [, word, flag] = m;
    const pool = word && words.has(word) ? (d.commands.find((c) => c.word === word)?.flags ?? []) : d.global_flags;
    const f = settled(pool).find((x) => x.flag.split(/\s*\/\s*/).includes(flag));
    const label = codeSpan(word && words.has(word) ? `relate ${part}` : part);
    return f ? `[${label}](${FLAGS_PAGE}#${f.id})` : label;
  }
  return words.has(part.split(' ')[0]) ? codeSpan(`relate ${part}`) : part;
}

/** The table `<EnvVars />` renders for `props`. */
export function table(props: ComponentProps = {}): Table {
  checkProps('EnvVars', props, ['usedBy']);
  const usedBy = props.usedBy ?? null;
  if (usedBy !== null && typeof usedBy !== 'string') throw new Error('<EnvVars usedBy=…>: usedBy is a string');
  const d = cliData();
  let vars = settled(d.environment_variables);
  if (usedBy !== null) {
    vars = vars.filter((v) => (v.used_by ?? '').toLowerCase().includes(usedBy.toLowerCase()));
    if (!vars.length) throw new Error(`<EnvVars usedBy="${usedBy}">: no variable in cli.json is used by "${usedBy}"`);
  }
  const rows = vars.map((v) => ({
    id: v.id,
    cells: [
      [codeSpan(v.name)],
      [v.summary ?? NONE],
      [defaultCell(v.default)],
      v.used_by ? [v.used_by.split(/,\s*/).map((p) => reader(p, d)).join(', ')] : [NONE],
    ],
  }));
  return { columns: COLUMNS, rows, notes: [] };
}

/** Every anchor the table can give the page it is on. */
export const anchors = (): string[] => table().rows.map((r) => r.id);

export function toMarkdown(props: ComponentProps): string {
  return tableMarkdown(table(props), publishedIds());
}

// <ExitCodes />: the CLI exit-code table, generated from
// src/content/docs/_data/cli.json (`exit_codes`) and the CLI entries of
// _data/errors.json (DOCS-PLAN.md §2 `reference/cli/exit-codes-and-errors`).
// One row per exit code at the stable anchor `#exit-<n>`: the code's class
// name (the error object's `code`), its meaning, the error kinds that exit
// with it (each linking its entry on the errors page), and whether a retry
// can succeed, from those entries' `retryable`.
//
// No props. Both files are read fresh on every render. A `disputed` entry is
// left out, so the page never states a fact two ways.

import { readFileSync } from 'node:fs';

import type { ComponentProps } from '../../lib/docs/constructs.ts';
import { publishedIds } from '../../lib/docs/content.ts';
import { cliData, settled } from '../../lib/docs/generated/cli.ts';
import { codeSpan, NONE, tableMarkdown, type Table } from '../../lib/docs/generated/table.ts';
import { ERRORS_FILE, ERRORS_PAGE, type ErrorEntry } from './errors.ts';

const COLUMNS = ['Exit code', 'Code', 'Meaning', 'Error kinds', 'Retry'];

/** A component's props, checked: it takes only `allowed`. */
export function checkProps(name: string, props: ComponentProps, allowed: string[]) {
  for (const key of Object.keys(props)) {
    if (!allowed.includes(key)) throw new Error(`<${name}>: unknown prop \`${key}\` (${allowed.length ? `takes ${allowed.join(', ')}` : 'takes no props'})`);
  }
}

/** The CLI error entries of errors.json the sources agree on, read now. */
function cliErrors(): ErrorEntry[] {
  const d = JSON.parse(readFileSync(ERRORS_FILE, 'utf8')) as { cli?: ErrorEntry[] };
  return (d.cli ?? []).filter((e) => !e.disputed);
}

/** `a`, `a and b`, `a, b and c`. */
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Whether a retry can succeed, from the `retryable` of the entries that exit with this code. */
function retryAdvice(entries: ErrorEntry[]): string {
  const known = entries.filter((e) => e.retryable !== null && e.retryable !== undefined);
  if (!known.length) return NONE;
  const yes = [...new Set(known.filter((e) => e.retryable).map((e) => e.kind ?? e.code ?? e.id))];
  const no = [...new Set(known.filter((e) => !e.retryable).map((e) => e.kind ?? e.code ?? e.id))].filter((k) => !yes.includes(k));
  if (!yes.length) return 'No: `retryable` is `false`.';
  const k = (xs: string[]) => `${xs.length > 1 ? 'kinds' : 'kind'} ${list(xs.map(codeSpan))}`;
  return `Only ${k(yes)} (\`retryable\` is \`true\`)${no.length ? `; ${k(no)} ${no.length > 1 ? 'are' : 'is'} not` : ''}.`;
}

/** The table `<ExitCodes />` renders. */
export function table(props: ComponentProps = {}): Table {
  checkProps('ExitCodes', props, []);
  const errors = cliErrors();
  const codes = settled(cliData().exit_codes);
  const rows = codes.map((x) => {
    const entries = errors.filter((e) => e.exit_code === x.exit);
    // Each kind once, linking the first entry that names it.
    const kinds = new Map<string, string>();
    for (const e of entries) if (e.kind && !kinds.has(e.kind)) kinds.set(e.kind, e.id);
    return {
      id: x.id,
      cells: [
        [codeSpan(String(x.exit))],
        [codeSpan(x.code)],
        [x.meaning],
        kinds.size ? [[...kinds].map(([kind, id]) => `[${codeSpan(kind)}](${ERRORS_PAGE}#${id})`).join(', ')] : [NONE],
        [x.reserved ? NONE : retryAdvice(entries)],
      ],
    };
  });
  const reserved = codes.filter((x) => x.reserved).map((x) => String(x.exit));
  const notes = [
    `The kinds and the retry advice come from the CLI entries of the [errors reference](${ERRORS_PAGE}); a query run's error object carries them as \`kind\` and \`retryable\`.`,
  ];
  if (reserved.length) notes.push(`Exit ${reserved.length > 1 ? 'codes' : 'code'} ${list(reserved)} ${reserved.length > 1 ? 'are' : 'is'} reserved and never produced.`);
  return { columns: COLUMNS, rows, notes };
}

/** Every anchor the table gives the page it is on. */
export const anchors = (): string[] => table().rows.map((r) => r.id);

export function toMarkdown(props: ComponentProps): string {
  return tableMarkdown(table(props), publishedIds());
}

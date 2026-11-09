// The CLI facts the generated reference tables read: src/content/docs/_data/cli.json.
// Read fresh on every call, never cached: the file is regenerated from the
// release binary, and the dev server shows an edit without a restart.
// Only the fields the tables use are typed; unknown fields are ignored.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS_DIR } from '../content.ts';

export const CLI_FILE = join(DOCS_DIR, '_data/cli.json');

/** Facts the sources disagree on carry `disputed: true`; a page states none of them until the release binary settles it. */
interface Settled {
  disputed?: boolean | null;
}

export interface CliFlag extends Settled {
  id: string;
  /** `--database`, or both spellings of a pair: `--safe / --no-safe`. */
  flag: string;
  short?: string | null;
  value?: string | null;
  default?: string | null;
  env?: string | null;
  summary?: string | null;
  aliases?: string[];
  /** The release that introduced the flag, when the data records it. */
  since?: string | null;
}

export interface CliCommand extends Settled {
  id: string;
  word: string;
  flags?: CliFlag[];
}

export interface CliEnvVar extends Settled {
  id: string;
  name: string;
  used_by?: string | null;
  default?: string | null;
  summary?: string | null;
}

export interface CliExitCode extends Settled {
  id: string;
  exit: number;
  code: string;
  meaning: string;
  reserved?: boolean;
}

export interface CliData {
  verified: string;
  commands: CliCommand[];
  global_flags: CliFlag[];
  environment_variables: CliEnvVar[];
  exit_codes: CliExitCode[];
}

/** _data/cli.json, read now. */
export function cliData(): CliData {
  const d = JSON.parse(readFileSync(CLI_FILE, 'utf8')) as Partial<CliData>;
  for (const key of ['commands', 'global_flags', 'environment_variables', 'exit_codes'] as const) {
    if (!Array.isArray(d[key])) throw new Error(`${CLI_FILE}: "${key}" is not a list`);
  }
  return d as CliData;
}

/** The entries the sources agree on. */
export const settled = <T extends Settled>(xs: T[]) => xs.filter((x) => !x.disputed);

/** The pages the generated CLI tables live on, for cross-links between them (a link renders as text until its page exists). */
export const FLAGS_PAGE = '/docs/reference/cli/flags';
/** <EnvVars /> sits on the flags page until a separate environment-variables page exists. */
export const ENV_PAGE = FLAGS_PAGE;
export const EXIT_CODES_PAGE = '/docs/reference/cli/exit-codes-and-errors';

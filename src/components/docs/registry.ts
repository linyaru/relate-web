// The JSX components docs pages may use, by the name a page writes
// (`<Install />`), each with its markdown rendering for the twin (ADR-0015:
// JSX is for generated and interactive things only; at most five in phase 1,
// and these are the five).
//
// A component is two files: `Name.astro` renders it on the page, and
// `name.ts` exports `toMarkdown(props): string`, the same content as markdown
// (plus whatever data both share). This registry holds only the `.ts` side,
// so the twin renderer and Node checks can import it; the docs page template
// (src/pages/docs/[...slug].astro) passes the `.astro` side to the MDX
// `<Content components={…} />`. Pages do not import components.
//
// Props arrive as literals (strings, numbers, booleans, JSON arrays and
// objects): `<Install os="linux" />`, `<Errors kind={["usage_error"]} />`.

import type { ToMarkdown } from '../../lib/docs/constructs.ts';
import { anchors as envVarAnchors, toMarkdown as envVars } from './envvars.ts';
import { table as errorsTable, TABLES, toMarkdown as errors } from './errors.ts';
import { anchors as exitCodeAnchors, toMarkdown as exitCodes } from './exitcodes.ts';
import { anchors as flagAnchors, toMarkdown as flags } from './flags.ts';
import { toMarkdown as install } from './install.ts';

export const COMPONENT_TWINS: Record<string, ToMarkdown> = {
  Install: install,
  Errors: errors,
  ExitCodes: exitCodes,
  Flags: flags,
  EnvVars: envVars,
};

/**
 * The anchors a generated table gives the page it is on, whatever its props
 * (a superset for a filtered table), so a link check can resolve
 * `/docs/reference/cli/flags#read-only` from the page source alone.
 */
export const COMPONENT_ANCHORS: Record<string, () => string[]> = {
  Errors: () => [...new Set([null, ...TABLES].flatMap((surface) => errorsTable(surface === null ? {} : { surface }).rows.map((r) => r.id)))],
  ExitCodes: exitCodeAnchors,
  Flags: flagAnchors,
  EnvVars: envVarAnchors,
};

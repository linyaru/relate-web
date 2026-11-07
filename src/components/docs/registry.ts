// The JSX components docs pages may use, by the name a page writes
// (`<Install />`), each with its markdown rendering for the twin (ADR-0015:
// JSX is for generated and interactive things only; at most five in phase 1).
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
import { toMarkdown as errors } from './errors.ts';
import { toMarkdown as install } from './install.ts';

export const COMPONENT_TWINS: Record<string, ToMarkdown> = {
  Install: install,
  Errors: errors,
};

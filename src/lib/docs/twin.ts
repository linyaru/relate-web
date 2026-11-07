// The markdown twin of a docs page (DOCS-PLAN.md §3.1, ADR-0005): the page as
// authored, with every construct in its markdown form (constructs.ts), YAML
// frontmatter an agent can parse, the version line, and a closing "Terms used
// on this page" section. Served at /docs/<id>.md and /docs/<id>/index.md, and
// concatenated into the llms-full.txt files. Node-only, no astro:content, so
// a check can render any page from its file.

import { stringify as toYaml } from 'yaml';

import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import type { Engine, GlossaryTerm } from './content.ts';
import { renderConstructs, type ToMarkdown } from './constructs.ts';
import { CANONICAL_PHRASE } from './llms.ts';
import type { LinkContext } from './links.ts';
import { pageUrl, typeOf } from './model.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';

/** The authored frontmatter the twin reads (the content schema validates it). */
export interface PageData {
  title: string;
  description: string;
  surfaces?: string[];
  status?: string;
  since?: string;
  prerequisites?: string[];
  related?: string[];
}

export interface TwinContext {
  links: LinkContext;
  glossary: Map<string, GlossaryTerm>;
  components: Record<string, ToMarkdown>;
  engine: Engine;
}

export interface Twin {
  markdown: string;
  terms: GlossaryTerm[];
}

/** The changelog entry for releases after `version`, which every twin points at. */
export const changelogUrl = (version: string) => `${CANONICAL_ORIGIN}/docs/reference/changelog/#since-${version}`;

/** The line under every twin's description: the version the page was checked against. */
export const versionLine = (verified: string) =>
  `> Verified against relate ${verified}. If your \`relate --version\` is newer, read ${changelogUrl(verified)}`;

/** The page's twin. `body` is its MDX without frontmatter; `lastUpdated` is `YYYY-MM-DD`. */
export function renderTwin(page: { id: string; file: string; body: string; data: PageData; lastUpdated: string }, ctx: TwinContext): Twin {
  const { id, data } = page;
  const tree = parsePage(page.body);
  const { terms } = renderConstructs(tree, 'markdown', {
    file: page.file,
    source: page.body,
    links: ctx.links,
    glossary: ctx.glossary,
    components: ctx.components,
  });
  const front: Record<string, unknown> = {
    title: data.title,
    // The canonical phrase (DOCS-PLAN.md §3.9) opens every twin's description, so authors never type it.
    description: `${CANONICAL_PHRASE}: ${data.description}`,
    ...(typeOf(id) ? { type: typeOf(id) } : {}),
    surfaces: data.surfaces ?? [],
    status: data.status ?? 'stable',
    ...(data.since ? { since: data.since } : {}),
    verified: ctx.engine.verified,
    canonical_url: `${CANONICAL_ORIGIN}${pageUrl(id)}`,
    prerequisites: data.prerequisites ?? [],
    related: data.related ?? [],
    last_updated: page.lastUpdated,
  };
  const parts = [
    `---\n${toYaml(front, { lineWidth: 0 }).trimEnd()}\n---`,
    `# ${data.title}`,
    data.description,
    versionLine(ctx.engine.verified),
    stringifyMarkdown(tree).trim(),
  ];
  if (terms.length) {
    parts.push('## Terms used on this page', terms.map((t) => `- **${t.term}**: ${t.short}`).join('\n'));
  }
  return { markdown: `${parts.filter(Boolean).join('\n\n')}\n`, terms };
}

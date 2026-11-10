// The markdown twin of a docs page (DOCS-PLAN.md §3.1, ADR-0005): the page as
// authored, with every construct in its markdown form (constructs.ts), YAML
// frontmatter an agent can parse, the version line, and a closing "Terms used
// on this page" section. Served at /docs/<id>.md and /docs/<id>/index.md, and
// concatenated into the llms-full.txt files. Node-only, no astro:content, so
// a check can render any page from its file.

import type { Parent, Root, RootContent } from 'mdast';
import { stringify as toYaml } from 'yaml';

import { CANONICAL_ORIGIN } from '../cookbook/links.ts';
import { pageCliVerified } from './checks/cli.ts';
import type { Engine, GlossaryTerm } from './content.ts';
import { renderConstructs, type ToMarkdown } from './constructs.ts';
import { CANONICAL_PHRASE } from './llms.ts';
import type { LinkContext } from './links.ts';
import { pageUrl, typeOf, VERIFIERS, type Verifier } from './model.ts';
import { parsePage, stringifyMarkdown } from './parse.ts';
import { hasCells, readResults } from './results.ts';
import { sampleManifestUrl } from './sample-manifests.ts';
import { pageSamples, readSidecar, sampleVerifiers } from './samples.ts';

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

function hasVerifyFence(tree: Root): boolean {
  let found = false;
  const visit = (node: Root | RootContent) => {
    if (node.type === 'code' && node.lang === 'bash' && /(?:^|\s)verify(?:\s|$)/.test(node.meta ?? '')) found = true;
    if (!found && 'children' in node) for (const c of (node as Parent).children) visit(c as RootContent);
  };
  visit(tree);
  return found;
}

/**
 * The checks this page's examples passed at the docs' engine version, in
 * VERIFIERS order (the twin's generated `verified_by`, DOCS-PLAN.md §6):
 * `cypher` when the page has cells and its results sidecar was recorded on
 * that version (docs:check replays them); `python` / `node` when the page has
 * samples of that language and every one has an output recorded by the client
 * at that version from the code as it now reads (docs:samples, the sample's
 * `source_sha256`); `cli` when the page has `bash verify` fences, every one
 * of them is the step docs:cli-check last replayed (cli.json `page_steps`),
 * and the CLI recordings were made with that version. The claim is only as
 * strong as those runs.
 */
export function verifiedBy(file: string, body: string, tree: Root, version: string): Verifier[] {
  const out = new Set<Verifier>();
  try {
    if (hasCells(body) && readResults(file)?.verified === version) out.add('cypher');
  } catch {
    // A malformed sidecar fails the build where the cells render.
  }
  try {
    for (const v of sampleVerifiers(body, readSidecar(file), version)) out.add(v);
  } catch {
    // Reported by docs:check (checks/samples.ts).
  }
  try {
    if (hasVerifyFence(tree) && pageCliVerified(file, version)) out.add('cli');
  } catch {
    // An unreadable cli.json is reported by docs:check (checks/cli.ts).
  }
  return VERIFIERS.filter((v) => out.has(v));
}

/**
 * The twin's `samples`: the manifest URL of each verified sample on the page,
 * in page order (sample-manifests.ts, ADR-0053); empty when the page has none
 * or its samples have problems (docs:check reports those).
 */
export function sampleManifests(id: string, body: string): string[] {
  const { samples, problems } = pageSamples(body, id);
  return problems.length ? [] : samples.map((s) => sampleManifestUrl(id, s.id));
}

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
  const checks = verifiedBy(page.file, page.body, tree, ctx.engine.verified);
  const manifests = sampleManifests(id, page.body);
  const front: Record<string, unknown> = {
    title: data.title,
    // The canonical phrase (DOCS-PLAN.md §3.9) opens every twin's description, so authors never type it.
    description: `${CANONICAL_PHRASE}: ${data.description}`,
    ...(typeOf(id) ? { type: typeOf(id) } : {}),
    surfaces: data.surfaces ?? [],
    status: data.status ?? 'stable',
    ...(data.since ? { since: data.since } : {}),
    verified: ctx.engine.verified,
    ...(checks.length ? { verified_by: checks } : {}),
    ...(manifests.length ? { samples: manifests } : {}),
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

// The docs section's vocabulary (DOCS-PLAN.md §2, §5): sections and their
// Diátaxis types, surfaces, statuses, and how a page's id maps to its URLs.
// Plain data and pure functions, shared by the build, the twin renderer, the
// content schema and any Node check, so it imports nothing.

/** The four sections, in sidebar order, with their URL segment and Diátaxis type. */
export const SECTIONS = [
  { id: 'get-started', label: 'Get started', type: 'tutorial' },
  { id: 'guides', label: 'Guides', type: 'how-to' },
  { id: 'reference', label: 'Reference', type: 'reference' },
  { id: 'concepts', label: 'Concepts', type: 'explanation' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
export type DocType = (typeof SECTIONS)[number]['type'];

export const SECTION_IDS = SECTIONS.map((s) => s.id) as [SectionId, ...SectionId[]];
export const DOC_TYPES = SECTIONS.map((s) => s.type) as [DocType, ...DocType[]];

/** The front doors a page can apply to (DOCS-PLAN.md §1). */
export const SURFACES = [
  'cli', 'python', 'node', 'browser', 'rust', 'c', 'java', 'go', 'swift',
  'bolt', 'http', 'mcp', 'docker', 'extensions', 'cypher', 'agents',
] as const;
export type Surface = (typeof SURFACES)[number];

/** `planned` pages are left out of the build; links to them render as text. */
export const STATUSES = ['stable', 'preview', 'planned'] as const;
export type Status = (typeof STATUSES)[number];

/** Frontmatter fields the build generates; a page may not set them. */
export const GENERATED_FIELDS = ['verified', 'verified_by', 'canonical_url', 'last_updated'] as const;

/**
 * The checks a page's examples can have passed at the docs' engine version,
 * in the order the twin's generated `verified_by` lists them (DOCS-PLAN.md §6):
 * Cypher cells (docs:check), Python, Node.js, Rust, Java, Go, Swift and C
 * samples (docs:samples; samples.ts SAMPLE_VERIFIER), and `bash verify`
 * commands (docs:cli-check).
 */
export const VERIFIERS = ['cypher', 'python', 'node', 'rust', 'java', 'go', 'swift', 'c', 'cli'] as const;
export type Verifier = (typeof VERIFIERS)[number];

/** The section a page id belongs to, or null (a page outside the four sections). */
export function sectionOf(id: string): SectionId | null {
  const head = id.split('/')[0];
  return (SECTION_IDS as string[]).includes(head) ? (head as SectionId) : null;
}

/** The Diátaxis type of a page id's section, or null. */
export function typeOf(id: string): DocType | null {
  const s = sectionOf(id);
  return s ? SECTIONS.find((x) => x.id === s)!.type : null;
}

/** A page's id from its path under src/content/docs: no extension, no trailing `/index`. */
export function idFromPath(relPath: string): string {
  const p = relPath.replaceAll('\\', '/').replace(/\.mdx$/, '');
  return p === 'index' ? '' : p.replace(/\/index$/, '');
}

/** A page's HTML URL, site-relative, with a trailing slash. */
export const pageUrl = (id: string) => (id ? `/docs/${id}/` : '/docs/');

/** A page's markdown twin, site-relative (`/docs/<id>.md`; `/docs/<id>/index.md` also serves it). */
export const twinUrl = (id: string) => (id ? `/docs/${id}.md` : '/docs/index.md');

/** A rough token count for `text` (four characters a token), as llms.txt quotes it. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/** `n` tokens as llms.txt prints it: `~640 tokens`, `~1.2k tokens`. */
export function tokenLabel(n: number): string {
  if (n < 1000) return `~${Math.max(10, Math.round(n / 10) * 10)} tokens`;
  return `~${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '')}k tokens`;
}

/**
 * Pages the build generates from data rather than from an `.mdx` file
 * (src/lib/docs/generated/): each has an HTML page at its id's URL and a
 * markdown twin, sits in the sidebar, llms.txt and the sitemap like an
 * authored page, and counts as published for links. Plain data, so the
 * content reader, the link resolver and Node checks can import it.
 */
export interface GeneratedPageMeta {
  id: string;
  title: string;
  description: string;
  /** Sidebar order within its group, as an authored page's `order`. */
  order: number;
  surfaces: Surface[];
}

export const GENERATED_PAGES: readonly GeneratedPageMeta[] = [
  {
    id: 'reference/glossary',
    title: 'Glossary',
    description: 'Every term the relate docs define, in alphabetical order, with its short and full definition, other names in use, related terms and the page that covers it.',
    order: 900,
    surfaces: [],
  },
  {
    id: 'reference/changelog',
    title: 'Changelog',
    description: 'What each relate release added, changed, deprecated, removed and fixed, newest first, with the deprecation policy and a JSON feed.',
    order: 910,
    surfaces: [],
  },
  {
    id: 'reference/server/docs-mcp-usage',
    title: 'Hosted docs MCP usage',
    description: 'Calls, refusals, failures and completion rate per tool of the hosted docs MCP server, calls by client family, the period counted, and what is never logged.',
    order: 20,
    surfaces: ['mcp', 'agents'],
  },
];

/** The ids of the generated pages. */
export const GENERATED_IDS: ReadonlySet<string> = new Set(GENERATED_PAGES.map((p) => p.id));

/** The changelog's JSON feed, site-relative. */
export const CHANGELOG_FEED_URL = '/docs/changelog.json';
/** The changelog twin's short alias (DOCS-PLAN.md §5 "Endpoints"). */
export const CHANGELOG_MD_URL = '/docs/changelog.md';
/** The agent-facing page on reporting a wrong or missing page (DOCS-PLAN.md §3.2, ADR-0013). */
export const FEEDBACK_URL = '/docs/feedback.md';

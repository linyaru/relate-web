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
export const GENERATED_FIELDS = ['verified', 'canonical_url', 'last_updated'] as const;

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

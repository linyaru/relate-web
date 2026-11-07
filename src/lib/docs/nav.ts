// The docs navigation, from the pages alone: the sidebar (sections, then one
// level of groups by the second path segment, each sorted by `order` then
// title), the reading order that prev/next follow, and breadcrumbs. Pure.

import { pageUrl, SECTIONS, sectionOf, type SectionId } from './model.ts';

export interface NavPage {
  id: string;
  title: string;
  /** The sidebar label (`label`, else the title). */
  label: string;
  order: number;
}

export interface NavGroup {
  /** `guides/cypher`, or a section id. */
  id: string;
  label: string;
  /** The group's own page (`guides/cypher/index.mdx`), if any. */
  index: NavPage | null;
  pages: NavPage[];
  groups: NavGroup[];
}

const WORDS: Record<string, string> = { cli: 'CLI', mcp: 'MCP', api: 'API', neo4j: 'Neo4j', http: 'HTTP', wasm: 'WASM' };
/** A path segment as a label: `get-started` → `Get started`, `cli` → `CLI`. */
export const humanize = (segment: string) =>
  segment
    .split('-')
    .map((w, i) => WORDS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

const byOrder = (a: { order: number; label: string }, b: { order: number; label: string }) =>
  a.order - b.order || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);

/** The sidebar: one group per section that has pages, in section order. */
export function buildNav(pages: NavPage[]): NavGroup[] {
  const out: NavGroup[] = [];
  for (const section of SECTIONS) {
    const inSection = pages.filter((p) => sectionOf(p.id) === section.id);
    if (!inSection.length) continue;
    const index = inSection.find((p) => p.id === section.id) ?? null;
    const direct = inSection.filter((p) => p.id.split('/').length === 2).sort(byOrder);
    const groupIds = [...new Set(inSection.filter((p) => p.id.split('/').length > 2).map((p) => p.id.split('/').slice(0, 2).join('/')))];
    const groups = groupIds
      .map((gid) => {
        const own = direct.find((p) => p.id === gid) ?? null;
        const members = inSection.filter((p) => p.id.startsWith(`${gid}/`)).sort(byOrder);
        return {
          id: gid,
          label: own?.label ?? humanize(gid.split('/')[1]),
          index: own,
          pages: members,
          groups: [],
          order: own?.order ?? Math.min(...members.map((m) => m.order)),
        };
      })
      .sort(byOrder)
      .map(({ order: _order, ...g }) => g);
    const groupSet = new Set(groupIds);
    out.push({
      id: section.id,
      label: section.label,
      index,
      pages: direct.filter((p) => !groupSet.has(p.id)),
      groups,
    });
  }
  return out;
}

/** Every page in reading order: each section's own page, its pages, then its groups. */
export function readingOrder(nav: NavGroup[]): NavPage[] {
  const out: NavPage[] = [];
  const visit = (g: NavGroup) => {
    if (g.index) out.push(g.index);
    out.push(...g.pages);
    g.groups.forEach(visit);
  };
  nav.forEach(visit);
  return out;
}

/** The pages before and after `id` in reading order. */
export function prevNext(nav: NavGroup[], id: string): { prev: NavPage | null; next: NavPage | null } {
  const order = readingOrder(nav);
  const i = order.findIndex((p) => p.id === id);
  return { prev: i > 0 ? order[i - 1] : null, next: i >= 0 && i < order.length - 1 ? order[i + 1] : null };
}

export interface Crumb {
  label: string;
  /** Null when there is no page to link (a section or group without its own page). */
  href: string | null;
}

/** Docs › Section › Group for page `id` (the page itself is the H1, not a crumb). */
export function breadcrumb(nav: NavGroup[], id: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Docs', href: pageUrl('') }];
  const section = nav.find((g) => g.id === sectionOf(id));
  if (!section || id === section.id) return crumbs;
  crumbs.push({ label: section.label, href: section.index ? pageUrl(section.id) : null });
  const group = section.groups.find((g) => id.startsWith(`${g.id}/`));
  if (group) crumbs.push({ label: group.label, href: group.index ? pageUrl(group.id) : null });
  return crumbs;
}

export type { SectionId };

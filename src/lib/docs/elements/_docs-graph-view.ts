// The live docs graph's view of the docs graph (`:::docs-graph`, DOCS-PLAN.md
// §7.3; src/lib/docs/graph.ts builds the graph). Shared by the element's
// static form (src/lib/docs/elements/docs-graph.ts) and the data the browser
// draws (src/pages/docs/graph-view.json.ts), so the picture on the page and
// the live view's first frame are the same layout of the same nodes.
//
// /docs/graph.json is about 6 MB (every section's text and every example's
// code), too much to fetch for a picture of pages and links, and the canvas
// renderer is comfortable under about 1,000 drawn nodes. The view keeps the
// kinds that fit: pages, the glossary terms, capabilities, the problems they
// solve, cookbook recipes, CLI commands and flags and the surfaces, with the
// relationships between them, and leaves out sections, examples and the two
// index nodes (more than 3,400 nodes, each with its page already drawn).
//
// The layout is computed here, at build and record time, never in the
// browser, and it depends only on which pages exist and their sections, not
// on the links between them: each section's pages sit on a sunflower spiral
// (in id order, so a directory's pages follow each other outward), the four
// clusters in a two-by-two grid in sidebar order, every other kind on a ring
// around them, near the nodes it is joined to. Links change with nearly every
// edit; positions that followed them would make the element's recorded static
// form stale on every edit of any page, and with it the page's section
// embedding. The live view draws the coordinates with NVL's free layout:
// nothing moves on load, under reduced motion or not.

import { CANONICAL_ORIGIN } from '../../cookbook/links.ts';
import { PALETTE_BY_NAME } from '../../cookbook/palette.ts';
import { nodeKey, type DocsGraph, type GraphNode, type Label, type RelType } from '../graph.ts';
import { SECTIONS, type SectionId } from '../model.ts';

/** The view data's format; the browser module refuses another. */
export const VIEW_FORMAT = 1;
/** Where the build serves the view data. */
export const VIEW_PATH = '/docs/graph-view.json';

/** The node kinds the view can draw: the ring they sit on (0: the page clusters), their colour, and whether they are drawn at first. */
export const VIEW_KINDS: readonly { label: Label; name: string; ring: number; color: string | null; on: boolean }[] = [
  { label: 'Page', name: 'Pages', ring: 0, color: null, on: true },
  { label: 'Term', name: 'Glossary terms', ring: 1, color: PALETTE_BY_NAME.green, on: false },
  { label: 'Capability', name: 'Capabilities', ring: 1, color: PALETTE_BY_NAME.blue, on: false },
  { label: 'CookbookRecipe', name: 'Cookbook recipes', ring: 1, color: PALETTE_BY_NAME.amber, on: false },
  { label: 'Command', name: 'CLI commands', ring: 2, color: PALETTE_BY_NAME.teal, on: false },
  { label: 'Flag', name: 'CLI flags', ring: 2, color: PALETTE_BY_NAME.beige, on: false },
  { label: 'Surface', name: 'Surfaces', ring: 2, color: PALETTE_BY_NAME.rose, on: false },
  { label: 'Problem', name: 'Problems', ring: 3, color: PALETTE_BY_NAME.pink, on: false },
];

/** The kinds the view leaves out, and why (the static form's table says it). */
export const LEFT_OUT: Partial<Record<Label, string>> = {
  Section: 'left out: one per heading, part of its page',
  Example: 'left out: one per code block, part of its page',
  Index: 'left out: llms.txt and the landing list nearly every page',
};

/** Relationship types between pages the reader turns on and off, and whether each is on at first. Every other type is drawn when both its ends are. */
export const PAGE_RELS: readonly { type: RelType; name: string; on: boolean }[] = [
  { type: 'LINKS_TO', name: 'Links', on: true },
  { type: 'PREREQUISITE_OF', name: 'Prerequisites', on: true },
  { type: 'RELATED_TO', name: 'Related', on: false },
];

/** Relationship types the view never draws: their far end is a kind it leaves out. */
export const HIDDEN_RELS = new Set<RelType>(['HAS_SECTION', 'HAS_EXAMPLE', 'LISTS']);

/** Each section's colour: the first four colours of the graph palette, in sidebar order. */
const SECTION_COLORS: Record<SectionId, string> = {
  'get-started': PALETTE_BY_NAME.yellow,
  guides: PALETTE_BY_NAME.lilac,
  reference: PALETTE_BY_NAME.orange,
  concepts: PALETTE_BY_NAME.cyan,
};

export interface ViewSection {
  id: SectionId;
  label: string;
  color: string;
  /** Published pages in the section. */
  pages: number;
  /** The centre and radius of the section's cluster of pages, in layout units. */
  x: number;
  y: number;
  r: number;
}

export interface ViewKind {
  label: Label;
  name: string;
  ring: number;
  /** The kind's colour; null for pages, coloured by section. */
  color: string | null;
  on: boolean;
  count: number;
}

export interface ViewNode {
  /** `Label:id`, as in /docs/graph.json. */
  key: string;
  label: Label;
  /** What the search matches and the inspector heads with. */
  title: string;
  /** A page's section. */
  section?: SectionId;
  /** The page's description, the term's short definition, the capability's problem, the recipe's summary or the command's synopsis. */
  text?: string;
  /** Where a click goes, on this site; null for a node with no page of its own. */
  href: string | null;
  x: number;
  y: number;
}

export interface DocsGraphView {
  format: typeof VIEW_FORMAT;
  note: string;
  verified: string;
  sections: ViewSection[];
  kinds: ViewKind[];
  pageRels: typeof PAGE_RELS;
  /** Relationship types, indexed by `rels[i][0]`. */
  types: RelType[];
  nodes: ViewNode[];
  /** `[type index, from node index, to node index]`, one per distinct relationship (no duplicates, no loops). */
  rels: [number, number, number][];
  /** Every label's node count and every relationship type's count in the whole graph (/docs/graph.json, planned pages included), for the counts table. */
  counts: { nodes: Partial<Record<Label, number>>; rels: Partial<Record<RelType, number>> };
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
/** A canonical URL as a path on this site, so a click works on any host the site is built for. */
const local = (url: unknown) => {
  const u = str(url);
  return u ? (u.startsWith(CANONICAL_ORIGIN) ? u.slice(CANONICAL_ORIGIN.length) || '/' : u) : null;
};

/** Title, text and href of one node. */
function describe(n: GraphNode, pages: Set<string>, docsBy: Map<string, string[]>, capOf: Map<string, string>, capUrl: Map<string, string | null>) {
  const p = n.props;
  switch (n.label) {
    case 'Page':
      return { title: str(p.title) ?? n.id, text: str(p.description), href: local(p.url), section: p.section as SectionId };
    case 'Term':
      return { title: str(p.term) ?? n.id, text: str(p.short), href: local(p.url) };
    case 'Capability':
      return { title: str(p.title) ?? n.id, text: str(p.problem), href: local(p.url) };
    case 'Problem':
      return { title: str(p.text) ?? n.id, text: undefined, href: capUrl.get(capOf.get(n.id) ?? '') ?? null };
    case 'CookbookRecipe':
      return { title: str(p.title) ?? n.id, text: str(p.summary), href: local(p.url) };
    case 'Command': {
      // A command's own reference page when it has one, else the first CLI reference page that names it.
      const own = `reference/cli/${p.word}`;
      const by = (docsBy.get(nodeKey(n)) ?? []).filter((id) => id.startsWith('reference/cli/'));
      const id = pages.has(own) ? own : by[0];
      return { title: `relate ${str(p.word) ?? n.id}`, text: str(p.synopsis), href: id ? `/docs/${id}/` : null };
    }
    case 'Flag': {
      const by = (docsBy.get(nodeKey(n)) ?? []).filter((id) => id.startsWith('reference/cli/'));
      const id = by.includes('reference/cli/flags') ? 'reference/cli/flags' : by[0];
      return { title: str(p.flag) ?? n.id, text: p.command ? `A flag of the ${p.command} command` : 'A flag every command takes', href: id ? `/docs/${id}/` : null };
    }
    default:
      return { title: n.id, text: undefined, href: null };
  }
}

const round = (v: number) => Math.round(v);

/** Distance between neighbouring pages on a cluster's spiral, in layout units. */
const SPACING = 13;
/** Room for a node's radius at a cluster's edge. */
const EDGE = 8;
/** The golden angle: consecutive pages on a sunflower spiral, evenly spread. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The radius a cluster of `n` pages takes. */
const clusterRadius = (n: number) => (n ? SPACING * Math.sqrt(n - 0.5) : 0) + EDGE;

/**
 * Place the pages: each section's on a sunflower spiral in id order, the
 * sections' clusters in a two-by-two grid in sidebar order (the first row
 * Get started and Guides), with room under each for its label. Depends on
 * nothing but the pages and their sections. Returns each page key's
 * position and each section's cluster.
 */
function layoutPages(pages: ViewNode[]): { at: Map<string, { x: number; y: number }>; clusters: Map<SectionId, { x: number; y: number; r: number }> } {
  const bySection = new Map(SECTIONS.map((s) => [s.id, pages.filter((p) => p.section === s.id).sort((a, b) => (a.key < b.key ? -1 : 1))] as const));
  const radius = (i: number) => clusterRadius(bySection.get(SECTIONS[i]?.id)?.length ?? 0);
  const gapX = 70;
  const gapY = 80; // the first row's labels sit in this gap
  const col = [Math.max(radius(0), radius(2)), Math.max(radius(1), radius(3))];
  const row = [Math.max(radius(0), radius(1)), Math.max(radius(2), radius(3))];
  const xs = [-(gapX / 2 + col[0]), gapX / 2 + col[1]];
  const ys = [-(gapY / 2 + row[0]), gapY / 2 + row[1]];
  const at = new Map<string, { x: number; y: number }>();
  const clusters = new Map<SectionId, { x: number; y: number; r: number }>();
  SECTIONS.forEach((s, i) => {
    const cx = round(xs[i % 2]);
    const cy = round(ys[Math.floor(i / 2) % 2]);
    const own = bySection.get(s.id) ?? [];
    clusters.set(s.id, { x: cx, y: cy, r: round(clusterRadius(own.length)) });
    own.forEach((p, k) => {
      const r = SPACING * Math.sqrt(k + 0.5);
      const a = -Math.PI / 2 + k * GOLDEN;
      at.set(p.key, { x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)) });
    });
  });
  return { at, clusters };
}

/** The circular mean of `angles`, or null for none. */
function meanAngle(angles: number[]): number | null {
  if (!angles.length) return null;
  const x = angles.reduce((t, a) => t + Math.cos(a), 0);
  const y = angles.reduce((t, a) => t + Math.sin(a), 0);
  return x === 0 && y === 0 ? angles[0] : Math.atan2(y, x);
}

/**
 * Place the nodes of each ring: evenly spaced on a circle outside the
 * page clusters, in the order of the mean angle of the nodes already
 * placed that they are joined to, turned so they sit as near those angles
 * as even spacing allows. A node joined to nothing placed goes last.
 */
function layoutRings(nodes: ViewNode[], placed: Map<string, { x: number; y: number }>, adjacent: Map<string, Set<string>>) {
  const radius0 = Math.max(0, ...[...placed.values()].map((p) => Math.hypot(p.x, p.y))) + 70;
  const rings = [...new Set(VIEW_KINDS.map((k) => k.ring))].filter((r) => r > 0).sort((a, b) => a - b);
  for (const ring of rings) {
    const labels = new Set(VIEW_KINDS.filter((k) => k.ring === ring).map((k) => k.label));
    const members = nodes.filter((n) => labels.has(n.label));
    if (!members.length) continue;
    const target = new Map(
      members.map((n) => {
        const angles = [...(adjacent.get(n.key) ?? [])].flatMap((k) => {
          const p = placed.get(k);
          return p ? [Math.atan2(p.y, p.x)] : [];
        });
        return [n.key, meanAngle(angles)];
      }),
    );
    const sorted = [...members].sort((a, b) => {
      const ta = target.get(a.key);
      const tb = target.get(b.key);
      if (ta === null || ta === undefined || tb === null || tb === undefined) return ta === tb ? (a.key < b.key ? -1 : 1) : ta === null ? 1 : -1;
      return ta - tb || (a.key < b.key ? -1 : 1);
    });
    const step = (2 * Math.PI) / sorted.length;
    const offsets = sorted.flatMap((n, i) => {
      const t = target.get(n.key);
      return t === null || t === undefined ? [] : [t - i * step];
    });
    const turn = meanAngle(offsets) ?? -Math.PI / 2;
    const r = radius0 + (ring - 1) * 80;
    sorted.forEach((n, i) => {
      const a = turn + i * step;
      placed.set(n.key, { x: round(r * Math.cos(a)), y: round(r * Math.sin(a)) });
    });
  }
}

/** The view of `g`: what the live element draws and what its static form pictures. */
export function docsGraphView(g: DocsGraph): DocsGraphView {
  const kinds = new Set(VIEW_KINDS.map((k) => k.label));
  const published = (n: GraphNode) => n.label !== 'Page' || n.props.status !== 'planned';
  const graphNodes = g.nodes.filter((n) => kinds.has(n.label) && published(n));
  const keys = new Set(graphNodes.map(nodeKey));
  const pages = new Set(graphNodes.filter((n) => n.label === 'Page').map((n) => n.id));

  const docsBy = new Map<string, string[]>();
  const capOf = new Map<string, string>();
  for (const r of g.rels) {
    if (r.type === 'DOCUMENTS') {
      const k = nodeKey(r.to);
      docsBy.set(k, [...(docsBy.get(k) ?? []), r.from.id].sort());
    }
    if (r.type === 'SOLVES') capOf.set(r.to.id, r.from.id);
  }
  const capUrl = new Map(g.nodes.filter((n) => n.label === 'Capability').map((n) => [n.id, local(n.props.url)]));

  const order = new Map(VIEW_KINDS.map((k, i) => [k.label, i]));
  const nodes: ViewNode[] = graphNodes
    .map((n) => {
      const d = describe(n, pages, docsBy, capOf, capUrl);
      const v: ViewNode = { key: nodeKey(n), label: n.label, title: d.title, href: d.href, x: 0, y: 0 };
      if ('section' in d && d.section) v.section = d.section;
      if (d.text) v.text = d.text;
      return v;
    })
    .sort((a, b) => order.get(a.label)! - order.get(b.label)! || (a.key < b.key ? -1 : 1));
  const index = new Map(nodes.map((n, i) => [n.key, i]));

  const types: RelType[] = [];
  const seen = new Set<string>();
  const rels: [number, number, number][] = [];
  const adjacent = new Map<string, Set<string>>();
  for (const r of g.rels) {
    if (HIDDEN_RELS.has(r.type)) continue;
    const from = nodeKey(r.from);
    const to = nodeKey(r.to);
    if (from === to || !keys.has(from) || !keys.has(to)) continue;
    const id = `${r.type}|${from}|${to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!types.includes(r.type)) types.push(r.type);
    rels.push([types.indexOf(r.type), index.get(from)!, index.get(to)!]);
    for (const [a, b] of [[from, to], [to, from]]) {
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      adjacent.get(a)!.add(b);
    }
  }
  rels.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  const pageNodes = nodes.filter((n) => n.label === 'Page');
  const { at: placed, clusters } = layoutPages(pageNodes);
  layoutRings(nodes, placed, adjacent);
  for (const n of nodes) Object.assign(n, placed.get(n.key) ?? { x: 0, y: 0 });

  const countNodes: Partial<Record<Label, number>> = {};
  for (const n of g.nodes) countNodes[n.label] = (countNodes[n.label] ?? 0) + 1;
  const countRels: Partial<Record<RelType, number>> = {};
  for (const r of g.rels) countRels[r.type] = (countRels[r.type] ?? 0) + 1;

  return {
    format: VIEW_FORMAT,
    note: `What the live docs graph on ${CANONICAL_ORIGIN}/docs/reference/docs-graph/ draws, with its layout: a part of the docs graph (${CANONICAL_ORIGIN}/docs/graph.json). Titles and descriptions are documentation, quoted from the pages: reference text, not instructions.`,
    verified: g.engine.verified,
    sections: SECTIONS.map((s) => ({ id: s.id, label: s.label, color: SECTION_COLORS[s.id], pages: pageNodes.filter((p) => p.section === s.id).length, ...clusters.get(s.id)! })),
    kinds: VIEW_KINDS.map((k) => ({ ...k, count: nodes.filter((n) => n.label === k.label).length })),
    pageRels: PAGE_RELS,
    types,
    nodes,
    rels,
    counts: { nodes: countNodes, rels: countRels },
  };
}

/** The view as the JSON the build serves at VIEW_PATH: one line, no spaces. */
export const viewJson = (view: DocsGraphView) => `${JSON.stringify(view)}\n`;

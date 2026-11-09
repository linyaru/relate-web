// The graph diff's model (`:::graph-diff`, ADR-0050), shared by its build
// side (src/lib/docs/elements/graph-diff.ts, the static form) and its
// browser module (src/scripts/docs/elements/graph-diff.ts, the live view),
// so the recorded picture and the first live frame are the same diff laid
// out the same way. Free of Node and DOM imports.
//
// Two graph states are what two statements returned: every node and
// relationship in the last envelope's rows (inside lists, maps and paths
// too). Element ids are not stable across stores, nor across two runs that
// build a graph differently, so identity is the page's: a node is its `key`
// property's value, and a relationship is its type with the key values of
// the nodes at each end (parallel relationships of one type between the same
// two nodes are told apart by their properties). A node or relationship in
// only the first state is removed, in only the second added, in both with
// other labels or properties changed, and otherwise unchanged. A changed
// relationship type is a removal and an addition: a type is part of a
// relationship's identity, and the engine cannot change one in place.

import { caption, formatValue, type WireNode, type WireRel } from '../../cookbook/graph-model.ts';

export type Status = 'added' | 'removed' | 'changed' | 'unchanged';

/** The order the legend, the counts and the table name the statuses in. */
export const STATUSES: readonly Status[] = ['removed', 'added', 'changed', 'unchanged'];

/**
 * How each status is told apart without colour: a symbol on every caption,
 * in the legend and in the table, a word, and (in the pictures) a line
 * pattern. The colour token is the third cue, never the only one.
 */
export const STATUS_STYLE: Record<Status, { symbol: string; word: string; token: string; dash: string; line: string }> = {
  removed: { symbol: '−', word: 'removed', token: '--danger', dash: '6 4', line: 'dashed' },
  added: { symbol: '+', word: 'added', token: '--success', dash: '', line: 'thick' },
  changed: { symbol: '~', word: 'changed', token: '--rel', dash: '2 3', line: 'dotted' },
  unchanged: { symbol: '', word: 'unchanged', token: '--fg-faint', dash: '', line: 'thin' },
};

export interface GraphState {
  nodes: WireNode[];
  rels: WireRel[];
}

/** One property, label or type change on a changed element, in words. */
export interface Change {
  /** `industry added: "Software"`, `employees: 80 → 90`, `labels: :Org → :Org:Public`. */
  text: string;
}

export interface DiffNode {
  /** The identity: the key property's value as JSON. */
  id: string;
  status: Status;
  labels: string[];
  caption: string;
  /** The key property's value as the table prints it. */
  keyText: string;
  changes: Change[];
}

export interface DiffRel {
  /** The identity: start node, type, end node and, for a parallel one, its place. */
  id: string;
  status: Status;
  type: string;
  from: string;
  to: string;
  changes: Change[];
}

export interface Diff {
  key: string;
  nodes: DiffNode[];
  rels: DiffRel[];
  /** What kept an element out of the diff: a node without the key, a key twice, a relationship whose end the statement did not return. */
  problems: string[];
}

export type Counts = Record<Status, number>;

// ---------------------------------------------------------------- the two states

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every node and relationship in a result's rows, each once (by engine id), wherever a row holds it. */
export function graphFromRows(rows: readonly unknown[] | null | undefined): GraphState {
  const nodes = new Map<number, WireNode>();
  const rels = new Map<number, WireRel>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (!isObject(v)) return;
    if (v.kind === 'node' && typeof v.id === 'number' && Array.isArray(v.labels)) {
      if (!nodes.has(v.id)) nodes.set(v.id, { id: v.id, labels: v.labels as string[], properties: isObject(v.properties) ? v.properties : {} });
      return;
    }
    if (v.kind === 'relationship' && typeof v.id === 'number' && typeof v.type === 'string') {
      if (!rels.has(v.id)) {
        rels.set(v.id, { id: v.id, type: v.type, start_node: v.start_node as number, end_node: v.end_node as number, properties: isObject(v.properties) ? v.properties : {} });
      }
      return;
    }
    for (const x of Object.values(v)) visit(x);
  };
  visit(rows ?? []);
  return { nodes: [...nodes.values()], rels: [...rels.values()] };
}

/** `value` as JSON with every map's keys sorted, so two equal values print the same. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v)) ?? 'null';
}

/** A property value as the table prints it: a string quoted, so `"80"` and `80` differ, cut at 60 characters. */
const short = (v: unknown) => formatValue(typeof v === 'string' ? JSON.stringify(v) : v, 60);
const labelText = (labels: readonly string[]) => labels.map((l) => `:${l}`).join('') || '(no label)';

/** What changed between two property maps (and label lists), in words. */
function changesOf(before: { labels?: string[]; properties?: Record<string, unknown> }, after: { labels?: string[]; properties?: Record<string, unknown> }): Change[] {
  const out: Change[] = [];
  if (before.labels && after.labels && canonical([...before.labels].sort()) !== canonical([...after.labels].sort())) {
    out.push({ text: `labels: ${labelText(before.labels)} → ${labelText(after.labels)}` });
  }
  const a = before.properties ?? {};
  const b = after.properties ?? {};
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const inA = k in a && a[k] !== null;
    const inB = k in b && b[k] !== null;
    if (inA && !inB) out.push({ text: `${k} removed (was ${short(a[k])})` });
    else if (!inA && inB) out.push({ text: `${k} added: ${short(b[k])}` });
    else if (inA && inB && canonical(a[k]) !== canonical(b[k])) out.push({ text: `${k}: ${short(a[k])} → ${short(b[k])}` });
  }
  return out;
}

const quote = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : canonical(v));

/** One state's nodes by identity, and each engine id's identity, with what kept a node out. */
function identify(state: GraphState, key: string, which: string, problems: string[]) {
  const byId = new Map<string, WireNode>();
  const idOf = new Map<number, string>();
  for (const n of state.nodes) {
    const v = n.properties?.[key];
    if (v === undefined || v === null) {
      problems.push(`a ${labelText(n.labels)} node in the ${which} result has no \`${key}\` property, so it cannot be matched`);
      continue;
    }
    const id = canonical(v);
    if (byId.has(id)) {
      problems.push(`two nodes in the ${which} result have \`${key}\` ${quote(v)}`);
      continue;
    }
    byId.set(id, n);
    idOf.set(n.id, id);
  }
  const rels = new Map<string, WireRel>();
  const groups = new Map<string, WireRel[]>();
  for (const r of state.rels) {
    const from = idOf.get(r.start_node);
    const to = idOf.get(r.end_node);
    if (from === undefined || to === undefined) {
      problems.push(`a :${r.type} relationship in the ${which} result has an end node the statement did not return (or one without \`${key}\`)`);
      continue;
    }
    const group = `${from}|${r.type}|${to}`;
    (groups.get(group) ?? groups.set(group, []).get(group)!).push(r);
  }
  for (const [group, list] of groups) {
    list.sort((x, y) => (canonical(x.properties ?? {}) < canonical(y.properties ?? {}) ? -1 : 1));
    list.forEach((r, i) => rels.set(i === 0 ? group : `${group}|${i}`, r));
  }
  return { nodes: byId, idOf, rels };
}

/** Compare two graph states by the `key` property. */
export function diffGraphs(before: GraphState, after: GraphState, key: string): Diff {
  const problems: string[] = [];
  const a = identify(before, key, 'before', problems);
  const b = identify(after, key, 'after', problems);
  const nodes: DiffNode[] = [];
  for (const id of new Set([...a.nodes.keys(), ...b.nodes.keys()])) {
    const x = a.nodes.get(id);
    const y = b.nodes.get(id);
    const shown = (y ?? x)!;
    const changes = x && y ? changesOf(x, y) : [];
    const status: Status = !x ? 'added' : !y ? 'removed' : changes.length ? 'changed' : 'unchanged';
    nodes.push({ id, status, labels: shown.labels, caption: caption(shown), keyText: quote(shown.properties?.[key]), changes });
  }
  const rels: DiffRel[] = [];
  for (const id of new Set([...a.rels.keys(), ...b.rels.keys()])) {
    const x = a.rels.get(id);
    const y = b.rels.get(id);
    const shown = (y ?? x)!;
    const changes = x && y ? changesOf(x, y) : [];
    const status: Status = !x ? 'added' : !y ? 'removed' : changes.length ? 'changed' : 'unchanged';
    const [from, , to] = id.split('|');
    rels.push({ id, status, type: shown.type, from, to, changes });
  }
  const order = (s: Status) => STATUSES.indexOf(s);
  const nodeName = new Map(nodes.map((n) => [n.id, n.caption]));
  nodes.sort((p, q) => order(p.status) - order(q.status) || labelText(p.labels).localeCompare(labelText(q.labels)) || p.caption.localeCompare(q.caption) || p.id.localeCompare(q.id));
  rels.sort(
    (p, q) =>
      order(p.status) - order(q.status) ||
      p.type.localeCompare(q.type) ||
      (nodeName.get(p.from) ?? '').localeCompare(nodeName.get(q.from) ?? '') ||
      (nodeName.get(p.to) ?? '').localeCompare(nodeName.get(q.to) ?? '') ||
      p.id.localeCompare(q.id),
  );
  return { key, nodes, rels, problems };
}

/** How many elements have each status. */
export function countsOf(items: readonly { status: Status }[]): Counts {
  const out: Counts = { removed: 0, added: 0, changed: 0, unchanged: 0 };
  for (const i of items) out[i.status]++;
  return out;
}


/** "1 changed, 29 unchanged": the non-zero statuses of one kind, or "none". */
export function countsText(counts: Counts): string {
  const parts = STATUSES.filter((s) => counts[s] > 0).map((s) => `${counts[s].toLocaleString('en-US')} ${STATUS_STYLE[s].word}`);
  return parts.length ? parts.join(', ') : 'none';
}

/** The sentence the static form and the live pane give the counts in. */
export function summaryText(diff: Diff): string {
  return `Nodes: ${countsText(countsOf(diff.nodes))}. Relationships: ${countsText(countsOf(diff.rels))}.`;
}

/** What the marks mean, in words: said once beside every table and picture. */
export const MARKS_TEXT = `${STATUS_STYLE.removed.symbol} marks what was removed, ${STATUS_STYLE.added.symbol} what was added and ${STATUS_STYLE.changed.symbol} what changed; an unchanged element carries no mark.`;

/** One row of the table of changes. */
export interface ChangeRow {
  kind: 'node' | 'relationship';
  /** The element's identity in the diff (DiffNode.id or DiffRel.id). */
  id: string;
  status: Status;
  /** `− removed`. */
  change: string;
  /** `Nimbus Labs (:Organization, id "org-11")` or `Nimbus Labs -[:IN_CITY]-> Austin`. */
  element: string;
  /** What changed on a changed element; '' otherwise. */
  what: string;
}

/** The table of changes: every element that is not unchanged, nodes first, in the diff's order. */
export function changeRows(diff: Diff): ChangeRow[] {
  const name = new Map(diff.nodes.map((n) => [n.id, n.caption]));
  const tag = (s: Status) => `${STATUS_STYLE[s].symbol} ${STATUS_STYLE[s].word}`.trim();
  return [
    ...diff.nodes.filter((n) => n.status !== 'unchanged').map((n): ChangeRow => ({
      kind: 'node',
      id: n.id,
      status: n.status,
      change: tag(n.status),
      element: `${n.caption} (${labelText(n.labels)}, ${diff.key} ${n.keyText})`,
      what: n.changes.map((c) => c.text).join('; '),
    })),
    ...diff.rels.filter((r) => r.status !== 'unchanged').map((r): ChangeRow => ({
      kind: 'relationship',
      id: r.id,
      status: r.status,
      change: tag(r.status),
      element: `${name.get(r.from) ?? r.from} -[:${r.type}]-> ${name.get(r.to) ?? r.to}`,
      what: r.changes.map((c) => c.text).join('; '),
    })),
  ];
}

/** A node's caption as the view draws it: the status symbol first. */
export const markedCaption = (n: Pick<DiffNode, 'status' | 'caption'>) => `${STATUS_STYLE[n.status].symbol ? `${STATUS_STYLE[n.status].symbol} ` : ''}${n.caption}`;
/** A relationship's caption as the view draws it: the status symbol, then the type. */
export const markedType = (r: Pick<DiffRel, 'status' | 'type'>) => `${STATUS_STYLE[r.status].symbol ? `${STATUS_STYLE[r.status].symbol} ` : ''}${r.type}`;

// ---------------------------------------------------------------- the layout

/** Layout units from a node to the ring of its neighbours, at least. */
export const LINK = 120;
/** Layout units between neighbouring nodes on one ring, at least. */
export const ARC = 54;

/**
 * Positions for the union of both states, the same on every run and
 * computed before anything is drawn, so nothing moves on screen: each
 * connected part is a radial tree out from its most linked node (rings by
 * distance, each node's sector as wide as the leaves under it, a ring pushed
 * out until its nodes are ARC apart), the parts side by side. A node's
 * neighbours are ordered by the status of the link that reaches them, then
 * by label and caption, so what was removed, added or changed sits together.
 */
export function layoutDiff(diff: Diff): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const ids = diff.nodes.map((n) => n.id).sort();
  if (!ids.length) return out;
  const node = new Map(diff.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, { to: string; status: Status }[]>(ids.map((id) => [id, []]));
  for (const r of diff.rels) {
    if (r.from === r.to || !adj.has(r.from) || !adj.has(r.to)) continue;
    adj.get(r.from)!.push({ to: r.to, status: r.status });
    adj.get(r.to)!.push({ to: r.from, status: r.status });
  }
  const rank = (s: Status) => STATUSES.indexOf(s);
  const linkRank = (id: string, to: string) => Math.min(...adj.get(id)!.filter((e) => e.to === to).map((e) => rank(e.status)));
  const sortKey = (n: DiffNode) => `${labelText(n.labels)}\u0000${n.caption}\u0000${n.id}`;
  const degree = (id: string) => new Set(adj.get(id)!.map((e) => e.to)).size;
  const placed = new Set<string>();
  let offsetX = 0;
  const roots = ids.slice().sort((p, q) => degree(q) - degree(p) || (p < q ? -1 : 1));
  for (const root of roots) {
    if (placed.has(root)) continue;
    // The breadth-first tree of this part.
    const children = new Map<string, string[]>();
    const depth = new Map<string, number>([[root, 0]]);
    placed.add(root);
    const queue = [root];
    while (queue.length) {
      const v = queue.shift()!;
      const next = [...new Set(adj.get(v)!.map((e) => e.to))]
        .filter((w) => !placed.has(w))
        .sort((p, q) => linkRank(v, p) - linkRank(v, q) || (sortKey(node.get(p)!) < sortKey(node.get(q)!) ? -1 : 1));
      for (const w of next) {
        placed.add(w);
        depth.set(w, depth.get(v)! + 1);
        queue.push(w);
      }
      children.set(v, next);
    }
    const leaves = new Map<string, number>();
    const count = (v: string): number => {
      const kids = children.get(v) ?? [];
      const n = kids.length ? kids.reduce((t, k) => t + count(k), 0) : 1;
      leaves.set(v, n);
      return n;
    };
    count(root);
    // Each ring's radius: LINK per step out, or more when its nodes would sit closer than ARC.
    const perRing = new Map<number, number>();
    for (const d of depth.values()) perRing.set(d, (perRing.get(d) ?? 0) + 1);
    const radius = new Map<number, number>([[0, 0]]);
    const deepest = Math.max(...depth.values());
    for (let d = 1; d <= deepest; d++) {
      const need = (perRing.get(d)! * ARC) / (2 * Math.PI);
      radius.set(d, Math.max(radius.get(d - 1)! + LINK, need));
    }
    const local = new Map<string, { x: number; y: number }>();
    const place = (v: string, from: number, to: number) => {
      const d = depth.get(v)!;
      const angle = (from + to) / 2;
      local.set(v, { x: radius.get(d)! * Math.cos(angle), y: radius.get(d)! * Math.sin(angle) });
      let at = from;
      for (const k of children.get(v) ?? []) {
        const share = ((to - from) * leaves.get(k)!) / leaves.get(v)!;
        place(k, at, at + share);
        at += share;
      }
    };
    // The first neighbour starts at the top, and the ring goes clockwise.
    place(root, -Math.PI / 2, (3 * Math.PI) / 2);
    const extent = radius.get(deepest)!;
    for (const [id, p] of local) out.set(id, { x: Math.round((p.x + offsetX + extent) * 10) / 10, y: Math.round(p.y * 10) / 10 });
    offsetX += 2 * extent + LINK;
  }
  return out;
}

// `:::graph-diff{before=<cell> after=<cell> key=<property>}`: the graph
// diff (DOCS-PLAN.md §7.3, ADR-0051). Two cells of the page return a graph
// state each, before and after a change the page makes between them (a
// migration); the element matches their nodes by the `key` property and
// their relationships by type and the key of each end, and shows what was
// added, removed or changed, and what stayed, in one view with a table of
// the changes beside it.
//
// Live (src/scripts/docs/elements/graph-diff.ts), it first draws the
// recorded diff, then on Compare runs the page's cells from the first to
// `after` again, as they stand in the page (a reader's edit included), on a
// database of its own (`page.scratch()`): running a migration a second time
// on the page's database would change what the page's later cells return,
// and the page cannot rewind it.
//
// Static form: what was compared and how, the counts, and the table of
// changes from the two recordings, then the diff drawn in the site's
// colours, light and dark, with the layout the live view starts from
// (_graph-diff-model.ts). Each status has a symbol and a line pattern as
// well as a colour.

import { bothThemes, esc, markdownTable, mix, siteTokens, svgFrame, type DiagramColors, type Theme } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import {
  changeRows,
  countsOf,
  diffGraphs,
  graphFromRows,
  layoutDiff,
  MARKS_TEXT,
  markedCaption,
  markedType,
  STATUS_STYLE,
  STATUSES,
  summaryText,
  type Diff,
  type DiffNode,
  type Status,
} from './_graph-diff-model.ts';

const ATTRIBUTES = new Set(['id', 'before', 'after', 'key']);
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** The most nodes the picture draws; a larger diff is drawn live only, and the static form says so. */
const MAX_PICTURE_NODES = 80;

interface Envelope {
  rows?: unknown[];
  error?: string | null;
}

const envelopeOf = (input: ElementInput, id: string): Envelope | null => (input.recordings[id]?.envelope as Envelope | null | undefined) ?? null;

/** The recorded diff, or why there is none. */
function recordedDiff(input: ElementInput): { diff: Diff | null; problems: string[] } {
  const a = input.attributes;
  const problems: string[] = [];
  const states = (['before', 'after'] as const).map((role) => {
    const env = envelopeOf(input, a[role]);
    if (!env) problems.push(`cell \`${a[role]}\` (\`${role}\`) has no recording (record the page)`);
    else if (env.error) problems.push(`cell \`${a[role]}\` (\`${role}\`) recorded an error: ${env.error}`);
    const state = graphFromRows(env?.rows);
    if (env && !env.error && !state.nodes.length) problems.push(`cell \`${a[role]}\` (\`${role}\`) returns no nodes; the diff compares the nodes and relationships two cells return`);
    return state;
  });
  if (problems.length) return { diff: null, problems };
  const diff = diffGraphs(states[0], states[1], a.key);
  return { diff, problems: diff.problems.map((p) => `the recordings: ${p}`) };
}

/** A token the diagram colours do not carry, for one theme. */
const token = (theme: Theme, name: string) => {
  const v = siteTokens()[theme][name];
  if (!v) throw new Error(`base.css has no ${name} token`);
  return v;
};

/** Each status's stroke and fill in one theme. */
function statusColors(theme: Theme, c: DiagramColors): Record<Status, { stroke: string; fill: string }> {
  const rel = token(theme, '--rel');
  return {
    removed: { stroke: c.flow.bad.stroke, fill: c.node },
    added: { stroke: c.flow.good.stroke, fill: c.flow.good.fill },
    changed: { stroke: rel, fill: mix(rel, c.surface, 0.16) },
    unchanged: { stroke: c.line, fill: c.node },
  };
}

const WIDTHS: Record<Status, number> = { removed: 2, added: 3, changed: 2, unchanged: 1.2 };
const R = 11;
/** A caption longer than this is cut, with an ellipsis, in the picture; the table holds it whole. */
const CAPTION_MAX = 24;

/** The diff as an SVG in one theme: a legend row, then the graph with each status's colour, symbol and line. */
function drawDiff(diff: Diff, id: string, theme: Theme, c: DiagramColors, title: string): string {
  const pos = layoutDiff(diff);
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const W = 760;
  const LEGEND = 60;
  // Captions run outward along their spokes, so the margin all round is the longest caption's length.
  const label = (n: DiffNode) => {
    const text = markedCaption(n);
    return text.length > CAPTION_MAX ? `${text.slice(0, CAPTION_MAX - 1)}…` : text;
  };
  const CHAR = 6.4; // a caption character's width at its size, near enough to keep the captions inside the frame
  const PAD = Math.min(200, Math.max(48, Math.max(...diff.nodes.map((n) => label(n).length)) * CHAR + R + 12));
  const scale = Math.min(1.4, (W - 2 * PAD) / Math.max(maxX - minX, 1));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Laid out about the picture's centre first, then moved down so the topmost caption clears the legend.
  const raw = (nid: string) => {
    const p = pos.get(nid)!;
    return { x: W / 2 + (p.x - cx) * scale, y: (p.y - cy) * scale };
  };
  let top = Infinity;
  let bottom = -Infinity;
  for (const n of diff.nodes) {
    const p = raw(n.id);
    const d = Math.hypot(p.x - W / 2, p.y);
    const reach = R + 5 + label(n).length * CHAR;
    const uy = d < 1 ? 1 : p.y / d;
    top = Math.min(top, p.y - R, p.y + uy * reach - 8);
    bottom = Math.max(bottom, p.y + R + (d < 1 ? 22 : 0), p.y + uy * reach + 8);
  }
  const shift = LEGEND + 14 - top;
  const H = Math.ceil(shift + bottom + 14);
  const at = (nid: string) => {
    const p = raw(nid);
    return { x: p.x, y: p.y + shift };
  };
  const centre = { x: W / 2, y: shift };
  const colors = statusColors(theme, c);
  const counts = { node: countsOf(diff.nodes), rel: countsOf(diff.rels) };
  const f = (v: number) => v.toFixed(1);

  const markers = STATUSES.map(
    (s) => `<marker id="${id}-arrow-${s}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${colors[s].stroke}"/></marker>`,
  ).join('');
  // Relationships first, under the nodes. Parallel ones (the same two nodes) bend apart; each runs from one
  // circle's edge to the other's, its marked type along it, turned to read left to right.
  const pairOf = (r: { from: string; to: string }) => (r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`);
  const pairs = new Map<string, number>();
  for (const r of diff.rels) pairs.set(pairOf(r), (pairs.get(pairOf(r)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const lines = diff.rels
    .map((r) => {
      const pair = pairOf(r);
      const k = seen.get(pair) ?? 0;
      seen.set(pair, k + 1);
      const m = pairs.get(pair)!;
      const p = at(r.from);
      const q = at(r.to);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      // The bend, in pixels, off the straight line, measured on the pair's own direction so both ways agree.
      const bend = (k - (m - 1) / 2) * Math.max(24, d * 0.16) * (r.from < r.to ? 1 : -1);
      const [nx, ny] = [-dy / d, dx / d];
      const mid = { x: (p.x + q.x) / 2 + nx * bend, y: (p.y + q.y) / 2 + ny * bend };
      const toward = (from: { x: number; y: number }, by: number) => {
        const vx = mid.x - from.x;
        const vy = mid.y - from.y;
        const vd = Math.hypot(vx, vy) || 1;
        return { x: from.x + (vx / vd) * by, y: from.y + (vy / vd) * by };
      };
      const a = toward(p, R);
      const b = toward(q, R + 2);
      const st = STATUS_STYLE[r.status];
      const path = bend === 0 ? `M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}` : `M${f(a.x)} ${f(a.y)}Q${f(mid.x)} ${f(mid.y)} ${f(b.x)} ${f(b.y)}`;
      // The label past the middle, toward the end node, where a ring's spokes are further apart.
      const t = 0.6;
      const ctl = bend === 0 ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : mid;
      const lx = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * ctl.x + t ** 2 * b.x;
      const ly = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * ctl.y + t ** 2 * b.y;
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
      return (
        `<path class="r-${r.status}" d="${path}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} marker-end="url(#${id}-arrow-${r.status})"/>` +
        `<text class="rl" x="${f(lx)}" y="${f(ly)}" dy="-0.3em" text-anchor="middle" transform="rotate(${f(angle)} ${f(lx)} ${f(ly)})">${esc(markedType(r))}</text>`
      );
    })
    .join('');
  const nodes = diff.nodes
    .map((n) => {
      const p = at(n.id);
      const st = STATUS_STYLE[n.status];
      // The caption runs outward from the picture's centre along the node's spoke, so the captions of a ring
      // never cross each other or the spokes; a node at the centre has its caption under it.
      const ax = p.x - centre.x;
      const ay = p.y - centre.y;
      const ad = Math.hypot(ax, ay);
      const centred = ad < 1;
      const [ux, uy] = centred ? [0, 1] : [ax / ad, ay / ad];
      const tx = p.x + ux * (R + 5);
      const ty = p.y + uy * (R + 5) + (centred ? 8 : 0);
      const turn = (Math.atan2(uy, ux) * 180) / Math.PI;
      const anchor = centred ? 'middle' : ux >= 0 ? 'start' : 'end';
      const rotate = centred ? '' : ` transform="rotate(${f(ux >= 0 ? turn : turn + 180)} ${f(tx)} ${f(ty)})"`;
      return (
        `<circle class="n-${n.status}" cx="${f(p.x)}" cy="${f(p.y)}" r="${R}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>` +
        (st.symbol ? `<text class="sym" x="${f(p.x)}" y="${f(p.y)}" dy="0.35em" text-anchor="middle">${esc(st.symbol)}</text>` : '') +
        `<text class="nl${n.status === 'unchanged' ? '' : ' is-marked'}" x="${f(tx)}" y="${f(ty)}" dy="0.35em" text-anchor="${anchor}"${rotate}>${esc(label(n))}</text>`
      );
    })
    .join('');
  // The legend, two by two: each status's sample line and circle, its symbol, its word and its counts.
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const legend = STATUSES.map((s, i) => {
    const st = STATUS_STYLE[s];
    const lx = i % 2 === 0 ? 12 : W / 2;
    const ly = i < 2 ? 18 : 42;
    const text = `${st.symbol ? `${st.symbol} ` : ''}${st.word}: ${plural(counts.node[s], 'node')}, ${plural(counts.rel[s], 'relationship')}`;
    return (
      `<line class="r-${s}" x1="${lx}" y1="${ly}" x2="${lx + 26}" y2="${ly}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>` +
      `<circle class="n-${s}" cx="${lx + 36}" cy="${ly}" r="6"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>` +
      `<text class="lg" x="${lx + 50}" y="${ly}" dy="0.35em">${esc(text)}</text>`
    );
  }).join('');
  const style =
    STATUSES.map((s) => `#${id} .r-${s}{stroke:${colors[s].stroke};stroke-width:${WIDTHS[s]};fill:none}#${id} .n-${s}{fill:${colors[s].fill};stroke:${colors[s].stroke};stroke-width:${s === 'unchanged' ? 1.2 : 2}}`).join('') +
    `#${id} .sym{font-size:14px;font-weight:700;fill:${c.fg}}` +
    `#${id} .nl,#${id} .rl{paint-order:stroke;stroke:${c.surface};stroke-width:3px;stroke-linejoin:round}` +
    `#${id} .nl{font-size:11.5px;fill:${c.fgMuted}}#${id} .nl.is-marked{font-weight:600;fill:${c.fg}}` +
    `#${id} .rl{font-size:10px;fill:${c.fgMuted}}` +
    `#${id} .lg{font-size:12px;fill:${c.fg}}` +
    `#${id} .rule{stroke:${c.rule}}`;
  const rows = changeRows(diff);
  const desc =
    `${summaryText(diff)} ${MARKS_TEXT} ` +
    (rows.length ? `The changes: ${rows.map((r) => `${r.element} ${r.change}${r.what ? ` (${r.what})` : ''}`).join('; ')}.` : 'Nothing changed.');
  const body = `<defs>${markers}</defs>${legend}<line class="rule" x1="0" y1="${LEGEND}" x2="${W}" y2="${LEGEND}"/>${lines}${nodes}`;
  return svgFrame({ id, width: W, height: H, title, desc, style, body });
}

export default {
  live: 'the diff is drawn in a graph view beside the table of changes, and Compare runs the page\'s cells again, from the first to the after cell and with any edit you made to them, on a separate in-memory database in your browser, apart from the page\'s database, then draws the new diff; choosing a row of the table marks its element in the view.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes \`before=<cell>\`, \`after=<cell>\`, \`key=<property>\` and \`id\`, not \`${k}\``);
    const at = (id: string) => input.cells.find((c) => c.id === id);
    for (const role of ['before', 'after'] as const) {
      const id = a[role];
      if (!id) out.push(`needs \`${role}=<cell>\``);
      else if (!at(id)) out.push(`\`${role}\` names \`${id}\`, which is not a cell on the page`);
      else if (at(id)!.expectError) out.push(`\`${role}\` names cell \`${id}\`, which is expected to fail`);
    }
    if (!a.key) out.push('needs `key=<property>`, the property that names a node in both states');
    else if (!KEY.test(a.key)) out.push(`\`key\` is a property name (letters, digits and _), not \`${a.key}\``);
    if (out.length) return out;
    if (at(a.before)!.index >= at(a.after)!.index) out.push('the `before` cell comes before the `after` cell on the page');
    if (out.length) return out;
    return recordedDiff(input).problems;
  },
  staticForm(input) {
    const a = input.attributes;
    const { diff } = recordedDiff(input);
    const rows = changeRows(diff!);
    const intro =
      `The graph diff compares what cell \`${a.before}\` returned with what cell \`${a.after}\` returned, as recorded. ` +
      `A node is matched by its \`${a.key}\` property, and a relationship by its type and the \`${a.key}\` of the node at each end; ` +
      'element ids are not compared, since a store need not keep them from one run to the next.';
    const table = rows.length
      ? markdownTable(['Change', 'Element', 'What changed'], rows.map((r) => [r.change, r.element, r.what || '-']))
      : 'Nothing was added, removed or changed.';
    const parts = [intro, `${summaryText(diff!)} ${MARKS_TEXT}`, table];
    const drawn = diff!.nodes.length <= MAX_PICTURE_NODES;
    if (!drawn) parts.push(`The two states hold ${diff!.nodes.length} nodes, more than the ${MAX_PICTURE_NODES} the recorded picture draws; the live view draws them all.`);
    const text = parts.join('\n\n');
    if (!drawn) return { text };
    const caption = `What changed between cells ${a.before} and ${a.after}, as recorded`;
    const pictures = bothThemes((theme, c) => drawDiff(diff!, `${input.id}-${theme}`, theme, c, caption));
    return { text, caption, ...pictures };
  },
} satisfies ElementSpec;

// `:::vector-explorer`: what a vector search does, drawn from the page's own
// data and statements (DOCS-PLAN.md §7.3). Two views, chosen by attributes:
//
//   :::vector-explorer{data=<block> cell=<id> [filter=<id>] [euclidean=<id>] [group=<field>] …}
//     The scatter. The vectors of a ```json data= block, projected to two
//     dimensions by PCA when the page is recorded (pca2, by power
//     iteration, deterministic), the question vector from the ranking
//     cell's parameters, and the top k of that cell's recording ringed.
//     Live, a k slider runs the cell's statement with $k; `filter` names the
//     same search with a pre-filter inside it, whose survivors the engine
//     reports (the rest grey out); `euclidean` names a statement that ranks
//     by the other similarity function.
//
//   :::vector-explorer{lists="<id>,<id>" [fuse=<id>] [constant=60] [weights="0.7,0.3"] [max=<n>]}
//     The hybrid view. Two or more ranked lists, each a cell that returns
//     `id` in rank order with LIMIT $k, fused by reciprocal rank
//     (1/(60 + rank) from each list). `fuse` names the page's own fused
//     statement: the recorded fusion must agree with it, or docs:check
//     fails, and live the view runs it beside the arithmetic. `max` stops
//     the k slider at the number of ids the page's lists can return (default
//     and ceiling: MAX_K).
//
// The static form is the first frame, from the recordings: the top k as a
// table and the scatter as an SVG (light and dark), or the lists and the
// fusion as tables. The browser module reads the projection back from the
// picture's data attributes, so the page ships the coordinates once.

import { bothThemes, esc, markdownTable, outline, PALETTE, svgFrame } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import { fuse, pca2, pointsOf, project, queryField, shareFormula, type Fused, type Point } from './_vector-explorer-math.ts';

const SCATTER = ['data', 'cell', 'filter', 'euclidean', 'key', 'text', 'group', 'vector', 'query'];
const HYBRID = ['lists', 'fuse', 'constant', 'weights', 'max'];
const ATTRIBUTES = new Set(['id', ...SCATTER, ...HYBRID]);
/** The slider's range: k from 1 to this, or the number of points when fewer. */
export const MAX_K = 10;

type Envelope = { columns?: string[]; rows?: Record<string, unknown>[]; error?: string | null };
const envelopeOf = (input: ElementInput, id: string) => (input.recordings[id]?.envelope ?? null) as Envelope | null;
const paramsOf = (input: ElementInput, cellId: string): Record<string, unknown> | null => {
  const cell = input.cells.find((c) => c.id === cellId);
  if (!cell?.params) return null;
  try {
    return JSON.parse(input.dataBlocks[cell.params] ?? 'null');
  } catch {
    return null;
  }
};
const listAttr = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const fields = (a: Record<string, string>) => ({ key: a.key || 'id', text: a.text || 'text', group: a.group || null, vector: a.vector || null });

/** A cell the element runs: it exists, takes a parameters block with `k`, and its statement reads `$k`. */
function rankingCellProblems(input: ElementInput, attr: string, id: string, key: string): string[] {
  const cell = input.cells.find((c) => c.id === id);
  if (!cell) return [`\`${attr}\` names \`${id}\`, which is not a cell on the page`];
  const out: string[] = [];
  const params = paramsOf(input, id);
  if (!params) out.push(`\`${attr}\`: cell \`${id}\` takes no parameters block (\`params=<name>\`); the element sets \`k\` in it`);
  else if (typeof params.k !== 'number') out.push(`\`${attr}\`: cell \`${id}\`'s parameters have no number \`k\``);
  if (!/\$k\b/.test(cell.code)) out.push(`\`${attr}\`: cell \`${id}\` does not read \`$k\`, so a k slider cannot change it`);
  if (cell.expectError) out.push(`\`${attr}\`: cell \`${id}\` is expected to fail`);
  const env = envelopeOf(input, id);
  if (env && !env.columns?.includes(key)) out.push(`\`${attr}\`: cell \`${id}\` returns no \`${key}\` column (its columns: ${(env.columns ?? []).join(', ') || 'none'})`);
  return out;
}

const recordedIds = (input: ElementInput, cellId: string, key: string) => (envelopeOf(input, cellId)?.rows ?? []).map((r) => String(r[key]));

// ---------------------------------------------------------------- the scatter

/** What the scatter is made of, from the page: the points, their projection, the question, and the recorded top k. */
export function scatterModel(input: ElementInput) {
  const a = input.attributes;
  const f = fields(a);
  const block = input.dataBlocks[a.data];
  if (block === undefined) throw new Error(`\`data\` names \`${a.data}\`, which is not a \`json data=\` block on the page`);
  const { list, points } = pointsOf(JSON.parse(block), f);
  const dims = points[0].vector.length;
  const params = paramsOf(input, a.cell) ?? {};
  const qField = queryField(params, dims, a.query || null);
  if (!qField) throw new Error(`cell \`${a.cell}\`'s parameters hold no ${a.query ? `\`${a.query}\` ` : ''}vector of ${dims} numbers (the question)`);
  const pca = pca2(points.map((p) => p.vector));
  const xy = points.map((p) => project(p.vector, pca));
  const query = project(params[qField] as number[], pca);
  const k = params.k as number;
  const top = recordedIds(input, a.cell, f.key);
  return { list, points, xy, query, pca, dims, k, top, params, qField };
}

const pct = (v: number, total: number) => `${((100 * v) / total).toFixed(1)}%`;
const r5 = (v: number) => String(Math.round(v * 1e5) / 1e5);

/** Each group's colour: the label palette, in the groups' sorted order (the live view reads the colours back from the picture). */
export function groupColors(points: readonly Point[]): Map<string, string> {
  const groups = [...new Set(points.map((p) => p.group))].sort();
  return new Map(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
}

function scatterForm(input: ElementInput) {
  const m = scatterModel(input);
  const a = input.attributes;
  const env = envelopeOf(input, a.cell);
  const columns = env?.columns ?? [];
  const rows = env?.rows ?? [];
  const cell = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const question = typeof m.params.q === 'string' ? ` for "${m.params.q}"` : '';
  const table = markdownTable(['Rank', ...columns], rows.map((r, i) => [i + 1, ...columns.map((c) => cell(r[c]))]));
  const [v1, v2] = m.pca.variances;
  const text =
    `The top ${rows.length} by \`${a.cell}\`${question}, as recorded with k = ${m.k}:\n\n${table}\n\n` +
    `The picture places the ${m.points.length} vectors of the \`${a.data}\` block (${m.dims} dimensions) on their first two principal components, ` +
    `which hold ${pct(v1, m.pca.total)} and ${pct(v2, m.pca.total)} of the variance, computed when the page was recorded. ` +
    `The cross is the question vector \`${m.qField}\`, and the rings mark the top ${rows.length}, numbered by rank.`;
  const caption = `The ${m.points.length} vectors of \`${a.data}\` on two principal components, with the question and its top ${rows.length}`.replace(/`/g, '');
  const colors = groupColors(m.points);

  // Equal scale on both axes, so distances in the picture are distances on the plane.
  const W = 640;
  const pad = 22;
  const xs = [...m.xy.map((p) => p[0]), m.query[0]];
  const ys = [...m.xy.map((p) => p[1]), m.query[1]];
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 2 * pad) / (x1 - x0 || 1), 400 / (y1 - y0 || 1));
  const plotH = Math.ceil((y1 - y0) * scale + 2 * pad + 14);
  const sx = (x: number) => pad + (x - x0) * scale + ((W - 2 * pad) - (x1 - x0) * scale) / 2;
  const sy = (y: number) => plotH - pad - (y - y0) * scale; // up is the second component's positive side
  const groups = [...colors.keys()].filter(Boolean);
  const legendY = plotH + 8;
  const perRow = 4;
  const height = legendY + Math.ceil((groups.length + 2) / perRow) * 22 + 6;
  const rank = new Map(m.top.map((id, i) => [id, i + 1]));

  const pictures = bothThemes((theme, c) => {
    const id = `${input.id}-${theme}`;
    const s = `#${id}`;
    const style =
      `${s} .axis{stroke:${c.rule};stroke-width:1;stroke-dasharray:4 4}` +
      `${s} .axis-label{font-size:11px;fill:${c.fgMuted}}` +
      `${s} .pt{stroke-width:1.2}` +
      `${s} .ring{fill:none;stroke:${c.flow.accent.stroke};stroke-width:2.2}` +
      `${s} .rank{font-size:11px;font-weight:600;fill:${c.fg};stroke:${c.surface};stroke-width:3px;paint-order:stroke}` +
      `${s} .query{fill:none;stroke:${c.fg};stroke-width:2}` +
      `${s} .query-label{font-size:12px;font-weight:600;fill:${c.fg};stroke:${c.surface};stroke-width:3px;paint-order:stroke}` +
      `${s} .legend{font-size:12px;fill:${c.fg}}`;
    const ox = sx(0);
    const oy = sy(0);
    const axes =
      `<line class="axis" x1="${pad}" y1="${oy.toFixed(1)}" x2="${W - pad}" y2="${oy.toFixed(1)}"/>` +
      `<line class="axis" x1="${ox.toFixed(1)}" y1="${pad - 8}" x2="${ox.toFixed(1)}" y2="${plotH - pad + 8}"/>` +
      `<text class="axis-label" x="${W - pad}" y="${(oy - 6).toFixed(1)}" text-anchor="end">PC1 · ${pct(v1, m.pca.total)} of variance</text>` +
      `<text class="axis-label" x="${(ox + 6).toFixed(1)}" y="${pad - 8}" dy="0.7em">PC2 · ${pct(v2, m.pca.total)}</text>`;
    const pts = m.points
      .map((p, i) => {
        const [x, y] = m.xy[i];
        const color = colors.get(p.group)!;
        return (
          `<circle class="pt" cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="5" fill="${color}" stroke="${outline(color)}" ` +
          `data-id="${esc(p.id)}" data-group="${esc(p.group)}" data-x="${r5(x)}" data-y="${r5(y)}"><title>${esc(`${p.id}${p.group ? ` (${p.group})` : ''}: ${p.text}`)}</title></circle>`
        );
      })
      .join('');
    const rings = m.points
      .map((p, i) => {
        const n = rank.get(p.id);
        if (!n) return '';
        const [x, y] = [sx(m.xy[i][0]), sy(m.xy[i][1])];
        return `<circle class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9"/><text class="rank" x="${(x + 10).toFixed(1)}" y="${(y - 9).toFixed(1)}">${n}</text>`;
      })
      .join('');
    const [qx, qy] = [sx(m.query[0]), sy(m.query[1])];
    const query =
      `<g data-query="${esc(m.qField)}" data-x="${r5(m.query[0])}" data-y="${r5(m.query[1])}">` +
      `<circle class="query" cx="${qx.toFixed(1)}" cy="${qy.toFixed(1)}" r="7"/>` +
      `<path class="query" d="M${(qx - 11).toFixed(1)} ${qy.toFixed(1)}H${(qx + 11).toFixed(1)}M${qx.toFixed(1)} ${(qy - 11).toFixed(1)}V${(qy + 11).toFixed(1)}"/>` +
      `<text class="query-label" x="${(qx + 13).toFixed(1)}" y="${(qy + 16).toFixed(1)}">question</text></g>`;
    const items = [
      ...groups.map((g) => ({ mark: `<circle class="pt" cx="6" cy="0" r="5" fill="${colors.get(g)}" stroke="${outline(colors.get(g)!)}"/>`, label: g })),
      { mark: `<circle class="ring" cx="6" cy="0" r="6"/>`, label: `top ${rows.length}` },
      { mark: `<path class="query" d="M-1 0H13M6 -7V7"/>`, label: 'question' },
    ];
    const colW = (W - 2 * pad) / perRow;
    const legend = items
      .map((it, i) => {
        const x = pad + (i % perRow) * colW;
        const y = legendY + Math.floor(i / perRow) * 22 + 10;
        return `<g transform="translate(${x.toFixed(1)},${y})">${it.mark}<text class="legend" x="18" dy="0.35em">${esc(it.label)}</text></g>`;
      })
      .join('');
    const desc =
      `${m.points.length} points on the first two principal components. The question sits at (${m.query[0].toFixed(3)}, ${m.query[1].toFixed(3)}). ` +
      `Top ${rows.length}: ${m.top.join(', ')}.` +
      (groups.length ? ` Colour shows ${a.group}: ${groups.join(', ')}.` : '');
    return svgFrame({
      id,
      width: W,
      height,
      title: caption,
      desc,
      style,
      body: `${axes}<g class="points" data-list="${esc(m.list)}" data-dims="${m.dims}">${pts}</g>${rings}${query}${legend}`,
    });
  });
  return { text, caption, ...pictures };
}

// ---------------------------------------------------------------- the hybrid view

/** The recorded lists and their fusion. */
export function hybridModel(input: ElementInput): { lists: { cell: string; ids: string[]; weight: number }[]; fused: Fused[]; constant: number; k: number } {
  const a = input.attributes;
  const ids = listAttr(a.lists);
  const weights = listAttr(a.weights).map(Number);
  const constant = a.constant ? Number(a.constant) : 60;
  const lists = ids.map((cell, i) => ({ cell, ids: recordedIds(input, cell, 'id'), weight: weights[i] ?? 1 }));
  const fused = fuse(lists.map((l) => ({ name: l.cell, ids: l.ids, weight: l.weight })), constant);
  const k = (paramsOf(input, ids[0])?.k as number) ?? 0;
  return { lists, fused, constant, k };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;

function hybridForm(input: ElementInput) {
  const { lists, fused, constant, k } = hybridModel(input);
  const q = paramsOf(input, lists[0].cell)?.q;
  const depth = Math.max(...lists.map((l) => l.ids.length));
  const listTable = markdownTable(
    ['Rank', ...lists.map((l) => `\`${l.cell}\``)],
    Array.from({ length: depth }, (_, i) => [i + 1, ...lists.map((l) => (l.ids[i] ? `\`${l.ids[i]}\`` : ''))]),
  );
  const weighted = lists.some((l) => l.weight !== 1);
  const fusedTable = markdownTable(
    ['id', ...lists.map((l) => `Rank in \`${l.cell}\``), 'Arithmetic', 'Fused score'],
    fused.map((f) => [`\`${f.id}\``, ...lists.map((l) => f.shares.find((s) => s.list === l.cell)?.rank ?? ''), shareFormula(f, constant), round4(f.score)]),
  );
  const text =
    `The ${lists.length} ranked lists${typeof q === 'string' ? ` for "${q}"` : ''}, as recorded with k = ${k}:\n\n${listTable}\n\n` +
    `Fused by reciprocal rank: each list gives an id ${weighted ? 'its weight' : '1'} / (${constant} + its rank there), and the shares add up. ` +
    `${fused.length} ids, best first:\n\n${fusedTable}`;
  return { text };
}

// ---------------------------------------------------------------- the spec

export default {
  live: 'a k slider runs the page\'s search statements on its database in your browser with that k, and the view marks the ids the engine returns.',
  validate(input) {
    const a = input.attributes;
    const out: string[] = [];
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes ${[...ATTRIBUTES].filter((x) => x !== 'id').map((x) => `\`${x}\``).join(', ')} and \`id\`, not \`${k}\``);
    const scatter = 'data' in a || 'cell' in a;
    const hybrid = 'lists' in a;
    if (scatter === hybrid) return [...out, 'is either the scatter (`data=<block> cell=<id>`) or the hybrid view (`lists="<id>,<id>"`), one of the two'];
    if (scatter) {
      for (const k of HYBRID) if (k in a) out.push(`\`${k}\` belongs to the hybrid view (\`lists=\`)`);
      if (!a.data) out.push('the scatter needs `data=<json data block>`');
      if (!a.cell) out.push('the scatter needs `cell=<id>`: the cell whose search ranks the points');
      const key = fields(a).key;
      for (const attr of ['cell', 'filter', 'euclidean']) if (a[attr]) out.push(...rankingCellProblems(input, attr, a[attr], key));
      if (out.length) return out;
      try {
        const m = scatterModel(input);
        if (m.points.length < 3) out.push(`\`${a.data}\` holds ${m.points.length} points; a projection needs three or more`);
        const known = new Set(m.points.map((p) => p.id));
        for (const id of m.top) if (!known.has(id)) out.push(`cell \`${a.cell}\` recorded \`${id}\`, which is not a point of \`${a.data}\``);
        if (a.group && m.points.every((p) => !p.group)) out.push(`no point of \`${a.data}\` has the field \`${a.group}\``);
      } catch (e) {
        out.push((e as Error).message);
      }
      return out;
    }
    for (const k of SCATTER) if (k in a) out.push(`\`${k}\` belongs to the scatter (\`data=\`, \`cell=\`)`);
    const ids = listAttr(a.lists);
    if (ids.length < 2) out.push('`lists` names two or more cells, comma-separated');
    for (const id of ids) out.push(...rankingCellProblems(input, 'lists', id, 'id'));
    if (a.fuse && !input.cells.some((c) => c.id === a.fuse)) out.push(`\`fuse\` names \`${a.fuse}\`, which is not a cell on the page`);
    if (a.constant && !(Number(a.constant) > 0)) out.push('`constant` is a positive number');
    const weights = listAttr(a.weights);
    if (weights.length && (weights.length !== ids.length || weights.some((w) => !(Number(w) > 0)))) out.push('`weights` is one positive number per list');
    if (a.max !== undefined) {
      const max = Number(a.max);
      const k = paramsOf(input, ids[0])?.k;
      if (!Number.isInteger(max) || max < 1 || max > MAX_K) out.push(`\`max\` is a whole number from 1 to ${MAX_K}`);
      else if (typeof k === 'number' && k > max) out.push(`\`max\` (${max}) is below the recorded k (${k})`);
    }
    if (out.length) return out;
    // The fusion the page shows is arithmetic on the recorded lists: it must
    // be the engine's, so the page's own fused statement has to agree.
    if (a.fuse) {
      const env = envelopeOf(input, a.fuse);
      const { fused } = hybridModel(input);
      const col = env?.columns?.find((c) => /rrf|score|fused/i.test(c));
      if (!env?.rows || !col || !env.columns?.includes('id')) out.push(`\`fuse\`: cell \`${a.fuse}\` returns no \`id\` and fused score (\`rrf\`) columns`);
      else {
        env.rows.forEach((r, i) => {
          const f = fused[i];
          if (!f || f.id !== String(r.id) || round4(f.score) !== round4(Number(r[col]))) {
            out.push(`\`fuse\`: cell \`${a.fuse}\` ranks \`${String(r.id)}\` ${i + 1} with ${String(r[col])}; the arithmetic on the recorded lists gives ${f ? `\`${f.id}\` ${round4(f.score)}` : 'no id there'}`);
          }
        });
      }
    }
    return out;
  },
  staticForm(input) {
    return 'lists' in input.attributes ? hybridForm(input) : scatterForm(input);
  },
} satisfies ElementSpec;

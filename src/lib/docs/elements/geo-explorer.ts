// `:::geo-explorer{points=… radius=… box=… index=…}`: the geospatial
// explorer (DOCS-PLAN.md §7.3), the hero of guides/cypher/geospatial. It
// draws the page's places on a plane and searches them with the page's own
// radius and box cells, the shape's position as their parameters; a button
// creates or drops the page's point index, and each run's parse, plan and
// execute times and the scan's reads show for the index off and on.
//
// Every attribute names a cell on the page, so what the explorer runs is
// what the page teaches:
//   points  a cell returning `name`, `latitude`, `longitude` (and `kind`): the places drawn
//   radius  the radius search, parameters `{lat, lon, radius}`: the circle, and the plane's origin
//   box     the box search, parameters `{south, west, north, east}` (optional)
//   index   the cell that creates the point index (optional)
//   extent  meters around the circle's center that the plane covers (optional; five radii)
//
// Static form: the radius search's recorded result as a table, then the first
// frame drawn at record time (the places, the default circle, the places it
// returned lit with their names), light and dark. The plane's geometry is
// shared with the browser module (_geo-explorer-plane.ts), so the first frame
// is what the live plane starts from.

import { bothThemes, esc, markdownTable, svgFrame } from '../element-kit.ts';
import type { ElementInput, ElementSpec } from '../elements.ts';
import {
  cellText,
  boxFrom,
  circleFrom,
  listing,
  makePlane,
  matchedNames,
  metersToPx,
  offPlaneText,
  placesFromRows,
  pointIndex,
  spanMeters,
  toPx,
  type Plane,
} from './_geo-explorer-plane.ts';

const ATTRIBUTES = new Set(['id', 'points', 'radius', 'box', 'index', 'extent']);

interface Envelope {
  columns?: string[];
  columnTypes?: string[];
  rows?: Record<string, unknown>[];
  error?: string | null;
}

const envelopeOf = (input: ElementInput, id: string | undefined): Envelope | null => (id ? ((input.recordings[id]?.envelope as Envelope | null | undefined) ?? null) : null);
const cellOf = (input: ElementInput, id: string | undefined) => (id ? input.cells.find((c) => c.id === id) : undefined);

function paramsOf(input: ElementInput, id: string | undefined): Record<string, unknown> | null {
  const name = cellOf(input, id)?.params;
  const text = name ? input.dataBlocks[name] : undefined;
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A scale bar length near a fifth of the plane: 1, 2 or 5 times a power of ten meters. */
function scaleBar(plane: Plane): { meters: number; label: string } {
  const target = spanMeters(plane) / 5;
  const p = 10 ** Math.floor(Math.log10(target));
  const m = [5, 2, 1].map((f) => f * p).find((v) => v <= target) ?? p;
  return { meters: m, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

export default {
  // `box` and `index` are optional, so the sentence names them as the page may have them.
  live: 'the circle drags across the plane (arrow keys move it, plus and minus resize it), and each move runs the radius search again on the page\'s database in your browser with the circle as its parameters, lighting up the places it returns and showing the parse, plan and execute times and the scan\'s database hits; where the page has a box search, a box drags and searches the same way, and where it names its point index, a button creates or drops the index and searches again.',
  validate(input) {
    const out: string[] = [];
    const a = input.attributes;
    for (const k of Object.keys(a)) if (!ATTRIBUTES.has(k)) out.push(`takes \`points\`, \`radius\`, \`box\`, \`index\`, \`extent\` and \`id\`, not \`${k}\``);
    for (const k of ['points', 'radius']) if (!a[k]) out.push(`needs \`${k}=<cell id>\``);
    for (const k of ['points', 'radius', 'box', 'index']) if (a[k] && !cellOf(input, a[k])) out.push(`\`${k}\` names \`${a[k]}\`, which is not a cell on the page`);
    if (a.extent !== undefined && !(Number(a.extent) > 0)) out.push('`extent` is a distance in meters, above 0');
    if (out.length) return out;
    const points = envelopeOf(input, a.points);
    if (!points || points.error || !placesFromRows(points.rows ?? []).length) out.push(`the \`${a.points}\` cell's recording has no rows with \`name\`, \`latitude\` and \`longitude\` (record the page)`);
    const circle = circleFrom(paramsOf(input, a.radius));
    if (!circle) out.push(`the \`${a.radius}\` cell takes its parameters from a data block with numbers \`lat\`, \`lon\` and \`radius\``);
    const radiusCode = cellOf(input, a.radius)!.code;
    for (const p of ['$lat', '$lon', '$radius']) if (!radiusCode.includes(p)) out.push(`the \`${a.radius}\` cell does not use \`${p}\``);
    const radius = envelopeOf(input, a.radius);
    if (!radius || radius.error || !radius.columns?.includes('name')) out.push(`the \`${a.radius}\` cell's recording has no \`name\` column`);
    if (a.box) {
      if (!boxFrom(paramsOf(input, a.box))) out.push(`the \`${a.box}\` cell takes its parameters from a data block with numbers \`south\` < \`north\` and \`west\` < \`east\``);
      const boxCode = cellOf(input, a.box)!.code;
      for (const p of ['$south', '$west', '$north', '$east']) if (!boxCode.includes(p)) out.push(`the \`${a.box}\` cell does not use \`${p}\``);
      const box = envelopeOf(input, a.box);
      if (!box || box.error || !box.columns?.includes('name')) out.push(`the \`${a.box}\` cell's recording has no \`name\` column`);
    }
    if (a.index && !pointIndex(cellOf(input, a.index)!.code)) out.push(`the \`${a.index}\` cell is not a \`CREATE POINT INDEX <name> FOR (v:Label) ON (v.property)\``);
    const a0 = input.cells.findIndex((c) => c.id === a.points);
    for (const k of ['radius', 'box', 'index']) if (a[k] && input.cells.findIndex((c) => c.id === a[k]) < a0) out.push(`the \`${k}\` cell comes before the \`points\` cell, which the explorer runs first`);
    return out;
  },
  staticForm(input) {
    const a = input.attributes;
    const places = placesFromRows(envelopeOf(input, a.points)?.rows ?? []);
    const circle = circleFrom(paramsOf(input, a.radius))!;
    const box = a.box ? boxFrom(paramsOf(input, a.box)) : null;
    const plane = makePlane(places, circle, box, a.extent ? Number(a.extent) : undefined);
    const result = envelopeOf(input, a.radius)!;
    const rows = result.rows ?? [];
    const columns = result.columns ?? [];
    const lit = matchedNames(rows);
    const off = offPlaneText(plane);
    const where = `latitude ${circle.lat}, longitude ${circle.lon}`;
    const text = [
      `The \`${a.radius}\` cell's recorded result: ${rows.length === 1 ? '1 place' : `${rows.length} places`} within ${circle.radius} m of ${where}.`,
      markdownTable(columns, rows.map((r) => columns.map((c, i) => cellText(r[c], result.columnTypes?.[i])))),
      ...(off ? [`Not drawn, beyond the plane: ${off}.`] : []),
    ].join('\n\n');

    const bar = scaleBar(plane);
    const pictures = bothThemes((theme, c) => {
      const id = `${input.id}-${theme}`;
      const [cx, cy] = toPx(plane, circle.lat, circle.lon);
      const r = metersToPx(plane, circle.radius);
      const W = plane.width;
      const H = plane.height;
      const dots = plane.onPlane
        .map((p) => {
          const [x, y] = toPx(plane, p.lat, p.lon);
          const on = lit.has(p.name);
          const right = x < W - 150;
          return (
            `<circle class="${on ? 'hit' : 'miss'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 7 : 5.5}"/>` +
            `<text class="${on ? 'name' : 'other'}" x="${(x + (right ? 11 : -11)).toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" text-anchor="${right ? 'start' : 'end'}">${esc(p.name)}</text>`
          );
        })
        .join('');
      const offNote = plane.offPlane.length
        ? `<text class="note" x="${W - 10}" y="18" text-anchor="end">${esc(`${plane.offPlane.length} more beyond the plane: ${off}`)}</text>`
        : '';
      const sb = metersToPx(plane, bar.meters);
      const body =
        `<rect class="plane" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6"/>` +
        `<circle class="area" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/>` +
        `<path class="center" d="M${(cx - 6).toFixed(1)} ${cy.toFixed(1)}h12M${cx.toFixed(1)} ${(cy - 6).toFixed(1)}v12"/>` +
        dots +
        offNote +
        `<path class="bar" d="M12 ${H - 14}v-6M12 ${H - 17}h${sb.toFixed(1)}M${(12 + sb).toFixed(1)} ${H - 14}v-6"/>` +
        `<text class="note" x="${(18 + sb).toFixed(1)}" y="${H - 17}" dy="0.35em">${esc(bar.label)}</text>`;
      const style =
        `#${id} .plane{fill:${c.node};stroke:${c.rule}}` +
        `#${id} .area{fill:${c.flow.accent.fill};stroke:${c.flow.accent.stroke};stroke-width:2;fill-opacity:0.7}` +
        `#${id} .center,#${id} .bar{stroke:${c.fgMuted};stroke-width:1.5;fill:none}` +
        `#${id} .hit{fill:${c.flow.accent.stroke};stroke:${c.fg};stroke-width:1.5}` +
        `#${id} .miss{fill:${c.node};stroke:${c.fgMuted};stroke-width:1.5}` +
        `#${id} .name,#${id} .other{paint-order:stroke;stroke:${c.node};stroke-width:3px;stroke-linejoin:round}` +
        `#${id} .name{font-size:13px;font-weight:600;fill:${c.fg}}` +
        `#${id} .other{font-size:12px;fill:${c.fgMuted}}` +
        `#${id} .note{font-size:12px;fill:${c.fgMuted}}`;
      const missed = plane.onPlane.filter((p) => !lit.has(p.name)).map((p) => p.name);
      const desc =
        `${plane.onPlane.length} places on a plane, longitude across and latitude up, with the radius search's circle of ${circle.radius} m around ${where}. ` +
        `Lit, with their names: ${listing([...lit]) || 'none'}. Outside the circle: ${listing(missed) || 'none'}.` +
        (off ? ` Beyond the plane: ${off}.` : '');
      return svgFrame({ id, width: W, height: H, title: `The places and the radius search, as recorded`, desc, style, body });
    });
    return { text, caption: `The places, and the ${circle.radius} m radius search as recorded`, ...pictures };
  },
} satisfies ElementSpec;

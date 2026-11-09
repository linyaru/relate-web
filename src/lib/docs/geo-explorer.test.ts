// Tests for `:::geo-explorer`'s build side (src/lib/docs/elements/geo-explorer.ts)
// and the plane both it and the browser module draw from
// (src/lib/docs/elements/_geo-explorer-plane.ts), on the geospatial guide's
// own cells and recordings: the projection round trip, which places the
// page's plane draws, the clamps, the index parsing, the table's FLOAT
// spelling, and what validate refuses.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import geo from './elements/geo-explorer.ts';
import type { ElementInput } from './elements.ts';
import type { PageCell, RecordedCell } from './results.ts';
import {
  cellText,
  circleFrom,
  clampBox,
  clampCircle,
  direction,
  makePlane,
  placesFromRows,
  pointIndex,
  spanMeters,
  toLatLon,
  toPx,
  type Place,
} from './elements/_geo-explorer-plane.ts';

const PAGE = new URL('../../content/docs/guides/cypher/geospatial.mdx', import.meta.url);
const RESULTS = new URL('../../content/docs/guides/cypher/geospatial.results.json', import.meta.url);

/** The guide's cells, data blocks and recordings, as the element registry hands them over (cells read from the fences). */
function pageInput(attributes: Record<string, string> = { points: 'places', radius: 'radius', box: 'bbox', index: 'create-index' }): ElementInput {
  const src = readFileSync(PAGE, 'utf8');
  const cells: PageCell[] = [];
  for (const m of src.matchAll(/```cypher run([^\n]*)\n([\s\S]*?)\n```/g)) {
    const info = m[1];
    const name = /\bname=([\w-]+)/.exec(info)?.[1] ?? null;
    if (!name) continue;
    cells.push({ id: name, name, code: m[2], params: /\bparams=([\w-]+)/.exec(info)?.[1] ?? null, expectError: false, index: cells.length + 1, title: null, line: null });
  }
  const dataBlocks: Record<string, string> = {};
  for (const m of src.matchAll(/```json data=([\w-]+)\n([\s\S]*?)\n```/g)) dataBlocks[m[1]] = m[2];
  const recordings = (JSON.parse(readFileSync(RESULTS, 'utf8')) as { cells: Record<string, RecordedCell> }).cells;
  return { name: 'geo-explorer', id: 'element-geo-explorer-1', attributes, children: '', page: { id: 'guides/cypher/geospatial', file: PAGE.pathname }, cells, dataBlocks, recordings };
}

const places = (input: ElementInput): Place[] => placesFromRows(((input.recordings.places.envelope as { rows: Record<string, unknown>[] }).rows));
const here = (input: ElementInput) => circleFrom(JSON.parse(input.dataBlocks.here))!;

test('toLatLon undoes toPx', () => {
  const input = pageInput();
  const plane = makePlane(places(input), here(input), null);
  for (const p of places(input)) {
    const [x, y] = toPx(plane, p.lat, p.lon);
    const [lat, lon] = toLatLon(plane, x, y);
    assert.ok(Math.abs(lat - p.lat) < 1e-9 && Math.abs(lon - p.lon) < 1e-9, `${p.name}: ${lat}, ${lon}`);
  }
});

test("the page's plane draws the six Portland places and names the two Seattle ones to the north-east", () => {
  const input = pageInput();
  const box = JSON.parse(input.dataBlocks.box);
  const plane = makePlane(places(input), here(input), box);
  assert.equal(plane.onPlane.length, 6);
  assert.deepEqual(plane.offPlane.map((p) => p.name).sort(), ['North Library', 'Pier Cafe']);
  for (const p of plane.offPlane) assert.equal(direction(plane, p), 'north-east');
  // Every drawn place, the circle and the box lie inside the plane.
  for (const p of plane.onPlane) {
    const [x, y] = toPx(plane, p.lat, p.lon);
    assert.ok(x >= 0 && x <= plane.width && y >= 0 && y <= plane.height, p.name);
  }
  const aspect = plane.height / plane.width;
  assert.ok(aspect >= 0.5 - 1e-3 && aspect <= 0.75 + 1e-3, `aspect ${aspect}`);
});

test('clampCircle keeps the center on the plane and the radius between 1/40 and 1/2 of its width', () => {
  const input = pageInput();
  const plane = makePlane(places(input), here(input), null);
  const span = spanMeters(plane);
  const far = clampCircle(plane, { lat: 60, lon: -100, radius: 1e9 });
  const [x, y] = toPx(plane, far.lat, far.lon);
  assert.ok(x >= -1 && x <= plane.width + 1 && y >= -1 && y <= plane.height + 1, `${x}, ${y}`);
  assert.ok(far.radius <= Math.round(span / 2 / 10) * 10, `${far.radius}`);
  assert.ok(clampCircle(plane, { ...here(input), radius: 1 }).radius >= Math.round(span / 40 / 10) * 10);
  assert.deepEqual(clampCircle(plane, here(input)), here(input), 'the page circle is already on the plane');
  const box = clampBox(plane, { south: 45.53, west: -122.65, north: 45.5, east: -122.7 });
  assert.ok(box.south < box.north && box.west < box.east, 'clampBox orders the corners');
});

test('pointIndex reads the page CREATE cell and nothing else', () => {
  const input = pageInput();
  const create = input.cells.find((c) => c.id === 'create-index')!;
  assert.deepEqual(pointIndex(create.code), { name: 'place_loc', label: 'Place', property: 'loc' });
  assert.equal(pointIndex('CREATE INDEX place_name FOR (p:Place) ON (p.name)'), null);
  assert.equal(pointIndex('MATCH (p:Place) RETURN p'), null);
});

test('cellText keeps a whole FLOAT decimal point, as the cell and the CLI print it', () => {
  assert.equal(cellText(393, 'FLOAT'), '393.0');
  assert.equal(cellText(393, 'INTEGER'), '393');
  assert.equal(cellText(393.5, 'FLOAT'), '393.5');
  assert.equal(cellText(null, 'FLOAT'), 'null');
  assert.equal(cellText('Pier Cafe', 'STRING'), 'Pier Cafe');
});

test("validate passes the page's directive and fails a radius cell without $radius", () => {
  assert.deepEqual(geo.validate!(pageInput()), []);
  const broken = pageInput();
  const radius = broken.cells.find((c) => c.id === 'radius')!;
  radius.code = radius.code.replaceAll('$radius', '2000');
  assert.ok(geo.validate!(broken).some((m) => m.includes('does not use `$radius`')), geo.validate!(broken).join('; '));
  assert.ok(geo.validate!(pageInput({ points: 'places' })).some((m) => m.includes('needs `radius=')));
  assert.ok(geo.validate!(pageInput({ points: 'places', radius: 'radius', colour: 'red' })).some((m) => m.includes('not `colour`')));
  assert.ok(geo.validate!(pageInput({ points: 'places', radius: 'radius', index: 'radius' })).some((m) => m.includes('is not a `CREATE POINT INDEX')));
});

test('the static form prints the recorded table with FLOAT meters and names the places beyond the plane', () => {
  const form = geo.staticForm(pageInput());
  assert.match(form.text, /recorded result: 4 places within 2000 m of latitude 45\.5231, longitude -122\.6765\./);
  assert.match(form.text, /\| 393\.0 \|/);
  assert.match(form.text, /Not drawn, beyond the plane: to the north-east, North Library and Pier Cafe\./);
  assert.ok(form.svgLight && form.svgDark);
});

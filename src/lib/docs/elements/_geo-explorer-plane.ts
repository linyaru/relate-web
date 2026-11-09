// The plane of `:::geo-explorer` (src/lib/docs/elements/geo-explorer.ts):
// the geometry its static form draws at record time and its browser module
// (src/scripts/docs/elements/geo-explorer.ts) draws live, so the first frame
// and the live plane are the same picture. No Node imports: the browser
// module bundles it.
//
// The projection is equirectangular around the search circle's center
// (longitude scaled by the cosine of its latitude), in meters, with the
// engine's Earth radius (the haversine radius the geospatial guide states).
// It only places the drawing: which places a shape finds is always the
// engine's answer, never computed here.

/** The Earth radius relate's `point.distance` uses for geographic points, in meters. */
export const EARTH_RADIUS = 6_378_140;
/** The plane's width in SVG user units; its height follows the places' spread. */
export const PLANE_WIDTH = 640;

export interface Place {
  name: string;
  lat: number;
  lon: number;
  kind?: string;
}
/** A search circle: center and radius in meters (the radius cell's `$lat`, `$lon`, `$radius`). */
export interface Circle {
  lat: number;
  lon: number;
  radius: number;
}
/** A search box: the box cell's `$south`, `$west`, `$north`, `$east`. */
export interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Plane {
  width: number;
  height: number;
  /** The projection's origin, the default circle's center. */
  lat0: number;
  lon0: number;
  /** cos(lat0): meters per degree of longitude, relative to latitude. */
  k: number;
  /** The plane's west and north edges in meters from the origin, and px per meter. */
  minX: number;
  maxY: number;
  scale: number;
  /** The places drawn, and the ones too far from the circle to draw (a search without the index still reads them). */
  onPlane: Place[];
  offPlane: Place[];
}

const RAD = Math.PI / 180;

/** Meters east and north of the plane's origin. */
function meters(lat0: number, lon0: number, k: number, lat: number, lon: number): [number, number] {
  return [EARTH_RADIUS * (lon - lon0) * RAD * k, EARTH_RADIUS * (lat - lat0) * RAD];
}

/**
 * The plane around `circle`: the places within `extent` meters of its center
 * (five radii by default), the circle and the box, padded, at an aspect
 * between 2:1 and 4:3 so it reads on a phone and on a desk.
 */
export function makePlane(places: Place[], circle: Circle, box: Box | null, extent = circle.radius * 5): Plane {
  const lat0 = circle.lat;
  const lon0 = circle.lon;
  const k = Math.cos(lat0 * RAD);
  const at = (lat: number, lon: number) => meters(lat0, lon0, k, lat, lon);
  const onPlane: Place[] = [];
  const offPlane: Place[] = [];
  for (const p of places) (Math.hypot(...at(p.lat, p.lon)) <= extent ? onPlane : offPlane).push(p);
  const xs = [-circle.radius, circle.radius];
  const ys = [-circle.radius, circle.radius];
  for (const p of onPlane) {
    const [x, y] = at(p.lat, p.lon);
    xs.push(x);
    ys.push(y);
  }
  if (box) {
    for (const [lat, lon] of [[box.south, box.west], [box.north, box.east]]) {
      const [x, y] = at(lat, lon);
      xs.push(x);
      ys.push(y);
    }
  }
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12;
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;
  // Widen the short side about its middle to an aspect between 2:1 and 4:3.
  let spanX = maxX - minX;
  let spanY = maxY - minY;
  if (spanY / spanX < 0.5) {
    const grow = (spanX * 0.5 - spanY) / 2;
    minY -= grow;
    maxY += grow;
    spanY = spanX * 0.5;
  } else if (spanY / spanX > 0.75) {
    const grow = (spanY / 0.75 - spanX) / 2;
    minX -= grow;
    maxX += grow;
    spanX = spanY / 0.75;
  }
  const scale = PLANE_WIDTH / spanX;
  return { width: PLANE_WIDTH, height: Math.round(spanY * scale), lat0, lon0, k, minX, maxY, scale, onPlane, offPlane };
}

/** A latitude and longitude to plane coordinates (y grows downwards). */
export function toPx(plane: Plane, lat: number, lon: number): [number, number] {
  const [x, y] = meters(plane.lat0, plane.lon0, plane.k, lat, lon);
  return [(x - plane.minX) * plane.scale, (plane.maxY - y) * plane.scale];
}

/** Plane coordinates back to a latitude and longitude. */
export function toLatLon(plane: Plane, px: number, py: number): [number, number] {
  const x = px / plane.scale + plane.minX;
  const y = plane.maxY - py / plane.scale;
  return [plane.lat0 + y / EARTH_RADIUS / RAD, plane.lon0 + x / (EARTH_RADIUS * plane.k) / RAD];
}

/** The plane's length of `m` meters. */
export const metersToPx = (plane: Plane, m: number) => m * plane.scale;

/** Four decimals of a degree, about 11 m: the precision the explorer sends. */
export const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
/** A radius to the nearest 10 m. */
export const round10 = (n: number) => Math.round(n / 10) * 10;

/** The plane's west-east width in meters. */
export const spanMeters = (plane: Plane) => plane.width / plane.scale;

/** `circle` with its center on the plane and a radius between 1/40 and 1/2 of the plane's width, rounded as sent. */
export function clampCircle(plane: Plane, c: Circle): Circle {
  const [x, y] = toPx(plane, c.lat, c.lon);
  const [lat, lon] = toLatLon(plane, Math.min(plane.width, Math.max(0, x)), Math.min(plane.height, Math.max(0, y)));
  const span = spanMeters(plane);
  return { lat: round4(lat), lon: round4(lon), radius: Math.max(round10(span / 40), Math.min(round10(span / 2), round10(c.radius))) };
}

/** `box` inside the plane, at least 1/20 of its width on each side, corners ordered, rounded as sent. */
export function clampBox(plane: Plane, b: Box): Box {
  const [x1, y1] = toPx(plane, b.north, b.west);
  const [x2, y2] = toPx(plane, b.south, b.east);
  const min = plane.width / 20;
  let w = Math.max(min, Math.min(plane.width, Math.abs(x2 - x1)));
  let h = Math.max(min, Math.min(plane.height, Math.abs(y2 - y1)));
  w = Math.min(w, plane.width);
  h = Math.min(h, plane.height);
  const left = Math.min(plane.width - w, Math.max(0, Math.min(x1, x2)));
  const top = Math.min(plane.height - h, Math.max(0, Math.min(y1, y2)));
  const [north, west] = toLatLon(plane, left, top);
  const [south, east] = toLatLon(plane, left + w, top + h);
  return { south: round4(south), west: round4(west), north: round4(north), east: round4(east) };
}

/** Which way a place off the plane lies: "north", "south-east", … */
export function direction(plane: Plane, p: Place): string {
  const [x, y] = toPx(plane, p.lat, p.lon);
  const ns = y < 0 ? 'north' : y > plane.height ? 'south' : '';
  const ew = x < 0 ? 'west' : x > plane.width ? 'east' : '';
  return [ns, ew].filter(Boolean).join('-') || 'beyond the edge';
}

/** "A", "A and B", "A, B and C". */
export function listing(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Off-plane places grouped by direction: "to the north: Pier Cafe and North Library". */
export function offPlaneText(plane: Plane): string {
  const by = new Map<string, string[]>();
  for (const p of plane.offPlane) {
    const d = direction(plane, p);
    by.set(d, [...(by.get(d) ?? []), p.name]);
  }
  return [...by].map(([d, names]) => `to the ${d}, ${listing(names)}`).join('; ');
}

/** The places a result lists: rows with `name`, `latitude` and `longitude` (and `kind`), skipping any without coordinates. */
export function placesFromRows(rows: Record<string, unknown>[]): Place[] {
  const out: Place[] = [];
  for (const r of rows) {
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    if (typeof r.name !== 'string' || r.latitude == null || r.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ name: r.name, lat, lon, ...(typeof r.kind === 'string' ? { kind: r.kind } : {}) });
  }
  return out;
}

/** A circle from a parameters object (`{lat, lon, radius}`), or null. */
export function circleFrom(params: Record<string, unknown> | null): Circle | null {
  const n = (k: string) => (typeof params?.[k] === 'number' ? (params[k] as number) : NaN);
  const c = { lat: n('lat'), lon: n('lon'), radius: n('radius') };
  return Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.radius > 0 ? c : null;
}

/** A box from a parameters object (`{south, west, north, east}`), or null. */
export function boxFrom(params: Record<string, unknown> | null): Box | null {
  const n = (k: string) => (typeof params?.[k] === 'number' ? (params[k] as number) : NaN);
  const b = { south: n('south'), west: n('west'), north: n('north'), east: n('east') };
  return Object.values(b).every(Number.isFinite) && b.south < b.north && b.west < b.east ? b : null;
}

/** The names a search result returned (its `name` column). */
export const matchedNames = (rows: Record<string, unknown>[]) => new Set(rows.flatMap((r) => (typeof r.name === 'string' ? [r.name] : [])));

/** The point index a `CREATE POINT INDEX <name> … FOR (v:Label) ON (v.prop)` statement creates, or null. */
export function pointIndex(code: string): { name: string; label: string; property: string } | null {
  const m = /CREATE\s+POINT\s+INDEX\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+IF\s+NOT\s+EXISTS)?\s+FOR\s+\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\s+ON\s+\(\s*\2\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/i.exec(code);
  return m ? { name: m[1], label: m[3], property: m[4] } : null;
}

/**
 * A result value as the explorer's tables show it, static and live alike:
 * strings bare, numbers as the engine wrote them. A whole FLOAT travels as
 * JSON without its `.0`; the column type puts it back, as the cell's own
 * table and `relate --mode table` print it (393.0, not 393).
 */
export function cellText(v: unknown, type?: string): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  if (type === 'FLOAT' && typeof v === 'number' && Number.isInteger(v)) return v.toFixed(1);
  return String(v);
}

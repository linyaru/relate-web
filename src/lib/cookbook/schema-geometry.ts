// Geometry of the data-model drawings (ADR-0135): where a relationship's
// line, arrowhead, and caption go, and the plane geometry the layout checks a
// drawing with. Ported from the Relate repository's lib/schema-geometry.mjs.
//
// Every relationship is drawn as one cubic Bézier curve {start, c1, c2, end}:
// a straight line and a quadratic bend are raised to a cubic exactly
// (`toCubic`), so everything downstream handles one shape.

import type { CaptionSize } from './schema-text.ts';

export interface Point {
  x: number;
  y: number;
}

export interface Cubic {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
}

/** A relationship's drawn geometry: its curve, arrowhead, and caption placement. */
export interface EdgeGeometry extends Cubic {
  head: Point[] | null;
  length?: number;
  caption: Point & { angle: number; top: number };
}

/** A circle placed in the drawing. */
export interface Circle extends Point {
  r: number;
}

/** What the geometry needs of a relationship. */
export interface GeoEdge {
  s: Circle;
  t: Circle;
  pair: [Circle, Circle];
  bend: number;
  arrow: boolean;
  cap: CaptionSize;
  geo: EdgeGeometry;
}

export const HEAD = 10; // arrowhead length
// A relationship from a node to itself: a loop LOOP_FOOT wide where it meets
// the node, flaring LOOP_FLARE radians out on each side, its control points
// LOOP from the node.
export const LOOP = 58;
const LOOP_FOOT = 15;
const LOOP_FLARE = 0.62;

export const unit = (from: Point, to: Point): Point => {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};
export const along = (p: Point, d: Point, k: number): Point => ({ x: p.x + d.x * k, y: p.y + d.y * k });
export const polar = (a: number): Point => ({ x: Math.cos(a), y: Math.sin(a) });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The point at `t` (0…1) of the Bézier curve on `points`, of any degree. */
export function bezierAt(points: Point[], t: number): Point {
  let ps = points;
  while (ps.length > 1) ps = ps.slice(1).map((p, i) => lerp(ps[i], p, t));
  return ps[0];
}

/**
 * The line or quadratic Bézier curve on `points` as the same curve of degree
 * three (degree elevation: a quadratic's c1 is 2/3 of the way from its start
 * to its control point; a line's are at its thirds).
 */
export function toCubic(points: Point[]): Cubic {
  let ps = points;
  while (ps.length < 4) {
    const n = ps.length;
    const prev = ps;
    ps = [prev[0], ...prev.slice(1).map((p, i) => lerp(p, prev[i], (i + 1) / n)), prev[n - 1]];
  }
  const [start, c1, c2, end] = ps;
  return { start, c1, c2, end };
}

const cubicPoints = (g: Cubic) => [g.start, g.c1, g.c2, g.end];

// An arrowhead with its tip at `tip`, pointing along `d`.
function arrowhead(tip: Point, d: Point): Point[] {
  const base = along(tip, d, -HEAD);
  const n = { x: -d.y, y: d.x };
  return [tip, along(base, n, HEAD * 0.45), along(base, n, -HEAD * 0.45)];
}

/**
 * A relationship between two nodes (`e.s`, `e.t`): straight, or bent `e.bend`
 * apart from others between the same pair (`e.pair`); its caption at the
 * middle, along it, upright.
 */
export function linkGeometry(e: Omit<GeoEdge, 'geo'>): EdgeGeometry {
  const { s, t } = e;
  const [a, b] = e.pair;
  const d = unit(a, b);
  const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  const control = along(mid, { x: -d.y, y: d.x }, 2 * e.bend);
  const aim = (n: Point, other: Point) => unit(n, e.bend ? control : other);
  const p0 = along(s, aim(s, t), s.r);
  const tip = along(t, aim(t, s), t.r + 1);
  const dir = unit(e.bend ? control : p0, tip);
  const end = e.arrow ? along(tip, dir, -HEAD * 0.7) : along(t, aim(t, s), t.r);
  // The curve on its end points, through `control` when bent.
  const curve = (from: Point, to: Point) => (e.bend ? [from, control, to] : [from, to]);
  const at = bezierAt(curve(p0, tip), 0.5);
  let angle = (Math.atan2(tip.y - p0.y, tip.x - p0.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle < -90) angle += 180;
  return {
    ...toCubic(curve(p0, end)),
    head: e.arrow ? arrowhead(tip, dir) : null,
    length: Math.hypot(tip.x - p0.x, tip.y - p0.y),
    caption: { ...at, angle, top: -e.cap.typeH / 2 },
  };
}

/** A relationship from node `n` to itself, leaving it at angle `theta`; its caption level, beyond the loop. */
export function loopGeometry(n: Circle, e: { arrow: boolean; cap: CaptionSize }, theta: number): EdgeGeometry {
  const half = Math.asin(Math.min(1, LOOP_FOOT / n.r)); // the loop's foot on the circle
  const start = along(n, polar(theta - half), n.r);
  const tip = along(n, polar(theta + half), n.r + 1);
  const c1 = along(start, polar(theta - LOOP_FLARE), LOOP);
  const c2 = along(tip, polar(theta + LOOP_FLARE), LOOP);
  const dir = unit(c2, tip);
  const apex = bezierAt([start, c1, c2, tip], 0.5);
  const out = polar(theta);
  const reach = (Math.abs(out.x) * e.cap.w) / 2 + (Math.abs(out.y) * e.cap.h) / 2 + 4;
  const at = along(apex, out, reach);
  return {
    start,
    c1,
    c2,
    end: e.arrow ? along(tip, dir, -HEAD * 0.7) : tip,
    head: e.arrow ? arrowhead(tip, dir) : null,
    caption: { x: at.x, y: at.y, angle: 0, top: -e.cap.h / 2 },
  };
}

/** The corners of a relationship's caption box. */
export function captionBox(e: { geo: EdgeGeometry; cap: CaptionSize }): Point[] {
  const { x, y, angle, top } = e.geo.caption;
  const a = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const w = e.cap.w / 2 + 3;
  return [
    [-w, top - 2],
    [w, top - 2],
    [w, top + e.cap.h + 2],
    [-w, top + e.cap.h + 2],
  ].map(([u, v]) => ({ x: x + u * cos - v * sin, y: y + u * sin + v * cos }));
}

/** Whether two convex polygons overlap (separating axes). */
export function polygonsOverlap(p: Point[], q: Point[]): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const n = { x: b.y - a.y, y: a.x - b.x };
      const project = (ps: Point[]) => ps.map((c) => c.x * n.x + c.y * n.y);
      const [pp, qq] = [project(p), project(q)];
      if (Math.max(...pp) <= Math.min(...qq) || Math.max(...qq) <= Math.min(...pp)) return false;
    }
  }
  return true;
}

/** Whether a circle overlaps a convex polygon. */
export function circleHitsPolygon(c: Point, r: number, poly: Point[]): boolean {
  const inside = poly.every((a, i) => {
    const b = poly[(i + 1) % poly.length];
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= 0;
  });
  if (inside) return true;
  return poly.some((a, i) => distanceToSegment(c, a, poly[(i + 1) % poly.length]) < r);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** Points along a relationship's line (its geometry), for overlap checks. */
export function linePoints(g: Cubic): Point[] {
  return Array.from({ length: 17 }, (_, i) => bezierAt(cubicPoints(g), i / 16));
}

export function segmentsCross(p: Point, q: Point, r: Point, s: Point): boolean {
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0;
}

export function polylinesCross(a: Point[], b: Point[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
  }
  return false;
}

/** A drawing's extent: circles, captions, lines. */
export function extent(nodes: Circle[], edges: { geo: EdgeGeometry; cap: CaptionSize }[]) {
  const points = [
    ...nodes.flatMap((n) => [
      { x: n.x - n.r - 1, y: n.y - n.r - 1 },
      { x: n.x + n.r + 1, y: n.y + n.r + 1 },
    ]),
    ...edges.flatMap((e) => [...captionBox(e), ...linePoints(e.geo)]),
  ];
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  return {
    minX,
    minY,
    width: Math.max(...points.map((p) => p.x)) - minX,
    height: Math.max(...points.map((p) => p.y)) - minY,
  };
}

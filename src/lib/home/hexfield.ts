// The demo block's pixel-hex field: faded hexagon tiles that thin out and shrink to single pixels
// away from an anchor corner. Pure string building for the browser (one layer per scenario, sized
// to the block); the tile tones are the CSS custom properties --t0 to --t4 of the layer.
export interface HexVariant {
  /** The corner the tiles radiate from: 'tl', 'tr', 'bl' or 'br'. */
  anchor: string;
  reach: number;
  radius: number;
  squash: number;
}

const S3 = Math.sqrt(3);
const hsh = (i: number, j: number, k: number): number => {
  let t = Math.imul(i * 374761393 + j * 668265263 + (17 + k) * 1442695041, 1274126177);
  t ^= t >>> 13;
  t = Math.imul(t, 1103515245);
  t ^= t >>> 16;
  return ((t >>> 0) % 10000) / 10000;
};

function pxhex(cx: number, cy: number, rad: number, P: number, n: number): string {
  const gx = Math.round(cx / P) * P, gy = Math.round(cy / P) * P;
  let d = '';
  for (let y = -Math.floor(rad / P) * P; y <= rad; y += P) {
    const ay = Math.abs(y + P / 2);
    if (ay > rad) continue;
    let hw = Math.min((rad * S3) / 2, (rad - ay) * S3);
    hw = Math.round(hw / P) * P;
    if (hw < P) continue;
    d += `M${gx - hw} ${gy + y}h${hw * 2}v${P}h-${hw * 2}z`;
  }
  return d ? `<path d="${d}" style="fill:var(--t${n})"/>` : '';
}

/** The inner markup of one layer's SVG for a w x h block. */
export function hexLayer(w: number, h: number, v: HexVariant): string {
  const R = w < 700 ? v.radius * 0.7 : v.radius;
  const P = Math.max(3, Math.round(R / 9));
  const ax = v.anchor[1] === 'l' ? 0 : w, ay = v.anchor[0] === 't' ? 0 : h;
  const reach = Math.max(w, h) * v.reach;
  let g = '';
  for (let r = -1; r <= Math.ceil(h / (R * 1.5)) + 1; r++) {
    for (let q = -Math.ceil(r / 2) - 2; q <= Math.ceil(w / (R * S3)) + 2; q++) {
      const cx = R * S3 * (q + r / 2), cy = R * 1.5 * r;
      if (cx < -R || cx > w + R || cy < -R || cy > h + R) continue;
      const d = Math.hypot(cx - ax, (cy - ay) * 1.15) / reach;
      if (d >= 0.9) continue;
      const k = hsh(q, r, 1), keep = Math.pow(1 - d, v.squash);
      if (hsh(q, r, 0) > keep * 1.08 + 0.04) continue;
      const sc = 1 - d * 0.72;
      if (sc < 0.36) continue;
      const rad = (R - 3) * sc;
      let n = d < 0.3 ? (k > 0.5 ? 2 : 0) : d < 0.6 ? (k > 0.5 ? 0 : 1) : k > 0.5 ? 1 : 3;
      if (k > 0.955) n = 4;
      if (sc < 0.5) {
        const hs = P * Math.max(1, Math.round((rad * 0.5) / P));
        g += `<rect x="${Math.round(cx / P) * P - hs / 2}" y="${Math.round(cy / P) * P - hs / 2}" width="${hs}" height="${hs}" style="fill:var(--t${n})"/>`;
      } else g += pxhex(cx, cy, rad, P, n);
    }
  }
  return g;
}

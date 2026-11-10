#!/usr/bin/env node
// Authoring-only: renders the site's icon set from public/favicon.svg with sharp
// (a dependency of Astro, so already installed) and commits the output:
//   public/favicon.ico            16, 32 and 48 px (PNG entries)
//   public/apple-touch-icon.png   180 px, full bleed (iOS rounds it)
//   public/icon-512.png           512 px, rounded like favicon.svg
//   public/icon-maskable-512.png  512 px, full bleed, the mark inside the 80% safe zone
// Run `node scripts/icons.mjs` after changing public/favicon.svg.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const svg = readFileSync(pub('favicon.svg'), 'utf8');
const BG = '#010609';
// The mark: everything after the background rect in favicon.svg (a 10×8 pixel shape at translate(3 4)).
const mark = svg.slice(svg.indexOf('/>') + 2, svg.lastIndexOf('</svg>'));

// Rasterise at the target size straight from the vector (no resampling), so the pixel edges stay sharp.
const render = (source, size) =>
  sharp(Buffer.from(source), { density: (72 * size) / 16 }).resize(size, size).png({ palette: false }).toBuffer();
const fullBleed = (pad) => {
  const box = 16 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${box} ${box}" shape-rendering="crispEdges"><rect x="${-pad}" y="${-pad}" width="${box}" height="${box}" fill="${BG}"/>${mark}</svg>`;
};

// A .ico whose entries are PNGs (supported everywhere since Vista).
function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...images.map((i) => i.data)]);
}

writeFileSync(pub('favicon.ico'), ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await render(svg, size) })))));
writeFileSync(pub('apple-touch-icon.png'), await render(fullBleed(1), 180));
writeFileSync(pub('icon-512.png'), await render(svg, 512));
writeFileSync(pub('icon-maskable-512.png'), await render(fullBleed(4), 512));
console.log('icons written to public/');

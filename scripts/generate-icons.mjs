/**
 * Generates the extension's PNG icons from `src/app/logo.svg`, with no external
 * dependency. Run it only when the logo changes: `node scripts/generate-icons.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'public', 'icons');
const LOGO = join(ROOT, 'src', 'app', 'logo.svg');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/*
 * The logo is one path of straight segments on a 156-unit square: its first
 * ring is the tile, the rest are the mark (the app cuts the mark out, even-odd,
 * and draws the file in its own ink). The icon paints them apart instead — a
 * black tile with the mark in white, so it reads on any toolbar.
 *
 * The Chrome Web Store wants the 128px icon's artwork inside 96px with 16px of
 * transparent margin, so that one is drawn inset by an eighth; the others use
 * the full square.
 */
const TILE = [0, 0, 0];
const MARK = [255, 255, 255];
const VIEW = 156;

function outlines() {
  const svg = readFileSync(LOGO, 'utf8');
  const d = svg.match(/ d="([^"]+)"/)[1];
  return d
    .split('Z')
    .filter((part) => part.trim())
    .map((part) =>
      [...part.matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)/g)].map((m) => [
        +m[1] / VIEW,
        +m[2] / VIEW,
      ]),
    );
}

/** A point is inside a ring when a ray from it crosses an odd number of edges. */
function inside(px, py, ring) {
  let odd = false;
  {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
        odd = !odd;
    }
  }
  return odd;
}

/** Colour of one pixel, antialiased by sampling an 8×8 grid inside it. */
function pixel(x, y, side, [tile, ...mark]) {
  const grid = 8;
  const m = side === 128 ? 0.125 : 0;
  let hits = 0;
  let white = 0;
  for (let sy = 0; sy < grid; sy++) {
    for (let sx = 0; sx < grid; sx++) {
      const px = ((x + (sx + 0.5) / grid) / side - m) / (1 - 2 * m);
      const py = ((y + (sy + 0.5) / grid) / side - m) / (1 - 2 * m);
      if (!inside(px, py, tile)) continue;
      hits++;
      if (mark.some((ring) => inside(px, py, ring))) white++;
    }
  }
  if (!hits) return [0, 0, 0, 0];
  const color = TILE.map((c, i) => Math.round(c + ((MARK[i] - c) * white) / hits));
  return [...color, Math.round((255 * hits) / (grid * grid))];
}

function png(side) {
  const raw = Buffer.alloc(side * (side * 4 + 1));
  const rings = outlines();
  let p = 0;
  for (let y = 0; y < side; y++) {
    raw[p++] = 0; // "none" filter
    for (let x = 0; x < side; x++) {
      const [r, g, b, a] = pixel(x, y, side, rings);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(side, 0);
  ihdr.writeUInt32BE(side, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(TARGET, { recursive: true });
for (const side of [16, 32, 48, 128]) {
  writeFileSync(join(TARGET, `${side}.png`), png(side));
  console.log(`icons/${side}.png`);
}

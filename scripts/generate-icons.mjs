/**
 * Generates the extension's PNG icons with no external dependency.
 * Run it only when the drawing changes: `node scripts/generate-icons.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'public', 'icons');

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
 * The drawing is the editor itself, reduced to three marks on the app's own
 * palette: a dimmed marker, a word in ink, and the accent caret after it —
 * what the scratchpad looks like mid-sentence. A hairline ring in the app's
 * border colour keeps the dark tile from dissolving into a dark toolbar.
 *
 * It is laid out on a 16-unit grid, so at 16 and 32 pixels every edge lands on
 * a whole pixel and stays crisp. The Chrome Web Store wants the 128px icon's
 * artwork inside 96px with 16px of transparent margin, so from 48px up the same
 * grid is drawn inset by an eighth; the toolbar sizes use the full square.
 */
const HAIR = [44, 44, 50];
const BG = [15, 15, 16];
const MARK = [124, 121, 114];
const INK = [232, 230, 226];
const ACCENT = [134, 169, 234];

function shapes(side) {
  const m = side >= 48 ? 0.125 : 0;
  const u = (1 - 2 * m) / 16;
  const at = (x, y, w, h, r, color) => ({
    x0: m + x * u,
    y0: m + y * u,
    x1: m + (x + w) * u,
    y1: m + (y + h) * u,
    r: r * u,
    color,
  });
  // One device pixel at the toolbar sizes, a touch more on the large ones.
  const ring = Math.max(1, side / 96) / side / u;
  return [
    at(0, 0, 16, 16, 4, HAIR),
    at(ring, ring, 16 - 2 * ring, 16 - 2 * ring, 4 - ring, BG),
    at(3, 7, 2, 2, 1, MARK),
    at(6, 7, 5, 2, 1, INK),
    at(12, 4, 1, 8, 0.5, ACCENT),
  ];
}

/** Signed distance to a rounded rectangle: negative inside, in unit lengths. */
function distance(px, py, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(px - cx) - (x1 - x0) / 2 + r;
  const qy = Math.abs(py - cy) - (y1 - y0) / 2 + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** Colour of one pixel, antialiased by sampling a 4×4 grid inside it. */
function pixel(x, y, side, drawing) {
  const grid = 4;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let sy = 0; sy < grid; sy++) {
    for (let sx = 0; sx < grid; sx++) {
      const px = (x + (sx + 0.5) / grid) / side;
      const py = (y + (sy + 0.5) / grid) / side;
      let color = null;
      for (const shape of drawing) if (distance(px, py, shape) <= 0) color = shape.color;
      if (!color) continue;
      r += color[0];
      g += color[1];
      b += color[2];
      a += 1;
    }
  }
  if (!a) return [0, 0, 0, 0];
  return [
    Math.round(r / a),
    Math.round(g / a),
    Math.round(b / a),
    Math.round((255 * a) / (grid * grid)),
  ];
}

function png(side) {
  const raw = Buffer.alloc(side * (side * 4 + 1));
  const drawing = shapes(side);
  let p = 0;
  for (let y = 0; y < side; y++) {
    raw[p++] = 0; // "none" filter
    for (let x = 0; x < side; x++) {
      const [r, g, b, a] = pixel(x, y, side, drawing);
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

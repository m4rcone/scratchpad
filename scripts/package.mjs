/**
 * Packs the built `dist/` into the zip the Chrome Web Store takes, with no
 * external tool: `rm` and `zip` are not there on Windows, and the release
 * workflow packs with this same script so the two never drift apart.
 * Sourcemaps stay out — they are a local debugging aid.
 *
 *   node scripts/package.mjs [out.zip]    (default: scratchpad.zip)
 */
import { crc32, deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = resolve(ROOT, process.argv[2] ?? 'scratchpad.zip');

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Zip keeps local wall-clock time at two-second resolution, from 1980 on. */
function dosTime(at) {
  const d = new Date(Math.max(at, new Date(1980, 0, 1).getTime()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

if (!statSync(join(DIST, 'manifest.json'), { throwIfNoEntry: false })) {
  console.error('dist/manifest.json is missing: run `npm run build` first.');
  process.exit(1);
}

const locals = [];
const centrals = [];
let offset = 0;

for (const path of files(DIST).sort()) {
  if (path.endsWith('.map')) continue;
  // Forward slashes whatever the OS: a zip names its entries that way.
  const name = Buffer.from(relative(DIST, path).split(sep).join('/'));
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const { time, date } = dosTime(statSync(path).mtimeMs);
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // names are UTF-8
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);

  locals.push(local, name, packed);
  centrals.push(central, name);
  offset += local.length + name.length + packed.length;
}

const directory = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(centrals.length / 2, 8);
end.writeUInt16LE(centrals.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

rmSync(OUT, { force: true });
writeFileSync(OUT, Buffer.concat([...locals, directory, end]));
console.log(`${relative(ROOT, OUT)}: ${centrals.length / 2} files`);

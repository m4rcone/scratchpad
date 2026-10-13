import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, readZip, writeZip } from './zip.ts';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('what is written reads back, names and text in UTF-8', async () => {
  const modified = new Date(2026, 9, 12, 14, 30, 8).getTime();
  const bytes = writeZip([
    { name: 'café.md', text: '# café\n\nçà 🚀', modified },
    { name: 'empty.md', text: '' },
  ]);
  const entries = await readZip(bytes);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.text]),
    [
      ['café.md', '# café\n\nçà 🚀'],
      ['empty.md', ''],
    ],
  );
  assert.equal(entries[0]!.modified, modified, 'to the two seconds zip keeps');
});

test('folders and OS litter are left out', async () => {
  const bytes = writeZip([
    { name: 'notes/', text: '' },
    { name: 'notes/a.md', text: 'a' },
    { name: '__MACOSX/notes/._a.md', text: 'junk' },
    { name: 'notes/.DS_Store', text: 'junk' },
  ]);
  assert.deepEqual(
    (await readZip(bytes)).map((entry) => entry.name),
    ['notes/a.md'],
  );
});

test('a deflated entry, as an OS zips it, is read too', async () => {
  // Built by hand from a stored archive: same layout, compressed data, method 8.
  const text = 'hello hello hello hello';
  const stored = writeZip([{ name: 'a.md', text }]);
  const packed = deflateRawSync(Buffer.from(text));
  const name = 4; // 'a.md'
  const local = stored.subarray(0, 30 + name);
  const rest = stored.subarray(30 + name + text.length);
  const out = new Uint8Array(local.length + packed.length + rest.length);
  out.set(local, 0);
  out.set(packed, local.length);
  out.set(rest, local.length + packed.length);
  const view = new DataView(out.buffer);
  view.setUint16(8, 8, true);
  view.setUint32(18, packed.length, true);
  const central = local.length + packed.length;
  view.setUint16(central + 10, 8, true);
  view.setUint32(central + 20, packed.length, true);
  view.setUint32(out.length - 22 + 16, central, true);

  assert.equal((await readZip(out))[0]!.text, text);
});

test('anything that is not a zip is refused', async () => {
  await assert.rejects(readZip(new TextEncoder().encode('just some text')));
});

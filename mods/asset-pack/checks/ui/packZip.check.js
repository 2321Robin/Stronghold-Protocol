// ui/packZip.js: CRC32, the store-only encode → decode roundtrip (names, empty files, binary), CRC verification
// on extraction, and the two format guards (compressed methods, the 65534-entry ceiling). The Blob path is what
// public/pack.html runs — Node ≥ 18 has Blob, so the same reader is exercised here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, dosStamp, encodeZip, zipEntries, zipEntriesFromBlob, extractZipEntry } from '../../public/js/ui/packZip.js';

const enc = new TextEncoder();
const bytes = (s) => enc.encode(s);

test('crc32: known vectors', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(bytes('123456789')), 0xcbf43926); // the canonical check value
  assert.equal(crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('encode → zipEntries roundtrip: nested names, UTF-8 names, empty and binary entries', () => {
  const payload = new Uint8Array(70_000).map((_, i) => i & 0xff); // > 64 KiB to leave no doubt
  const zip = encodeZip([
    { name: 'assets/char/avatar/x.png', data: bytes('png-bytes') },
    { name: 'assets/audio/bgm/combat.mp3', data: payload },
    { name: '_pack.json', data: bytes('{"files":{}}') },
    { name: 'assets/字体/空.png', data: bytes('unicode-name') },
    { name: 'fonts/bender-regular.woff2', data: new Uint8Array(0) },
    { name: 'assets/spine/a/and b.atlas', data: bytes('name with a space') },
  ]);
  const entries = zipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), [
    'assets/char/avatar/x.png', 'assets/audio/bgm/combat.mp3', '_pack.json',
    'assets/字体/空.png', 'fonts/bender-regular.woff2', 'assets/spine/a/and b.atlas',
  ]);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.equal(byName['assets/audio/bgm/combat.mp3'].size, payload.length);
  assert.equal(byName['fonts/bender-regular.woff2'].size, 0);
  assert.deepEqual(new Uint8Array(zip.slice(byName['assets/audio/bgm/combat.mp3'].dataOffset,
    byName['assets/audio/bgm/combat.mp3'].dataOffset + payload.length)), payload);
  assert.deepEqual(new Uint8Array(zip.slice(byName['assets/char/avatar/x.png'].dataOffset,
    byName['assets/char/avatar/x.png'].dataOffset + 9)), bytes('png-bytes'));
  for (const e of entries) assert.equal(e.method, 0, 'store-only');
});

test('zipEntriesFromBlob + extractZipEntry: the Blob reader finds the same index and bytes', async () => {
  const zip = encodeZip([
    { name: '_pack.json', data: bytes('{"manifest":"abc"}') },
    { name: 'assets/a.bin', data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: 'assets/b.bin', data: new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff) },
  ]);
  const blob = new Blob([zip]);
  const entries = await zipEntriesFromBlob(blob);
  assert.deepEqual(entries.map((e) => e.name), ['_pack.json', 'assets/a.bin', 'assets/b.bin']);
  const meta = new TextDecoder().decode(await extractZipEntry(blob, entries[0]));
  assert.equal(meta, '{"manifest":"abc"}');
  assert.deepEqual(await extractZipEntry(blob, entries[1]), new Uint8Array([1, 2, 3, 4, 5]));
  const big = await extractZipEntry(blob, entries[2]);
  assert.equal(big.length, 200_000);
  assert.equal(big[123], (123 * 7) & 0xff);
});

test('extractZipEntry verifies CRC by default and reports the mismatch', async () => {
  const zip = encodeZip([{ name: 'a.bin', data: bytes('intact-payload') }]);
  const [entry] = await zipEntriesFromBlob(new Blob([zip]));
  const corrupted = new Uint8Array(zip);
  corrupted[entry.dataOffset + 2] ^= 0xff; // flip a byte of the payload, not of the zip structure
  const blob = new Blob([corrupted]);
  const [broken] = await zipEntriesFromBlob(blob); // the index itself still parses — only the data is wrong
  await assert.rejects(() => extractZipEntry(blob, broken), /CRC/);
  const raw = await extractZipEntry(blob, broken, { verify: false });
  assert.equal(new TextDecoder().decode(raw).slice(3), 'act-payload', 'the right bytes come back, corrupt byte included');
});

test('a compressed (method 8) entry is refused — this codec is store-only', () => {
  // hand-built: a correct deflate-less record is not what we test, only that method ≠ 0 is caught.
  const zip = encodeZip([{ name: 'a.bin', data: bytes('x') }]);
  const v = new DataView(zip.buffer);
  const entries = zipEntries(zip);
  v.setUint16(entries[0].offset + 8, 8, true); // local header method field
  // the central record follows the entry data; patch its method field too so only the method is wrong
  const centralOffset = entries[0].dataOffset + entries[0].size;
  const central = new DataView(zip.buffer, centralOffset);
  for (let p = 0; p + 4 <= central.byteLength; p += 1) {
    if (central.getUint32(p, true) === 0x02014b50) { central.setUint16(p + 10, 8, true); break; }
  }
  assert.throws(() => zipEntries(zip), /store-only/);
});

test('more than 65534 entries cannot be encoded (EOCD field ceiling)', () => {
  const entries = Array.from({ length: 65_535 }, (_, i) => ({ name: `f/${i}`, data: new Uint8Array(0) }));
  assert.throws(() => encodeZip(entries), /65534/);
});

test('dosStamp packs a date into the MS-DOS fields', () => {
  const { time, date } = dosStamp(new Date(2026, 9, 11, 13, 45, 30));
  assert.equal(date, ((2026 - 1980) << 9) | (10 << 5) | 11);
  assert.equal(time, (13 << 11) | (45 << 5) | 15); // seconds / 2
});

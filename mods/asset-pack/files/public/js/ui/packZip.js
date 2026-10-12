// packZip.js — a store-only (no compression) zip codec, one implementation for both sides of the asset pack:
// `tools/pack-assets.mjs` writes the pack under Node, `public/pack.html` reads it in the browser, and the unit
// tests exercise both directions. PNG / MP3 / WebP / spine data are already compressed formats, so a store-only
// archive costs ~0% size and needs no inflate dependency in the browser — the entries are just named byte blobs
// with a CRC32 each. No imports, no DOM, no Node builtins: pure ESM, safe to import from a module service worker
// as well.

// ---- CRC32 (IEEE 802.3, poly 0xEDB88320 — what zip and gzip use) --------------------------------------

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/** CRC32 of `bytes` as an unsigned 32-bit number (0 for empty input). */
export function crc32(bytes) {
  const table = crcTable();
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// ---- MS-DOS timestamp (2-second resolution is what the format stores) ----------------------------------

/** { time, date } in the zip's MS-DOS packing for a Date (defaults to now). */
export function dosStamp(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: date & 0xffff };
}

// ---- encoding (writer side) -----------------------------------------------------------------------------

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const UTF8_FLAG = 0x0800;

function nameBytes(name) {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length > 0xffff) throw new Error(`packZip: entry name too long (${bytes.length} bytes): ${name.slice(0, 80)}`);
  return bytes;
}

/** Local file header + entry name for one stored file (the data bytes follow verbatim). */
export function zipLocalChunk(name, size, crc, stamp) {
  const nb = nameBytes(name);
  const out = new Uint8Array(30 + nb.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, LOCAL_SIG, true);
  v.setUint16(4, 20, true);          // version needed
  v.setUint16(6, UTF8_FLAG, true);   // general purpose flags: names are UTF-8
  v.setUint16(8, 0, true);           // method: store
  v.setUint16(10, stamp.time, true);
  v.setUint16(12, stamp.date, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, size, true);       // compressed size (= size, store)
  v.setUint32(22, size, true);       // uncompressed size
  v.setUint16(26, nb.length, true);
  v.setUint16(28, 0, true);          // extra length
  out.set(nb, 30);
  return out;
}

/** Central directory record for one stored file at local-header `offset`. */
export function zipCentralChunk(name, size, crc, stamp, offset) {
  const nb = nameBytes(name);
  const out = new Uint8Array(46 + nb.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, CENTRAL_SIG, true);
  v.setUint16(4, 20, true);          // version made by
  v.setUint16(6, 20, true);          // version needed
  v.setUint16(8, UTF8_FLAG, true);
  v.setUint16(10, 0, true);          // method: store
  v.setUint16(12, stamp.time, true);
  v.setUint16(14, stamp.date, true);
  v.setUint32(16, crc, true);
  v.setUint32(20, size, true);
  v.setUint32(24, size, true);
  v.setUint16(28, nb.length, true);
  v.setUint16(30, 0, true);          // extra length
  v.setUint16(32, 0, true);          // comment length
  v.setUint16(34, 0, true);          // disk number start
  v.setUint16(36, 0, true);          // internal attributes
  v.setUint32(38, 0, true);          // external attributes
  v.setUint32(42, offset, true);
  out.set(nb, 46);
  return out;
}

/** End-of-central-directory record; the format's 16-bit fields cap this codec at 65534 entries / 4 GiB. */
export function zipEndChunk(count, cdSize, cdOffset) {
  if (count > 0xfffe) throw new Error(`packZip: too many entries for a zip EOCD (${count} > 65534)`);
  if (cdOffset + cdSize > 0xffffffff) throw new Error('packZip: archive exceeds 4 GiB (zip64 unsupported)');
  const out = new Uint8Array(22);
  const v = new DataView(out.buffer);
  v.setUint32(0, EOCD_SIG, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  v.setUint16(20, 0, true);          // comment length
  return out;
}

/** Encode whole entries (small archives / tests): `[{ name, data: Uint8Array }]` → one Uint8Array. */
export function encodeZip(entries) {
  const stamp = dosStamp();
  const parts = [];
  let offset = 0;
  const records = [];
  for (const { name, data } of entries) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(0);
    const crc = crc32(bytes);
    const local = zipLocalChunk(name, bytes.length, crc, stamp);
    parts.push(local, bytes);
    records.push(zipCentralChunk(name, bytes.length, crc, stamp, offset));
    offset += local.length + bytes.length;
  }
  const cd = concat(records);
  parts.push(cd, zipEndChunk(records.length, cd.length, offset));
  return concat(parts);
}

function concat(list) {
  let total = 0;
  for (const p of list) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of list) { out.set(p, at); at += p.length; }
  return out;
}

// ---- decoding (reader side) -----------------------------------------------------------------------------

/**
 * Parse the central directory of a store-only zip.
 * @param {Uint8Array} buf the whole archive
 * @returns {{ name: string, size: number, crc: number, method: number, offset: number, dataOffset: number }[]}
 *   `offset` is the local header position, `dataOffset` where the entry's bytes start.
 */
export function zipEntries(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(v);
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  const entries = [];
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cdEnd) throw new Error(`packZip: central directory ends after ${i} of ${count} entries`);
    if (v.getUint32(pos, true) !== CENTRAL_SIG) throw new Error(`packZip: bad central record at ${pos}`);
    const method = v.getUint16(pos + 10, true);
    if (method !== 0) throw new Error(`packZip: entry ${i} uses compression method ${method} — this codec is store-only`);
    if (v.getUint16(pos + 8, true) & 1) throw new Error(`packZip: entry ${i} is encrypted`);
    const size = v.getUint32(pos + 24, true);
    const crc = v.getUint32(pos + 16, true);
    const nameLen = v.getUint16(pos + 28, true);
    const extraLen = v.getUint16(pos + 30, true);
    const commentLen = v.getUint16(pos + 32, true);
    const offset = v.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(buf.subarray(pos + 46, pos + 46 + nameLen));
    entries.push({ name, size, crc, method, offset, dataOffset: localDataOffset(v, buf, offset, size) });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function localDataOffset(v, buf, offset, size) {
  if (offset + 30 > buf.byteLength || v.getUint32(offset, true) !== LOCAL_SIG) {
    throw new Error(`packZip: bad local header at ${offset}`);
  }
  const nameLen = v.getUint16(offset + 26, true);
  const extraLen = v.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLen + extraLen;
  if (dataOffset + size > buf.byteLength) throw new Error(`packZip: entry at ${offset} overruns the archive`);
  return dataOffset;
}

/** Find the end-of-central-directory record: scan backwards over the trailing comment space (≤ 64 KiB).
 *  `base` is the absolute archive offset of `v`'s first byte (0 for the whole-buffer path) — the CD offsets in
 *  the record are absolute, so the sanity check must be too, or a tail window never validates. */
function findEocd(v, base = 0) {
  const end = v.byteLength;
  const lowest = Math.max(0, end - 22 - 0xffff);
  for (let pos = end - 22; pos >= lowest; pos--) {
    if (v.getUint32(pos, true) !== EOCD_SIG) continue;
    const cdSize = v.getUint32(pos + 12, true);
    const cdOffset = v.getUint32(pos + 16, true);
    const commentLen = v.getUint16(pos + 20, true);
    if (cdOffset + cdSize <= base + pos && pos + 22 + commentLen <= end) return pos;
  }
  throw new Error('packZip: end-of-central-directory not found (not a zip, or truncated)');
}

/**
 * Same index from a Blob/File without loading the whole archive: reads the tail for the EOCD, then the central
 * directory. Entry bytes are never touched here — extractZipEntry does that per entry.
 */
export async function zipEntriesFromBlob(blob) {
  const tailLen = Math.min(blob.size, 22 + 0xffff);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const eocdInTail = findEocd(tailView, blob.size - tailLen);
  const count = tailView.getUint16(eocdInTail + 10, true);
  const cdSize = tailView.getUint32(eocdInTail + 12, true);
  const cdOffset = tailView.getUint32(eocdInTail + 16, true); // absolute, straight from the record
  if (cdOffset + cdSize > blob.size) throw new Error('packZip: central directory points past the archive');
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const cdView = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = [];
  let pos = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > cd.byteLength) throw new Error(`packZip: central directory ends after ${i} of ${count} entries`);
    if (cdView.getUint32(pos, true) !== CENTRAL_SIG) throw new Error(`packZip: bad central record at ${pos}`);
    const method = cdView.getUint16(pos + 10, true);
    if (method !== 0) throw new Error(`packZip: entry ${i} uses compression method ${method} — this codec is store-only`);
    if (cdView.getUint16(pos + 8, true) & 1) throw new Error(`packZip: entry ${i} is encrypted`);
    const size = cdView.getUint32(pos + 24, true);
    const crc = cdView.getUint32(pos + 16, true);
    const nameLen = cdView.getUint16(pos + 28, true);
    const extraLen = cdView.getUint16(pos + 30, true);
    const commentLen = cdView.getUint16(pos + 32, true);
    const localOffset = cdView.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(cd.subarray(pos + 46, pos + 46 + nameLen));
    // The local header repeats the name with its own extra-field length — the CD's offset alone is not enough.
    const lh = new Uint8Array(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
    const lhView = new DataView(lh.buffer);
    if (lh.byteLength < 30 || lhView.getUint32(0, true) !== LOCAL_SIG) throw new Error(`packZip: bad local header at ${localOffset}`);
    const dataOffset = localOffset + 30 + lhView.getUint16(26, true) + lhView.getUint16(28, true);
    if (dataOffset + size > blob.size) throw new Error(`packZip: entry '${name}' overruns the archive`);
    entries.push({ name, size, crc, method, offset: localOffset, dataOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Read one entry's bytes out of a Blob archive, CRC-verified by default (the import path relies on it — the pack
 * travels outside our control, and Cache Storage will happily persist corrupt bytes for months).
 */
export async function extractZipEntry(blob, entry, { verify = true } = {}) {
  const bytes = new Uint8Array(await blob.slice(entry.dataOffset, entry.dataOffset + entry.size).arrayBuffer());
  if (verify && crc32(bytes) !== entry.crc) {
    throw new Error(`CRC 不符 — expected ${entry.crc.toString(16)}, got ${crc32(bytes).toString(16)}`);
  }
  return bytes;
}

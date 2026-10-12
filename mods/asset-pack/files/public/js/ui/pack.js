// ui/pack.js — shared brain of the asset pack (playtest #33, local line): the Cache Storage names, the
// /media/… → pack-entry mapping, and the per-URL "may the pack still serve this file" decision.
//
// Three consumers import it:
//   * public/sw.js (module service worker) — decides, per intercepted request, runtime cache → pack → network;
//   * public/pack.html — writes the pack into Cache Storage and shows installed-vs-server status;
//   * test/ui/pack*.test.js under Node — the pure helpers are tested directly.
//
// The decision model (定稿 2026-10-10): the pack stores exactly the URLs of one assets.json manifest and
// records that manifest's hash plus every file's size. New URLs (fresh operators / voices / skins — the daily
// churn) are simply absent from the pack and fall back to the network with no action needed. A same-URL content
// change (rare) is caught by the deployed size table `data/asset-sizes.json` (tools/pack-assets.mjs --sizes):
// current size ≠ size recorded in the pack ⇒ bypass the pack. With no size table deployed the pack keeps serving
// best-effort — the documented cure is re-importing, which is local-disk → browser and eats no bandwidth.
//
// Pure at import time: no caches/fetch/DOM access at module scope (Node imports it safely). The Cache Storage
// helpers below only run in the browser.

import { AUDIO_EXTS, MEDIA_PREFIX } from '../../../shared/media.js';

/** Cache the pack import fills (pack.html) and the SW reads — the durable copy of the manifest's files. */
export const PACK_CACHE = 'sp-pack-v1';
/** Cache the SW fills on network misses so content outlives the HTTP cache's 24 h max-age. */
export const RUNTIME_CACHE = 'sp-runtime-v1';
/** Synthetic key inside PACK_CACHE holding the pack's metadata (no such file is served — a cache key only).
 *  Written last by the import: its presence is the commit marker, a half-imported cache has no meta and the SW
 *  then treats the pack as absent. */
export const PACK_META_KEY = '/data/sp-pack-meta.json';
/** Optional deployed size table (url → size of the file the server serves right now). */
export const SIZES_URL = '/data/asset-sizes.json';
/** The runtime cache is a durability layer for packless browsers, not an archive — trim beyond this. */
export const RUNTIME_MAX_ENTRIES = 4096;

// ---- pure helpers --------------------------------------------------------------------------------------

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
};

/** Content-Type for a pack entry / asset URL — the same values server/http/files.js would answer with. */
export function mimeForUrl(url) {
  const dot = typeof url === 'string' ? url.lastIndexOf('.') : -1;
  const ext = dot < 0 ? '' : url.slice(dot).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Absolute cache key for a root-relative URL (Cache Storage keys are absolute URLs; page and SW must agree). */
export function absoluteUrl(url, origin = globalThis.location?.origin || 'http://localhost') {
  return new URL(url, origin.endsWith('/') ? origin : origin + '/').href;
}

/**
 * Index the pack's audio URLs for the extension-less /media/… route (shared/media.js): stem → URL, preferring
 * the extension order the server itself tries. Only audio files are addressable through /media/.
 * @param {string[]} urls pack file URLs ('/assets/…')
 * @returns {Map<string, { ext: string, url: string }>}
 */
export function mediaIndexFromUrls(urls) {
  const index = new Map();
  if (!Array.isArray(urls)) return index;
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/assets/audio/')) continue;
    const rest = url.slice('/assets/audio/'.length);
    // the same refusals server/http/media.js applies — a segment that starts or ends with a dot would
    // address something the server never serves ('.mp3' dotfiles, 'x.' stems), so the pack never lists them
    if (rest.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.') || s.endsWith('.'))) continue;
    const dot = rest.lastIndexOf('.');
    if (dot <= 0) continue;
    const ext = rest.slice(dot).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) continue;
    const stem = rest.slice(0, dot);
    const prev = index.get(stem);
    if (!prev || AUDIO_EXTS.indexOf(ext) < AUDIO_EXTS.indexOf(prev.ext)) index.set(stem, { ext, url });
  }
  return index;
}

/**
 * Map an intercepted /media/… request path to the pack URL that would serve it, or null when the request is not
 * one the pack can answer (not audio, path the server would refuse, or a stem the pack does not hold). An
 * explicit-extension request (/media/x.ogg) resolves through the stem; if the pack holds the stem under another
 * extension that one is served — audio content either way, and the client sniffs the container.
 */
export function mediaPackUrl(pathname, index) {
  if (!index || !index.size || typeof pathname !== 'string' || !pathname.startsWith(MEDIA_PREFIX)) return null;
  const rest = pathname.slice(MEDIA_PREFIX.length);
  if (!rest || rest.endsWith('/')) return null;
  if (rest.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.') || s.endsWith('.'))) return null; // server's refusals
  const wanted = AUDIO_EXTS.find((e) => rest.toLowerCase().endsWith(e));
  const stem = wanted ? rest.slice(0, rest.length - wanted.length) : rest;
  if (!stem) return null;
  const hit = index.get(stem);
  return hit ? hit.url : null;
}

/**
 * May the pack still serve this URL? True when the pack holds it and (when a size table is deployed) the file's
 * current size matches what the pack recorded. A URL absent from the pack or from the table goes to the network.
 * @param {string} url root-relative asset URL
 * @param {Record<string, number>|null} packSizes url → size from the installed pack's meta
 * @param {Record<string, number>|null} sizeTable url → size of the currently deployed file (null when absent)
 */
export function packUsableFor(url, packSizes, sizeTable) {
  if (!packSizes || typeof url !== 'string' || !Object.hasOwn(packSizes, url)) return false;
  if (!sizeTable) return true; // no deployed table: best effort — a re-import is the documented cure
  if (!Object.hasOwn(sizeTable, url)) return false; // table is for a different manifest than the pack
  return sizeTable[url] === packSizes[url];
}

// ---- Cache Storage helpers (browser only) --------------------------------------------------------------

/**
 * The installed pack's metadata, or null when no complete pack is in the cache (never imported, or an import
 * that died before its commit marker).
 * @returns {Promise<{ manifest?: string, builtAt?: string, count: number, totalBytes: number,
 *                     files: Record<string, number> }|null>}
 */
export async function readPackMeta(origin) {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(PACK_CACHE);
    const res = await cache.match(absoluteUrl(PACK_META_KEY, origin));
    if (!res) return null;
    const meta = await res.json();
    if (!meta || typeof meta.files !== 'object' || !meta.files) return null;
    return meta;
  } catch {
    return null;
  }
}

/**
 * Store one pack entry under its URL with the headers the game's loaders expect (the SW serves these Responses
 * verbatim — images via <img> depend on a correct Content-Type).
 */
export async function putPackEntry(url, bytes, origin) {
  const cache = await caches.open(PACK_CACHE);
  await cache.put(absoluteUrl(url, origin), new Response(bytes, {
    headers: { 'Content-Type': mimeForUrl(url), 'Content-Length': String(bytes.byteLength) },
  }));
}

/** Store the pack meta (the commit marker — call it strictly after every file entry is in). */
export async function putPackMeta(meta, origin) {
  const cache = await caches.open(PACK_CACHE);
  await cache.put(absoluteUrl(PACK_META_KEY, origin), new Response(JSON.stringify(meta), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  }));
}

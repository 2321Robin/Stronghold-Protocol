// /sw.js — the asset-pack service worker (playtest #33, LOCAL LINE ONLY — never upstream, never a PR).
//
// A cold browser on this server's 2 Mbit pipe loses minutes of a first battle to downloads. Two import routes
// land in Cache Storage on this origin and this worker serves both:
//
//   1. the native 导入素材包 (upstream 0.3.0, PR #628): the player's own folder or zip, hash-checked against the
//      server manifests, stored at exact hashed URL keys in 'sp-imported-assets-v1' by ui/assetPack.js. Upstream
//      ships its own worker in this file; this local worker REPLACES it and keeps its contract — the three
//      IMPORTED_ASSET_* constants below are byte-for-byte in sync with public/js/assetCache.js (its unit test
//      checks them here), that cache is only ever READ by the worker (the page import writes it), and activation
//      still retires stale sp-imported-assets-* versions;
//   2. this mod's pack (playtest #33): one store-only zip (dist/stronghold-assets.zip, tools/pack-assets.mjs),
//      imported once via 设置 → 资源包 or /pack.html into 'sp-pack-v1', keyed by the plain manifest URLs; a
//      runtime layer ('sp-runtime-v1') keeps network misses alive past the HTTP cache's 24 h max-age.
//
// Per intercepted GET (same-origin, no Range, a content-hashed /assets/ /fonts/ /media/ path — the only URLs the
// game requests for art): imported cache (exact key, never ignoreSearch — Chrome scans every entry for it) →
// runtime cache → pack (packUsableFor says its copy is still current) → network (a 200 is kept in the runtime
// layer). /media/… resolves through the pack's stem index; hashed paths drop the hash segment before the pack
// lookup (the pack's keys are the plain manifest URLs). Pack state re-reads at most once per 5 minutes and is
// pushed with a 'sp-pack-updated' message right after an import. Not intercepted: everything else (the shell,
// /data/**, /shared/** stay on the plain HTTP path — assets.json is network-first because the client itself
// fetches it no-cache every page), cross-origin, non-GET, and Range requests (audio seeking keeps its normal
// semantics).
//
// Classic script (no import statements): upstream keeps this file classic so Firefox 108 / Safari 16.4 can
// register it and test/ui/asset-import.test.js can run it in a vm sandbox; the pure helpers this worker needs
// are inlined from ui/pack.js below (its page-side twin — keep the constants and helpers in sync by hand).
// Registration happens from two places, both fine (same URL): ui/packInstall.js from main.js (and pack.html),
// and upstream's registerImportedAssetWorker at boot. Automation (navigator.webdriver) never registers ours.
// If the worker or Cache Storage fails for any reason the fetch falls back to the plain network — the game
// behaves as if the worker were not there.

// ---- upstream 0.3.0 imported-art contract — keep byte-for-byte in sync with public/js/assetCache.js ----
const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';
const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';
const IMPORTED_ASSET_PATH = /^\/(?:assets|fonts|media)\/~[0-9a-f]{16}\//;

// ---- this mod's pack layer — copies of ui/pack.js, keep in sync by hand ----
const PACK_CACHE = 'sp-pack-v1';
const RUNTIME_CACHE = 'sp-runtime-v1';
const PACK_META_KEY = '/data/sp-pack-meta.json';
const SIZES_URL = '/data/asset-sizes.json';
const RUNTIME_MAX_ENTRIES = 4096;
const REFRESH_MS = 5 * 60_000;

// inlined from shared/assetPaths.js (splitHashedPath) and shared/media.js (MEDIA_PREFIX / AUDIO_EXTS)
const HASHED_ROOTS = ['/assets/', '/fonts/', '/media/'];
const HASH_SEGMENT_RE = /^~([0-9a-f]{16})$/;
const MEDIA_PREFIX = '/media/';
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav'];

function splitHashedPath(path) {
  const p = String(path ?? '');
  for (const root of HASHED_ROOTS) {
    if (!p.startsWith(root)) continue;
    const slash = p.indexOf('/', root.length);
    if (slash < 0) break;
    const m = HASH_SEGMENT_RE.exec(p.slice(root.length, slash));
    return m ? { hash: m[1], path: root + p.slice(slash + 1) } : { hash: null, path: p };
  }
  return { hash: null, path: p };
}

// inlined from ui/pack.js (the page-side twin keeps the originals)
function absoluteUrl(url, origin = self.location.origin) {
  return new URL(url, origin.endsWith('/') ? origin : origin + '/').href;
}

function mediaIndexFromUrls(urls) {
  const index = new Map();
  if (!Array.isArray(urls)) return index;
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith('/assets/audio/')) continue;
    const rest = url.slice('/assets/audio/'.length);
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

function mediaPackUrl(pathname, index) {
  if (!index || !index.size || typeof pathname !== 'string' || !pathname.startsWith(MEDIA_PREFIX)) return null;
  const rest = pathname.slice(MEDIA_PREFIX.length);
  if (!rest || rest.endsWith('/')) return null;
  if (rest.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.') || s.endsWith('.'))) return null;
  const wanted = AUDIO_EXTS.find((e) => rest.toLowerCase().endsWith(e));
  const stem = wanted ? rest.slice(0, rest.length - wanted.length) : rest;
  if (!stem) return null;
  const hit = index.get(stem);
  return hit ? hit.url : null;
}

function packUsableFor(url, packSizes, sizeTable) {
  if (!packSizes || typeof url !== 'string' || !Object.hasOwn(packSizes, url)) return false;
  if (!sizeTable) return true; // no deployed table: best effort — a re-import is the documented cure
  if (!Object.hasOwn(sizeTable, url)) return false; // table is for a different manifest than the pack
  return sizeTable[url] === packSizes[url];
}

function packUrlFor(pathname, mediaIndex) {
  if (typeof pathname !== 'string') return null;
  const plain = splitHashedPath(pathname).path;
  if (plain.startsWith(MEDIA_PREFIX)) return mediaPackUrl(plain, mediaIndex);
  return plain;
}

const state = { packSizes: null, sizeTable: null, mediaIndex: null, checkedAt: 0 };
let pendingRefresh = null;

/** Re-read the installed pack's meta and the server's size table (a 304 when unchanged). Serialized. */
function refreshPackState(force = false) {
  if (!force) {
    if (pendingRefresh) return pendingRefresh;
    if (state.checkedAt && Date.now() - state.checkedAt < REFRESH_MS) return Promise.resolve();
  }
  state.checkedAt = Date.now();
  pendingRefresh = (async () => {
    try {
      const cache = await caches.open(PACK_CACHE);
      const metaRes = await cache.match(absoluteUrl(PACK_META_KEY));
      const meta = metaRes ? await metaRes.json() : null;
      const files = meta && typeof meta.files === 'object' && meta.files ? meta.files : null;
      state.packSizes = files;
      state.mediaIndex = files ? mediaIndexFromUrls(Object.keys(files)) : null;
    } catch { /* keep the previous view — pack misses just go to the network */ }
    try {
      const res = await fetch(SIZES_URL, { cache: 'no-cache' });
      const table = res.ok ? await res.json() : null;
      state.sizeTable = table && typeof table.files === 'object' && table.files ? table.files : null;
    } catch { state.sizeTable = null; } // undeployed / unreachable: the pack serves best-effort
  })().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // retire caches from retired versions of this worker: upstream's stale sp-imported-assets-* versions and any
    // retired sp-* name of ours (the three live names are versioned by name)
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('sp-') && name !== PACK_CACHE && name !== RUNTIME_CACHE && name !== IMPORTED_ASSET_CACHE)
      .map((name) => caches.delete(name)));
    await refreshPackState(true);
    await self.clients.claim();
  })());
});

// pack.html fires this right after an import so the new pack is live without waiting out the TTL
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sp-pack-updated') event.waitUntil(refreshPackState(true));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return; // partial content: let the network answer with real ranges
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  if (!IMPORTED_ASSET_PATH.test(url.pathname)) return;
  event.respondWith(serve(event, req, url));
});

async function serve(event, req, url) {
  // 1. the native import's cache — exact key, never written by this worker (the page import writes it)
  try {
    const imported = await caches.open(IMPORTED_ASSET_CACHE);
    const hit = await imported.match(url.origin + url.pathname);
    if (hit) return hit;
  } catch { /* fall through to the layers below */ }
  // 2. this mod's runtime layer
  try {
    const runtime = await caches.open(RUNTIME_CACHE);
    const hit = await runtime.match(url.href);
    if (hit) return hit;
  } catch { /* fall through */ }
  // 3. this mod's pack — the hashed segment is dropped first (the pack's keys are plain manifest URLs)
  await refreshPackState(); // no-op while fresh; on a cold worker this is the pack lookup warming up
  try {
    const packUrl = packUrlFor(url.pathname, state.mediaIndex);
    if (packUrl && packUsableFor(packUrl, state.packSizes, state.sizeTable)) {
      const pack = await caches.open(PACK_CACHE);
      const fromPack = await pack.match(absoluteUrl(packUrl));
      if (fromPack) return fromPack;
    }
  } catch { /* pack problems just go to the network */ }
  // 4. network — SW-initiated fetches do not re-enter this handler
  try {
    const res = await fetch(req);
    // a real FetchEvent always has waitUntil; the guard keeps the worker testable in a bare vm sandbox
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default') && event.waitUntil) {
      event.waitUntil(storeRuntime(req, res.clone()));
    }
    return res;
  } catch (err) {
    console.error('[sw] falling back to the network for', url.pathname, err);
    return fetch(req); // an internal failure (quota, storage) must never take the request down with it
  }
}

self.addEventListener('error', (event) => console.error('[sw] error', event.message || event));
self.addEventListener('unhandledrejection', (event) => console.error('[sw] rejection', String(event.reason)));

let runtimeCount = 0; // approximate; re-synced from the cache itself when a trim fires

async function storeRuntime(req, res) {
  try {
    // Store the decoded bytes with plain headers instead of the network Response as-is: a gzip response keeps a
    // `Vary: Accept-Encoding` that makes later matches silently miss (and would hand out a stale encoding header).
    // The fetch body is already decoded, so a clean Response is the same file for any future request.
    const cache = await caches.open(RUNTIME_CACHE);
    const body = await res.arrayBuffer();
    await cache.put(req, new Response(body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': String(body.byteLength),
      },
    }));
    if (++runtimeCount > RUNTIME_MAX_ENTRIES + 512) {
      const keys = await cache.keys();
      runtimeCount = keys.length;
      for (const stale of keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES)) await cache.delete(stale);
    }
  } catch { /* quota or a vanished entry — the next fetch for it just goes to the network */ }
}

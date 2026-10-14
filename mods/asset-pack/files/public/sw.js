// /sw.js — the asset-pack service worker (playtest #33, LOCAL LINE ONLY — never upstream, never a PR).
//
// A cold browser on this server's 2 Mbit pipe loses minutes of a first battle to downloads. warmup (#28) pre-pulls
// into the HTTP cache but that cache is capped at a day and only helps players who idle in the lobby long enough.
// The pack route: a player imports a store-only zip once via /pack.html (local disk → browser, no bandwidth), the
// file bytes land in the 'sp-pack-v1' Cache Storage, and this worker serves them from then on — the game's
// img/fetch/audio code is untouched and cannot tell the difference.
//
// Per intercepted GET: runtime cache ('sp-runtime-v1', fills on network misses so content outlives the HTTP
// cache's 24 h max-age) → pack ('sp-pack-v1', only while packUsableFor says its copy is still current) → network.
// 0.2.6 serves art under /assets/~<hash>/… and /fonts/~<hash>/… (the content-hash segment of
// shared/assetPaths.js) while the pack's keys are the plain manifest URLs, so packUrlFor drops the segment
// before the lookup — that keeps the pack usable under the content-hash scheme instead of every request
// falling through to the network. /media/… is resolved through the stem index the same call makes.
// Pack state re-reads at most once per 5 minutes and is pushed with a 'sp-pack-updated' message right after an
// import. Not intercepted: everything outside /assets/**, /fonts/** and /media/** (the shell, /data/**, /shared/**
// stay on the plain HTTP path — assets.json is network-first because the client itself fetches it no-cache every
// page), cross-origin, non-GET, and Range requests (audio seeking keeps its normal semantics).
//
// Registration happens in ui/packInstall.js from main.js (and from pack.html); automation (navigator.webdriver)
// never registers, so e2e runs uncontrolled exactly as before. If the worker or Cache Storage fails for any
// reason the fetch falls back to the plain network — the game behaves as if the worker were not there.

import {
  PACK_CACHE, RUNTIME_CACHE, PACK_META_KEY, SIZES_URL, RUNTIME_MAX_ENTRIES,
  mediaIndexFromUrls, packUrlFor, packUsableFor, absoluteUrl,
} from '/js/ui/pack.js';

const REFRESH_MS = 5 * 60_000;

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
    // retire caches from retired versions of this worker (the two live names are versioned by name)
    for (const name of await caches.keys()) {
      if (name.startsWith('sp-') && name !== PACK_CACHE && name !== RUNTIME_CACHE) await caches.delete(name);
    }
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
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  const isMedia = p.startsWith('/media/');
  const isAsset = p.startsWith('/assets/') || p.startsWith('/fonts/');
  if (!isMedia && !isAsset) return;
  if (req.headers.has('range')) return; // partial content: let the network answer with real ranges
  event.respondWith(serve(event, req, url));
});

async function serve(event, req, url) {
  await refreshPackState(); // no-op while fresh; on a cold worker this is the pack lookup warming up
  try {
    const runtime = await caches.open(RUNTIME_CACHE);
    const hit = await runtime.match(url.href, { ignoreSearch: true });
    if (hit) return hit;

    // 0.2.6 hands art out under /assets/~<hash>/… and /fonts/~<hash>/…; the pack's keys are the plain manifest
    // URLs, so packUrlFor drops the segment (it also routes /media/ through the stem index).
    const packUrl = packUrlFor(url.pathname, state.mediaIndex);
    if (packUrl && packUsableFor(packUrl, state.packSizes, state.sizeTable)) {
      const pack = await caches.open(PACK_CACHE);
      const fromPack = await pack.match(absoluteUrl(packUrl), { ignoreSearch: true });
      if (fromPack) return fromPack;
    }

    const res = await fetch(req); // SW-initiated fetches do not re-enter this handler
    if (res && res.status === 200 && (res.type === 'basic' || res.type === 'default')) {
      event.waitUntil(storeRuntime(runtime, req, res.clone()));
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

async function storeRuntime(cache, req, res) {
  try {
    // Store the decoded bytes with plain headers instead of the network Response as-is: a gzip response keeps a
    // `Vary: Accept-Encoding` that makes later matches silently miss (and would hand out a stale encoding header).
    // The fetch body is already decoded, so a clean Response is the same file for any future request.
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

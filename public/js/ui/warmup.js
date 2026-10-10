// ui/warmup.js — idle-time HTTP-cache warmup so a first battle starts fast on a slow pipe.
//
// A cold browser downloads ~20–50 MB across a first battle (combat BGM, the battle SFX banks, every fielded
// operator's portrait, the per-unit attack/hit banks as units trade blows). The static server marks /assets/**
// `max-age=86400` with strong ETags, so anything fetched once is a disk hit (or a cheap 304) for the rest of the
// day — the pain is only the very first pull. While the player sits on the title screen or in the lobby those bytes
// can travel anyway, so this module fetches them into the HTTP cache, lowest priority first, two at a time, and
// silently (a failure just means that file loads for real when the game asks for it, exactly as before).
//
// Priority order (warmupQueue): the round's BGM tracks → the common UI / battle SFX → every pool operator's
// avatar and portrait (loadout screens, team panels, results) → the boss BGM banks → the per-unit SFX banks.
// Spines are deliberately not warmed: the prep board and the enemy pen load exactly the models a battle shows, and
// a parsed skeleton is memory, not cache (assets.js evicts them on a memory budget — prefetching would fight it).
//
// Start/stop follows the route (installed from main.js like installAudio): title / lobby ⇒ start, room / game ⇒
// stop — once the player is actually in a room the spare pipe belongs to whoever is playing, and the room's own
// screens pull the battle-adjacent bytes anyway. The cursor survives a stop: returning to the lobby resumes what is
// left (usually nothing). Respects `navigator.connection.saveData` (never starts).
//
// Pure at import time: no fetch, no DOM access until installWarmup runs (Node tests import the helpers).

const isPath = (v) => typeof v === 'string' && v.startsWith('/');

/** Every URL-looking string below `node` (the manifest holds root-relative paths as plain string leaves). */
export function collectUrls(node, out = []) {
  if (isPath(node)) out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectUrls(v, out);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectUrls(v, out);
  return out;
}

/** Portrait / avatar URLs of one operator (`assets.js` avatar helpers use the same four fields). */
export function charUrls(c) {
  return [c?.avatar, c?.avatarE2, c?.portrait, c?.portraitE2].filter(isPath);
}

/**
 * The warmup queue for a manifest: ordered, deduplicated, spines excluded.
 * @returns {string[]} root-relative URLs, most valuable for a first battle first
 */
export function warmupQueue(m) {
  if (!m || typeof m !== 'object') return [];
  const audio = m.audio && typeof m.audio === 'object' ? m.audio : {};
  const sfx = audio.sfx && typeof audio.sfx === 'object' ? audio.sfx : {};
  const chars = m.chars && typeof m.chars === 'object' ? m.chars : {};
  const seen = new Set();
  const push = (urls) => {
    for (const u of urls) if (!seen.has(u)) seen.add(u);
  };
  push(collectUrls(audio.bgm));
  push(collectUrls(sfx.ui));
  push(collectUrls(sfx.battle));
  for (const c of Object.values(chars)) push(charUrls(c));
  push(collectUrls(audio.bossBgm));
  push(collectUrls(sfx.units));
  return [...seen];
}

const CONCURRENCY = 2;
const START_DELAY_MS = 3000;   // let the page's own first loads have the pipe
const RETRY_MANIFEST_MS = 1000;
const RETRY_MANIFEST_MAX = 30; // ~30 s of patience for data.load('assets')

let installed = null;

/**
 * Route-driven warmup, wired like installAudio: subscribe to the app store and start on title / lobby, stop on
 * room / game. Safe to call twice (the second install is ignored); returns the controller (tests).
 */
export function installWarmup(deps) {
  if (installed) return installed;
  const warm = createWarmup(deps);
  const sync = () => {
    const r = deps.selectRoute(deps.getState());
    if (r === 'title' || r === 'lobby') warm.start();
    else warm.stop();
  };
  sync();
  deps.subscribe(sync);
  installed = warm;
  return warm;
}

/** The fetch-and-wait worker. Separated from installWarmup so tests can drive it with a stubbed fetch. */
export function createWarmup(deps) {
  const doFetch = deps.fetch || ((url, opts) => fetch(url, opts));
  const timer = deps.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const saveData = deps.saveData !== undefined
    ? deps.saveData
    : typeof navigator !== 'undefined' && navigator.connection ? !!navigator.connection.saveData : false;

  let urls = null;        // the full queue once the manifest arrived
  let next = 0;           // cursor — survives a stop so a later start resumes what is left
  let active = 0;
  let controller = null;
  let manifestTries = 0;
  let startPending = false;
  let stopped = true;

  function pump() {
    if (stopped) return;
    if (!controller) controller = new AbortController();
    while (active < CONCURRENCY && urls && next < urls.length) {
      const url = urls[next++];
      const signal = controller.signal;
      active++;
      doFetch(url, { cache: 'default', priority: 'low', signal })
        .then((res) => (res.ok ? res.arrayBuffer() : null)) // body must be read for the entry to be cached
        .catch(() => {})                                    // a missed file loads for real when the game asks
        .finally(() => {
          active--;
          pump();
        });
    }
    if (active === 0 && urls && next >= urls.length) {
      stopped = true; // queue drained — a later start() has nothing left to do
      controller = null;
    }
  }

  function start() {
    if (saveData || startPending) return;
    if (stopped && urls && next >= urls.length) return; // fully drained already
    stopped = false;
    if (urls) {
      pump(); // resume after a stop continues from the cursor immediately
      return;
    }
    startPending = true;
    const delay = manifestTries === 0 ? START_DELAY_MS : RETRY_MANIFEST_MS;
    timer(() => {
      startPending = false;
      if (stopped) return;
      const manifest = deps.getManifest && deps.getManifest();
      if (!manifest) {
        if (++manifestTries <= RETRY_MANIFEST_MAX) start(); // manifest not loaded yet — poll briefly
        return;
      }
      urls = warmupQueue(manifest);
      pump();
    }, delay);
  }

  function stop() {
    stopped = true;
    startPending = false;
    if (controller) {
      controller.abort();
      controller = null; // in-flight fetches settle their promises; pump() exits while stopped
    }
  }

  return { start, stop, get remaining() { return urls ? Math.max(0, urls.length - next - active) : null; } };
}

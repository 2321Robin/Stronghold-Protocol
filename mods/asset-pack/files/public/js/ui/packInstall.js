// ui/packInstall.js — registers the asset-pack service worker (public/sw.js, playtest #33, local line).
//
// Wired from main.js like installWarmup / installAudio, but with nothing route-driven behind it: registration is
// fire-and-forget and the worker's fetch handler does the rest. Skipped entirely under automation
// (navigator.webdriver — e2e and record-battle run their own browsers and must see the plain network); a browser
// without Service Worker support just rejects the promise and the game continues exactly as before — warmup #28
// remains the fallback for packless browsers either way.
//
// The worker is a classic script (upstream 0.3.0 keeps /sw.js classic for older browsers and its unit test runs
// it in a vm sandbox), so registration takes no `type` — and it is the same URL upstream's
// registerImportedAssetWorker registers at boot, so both entry points end up on this one worker.
//
// Also asks for persistent storage once: Cache Storage is the only durable copy of an imported pack, and a
// best-effort eviction prompt would silently undo a 600 MB import.

/** Registration gate, separate for tests: true when this browser should get the worker. */
export function shouldInstallPack(nav = globalThis.navigator) {
  if (!nav || !('serviceWorker' in nav)) return false;
  if (nav.webdriver) return false;
  return true;
}

/** Fire-and-forget registration (idle-scheduled so it never competes with boot); null when skipped. */
export function installPack() {
  if (!shouldInstallPack()) return null;
  const go = async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.warn('[pack] service worker unavailable', err);
      return;
    }
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') await navigator.storage.persist();
    } catch { /* best effort */ }
  };
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(() => { go(); }, { timeout: 5000 });
  else setTimeout(() => { go(); }, 1500);
  return true;
}

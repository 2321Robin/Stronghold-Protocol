// ui/warmup.js: queue building from a manifest, the start / stop / resume state machine, saveData and manifest waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectUrls, charUrls, warmupQueue, createWarmup } from '../../public/js/ui/warmup.js';

const manifest = {
  chars: {
    a: { avatar: '/assets/a.png', avatarE2: '/assets/a_2.png', portrait: '/assets/p/a.png', spine: { front: { skel: '/assets/a.skel' } } },
    b: { avatar: '/assets/b.png' },
  },
  audio: {
    bgm: { lobby: { loop: '/assets/bgm/lobby.mp3' }, combat: { loop: '/assets/bgm/combat.mp3' } },
    bossBgm: { boss1: { loop: '/assets/bgm/boss1.mp3' } },
    sfx: {
      ui: { click: '/assets/sfx/click.mp3' },
      battle: { deploy: '/assets/sfx/deploy.mp3' },
      units: { a: { attack: '/assets/sfx/a_atk.mp3' } },
    },
  },
};

test('warmupQueue: ordered bgm -> ui sfx -> battle sfx -> portraits -> boss bgm -> unit sfx, deduped, spines excluded', () => {
  const q = warmupQueue(manifest);
  assert.deepEqual(q, [
    '/assets/bgm/lobby.mp3', '/assets/bgm/combat.mp3',
    '/assets/sfx/click.mp3', '/assets/sfx/deploy.mp3',
    '/assets/a.png', '/assets/a_2.png', '/assets/p/a.png', '/assets/b.png',
    '/assets/bgm/boss1.mp3',
    '/assets/sfx/a_atk.mp3',
  ]);
});

test('warmupQueue: dedupes across groups and tolerates an empty manifest', () => {
  const dup = { audio: { bgm: { lobby: { loop: '/x.mp3' } }, sfx: { ui: { a: '/x.mp3' } } }, chars: {} };
  assert.deepEqual(warmupQueue(dup), ['/x.mp3']);
  assert.deepEqual(warmupQueue(null), []);
  assert.deepEqual(warmupQueue({}), []);
});

test('collectUrls walks nested objects and arrays for root-relative strings only', () => {
  assert.deepEqual(collectUrls({ a: ['/1.png', { b: '/2.png' }], c: 'http://x/y.png', d: null }), ['/1.png', '/2.png']);
});

test('charUrls: the four art fields, spine and junk ignored', () => {
  assert.deepEqual(charUrls(manifest.chars.a), ['/assets/a.png', '/assets/a_2.png', '/assets/p/a.png']);
  assert.deepEqual(charUrls(undefined), []);
});

function deferredFetchLog(log) {
  // a fetch stub: records the url, returns a promise the test resolves per url
  const pending = new Map();
  return {
    fetch: (url) => {
      log.push(url);
      return new Promise((resolve) => pending.set(url, () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
    },
    settle: (url) => { const f = pending.get(url); assert.ok(f, url); pending.delete(url); f(); },
  };
}

test('warmup: starts after the delay, two at a time, in queue order; drained queue stops the pump', async () => {
  const log = [];
  const { fetch, settle } = deferredFetchLog(log);
  let fired = [];
  const warm = createWarmup({
    fetch, setTimeout: (fn) => { fired.push(fn); }, saveData: false,
    getManifest: () => manifest,
  });
  warm.start();
  assert.equal(fired.length, 1);
  fired.shift()(); // the start delay elapses
  assert.deepEqual(log.slice(0, 2), ['/assets/bgm/lobby.mp3', '/assets/bgm/combat.mp3']);
  assert.equal(warm.remaining, 6); // 10 queued, 2 done, 2 in flight
  const tick = () => new Promise((r) => setTimeout(r, 0));
  for (const url of warmupQueue(manifest)) { // settle in queue order; each freed slot pulls the next url
    if (warm.remaining === null) break;
    settle(url);
    await tick();
  }
  await tick();
  assert.equal(warm.remaining, 0);
  assert.equal(log.length, warmupQueue(manifest).length);
  warm.start(); // a drained queue never restarts
  await tick();
  assert.equal(log.length, warmupQueue(manifest).length);
});

test('warmup: stop aborts, resume continues from the cursor with fresh fetches', async () => {
  const log = [];
  const { fetch, settle } = deferredFetchLog(log);
  let fired = [];
  const warm = createWarmup({
    fetch, setTimeout: (fn) => { fired.push(fn); }, saveData: false,
    getManifest: () => manifest,
  });
  warm.start();
  fired.shift()();
  assert.equal(log.length, 2);
  warm.stop(); // the two in-flight fetches abort
  settle('/assets/bgm/lobby.mp3'); settle('/assets/bgm/combat.mp3'); // they settle as aborted
  await new Promise((r) => setTimeout(r, 0));
  const afterStop = log.length;
  warm.start(); // resume: no start delay, continues from the cursor
  assert.deepEqual(log.slice(afterStop), ['/assets/sfx/click.mp3', '/assets/sfx/deploy.mp3']);
});

test('warmup: saveData never starts', () => {
  const log = [];
  const { fetch } = deferredFetchLog(log);
  const warm = createWarmup({ fetch, setTimeout: () => {}, saveData: true, getManifest: () => manifest });
  warm.start();
  warm.start();
  assert.deepEqual(log, []);
});

test('warmup: waits for the manifest, polling until it arrives', async () => {
  const log = [];
  const { fetch } = deferredFetchLog(log);
  let fired = [];
  let m = null;
  const warm = createWarmup({ fetch, setTimeout: (fn) => { fired.push(fn); }, saveData: false, getManifest: () => m });
  warm.start();
  fired.shift()(); // no manifest yet -> retry scheduled
  assert.deepEqual(log, []);
  m = manifest;
  fired.shift()(); // retry now finds it
  assert.deepEqual(log.slice(0, 2), ['/assets/bgm/lobby.mp3', '/assets/bgm/combat.mp3']);
});

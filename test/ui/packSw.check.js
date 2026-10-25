// The service worker itself cannot run under Node (it is browser-only), but it can be parsed: sw.js must be a
// valid classic script (upstream 0.3.0 keeps it classic for older browsers and runs it in a vm sandbox in
// test/ui/asset-import.test.js), and the pack constants it inlines must stay in sync with ui/pack.js — this
// worker is pack.js's hand-inlined twin. Plus the registration gate from ui/packInstall.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACK_CACHE, RUNTIME_CACHE, PACK_META_KEY, SIZES_URL, RUNTIME_MAX_ENTRIES,
} from '../../public/js/ui/pack.js';
import { shouldInstallPack } from '../../public/js/ui/packInstall.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SW = join(ROOT, 'public', 'sw.js');

test('public/sw.js parses as a classic script (vm.Script — in-process, no subprocess spawn)', () => {
  // compiled in-process on purpose: this machine's Node returns EBUSY when a Node process spawns Node
  // (spawnSync status null), which made the old `node --check` subprocess form fail environmentally
  const src = readFileSync(SW, 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'public/sw.js' }));
});

test('public/sw.js is a classic script: no static import/export', () => {
  const src = readFileSync(SW, 'utf8');
  assert.ok(!/^\s*(import|export)\s/m.test(src), 'a classic worker cannot import — helpers are inlined');
});

test('the inlined pack constants stay in sync with ui/pack.js (the worker is its twin)', () => {
  const src = readFileSync(SW, 'utf8');
  for (const [name, value] of [
    ['PACK_CACHE', PACK_CACHE], ['RUNTIME_CACHE', RUNTIME_CACHE], ['PACK_META_KEY', PACK_META_KEY],
    ['SIZES_URL', SIZES_URL], ['RUNTIME_MAX_ENTRIES', RUNTIME_MAX_ENTRIES],
  ]) {
    const line = typeof value === 'string' ? `const ${name} = '${value}';` : `const ${name} = ${value};`;
    assert.ok(src.includes(line), `${name} drifted from ui/pack.js`);
  }
});

test('the worker keeps upstream 0.3.0 imported-art contract constants (assetCache.js twin)', () => {
  const src = readFileSync(SW, 'utf8');
  assert.ok(src.includes("const IMPORTED_ASSET_CACHE = 'sp-imported-assets-v1';"));
  assert.ok(src.includes("const IMPORTED_ASSET_CACHE_PREFIX = 'sp-imported-assets-';"));
  assert.ok(src.includes('const IMPORTED_ASSET_PATH = /^\\/(?:assets|fonts|media)\\/~[0-9a-f]{16}\\//;'));
  // the imported cache is only read by the worker — the page import (assetPack.js) writes it
  assert.ok(!/IMPORTED_ASSET_CACHE\)[^)]*\.put\(/.test(src), 'the worker never writes the imported cache');
});

test('registration gate: browsers without serviceWorker and automation never register', () => {
  assert.equal(shouldInstallPack({ serviceWorker: {} }), true);
  assert.equal(shouldInstallPack({ serviceWorker: {}, webdriver: true }), false, 'navigator.webdriver (e2e)');
  assert.equal(shouldInstallPack({}), false, 'no serviceWorker support');
  assert.equal(shouldInstallPack(null), false);
  assert.equal(shouldInstallPack(), false, 'Node: its navigator has no serviceWorker');
});

// The service worker itself cannot run under Node (it is browser-only), but it can be parsed: sw.js must be a
// valid ES module whose static imports resolve to files the static server actually serves. Plus the registration
// gate from ui/packInstall.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldInstallPack } from '../../public/js/ui/packInstall.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SW = join(ROOT, 'public', 'sw.js');

test('public/sw.js parses as an ES module (node --check)', () => {
  const src = readFileSync(SW, 'utf8');
  const r = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: src, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || 'sw.js failed to parse');
});

test('public/sw.js imports only same-origin modules that exist under public/', () => {
  const src = readFileSync(SW, 'utf8');
  const specs = [...src.matchAll(/import[\s\S]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specs.length >= 1, 'the worker imports its shared logic');
  for (const spec of specs) {
    assert.match(spec, /^\/js\//, `same-origin absolute specifier, got ${spec}`);
    assert.ok(existsSync(join(ROOT, 'public', spec.slice(1))), `${spec} exists under public/`);
  }
});

test('registration gate: browsers without serviceWorker and automation never register', () => {
  assert.equal(shouldInstallPack({ serviceWorker: {} }), true);
  assert.equal(shouldInstallPack({ serviceWorker: {}, webdriver: true }), false, 'navigator.webdriver (e2e)');
  assert.equal(shouldInstallPack({}), false, 'no serviceWorker support');
  assert.equal(shouldInstallPack(null), false);
  assert.equal(shouldInstallPack(), false, 'Node: its navigator has no serviceWorker');
});

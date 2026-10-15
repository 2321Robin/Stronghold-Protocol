// tools/pack-assets.mjs end to end on a fixture tree: the pack zip's _pack.json, entry set and bytes; the
// --sizes deployment table; and the missing-file guard (--allow-missing and the hard failure).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipEntries, extractZipEntry } from '../public/js/ui/packZip.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'pack-assets.mjs');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const MP3 = new Uint8Array(10_000).map((_, i) => i & 0xff);

async function buildFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sp-pack-'));
  const pub = join(dir, 'public');
  await mkdir(join(pub, 'assets', 'audio', 'bgm'), { recursive: true });
  await mkdir(join(pub, 'assets', 'char'), { recursive: true });
  await mkdir(join(pub, 'fonts'), { recursive: true });
  await writeFile(join(pub, 'assets', 'char', 'a.png'), PNG);
  await writeFile(join(pub, 'assets', 'audio', 'bgm', 'act1.mp3'), MP3);
  await writeFile(join(pub, 'fonts', 'bender-regular.woff2'), 'woff2-bytes');
  const manifest = {
    version: 1, hash: 'deadbeef01', generator: 'fixture',
    chars: { a: { avatar: '/assets/char/a.png' } },
    audio: { bgm: { act1: { loop: '/assets/audio/bgm/act1.mp3' } } },
    fonts: { bender: '/fonts/bender-regular.woff2' },
  };
  const manifestPath = join(dir, 'assets.json');
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { dir, pub, manifestPath };
}

function run(args) {
  return spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', cwd: ROOT });
}

test('pack build: _pack.json first, every manifest file as an entry, meta carries hash + sizes', async () => {
  const fx = await buildFixture();
  try {
    const out = join(fx.dir, 'pack.zip');
    const r = run(['--no-local', '--manifest', fx.manifestPath, '--public', fx.pub, '--out', out]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const zip = new Uint8Array(await readFile(out));
    const entries = zipEntries(zip);
    assert.equal(entries[0].name, '_pack.json', 'the meta leads so stream readers see it first');
    assert.deepEqual(entries.slice(1).map((e) => e.name).sort(), [
      'assets/audio/bgm/act1.mp3', 'assets/char/a.png', 'fonts/bender-regular.woff2',
    ]);
    const blob = new Blob([zip]);
    const meta = JSON.parse(new TextDecoder().decode(await extractZipEntry(blob, entries[0])));
    assert.equal(meta.manifest, 'deadbeef01');
    assert.equal(meta.count, 3);
    assert.deepEqual(meta.files, {
      '/assets/audio/bgm/act1.mp3': MP3.length,
      '/assets/char/a.png': PNG.length,
      '/fonts/bender-regular.woff2': 11,
    });
    assert.equal(meta.totalBytes, MP3.length + PNG.length + 11);
    // entry bytes survive the archive byte-identical, CRC-verified on the way out
    const mp3 = entries.find((e) => e.name === 'assets/audio/bgm/act1.mp3');
    assert.deepEqual(await extractZipEntry(blob, mp3), MP3);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('sizes mode: the deployment table records the same urls and current sizes', async () => {
  const fx = await buildFixture();
  try {
    const sizesOut = join(fx.dir, 'asset-sizes.json');
    const r = run(['--no-local', '--sizes', '--manifest', fx.manifestPath, '--public', fx.pub, '--sizes-out', sizesOut]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const table = JSON.parse(await readFile(sizesOut, 'utf8'));
    assert.equal(table.manifest, 'deadbeef01');
    assert.equal(table.count, 3);
    assert.equal(table.files['/assets/char/a.png'], PNG.length);
    assert.equal(table.files['/assets/audio/bgm/act1.mp3'], MP3.length);
    assert.equal(typeof table.builtAt, 'string');
    assert.equal((await stat(sizesOut)).size < 2048, true, 'compact JSON');
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('missing files: hard failure by default, --allow-missing leaves them out of pack and meta', async () => {
  const fx = await buildFixture();
  try {
    await rm(join(fx.pub, 'assets', 'char', 'a.png'));
    const bad = run(['--no-local', '--manifest', fx.manifestPath, '--public', fx.pub, '--out', join(fx.dir, 'no.zip')]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /1 files are missing/);
    assert.match(bad.stderr, /assets\/char\/a\.png/);
    assert.equal(await stat(join(fx.dir, 'no.zip')).then(() => true, () => false), false, 'no pack written');

    const out = join(fx.dir, 'pack.zip');
    const ok = run(['--no-local', '--allow-missing', '--manifest', fx.manifestPath, '--public', fx.pub, '--out', out]);
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    const zip = new Uint8Array(await readFile(out));
    const entries = zipEntries(zip);
    assert.deepEqual(entries.map((e) => e.name).sort(), ['_pack.json', 'assets/audio/bgm/act1.mp3', 'fonts/bender-regular.woff2']);
    const meta = JSON.parse(new TextDecoder().decode(await extractZipEntry(new Blob([zip]), entries[0])));
    assert.equal(meta.count, 2);
    assert.equal(Object.hasOwn(meta.files, '/assets/char/a.png'), false, 'the missing file is not in the pack meta');
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('local-client art: folded in by default, excluded by --no-local, deduped against the main manifest', async () => {
  const fx = await buildFixture();
  try {
    await mkdir(join(fx.pub, 'assets', 'local', 'map', 'autochess'), { recursive: true });
    await writeFile(join(fx.pub, 'assets', 'local', 'map', 'autochess', 'TX_BG.png'), PNG);
    const localPath = join(fx.dir, 'local-assets.json');
    // one URL of its own + one the main manifest already lists (must not double-count)
    await writeFile(localPath, JSON.stringify({
      version: 1, source: 'local-client', count: 2,
      groups: {
        map: { autochess: { bg: { path: '/assets/local/map/autochess/TX_BG.png' } } },
        dup: { path: '/assets/char/a.png' },
      },
    }));

    const readMeta = async (file) => {
      const zip = new Uint8Array(await readFile(file));
      const entries = zipEntries(zip);
      return { entries, meta: JSON.parse(new TextDecoder().decode(await extractZipEntry(new Blob([zip]), entries[0]))) };
    };

    const out = join(fx.dir, 'pack.zip');
    const r = run(['--manifest', fx.manifestPath, '--local', localPath, '--public', fx.pub, '--out', out]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const { entries, meta } = await readMeta(out);
    assert.ok(entries.some((e) => e.name === 'assets/local/map/autochess/TX_BG.png'), 'the local art is an entry');
    assert.equal(meta.count, 4, '3 manifest files + 1 new local file (the duplicate URL is deduped)');
    assert.equal(meta.local, 2, 'the local manifest contributed 2 URLs');
    assert.equal(meta.manifest, 'deadbeef01', 'the pack identity stays the main manifest hash');

    const out2 = join(fx.dir, 'pack2.zip');
    const r2 = run(['--no-local', '--manifest', fx.manifestPath, '--public', fx.pub, '--out', out2]);
    assert.equal(r2.status, 0, r2.stderr || r2.stdout);
    const { meta: meta2 } = await readMeta(out2);
    assert.equal(meta2.count, 3, '--no-local packs the main manifest only');
    assert.equal(meta2.local, null);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('the committed manifest is fully covered by a build from this checkout (skipped without assets)', async () => {
  let hasAssets = false;
  try { hasAssets = (await stat(join(ROOT, 'public', 'assets'))).isDirectory(); } catch { /* CI: no assets */ }
  if (!hasAssets) return; // static hosts / PR checkouts carry no asset tree
  const fx = await mkdtemp(join(tmpdir(), 'sp-pack-real-'));
  try {
    const r = run(['--sizes', '--sizes-out', join(fx, 'sizes.json'), '--quiet']);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const table = JSON.parse(await readFile(join(fx, 'sizes.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(ROOT, 'data', 'assets.json'), 'utf8'));
    assert.equal(table.manifest, manifest.hash, 'the size table was built from the committed manifest');
  } finally {
    await rm(fx, { recursive: true, force: true });
  }
});

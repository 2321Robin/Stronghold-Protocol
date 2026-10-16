#!/usr/bin/env node
// tools/pack-assets.mjs — build the local asset pack (playtest #33, LOCAL LINE ONLY — never upstream).
//
// Two modes over one URL list (every root-relative URL in data/assets.json — the whole manifest — plus, when the file
// is there, every URL in data/local-assets.json, the per-machine local-client art layer: the official board map/mesh,
// UI sprites, emoticons and guide pages. One zip, per the 2026-10-10 定稿: 点对点发包、不分包):
//
//   node tools/pack-assets.mjs
//     → dist/stronghold-assets.zip — a store-only zip (entries are the manifests' files verbatim, PNG/MP3/WebP
//       are already compressed) plus a `_pack.json` first entry: { manifest: <assets.json hash>, local: <local count
//       or null>, builtAt, count, totalBytes, files: { url: size } }. Share the zip by any channel (点对点 — no
//       download pipeline involved); players import it once at /pack.html, which writes each entry into the
//       'sp-pack-v1' Cache Storage that public/sw.js serves /assets/**, /fonts/** and /media/** from.
//
//   node tools/pack-assets.mjs --sizes
//     → data/asset-sizes.json — the deployment-side size table { manifest, builtAt, count, files: { url: size } }.
//       Run it on the server whenever assets.json (or the local art) changes (one command after a deploy): the SW
//       compares it against the pack's recorded sizes per URL and automatically bypasses the pack for same-URL
//       content changes. Without it, same-URL changes fall back to the documented cure (re-import); new URLs never
//       needed it — they miss the pack by construction.
//
// The local art is folded in because /assets/local/** is NOT in data/assets.json (it is a separate, per-machine
// manifest) yet the server still ships it on every first load — 67 MB of board map/mesh, UI sprites and guide pages.
// Leaving it out was the one hole in "不再由服务器下发所有的资源". Pass --no-local to build the manifest-only pack.
//
// The zip codec is the repo's own store-only module (public/js/ui/packZip.js) shared with the browser side —
// no zip dependency is added to the project.

import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { crc32, dosStamp, zipLocalChunk, zipCentralChunk, zipEndChunk } from '../public/js/ui/packZip.js';

const DEFAULT_MANIFEST = 'data/assets.json';
const DEFAULT_LOCAL = 'data/local-assets.json';
const DEFAULT_PUBLIC = 'public';
const DEFAULT_OUT = 'dist/stronghold-assets.zip';
const DEFAULT_SIZES_OUT = 'data/asset-sizes.json';
const PROGRESS_EVERY = 500;
const PROGRESS_BYTES = 128 << 20;

function usage() {
  console.log(`usage: node tools/pack-assets.mjs [options]
  --out <file>          pack output path (default ${DEFAULT_OUT})
  --manifest <file>     assets manifest (default ${DEFAULT_MANIFEST})
  --local <file>        local-client art manifest folded into the pack (default ${DEFAULT_LOCAL};
                        a missing file is skipped — the pack then covers the main manifest only)
  --no-local            pack the main manifest only, without the local-client art layer
  --public <dir>        served root the manifest URLs resolve against (default ${DEFAULT_PUBLIC})
  --sizes               write the deployment size table instead of a pack
  --sizes-out <file>    size table output path (default ${DEFAULT_SIZES_OUT})
  --allow-missing       skip files missing on disk instead of failing (they stay out of the pack and
                        keep loading from the server)
  --quiet               only log the summary`);
}

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT, manifest: DEFAULT_MANIFEST, local: DEFAULT_LOCAL, publicDir: DEFAULT_PUBLIC,
    sizes: false, sizesOut: DEFAULT_SIZES_OUT, allowMissing: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sizes') opts.sizes = true;
    else if (a === '--allow-missing') opts.allowMissing = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--no-local') opts.local = null;
    else if (a === '--out' || a === '--manifest' || a === '--local' || a === '--public' || a === '--sizes-out') {
      const v = argv[++i];
      if (!v) { usage(); process.exitCode = 1; return null; }
      if (a === '--out') opts.out = v;
      else if (a === '--manifest') opts.manifest = v;
      else if (a === '--local') opts.local = v;
      else if (a === '--public') opts.publicDir = v;
      else opts.sizesOut = v;
    } else if (a === '-h' || a === '--help') { usage(); return null; }
    else { console.error(`unknown argument: ${a}`); usage(); process.exitCode = 1; return null; }
  }
  return opts;
}

// Inlined rather than imported from ui/warmup.js (playtest #28): the pack tool must not depend on the warmup mod,
// so #33 stands on its own and #28 can be dropped without breaking `node tools/pack-assets.mjs`.
const isPath = (v) => typeof v === 'string' && v.startsWith('/');

/** Every URL-looking string below `node` (the manifest holds root-relative paths as plain string leaves). */
export function collectUrls(node, out = []) {
  if (isPath(node)) out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectUrls(v, out);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collectUrls(v, out);
  return out;
}

/** Every URL the manifest lists, deduplicated and sorted — the pack and the size table cover exactly this set. */
export function manifestUrls(manifest) {
  return [...new Set(collectUrls(manifest))].sort();
}

/** url → on-disk size under `publicDir`; missing files are collected instead of thrown. */
export async function measureFiles(urls, publicDir) {
  const sizes = {};
  const missing = [];
  for (const url of urls) {
    const abs = path.join(publicDir, url);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) throw new Error('not a file');
      sizes[url] = stat.size;
    } catch {
      missing.push(url);
    }
  }
  return { sizes, missing };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts) return;
  const log = (...a) => { if (!opts.quiet) console.log(...a); };

  const manifest = JSON.parse(await fs.readFile(opts.manifest, 'utf8'));
  const manifestUrlList = manifestUrls(manifest);
  if (!manifestUrlList.length) throw new Error(`no URLs found in ${opts.manifest}`);
  log(`manifest ${opts.manifest}: hash ${manifest.hash || '(none)'} · ${manifestUrlList.length} URLs`);

  // The local-client art layer is a second manifest: /assets/local/** (board map/mesh, UI sprites, guide pages,
  // emoticons) is not in data/assets.json, yet the server still ships it on every first load — so the pack covers
  // it too. Absent file (a checkout without the local art) is not an error: pack the main manifest only.
  let localCount = null;
  let localUrlList = [];
  if (opts.local) {
    try {
      const localManifest = JSON.parse(await fs.readFile(opts.local, 'utf8'));
      localUrlList = manifestUrls(localManifest);
      localCount = localUrlList.length;
      log(`local    ${opts.local}: source ${localManifest.source || '(none)'} · ${localCount} URLs`);
    } catch {
      log(`local    ${opts.local}: not found — packing ${opts.manifest} only`);
    }
  }

  const urls = [...new Set([...manifestUrlList, ...localUrlList])].sort();
  if (urls.length > 0xfffd) throw new Error(`${urls.length} URLs exceed the store-only zip's 65534 entries`);

  const { sizes, missing } = await measureFiles(urls, opts.publicDir);
  if (missing.length) {
    const kept = missing.slice(0, 20).join('\n  ');
    if (!opts.allowMissing) {
      console.error(`\n${missing.length} files are missing under ${opts.publicDir}, e.g.\n  ${kept}\n` +
        'Fix the asset checkout, or pass --allow-missing to build without them.');
      process.exitCode = 1;
      return;
    }
    log(`--allow-missing: ${missing.length} files skipped, e.g.\n  ${kept}`);
  }
  const usable = urls.filter((u) => u in sizes);
  const totalBytes = usable.reduce((s, u) => s + sizes[u], 0);
  const builtAt = new Date().toISOString();

  if (opts.sizes) {
    const table = { manifest: manifest.hash || null, local: localCount, builtAt, count: usable.length, files: sizes };
    await fs.mkdir(path.dirname(opts.sizesOut), { recursive: true });
    await fs.writeFile(opts.sizesOut, JSON.stringify(table));
    console.log(`wrote ${opts.sizesOut}: ${usable.length} files, ${totalBytes} bytes` +
      (localCount ? ` (incl. ${localCount} local-client art URLs)` : ''));
    return;
  }

  await fs.mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  const stream = createWriteStream(opts.out);
  await new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('open', resolve);
  });

  const stamp = dosStamp();
  const meta = {
    manifest: manifest.hash || null, local: localCount, builtAt, generator: 'tools/pack-assets.mjs',
    count: usable.length, totalBytes, files: sizes,
  };
  const entries = [{ name: '_pack.json', data: new TextEncoder().encode(JSON.stringify(meta)) },
    ...usable.map((u) => ({ name: u.slice(1), path: path.join(opts.publicDir, u), size: sizes[u] }))];

  const records = [];
  let offset = 0;
  let lastLogBytes = 0;
  let n = 0;
  try {
    for (const entry of entries) {
      const data = entry.data || await fs.readFile(entry.path);
      const crc = crc32(data);
      const local = zipLocalChunk(entry.name, data.length, crc, stamp);
      records.push(zipCentralChunk(entry.name, data.length, crc, stamp, offset));
      stream.write(local);
      stream.write(data);
      offset += local.length + data.length;
      n++;
      if (n % PROGRESS_EVERY === 0 || offset - lastLogBytes >= PROGRESS_BYTES) {
        lastLogBytes = offset;
        log(`  ${n}/${entries.length}  ${(offset / (1 << 20)).toFixed(0)} MiB`);
      }
    }
    const cd = concat(records);
    stream.write(cd);
    stream.write(zipEndChunk(records.length, cd.length, offset));
    await new Promise((resolve, reject) => {
      stream.end(resolve);
      stream.on('error', reject);
    });
  } catch (err) {
    stream.destroy();
    throw err;
  }

  console.log(`wrote ${opts.out}: ${usable.length} files, ${totalBytes} bytes of assets, ` +
    `${offset} bytes zip, manifest hash ${manifest.hash || '(none)'}` +
    (localCount ? `, incl. ${localCount} local-client art URLs` : ''));
  if (missing.length) console.log(`(${missing.length} files were skipped — pass them on the next --allow-missing run or fix the checkout)`);
}

function concat(list) {
  let total = 0;
  for (const p of list) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of list) { out.set(p, at); at += p.length; }
  return out;
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});

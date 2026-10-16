// ui/packPanel.js — 设置 →「资源包」section (playtest #33, local line, never upstream).
//
// The same status / import / clear capability as the standalone public/pack.html, folded into the settings modal so the
// player never has to know the /pack.html URL: the settings gear (title screen, lobby, room, match) is the entry point.
// The Cache Storage format and the per-URL "may the pack serve this" decisions live in ui/pack.js (shared with
// public/sw.js); the zip reader is ui/packZip.js. This file is only the UI.
//
// Import = local disk → browser: it clears the old pack, writes every entry with a CRC check, then writes the meta as
// the commit marker and pings the service worker. New URLs (the daily churn — fresh operators, voices, skins) simply
// fall back to the network; see ui/pack.js for the full decision model. public/pack.html stays for a cold browser that
// has not reached the game yet.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel } from './components.js';
import { t } from '../../../shared/i18n.js';
import { PACK_CACHE, SIZES_URL, readPackMeta, putPackEntry, putPackMeta } from './pack.js';
import { zipEntriesFromBlob, extractZipEntry } from './packZip.js';

const PACK_META_NAME = '_pack.json';
const MB = 1024 * 1024;
const fmtBytes = (n) => n == null ? '—'
  : n >= 1024 * MB ? (n / (1024 * MB)).toFixed(2) + ' GB'
    : n >= MB ? (n / MB).toFixed(1) + ' MB'
      : Math.round(n / 1024) + ' KB';

/** Cache Storage keys are absolute URLs; the page and the service worker have to agree (ui/pack.js absoluteUrl). */
const origin = () => globalThis.location?.origin || 'http://localhost';

/** Ping every live service worker so it re-reads the pack state instead of waiting out its own TTL. */
async function notifySw() {
  try {
    if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage({ type: 'sp-pack-updated' });
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) if (r.active) r.active.postMessage({ type: 'sp-pack-updated' });
  } catch { /* the worker also re-reads state on its own TTL */ }
}

/**
 * 设置 →「资源包」: the pack's status (server manifest / deployed size table / installed pack / storage), the import
 * from a local-disk zip, and 清空 — the settings-modal twin of public/pack.html.
 */
export function PackSection() {
  const [serverHash, setServerHash] = useState(undefined); // undefined loading · null no hash · string hash
  const [hashFail, setHashFail] = useState(false);
  const [hasSizes, setHasSizes] = useState(null);          // null loading
  const [packMeta, setPackMeta] = useState(undefined);     // undefined reading · null not installed
  const [storage, setStorage] = useState(undefined);       // undefined reading
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);                  // { done, total, bytes, totalBytes, rate, pct }
  const [fails, setFails] = useState(null);                // string[] | null
  const [note, setNote] = useState(null);                  // { text, tone?: 'ok'|'warn'|'err' }
  const fileRef = useRef(null);

  const loadStatus = async () => {
    try {
      const res = await fetch('/data/assets.json', { cache: 'no-cache' });
      const m = await res.json();
      setServerHash(m && m.hash ? m.hash : null);
      setHashFail(!(m && m.hash));
    } catch { setServerHash(null); setHashFail(true); }
    try {
      const res = await fetch(SIZES_URL, { cache: 'no-cache' });
      const tt = res.ok ? await res.json() : null;
      setHasSizes(!!(tt && tt.files));
    } catch { setHasSizes(false); }
    setPackMeta(await readPackMeta(origin()));
    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
        setStorage({ usage: est.usage, quota: est.quota, persisted });
      } else setStorage({ unsupported: true });
    } catch { setStorage({ unknown: true }); }
  };

  // The modal mounts only while open, so a mount-time load is the right moment; re-run after every import / clear.
  useEffect(() => { loadStatus(); }, []);

  const pick = () => { if (!busy) fileRef.current?.click(); };

  const onFile = (e) => {
    const f = (e.currentTarget.files && e.currentTarget.files[0]) || null;
    setFile(f);
    setFails(null);
    setProg(null);
    setNote(f ? { text: t('已选择 {name}（{size}）', { name: f.name, size: fmtBytes(f.size) }) } : null);
  };

  const doImport = async () => {
    const f = file;
    if (!f) return;
    setBusy(true);
    setFails(null);
    setProg(null);
    try {
      setNote({ text: t('读取压缩包…') });
      const entries = await zipEntriesFromBlob(f);
      const metaEntry = entries.find((e) => e.name === PACK_META_NAME);
      if (!metaEntry) throw new Error(t('这不是资源包：缺少 _pack.json'));
      const metaBytes = await extractZipEntry(f, metaEntry);
      const meta = JSON.parse(new TextDecoder().decode(metaBytes));
      if (!meta || typeof meta.files !== 'object' || !meta.files || !Object.keys(meta.files).length) {
        throw new Error(t('_pack.json 缺少 files 大小表'));
      }
      const files = meta.files;
      const body = entries.filter((e) => e.name !== PACK_META_NAME);
      const totalBytes = body.reduce((s, e) => s + e.size, 0) || 1;
      const t0 = Date.now();

      await caches.delete(PACK_CACHE);
      let done = 0;
      let written = 0;
      let bytes = 0;
      const failed = [];
      const writtenFiles = {};
      for (const entry of body) {
        const url = '/' + entry.name;
        let bad = null;
        if (!/^\/(assets|fonts)\//.test(url) || url.includes('..')) bad = t('不在资源目录内，已跳过');
        else if (!Object.hasOwn(files, url)) bad = t('不在清单中，已跳过');
        else if (files[url] !== entry.size) bad = t('大小与清单不符，已跳过');
        if (!bad) {
          try {
            const buf = await extractZipEntry(f, entry); // CRC-verified
            await putPackEntry(url, buf, origin());
            writtenFiles[url] = buf.byteLength;
            written++;
            bytes += buf.byteLength;
          } catch (err) { bad = String(err.message || err); }
        }
        if (bad) failed.push(entry.name + ' — ' + bad);
        done++;
        if (done % 25 === 0 || done === body.length) {
          const secs = Math.max(0.1, (Date.now() - t0) / 1000);
          setProg({ done, total: body.length, bytes, totalBytes, rate: bytes / secs, pct: 100 * bytes / totalBytes });
          setNote({ text: t('写入本地缓存…') });
        }
      }

      await putPackMeta({
        manifest: meta.manifest || null,
        builtAt: meta.builtAt || new Date().toISOString(),
        generator: meta.generator || null,
        count: written,
        totalBytes: bytes,
        files: writtenFiles,
      }, origin());
      await notifySw();
      setProg({ done, total: body.length, bytes, totalBytes, rate: 0, pct: 100 });
      if (failed.length) {
        setFails(failed);
        setNote({ text: t('导入完成，{written} 条成功、{failed} 条失败/跳过（失败条目照常回源）', { written, failed: failed.length }), tone: 'warn' });
      } else {
        setNote({ text: t('导入完成 ✓ {written} 个文件，{bytes}', { written, bytes: fmtBytes(bytes) }), tone: 'ok' });
      }
    } catch (err) {
      setNote({ text: t('导入失败：{error}', { error: String(err.message || err) }), tone: 'err' });
    } finally {
      setBusy(false);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await loadStatus();
    }
  };

  const doClear = async () => {
    if (!globalThis.confirm(t('清空本机资源包？之后的资源全部由服务器下发。'))) return;
    setBusy(true);
    try {
      await caches.delete(PACK_CACHE);
      await notifySw();
      setNote({ text: t('已清空 ✓'), tone: 'ok' });
    } catch (err) {
      setNote({ text: t('清空失败：{error}', { error: String(err.message || err) }), tone: 'err' });
    } finally {
      setBusy(false);
      await loadStatus();
    }
  };

  // ---- derived status text ----
  const manifestText = serverHash === undefined ? t('加载中…')
    : serverHash === null ? (hashFail ? t('加载失败（需要本站服务）') : t('未取得'))
      : serverHash;
  const sizesText = hasSizes === null ? t('加载中…') : hasSizes ? t('已部署') : t('未部署（可选）');
  const packText = packMeta === undefined ? t('加载中…')
    : packMeta === null ? t('未安装 —— 游戏照常从服务器加载')
      : t('已安装 {count} 个文件 · {bytes} · 清单 {manifest} · 构建于 {built}', {
        count: packMeta.count,
        bytes: fmtBytes(packMeta.totalBytes),
        manifest: packMeta.manifest || '?',
        built: packMeta.builtAt ? new Date(packMeta.builtAt).toLocaleString() : '?',
      });
  let verdict = '—';
  let verdictTone = '';
  if (packMeta === undefined) verdict = t('加载中…');
  else if (packMeta && !serverHash) verdict = t('无法对比（服务器清单未取得）');
  else if (packMeta && packMeta.manifest === serverHash) { verdict = t('✓ 包与服务器清单一致'); verdictTone = 'is-ok'; }
  else if (packMeta) { verdict = t('⚠ 包基于旧清单 {old}，服务器已是 {hash}', { old: packMeta.manifest || '?', hash: serverHash }); verdictTone = 'is-warn'; }
  let storageText = '—';
  if (storage === undefined) storageText = t('加载中…');
  else if (storage && storage.unsupported) storageText = t('浏览器未提供 estimate()');
  else if (storage && storage.usage != null) {
    storageText = `${fmtBytes(storage.usage)} / ${fmtBytes(storage.quota)}`
      + (storage.persisted === null ? '' : ' · ' + (storage.persisted ? t('持久存储已授予') : t('持久存储未授予')));
  }

  const noteCls = 'set-pack__note' + (note?.tone ? ` is-${note.tone}` : '');
  return html`<section class="set-pack" aria-labelledby="set-pack-title">
    <div class="set-keys__head">
      <span class="set-row__label" id="set-pack-title">${t('资源包')}<${MicroLabel}>ASSET PACK<//></span>
      <${Button} variant="ghost" size="sm" icon="check" class="set-pack__import" disabled=${busy || !file} onClick=${doImport}>${t('导入')}<//>
    </div>
    <p class="set-hint">${t('把资源包 zip 一次性写进本浏览器（本地磁盘 → 浏览器，不吃服务器带宽）。之后游戏内的资源请求由本地缓存直接应答，新资源自动回源；需要 HTTPS（或 localhost）与支持 Service Worker 的桌面浏览器。')}</p>
    <div class="set-pack__rows">
      <div class="set-pack__row"><span class="set-pack__k">${t('服务器清单')}</span><span class="set-pack__v">${manifestText}</span></div>
      <div class="set-pack__row"><span class="set-pack__k">${t('部署尺寸表')}</span><span class="set-pack__v">${sizesText}</span></div>
      <div class="set-pack__row"><span class="set-pack__k">${t('本机资源包')}</span><span class="set-pack__v">${packText}</span></div>
      <div class="set-pack__row"><span class="set-pack__k">${t('对比结论')}</span><span class=${`set-pack__v ${verdictTone}`}>${verdict}</span></div>
      <div class="set-pack__row"><span class="set-pack__k">${t('存储占用 / 配额')}</span><span class="set-pack__v">${storageText}</span></div>
    </div>
    <input ref=${fileRef} type="file" accept=".zip,application/zip" class="set-pack__file" onChange=${onFile} disabled=${busy} />
    <div class="set-pack__actions">
      <${Button} variant="secondary" size="sm" icon="search" disabled=${busy} onClick=${pick}>${t('选择资源包 zip')}<//>
      <${Button} variant="ghost" size="sm" icon="close" disabled=${busy || !packMeta} onClick=${doClear}>${t('清空')}<//>
      ${file ? html`<span class="set-pack__picked">${file.name}</span>` : null}
    </div>
    ${prog ? html`<div class="set-pack__bar"><i style=${`width:${prog.pct.toFixed(1)}%`}></i></div>
      <div class="set-pack__picked num">${t('{done}/{total} 个文件 · {bytes}/{totalBytes} · {rate}/s', {
        done: prog.done, total: prog.total, bytes: fmtBytes(prog.bytes), totalBytes: fmtBytes(prog.totalBytes), rate: fmtBytes(prog.rate),
      })}</div>` : null}
    ${fails ? html`<pre class="set-pack__fails">${`${t('{n} 条失败/跳过：', { n: fails.length })}\n`}${fails.join('\n')}</pre>` : null}
    ${note ? html`<p class=${noteCls} role="status" aria-live="polite">${note.text}</p>` : null}
  </section>`;
}

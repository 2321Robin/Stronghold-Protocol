/**
 * mods/_framework/capture.mjs — turn existing edits into a mod without hand-writing patches.
 *
 * `git diff` is read, every hunk is trimmed of its shared context and written as a declaration:
 * a pure insertion becomes `insert-after`, anything with removed lines becomes `replace`. Captured
 * blocks are re-based on their anchor's indent, so a captured patch is written exactly the way a
 * hand-written one is.
 *
 * This is how the next local feature gets migrated: commit it as usual, then capture it, revert the
 * commit, and let the mod own it from then on.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';

const execFileP = promisify(execFile);
const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0];

function parseDiff(text) {
  const files = [];
  let cur = null;
  for (const l of String(text).split(/\r?\n/)) {
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*?) b\/(.*)$/.exec(l);
      cur = { path: (m && m[2]) || null, isNew: false, isDeleted: false, hunks: [] };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (l.startsWith('new file mode')) { cur.isNew = true; continue; }
    if (l.startsWith('deleted file mode')) { cur.isDeleted = true; continue; }
    if (l.startsWith('\\ ')) continue;
    if (l.startsWith('@@')) { cur.hunks.push({ lines: [] }); continue; }
    const hunk = cur.hunks[cur.hunks.length - 1];
    if (!hunk) continue;
    if (l.startsWith('+')) hunk.lines.push({ t: '+', text: l.slice(1) });
    else if (l.startsWith('-')) hunk.lines.push({ t: '-', text: l.slice(1) });
    else if (l.startsWith(' ')) hunk.lines.push({ t: ' ', text: l.slice(1) });
  }
  return files;
}

/** Drop the leading and trailing context a hunk carries, keeping what actually changed. */
function trim(hunk) {
  const oldLines = [];
  const newLines = [];
  for (const { t, text } of hunk.lines) {
    if (t === ' ') { oldLines.push(text); newLines.push(text); }
    else if (t === '-') oldLines.push(text);
    else newLines.push(text);
  }
  let lead = 0;
  while (lead < oldLines.length && lead < newLines.length && oldLines[lead] === newLines[lead]) lead++;
  let trail = 0;
  while (trail < oldLines.length - lead && trail < newLines.length - lead
    && oldLines[oldLines.length - 1 - trail] === newLines[newLines.length - 1 - trail]) trail++;
  // A `replace` block must start on its anchor: the engine matches `old` beginning at that line.
  // A pure insertion leaves the anchor alone and writes after it.
  const oldWasEmpty = oldLines.slice(lead, oldLines.length - trail).length === 0;
  const start = oldWasEmpty ? lead : (lead > 0 ? lead - 1 : 0);
  return {
    anchor: lead > 0 ? oldLines[lead - 1] : (oldLines[0] ?? null),
    hasAnchorAbove: lead > 0,
    old: oldLines.slice(start, oldLines.length - trail),
    neu: newLines.slice(start, newLines.length - trail),
  };
}

/** Write a block relative to its own left margin, plus how far it sits inside the anchor. */
function relativize(block, baseLen) {
  const filled = block.filter((l) => l.trim() !== '');
  if (!filled.length) return { lines: block.slice(), extra: 0 };
  let min = Infinity;
  for (const l of filled) min = Math.min(min, indentOf(l).length);
  return {
    lines: block.map((l) => (l.trim() === '' ? '' : l.slice(min))),
    extra: Math.max(0, min - baseLen),
  };
}

export function hunkToPatch(hunk, seq) {
  const { anchor, hasAnchorAbove, old, neu } = trim(hunk);
  if (anchor == null) return null;
  const baseLen = indentOf(anchor).length;
  if (!old.length && !neu.length) return null;

  if (!old.length) {
    const r = relativize(neu, baseLen);
    return {
      id: `captured-${seq}`,
      anchor,
      op: hasAnchorAbove ? 'insert-after' : 'insert-before',
      ...(r.extra ? { indent: r.extra } : {}),
      new: r.lines,
    };
  }
  const ro = relativize(old, baseLen);
  const rn = neu.length ? relativize(neu, baseLen) : { lines: [], extra: 0 };
  return {
    id: `captured-${seq}`,
    anchor,
    op: 'replace',
    ...(ro.extra ? { indent: ro.extra } : {}),
    old: ro.lines,
    new: rn.lines,
  };
}

const slug = (p) => p.replace(/[\\/]/g, '-').replace(/\.json$/, '');

/**
 * Capture a diff into `mods/<id>/`.
 * @param {string} root repository root
 * @param {{id: string, from?: string, name?: string, paths?: string[]}} opts
 */
export async function capture(root, opts) {
  const { id, from = 'HEAD', name = id, paths = [] } = opts;
  const args = ['diff', from, '--'];
  if (paths.length) args.push(...paths);
  const { stdout } = await execFileP('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const files = parseDiff(stdout).filter((f) => f.path);

  // `git diff` never sees untracked files, and those are exactly a feature's new modules.
  const { stdout: untracked } = await execFileP('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root });
  const inScope = (p) => (!paths.length || paths.some((x) => p.startsWith(x)))
    && !p.startsWith('mods/') && !p.startsWith('.workbuddy/') && p !== 'tools/mod.mjs';
  for (const p of untracked.split(/\r?\n/)) {
    if (!p || !inScope(p)) continue;
    files.push({ path: p.split(sep).join('/'), isNew: true, isDeleted: false, hunks: [] });
  }
  if (!files.length) return { id, patches: 0, files: 0, note: 'nothing to capture' };

  const dir = resolve(root, 'mods', id);
  const written = { patches: 0, files: 0, drift: [] };

  for (const f of files) {
    if (f.isNew) {
      const src = resolve(root, f.path);
      const dest = join(dir, 'files', f.path.split('/').join(sep));
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
      written.files++;
      continue;
    }
    if (f.isDeleted) { written.drift.push(`${f.path} (deleted — needs a patch by hand)`); continue; }
    // Anchor uniqueness is what makes a patch replayable; flag the ones that need a human's pick.
    const nowLines = (await readFile(resolve(root, f.path), 'utf8').catch(() => '')).split(/\r?\n/);
    const entries = [];
    let seq = 1;
    for (const h of f.hunks) {
      const p = hunkToPatch(h, seq++);
      if (!p) continue;
      const hits = nowLines.filter((l) => l.trim() === p.anchor.trim()).length;
      if (hits !== 1) p._review = `anchor occurs ${hits}× in the file — pick a more specific line`;
      entries.push(p);
    }
    if (!entries.length) continue;
    const target = join(dir, 'patches', `${slug(f.path)}.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify({ file: f.path, patches: entries }, null, 2)}\n`, 'utf8');
    written.patches += entries.length;
  }

  const manifestPath = join(dir, 'mod.json');
  let manifest = null;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* new mod */ }
  if (!manifest) {
    manifest = { id, name, upstream: false, base: 'captured' };
    await mkdir(dir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return { ...written, id };
}

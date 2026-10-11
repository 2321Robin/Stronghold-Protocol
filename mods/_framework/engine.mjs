/**
 * mods/_framework/engine.mjs — the replay engine behind the local mod layer.
 *
 * A mod does not hold edits to upstream files. It holds *declarations*: an anchor (a line that must
 * occur exactly once in the target), an operation, and the lines to write. Replaying searches for
 * the anchor again in the current upstream file, so upstream moving a function around or renaming
 * its neighbours does not break the patch. Only deleting or duplicating the anchor does — and that
 * is reported as drift with the candidate positions, instead of a rebase conflict to decode.
 *
 * Indentation is never written in a patch. Blocks are written relative to their own left margin and
 * rendered against the indent of the anchor line, so a re-indented upstream file still lines up.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileP = promisify(execFile);

export const MODS_DIR = 'mods';
/** Inside `mods/` on purpose: the state is machine-local, and `mods/.gitignore` keeps it out of git. */
export const STATE_FILE = 'mods/.state.json';
const FILES_DIR = 'files';

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const splitLines = (text) => String(text).split(/\r?\n/);
const eolOf = (text) => (String(text).includes('\r\n') ? '\r\n' : '\n');
const indentOf = (line) => (/^[ \t]*/.exec(line) || [''])[0];
const relPosix = (root, p) => relative(root, p).split(sep).join('/');

/**
 * Render a block written at its own left margin against `baseIndent`.
 * `extra` shifts the whole block further in (a block nested inside the anchor's construct);
 * it is what lets a captured patch keep the indentation it was found with.
 */
export function renderBlock(block, baseIndent, extra = 0) {
  const filled = block.filter((l) => l.trim() !== '');
  if (!filled.length) return block.slice();
  let min = Infinity;
  for (const l of filled) min = Math.min(min, indentOf(l).length);
  const pad = baseIndent + ' '.repeat(Math.max(0, extra));
  return block.map((l) => (l.trim() === '' ? '' : pad + l.slice(min)));
}

/** Every line index whose trimmed text equals `anchor` (or matches `anchorRegex`). */
export function locate(lines, patch) {
  const hits = [];
  if (typeof patch.anchorRegex === 'string') {
    let re;
    try { re = new RegExp(patch.anchorRegex); } catch { return { error: 'bad-anchor-regex', hits }; }
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i);
    return { hits };
  }
  const target = String(patch.anchor ?? '').trim();
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() === target) hits.push(i);
  return { hits };
}

const sameTrim = (a, b) => a.trim() === b.trim();

/** Does `lines` hold `block` (trimmed, same order) starting at `at`? */
const blockAt = (lines, at, block) => block.length > 0
  && at >= 0 && at + block.length <= lines.length
  && block.every((l, i) => sameTrim(lines[at + i], l));

/** Find where an already-applied patch's own output now sits. */
function findApplied(lines, patch) {
  const body = patch.new || [];
  if (!body.length) return -1;
  const probe = locate(lines, { anchor: body[0] });
  for (const at of probe.hits) if (blockAt(lines, at, body)) return at;
  // A block nested deeper than its anchor: match on the first line, then compare the rest loosely.
  for (const at of probe.hits) {
    if (blockAt(lines, at, body.map((l) => l.trim()))) return at;
  }
  return -1;
}

/**
 * Work out what one patch would do to `lines`, without writing anything.
 * @returns {{status: 'ok'|'already'|'drift', reason?: string, hits?: number[], lines?: string[]}}
 */
export function planOne(lines, patch) {
  const op = patch.op || 'insert-after';
  const { hits, error } = locate(lines, patch);
  if (error) return { status: 'drift', reason: error, hits: [] };

  if (hits.length === 0) {
    // The anchor may be gone because this patch is already applied and replaced it.
    const at = findApplied(lines, patch);
    if (at >= 0) return { status: 'already', hits: [at] };
    return { status: 'drift', reason: 'anchor-missing', hits: [] };
  }
  if (hits.length > 1) return { status: 'drift', reason: 'anchor-ambiguous', hits };

  const at = hits[0];
  const baseIndent = indentOf(lines[at]);
  const body = renderBlock(patch.new || [], baseIndent, patch.indent || 0);

  if (op === 'insert-after') {
    if (blockAt(lines, at + 1, body)) return { status: 'already', hits };
    return { status: 'ok', hits, lines: [...lines.slice(0, at + 1), ...body, ...lines.slice(at + 1)] };
  }
  if (op === 'insert-before') {
    if (blockAt(lines, at - body.length, body)) return { status: 'already', hits };
    return { status: 'ok', hits, lines: [...lines.slice(0, at), ...body, ...lines.slice(at)] };
  }
  if (op === 'replace') {
    const old = patch.old || [];
    if (blockAt(lines, at, body) && body.length === old.length) return { status: 'already', hits };
    if (blockAt(lines, at, old)) {
      return { status: 'ok', hits, lines: [...lines.slice(0, at), ...body, ...lines.slice(at + old.length)] };
    }
    // A replacement that grew or shrank the block: the old text is gone, look for ours.
    const applied = findApplied(lines, patch);
    if (applied >= 0) return { status: 'already', hits: [applied] };
    return {
      status: 'drift',
      reason: 'context-changed',
      hits,
      expected: old,
      found: lines.slice(at, at + old.length),
    };
  }
  return { status: 'drift', reason: `unknown-op:${op}`, hits };
}

function deepMerge(base, overlay) {
  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isPlain(base) || !isPlain(overlay)) return overlay;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** A JSON patch merges key by key, so upstream edits to other keys never collide. */
export function planJson(text, patch) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { status: 'drift', reason: 'invalid-json' }; }
  const merged = deepMerge(parsed, patch.merge || {});
  if (JSON.stringify(parsed) === JSON.stringify(merged)) return { status: 'already' };
  // Keep the file's own shape: `data/config.json` is one long line, the i18n packs are pretty-printed.
  const compact = !/\n\s/.test(text.slice(0, 4096));
  const body = compact ? JSON.stringify(merged) : JSON.stringify(merged, null, 2);
  const endsWithNewline = /\n$/.test(text);
  return { status: 'ok', text: endsWithNewline ? `${body}\n` : body };
}

async function walk(dir, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/** Compare two dotted version strings; negative when `a` is older. */
export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export async function upstreamVersion(root) {
  try {
    const pkg = await readJson(resolve(root, 'package.json'));
    return pkg.version || null;
  } catch { return null; }
}

export async function loadMods(root) {
  const base = resolve(root, MODS_DIR);
  const version = await upstreamVersion(root);
  let entries = [];
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return []; }
  const mods = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    const dir = join(base, e.name);
    let manifest = null;
    try { manifest = await readJson(join(dir, 'mod.json')); } catch { continue; }
    const patchDir = join(dir, 'patches');
    const patchFiles = (await walk(patchDir)).filter((f) => f.endsWith('.json')).sort();
    const patches = [];
    for (const f of patchFiles) {
      const doc = await readJson(f).catch(() => null);
      if (!doc || typeof doc.file !== 'string' || !Array.isArray(doc.patches)) continue;
      patches.push({ source: relPosix(root, f), file: doc.file, entries: doc.patches });
    }
    const filesDir = join(dir, FILES_DIR);
    const files = (await walk(filesDir)).map((f) => ({
      from: f,
      to: relative(filesDir, f).split(sep).join('/'),
    }));
    // A mod upstream has since shipped natively: replaying it would fight the native code.
    const retiredIn = manifest.retiredIn || null;
    const retired = !!(retiredIn && version && cmpVersion(version, retiredIn) >= 0);
    mods.push({
      id: manifest.id || e.name,
      name: manifest.name || manifest.id || e.name,
      dir,
      relDir: relPosix(root, dir),
      manifest,
      patches,
      files,
      retiredIn,
      retired,
    });
  }
  return mods.sort((a, b) => a.id.localeCompare(b.id));
}

export async function readState(root) {
  try { return JSON.parse(await readFile(resolve(root, STATE_FILE), 'utf8')); } catch { return { version: 1, mods: {} }; }
}

export async function writeState(root, state) {
  await writeFile(resolve(root, STATE_FILE), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

const git = async (root, args) => {
  const { stdout } = await execFileP('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

/**
 * Apply one mod.
 * @param {string} root repository root
 * @param {object} mod a loaded mod
 * @param {{dryRun?: boolean, force?: boolean}} [opts]
 */
export async function applyMod(root, mod, opts = {}) {
  const dryRun = !!opts.dryRun;
  const touched = [];
  const report = [];

  for (const f of mod.files) {
    const target = resolve(root, f.to);
    let current = null;
    try { current = await readFile(target, 'utf8'); } catch { /* not there yet */ }
    if (current !== null) {
      // Already there: identical means this mod put it there, anything else is the user's file — never clobber it.
      const same = sha256(current) === sha256(await readFile(f.from, 'utf8'));
      report.push({
        kind: 'file',
        to: f.to,
        status: same ? 'already' : 'drift',
        reason: same ? undefined : 'target-differs',
      });
      continue;
    }
    report.push({ kind: 'file', to: f.to, status: 'ok' });
    touched.push({ action: 'created', path: f.to });
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(f.from, target);
    }
  }

  for (const group of mod.patches) {
    const target = resolve(root, group.file);
    let text;
    try { text = await readFile(target, 'utf8'); } catch {
      report.push({ kind: 'patch', file: group.file, id: '*', status: 'drift', reason: 'file-missing' });
      continue;
    }
    let lines = splitLines(text);
    const eol = eolOf(text);
    // A json-merge rewrites the whole text; line patches rewrite the line array. `outText` wins when set.
    let outText = null;
    let dirty = false;
    for (const patch of group.entries) {
      if (patch.op === 'json-merge') {
        const res = planJson(text, patch);
        report.push({ kind: 'patch', file: group.file, id: patch.id || '(json)', status: res.status, reason: res.reason });
        if (res.status === 'ok') { text = res.text; outText = res.text; dirty = true; }
        continue;
      }
      const res = planOne(lines, patch);
      report.push({
        kind: 'patch',
        file: group.file,
        id: patch.id || '(unnamed)',
        status: res.status,
        reason: res.reason,
        hits: res.hits,
        expected: res.expected,
        found: res.found,
      });
      if (res.status === 'ok') { lines = res.lines; dirty = true; }
    }
    if (dirty && !dryRun) await writeFile(target, outText !== null ? outText : lines.join(eol), 'utf8');
    if (dirty) touched.push({ action: 'modified', path: group.file });
  }

  if (!dryRun && touched.length) {
    const state = await readState(root);
    const hashes = {};
    for (const t of touched) {
      if (t.action !== 'modified') continue;
      try { hashes[t.path] = sha256(await readFile(resolve(root, t.path), 'utf8')); } catch { /* left unhashed */ }
    }
    state.mods[mod.id] = { appliedAt: new Date().toISOString(), created: touched.filter((t) => t.action === 'created').map((t) => t.path), modified: touched.filter((t) => t.action === 'modified').map((t) => t.path), hashes };
    await writeState(root, state);
  }
  return { id: mod.id, report, touched };
}

/**
 * Revert one mod: delete what it created and restore what it modified.
 * Refuses when a modified file changed since it was applied, unless `force`.
 */
export async function revertMod(root, mod, opts = {}) {
  const state = await readState(root);
  const entry = state.mods[mod.id];
  if (!entry) return { id: mod.id, status: 'not-applied' };
  const problems = [];
  for (const [path, hash] of Object.entries(entry.hashes || {})) {
    let now = null;
    try { now = sha256(await readFile(resolve(root, path), 'utf8')); } catch { /* gone */ }
    if (now !== hash) problems.push({ path, reason: now === null ? 'missing' : 'edited-since-apply' });
  }
  if (problems.length && !opts.force) return { id: mod.id, status: 'blocked', problems };

  for (const p of entry.created || []) {
    try { await rm(resolve(root, p)); } catch { /* already gone */ }
  }
  const modified = (entry.modified || []).filter((p) => !problems.some((x) => x.path === p && x.reason === 'missing'));
  if (modified.length) {
    try { await git(root, ['checkout', '--', ...modified]); } catch (e) {
      return { id: mod.id, status: 'failed', error: String(e && e.message) };
    }
  }
  delete state.mods[mod.id];
  await writeState(root, state);
  return { id: mod.id, status: 'reverted', removed: (entry.created || []).length, restored: modified.length };
}

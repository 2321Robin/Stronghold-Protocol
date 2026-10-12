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
export function findApplied(lines, patch) {
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
    // Not only the line right below the anchor: another mod may have inserted at the same anchor,
    // which pushes our block further down. If our block is anywhere in the file, we are applied.
    if (blockAt(lines, at + 1, body) || findApplied(lines, patch) >= 0) return { status: 'already', hits };
    return { status: 'ok', hits, lines: [...lines.slice(0, at + 1), ...body, ...lines.slice(at + 1)] };
  }
  if (op === 'insert-before') {
    if (blockAt(lines, at - body.length, body) || findApplied(lines, patch) >= 0) return { status: 'already', hits };
    return { status: 'ok', hits, lines: [...lines.slice(0, at), ...body, ...lines.slice(at)] };
  }
  if (op === 'replace') {
    const old = patch.old || [];
    // Our own output already sits here. No length check: a replacement that *grew* the block
    // (the new block starts with the old line and adds to it) still starts at the anchor, and
    // missing it would make every replay insert the block a second time.
    if (blockAt(lines, at, body)) return { status: 'already', hits };
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

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, overlay) {
  if (!isPlain(base) || !isPlain(overlay)) return overlay;
  const out = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/**
 * Parse JSON while recording each value's span in the source text and whether it was written inline.
 *
 * Upstream data files mix styles on purpose — `test/golden/*.json` writes `"errors": {"count":0,"kinds":[]}`
 * on one line next to multi-line scenario objects. Re-serialising the whole document would rewrite all of
 * it (6081 lines became 57138), so a merge has to touch only the keys it actually changes. That is what
 * these spans buy: everything else is copied byte for byte.
 */
function parseJsonSpans(text) {
  let i = 0;
  const n = text.length;
  const skipWs = () => { while (i < n && ' \t\r\n'.includes(text[i])) i++; };
  const fail = (m) => { throw new Error(`${m} at offset ${i}`); };

  const parseString = () => {
    if (text[i] !== '"') fail('expected a string');
    const start = i;
    i++;
    while (i < n) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '"') { i++; return JSON.parse(text.slice(start, i)); }
      i++;
    }
    return fail('unterminated string');
  };

  const objectNode = (entries, start, end) => ({
    kind: 'object',
    value: Object.fromEntries(entries.map((e) => [e.key, e.node.value])),
    start, end, entries,
    inline: !text.slice(start, end).includes('\n'),
  });
  const arrayNode = (items, start, end) => ({
    kind: 'array', value: items.map((it) => it.value), start, end, items,
    inline: !text.slice(start, end).includes('\n'),
  });
  const leaf = (value, start, end) => ({ kind: 'leaf', value, start, end, inline: true });

  const parseValue = () => {
    skipWs();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries = [];
      skipWs();
      if (text[i] === '}') { i++; return objectNode(entries, start, i); }
      for (;;) {
        skipWs();
        const keyStart = i;
        const key = parseString();
        skipWs();
        if (text[i] !== ':') fail('expected ":"');
        i++;
        entries.push({ key, keyStart, node: parseValue() });
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; break; }
        fail('expected "," or "}"');
      }
      return objectNode(entries, start, i);
    }
    if (c === '[') {
      i++;
      const items = [];
      skipWs();
      if (text[i] === ']') { i++; return arrayNode(items, start, i); }
      for (;;) {
        items.push(parseValue());
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; break; }
        fail('expected "," or "]"');
      }
      return arrayNode(items, start, i);
    }
    if (c === '"') return leaf(parseString(), start, i);
    const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!m) fail('unexpected value');
    i += m[0].length;
    return leaf(JSON.parse(m[0]), start, i);
  };

  const root = parseValue();
  skipWs();
  if (i !== n) fail('trailing content');
  return root;
}

/** The indent of the line `pos` sits on. */
const lineIndentAt = (text, pos) => {
  const ls = text.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
  return (/^[ \t]*/.exec(text.slice(ls, pos)) || [''])[0];
};

/**
 * Does this value's file keep short scalar-only values on one line?
 * `test/golden/*.json` does (`"players": {…}` and each `units` row inline); the i18n packs do not.
 * Read off the value being replaced, so a merged key is written the way its neighbours are.
 * Array nodes carry `items`, object nodes `entries` — both have to be looked at.
 */
const inlineNestedStyle = (node) => {
  const kids = node.entries || node.items || [];
  return kids.some((k) => { const n = k.node || k; return n.kind !== 'leaf' && n.inline; });
};

/**
 * The writer `tools/golden.mjs` uses, so a merged key is indistinguishable from a regenerated one:
 * scalars stay inline, and at depth ≥ 6 a value short enough (or scalar-only and under 400 chars)
 * stays on one line too. Everything else breaks, arrays of scalars always staying compact.
 */
const stringifyStyled = (value, indent, inlineNested) => {
  const one = JSON.stringify(value);
  if (value === null || typeof value !== 'object') return one;
  if (!inlineNested) return JSON.stringify(value, null, 2).split('\n').join(`\n${indent}`);
  const scalars = Object.values(value).every((x) => x === null || typeof x !== 'object');
  if (indent.length >= 6 && (one.length <= 160 || (scalars && one.length <= 400))) return one;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (scalars) return one;
    return `[\n${value.map((x) => inner + stringifyStyled(x, inner, true)).join(',\n')}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${stringifyStyled(value[k], inner, true)}`).join(',\n')}\n${indent}}`;
};

/** Write `value` the way `refNode` was written: inline stays one line, multi-line keeps its indent. */
const serializeLike = (value, refNode, indent) => {
  if (!refNode || refNode.inline || value === null || typeof value !== 'object') return JSON.stringify(value);
  return stringifyStyled(value, indent, inlineNestedStyle(refNode));
};

/** Render one entry's value with the merge applied, keeping the style it was written in. */
const renderMerged = (text, entry, mv) => {
  if (isPlain(mv) && entry.node.kind === 'object' && !entry.node.inline) return mergeObjectNode(text, entry.node, mv);
  if (isPlain(mv) && entry.node.kind === 'object') return JSON.stringify(deepMerge(entry.node.value, mv));
  return serializeLike(mv, entry.node, lineIndentAt(text, entry.keyStart));
};

/** Merge `mergeObj` into one object node, rewriting only the spans that change. */
function mergeObjectNode(text, node, mergeObj) {
  const known = new Set(node.entries.map((e) => e.key));
  const added = Object.keys(mergeObj).filter((k) => !known.has(k));

  if (!added.length) {
    // Nothing new: swap the changed spans in place and copy everything else verbatim.
    let out = '';
    let cursor = node.start;
    for (const e of node.entries) {
      if (!(e.key in mergeObj)) continue;
      out += text.slice(cursor, e.node.start) + renderMerged(text, e, mergeObj[e.key]);
      cursor = e.node.end;
    }
    return out + text.slice(cursor, node.end);
  }

  // Keys to add: rebuild the object — existing entries merged where the merge names them (never
  // copied verbatim, or a value that also grew a field would silently keep the old one), new ones
  // appended the way their siblings are written.
  if (node.inline) return JSON.stringify(deepMerge(node.value, mergeObj));
  const indent = node.entries.length
    ? lineIndentAt(text, node.entries[0].keyStart)
    : `${lineIndentAt(text, node.start)}  `;
  const closeIndent = lineIndentAt(text, node.end - 1);
  // The first sibling *is* the style reference: its own inline flag and whether it nests values
  // inline decide how the new entry is written.
  const sibling = node.entries.length ? node.entries[0].node : null;
  const parts = node.entries.map((e) => `${JSON.stringify(e.key)}: ${
    e.key in mergeObj ? renderMerged(text, e, mergeObj[e.key]) : text.slice(e.node.start, e.node.end)}`);
  for (const k of added) parts.push(`${JSON.stringify(k)}: ${serializeLike(mergeObj[k], sibling, indent)}`);
  return `{\n${parts.map((p) => `${indent}${p}`).join(',\n')}\n${closeIndent}}`;
}

/**
 * A JSON patch merges key by key, so upstream edits to other keys never collide — and the merge is
 * surgical: only the spans of the keys it names are rewritten, the rest of the file is copied through,
 * which keeps a mixed-style file (compact inline values next to multi-line objects) intact.
 */
export function planJson(text, patch) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { status: 'drift', reason: 'invalid-json' }; }
  const merge = patch.merge || {};
  const merged = deepMerge(parsed, merge);
  if (JSON.stringify(parsed) === JSON.stringify(merged)) return { status: 'already' };

  let root;
  try { root = parseJsonSpans(text); } catch { return { status: 'drift', reason: 'unparseable-json' }; }
  let outText;
  try {
    outText = isPlain(merge) && root.kind === 'object'
      ? mergeObjectNode(text, root, merge)
      : serializeLike(merged, root, lineIndentAt(text, root.start));
  } catch { return { status: 'drift', reason: 'merge-failed' }; }

  const endsWithNewline = /\n$/.test(text);
  return { status: 'ok', text: endsWithNewline ? `${outText}\n` : outText };
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
    const dep = manifest.dependsOn;
    const dependsOn = Array.isArray(dep) ? dep.slice() : (typeof dep === 'string' ? [dep] : []);
    mods.push({
      id: manifest.id || e.name,
      name: manifest.name || manifest.id || e.name,
      dir,
      relDir: relPosix(root, dir),
      manifest,
      patches,
      files,
      dependsOn,
      retiredIn,
      retired,
    });
  }
  return mods.sort((a, b) => a.id.localeCompare(b.id));
}

/** Deps named by a mod that no longer exist (deleted, renamed, already upstreamed). */
export function missingDeps(mods) {
  const known = new Set(mods.map((m) => m.id));
  const out = [];
  for (const m of mods) {
    for (const d of m.dependsOn || []) if (!known.has(d)) out.push({ id: m.id, missing: d });
  }
  return out;
}

/**
 * Order mods so a mod always follows the ones it depends on.
 * A mod that builds on another's work (say, a dev-mode hook that drives an operator-opt-in flag)
 * has to see that work in the file before its own anchors are searched for.
 * Cycles are broken by name so the run still finishes and reports, rather than hanging.
 */
export function topoSort(mods) {
  const byId = new Map(mods.map((m) => [m.id, m]));
  const out = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (m, trail) => {
    if (done.has(m.id)) return;
    if (visiting.has(m.id)) {
      // Cycle: drop back to declaration order and move on; `missingDeps` does not see this one.
      return;
    }
    visiting.add(m.id);
    for (const d of m.dependsOn || []) {
      const dep = byId.get(d);
      if (dep && !trail.includes(d)) visit(dep, [...trail, d]);
    }
    visiting.delete(m.id);
    done.add(m.id);
    out.push(m);
  };
  for (const m of mods) visit(m, [m.id]);
  return out;
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
    // Merge with what an earlier apply already recorded: a later `--force` replay that only rewrites
    // one file must not forget the fifteen the first apply touched, or revert restores just that one.
    const prev = state.mods[mod.id] || { created: [], modified: [], hashes: {} };
    const created = [...new Set([...(prev.created || []), ...touched.filter((t) => t.action === 'created').map((t) => t.path)])];
    const modified = [...new Set([...(prev.modified || []), ...touched.filter((t) => t.action === 'modified').map((t) => t.path)])];
    const hashes = { ...(prev.hashes || {}) };
    for (const path of modified) {
      try { hashes[path] = sha256(await readFile(resolve(root, path), 'utf8')); } catch { /* left unhashed */ }
    }
    state.mods[mod.id] = { appliedAt: new Date().toISOString(), created, modified, hashes };
    await writeState(root, state);
  }
  return { id: mod.id, report, touched };
}

/**
 * Is this one patch's own output present in `lines` right now?
 * Used instead of a file hash: on a file two mods both own, the other mod's edits change the hash
 * every time, so a hash can never tell "still applied" from "someone else touched it".
 */
function patchInPlace(lines, patch) {
  const res = planOne(lines, patch);
  if (res.status === 'already') return true;
  // The anchor may now occur twice because our own inserted block repeats it: trust the block match.
  if (res.status === 'drift' && res.reason === 'anchor-ambiguous') return findApplied(lines, patch) >= 0;
  return false;
}

/**
 * Revert one mod: delete what it created and restore what it modified.
 *
 * Files are restored with `git checkout`, which is whole-file — so any *other* applied mod that also
 * patches the same file would lose its work. After restoring, those mods' patches are replayed on
 * the clean file, which is what keeps mods independent of each other. Pass the full mod list as
 * `allMods`; pass only the mods being reverted and the replay has nothing to work with.
 *
 * @param {string} root repository root
 * @param {object} mod the mod to revert
 * @param {object[]} [allMods] every loaded mod, so shared files can be rebuilt for the others
 * @param {{force?: boolean}} [opts]
 */
export async function revertMod(root, mod, allMods = [], opts = {}) {
  const state = await readState(root);
  const entry = state.mods[mod.id];
  if (!entry) return { id: mod.id, status: 'not-applied' };

  const problems = [];
  for (const group of mod.patches) {
    if (group.entries.every((p) => p.op === 'json-merge')) continue;
    let text;
    try { text = await readFile(resolve(root, group.file), 'utf8'); } catch {
      problems.push({ path: group.file, reason: 'file-missing' });
      continue;
    }
    const lines = splitLines(text);
    for (const patch of group.entries) {
      if (patch.op === 'json-merge') continue;
      if (!patchInPlace(lines, patch)) {
        problems.push({ path: group.file, patch: patch.id || '(unnamed)', reason: 'not-in-place' });
      }
    }
  }
  if (problems.length && !opts.force) return { id: mod.id, status: 'blocked', problems };

  for (const p of entry.created || []) {
    try { await rm(resolve(root, p)); } catch { /* already gone */ }
  }
  const modified = entry.modified || [];
  if (modified.length) {
    try { await git(root, ['checkout', '--', ...modified]); } catch (e) {
      return { id: mod.id, status: 'failed', error: String(e && e.message) };
    }
  }
  delete state.mods[mod.id];

  // Rebuild: every file we just handed back to upstream may carry another mod's work.
  const rebuilt = [];
  const lost = [];
  const others = (allMods || []).filter((m) => m.id !== mod.id && state.mods[m.id]);
  for (const path of modified) {
    const owners = others.filter((m) => m.patches.some((g) => g.file === path));
    if (!owners.length) continue;
    let text;
    try { text = await readFile(resolve(root, path), 'utf8'); } catch { continue; }
    const eol = eolOf(text);
    let outText = null;
    for (const m of owners) {
      for (const group of m.patches) {
        if (group.file !== path) continue;
        // JSON merges rewrite the whole text; do them first, then the line patches on the result.
        for (const patch of group.entries) {
          if (patch.op !== 'json-merge') continue;
          const res = planJson(text, patch);
          if (res.status === 'ok') { text = res.text; outText = res.text; }
          else if (res.status === 'drift') lost.push({ mod: m.id, file: path, id: patch.id || '(json)', reason: res.reason });
        }
      }
    }
    let lines = splitLines(text);
    let dirty = outText !== null;
    for (const m of owners) {
      for (const group of m.patches) {
        if (group.file !== path) continue;
        for (const patch of group.entries) {
          if (patch.op === 'json-merge') continue;
          const res = planOne(lines, patch);
          if (res.status === 'ok') { lines = res.lines; dirty = true; }
          else if (res.status === 'drift') lost.push({ mod: m.id, file: path, id: patch.id || '(unnamed)', reason: res.reason });
        }
      }
    }
    if (dirty) {
      const out = outText !== null ? outText : lines.join(eol);
      await writeFile(resolve(root, path), out, 'utf8');
      rebuilt.push(path);
      const fresh = sha256(out);
      for (const m of owners) {
        const e = state.mods[m.id];
        if (e && e.hashes && path in e.hashes) e.hashes[path] = fresh;
      }
    }
  }

  await writeState(root, state);
  return {
    id: mod.id,
    status: 'reverted',
    removed: (entry.created || []).length,
    restored: modified.length,
    rebuilt,
    lost,
  };
}

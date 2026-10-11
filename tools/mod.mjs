#!/usr/bin/env node
/**
 * tools/mod.mjs — the local mod layer's command line.
 *
 *   node tools/mod.mjs status            what is applied, what is not
 *   node tools/mod.mjs check             dry run: does every patch still find its anchor?
 *   node tools/mod.mjs apply [id...]     replay mods onto the current tree
 *   node tools/mod.mjs revert [id...]    undo them, leaving a clean upstream tree
 *   node tools/mod.mjs doctor            is the tree safe to pull / apply?
 *
 * The release ritual this replaces: `mod revert --all` → `git pull` (clean, no rebase) →
 * `mod apply --all` → read the drift report and fix only what actually moved.
 */

import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

import {
  MODS_DIR, STATE_FILE, loadMods, applyMod, revertMod, readState, sha256, upstreamVersion,
} from '../mods/_framework/engine.mjs';
import { formatReport, formatSummary } from '../mods/_framework/report.mjs';
import { capture } from '../mods/_framework/capture.mjs';

const execFileP = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');

const args = process.argv.slice(2);
const command = args[0] || 'status';
const flags = args.filter((a) => a.startsWith('--'));
const ids = args.slice(1).filter((a) => !a.startsWith('--'));
const all = flags.includes('--all');
const verbose = flags.includes('--verbose') || flags.includes('-v');
const force = flags.includes('--force');

const gitStatus = async () => {
  const { stdout } = await execFileP('git', ['status', '--porcelain'], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean);
};

const linesOf = async (file) => {
  try { return String(await readFile(resolve(ROOT, file), 'utf8')).split(/\r?\n/); } catch { return null; }
};

function pick(mods) {
  if (all || ids.length === 0) return mods;
  const wanted = new Set(ids);
  return mods.filter((m) => wanted.has(m.id));
}

async function cmdStatus(mods) {
  const state = await readState(ROOT);
  const version = await upstreamVersion(ROOT);
  if (!mods.length) {
    console.log(`no mods under ${MODS_DIR}/`);
    return;
  }
  console.log(`upstream version:     ${version ?? 'unknown'}`);
  console.log('');
  console.log('mod                 applied  patches  files');
  for (const m of mods) {
    const entry = state.mods[m.id];
    const patches = m.patches.reduce((n, g) => n + g.entries.length, 0);
    const flag = m.retired ? `  [retired in ${m.retiredIn} — upstream ships it, delete this mod]` : '';
    console.log(
      `${m.id.padEnd(20)}${(entry ? 'yes' : 'no').padEnd(9)}${String(patches).padStart(7)}${String(m.files.length).padStart(7)}  ${m.name}${flag}`,
    );
  }
  const dirty = await gitStatus();
  console.log('');
  console.log(dirty.length ? `tree has ${dirty.length} uncommitted change(s)` : 'tree is clean');
}

async function cmdCheck(mods) {
  const results = [];
  for (const m of mods) {
    if (m.retired) {
      console.log(`- ${m.id} skipped: upstream ${m.retiredIn} ships it natively`);
      continue;
    }
    results.push(await applyMod(ROOT, m, { dryRun: true }));
  }
  if (verbose) {
    for (const [i, r] of results.entries()) {
      console.log(formatReport(mods[i], r, { verbose: true, linesOf }));
      console.log('');
    }
  }
  console.log(formatSummary(results));
  for (const r of results) if (r.report.some((x) => x.status === 'drift')) process.exitCode = 1;
}

async function cmdApply(mods) {
  const state = await readState(ROOT);
  const results = [];
  for (const m of mods) {
    if (m.retired) {
      console.log(`- ${m.id} skipped: upstream ${m.retiredIn} ships it natively (delete mods/${m.id})`);
      continue;
    }
    if (state.mods[m.id] && !force) {
      console.log(`= ${m.id} already applied (use --force to replay)`);
      continue;
    }
    const r = await applyMod(ROOT, m, {});
    console.log(formatReport(m, r, { verbose, linesOf }));
    results.push(r);
  }
  if (results.length > 1) console.log('');
  const drift = results.reduce((n, r) => n + r.report.filter((x) => x.status === 'drift').length, 0);
  if (drift) {
    console.log(`${drift} patch(es) drifted — the rest replayed cleanly`);
    process.exitCode = 1;
  }
}

async function cmdRevert(mods) {
  for (const m of mods) {
    const r = await revertMod(ROOT, m, { force });
    if (r.status === 'not-applied') console.log(`- ${m.id} not applied`);
    else if (r.status === 'blocked') {
      console.log(`! ${m.id} blocked — a file changed since it was applied (use --force):`);
      for (const p of r.problems) console.log(`    ${p.path} — ${p.reason}`);
      process.exitCode = 1;
    } else if (r.status === 'failed') {
      console.log(`! ${m.id} failed: ${r.error}`);
      process.exitCode = 1;
    } else console.log(`- ${m.id} reverted (${r.removed} removed, ${r.restored} restored)`);
  }
}

async function cmdDoctor() {
  const mods = await loadMods(ROOT);
  const state = await readState(ROOT);
  const dirty = await gitStatus();
  const stateDirty = dirty.some((d) => d.trim().endsWith(STATE_FILE));
  console.log(`mods discovered:      ${mods.length}`);
  console.log(`mods applied:         ${Object.keys(state.mods).length}`);
  console.log(`tree:                 ${dirty.length ? `${dirty.length} uncommitted change(s)` : 'clean'}`);
  const drifted = [];
  for (const m of mods) {
    for (const [path, hash] of Object.entries(state.mods[m.id]?.hashes || {})) {
      try {
        if (sha256(await readFile(resolve(ROOT, path), 'utf8')) !== hash) drifted.push(`${m.id}:${path}`);
      } catch { drifted.push(`${m.id}:${path} (gone)`); }
    }
  }
  console.log(`edited since apply:   ${drifted.length ? drifted.join(', ') : 'none'}`);
  console.log('');
  if (dirty.length && !stateDirty) {
    console.log('not safe to pull: revert every mod first (node tools/mod.mjs revert --all)');
  } else {
    console.log('safe to pull' + (stateDirty ? ` (only ${STATE_FILE} is dirty — it is meant to be)` : ''));
  }
}

const mods = await loadMods(ROOT);
const selected = pick(mods);

switch (command) {
  case 'status': await cmdStatus(mods); break;
  case 'check': await cmdCheck(selected.length || all ? selected : mods); break;
  case 'apply': await cmdApply(selected); break;
  case 'revert': await cmdRevert(selected.length || all ? selected : mods); break;
  case 'doctor': await cmdDoctor(); break;
  case 'capture': {
    const id = ids[0];
    if (!id) {
      console.error('usage: node tools/mod.mjs capture <id> [--from <sha>] [paths...]');
      process.exitCode = 2;
      break;
    }
    const fromFlag = flags.find((f) => f.startsWith('--from='));
    const r = await capture(ROOT, {
      id,
      from: fromFlag ? fromFlag.slice(7) : 'HEAD',
      paths: ids.slice(1),
    });
    console.log(`captured ${r.id}: ${r.patches} patch(es), ${r.files} new file(s)`);
    for (const d of r.drift || []) console.log(`  ! ${d}`);
    console.log('review the generated patches, then run: node tools/mod.mjs check');
    break;
  }
  default:
    console.error(`unknown command ${command}`);
    console.error('usage: node tools/mod.mjs <status|check|apply|revert|capture|doctor> [id...] [--all] [--verbose] [--force]');
    process.exitCode = 2;
}

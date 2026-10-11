/**
 * mods/_framework/report.mjs — turns an apply report into text a human acts on.
 *
 * The point of the whole framework is that a failed replay tells you *which* anchor of *which* mod
 * moved and shows what is there now. It never hands you a conflict block to decode.
 */

const icon = {
  ok: '+',
  already: '=',
  drift: '!',
  skipped: '-',
};

const CONTEXT = 2;

function excerpt(lines, at) {
  const from = Math.max(0, at - CONTEXT);
  const to = Math.min(lines.length, at + CONTEXT + 1);
  return lines.slice(from, to).map((l, i) => `${String(from + i + 1).padStart(5)} | ${l}`);
}

export function formatReport(mod, result, { linesOf = null, verbose = false } = {}) {
  const out = [];
  const { report } = result;
  const ok = report.filter((r) => r.status === 'ok').length;
  const already = report.filter((r) => r.status === 'already').length;
  const drift = report.filter((r) => r.status === 'drift');
  out.push(`mod ${mod.id} — ${ok} applied, ${already} already in place, ${drift.length} drifted`);
  if (!verbose) {
    for (const r of drift) {
      out.push(`  ! ${r.file} :: ${r.id} — ${r.reason}`);
    }
    return out.join('\n');
  }
  for (const r of report) {
    const mark = icon[r.status] || '?';
    const where = r.kind === 'file' ? r.to : `${r.file} :: ${r.id}`;
    out.push(`  ${mark} ${where}${r.reason ? ` — ${r.reason}` : ''}`);
    if (r.status !== 'drift') continue;
    if (Array.isArray(r.hits) && r.hits.length > 1) {
      out.push(`      anchor found ${r.hits.length} times at lines ${r.hits.map((h) => h + 1).join(', ')}`);
    }
    if (Array.isArray(r.expected)) {
      out.push('      expected:');
      for (const l of r.expected) out.push(`        ${l}`);
      out.push('      found:');
      for (const l of r.found || []) out.push(`        ${l}`);
    }
    if (linesOf && Array.isArray(r.hits) && r.hits.length > 0) {
      const lines = linesOf(`${r.file}`);
      if (lines) {
        out.push('      around the anchor:');
        for (const l of excerpt(lines, r.hits[0])) out.push(`      ${l}`);
      }
    }
  }
  return out.join('\n');
}

export function formatSummary(results) {
  const out = [];
  let drift = 0;
  for (const r of results) {
    const d = r.report.filter((x) => x.status === 'drift').length;
    drift += d;
    const okc = r.report.filter((x) => x.status === 'ok').length;
    out.push(`${d ? '!' : ' '} ${r.id.padEnd(16)} ${String(okc).padStart(3)} applied  ${String(d).padStart(3)} drifted`);
  }
  out.push('');
  out.push(drift ? `${drift} patch(es) drifted — run with --verbose for the anchors` : 'every patch found its anchor');
  return out.join('\n');
}

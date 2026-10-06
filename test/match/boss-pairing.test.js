// publicView().bossPairing (user playtest #5, review): during the boss round's ROUND_START / SP_DRAFT / PREP the
// planned seat pairs (finalAssault.js pairPlayers, planned by Match._planBossWaves) are published as plain player-id
// arrays — no enemies, no wave data (that stays in m.private / the scout). Every other phase, and the battle itself
// (fields[].players carries the pairing there), have no such field.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

test('publicView: the boss round prep publishes bossPairing — player-id pairs only, gone once the battle starts', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 61, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  assert.equal(m.publicView().bossPairing, undefined, 'a normal round: bossWaves is null → no bossPairing at all');
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  assert.equal(m.round, 14, 'the drive reached the boss round');
  const v = m.publicView();
  const alive = m.alivePlayers().map((p) => p.playerId).sort();
  assert.ok(Array.isArray(v.bossPairing) && v.bossPairing.length >= 2, 'the boss round prep carries the planned pairs');
  for (const g of v.bossPairing) {
    assert.ok(Array.isArray(g) && g.length >= 1, 'each pair is an array');
    for (const pid of g) assert.equal(typeof pid, 'string', `ids only, no enemy / wave objects (${JSON.stringify(pid)})`);
    for (const pid of g) assert.ok(alive.includes(pid), `a seated player still in (${pid})`);
  }
  assert.deepEqual(v.bossPairing.flat().sort(), alive, 'a partition of the alive players — nobody twice, nobody missing, no eliminated id');
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.equal(m.publicView().bossPairing, undefined, 'the battle fields exist → fields[].players carries the pairing instead');
  m.dispose();
});

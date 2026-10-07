// LOCAL RULING (2026-10-07, user request): the 联防 field stays on the round's own stage — its water, crates and
// devices included, opened to both halves (the 0.1.x semantics; upstream 0.2.0 plays the dedicated escaped level
// act1autochess_escaped_single / _multi per GitHub #41, kept as「有意修改」in #244, disputed in the still-open #282).
// The match skips unite.js uniteStageId while match/unitePhase.js UNITE_ON_ROUND_STAGE holds; flip that flag to
// follow upstream again. What does NOT change: the enemy routes / spawn actions are the escaped template's (identical
// bytes in 0.1.4 and 0.2.0 waves.json), the helpers' prep-tile deployment with the first of two shifted 8 columns
// ("率先迎敌(即位于右侧阵地)"), and the carried HP / SP rules. The terrain only limits deploying — enemy walkers
// follow their route coordinates across whatever the round's map has there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { uniteStageId } from '../../server/match/unite.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor, checkInvariants } from './harness.js';

/** A real battle that only ends by its time limit (the check follows the enemies, whatever the helpers do). */
class NoFinish extends Battle {
  constructor(o) { super({ ...o, autoFinish: false }); }
}

/**
 * Co-op on 战场#01 (its row 9 is fenced off at cols 5–7: "##Err###rrSrr###rrS##"): p_0 leaks 3 enemies, the other
 * players are perfect — 1 helper with 2 humans, 2 helpers with 3. Each helper fields one ranged operator in its corner.
 */
function scenario({ humans, clientCombat }) {
  const h = makeMatch({
    mode: 'coop', humans, seed: 4101 + humans, fake: true, clientCombat,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 3 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage('act1autochess_m01');
  const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
  const helpers = [];
  for (let i = 1; i < humans; i++) {
    const ps = h.ps(`p_${i}`);
    const id = ranged[i];
    helpers.push({ ps, piece: give(m, ps, id, 'board', legalTileFor(m, ps, id)) });
  }
  h.drive(() => m.phase === PHASE.UNITE);
  return { h, m, helpers };
}

/** The 联防 field's spec / options as the match built them, and a real battle over them. */
function uniteField(m, clientCombat) {
  if (clientCombat) {
    const f = m.fields[0];
    return { opts: f.spec, battle: createBattleFromSpec(f.spec, new DataSource(DATA, null), { BattleClass: NoFinish, recordEvents: false }) };
  }
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  return { opts: u.opts, battle: new NoFinish({ ...u.opts, data: m.ds, logger: { warn() {}, error() {}, info() {}, debug() {} } }) };
}

for (const clientCombat of [true, false]) {
  test(`联防 with 1 helper (${clientCombat ? 'client-side combat' : 'server-run'}): the round's stage, not escaped_single — the escaped routes still enter at col 10 and cross the round map's fence`, () => {
    const { m, helpers } = scenario({ humans: 2, clientCombat });
    assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_1']);
    const { opts, battle: b } = uniteField(m, clientCombat);
    assert.equal(opts.stageId, m.stageId, 'the round\'s stage (local ruling)');
    assert.equal(opts.stageId, 'act1autochess_m01');
    assert.equal(b.stage.id, 'act1autochess_m01');
    assert.deepEqual(b.stage.rows, m.stage.rows, 'the played map is the round\'s, crates and fences included');
    assert.deepEqual(opts.rect, GEO.UNITE_RECT, 'the whole 19×21 map\'s field rows (both halves are open to the helpers)');
    // the data and the upstream picker stay intact for the flag's off path
    assert.equal(uniteStageId(m.gd, 1), 'act1autochess_escaped_single');
    // the routes are still escaped_single's: every one starts at col 10
    assert.ok(opts.routes.every((r) => (r.start ?? [r.startPosition?.row, r.startPosition?.col])[1] === 10));
    // the helper's piece stands on its prep tile
    const { ps, piece } = helpers[0];
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    b.step();
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === 'p_1');
    assert.deepEqual([u.tileR, u.tileC], [r, c]);
    // a walker follows its route but the round map's terrain flows it around the fence at row 9 cols 5–7
    // (the terrain limits deploying and bends the walk; it does not strand the enemies)
    assert.ok(['9,5', '9,6', '9,7'].every((k) => !b.grid.groundPassable(...k.split(',').map(Number))), '战场#01 has no ground at row 9 cols 5–7');
    const crossed = new Set();
    while (b.time < 60 && !b.finished) {
      b.step();
      for (const e of b.enemies) if (e.alive && e.motion !== 'FLY') crossed.add(`${Math.round(e.y)},${Math.round(e.x)}`);
    }
    assert.ok(!['9,5', '9,6', '9,7'].some((k) => crossed.has(k)), `no walker ghosts through the fence (${[...crossed].sort().join(' ')})`);
    assert.ok([10, 11, 12].some((rr) => [4, 5, 6, 7, 8].some((cc) => crossed.has(`${rr},${cc}`))), 'walkers detour around the fence through rows 10–12');
    assert.ok(crossed.has('9,2'), 'walkers still reach the objective end at (9,2)');
    assert.equal(b.errorCount || 0, 0);
    checkInvariants(m);
    m.dispose();
  });
}

test('联防 with 2 helpers: the round\'s stage, the first helper on the right half (col + 8), the escaped_multi routes enter at col 18 through (9,10); the client is told the round\'s map', () => {
  const { h, m, helpers } = scenario({ humans: 3, clientCombat: false });
  const order = m.unitePlan.helpers.map((p) => p.playerId);
  assert.equal(order.length, 2);
  const { opts, battle: b } = uniteField(m, false);
  assert.equal(opts.stageId, m.stageId, 'the round\'s stage (local ruling)');
  assert.equal(b.stage.id, 'act1autochess_m01');
  assert.deepEqual(opts.players.map((p) => [p.playerId, p.colOffset]), [[order[0], 8], [order[1], 0]]);
  assert.ok(opts.routes.every((r) => r.start[1] === 18), 'every route enters at col 18');
  assert.ok(opts.routes.filter((r) => r.motion === 'WALK').every((r) => r.checkpoints.some(([rr, cc]) => rr === 9 && cc === 10)), 'walkers pass (9,10)');
  b.step();
  for (const { ps, piece } of helpers) {
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === ps.playerId);
    const off = ps.playerId === order[0] ? 8 : 0;
    assert.deepEqual([u.tileR, u.tileC], [r, c + off], `${ps.playerId}: its prep tile${off ? ' on the right half' : ''}`);
  }
  // what a watching browser receives: the m.field of the 联防 carries the round's map
  m.handle('p_0', { t: 'g.watch', fieldId: 'u' });
  const meta = h.lastTo('p_0', 'm.field');
  assert.equal(meta && meta.stageId, m.stageId, 'every viewer draws the round\'s stage (local ruling)');
  assert.equal(m.stageId, 'act1autochess_m01', 'the match stage (m.public stageId, the boards) stays the round\'s');
  checkInvariants(m);
  m.dispose();
});

test('degraded data without the 联防 maps: the field keeps the round\'s stage (and so does the local ruling with full data)', () => {
  const stages = Object.fromEntries(Object.entries(DATA.stages).filter(([, s]) => s.kind !== 'unite'));
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 4199, fake: true, data: { ...DATA, stages }, script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}) }).start();
  const m = h.m;
  h.toPrep(1);
  assert.equal(uniteStageId(m.gd, 1), null);
  const ps = h.ps('p_1');
  const id = chessOfTier(1, (c) => c.position === 'RANGED').find((x) => m.pool.has(x));
  give(m, ps, id, 'board', legalTileFor(m, ps, id));
  h.drive(() => m.phase === PHASE.UNITE);
  assert.equal(FakeBattle.instances.find((b) => b.kind === 'unite').opts.stageId, m.stageId);
  m.dispose();
});

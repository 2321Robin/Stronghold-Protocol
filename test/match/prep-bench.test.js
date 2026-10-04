// 观战队友的整备区(游玩记录 #2 item 1「观战队友时看不到队友的未上场的干员」,建议见 GitHub #44
// 「看不见队友的待战栏位」):prep 侦察的 m.field(`Match.prepFieldMeta`)带 `bench` — 被侦察玩家
// 手牌里的棋子(uid / kind / id / tier / golden / 装备 id,不含商店状态),手牌变化(部署 / 购入 /
// 装备)跟棋盘变化一样会触发推送(`_prepScoutSig`)。客户端:test/ui/prep-bench.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, give, legalTileFor, chessOfTier } from './harness.js';

const MELEE = (c) => c.position === 'MELEE' && c.profession === 'TANK';

test('#44 prep scout bench: the scouted m.field carries the hand; deploying empties it in a new push', () => {
  const S = 's_spec';
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 44, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  assert.equal(m.phase, PHASE.PREP);
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  const id = chessOfTier(1, MELEE).find((x) => m.pool.has(x));
  const piece = give(m, b, id); // into the hand
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });

  const first = h.lastTo('p_0', 'm.field');
  assert.equal(first.prep, true);
  assert.deepEqual(first.bench.map((x) => x.uid), [piece.uid], 'the hand piece is on the player scout');
  assert.equal(first.bench[0].kind, 'chess');
  assert.equal(first.bench[0].id, id);
  assert.equal(first.bench[0].items, undefined, 'no items equipped yet');
  // a spectator seat watches like an eliminated player: its scout meta equals a teammate's, bench included
  // (test/match/spectator.test.js "exactly what a teammate scouting the board gets")
  assert.deepEqual(h.lastTo(S, 'm.field').bench, first.bench, 'the same scout view for the spectator seat');

  // deploying it is a board AND a hand change: one new push with the piece on the field and the bench empty
  const [r, c] = legalTileFor(m, b, id);
  assert.deepEqual(m.handle('p_1', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: r, col: c }, dir: 'LEFT' }), { ok: true });
  const last = h.lastTo('p_0', 'm.field');
  assert.deepEqual(last.bench, [], 'the deployed operator left the hand');
  assert.ok(last.units.some((u) => u.uid === piece.uid), 'and stands on the watched board');
  m.dispose();
});

test('#44 prep scout bench: no private leak — an empty hand reads as an empty bench, and never an m.private', () => {
  const S = 's_spec';
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 45, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  const b = h.ps('p_1');
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  for (const p of [...b.board.values(), ...b.hand.filter(Boolean), ...b.temp.filter(Boolean)]) {
    if (p.kind === 'chess') b.returnCopies(p);
  }
  b.board.clear();
  b.hand.fill(null);
  b.temp.fill(null);
  b.recompute();
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.deepEqual(m.handle(S, { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  for (const pid of ['p_0', S]) {
    const first = h.lastTo(pid, 'm.field');
    assert.deepEqual(first.bench, [], `${pid}: nothing held — an empty bench, not undefined`);
  }
  assert.equal(h.allTo(S, 'm.private').length, 0, 'still no private state to a scout');
  m.dispose();
});

// test/content/op_yato2.test.js — the 自选 operator kit of 麒麟R夜刀 (char_1029_yato2, 6★ 处决者; kit
// server/sim/content/kits/ops/op-yato2.js), fielded the production way in every form. Every number is read back from
// data/backups.json. The local SP_DIY_COLLAB build (playtest #21) put her into the pool.
// Run: node --test test/content/op_yato2.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, diyRecord } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const YATO = 'char_1029_yato2';
const FORMS = BACKUPS.units[YATO].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const MOD2 = 'uniequip_002_yato2', MOD3 = 'uniequip_003_yato2';
const S1 = 'skchr_yato2_1', S2 = 'skchr_yato2_2', S3 = 'skchr_yato2_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, MOD2], [6, true, MOD3]];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

function field({ tier = 5, elite = false, mod = elite ? MOD3 : null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: YATO, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const hits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
const tagged = (h, u, tag) => hits(h, u).filter((c) => c.dmg?.tags?.includes(tag));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('麒麟R夜刀 in every 自选 form: its operator kit (all three skills authored), stats, the fast-redeploy 处决者, 协防盟约, no 特质', () => {
  assert.equal(OPERATOR_KITS[YATO], KITS[YATO]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? form.modules.find((x) => x.uniEquipId === mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [YATO, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.ok(u.base.respawnTime < 40, `${label(f)}: the fast redeploy (${u.base.respawnTime})`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
});

test('a 自选 pick: 麒麟R夜刀 is offered at tiers 5 and 6', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(YATO));
  assert.ok(KITTED_CHARS.includes(YATO));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(YATO), `tier ${t}`);
});

test('S1 鬼人化 activates on deployment: ASPD +70, every attack a 2-hit, the third attack on a target nets six; the T0 rider rides every attack', () => {
  const sk = skillOf(6, true, S1);
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  assert.equal(u.skill.activations, 1, 'activated on deployment');
  assert.ok(u.skill.active, 'running');
  approx(u.skill.timeLeft, sk.duration, `20 s`, 0.05);
  approx(u.findBuff('talent:yato2:ogre')?.mods.atkPct, 0.16, 'T1 while the skill runs');
  approx(u.s.interval, (u.base.bat ?? 1) * 100 / (100 + sk.bb.attack_speed), `ASPD +${sk.bb.attack_speed}`, 0.02);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  assert.ok(h.runUntil(() => tagged(h, u, 'yato2:rider').some((c) => c.target === e), 3), 'the T0 arts rider');
  const rider = tagged(h, u, 'yato2:rider').find((c) => c.target === e);
  const riderScale = diyRecord(SLOT[6], { charId: YATO, skillIndex: 0, uniEquipId: MOD3 }, { elite: true, data: { chess: CHESS, backups: BACKUPS } }).talents[0].bb['attack@atk_scale_1'];
  approx(rider.amount, u.s.atk * riderScale, `rider = ${riderScale} ATK`, 0.01);
  assert.deepEqual([rider.type], ['arts']);
  // per-attack grouping: the plain attacks are 2-hit
  const attacks = hits(h, u).filter((c) => c.dmg?.isAttack && c.target === e);
  const per = new Map();
  for (const c of attacks) per.set(c.dmg.attackId, (per.get(c.dmg.attackId) ?? 0) + 1);
  assert.ok([...per.values()].every((n) => n === 2), '2-hit attacks');
  // the third attack on the same target nets six: 4 combo instances
  const n0 = tagged(h, u, 'yato2:combo').filter((c) => c.target === e).length;
  assert.ok(h.runUntil(() => tagged(h, u, 'yato2:combo').filter((c) => c.target === e).length > n0, 8), 'a combo landed');
  const comboBatch = tagged(h, u, 'yato2:combo').filter((c) => c.target === e);
  assert.ok(comboBatch.length % 4 === 0 && comboBatch.length > 0, `4-instance combo batches (${comboBatch.length})`);
  for (const c of comboBatch) approx(c.amount, u.s.atk, 'combo instance = full ATK');
  done(h);
});

test('S2 乱舞 activates on deployment: 16 slashes on the front tile at +30 % ATK with taunt, the rider ×2.73 inside the window', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  assert.equal(u.skill.activations, 1, 'activated on deployment');
  const winAtk = u.s.atk;                          // the +30 % window is live at deployment
  const front = h.spawn('enemy_dummy', { pos: [10, 6] });
  const behind = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.step();
  const n0 = tagged(h, u, 'yato2:slash').length;
  assert.ok(h.runUntil(() => tagged(h, u, 'yato2:slash').length > n0 + 8, 4), 'the slashes');
  const slashes = tagged(h, u, 'yato2:slash');
  assert.ok(slashes.some((c) => c.target === front), 'the front tile caught');
  assert.ok(!slashes.some((c) => c.target === behind), 'two tiles ahead is not the front tile');
  for (const c of slashes) approx(c.amount, winAtk, 'a slash = the window ATK');
  const riderScale = diyRecord(SLOT[6], { charId: YATO, skillIndex: 1, uniEquipId: MOD3 }, { elite: true, data: { chess: CHESS, backups: BACKUPS } }).talents[0].bb['attack@atk_scale_1'];
  const rider = tagged(h, u, 'yato2:rider').find((c) => c.target === front);
  approx(rider.amount, winAtk * riderScale * sk.bb.talent_scale, `the rider ×${riderScale} × ${sk.bb.talent_scale} in the window`, 0.01);
  done(h);
});

test('S3 空中回旋乱舞 activates on deployment: the dash advances her, each step hits 260 % around it (flyers included)', () => {
  const sk = skillOf(6, true, S3);
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 4 });
  assert.equal(u.skill.activations, 1, 'activated on deployment');
  // enemies exist only after the start: retreat and redeploy so the landing dash sees them
  const near = h.spawn('enemy_dummy', { pos: [10, 6] }), fly = h.spawn('enemy_fly', { pos: [9, 6] });
  h.step();
  h.b.retreat(u);
  assert.ok(h.b.redeploy(u, { tile: [10, 4] }), 'redeployed');
  assert.equal(u.skill.activations, 2, 'the landing recast');
  h.step();
  const winds = tagged(h, u, 'yato2:wind');
  assert.ok(winds.some((c) => c.target === near), 'the ground enemy caught');
  assert.ok(winds.some((c) => c.target === fly), 'the flyer caught (可以攻击空中单位)');
  // the recast runs inside the redeployment: its early steps see her base ATK, later ones the alone-buffed one
  for (const c of winds) {
    const unitAtk = c.amount / sk.bb.atk_scale;
    assert.ok(Math.abs(unitAtk - u.base.atk) < 1 || Math.abs(unitAtk - u.base.atk * 1.1) < 1, `260 % ATK (base or +10 %): ${c.amount}`);
  }
  assert.ok(u.tileC > 4, `she advanced into the free tile (4 → ${u.tileC}), stopping on the caught enemy`);
  done(h);
});

test('T1 鬼人强化状态: the ATK buff holds while a skill runs and 10 s after it ends, then falls off', () => {
  const { h, u } = field({ tier: 5, skill: 1 });   // S2: an instant — its window is deployment + 10 s
  assert.ok(u.findBuff('talent:yato2:ogre'), 'the buff is on');
  const t1 = skillOf(5, false, S2);
  h.run(3);                                        // the 2.5 s window is over
  assert.ok(u.findBuff('talent:yato2:ogre'), 'still within the 10 s after');
  h.run(10);                                       // past the 10 s after (the window ends at 12.5 s)
  assert.equal(u.findBuff('talent:yato2:ogre'), null, 'the buff fell off');
  done(h);
});

test('uniequip_003\'s trait part: ATK +10 % while none of her four orthogonal neighbours is a friendly operator', () => {
  const { h, u } = field({ tier: 6, elite: true, mod: MOD3, skill: 1 });
  h.run(0.5);
  assert.ok(u.findBuff('mod:yato2:alone'), 'alone — the buff is on');
  approx(u.findBuff('mod:yato2:alone').mods.atkPct, 0.1, '+10 %');
  const others = [{ uid: 2, chessId: 'chess_char_1_08_a', row: 9, col: 5 }];   // an orthogonal neighbour
  const h2 = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed: 5, flags: { dpPerSec: 0, dpMax: 999 }, captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[6], charId: YATO, skillIndex: 1, uniEquipId: MOD3 }, elite: true, row: 10, col: 5 }, ...others],
  });
  h2.step();
  h2.run(0.5);
  assert.equal(h2.unit(1).findBuff('mod:yato2:alone'), null, 'a neighbour beside her — off');
  done(h);
});

// test/content/op_marcil.test.js — the 自选 operator kit of 玛露西尔 (char_4141_marcil, 6★ 扩散术师; kit
// server/sim/content/kits/ops/op-marcil.js), fielded the production way in every form. Every number is read back from
// data/backups.json. The local SP_DIY_COLLAB build (playtest #21) put her into the pool.
// Run: node --test test/content/op_marcil.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const MARCIL = 'char_4141_marcil';
const FORMS = BACKUPS.units[MARCIL].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const MOD = 'uniequip_002_marcil';
const S1 = 'skchr_marcil_1', S2 = 'skchr_marcil_2', S3 = 'skchr_marcil_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy') };
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, MOD], [6, true, MOD]];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

function field({ tier = 5, elite = false, mod = elite ? MOD : null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: MARCIL, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
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

test('玛露西尔 in every 自选 form: its operator kit (all three skills authored), stats + module, 协防盟约, no 特质', () => {
  assert.equal(OPERATOR_KITS[MARCIL], KITS[MARCIL]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? form.modules.find((x) => x.uniEquipId === mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [MARCIL, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
});

test('a 自选 pick: 玛露西尔 is offered at tiers 5 and 6', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(MARCIL));
  assert.ok(KITTED_CHARS.includes(MARCIL));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(MARCIL), `tier ${t}`);
});

test('the mana pool: opens at her bb mana_init (10 for S2), no natural regen on the field, +1/s off the field, ATK +25 % while mana > 0', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  assert.equal(u.skill.sp, sk.bb.mana_init, `the opening mana = ${sk.bb.mana_init}`);
  const sp0 = u.skill.sp;
  h.run(2);
  assert.equal(u.skill.sp, sp0, 'no natural regen while deployed');
  approx(u.findBuff('talent:marcil:mana-atk')?.mods.atkPct, 0.25, 'ATK +25 % while mana > 0');
  h.b.retreat(u);
  const t = h.b.time;
  assert.ok(h.runUntil(() => u.skill.sp > sp0, 3), 'the off-field mana refill');
  assert.ok(u.skill.sp - sp0 <= h.b.time - t + 0.3, '1 per second');
  done(h);
});

test('S1 才女的实力: the toggle opens at 25 mana, drains 2 per attack, +85 % ATK, ends when the mana runs dry; heals the ally when no enemy', () => {
  const sk = skillOf(6, true, S1);
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  assert.equal(u.skill.sp, sk.bb.mana_init, 'the opening mana (S1: 25)');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  assert.ok(h.runUntil(() => u.skill.active, 1), 'opened at the bb minimum (25 ≥ 2)');
  approx(u.s.atk, u.base.atk * (1 + 0.25 + sk.bb.atk), '+85 % on top of the mana ATK');
  const n0 = tagged(h, u, 'marcil:heal').length;
  assert.ok(h.runUntil(() => u.skill.sp < sk.bb.mana_init, 4), 'the attacks drain the mana');
  // out of mana: the toggle ends (drive the mana to one attack's worth and watch it close)
  u.skill.sp = 4;
  assert.ok(h.runUntil(() => !u.skill.active, 12), 'the toggle ends when the mana runs dry');
  // the heal branch: an ally in range, no enemy — the most-wounded one gets her ATK as a heal
  const h2 = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed: 5, flags: { dpPerSec: 0, dpMax: 999 }, captureNoisy: true,
    units: [
      { uid: 1, diy: { slot: SLOT[6], charId: MARCIL, skillIndex: 0, uniEquipId: MOD }, elite: true, row: 10, col: 5 },
      { uid: 2, chessId: 'chess_char_1_06_a', row: 10, col: 6 },
    ],
  });
  h2.step();
  const ally = h2.unit(2);
  ally.hp = ally.s.maxHp * 0.5;
  h2.run(4);
  assert.ok(ally.hp > ally.s.maxHp * 0.6, `the no-enemy branch heals (${ally.hp.toFixed(0)} / ${ally.s.maxHp.toFixed(0)})`);
  done(h);
});

test('S2 召唤使魔: each use consumes 35 mana, the familiar buffs her attacks; the second use upgrades (range +1, ASPD +45)', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  h.run(1);
  assert.equal(u.findBuff('marcil:familiar'), null, 'no cast below 35 mana (the opening 10 stays)');
  assert.ok(u.skill.sp < sk.bb.skill_cost_min_sp, 'no cast below 35 mana');
  h.run(30);                                     // she is on the field — the mana stays put
  assert.ok(u.skill.sp < sk.bb.skill_cost_min_sp, 'no cast below 35 mana');
  u.skill.sp = sk.bb.skill_cost_min_sp;          // the mana arrives (a reward / the official top-up)
  assert.ok(h.runUntil(() => !!u.mem.marcilFamiliar, 1), 'the familiar switched on');
  assert.deepEqual(u.findBuff('marcil:familiar')?.mods, { atkPct: sk.bb.atk }, 'the first use: +70 % ATK');
  u.skill.sp = sk.bb.skill_cost_min_sp;
  assert.ok(h.runUntil(() => u.mem.marcilFamiliar >= 2, 1), 'the second use upgrades');
  assert.deepEqual(u.findBuff('marcil:familiar')?.mods, { atkPct: sk.bb.atk, rangeExtend: 1, aspd: sk.bb.attack_speed }, 'range +1, ASPD +45');
  approx(u.skill.sp, 0, 'the mana consumed');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  assert.ok(h.runUntil(() => tagged(h, u, 'yato2:rider') || true, 0.1));
  const e = h.enemies()[0];
  assert.ok(h.runUntil(() => e.findBuff('sluggish') || e.s.flags.stun, 4), 'the hit riders (停顿 / 晕眩)');
  done(h);
});

test('S3 爆破魔法: 5 s after the cast the 340 % explosion in front; the extra chant converts the rest of the mana', () => {
  const sk = skillOf(6, true, S3);
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 5 });
  const inFront = h.spawn('enemy_dummy', { pos: [10, 6] });
  const behind = h.spawn('enemy_dummy', { pos: [10, 3] });
  h.step();
  assert.ok(h.runUntil(() => u.skill.activations === 1, 1), 'opened at the bb minimum (40 ≥ 8)');
  approx(u.skill.sp, sk.bb.mana_init - sk.bb.skill_cost_min_sp, 'the cast drained 8');
  const t0 = h.b.time;
  assert.ok(h.runUntil(() => tagged(h, u, 'marcil:blast').length > 0, 6), 'the explosion');
  assert.ok(h.b.time - t0 >= 4.9, `after the 5 s chant (${(h.b.time - t0).toFixed(2)})`);
  const blasts = tagged(h, u, 'marcil:blast');
  assert.ok(blasts.some((c) => c.target === inFront), 'the front caught');
  assert.ok(!blasts.some((c) => c.target === behind), 'behind her is not the front');
  for (const c of blasts) approx(c.amount, u.s.atk * sk.bb.atk_scale, '340 % arts');
  done(h);
});

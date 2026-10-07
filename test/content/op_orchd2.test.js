// test/content/op_orchd2.test.js — the 自选 operator kit of 焰狐龙梓兰 (char_1048_orchd2, 6★ 近距射程; kit
// server/sim/content/kits/ops/op-orchd2.js), fielded the production way in every form. Every number is read back from
// data/backups.json. The local SP_DIY_COLLAB build (playtest #21) put her into the pool.
// Run: node --test test/content/op_orchd2.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const ORCHD = 'char_1048_orchd2';
const FORMS = BACKUPS.units[ORCHD].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_orchd2_1', S2 = 'skchr_orchd2_2', S3 = 'skchr_orchd2_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, 'uniequip_002_orchd2'], [6, true, 'uniequip_002_orchd2']];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

function field({ tier = 5, elite = false, mod = elite ? 'uniequip_002_orchd2' : null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: ORCHD, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
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

test('焰狐龙梓兰 in every 自选 form: its operator kit (all three skills authored), stats, 协防盟约, no 特质', () => {
  assert.equal(OPERATOR_KITS[ORCHD], KITS[ORCHD]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? form.modules.find((x) => x.uniEquipId === mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [ORCHD, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
});

test('a 自选 pick: 焰狐龙梓兰 is offered at tiers 5 and 6', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(ORCHD));
  assert.ok(KITTED_CHARS.includes(ORCHD));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(ORCHD), `tier ${t}`);
});

test('S1 刚射 (3 charges, auto-released at full): 4 arrows ×120 %, the charged 强连射 adds 5 ×160 % with the stun chance', () => {
  const sk = skillOf(6, true, S1);
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  assert.deepEqual([u.skill.maxCharges, sk.spCost], [3, sk.spCost]);
  u.skill.gainSp(999);
  assert.equal(u.skill.charges, 3, 'charges stored');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  assert.ok(h.runUntil(() => tagged(h, u, 'orchd:arrow').length > 0, 2), 'auto-released at full charges');
  const arrows = tagged(h, u, 'orchd:arrow');
  assert.equal(arrows.length, 9, `4 arrows + the 5-arrow 强连射 (${arrows.length})`);
  const first4 = arrows.slice(0, 4), last5 = arrows.slice(4);
  for (const c of first4) approx(c.amount, u.s.atk * sk.bb.atk_scale_1, '120 %');
  for (const c of last5) approx(c.amount, u.s.atk * sk.bb.atk_scale_2, '160 %');
  assert.equal(u.skill.charges, 1, 'two charges spent (the 强连射 consumed one more)');
  done(h);
});

test('S2 飞翔瞪射 fires on deployment: three volleys over the skill grid, the landing blast 270 % around her', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  assert.equal(u.skill.activations, 1, 'activated on deployment');
  // the deployment volley fires at once: retreat + redeploy with the target already on the field
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });   // inside the skill's forward band (cols +2…+4)
  const close = h.spawn('enemy_dummy', { pos: [10, 6] });   // beside her: the landing blast catches it
  h.step();
  h.b.retreat(u);
  assert.ok(h.b.redeploy(u, { tile: [10, 5] }), 'redeployed');
  h.run(5);                                        // the recast's volleys (0 / 1.4 / 2.8) and the 4.2 s landing
  const volleys = tagged(h, u, 'orchd:volley').filter((c) => c.target === e);
  assert.ok(volleys.length >= 3, `the volleys hit (${volleys.length}, both casts' waves)`);
  for (const c of volleys) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale_loop'], '150 %');
  const lands = tagged(h, u, 'orchd:land').filter((c) => c.target === close);
  assert.ok(lands.length >= 1, 'a landing blast beside her');
  for (const c of lands) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale_end'], '270 %');
  assert.ok(!tagged(h, u, 'orchd:land').some((c) => c.target === e), 'the band target is outside the landing radius');
  done(h);
});

test('S3 龙之箭: the 1.5 s 蓄力, then a piercing line — 300 % physical + 40 % arts and a push for every enemy along it', () => {
  const sk = skillOf(6, true, S3);
  const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 3 });
  const onLine = h.spawn('enemy_dummy', { pos: [10, 5] });   // in her own range (the DEFAULT trigger needs a target)
  const offLine = h.spawn('enemy_dummy', { pos: [12, 8] });
  h.step();
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 3), 'cast');
  const t0 = h.b.time;
  assert.ok(h.runUntil(() => tagged(h, u, 'orchd:dragon').length > 0, 3), 'the arrow flew');
  assert.ok(h.b.time - t0 >= 1.4, `after the 蓄力 (${(h.b.time - t0).toFixed(2)} s)`);
  const dragon = tagged(h, u, 'orchd:dragon');
  assert.ok(dragon.some((c) => c.target === onLine), 'the line caught');
  assert.ok(!dragon.some((c) => c.target === offLine), 'off the line');
  for (const c of dragon.filter((x) => x.type === 'phys')) approx(c.amount, u.s.atk * sk.bb.atk_scale, '300 % physical');
  for (const c of dragon.filter((x) => x.type === 'arts')) approx(c.amount, u.s.atk * sk.bb.atk_scale_magic, '40 % arts');
  done(h);
});

test('T0 强击瓶专家: the first skill activation arms 50 powered attacks at 120 %, spent per attack instance', () => {
  const t0 = formOf(6, true).talents.find((t) => t.index === 0);
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.step();
  // with S1 selected her initSp (10 ≥ cost 5) casts it right at deployment — the bottles arm at once
  assert.ok(h.runUntil(() => tagged(h, u, 'orchd:arrow').length > 0, 3), 'the deployment cast');
  assert.ok(h.runUntil(() => atkHits(h, u).length > 0, 3), 'attacks');
  const powered = atkHits(h, u).filter((c) => c.amount > u.s.atk * 1.05);
  assert.ok(powered.length > 0, 'powered attacks after the arming');
  for (const c of powered.slice(0, 5)) approx(c.amount, u.s.atk * t0.bb.power_attack_scale, `×${t0.bb.power_attack_scale}`);
  // the 50-count: only attacks spend bottles (the skill arrows do not); in a 40 s window the attacks stay under 50
  // (her interval is 1.6 s) and every one of them is powered
  h.run(40);
  const all = atkHits(h, u);
  assert.ok(all.length >= 10 && all.length < 50, `${all.length} attacks in the window (the bottle cap not reached)`);
  assert.ok(all.every((c) => Math.abs(c.amount - u.s.atk * t0.bb.power_attack_scale) < 1), `every attack ×${t0.bb.power_attack_scale}`);
  done(h);
});
const atkHits = (h, u) => hits(h, u).filter((c) => c.dmg?.isAttack);

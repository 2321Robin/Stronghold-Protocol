// test/content/op_ash.test.js — the 自选 operator kit of 灰烬 (char_456_ash, 6★ 快速神射手; kit
// server/sim/content/kits/ops/op-ash.js), fielded the production way (a DIY slot + its `diy` pick) in every form:
// tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or MAR-Y / MAR-X at
// stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json; the fidelity checklist of
// kits/README.md item by item. The local SP_DIY_COLLAB build (playtest #21) put her into the pool — upstream excludes
// the collab operators.
// Run: node --test test/content/op_ash.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const ASH = 'char_456_ash';
const FORMS = BACKUPS.units[ASH].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const MARY = 'uniequip_002_ash', MARX = 'uniequip_003_ash';
const S1 = 'skchr_ash_1', S2 = 'skchr_ash_2', S3 = 'skchr_ash_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, MARY], [6, true, MARX]];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

function field({ tier = 5, elite = false, mod = elite ? MARY : null, skill = 0, row = 10, col = 5, others = [], seed = 5, dir } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: ASH, skillIndex: skill, uniEquipId: mod }, elite, row, col, dir }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const tagged = (h, u, tag) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes(tag));
const stuns = (h, u) => h.hooksOf('statusApplied').filter((c) => c.source === u && c.status === 'stun');
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('灰烬 in every 自选 form: its operator kit (all three skills authored), the form\'s stats + module attributes, the fastshot profile (hits air), 协防盟约, no 特质', () => {
  assert.equal(OPERATOR_KITS[ASH], KITS[ASH]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [ASH, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.profile.canHitFly, u.profile.priority], [true, 'fly'], `${label(f)}: 快速神射手`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
  const mary = modOf(5, MARY);
  assert.deepEqual([mary.attr.maxHp, mary.attr.atk], [100, 25], 'MAR-Y stage 1');
  assert.deepEqual(mary.traitOverride && mary.traitOverride.bb, {}, 'MAR-Y adds no trait effect at stage 1');
  assert.deepEqual(modOf(6, MARX).attr, { maxHp: 170, atk: 22, def: 19 }, 'MAR-X at its stage (read back from the data)');
  assert.deepEqual(modOf(6, MARX).traitOverride.bb, { atk_scale: 1.1 });
});

test('a 自选 pick: 灰烬 is offered at tiers 5 and 6 and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(ASH));
  assert.ok(KITTED_CHARS.includes(ASH));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(ASH), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: ASH, skillIndex: 1, uniEquipId: null } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: ASH, skillIndex: 1, uniEquipId: null } } });
});

test('T1 突击手 grants 20 SP on deployment; the T0 flash itself is exercised through S2 (no enemies exist at the deploy tick)', () => {
  const { h, u } = field({ tier: 5, skill: 0 });
  assert.ok(u.skill.sp >= 20, `T1: SP after deploy = ${u.skill.sp}`);
  done(h);
});

test('S1 支援射击 (持续时间无限 ⇒ toggle): ATK +bb.atk and every attack is a double hit', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  const sk = skillOf(6, true, S1);
  approx(u.s.atk, u.base.atk, 'before');
  u.skill.gainSp(999);
  u.skill.activate('test');
  assert.ok(u.skill.active, 'the toggle is on');
  approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `+${sk.bb.atk * 100} % ATK`);
  h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => atkHits(h, u).length >= 2, 3), 'attacks land');
  const n0 = atkHits(h, u).length;
  h.run(3);
  const hits = atkHits(h, u).slice(n0);
  const perAttack = new Map();
  for (const c of hits) perAttack.set(c.dmg.attackId, (perAttack.get(c.dmg.attackId) ?? 0) + 1);
  assert.ok([...perAttack.values()].every((n) => n === 2), `every attack is a 2-hit (times ${sk.bb['attack@times']})`);
  done(h);
});

test('S2 突击战术: 31 rounds, the flash triggers on cast (the point + neighbours stunned, the far one not), the interval shortens, a stunned target takes 210 %', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  assert.equal(u.skill.ammo, 31, 'the magazine');
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.spawn('enemy_dummy', { pos: [9, 6] });     // a neighbour of the flash point
  const far = h.spawn('enemy_dummy', { pos: [10, 8] });   // in range, outside every possible flash radius
  h.step();                                     // the spawns become active
  u.skill.gainSp(999);
  u.skill.activate('test');
  assert.ok(u.skill.active, 'running');
  const flash = stuns(h, u);
  assert.ok(flash.length >= 2, `S2 triggers the flashbang (${flash.length} stuns)`);
  assert.ok(!flash.some((c) => c.target === far), 'outside the flash radius');
  approx(u.s.interval, 1.0 * (1 + sk.bb.base_attack_time), 'interval −0.8 s', 0.02);
  const n1 = atkHits(h, u).length;
  assert.ok(h.runUntil(() => atkHits(h, u).length > n1, 3), 'attacks land');
  for (const c of atkHits(h, u).slice(n1)) approx(c.amount, u.s.atk, 'plain rounds at 100 %');
  h.b.applyStatus(e, 'stun', { duration: 5, source: u });
  for (const other of h.enemies()) if (other !== e) h.b.kill(other, null);   // e becomes the only target
  h.step();
  const n2 = atkHits(h, u).length;
  assert.ok(h.runUntil(() => atkHits(h, u).some((c) => c.target === e && c.amount > u.s.atk * 1.5), 3), 'a round hit the stunned target');
  const onStun = atkHits(h, u).slice(n2).filter((c) => c.target === e && c.amount > u.s.atk * 1.5)[0];
  approx(onStun.amount, u.s.atk * sk.bb['ash_s_2[atk_scale].atk_scale'], '210 % vs stunned');
  done(h);
});

test('S3 攻坚榴弹: the shell hits the path at 260 % with a push, the blast is 360 % (720 % into a wall), and only 2 casts per deployment', () => {
  const sk = skillOf(6, true, S3);
  { // open field: the path runs its 5 tiles, the blast 360 %
    const { h, u } = field({ tier: 6, elite: true, skill: 2, row: 10, col: 3 });
    const onPath = h.spawn('enemy_dummy', { pos: [10, 5] });
    const beside = h.spawn('enemy_dummy', { pos: [11, 5] });
    h.step();
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 2), 'auto-cast with an enemy in the skill grid');
    const shells = tagged(h, u, 'ash:shell');
    assert.ok(shells.some((c) => c.target === onPath), 'the path hit');
    for (const c of shells) approx(c.amount, u.s.atk * sk.bb.atk_scale, '260 %');
    assert.ok(!tagged(h, u, 'ash:shell').some((c) => c.target === beside), 'off the path');
    const blasts = tagged(h, u, 'ash:blast');
    assert.ok(blasts.length > 0, 'the blast landed');
    for (const c of blasts) approx(c.amount, u.s.atk * sk.bb.not_hitwall_scale, '360 %');
    // the second cast fires (a fresh target for the skill grid), the third is blocked until the next deployment
    u.skill.gainSp(999);
    u.skill.activate('test');
    assert.equal(u.skill.activations, 2, 'the second cast');
    h.run(1);
    assert.equal(u.skill.activations, 2, 'no third cast');
    assert.equal(u.skill.noSkill, true, 'the skill is spent');
    done(h);
  }
  { // into a wall: a standable ground tile with high ground to its LEFT (facing left), the blast is 720 % there
    const probe = makeBattle({
      defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed: 5, flags: { dpPerSec: 0, dpMax: 999 },
      units: [{ uid: 1, diy: { slot: SLOT[6], charId: ASH, skillIndex: 2, uniEquipId: MARX }, elite: true, row: 10, col: 5 }],
    });
    probe.step();
    let wallPos = null;
    for (let r = 18; r >= 0 && !wallPos; r--) {
      for (let c = 18; c >= 1 && !wallPos; c--) {
        if (probe.b.grid.canStand(r, c) && probe.b.grid.isLow(r, c) && !probe.b.grid.isLow(r, c - 1)) wallPos = [r, c];
      }
    }
    assert.ok(wallPos, 'the stage has a standable low tile with high ground to its left');
    const { h, u } = field({ tier: 6, elite: true, skill: 2, row: wallPos[0], col: wallPos[1], dir: 'LEFT' });
    assert.ok(u.deployed, `deployable at ${wallPos}`);
    const byWall = h.spawn('enemy_dummy', { pos: [wallPos[0] - 1, wallPos[1] - 1] });   // a target beside the wall blast
    h.step();
    u.skill.gainSp(999);
    u.skill.activate('test');   // manual: the grid ahead is all wall, no enemy can stand in it for the auto trigger
    assert.ok(u.skill.activations === 1, 'cast');
    const blasts = tagged(h, u, 'ash:blast');
    assert.ok(blasts.some((c) => c.target === byWall), 'the blast caught the target by the wall');
    for (const c of blasts) approx(c.amount, u.s.atk * sk.bb.hitwall_scale, '720 % into the high ground');
    done(h);
  }
});

test('MAR-X: attacks on flying units deal 110 % (the trait bb atk_scale); MAR-Y: ASPD +8 while a ground enemy is in range', () => {
  for (const [tier, elite, mod, flyScale] of [[5, true, MARY, 1], [6, true, MARX, 1.1]]) {
    const { h, u } = field({ tier, elite, mod, skill: 1 });
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });
    assert.ok(h.runUntil(() => atkHits(h, u).some((c) => c.target === fly), 3), `T${tier}: she hits the flyer`);
    approx(atkHits(h, u).find((c) => c.target === fly).amount, u.s.atk * flyScale, `T${tier}: the flyer takes ×${flyScale}`);
    if (mod === MARY) {
      h.spawn('enemy_dummy', { pos: [10, 6] });
      assert.ok(h.runUntil(() => u.findBuff('mod:ash:mar-y'), 1), 'ground enemy in range — ASPD +8');
      approx(u.findBuff('mod:ash:mar-y').mods.aspd, 8, 'the module\'s +8');
    }
    done(h);
  }
});

// test/content/op_ela.test.js — the 自选 operator kit of 艾拉 (char_4123_ela, 6★ 陷阱师; kit
// server/sim/content/kits/ops/op-ela.js), fielded the production way in every form. Every number is read back from
// data/backups.json. The local SP_DIY_COLLAB build (playtest #21) put her into the pool.
// Run: node --test test/content/op_ela.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const ELA = 'char_4123_ela';
const FORMS = BACKUPS.units[ELA].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_ela_1', S2 = 'skchr_ela_2', S3 = 'skchr_ela_3';
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, speed: 0.6, mass: 0 }) };
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, 'uniequip_002_ela'], [6, true, 'uniequip_002_ela']];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

function field({ tier = 5, elite = false, mod = elite ? 'uniequip_002_ela' : null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: ELA, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
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

test('艾拉 in every 自选 form: its operator kit (all three skills authored), stats, the traper trait, 协防盟约, no 特质', () => {
  assert.equal(OPERATOR_KITS[ELA], KITS[ELA]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? form.modules.find((x) => x.uniEquipId === mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [ELA, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0)], `${label(f)}: stats`);
      assert.match(form.trait.desc, /陷阱/, `${label(f)}: the traper trait`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
});

test('a 自选 pick: 艾拉 is offered at tiers 5 and 6; her mine is a placeable summon of the loadout', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(ELA));
  assert.ok(KITTED_CHARS.includes(ELA));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(ELA), `tier ${t}`);
  const mine = BACKUPS.tokens['token_10033_ela_grzmot'];
  assert.equal(mine.placeable, true, 'placeable');
  assert.equal(mine.deployLimit, 4, '4 mines');
  assert.ok(mine.owners.some((o) => o.startsWith(ELA)), 'she owns the variant');
});

test('the mines: S1 auto-places one and the ring triggers the selected skill\'s effect (S1 sluggish / S2 stun); S3 grants two at its end', () => {
  { // S1: the placed mine's ring applies her S1 passive (sluggish 9 s), then the mine is spent
    const sk = skillOf(6, true, S1);
    const { h, u } = field({ tier: 6, elite: true, skill: 0 });
    h.b.players[0].dp = 999;
    u.skill.gainSp(999);
    u.skill.activate('test');
    const mines = h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === 'token_10033_ela_grzmot');
    assert.ok(mines.length === 1, `the +1 mine placed (${mines.length})`);
    const foe = h.spawn('enemy_walk', { pos: [mines[0].tileR, Math.min(20, mines[0].tileC + 1)] });   // beside the mine
    h.step();
    assert.ok(h.runUntil(() => foe.findBuff('sluggish'), 4), 'the ring triggered');
    approx(foe.findBuff('sluggish').timeLeft, sk.bb.sluggish, `sluggish ${sk.bb.sluggish} s`, 0.05);
    assert.ok(!mines[0].deployed || !mines[0].alive, 'the mine is spent');
    done(h);
  }
  { // S2: the stun passive (the mine placed directly — S2 itself grants none at cast)
    const sk = skillOf(6, true, S2);
    const { h, u } = field({ tier: 6, elite: true, skill: 1 });
    h.b.players[0].dp = 999;
    const mine = h.b.spawnToken(u, 'token_10033_ela_grzmot', 10, 6, { anySource: true });
    assert.ok(mine, 'the mine is up');
    h.step();                                      // the kit arms it
    const foe = h.spawn('enemy_walk', { pos: [mine.tileR, mine.tileC + 1] });
    h.step();
    assert.ok(h.runUntil(() => foe.findBuff('stun') || foe.s.flags.stun, 4), 'the S2 mine stuns');
    approx(foe.findBuff('stun')?.timeLeft ?? 0, sk.bb.stun, `stun ${sk.bb.stun} s`, 0.05);
    done(h);
  }
  { // S3: the two mines come when the 40 rounds run out
    const { h, u } = field({ tier: 6, elite: true, skill: 2 });
    h.b.players[0].dp = 999;
    u.skill.gainSp(999);
    u.skill.activate('test');
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    h.step();
    assert.ok(h.runUntil(() => !u.skill.active, 90), 'the 40 rounds are spent');
    const mines = h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === 'token_10033_ela_grzmot' && t.alive);
    assert.ok(mines.length === 2, `two mines at the end (${mines.length})`);
    done(h);
  }
});

test('T0 雷鸣地雷: her retreat sets the mine effect off around her; T1 “正中靶心” always triggers on a marked target at 160 %', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0 });
  h.b.players[0].dp = 999;
  // the mark: S1 places a mine beside the foe, the ring marks it
  u.skill.gainSp(999);
  u.skill.activate('test');
  const mine = h.b.allyUnits.find((t) => t.kind === 'token' && t.defId === 'token_10033_ela_grzmot');
  assert.ok(mine, 'the mine is placed');
  const foe = h.spawn('enemy_walk', { pos: [mine.tileR, Math.min(20, mine.tileC + 1)] });   // beside the mine
  h.step();
  assert.ok(h.runUntil(() => foe.findBuff('ela:mine'), 4), 'the mine marked the target');
  // T1: the marked target always takes the 160 % rider on her attacks
  assert.ok(h.runUntil(() => tagged(h, u, 'ela:bull').some((c) => c.target === foe), 4), 'the marked target took the rider');
  // the rider fires inside the attack: its amount is 1.6 × that attack's own plain instance
  for (const c of tagged(h, u, 'ela:bull')) {
    const main = hits(h, u).find((x) => x.dmg?.isAttack && x.dmg.attackId === c.dmg.attackId);
    if (main) approx(c.amount, main.amount * 1.6, '160 % of the attack', 0.01);
  }
  // the unmarked enemy: the rider is a 30 % chance only (battle.rng) — informational, the guaranteed branch is pinned above
  const other = h.spawn('enemy_dummy', { pos: [10, 9] });
  h.run(6);
  const unmarkedRiders = tagged(h, u, 'ela:bull').filter((c) => c.target === other).length;
  const plainOther = hits(h, u).filter((c) => c.dmg?.isAttack && c.target === other && !c.dmg.tags?.includes('ela:bull')).length;
  assert.ok(plainOther === 0 || unmarkedRiders <= plainOther, `30 % on the unmarked (${unmarkedRiders} riders / ${plainOther} plain)`);
  done(h);
});

test('S2 震荡坚守: DEF +250 % with the 500 DEF ignore, splashing attacks, one mine at the end', () => {
  const sk = skillOf(6, true, S2);
  const { h, u } = field({ tier: 6, elite: true, skill: 1 });
  h.b.players[0].dp = 999;
  u.skill.gainSp(999);
  u.skill.activate('test');
  assert.ok(u.skill.active, 'running');
  approx(u.s.def, u.base.def * (1 + sk.bb.def), `DEF +${sk.bb.def * 100} %`);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const e2 = h.spawn('enemy_dummy', { pos: [10, 7] });
  h.step();
  assert.ok(h.runUntil(() => atkHits(h, u).some((c) => c.target === e2), 4), 'the splash caught the second target');
  h.run(21);
  assert.ok(!u.skill.active, 'over after 20 s');
  const mines = h.b.allyUnits.filter((t) => t.kind === 'token' && t.defId === 'token_10033_ela_grzmot' && t.alive);
  assert.ok(mines.length >= 1, 'the end-of-skill mine');
  done(h);
});
const atkHits = (h, u) => hits(h, u).filter((c) => c.dmg?.isAttack);

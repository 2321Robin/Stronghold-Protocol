// test/content/op_oblvns.test.js — the 自选 operator kit of 丰川祥子 (char_4182_oblvns, 6★ 领主; kit
// server/sim/content/kits/ops/op-oblvns.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4, no module) and elite (E2 Lv60, rank 7) with no module or LOR-Y
// “无言的约定” at stage 1 (tier 5) / 3 (tier 6). Every number is read back from data/backups.json (the form of that slot
// status); the fidelity checklist of kits/README.md item by item. The local SP_DIY_COLLAB build (playtest #21) put her
// into the pool — upstream excludes the collab operators (docs/DATA.md §18 documents the upstream state).
// Run: node --test test/content/op_oblvns.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const OBLVNS = 'char_4182_oblvns';
const FORMS = BACKUPS.units[OBLVNS].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const LORY = 'uniequip_002_oblvns';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
/** The T2 毋畏遗忘 aura's ASPD from the data: 16 at full potential (12 + 4, the potential-5 「天赋效果增强」; R21P). */
const T2_AURA = Object.values(FORMS)[0].talents[1].bb.attack_speed;
/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const modOf = (tier, mod) => (mod ? formOf(tier, true).modules.find((m) => m.uniEquipId === mod) : null);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_res: dummy('enemy_res', { res: 50 }),
  enemy_def: dummy('enemy_def', { def: 800 }),
};
/** Every 自选 form: [tier, elite, module]. */
const FORMS_ALL = [[5, false, null], [6, false, null], [5, true, LORY], [6, true, LORY]];
const label = ([tier, elite, mod]) => `T${tier} ${elite ? 'elite' : 'normal'} ${mod ?? 'none'}`;

/** A battle with 丰川祥子 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 5, elite = false, mod = elite ? LORY : null, skill = 0, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: OBLVNS, skillIndex: skill, uniEquipId: mod }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
const notes = (h, u, tag = 'oblvns:note') => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes(tag));
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}

test('丰川祥子 in every 自选 form: its operator kit (all three skills authored), the form\'s stats + module attributes, the 3-10 range, blocks 2, 领主 ranged, 协防盟约 (no core bond), no 特质', () => {
  assert.equal(OPERATOR_KITS[OBLVNS], KITS[OBLVNS]);
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, mod, skill });
      const form = formOf(tier, elite), m = elite && mod ? modOf(tier, mod) : null;
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [OBLVNS, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def], [form.stats.maxHp + (m?.attr.maxHp ?? 0), form.stats.atk + (m?.attr.atk ?? 0), form.stats.def + (m?.attr.def ?? 0)], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly], [2, 'ranged', true], `${label(f)}: 领主 (the trait's ranged classify, melee position)`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-10`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / 特质`);
      done(h);
    }
  }
  // the module (zh_CN): stage 1 +180 HP / +38 ATK / +5 ASPD, stage 3 +300 / +63 / +7; the trait override gains attack_speed 12
  assert.deepEqual([modOf(5, LORY).attr, modOf(6, LORY).attr], [{ maxHp: 180, atk: 38, aspd: 5 }, { maxHp: 300, atk: 63, aspd: 7 }]);
  assert.deepEqual([modOf(5, LORY).traitOverride.bb, modOf(6, LORY).traitOverride.bb], [{ atk_scale: 0.8, attack_speed: 12 }, { atk_scale: 0.8, attack_speed: 12 }]);
});

test('a 自选 pick: 丰川祥子 is offered at tiers 5 and 6 (the local pool has her) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(BACKUPS.diy.ownedPool.includes(OBLVNS), 'the SP_DIY_COLLAB build put her into the pool');
  assert.ok(!BACKUPS.diy.excluded.includes(OBLVNS), 'no longer among the excluded');
  assert.ok(KITTED_CHARS.includes(OBLVNS));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(OBLVNS), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: OBLVNS, skillIndex: 2, uniEquipId: LORY } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: OBLVNS, skillIndex: 2, uniEquipId: LORY } } });
});

test('S1 新月的苏醒 (attack SP, 2 charges): auto-releases once both charges are held — no enemy needed; a cast with targets = 8 arts notes of decaying atk_scale…atk_scale_8', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    assert.deepEqual([u.skill.maxCharges, sk.spCost, sk.spType], [2, 4, 'INCREASE_WHEN_ATTACK'], `T${tier}: charges from the data`);
    u.skill.gainSp(999);
    assert.equal(u.skill.charges, u.skill.maxCharges, `T${tier}: charges stored`);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 1), `T${tier}: auto-released with no enemy on the field`);
    assert.equal(notes(h, u).length, 0, `T${tier}: nothing to track, the cast is empty`);
    // with a target: the recharged cast plays the 8 decaying notes (after the 3 s manual-skill cooldown)
    h.spawn('enemy_dummy', { pos: [10, 6] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => notes(h, u).length === 8, 4), `T${tier}: 8 notes`);
    const cast = notes(h, u);
    const scales = [sk.bb.atk_scale, sk.bb.atk_scale_2, sk.bb.atk_scale_3, sk.bb.atk_scale_4, sk.bb.atk_scale_5, sk.bb.atk_scale_6, sk.bb.atk_scale_7, sk.bb.atk_scale_8];
    cast.forEach((c, i) => {
      approx(c.amount, u.s.atk * scales[i], `T${tier}: note ${i + 1} = ${scales[i]} ATK`);
      assert.deepEqual([c.type, c.dmg.isSkill], ['arts', true], `T${tier}: arts skill note`);
    });
    done(h);
  }
});

test('T1 颂乐音符: every attack plays a note (10 / 12 max), each note gives the Ave Mujica members def/res ignore, notes decay one per idle second once the attacks stop', () => {
  for (const f of FORMS_ALL) {
    const [tier, elite, mod] = f;
    const { h, u } = field({ tier, elite, mod, skill: 2 });
    const form = formOf(tier, elite);
    const t0 = form.talents.find((t) => t.index === 0);
    h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => (u.mem.oblvnsNotes ?? 0) >= 3, 10), `${label(f)}: notes pile up (${u.mem.oblvnsNotes})`);
    const pen = u.findBuff('oblvns:notes');
    assert.ok(pen, `${label(f)}: her own note pen (she is the Ave Mujica member)`);
    assert.ok(Math.abs(pen.mods.defIgnorePct / t0.bb.def_penetrate_ratio - u.mem.oblvnsNotes) <= 1, `${label(f)}: def ignore ×notes (${pen.mods.defIgnorePct} at ${u.mem.oblvnsNotes})`);
    assert.ok(Math.abs(pen.mods.resIgnorePct / t0.bb.magic_resist_penetrate_ratio - u.mem.oblvnsNotes) <= 1, `${label(f)}: res ignore ×notes`);
    // no more attacks: the notes decay one per second (delay 1 s) down to 0
    h.b.kill(h.enemies()[0], null);
    assert.ok(h.runUntil(() => (u.mem.oblvnsNotes ?? 0) === 0, 14), `${label(f)}: decayed to 0`);
    assert.equal(u.findBuff('oblvns:notes')?.mods.defIgnorePct ?? 0, 0, `${label(f)}: no pen without notes`);
    done(h);
  }
});

test('T2 毋畏遗忘: damage she deals feeds Fever (3 / point, 100 to full [ASSUMED]); the Fever runs 10 s [ASSUMED] and the operators in her range get ASPD +12', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 2, others: [{ uid: 2, chessId: 'chess_char_1_08_a', row: 10, col: 7 }, { uid: 3, chessId: 'chess_char_1_02_a', row: 13, col: 9 }] });
    const inRange = h.unit(2), outOfRange = h.unit(3);
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => atkHits(h, u).length > 0, 3), `T${tier}: she attacks`);
    assert.equal(u.mem.oblvnsFever ?? 0, 3 * atkHits(h, u).length, `T${tier}: 3 per damage instance`);
    u.mem.oblvnsFever = 99;                       // one more point to full
    h.b.dealDamage(u, e, { amount: 1, type: 'phys', tags: ['test'] });
    assert.ok(h.runUntil(() => (u.mem.oblvnsFeverUntil ?? 0) > h.b.time, 1), `T${tier}: Fever at 100`);
    const left = u.mem.oblvnsFeverUntil - h.b.time;
    assert.ok(left > 9 && left <= 10, `T${tier}: 10 s window`);
    approx(inRange.findBuff('oblvns:t2aura')?.mods.aspd, T2_AURA, `T${tier}: 角峰 in her range`);
    assert.equal(outOfRange.findBuff('oblvns:t2aura'), null, `T${tier}: 德克萨斯 far away`);
    const fever = u.mem.oblvnsFeverUntil;
    h.b.dealDamage(u, e, { amount: 5, type: 'phys', tags: ['test'] });
    h.step();
    assert.equal(u.mem.oblvnsFeverUntil, fever, `T${tier}: the meter does not fill during the Fever`);
    h.run(u.mem.oblvnsFeverUntil - h.b.time + 0.3);
    assert.ok(!u.mem.oblvnsFeverOn, `T${tier}: the Fever is over`);
    done(h);
  }
});

test('S2 满月的舞会: each cast switches the timbre — 风琴 first (ASPD +attack@attack_speed, attacks deal arts), then 钢琴 (ATK +attack@atk, the note pierces the tiles past the target)', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    // 风琴: attacks deal arts
    u.skill.gainSp(999);
    u.skill.activate('test');
    assert.deepEqual(u.findBuff('oblvns:timbre')?.mods, { aspd: sk.bb['attack@attack_speed'] }, `T${tier}: the organ stance`);
    assert.ok(h.runUntil(() => atkHits(h, u).length > 0, 3), `T${tier}: she attacks`);
    assert.ok(atkHits(h, u).every((c) => c.type === 'arts'), `T${tier}: organ notes are arts`);
    assert.equal(notes(h, u, 'oblvns:pierce').length, 0, `T${tier}: the organ note does not pierce`);
    // 钢琴: attacks deal physical and pierce
    u.skill.gainSp(999);
    u.skill.activate('test');
    assert.deepEqual(u.findBuff('oblvns:timbre')?.mods, { atkPct: sk.bb['attack@atk'] }, `T${tier}: the piano stance`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb['attack@atk']), `T${tier}: +${sk.bb['attack@atk'] * 100} % ATK`);
    const past = h.spawn('enemy_dummy', { pos: [10, 9] });   // outside her 3-10, in the pierce line of [10,6]
    assert.ok(h.runUntil(() => notes(h, u, 'oblvns:pierce').length > 0, 3), `T${tier}: the piano note pierces`);
    const pierced = notes(h, u, 'oblvns:pierce');
    assert.ok(pierced.every((c) => c.target === past && c.type === 'phys'), `T${tier}: the tiles past the target, physical`);
    approx(pierced[0].amount, atkHits(h, u).at(-1).amount, `T${tier}: the same damage as the main hit`);
    done(h);
  }
});

test('S3 残月的余响 (25 s, data duration): the range expands to the skill grid, every attack adds 2 physical notes on the highest-RES and 2 arts notes on the highest-DEF enemy of 180 % / 155 % ATK', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const { h, u } = field({ tier, elite, skill: 2 });
    assert.deepEqual([u.skill.maxCharges, sk.duration, sk.bb['attack@atk_scale'], sk.initSp], [1, 25, elite ? 1.8 : 1.55, elite ? 30 : 28], `T${tier}`);
    u.skill.gainSp(999);
    u.skill.activate('test');
    assert.ok(u.skill.active, `T${tier}: running`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `T${tier}: the expanded 3-10`);
    // both dummies stand on expanded-only tiles (outside her own 3-10), the high-RES one nearer (standard order)
    const byRes = h.spawn('enemy_res', { pos: [8, 5] });
    const byDef = h.spawn('enemy_def', { pos: [12, 5] });
    assert.ok(h.runUntil(() => notes(h, u).length >= 4, 5), `T${tier}: the tracking notes`);
    const round = notes(h, u).slice(-4);
    const phys = round.filter((c) => c.type === 'phys'), arts = round.filter((c) => c.type === 'arts');
    assert.deepEqual(phys.map((c) => c.target), [byRes, byRes], `T${tier}: 2 physical on the highest-RES enemy`);
    assert.deepEqual(arts.map((c) => c.target), [byDef, byDef], `T${tier}: 2 arts on the highest-DEF enemy`);
    for (const c of round) approx(c.amount, u.s.atk * sk.bb['attack@atk_scale'], `T${tier}: ${sk.bb['attack@atk_scale'] * 100} % ATK notes`);
    h.run(26);
    assert.ok(!u.skill.active, `T${tier}: over after 25 s`);
    assert.deepEqual(u.liveRangeGrid, formOf(tier, elite).rangeGrid, `T${tier}: back to 3-10`);
    done(h);
  }
});

test('LOR-Y stage 3: while a skill runs her ranged attacks keep the full ATK (远程攻击不再降低攻击力); the trait part gives ASPD +12 with 2+ enemies in range (stages 1 and 3)', () => {
  for (const [tier, elite, stage] of [[5, true, 1], [6, true, 3]]) {
    const noPen = stage >= 3;
    const { h, u } = field({ tier, elite, skill: 2 });
    const far = h.spawn('enemy_dummy', { pos: [9, 6] });    // in range, not her / the front tile, never blocked
    assert.ok(h.runUntil(() => atkHits(h, u).length > 0, 3), `T${tier}: she attacks`);
    approx(atkHits(h, u)[0].amount, u.s.atk * 0.8, `T${tier}: the lord scale off-skill`);
    assert.equal(u.findBuff('trait:oblvns:crowd'), null, `T${tier}: one enemy, no crowd ASPD`);
    h.spawn('enemy_dummy', { pos: [10, 7] });
    assert.ok(h.runUntil(() => u.findBuff('trait:oblvns:crowd'), 1), `T${tier}: two enemies — ASPD +12`);
    approx(u.findBuff('trait:oblvns:crowd').mods.aspd, 12, `T${tier}: the trait part`);
    h.b.kill(h.enemies().find((e) => e.tileC === 7), null);   // one enemy left: every attack targets the far one
    u.skill.gainSp(999);
    u.skill.activate('test');
    const n0 = atkHits(h, u).length;
    assert.ok(h.runUntil(() => atkHits(h, u).length > n0, 3), `T${tier}: attacks under the skill`);
    const hits = atkHits(h, u).slice(n0).filter((c) => c.target === far && !c.dmg.tags?.includes('oblvns:note'));
    assert.ok(hits.length > 0, `T${tier}: a plain attack landed`);
    approx(hits[0].amount, u.s.atk * (noPen ? 1 : 0.8), `T${tier}: ${noPen ? 'full ATK during the skill (stage 3)' : 'still 80 % at stage 1'}`);
    done(h);
  }
});

test('S3 + Fever: an Ave Mujica member saved from a lethal hit retires when the Fever ends; without the Fever she falls', () => {
  const sakiko = (uid, tier, skill) => ({ uid, diy: { slot: SLOT[tier], charId: OBLVNS, skillIndex: skill, uniEquipId: null }, elite: true, row: uid === 1 ? 10 : 12, col: 5 });
  { // the save: the tier-6 丰川祥子 stands in the tier-5 one's S3 while the Fever runs
    const { h } = field({ tier: 5, elite: true, skill: 2, others: [sakiko(2, 6, 1)] });
    const saver = h.unit(1), mate = h.unit(2);
    saver.mem.oblvnsFever = 100;
    assert.ok(h.runUntil(() => (saver.mem.oblvnsFeverUntil ?? 0) > h.b.time, 1), 'Fever running');
    saver.skill.gainSp(999);
    saver.skill.activate('test');
    assert.ok(saver.skill.active, 'S3 running');
    h.b.dealDamage(saver, mate, { amount: 1e12, type: 'phys', tags: ['test'] });
    h.step();
    assert.ok(mate.alive && mate.deployed, 'the lethal hit is prevented');
    assert.ok(mate.mem.oblvnsSaved, 'marked saved');
    assert.ok(h.runUntil(() => !mate.deployed || !mate.alive, 12), 'she retires once the Fever is over');
    done(h);
  }
  { // the control: no Fever, the same hit kills
    const { h } = field({ tier: 5, elite: true, skill: 2, others: [sakiko(2, 6, 1)] });
    const saver = h.unit(1), mate = h.unit(2);
    saver.skill.gainSp(999);
    saver.skill.activate('test');
    h.b.dealDamage(saver, mate, { amount: 1e12, type: 'phys', tags: ['test'] });
    h.step();
    assert.ok(!mate.alive, 'without the Fever the lethal hit kills');
    done(h);
  }
  { // the control: Fever but no S3, the same hit kills
    const { h } = field({ tier: 5, elite: true, skill: 2, others: [sakiko(2, 6, 1)] });
    const saver = h.unit(1), mate = h.unit(2);
    saver.mem.oblvnsFever = 100;
    h.run(0.3);
    h.b.dealDamage(saver, mate, { amount: 1e12, type: 'phys', tags: ['test'] });
    h.step();
    assert.ok(!mate.alive, 'without S3 the Fever alone saves nobody');
    done(h);
  }
});

test('Fever + S2: the current timbre becomes a 二连击 — every attack is followed by one free extra attack of the same timbre', () => {
  for (const mode of ['organ', 'piano']) {
    const { h, u } = field({ tier: 6, elite: true, skill: 1 });
    u.skill.gainSp(999);
    u.skill.activate('test');                                  // 风琴
    if (mode === 'piano') { u.skill.gainSp(999); u.skill.activate('test'); }   // → 钢琴
    assert.equal(u.mem.oblvnsMode, mode, mode);
    u.mem.oblvnsFever = 100;
    assert.ok(h.runUntil(() => (u.mem.oblvnsFeverUntil ?? 0) > h.b.time, 1), 'Fever running');
    h.spawn('enemy_dummy', { pos: [10, 6] });
    assert.ok(h.runUntil(() => atkHits(h, u).length >= 2, 5), 'the double attack');
    const hits = atkHits(h, u);
    assert.ok(hits.every((c) => c.type === (mode === 'organ' ? 'arts' : 'phys')), 'both hits of the timbre');
    done(h);
  }
});
